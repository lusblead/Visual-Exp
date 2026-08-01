import type { VisualSearchEvidence } from "./model-port";

const LOCAL_BACKEND_URL = "http://127.0.0.1:8080";
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class ServerWebSearchError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    status: number,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ServerWebSearchError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export async function searchVisualEvidence({
  query,
  ownerId,
  signal,
  fetchImpl = fetch,
}: {
  query: string;
  ownerId: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<VisualSearchEvidence[]> {
  const normalizedQuery = query.replace(/\s+/gu, " ").trim().slice(0, 300);
  if (!normalizedQuery) {
    throw new ServerWebSearchError(
      "validation_error",
      "联网搜索问题不能为空。",
      400,
      false,
    );
  }
  const destination = backendBaseUrl();
  const basePath = destination.pathname.replace(/\/+$/u, "");
  destination.pathname = `${basePath}/internal/v1/search`;
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Owner-Id": ownerId,
  });
  const token = backendToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetchImpl(destination, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: normalizedQuery,
        maxResults: 5,
        freshness: "any",
      }),
      cache: "no-store",
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ServerWebSearchError(
      "search_provider_unavailable",
      "联网搜索服务暂时不可用，请稍后重试。",
      503,
      true,
    );
  }

  const body = await boundedResponseText(response);
  const payload = parseJson(body);
  if (!response.ok) throw searchError(response.status, payload);
  const record = requiredRecord(payload);
  if (!Array.isArray(record.sources)) throw invalidResponse();
  return record.sources.map((source, index) =>
    parseSource(source, index),
  );
}

function backendBaseUrl(): URL {
  const configured = process.env.VISUALIZED_EXP_BACKEND_URL?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new ServerWebSearchError(
      "backend_unconfigured",
      "当前部署尚未配置 Java 后端地址。",
      503,
      false,
    );
  }
  let base: URL;
  try {
    base = new URL(configured || LOCAL_BACKEND_URL);
  } catch {
    throw new ServerWebSearchError(
      "backend_unconfigured",
      "Java 后端地址配置无效。",
      503,
      false,
    );
  }
  if (
    !["http:", "https:"].includes(base.protocol)
    || base.username
    || base.password
    || base.search
    || base.hash
    || (process.env.NODE_ENV === "production" && base.protocol !== "https:")
  ) {
    throw new ServerWebSearchError(
      "backend_unconfigured",
      "Java 后端地址配置无效。",
      503,
      false,
    );
  }
  return base;
}

function backendToken(): string | null {
  const token = process.env.VISUALIZED_EXP_BACKEND_TOKEN?.trim() ?? "";
  if (
    token.length > 4096
    || Array.from(token).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
    || (process.env.NODE_ENV === "production" && token.length < 16)
  ) {
    throw new ServerWebSearchError(
      "backend_unconfigured",
      "Java 后端认证配置无效。",
      503,
      false,
    );
  }
  return token || null;
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw invalidResponse();
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw invalidResponse();
  }
  return text;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidResponse();
  }
}

function parseSource(value: unknown, index: number): VisualSearchEvidence {
  const source = requiredRecord(value);
  const title = requiredText(source.title, 500);
  const url = requiredText(source.url, 2000);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidResponse();
  }
  if (parsed.protocol !== "https:") throw invalidResponse();
  return {
    id: `S${index + 1}`,
    title,
    url: parsed.toString(),
    snippet: nullableText(source.snippet, 4000),
    publishedAt: nullableText(source.publishedAt, 120),
  };
}

function searchError(status: number, value: unknown): ServerWebSearchError {
  const record = requiredRecord(value);
  const candidate = isRecord(record.error) ? record.error : record;
  const code =
    typeof candidate.code === "string" && /^[a-z0-9_]{1,80}$/u.test(candidate.code)
      ? candidate.code
      : "search_provider_failed";
  const safeMessage =
    code === "provider_not_configured"
      ? "请先在 AI 服务设置中配置并选择一个搜索服务。"
      : typeof candidate.message === "string" && candidate.message.length <= 300
        ? candidate.message
        : "联网搜索没有完成，请稍后重试。";
  return new ServerWebSearchError(
    code,
    safeMessage,
    status,
    typeof candidate.retryable === "boolean"
      ? candidate.retryable
      : status >= 500,
  );
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse();
  return value;
}

function requiredText(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > maxLength
  ) {
    throw invalidResponse();
  }
  return value.trim();
}

function nullableText(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw invalidResponse();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): ServerWebSearchError {
  return new ServerWebSearchError(
    "search_response_invalid",
    "联网搜索服务返回了无法识别的数据。",
    502,
    true,
  );
}

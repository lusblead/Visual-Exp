import {
  deviceOwnerCookie,
  resolveDeviceOwner,
} from "../../../../lib/server-owner";

export const dynamic = "force-dynamic";

const LOCAL_BACKEND_URL = "http://127.0.0.1:8080";
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "idempotency-key",
  "if-match",
] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "etag",
  "retry-after",
] as const;

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return forward(request, context, "GET");
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return forward(request, context, "POST");
}

export async function PUT(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return forward(request, context, "PUT");
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return forward(request, context, "PATCH");
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return forward(request, context, "DELETE");
}

async function forward(
  request: Request,
  context: RouteContext,
  method: string,
): Promise<Response> {
  try {
    if (method !== "GET") assertSameOrigin(request);
    const backendBaseUrl = resolveBackendBaseUrl();
    const { path } = await context.params;
    const destination = backendDestination(backendBaseUrl, path, request.url);
    const headers = forwardedRequestHeaders(request.headers);
    const internalToken = resolveInternalToken();
    if (internalToken) headers.set("Authorization", `Bearer ${internalToken}`);
    const owner = resolveDeviceOwner(request.headers.get("cookie"));
    headers.set("X-Owner-Id", owner.id);

    const body =
      method === "GET" ? undefined : await boundedRequestBody(request);
    const upstream = await fetch(destination, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: request.signal,
    });
    const responseHeaders = forwardedResponseHeaders(upstream.headers);
    if (owner.created) {
      responseHeaders.append(
        "Set-Cookie",
        deviceOwnerCookie(
          owner.id,
          new URL(request.url).protocol === "https:",
        ),
      );
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof BackendProxyError) {
      return jsonError(error.code, error.message, error.status);
    }
    console.error("java backend proxy failed", safeFailureDiagnostic(error));
    return jsonError(
      "backend_unavailable",
      "Java 后端暂时不可用，请确认后端服务已经启动。",
      502,
    );
  }
}

function safeFailureDiagnostic(error: unknown): {
  kind: string;
  transportCode?: string;
} {
  const diagnostic: { kind: string; transportCode?: string } = {
    kind: error instanceof Error ? error.name : "unknown",
  };
  if (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    typeof error.cause.code === "string" &&
    /^[A-Z0-9_]{1,40}$/u.test(error.cause.code)
  ) {
    diagnostic.transportCode = error.cause.code;
  }
  return diagnostic;
}

function resolveBackendBaseUrl(): URL {
  const configured = process.env.VISUALIZED_EXP_BACKEND_URL?.trim();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new BackendProxyError(
      "backend_unconfigured",
      "当前部署尚未配置 Java 后端地址。",
      503,
    );
  }
  let base: URL;
  try {
    base = new URL(configured || LOCAL_BACKEND_URL);
  } catch {
    throw new BackendProxyError(
      "backend_unconfigured",
      "Java 后端地址配置无效。",
      503,
    );
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new BackendProxyError(
      "backend_unconfigured",
      "Java 后端地址配置无效。",
      503,
    );
  }
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new BackendProxyError(
      "backend_unconfigured",
      "生产环境的 Java 后端地址必须使用 HTTPS。",
      503,
    );
  }
  return base;
}

function resolveInternalToken(): string | null {
  const token = process.env.VISUALIZED_EXP_BACKEND_TOKEN?.trim() ?? "";
  if (
    token &&
    (token.length > 4096 || Array.from(token).some((character) =>
      character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f))
  ) {
    throw new BackendProxyError(
      "backend_unconfigured",
      "Java 后端认证配置无效。",
      503,
    );
  }
  if (process.env.NODE_ENV === "production" && token.length < 16) {
    throw new BackendProxyError(
      "backend_unconfigured",
      "生产环境尚未配置 Java 后端认证。",
      503,
    );
  }
  return token || null;
}

function backendDestination(
  base: URL,
  path: readonly string[],
  requestUrl: string,
): URL {
  if (
    !Array.isArray(path) ||
    path.length < 1 ||
    path.length > 16 ||
    path.some(
      (segment) =>
        typeof segment !== "string" ||
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > 180,
    )
  ) {
    throw new BackendProxyError(
      "invalid_backend_path",
      "后端 API 路径无效。",
      400,
    );
  }
  const destination = new URL(base);
  const basePath = destination.pathname.replace(/\/+$/u, "");
  destination.pathname = `${basePath}/api/${path
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  destination.search = new URL(requestUrl).search;
  return destination;
}

function forwardedRequestHeaders(source: Headers): Headers {
  const target = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = source.get(name);
    if (value) target.set(name, value);
  }
  return target;
}

function forwardedResponseHeaders(source: Headers): Headers {
  const target = new Headers({ "Cache-Control": "no-store" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = source.get(name);
    if (value) target.set(name, value);
  }
  return target;
}

async function boundedRequestBody(request: Request): Promise<ArrayBuffer> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new BackendProxyError(
      "request_too_large",
      "请求体超过 4 MiB 上限。",
      413,
    );
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BackendProxyError(
        "request_too_large",
        "请求体超过 4 MiB 上限。",
        413,
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new BackendProxyError(
      "origin_rejected",
      "请求来源不受信任。",
      403,
    );
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new BackendProxyError(
      "origin_rejected",
      "请求来源不受信任。",
      403,
    );
  }
}

class BackendProxyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

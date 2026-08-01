const COMPANION_TIMEOUT_MS = 25_000;

export interface CompanionStatus {
  configured: boolean;
  provider: "deepseek";
  model: "deepseek-v4-pro";
  storage: "windows_credential_manager";
}

export interface CompanionTransport {
  baseUrl: string;
  bearerToken: string;
}

export class CompanionClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "CompanionClientError";
    this.code = code;
    this.status = status;
  }
}

interface CompanionConfiguration {
  baseUrl: string;
  bearerToken: string;
}

export function companionTransport(): CompanionTransport | null {
  const configuration = companionConfiguration();
  if (!configuration) return null;
  return {
    baseUrl: `${configuration.baseUrl}/v1/deepseek`,
    bearerToken: configuration.bearerToken,
  };
}

export function hasCompanionConfiguration(): boolean {
  return companionConfiguration() !== null;
}

export function requireCompanionConfiguration(): CompanionTransport {
  const transport = companionTransport();
  if (!transport) {
    throw new CompanionClientError(
      "local_companion_required",
      "请通过本地模式启动应用后再保存 API Key。",
      409,
    );
  }
  return transport;
}

export async function readCompanionStatus(): Promise<CompanionStatus> {
  return requestCompanion<CompanionStatus>("/v1/status", { method: "GET" });
}

export async function saveCompanionCredential(apiKey: string): Promise<CompanionStatus> {
  return requestCompanion<CompanionStatus>("/v1/credentials/deepseek", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
}

export async function deleteCompanionCredential(): Promise<CompanionStatus> {
  return requestCompanion<CompanionStatus>("/v1/credentials/deepseek", {
    method: "DELETE",
  });
}

async function requestCompanion<T>(path: string, init: RequestInit): Promise<T> {
  const configuration = companionConfiguration();
  if (!configuration) {
    throw new CompanionClientError(
      "local_companion_required",
      "本地凭据服务未启动。",
      409,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${configuration.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(COMPANION_TIMEOUT_MS),
      headers: {
        ...init.headers,
        Authorization: `Bearer ${configuration.bearerToken}`,
      },
    });
  } catch {
    throw new CompanionClientError(
      "local_companion_unavailable",
      "本地凭据服务暂时不可用，请重新启动本地模式。",
      503,
    );
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    const error = readSafeError(payload);
    throw new CompanionClientError(
      error.code,
      error.message,
      response.status >= 400 && response.status <= 599 ? response.status : 502,
    );
  }
  return payload as T;
}

function companionConfiguration(): CompanionConfiguration | null {
  const rawUrl = process.env.VISUALIZED_EXP_COMPANION_URL?.trim();
  const bearerToken = process.env.VISUALIZED_EXP_COMPANION_TOKEN?.trim();
  if (!rawUrl || !bearerToken) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")
  ) {
    return null;
  }
  return {
    baseUrl: parsed.origin,
    bearerToken,
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function readSafeError(payload: unknown): { code: string; message: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { code: "local_companion_failed", message: "本地凭据操作失败。" };
  }
  const record = payload as Record<string, unknown>;
  const nested =
    typeof record.error === "object" && record.error !== null && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : record;
  const code =
    typeof nested.code === "string" && nested.code.length <= 80
      ? nested.code
      : "local_companion_failed";
  return {
    code,
    message: companionMessage(code),
  };
}

function companionMessage(code: string): string {
  const messages: Record<string, string> = {
    credential_invalid: "DeepSeek API Key 无效或没有该模型的访问权限。",
    credential_required: "请先保存 DeepSeek API Key。",
    credential_store_unavailable: "Windows 凭据管理器暂时不可用。",
    invalid_credential_input: "请输入一条有效的 DeepSeek API Key。",
    local_companion_failed: "本地凭据操作失败。",
    model_unavailable:
      "当前 DeepSeek 账号未同时开放 deepseek-v4-pro 与 deepseek-v4-flash。",
    origin_rejected: "本地凭据请求来源不受信任。",
    provider_response_invalid: "DeepSeek 返回了无法验证的响应。",
    provider_timeout: "连接 DeepSeek 超时，请稍后重试。",
    provider_unavailable: "DeepSeek 暂时不可用，请稍后重试。",
    unauthorized: "本地凭据服务认证失败，请重新启动本地模式。",
  };
  return messages[code] ?? "本地凭据操作失败。";
}

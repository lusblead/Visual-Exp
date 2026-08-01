import {
  CompanionClientError,
  deleteCompanionCredential,
  hasCompanionConfiguration,
  readCompanionStatus,
  saveCompanionCredential,
} from "../../../lib/companion-client";

export const dynamic = "force-dynamic";

const MODEL = "deepseek-v4-pro";

type CredentialSource = "local_vault" | "environment" | "none";

export async function GET(): Promise<Response> {
  return credentialStatusResponse();
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const apiKey = await readApiKey(request);
    const status = await saveCompanionCredential(apiKey);
    return json(
      {
        configured: status.configured,
        provider: "deepseek",
        model: MODEL,
        source: "local_vault",
        persistentAvailable: true,
        companionAvailable: true,
      },
      200,
    );
  } catch (error) {
    return settingsError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    await deleteCompanionCredential();
    return credentialStatusResponse();
  } catch (error) {
    return settingsError(error);
  }
}

export async function credentialStatusResponse(): Promise<Response> {
  const environmentConfigured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const persistentAvailable = hasCompanionConfiguration();

  if (persistentAvailable) {
    try {
      const status = await readCompanionStatus();
      const source: CredentialSource = status.configured
        ? "local_vault"
        : environmentConfigured
          ? "environment"
          : "none";
      return json(
        {
          configured: status.configured || environmentConfigured,
          provider: "deepseek",
          model: MODEL,
          source,
          persistentAvailable: true,
          companionAvailable: true,
        },
        200,
      );
    } catch {
      return json(
        {
          configured: environmentConfigured,
          provider: "deepseek",
          model: MODEL,
          source: environmentConfigured ? "environment" : "none",
          persistentAvailable: true,
          companionAvailable: false,
        },
        200,
      );
    }
  }

  return json(
    {
      configured: environmentConfigured,
      provider: "deepseek",
      model: MODEL,
      source: environmentConfigured ? "environment" : "none",
      persistentAvailable: false,
      companionAvailable: false,
    },
    200,
  );
}

export function assertSameOrigin(request: Request): void {
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new SettingsRequestError("origin_rejected", "设置请求来源不受信任。", 403);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new SettingsRequestError("origin_rejected", "设置请求来源不受信任。", 403);
  }
}

export async function readApiKey(request: Request): Promise<string> {
  const mediaType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new SettingsRequestError(
      "unsupported_media_type",
      "设置请求体必须使用 application/json。",
      415,
    );
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2048) {
    throw new SettingsRequestError(
      "invalid_credential_input",
      "API Key 请求体过大。",
      413,
    );
  }
  let value: unknown;
  try {
    const rawBody = await readBoundedUtf8Body(request);
    value = JSON.parse(rawBody) as unknown;
  } catch (error) {
    if (error instanceof SettingsRequestError) throw error;
    throw new SettingsRequestError("invalid_credential_input", "API Key 格式不正确。", 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SettingsRequestError("invalid_credential_input", "API Key 格式不正确。", 400);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.apiKey !== "string" ||
    /[\r\n]/.test(record.apiKey)
  ) {
    throw new SettingsRequestError(
      "invalid_credential_input",
      "请输入一条有效的 DeepSeek API Key。",
      400,
    );
  }
  const apiKey = record.apiKey.trim();
  if (apiKey.length < 16 || apiKey.length > 512) {
    throw new SettingsRequestError(
      "invalid_credential_input",
      "DeepSeek API Key 长度不正确。",
      400,
    );
  }
  return apiKey;
}

async function readBoundedUtf8Body(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 2048) {
      await reader.cancel().catch(() => undefined);
      throw new SettingsRequestError(
        "invalid_credential_input",
        "API Key 请求体过大。",
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new SettingsRequestError(
      "invalid_credential_input",
      "API Key 格式不正确。",
      400,
    );
  }
}

class SettingsRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function settingsError(error: unknown): Response {
  if (error instanceof CompanionClientError || error instanceof SettingsRequestError) {
    return json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }
  return json(
    {
      error: {
        code: "model_settings_failed",
        message: "模型设置暂时无法保存，请稍后再试。",
      },
    },
    502,
  );
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

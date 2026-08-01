export type ProviderKind = "model" | "search";

export type ModelProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "kimi"
  | "glm"
  | "gemini"
  | "qwen"
  | "openrouter"
  | "custom_openai_compatible";

export type SearchProviderId = "tavily" | "brave";
export type ProviderId = ModelProviderId | SearchProviderId;

export type ApiFormat =
  | "openai_chat_completions"
  | "anthropic_messages";

export type EndpointMode = "base_url" | "full_url";

export type AuthType =
  | "bearer"
  | "x_api_key"
  | "api_key"
  | "custom_header";

export interface ProviderPreset {
  id: ProviderId;
  kind: ProviderKind;
  label: string;
  description: string;
  baseUrl: string | null;
  defaultModel: string | null;
  apiFormat: ApiFormat | null;
  endpointMode: EndpointMode | null;
  authType: AuthType | null;
  authHeader: string | null;
  modelSuggestions?: readonly string[];
  custom?: boolean;
}

export interface ProviderSummary {
  id: string;
  name: string;
  kind: ProviderKind;
  provider: ProviderId;
  baseUrl: string | null;
  defaultModel: string | null;
  apiFormat: ApiFormat | null;
  endpointMode: EndpointMode | null;
  authType: AuthType | null;
  authHeader: string | null;
  configured: true;
  active: boolean;
  lastVerifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWriteDraft {
  name: string;
  kind: ProviderKind;
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  apiFormat: ApiFormat | null;
  endpointMode: EndpointMode | null;
  authType: AuthType | null;
  authHeader: string;
  activate: boolean;
}

export interface ProviderWriteBody {
  name: string;
  kind: ProviderKind;
  provider: ProviderId;
  apiKey?: string;
  baseUrl: string | null;
  defaultModel: string | null;
  apiFormat: ApiFormat | null;
  endpointMode: EndpointMode | null;
  authType: AuthType | null;
  authHeader: string | null;
  activate: boolean;
}

export const API_FORMAT_OPTIONS: readonly {
  value: ApiFormat;
  label: string;
  description: string;
}[] = [
  {
    value: "openai_chat_completions",
    label: "OpenAI Chat Completions",
    description: "兼容 /chat/completions 的服务。",
  },
  {
    value: "anthropic_messages",
    label: "Anthropic Messages",
    description: "Claude 原生 Messages 协议。",
  },
] as const;

export const ENDPOINT_MODE_OPTIONS: readonly {
  value: EndpointMode;
  label: string;
}[] = [
  { value: "base_url", label: "API 根地址" },
  { value: "full_url", label: "完整请求 URL" },
] as const;

export const AUTH_TYPE_OPTIONS: readonly {
  value: AuthType;
  label: string;
}[] = [
  { value: "bearer", label: "Bearer Token" },
  { value: "x_api_key", label: "X-API-Key 类 Header" },
  { value: "api_key", label: "api-key Header" },
  { value: "custom_header", label: "自定义 Header" },
] as const;

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openai",
    kind: "model",
    label: "OpenAI",
    description: "Chat Completions + Bearer，地址和协议均可调整",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: ["gpt-4.1", "gpt-4.1-mini"],
  },
  {
    id: "anthropic",
    kind: "model",
    label: "Anthropic",
    description: "Claude 原生 Messages + x-api-key",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
    apiFormat: "anthropic_messages",
    endpointMode: "base_url",
    authType: "x_api_key",
    authHeader: null,
    modelSuggestions: ["claude-sonnet-4-6"],
  },
  {
    id: "deepseek",
    kind: "model",
    label: "DeepSeek",
    description: "Chat Completions + Bearer",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: ["deepseek-v4-pro", "deepseek-v4-flash"],
  },
  {
    id: "kimi",
    kind: "model",
    label: "Kimi",
    description: "Moonshot OpenAI 兼容接口 + Bearer",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k3",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: [
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ],
  },
  {
    id: "glm",
    kind: "model",
    label: "GLM",
    description: "智谱 OpenAI 兼容接口 + Bearer",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.2",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: [
      "glm-5.2",
      "glm-5-turbo",
      "glm-5",
      "glm-4.7",
      "glm-4.7-flash",
      "glm-4.5-flash",
    ],
  },
  {
    id: "gemini",
    kind: "model",
    label: "Gemini",
    description: "Google OpenAI 兼容接口 + Bearer",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.6-flash",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: ["gemini-3.6-flash"],
  },
  {
    id: "qwen",
    kind: "model",
    label: "通义千问",
    description: "百炼兼容 Chat Completions + Bearer",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.7-plus",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: ["qwen3.7-plus", "qwen-plus"],
  },
  {
    id: "openrouter",
    kind: "model",
    label: "OpenRouter",
    description: "Chat Completions + Bearer",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    modelSuggestions: ["openai/gpt-4.1-mini"],
  },
  {
    id: "custom_openai_compatible",
    kind: "model",
    label: "自主设置",
    description: "从 Chat Completions 模板开始，自行调整协议",
    baseUrl: null,
    defaultModel: null,
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    custom: true,
  },
  {
    id: "tavily",
    kind: "search",
    label: "Tavily",
    description: "Tavily 搜索服务 Key",
    baseUrl: "https://api.tavily.com",
    defaultModel: null,
    apiFormat: null,
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
  },
  {
    id: "brave",
    kind: "search",
    label: "Brave Search",
    description: "Brave Search 服务 Key",
    baseUrl: "https://api.search.brave.com",
    defaultModel: null,
    apiFormat: null,
    endpointMode: "base_url",
    authType: "custom_header",
    authHeader: "X-Subscription-Token",
  },
] as const;

const PROVIDERS_BY_KIND: Readonly<Record<ProviderKind, readonly ProviderId[]>> = {
  model: PROVIDER_PRESETS.filter((preset) => preset.kind === "model").map(
    (preset) => preset.id,
  ),
  search: PROVIDER_PRESETS.filter((preset) => preset.kind === "search").map(
    (preset) => preset.id,
  ),
};

const API_FORMAT_VALUES = API_FORMAT_OPTIONS.map((option) => option.value);
const ENDPOINT_MODE_VALUES = ENDPOINT_MODE_OPTIONS.map((option) => option.value);
const AUTH_TYPE_VALUES = AUTH_TYPE_OPTIONS.map((option) => option.value);
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const SECRET_FIELD_PATTERN =
  /(?:api.?key|credential|password|secret|token|ciphertext)/iu;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ProviderSettingsError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly status: number;

  constructor({
    code,
    message,
    retryable = false,
    requestId = null,
    status = 0,
  }: {
    code: string;
    message: string;
    retryable?: boolean;
    requestId?: string | null;
    status?: number;
  }) {
    super(message);
    this.name = "ProviderSettingsError";
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.status = status;
  }
}

export function presetsForKind(kind: ProviderKind): readonly ProviderPreset[] {
  return PROVIDER_PRESETS.filter((preset) => preset.kind === kind);
}

export function presetForProvider(
  provider: ProviderId,
): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === provider);
}

export function providerBelongsToKind(
  kind: ProviderKind,
  provider: ProviderId,
): boolean {
  return PROVIDERS_BY_KIND[kind].includes(provider);
}

export function defaultAuthHeader(authType: AuthType): string {
  return authType === "custom_header" ? "X-API-Key" : "";
}

export function draftForProvider(provider: ProviderId): ProviderWriteDraft {
  const preset = presetForProvider(provider);
  if (!preset) throw validationError("未知供应商预设。");
  return {
    name: preset.label,
    kind: preset.kind,
    provider: preset.id,
    apiKey: "",
    baseUrl: preset.baseUrl ?? "",
    defaultModel: preset.defaultModel ?? "",
    apiFormat: preset.apiFormat,
    endpointMode: preset.endpointMode,
    authType: preset.authType,
    authHeader: preset.authHeader ?? "",
    activate: true,
  };
}

export function emptyProviderDraft(
  kind: ProviderKind = "model",
): ProviderWriteDraft {
  return draftForProvider(presetsForKind(kind)[0].id);
}

export function buildProviderWriteBody(
  draft: ProviderWriteDraft,
  mode: "create" | "update",
): ProviderWriteBody {
  const name = requireSingleLine(draft.name, "配置名称", 80);
  if (!providerBelongsToKind(draft.kind, draft.provider)) {
    throw validationError("供应商与配置类型不匹配。");
  }
  const preset = presetForProvider(draft.provider);
  if (!preset) throw validationError("未知供应商预设。");

  let baseUrl: string | null;
  let defaultModel: string | null;
  let apiFormat: ApiFormat | null;
  let endpointMode: EndpointMode | null;
  let authType: AuthType | null;
  let authHeader: string | null;

  if (draft.kind === "model") {
    apiFormat = requireEnum(
      draft.apiFormat,
      API_FORMAT_VALUES,
      "API 格式",
    );
    endpointMode = requireEnum(
      draft.endpointMode,
      ENDPOINT_MODE_VALUES,
      "地址模式",
    );
    authType = requireEnum(draft.authType, AUTH_TYPE_VALUES, "认证方式");
    baseUrl = normalizeModelRequestUrl(draft.baseUrl, endpointMode);
    defaultModel = requireSingleLine(draft.defaultModel, "模型标识", 160);
    authHeader = normalizeAuthHeader(authType, draft.authHeader);
  } else {
    apiFormat = null;
    endpointMode = null;
    authType = null;
    authHeader = null;
    baseUrl = null;
    defaultModel = null;
  }

  const apiKey = optionalSingleLine(draft.apiKey, "API Key", 4096);
  if (mode === "create" && !apiKey) {
    throw validationError("首次保存需要输入 API Key。");
  }

  return {
    name,
    kind: draft.kind,
    provider: draft.provider,
    ...(apiKey ? { apiKey } : {}),
    baseUrl,
    defaultModel,
    apiFormat,
    endpointMode,
    authType,
    authHeader,
    activate: draft.activate,
  };
}

export function parseProviderListResponse(value: unknown): ProviderSummary[] {
  assertNoSecretFields(value);
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    throw invalidResponse();
  }
  return value.providers.map(parseProviderSummary);
}

export function parseProviderResponse(value: unknown): ProviderSummary {
  assertNoSecretFields(value);
  if (!isRecord(value)) throw invalidResponse();
  return parseProviderSummary(value.provider);
}

export async function listProviders({
  signal,
  fetcher = globalThis.fetch,
}: {
  signal?: AbortSignal;
  fetcher?: FetchLike;
} = {}): Promise<ProviderSummary[]> {
  const payload = await requestProviderJson(
    "/api/backend/v1/providers",
    { method: "GET", signal },
    fetcher,
  );
  return parseProviderListResponse(payload);
}

export async function createProvider(
  draft: ProviderWriteDraft,
  fetcher: FetchLike = globalThis.fetch,
): Promise<ProviderSummary> {
  const body = buildProviderWriteBody(draft, "create");
  const payload = await requestProviderJson(
    "/api/backend/v1/providers",
    jsonRequest("POST", body),
    fetcher,
  );
  return parseProviderResponse(payload);
}

export async function updateProvider(
  id: string,
  draft: ProviderWriteDraft,
  fetcher: FetchLike = globalThis.fetch,
): Promise<ProviderSummary> {
  const providerId = encodeProviderId(id);
  const body = buildProviderWriteBody(draft, "update");
  const payload = await requestProviderJson(
    `/api/backend/v1/providers/${providerId}`,
    jsonRequest("PUT", body),
    fetcher,
  );
  return parseProviderResponse(payload);
}

export async function activateProvider(
  id: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<ProviderSummary> {
  const payload = await requestProviderJson(
    `/api/backend/v1/providers/${encodeProviderId(id)}/activate`,
    { method: "POST", headers: requestHeaders() },
    fetcher,
  );
  return parseProviderResponse(payload);
}

export async function deleteProvider(
  id: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<void> {
  await requestProviderJson(
    `/api/backend/v1/providers/${encodeProviderId(id)}`,
    { method: "DELETE", headers: requestHeaders() },
    fetcher,
    true,
  );
}

function parseProviderSummary(value: unknown): ProviderSummary {
  if (!isRecord(value)) throw invalidResponse();
  const kind = readEnum(value.kind, ["model", "search"] as const);
  const provider = readEnum(value.provider, [
    "openai",
    "anthropic",
    "deepseek",
    "kimi",
    "glm",
    "gemini",
    "qwen",
    "openrouter",
    "custom_openai_compatible",
    "tavily",
    "brave",
  ] as const);
  if (!providerBelongsToKind(kind, provider)) throw invalidResponse();

  const baseUrl = readNullableString(value.baseUrl);
  const defaultModel = readNullableString(value.defaultModel);
  const apiFormat = readNullableEnum(value.apiFormat, [
    "openai_chat_completions",
    "anthropic_messages",
  ] as const);
  const endpointMode = readNullableEnum(value.endpointMode, [
    "base_url",
    "full_url",
  ] as const);
  const authType = readNullableEnum(value.authType, [
    "bearer",
    "x_api_key",
    "api_key",
    "custom_header",
  ] as const);
  const authHeader = readNullableString(value.authHeader);

  if (
    value.configured !== true ||
    typeof value.active !== "boolean" ||
    !validAuthHeader(authType, authHeader)
  ) {
    throw invalidResponse();
  }
  if (kind === "model") {
    if (!baseUrl || !defaultModel || !apiFormat || !endpointMode || !authType) {
      throw invalidResponse();
    }
  } else {
    const preset = presetForProvider(provider);
    if (
      !baseUrl ||
      defaultModel !== null ||
      apiFormat !== null ||
      !preset ||
      endpointMode !== preset.endpointMode ||
      authType !== preset.authType ||
      authHeader !== preset.authHeader
    ) {
      throw invalidResponse();
    }
  }

  return {
    id: readRequiredString(value.id),
    name: readRequiredString(value.name),
    kind,
    provider,
    baseUrl,
    defaultModel,
    apiFormat,
    endpointMode,
    authType,
    authHeader,
    configured: true,
    active: value.active,
    lastVerifiedAt: readRequiredString(value.lastVerifiedAt),
    createdAt: readRequiredString(value.createdAt),
    updatedAt: readRequiredString(value.updatedAt),
  };
}

async function requestProviderJson(
  url: string,
  init: RequestInit,
  fetcher: FetchLike,
  allowEmpty = false,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProviderSettingsError({
      code: "backend_unavailable",
      message: "暂时无法连接配置服务，请稍后重试。",
      retryable: true,
    });
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) throw invalidResponse(response.status);
    }
  }

  if (!response.ok) {
    throw parseProviderError(payload, response.status);
  }
  if (allowEmpty && !text) return null;
  if (!text) throw invalidResponse(response.status);
  return payload;
}

function parseProviderError(
  payload: unknown,
  status: number,
): ProviderSettingsError {
  const candidate =
    isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
  if (isRecord(candidate)) {
    const code =
      typeof candidate.code === "string" && candidate.code
        ? candidate.code
        : "provider_request_failed";
    const message =
      typeof candidate.message === "string" && candidate.message
        ? candidate.message
        : defaultErrorMessage(status);
    return new ProviderSettingsError({
      code,
      message,
      retryable:
        typeof candidate.retryable === "boolean"
          ? candidate.retryable
          : status >= 500,
      requestId:
        typeof candidate.requestId === "string" ? candidate.requestId : null,
      status,
    });
  }
  return new ProviderSettingsError({
    code: "provider_request_failed",
    message: defaultErrorMessage(status),
    retryable: status >= 500,
    status,
  });
}

function jsonRequest(method: string, body: ProviderWriteBody): RequestInit {
  return {
    method,
    headers: requestHeaders(true),
    body: JSON.stringify(body),
  };
}

function requestHeaders(json = false): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

function normalizeModelRequestUrl(
  value: string,
  endpointMode: EndpointMode,
): string {
  const input = requireSingleLine(value, "请求地址", 500);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw validationError("请求地址不是有效网址。");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw validationError(
      endpointMode === "full_url"
        ? "完整请求 URL 必须是无账号、查询参数或片段的 HTTPS 地址。"
        : "API 根地址必须是无账号、查询参数或片段的 HTTPS 地址。",
    );
  }
  const normalized = parsed.toString();
  return endpointMode === "base_url"
    ? normalized.replace(/\/$/u, "")
    : normalized;
}

function normalizeAuthHeader(
  authType: AuthType,
  value: string,
): string | null {
  if (authType !== "custom_header") return null;
  const fallback = defaultAuthHeader(authType);
  const header = requireSingleLine(value || fallback, "认证 Header", 80);
  if (!HEADER_NAME_PATTERN.test(header)) {
    throw validationError("认证 Header 名称包含无效字符。");
  }
  return header;
}

function validAuthHeader(
  authType: AuthType | null,
  authHeader: string | null,
): boolean {
  if (authType === null) return authHeader === null;
  if (authType !== "custom_header") return authHeader === null;
  return Boolean(authHeader && HEADER_NAME_PATTERN.test(authHeader));
}

function encodeProviderId(value: string): string {
  const id = requireSingleLine(value, "配置 ID", 180);
  return encodeURIComponent(id);
}

function requireSingleLine(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  const normalized = optionalSingleLine(value, label, maxLength);
  if (!normalized) throw validationError(`${label}不能为空。`);
  return normalized;
}

function optionalSingleLine(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw validationError(`${label}格式无效。`);
  }
  const normalized = value.trim();
  if (/[\r\n]/u.test(normalized) || normalized.length > maxLength) {
    throw validationError(`${label}必须是长度不超过 ${maxLength} 的单行文本。`);
  }
  return normalized;
}

function requireEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw validationError(`${label}无效。`);
  }
  return value as T;
}

function readRequiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw invalidResponse();
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null;
  return readRequiredString(value);
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw invalidResponse();
  }
  return value as T[number];
}

function readNullableEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | null {
  if (value === null) return null;
  return readEnum(value, allowed);
}

function assertNoSecretFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSecretFields);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_FIELD_PATTERN.test(key)) throw invalidResponse();
    assertNoSecretFields(child);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string): ProviderSettingsError {
  return new ProviderSettingsError({
    code: "validation_error",
    message,
    status: 400,
  });
}

function invalidResponse(status = 502): ProviderSettingsError {
  return new ProviderSettingsError({
    code: "provider_response_invalid",
    message: "配置服务返回了无法识别的结果。",
    retryable: true,
    status,
  });
}

function defaultErrorMessage(status: number): string {
  if (status === 401) return "API Key 验证失败，请检查后重试。";
  if (status === 404) return "这项配置已经不存在，请刷新后重试。";
  if (status === 400) return "配置内容不完整或格式无效。";
  return "配置服务暂时不可用，请稍后重试。";
}

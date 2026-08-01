export type ModelProviderErrorCode =
  | "credential_required"
  | "provider_auth_failed"
  | "provider_insufficient_balance"
  | "provider_invalid_parameters"
  | "provider_content_filtered"
  | "provider_insufficient_resources"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_response_invalid"
  | "provider_request_failed";

export class ModelProviderError extends Error {
  readonly code: ModelProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ModelProviderErrorCode,
    message: string,
    status: number,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ModelProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function providerHttpError(status: number, payload: unknown): ModelProviderError {
  const upstreamCode = readUpstreamCode(payload);
  if (upstreamCode === "credential_required") {
    return new ModelProviderError(
      "credential_required",
      "请先在模型设置中保存 DeepSeek API Key。",
      409,
      false,
    );
  }
  if (
    status === 401 ||
    status === 403 ||
    upstreamCode === "invalid_credential" ||
    upstreamCode === "provider_auth_failed"
  ) {
    return new ModelProviderError(
      "provider_auth_failed",
      "DeepSeek API Key 无效或已失效，请重新设置。",
      401,
      false,
    );
  }
  if (status === 402 || upstreamCode === "provider_insufficient_balance") {
    return new ModelProviderError(
      "provider_insufficient_balance",
      "DeepSeek 账户余额不足，请充值后重试。",
      402,
      false,
    );
  }
  if (upstreamCode === "provider_content_filtered") {
    return new ModelProviderError(
      "provider_content_filtered",
      "DeepSeek 未返回这部分内容，请调整问题后重试。",
      422,
      false,
    );
  }
  if (upstreamCode === "provider_insufficient_resources") {
    return new ModelProviderError(
      "provider_insufficient_resources",
      "DeepSeek 当前推理资源不足，请稍后重试。",
      503,
      true,
    );
  }
  if (status === 422 || upstreamCode === "provider_invalid_parameters") {
    return new ModelProviderError(
      "provider_invalid_parameters",
      "DeepSeek 请求参数无效，请检查模型请求配置。",
      422,
      false,
    );
  }
  if (status === 429) {
    return new ModelProviderError(
      "provider_rate_limited",
      "DeepSeek 请求过于频繁，请稍后再试。",
      429,
      true,
    );
  }
  if (status >= 500) {
    return new ModelProviderError(
      "provider_unavailable",
      "DeepSeek 服务暂时不可用，请稍后再试。",
      503,
      true,
    );
  }
  return new ModelProviderError(
    "provider_request_failed",
    "DeepSeek 没有接受本次请求，请检查模型设置后重试。",
    502,
    false,
  );
}

export function providerNetworkError(): ModelProviderError {
  return new ModelProviderError(
    "provider_unavailable",
    "暂时无法连接 DeepSeek，请稍后再试。",
    503,
    true,
  );
}

export function invalidProviderResponse(message = "DeepSeek 返回的内容无法解析，请重试。") {
  return new ModelProviderError("provider_response_invalid", message, 502, true);
}

function readUpstreamCode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const nested =
    typeof record.error === "object" && record.error !== null && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : record;
  return typeof nested.code === "string" && nested.code.length <= 80
    ? nested.code
    : null;
}

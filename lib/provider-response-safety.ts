import { ModelProviderError } from "./provider-errors";

export function assertProviderCredentialNotEchoed(
  responseValue: unknown,
  credential: string,
): void {
  if (!credential) return;

  const serialized =
    typeof responseValue === "string"
      ? responseValue
      : JSON.stringify(responseValue);
  if (typeof serialized === "string" && serialized.includes(credential)) {
    throw new ModelProviderError(
      "provider_response_invalid",
      "模型供应商返回了不安全的响应。",
      502,
      false,
    );
  }
}

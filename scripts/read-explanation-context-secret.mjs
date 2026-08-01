export async function readExplanationContextSecret(
  companionUrl,
  companionToken,
  fetcher = fetch,
) {
  const response = await fetcher(
    `${companionUrl}/v1/runtime/explanation-context-secret`,
    {
      headers: { Authorization: `Bearer ${companionToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("context secret request failed");
  const payload = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.secret !== "string" ||
    Buffer.byteLength(payload.secret, "utf8") < 32
  ) {
    throw new Error("context secret response is invalid");
  }
  return payload.secret;
}

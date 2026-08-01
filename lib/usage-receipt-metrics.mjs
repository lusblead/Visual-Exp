export const PROVIDER_USAGE_FIELDS = Object.freeze([
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "promptCacheHitTokens",
  "promptCacheMissTokens",
]);

/**
 * Remove replayed receipt records by their durable request identity.
 *
 * The first occurrence wins. A duplicate must not consume pre-generation
 * budget twice or inflate provider-reported token totals after restore.
 */
export function dedupeGenerationReceipts(receipts) {
  if (!Array.isArray(receipts)) {
    throw new TypeError("receipts must be an array");
  }

  const seen = new Set();
  const uniqueReceipts = [];
  let duplicateCount = 0;

  for (const [index, receipt] of receipts.entries()) {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      throw new TypeError(`receipts[${index}] must be an object`);
    }
    const id = requiredString(receipt.id, `receipts[${index}].id`);
    if (seen.has(id)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(id);
    uniqueReceipts.push(receipt);
  }

  return {
    receipts: uniqueReceipts,
    duplicateCount,
  };
}

/**
 * Aggregate only numeric usage reported by the provider.
 *
 * Unknown fields remain observable through `unknownReceipts`; this function
 * never accepts character counts and never synthesizes estimated tokens.
 */
export function summarizeProviderUsageReceipts(receipts) {
  const deduped = dedupeGenerationReceipts(receipts);
  const fields = Object.fromEntries(
    PROVIDER_USAGE_FIELDS.map((field) => [
      field,
      {
        reportedTokens: 0,
        unknownReceipts: 0,
      },
    ]),
  );

  for (const [index, receipt] of deduped.receipts.entries()) {
    const usage = receipt.usage;
    if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
      throw new TypeError(`receipts[${index}].usage must be an object`);
    }
    for (const field of PROVIDER_USAGE_FIELDS) {
      const value = usage[field];
      if (value === null) {
        fields[field].unknownReceipts += 1;
        continue;
      }
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(
          `receipts[${index}].usage.${field} must be a non-negative safe integer or null`,
        );
      }
      fields[field].reportedTokens += value;
    }
  }

  return {
    inputReceiptCount: receipts.length,
    uniqueReceiptCount: deduped.receipts.length,
    duplicateReceiptCount: deduped.duplicateCount,
    fields,
  };
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

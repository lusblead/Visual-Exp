export const USAGE_FIELDS = Object.freeze([
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "promptCacheHitTokens",
  "promptCacheMissTokens",
]);

export const PROFILE_LIMITS = Object.freeze({
  old_full: Object.freeze({
    sceneCalls: Number.POSITIVE_INFINITY,
    termBatches: Number.POSITIVE_INFINITY,
  }),
  on_demand: Object.freeze({ sceneCalls: 0, termBatches: 0 }),
  balanced: Object.freeze({ sceneCalls: 1, termBatches: 1 }),
  deep: Object.freeze({ sceneCalls: 5, termBatches: 4 }),
});

export function sanitizeUsageEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError(`usage[${index}] must be an object`);
    }
    const usage =
      event.usage === null ? null : sanitizeUsage(event.usage, `usage[${index}]`);
    return {
      provider: safeLabel(event.provider, "unknown"),
      model: safeLabel(event.model, "unknown"),
      phase: event.phase === "repair" ? "repair" : "primary",
      providerAttempt: safePositiveInteger(event.providerAttempt, 1),
      usage,
    };
  });
}

export function summarizeCalls(calls) {
  if (!Array.isArray(calls)) throw new TypeError("calls must be an array");
  const fields = Object.fromEntries(
    USAGE_FIELDS.map((field) => [
      field,
      { reportedTokens: 0, unknownCalls: 0 },
    ]),
  );
  let successCount = 0;
  let failureCount = 0;
  let durationMs = 0;

  for (const [callIndex, call] of calls.entries()) {
    if (!call || typeof call !== "object" || Array.isArray(call)) {
      throw new TypeError(`calls[${callIndex}] must be an object`);
    }
    if (call.status === "success") successCount += 1;
    else failureCount += 1;
    durationMs += nonNegativeNumber(call.durationMs, `calls[${callIndex}].durationMs`);

    const events = Array.isArray(call.providerUsage) ? call.providerUsage : [];
    for (const field of USAGE_FIELDS) {
      if (events.length === 0) {
        fields[field].unknownCalls += 1;
        continue;
      }
      let callUnknown = false;
      let callTokens = 0;
      for (const event of events) {
        const value = event?.usage?.[field];
        if (value === null || value === undefined) {
          callUnknown = true;
        } else {
          callTokens += nonNegativeInteger(
            value,
            `calls[${callIndex}].providerUsage.${field}`,
          );
        }
      }
      fields[field].reportedTokens += callTokens;
      if (callUnknown) fields[field].unknownCalls += 1;
    }
  }

  return {
    callCount: calls.length,
    successCount,
    failureCount,
    durationMs: roundMilliseconds(durationMs),
    fields,
  };
}

export function combineCallSummaries(shared, incremental) {
  return {
    callCount: shared.callCount + incremental.callCount,
    successCount: shared.successCount + incremental.successCount,
    failureCount: shared.failureCount + incremental.failureCount,
    durationMs: roundMilliseconds(shared.durationMs + incremental.durationMs),
    fields: Object.fromEntries(
      USAGE_FIELDS.map((field) => [
        field,
        {
          reportedTokens:
            shared.fields[field].reportedTokens +
            incremental.fields[field].reportedTokens,
          unknownCalls:
            shared.fields[field].unknownCalls +
            incremental.fields[field].unknownCalls,
        },
      ]),
    ),
  };
}

export function relativeToOldFull(oldFull, candidate) {
  const oldCalls = oldFull.callCount;
  const oldTokens = exactReportedTokens(oldFull, "totalTokens");
  const candidateTokens = exactReportedTokens(candidate, "totalTokens");
  return {
    callCountSaved: oldCalls - candidate.callCount,
    callSavingsRate:
      oldCalls === 0
        ? null
        : roundRatio((oldCalls - candidate.callCount) / oldCalls),
    totalTokensSaved:
      oldTokens === null || candidateTokens === null
        ? null
        : oldTokens - candidateTokens,
    totalTokenSavingsRate:
      oldTokens === null || candidateTokens === null || oldTokens === 0
        ? null
        : roundRatio((oldTokens - candidateTokens) / oldTokens),
  };
}

export function firstPreparedMilliseconds(calls, scheduleDelayMs = 250) {
  const firstScene = calls.find((call) => call.action === "expand");
  if (!firstScene || firstScene.status !== "success") return null;
  return roundMilliseconds(
    nonNegativeNumber(scheduleDelayMs, "scheduleDelayMs") +
      nonNegativeNumber(firstScene.durationMs, "first scene durationMs"),
  );
}

export function exactReportedTokens(summary, field) {
  const value = summary?.fields?.[field];
  if (!value || value.unknownCalls !== 0) return null;
  return value.reportedTokens;
}

function sanitizeUsage(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}.usage must be an object or null`);
  }
  return Object.fromEntries(
    USAGE_FIELDS.map((field) => {
      const tokens = value[field];
      return [
        field,
        tokens === null || tokens === undefined
          ? null
          : nonNegativeInteger(tokens, `${label}.${field}`),
      ];
    }),
  );
}

function safeLabel(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u.test(normalized)
    ? normalized
    : fallback;
}

function safePositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function nonNegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function roundMilliseconds(value) {
  return Math.round(value * 10) / 10;
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000;
}

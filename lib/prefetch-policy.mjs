const FRONTIER_KEY_PREFIX = "prefetch-frontier:v1";

export const DEFAULT_PREFETCH_PROFILE = "balanced";

export const PREFETCH_PROFILE_LIMITS = Object.freeze({
  on_demand: Object.freeze({
    sceneCalls: 0,
    termBatches: 0,
  }),
  balanced: Object.freeze({
    sceneCalls: 1,
    termBatches: 1,
  }),
  deep: Object.freeze({
    sceneCalls: 5,
    termBatches: 4,
  }),
});

const PREFETCH_PROFILES = new Set(Object.keys(PREFETCH_PROFILE_LIMITS));

/**
 * Parse persisted or user-selected profile state. A missing value represents a
 * new installation and therefore resolves to the balanced default; an unknown
 * stored value is rejected so callers can quarantine the containing snapshot.
 */
export function parsePrefetchProfile(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PREFETCH_PROFILE;
  }
  if (typeof value !== "string") {
    throw new TypeError("prefetch profile must be a string");
  }
  const normalized = value.trim();
  if (!PREFETCH_PROFILES.has(normalized)) {
    throw new TypeError(`unknown prefetch profile: ${normalized || "(empty)"}`);
  }
  return normalized;
}

/**
 * Build a stable identity for one active semantic frontier.
 *
 * Document version is deliberately excluded: accepting one direct child's
 * expansion advances the document version, but must not reset this frontier's
 * hard background budget. A real change to the active node or its direct child
 * membership creates a new identity.
 */
export function prefetchFrontierKey(document, activeNodeId) {
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    !Array.isArray(document.nodes)
  ) {
    throw new TypeError("document must contain a nodes array");
  }
  const documentId = requiredString(document.id, "document.id");
  const requestedNodeId = requiredString(activeNodeId, "activeNodeId");
  const activeNode = document.nodes.find(
    (node) => node && typeof node === "object" && node.id === requestedNodeId,
  );
  if (!activeNode) {
    throw new TypeError("activeNodeId must identify a node in document.nodes");
  }

  const childIds = stringList(activeNode.childIds, "activeNode.childIds");
  const terms = stringList(activeNode.terms ?? [], "activeNode.terms");
  const fingerprint = fingerprintValues([
    requiredString(activeNode.title, "activeNode.title"),
    requiredString(activeNode.summary, "activeNode.summary"),
    requiredString(activeNode.detail, "activeNode.detail"),
    childIds.join("\u001f"),
    terms.join("\u001f"),
  ]);

  return [
    FRONTIER_KEY_PREFIX,
    encodeURIComponent(documentId),
    encodeURIComponent(requestedNodeId),
    fingerprint,
  ].join(":");
}

/**
 * Count persisted background request receipts for one semantic frontier.
 * Every issued background request consumes budget regardless of outcome.
 */
export function countPrefetchReceipts(receipts, frontierKey) {
  if (!Array.isArray(receipts)) {
    throw new TypeError("receipts must be an array");
  }
  const requestedFrontierKey = requiredString(frontierKey, "frontierKey");
  const seenReceiptIds = new Set();
  let sceneCalls = 0;
  let termBatches = 0;

  for (const receipt of receipts) {
    const receiptId =
      receipt &&
      typeof receipt === "object" &&
      !Array.isArray(receipt) &&
      typeof receipt.id === "string" &&
      receipt.id.trim()
        ? receipt.id.trim()
        : null;
    if (receiptId !== null) {
      if (seenReceiptIds.has(receiptId)) continue;
      seenReceiptIds.add(receiptId);
    }
    if (
      !receipt ||
      typeof receipt !== "object" ||
      Array.isArray(receipt) ||
      receipt.lane !== "background" ||
      receipt.frontierKey !== requestedFrontierKey
    ) {
      continue;
    }
    if (receipt.action === "expand") sceneCalls += 1;
    else if (receipt.action === "define_batch") termBatches += 1;
  }

  return { sceneCalls, termBatches };
}

/**
 * Calculate the unused hard allowance for one profile.
 */
export function remainingPrefetchBudget(profile, consumed = {}) {
  const parsedProfile = parsePrefetchProfile(profile);
  if (!consumed || typeof consumed !== "object" || Array.isArray(consumed)) {
    throw new TypeError("consumed must be an object");
  }
  const limits = PREFETCH_PROFILE_LIMITS[parsedProfile];
  const sceneCalls = nonNegativeInteger(
    consumed.sceneCalls ?? 0,
    "consumed.sceneCalls",
  );
  const termBatches = nonNegativeInteger(
    consumed.termBatches ?? 0,
    "consumed.termBatches",
  );

  return {
    sceneCalls: Math.max(0, limits.sceneCalls - sceneCalls),
    termBatches: Math.max(0, limits.termBatches - termBatches),
  };
}

/**
 * Trim only the caller-provided one-layer scene queue and term-batch list.
 *
 * `consumed` represents already reserved or otherwise spent calls that do not
 * yet have a persisted receipt, such as in-flight background work. It is added
 * to matching receipt counts to prevent concurrent callers from oversubscribing
 * the frontier budget.
 *
 * @template TScene
 * @template TTermBatch
 * @param {{
 *   profile?: string,
 *   frontierKey?: string,
 *   sceneQueue?: TScene[],
 *   termBatches?: TTermBatch[],
 *   receipts?: object[],
 *   consumed?: { sceneCalls?: number, termBatches?: number }
 * }} input
 * @returns {{
 *   profile: string,
 *   frontierKey: string,
 *   limits: { sceneCalls: number, termBatches: number },
 *   consumed: { sceneCalls: number, termBatches: number },
 *   remaining: { sceneCalls: number, termBatches: number },
 *   sceneQueue: TScene[],
 *   termBatches: TTermBatch[]
 * }}
 */
export function buildPrefetchPlan(input) {
  const {
    profile,
    frontierKey,
    sceneQueue = [],
    termBatches = [],
    receipts = [],
    consumed = {},
  } = input ?? {};
  if (!Array.isArray(sceneQueue)) {
    throw new TypeError("sceneQueue must be an array");
  }
  if (!Array.isArray(termBatches)) {
    throw new TypeError("termBatches must be an array");
  }
  if (!consumed || typeof consumed !== "object" || Array.isArray(consumed)) {
    throw new TypeError("consumed must be an object");
  }

  const parsedProfile = parsePrefetchProfile(profile);
  const requestedFrontierKey = requiredString(frontierKey, "frontierKey");
  const receiptCounts = countPrefetchReceipts(receipts, requestedFrontierKey);
  const totalConsumed = {
    sceneCalls:
      receiptCounts.sceneCalls +
      nonNegativeInteger(consumed.sceneCalls ?? 0, "consumed.sceneCalls"),
    termBatches:
      receiptCounts.termBatches +
      nonNegativeInteger(consumed.termBatches ?? 0, "consumed.termBatches"),
  };
  const limits = PREFETCH_PROFILE_LIMITS[parsedProfile];
  const remaining = remainingPrefetchBudget(parsedProfile, totalConsumed);

  return {
    profile: parsedProfile,
    frontierKey: requestedFrontierKey,
    limits: { ...limits },
    consumed: totalConsumed,
    remaining,
    sceneQueue: sceneQueue.slice(0, remaining.sceneCalls),
    termBatches: termBatches.slice(0, remaining.termBatches),
  };
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value.map((item, index) =>
    requiredString(item, `${label}[${index}]`),
  );
}

function fingerprintValues(values) {
  const serialized = values.map((value) => `${value.length}:${value}`).join("|");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of serialized) {
    const codePoint = character.codePointAt(0) ?? 0;
    first ^= codePoint;
    first = Math.imul(first, 0x01000193);
    second ^= codePoint;
    second = Math.imul(second, 0x5bd1e995);
    second ^= second >>> 13;
  }
  first ^= first >>> 16;
  first = Math.imul(first, 0x85ebca6b);
  first ^= first >>> 13;
  second ^= second >>> 16;
  second = Math.imul(second, 0xc2b2ae35);
  second ^= second >>> 16;
  return `${unsignedHex(first)}${unsignedHex(second)}`;
}

function unsignedHex(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

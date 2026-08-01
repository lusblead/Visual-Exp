const KEY_PROTOCOL = "deep-reading-cache/1";
const DOCUMENT_PROTOCOL = "visual-explanation-document/2";
const TERM_PROTOCOL = "visual-term-explanation/2";
const DEEP_PROTOCOL = "visual-deep-explanation/1";

const DEFAULT_MAX_ENTRIES = 32;
const MAX_CONFIGURED_ENTRIES = 256;
const MAX_KEY_LENGTH = 8_192;
const MAX_ID_LENGTH = 512;
const MAX_NODE_TEXT_LENGTH = 12_000;
const MAX_SUBJECT_LENGTH = 600;

/**
 * Build a stable identity for a deep-reading request.
 *
 * Document version is deliberately excluded: expanding an unrelated branch
 * must not invalidate a result derived from unchanged trusted content.
 */
export function deepReadingCacheKey(
  document,
  node,
  subject,
  parentContext = {},
) {
  assertRecord(document, "document");
  assertRecord(node, "node");
  const context = strictRecord(
    parentContext,
    "parentContext",
    new Set(["parentTermExplanation", "parentDeepExplanation"]),
  );
  const { parentTermExplanation, parentDeepExplanation } = context;

  if (document.protocol !== DOCUMENT_PROTOCOL) {
    throw new TypeError(`document.protocol must be ${DOCUMENT_PROTOCOL}`);
  }
  const documentId = boundedString(document.id, "document.id", MAX_ID_LENGTH);
  const nodeId = boundedString(node.id, "node.id", MAX_ID_LENGTH);
  const normalizedSubject = normalizeSubject(subject);
  const nodeContent = [
    boundedString(node.title, "node.title", MAX_NODE_TEXT_LENGTH),
    boundedString(node.summary, "node.summary", MAX_NODE_TEXT_LENGTH),
    stringWithin(node.detail, "node.detail", MAX_NODE_TEXT_LENGTH),
  ];

  if (parentTermExplanation !== undefined && parentDeepExplanation !== undefined) {
    throw new TypeError(
      "parentTermExplanation and parentDeepExplanation are mutually exclusive",
    );
  }

  const parentIdentity =
    parentTermExplanation !== undefined
      ? canonicalTermParent(parentTermExplanation, nodeId)
      : parentDeepExplanation !== undefined
        ? canonicalDeepParent(parentDeepExplanation, nodeId)
        : ["node"];

  return [
    KEY_PROTOCOL,
    encodeURIComponent(document.protocol),
    encodeURIComponent(documentId),
    encodeURIComponent(nodeId),
    encodeURIComponent(normalizedSubject),
    fingerprintCanonical(["node", ...nodeContent]),
    fingerprintCanonical(parentIdentity),
  ].join(":");
}

/**
 * Create a bounded, synchronous store for keyed deep-reading tasks.
 *
 * `activate` changes only the visible projection. Pending work belongs to its
 * cache key and remains alive when another key becomes active.
 */
export function createDeepReadingStore(options = {}) {
  assertOptions(options);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > MAX_CONFIGURED_ENTRIES
  ) {
    throw new RangeError(
      `maxEntries must be an integer between 1 and ${MAX_CONFIGURED_ENTRIES}`,
    );
  }

  const entries = new Map();
  let activeKey = null;
  let clock = 0;

  function nextTick() {
    clock += 1;
    return clock;
  }

  function activate(key, metadata = undefined) {
    const normalizedKey = validKey(key);
    const normalizedMetadata =
      metadata === undefined ? undefined : copyMetadata(metadata);
    const existing = entries.get(normalizedKey);
    activeKey = normalizedKey;

    if (existing) {
      existing.lastAccessedAt = nextTick();
      if (normalizedMetadata !== undefined) {
        existing.metadata = normalizedMetadata;
      }
      prune();
      return false;
    }

    const tick = nextTick();
    entries.set(normalizedKey, {
      key: normalizedKey,
      status: "pending",
      generation: null,
      metadata: normalizedMetadata ?? Object.freeze({}),
      createdAt: tick,
      lastAccessedAt: tick,
      settledAt: null,
    });
    prune();
    return true;
  }

  function begin(key, generation) {
    const normalizedKey = validKey(key);
    const normalizedGeneration = validGeneration(generation);
    const entry = entries.get(normalizedKey);
    if (!entry) {
      throw new Error("begin requires an activated cache entry");
    }

    if (entry.status === "pending") {
      if (entry.generation === normalizedGeneration) return false;
      if (entry.generation !== null) {
        throw new Error("a pending cache entry already owns another generation");
      }
    } else if (entry.status === "success") {
      throw new Error("a successful cache entry cannot begin again");
    }

    entry.status = "pending";
    entry.generation = normalizedGeneration;
    entry.lastAccessedAt = nextTick();
    entry.settledAt = null;
    delete entry.value;
    delete entry.error;
    return true;
  }

  function succeed(key, generation, value) {
    const normalizedKey = validKey(key);
    const normalizedGeneration = validGeneration(generation);
    assertRecord(value, "value");
    const entry = entries.get(normalizedKey);
    if (
      !entry ||
      entry.status !== "pending" ||
      entry.generation !== normalizedGeneration
    ) {
      return false;
    }

    const tick = nextTick();
    entry.status = "success";
    entry.value = value;
    entry.lastAccessedAt = tick;
    entry.settledAt = tick;
    delete entry.error;
    prune();
    return true;
  }

  function fail(key, generation, error) {
    const normalizedKey = validKey(key);
    const normalizedGeneration = validGeneration(generation);
    const normalizedError = errorMessage(error);
    const entry = entries.get(normalizedKey);
    if (
      !entry ||
      entry.status !== "pending" ||
      entry.generation !== normalizedGeneration
    ) {
      return false;
    }

    const tick = nextTick();
    entry.status = "error";
    entry.error = normalizedError;
    entry.lastAccessedAt = tick;
    entry.settledAt = tick;
    delete entry.value;
    prune();
    return true;
  }

  function hide() {
    activeKey = null;
    prune();
  }

  function reset() {
    activeKey = null;
    entries.clear();
    clock = 0;
  }

  function get(key) {
    return snapshotEntry(entries.get(validKey(key)));
  }

  function getActive() {
    return activeKey === null ? null : snapshotEntry(entries.get(activeKey));
  }

  function snapshot() {
    return Object.freeze({
      activeKey,
      entries: Object.freeze(
        Array.from(entries.values(), (entry) => snapshotEntry(entry)),
      ),
    });
  }

  function prune() {
    while (entries.size > maxEntries) {
      const candidate = Array.from(entries.values())
        .filter(
          (entry) =>
            entry.key !== activeKey &&
            (entry.status === "success" || entry.status === "error"),
        )
        .sort(
          (left, right) =>
            left.lastAccessedAt - right.lastAccessedAt ||
            left.createdAt - right.createdAt ||
            left.key.localeCompare(right.key),
        )[0];

      // Pending work and the active projection are never evicted. The store may
      // therefore exceed its settled-entry bound temporarily under heavy work.
      if (!candidate) return;
      entries.delete(candidate.key);
    }
  }

  return Object.freeze({
    activate,
    begin,
    succeed,
    fail,
    hide,
    reset,
    get,
    getActive,
    snapshot,
    get activeKey() {
      return activeKey;
    },
    get size() {
      return entries.size;
    },
    get maxEntries() {
      return maxEntries;
    },
  });
}

function canonicalTermParent(value, expectedNodeId) {
  const allowed = new Set([
    "protocol",
    "term",
    "termPath",
    "nodeId",
    "definition",
    "relevance",
    "terms",
    "confidence",
    "sourceStatus",
  ]);
  const parent = strictRecord(value, "parentTermExplanation", allowed);
  if (parent.protocol !== TERM_PROTOCOL) {
    throw new TypeError(`parentTermExplanation.protocol must be ${TERM_PROTOCOL}`);
  }
  const nodeId = boundedString(
    parent.nodeId,
    "parentTermExplanation.nodeId",
    MAX_ID_LENGTH,
  );
  if (nodeId !== expectedNodeId) {
    throw new TypeError("parentTermExplanation must belong to node.id");
  }

  return [
    "term",
    parent.protocol,
    boundedString(parent.term, "parentTermExplanation.term", 40),
    stringArray(parent.termPath, "parentTermExplanation.termPath", 4, 40),
    nodeId,
    boundedString(parent.definition, "parentTermExplanation.definition", 500),
    boundedString(parent.relevance, "parentTermExplanation.relevance", 500),
    stringArray(parent.terms, "parentTermExplanation.terms", 4, 40),
    confidence(parent.confidence, "parentTermExplanation.confidence"),
    sourceStatus(parent.sourceStatus, "parentTermExplanation.sourceStatus"),
  ];
}

function canonicalDeepParent(value, expectedNodeId) {
  const allowed = new Set([
    "protocol",
    "subject",
    "nodeId",
    "directAnswer",
    "background",
    "role",
    "mechanism",
    "boundary",
    "terms",
    "confidence",
    "sourceStatus",
  ]);
  const parent = strictRecord(value, "parentDeepExplanation", allowed);
  if (parent.protocol !== DEEP_PROTOCOL) {
    throw new TypeError(`parentDeepExplanation.protocol must be ${DEEP_PROTOCOL}`);
  }
  const nodeId = boundedString(
    parent.nodeId,
    "parentDeepExplanation.nodeId",
    MAX_ID_LENGTH,
  );
  if (nodeId !== expectedNodeId) {
    throw new TypeError("parentDeepExplanation must belong to node.id");
  }

  return [
    "deep",
    parent.protocol,
    boundedString(parent.subject, "parentDeepExplanation.subject", 600),
    nodeId,
    boundedString(parent.directAnswer, "parentDeepExplanation.directAnswer", 400),
    boundedString(parent.background, "parentDeepExplanation.background", 600),
    boundedString(parent.role, "parentDeepExplanation.role", 600),
    boundedString(parent.mechanism, "parentDeepExplanation.mechanism", 900),
    boundedString(parent.boundary, "parentDeepExplanation.boundary", 500),
    stringArray(parent.terms, "parentDeepExplanation.terms", 8, 40),
    confidence(parent.confidence, "parentDeepExplanation.confidence"),
    sourceStatus(parent.sourceStatus, "parentDeepExplanation.sourceStatus"),
  ];
}

function normalizeSubject(value) {
  const subject = boundedString(value, "subject", MAX_SUBJECT_LENGTH);
  return subject
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
}

function fingerprintCanonical(value) {
  const serialized = JSON.stringify(value);
  return `${fnv64(serialized, 0xcbf29ce484222325n)}${fnv64(
    serialized,
    0x84222325cbf29ce4n,
  )}`;
}

function fnv64(value, offset) {
  let hash = offset;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function snapshotEntry(entry) {
  if (!entry) return null;
  const snapshot = {
    key: entry.key,
    status: entry.status,
    generation: entry.generation,
    metadata: Object.freeze({ ...entry.metadata }),
    createdAt: entry.createdAt,
    lastAccessedAt: entry.lastAccessedAt,
    settledAt: entry.settledAt,
  };
  if (entry.status === "success") snapshot.value = entry.value;
  if (entry.status === "error") snapshot.error = entry.error;
  return Object.freeze(snapshot);
}

function validKey(value) {
  return boundedString(value, "key", MAX_KEY_LENGTH);
}

function validGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("generation must be a positive safe integer");
  }
  return value;
}

function errorMessage(value) {
  if (value instanceof Error) {
    return boundedString(value.message, "error.message", 2_000);
  }
  return boundedString(value, "error", 2_000);
}

function confidence(value, path) {
  if (value === "high" || value === "medium" || value === "low") return value;
  throw new TypeError(`${path} is invalid`);
}

function sourceStatus(value, path) {
  if (
    value === "source_backed" ||
    value === "model_knowledge" ||
    value === "needs_source"
  ) {
    return value;
  }
  throw new TypeError(`${path} is invalid`);
}

function stringArray(value, path, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${path} must be an array with at most ${maximumItems} items`);
  }
  return value.map((item, index) =>
    boundedString(item, `${path}[${index}]`, maximumLength),
  );
}

function boundedString(value, path, maximum) {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${path} must not be empty`);
  if (Array.from(normalized).length > maximum) {
    throw new RangeError(`${path} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function stringWithin(value, path, maximum) {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
  if (Array.from(value).length > maximum) {
    throw new RangeError(`${path} must not exceed ${maximum} characters`);
  }
  return value;
}

function assertRecord(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function strictRecord(value, path, allowed) {
  assertRecord(value, path);
  const record = value;
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
  }
  return record;
}

function copyMetadata(value) {
  assertRecord(value, "metadata");
  return Object.freeze({ ...value });
}

function assertOptions(value) {
  assertRecord(value, "options");
  for (const key of Object.keys(value)) {
    if (key !== "maxEntries") throw new TypeError(`options.${key} is not allowed`);
  }
}

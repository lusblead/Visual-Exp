const DEFAULT_MAX_ENTRIES = 48;
const MAX_CONFIGURED_ENTRIES = 256;
const MAX_KEY_LENGTH = 8_192;
const MAX_ERROR_LENGTH = 2_000;

/**
 * Create a bounded synchronous store for independently visible explanation
 * cards and their keyed asynchronous tasks.
 *
 * Visibility is deliberately separate from task and cache lifetime:
 * `dismiss` never cancels pending work or deletes a settled result.
 */
export function createExplanationTaskStore(options = {}) {
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
  let visibleKeys = [];
  let clock = 0;

  function nextTick() {
    clock += 1;
    return clock;
  }

  /**
   * Reveal one card, creating a request shell only when the identity is absent.
   *
   * @returns {boolean} true when a new request must be started, otherwise false
   */
  function reveal(key, metadata = undefined) {
    const normalizedKey = validKey(key);
    const normalizedMetadata =
      metadata === undefined ? undefined : copyMetadata(metadata);
    const existing = entries.get(normalizedKey);

    visibleKeys = [
      ...visibleKeys.filter((candidate) => candidate !== normalizedKey),
      normalizedKey,
    ];

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

  /**
   * Claim an absent or explicitly retried task for one generation.
   *
   * Repeating the same generation is an idempotent no-op. A different
   * generation cannot replace work that is already pending.
   */
  function begin(key, generation) {
    const normalizedKey = validKey(key);
    const normalizedGeneration = validGeneration(generation);
    const entry = entries.get(normalizedKey);
    if (!entry) {
      throw new Error("begin requires a revealed cache entry");
    }

    if (entry.status === "pending") {
      if (entry.generation === normalizedGeneration) return false;
      if (entry.generation !== null) {
        throw new Error("a pending cache entry already owns another generation");
      }
    } else if (entry.status === "ready") {
      throw new Error("a ready cache entry cannot begin again");
    }

    entry.status = "pending";
    entry.generation = normalizedGeneration;
    entry.lastAccessedAt = nextTick();
    entry.settledAt = null;
    delete entry.value;
    delete entry.error;
    return true;
  }

  /**
   * Settle a task successfully only when its generation still owns the key.
   */
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
    entry.status = "ready";
    entry.value = value;
    entry.lastAccessedAt = tick;
    entry.settledAt = tick;
    delete entry.error;
    prune();
    return true;
  }

  /**
   * Settle a task as an error only when its generation still owns the key.
   */
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

  /**
   * Hide one card without changing its cached entry or task ownership.
   */
  function dismiss(key) {
    const normalizedKey = validKey(key);
    const wasVisible = visibleKeys.includes(normalizedKey);
    if (wasVisible) {
      visibleKeys = visibleKeys.filter(
        (candidate) => candidate !== normalizedKey,
      );
    }
    prune();
    return wasVisible;
  }

  /**
   * Hide every card while preserving all pending and cached entries.
   */
  function dismissAll() {
    const changed = visibleKeys.length > 0;
    visibleKeys = [];
    prune();
    return changed;
  }

  /**
   * Invalidate the complete document-scoped store.
   *
   * Callers own AbortControllers; after reset, their late completions are
   * rejected because the corresponding generation no longer owns an entry.
   */
  function reset() {
    visibleKeys = [];
    entries.clear();
    clock = 0;
  }

  function get(key) {
    return snapshotEntry(entries.get(validKey(key)));
  }

  function getVisible() {
    return Object.freeze(
      visibleKeys
        .map((key) => snapshotEntry(entries.get(key)))
        .filter((entry) => entry !== null),
    );
  }

  function snapshot() {
    return Object.freeze({
      visibleKeys: Object.freeze([...visibleKeys]),
      entries: Object.freeze(
        Array.from(entries.values(), (entry) => snapshotEntry(entry)),
      ),
    });
  }

  function prune() {
    const visible = new Set(visibleKeys);
    while (entries.size > maxEntries) {
      const candidate = Array.from(entries.values())
        .filter(
          (entry) => entry.status !== "pending" && !visible.has(entry.key),
        )
        .sort(
          (left, right) =>
            left.lastAccessedAt - right.lastAccessedAt ||
            left.createdAt - right.createdAt ||
            left.key.localeCompare(right.key),
        )[0];

      // Pending tasks and visible cards are protected. Capacity is therefore a
      // settled hidden-entry target, not permission to destroy active work.
      if (!candidate) return;
      entries.delete(candidate.key);
    }
  }

  return Object.freeze({
    reveal,
    begin,
    succeed,
    fail,
    dismiss,
    dismissAll,
    reset,
    get,
    getVisible,
    snapshot,
    get visibleKeys() {
      return Object.freeze([...visibleKeys]);
    },
    get size() {
      return entries.size;
    },
    get maxEntries() {
      return maxEntries;
    },
  });
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
  if (entry.status === "ready") snapshot.value = entry.value;
  if (entry.status === "error") snapshot.error = entry.error;
  return Object.freeze(snapshot);
}

function assertOptions(value) {
  assertRecord(value, "options");
  const allowed = new Set(["maxEntries"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`options.${key} is not allowed`);
    }
  }
}

function copyMetadata(value) {
  assertRecord(value, "metadata");
  return Object.freeze({ ...value });
}

function assertRecord(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${path} must be an object`);
  }
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
    return boundedString(value.message, "error.message", MAX_ERROR_LENGTH);
  }
  return boundedString(value, "error", MAX_ERROR_LENGTH);
}

function boundedString(value, path, maximumLength) {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${path} must not be empty`);
  }
  if (normalized.length > maximumLength) {
    throw new TypeError(`${path} is too long`);
  }
  return normalized;
}

import { normalizeTermIdentity } from "./visual-content-quality.ts";

const DEFAULT_PREFETCH_LIMIT = Number.MAX_SAFE_INTEGER;
const KEY_PREFIX = "term-definition:v2";

/**
 * Build a stable cache identity for one annotated term.
 *
 * The identity deliberately excludes the document version: expanding an
 * unrelated branch must not invalidate an unchanged node's definition.
 *
 * @param {{ id: string }} document
 * @param {{ id: string, title: string, summary: string, detail: string }} node
 * @param {string} term
 * @returns {string}
 */
export function termExplanationCacheKey(document, node, term) {
  const documentId = requiredString(document?.id, "document.id");
  const nodeId = requiredString(node?.id, "node.id");
  const normalizedTerm = normalizeTermIdentity(requiredString(term, "term"));
  if (!normalizedTerm) throw new TypeError("term must not be empty");

  return [
    KEY_PREFIX,
    encodeURIComponent(documentId),
    encodeURIComponent(nodeId),
    encodeURIComponent(normalizedTerm),
    fingerprintNodeContent(node),
  ].join(":");
}

/**
 * Nested definitions are scoped to the exact validated parent explanation.
 * This prevents a same-named term from reusing an explanation produced from a
 * different definition chain.
 *
 * @param {{ id: string }} document
 * @param {{ id: string }} node
 * @param {string} term
 * @param {{ term?: string, definition?: string, relevance?: string, termPath?: string[] }} parent
 */
export function nestedTermExplanationCacheKey(document, node, term, parent) {
  const base = termExplanationCacheKey(
    document,
    {
      ...node,
      title: requiredString(parent?.term, "parent.term"),
      summary: requiredString(parent?.definition, "parent.definition"),
      detail: requiredString(parent?.relevance, "parent.relevance"),
    },
    term,
  );
  const path = Array.isArray(parent?.termPath)
    ? parent.termPath.map((item) => requiredString(item, "parent.termPath item"))
    : [];
  return `${base}:parent:${fingerprintValues(path)}`;
}

/**
 * Deep-reading terms are scoped to the exact validated deep explanation that
 * exposed them. Keep this identity beside the other term cache protocols so
 * persistence and the interactive runtime cannot drift.
 *
 * @param {{ id: string }} document
 * @param {{ id: string }} node
 * @param {string} term
 * @param {{
 *   protocol: string,
 *   subject: string,
 *   nodeId: string,
 *   directAnswer: string,
 *   background: string,
 *   role: string,
 *   mechanism: string,
 *   boundary: string,
 *   terms: string[],
 * }} parent
 */
export function deepTermExplanationCacheKey(
  document,
  node,
  term,
  parent,
) {
  const normalizedTerm = term
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .trim();
  const context = [
    parent.protocol,
    parent.subject,
    parent.nodeId,
    parent.directAnswer,
    parent.background,
    parent.role,
    parent.mechanism,
    parent.boundary,
    parent.terms.join("\u001f"),
  ].join("\u001e");
  return [
    "deep-term-definition:v1",
    encodeURIComponent(document.id),
    encodeURIComponent(node.id),
    encodeURIComponent(normalizedTerm),
    fingerprintDeepTermContext(context),
  ].join(":");
}

/**
 * Rank annotated terms from the nodes that already exist in the current
 * document. No ungenerated child or blueprint content is considered.
 *
 * @param {{ id?: string, nodes?: unknown[] } | null | undefined} document
 * @param {{
 *   cachedKeys?: Iterable<string> | Record<string, unknown>,
 *   inFlightKeys?: Iterable<string> | Record<string, unknown>,
 *   failedKeys?: Iterable<string> | Record<string, unknown>,
 *   excludedKeys?: Iterable<string> | Record<string, unknown>,
 *   includedNodeIds?: Iterable<string>,
 *   limit?: number,
 * }} [options]
 * @returns {Array<{
 *   key: string,
 *   documentId: string,
 *   nodeId: string,
 *   term: string,
 *   normalizedTerm: string,
 *   depth: number,
 *   frequency: number,
 * }>}
 */
export function buildTermPrefetchQueue(document, options = {}) {
  if (
    !document ||
    typeof document.id !== "string" ||
    !document.id.trim() ||
    !Array.isArray(document.nodes)
  ) {
    return [];
  }

  const excluded = new Set();
  addKeys(excluded, options.cachedKeys);
  addKeys(excluded, options.inFlightKeys);
  addKeys(excluded, options.failedKeys);
  addKeys(excluded, options.excludedKeys);

  const includedNodeIds = normalizeIncludedNodeIds(options.includedNodeIds);
  const includedRank = new Map(
    includedNodeIds?.map((nodeId, index) => [nodeId, index]) ?? [],
  );
  const eligibleNodes = document.nodes.filter(
    (node) =>
      hasPrefetchableBody(node) &&
      (includedNodeIds === null || includedRank.has(node.id)),
  );
  const bodies = eligibleNodes
    .flatMap((node) => [node.title, node.summary, node.detail])
    .map(normalizeSearchText);
  const seen = new Set(excluded);
  const candidates = [];

  for (const [nodeIndex, node] of document.nodes.entries()) {
    if (
      !hasPrefetchableBody(node) ||
      !Number.isInteger(node.depth) ||
      node.depth < 0 ||
      !Array.isArray(node.terms) ||
      (includedNodeIds !== null && !includedRank.has(node.id))
    ) {
      continue;
    }

    const nodeBodies = [node.title, node.summary, node.detail].map(
      normalizeSearchText,
    );
    for (const [termIndex, value] of node.terms.entries()) {
      if (typeof value !== "string") continue;
      const term = value.trim();
      const normalizedTerm = normalizeTermIdentity(term);
      if (!normalizedTerm) continue;

      const normalizedSearchTerm = normalizeSearchText(term);
      if (
        !normalizedSearchTerm ||
        countOccurrences(nodeBodies, normalizedSearchTerm) === 0
      ) {
        continue;
      }

      const key = termExplanationCacheKey(document, node, term);
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        key,
        documentId: document.id,
        nodeId: node.id,
        term,
        normalizedTerm,
        depth: node.depth,
        frequency: countOccurrences(bodies, normalizedSearchTerm),
        nodeIndex,
        nodeRank: includedRank.get(node.id) ?? node.depth,
        termIndex,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.depth - right.depth ||
      left.nodeRank - right.nodeRank ||
      right.frequency - left.frequency ||
      left.nodeIndex - right.nodeIndex ||
      left.termIndex - right.termIndex,
  );

  const limit = normalizeLimit(options.limit);
  return candidates.slice(0, limit).map((item) => ({
    key: item.key,
    documentId: item.documentId,
    nodeId: item.nodeId,
    term: item.term,
    normalizedTerm: item.normalizedTerm,
    depth: item.depth,
    frequency: item.frequency,
  }));
}

/**
 * Group a current-layer queue into one bounded Flash request per semantic node.
 * Node order and term order are inherited from buildTermPrefetchQueue.
 *
 * @param {Parameters<typeof buildTermPrefetchQueue>[0]} document
 * @param {Parameters<typeof buildTermPrefetchQueue>[1]} options
 */
export function buildTermPrefetchBatches(document, options = {}) {
  const queue = buildTermPrefetchQueue(document, options);
  const batches = [];
  const byNode = new Map();
  for (const item of queue) {
    let batch = byNode.get(item.nodeId);
    if (!batch) {
      batch = { nodeId: item.nodeId, items: [] };
      byNode.set(item.nodeId, batch);
      batches.push(batch);
    }
    if (batch.items.length < 8) batch.items.push(item);
  }
  return batches;
}

function hasPrefetchableBody(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    typeof node.id === "string" &&
    node.id.trim().length > 0 &&
    typeof node.title === "string" &&
    typeof node.summary === "string" &&
    typeof node.detail === "string"
  );
}

function normalizeSearchText(value) {
  return normalizeTermIdentity(value);
}

function countOccurrences(bodies, term) {
  let count = 0;
  for (const body of bodies) {
    let offset = 0;
    while (offset <= body.length - term.length) {
      const index = body.indexOf(term, offset);
      if (index < 0) break;
      const before = index > 0 ? body[index - 1] : "";
      const after = body[index + term.length] ?? "";
      const leftBoundary = !isAsciiWord(term[0]) || !isAsciiWord(before);
      const rightBoundary =
        !isAsciiWord(term[term.length - 1]) || !isAsciiWord(after);
      if (leftBoundary && rightBoundary) count += 1;
      offset = index + Math.max(1, term.length);
    }
  }
  return count;
}

function isAsciiWord(value) {
  return typeof value === "string" && /^[a-z0-9_]$/u.test(value);
}

function normalizeLimit(value) {
  if (value === undefined) return DEFAULT_PREFETCH_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_PREFETCH_LIMIT;
  return Math.max(0, Math.floor(value));
}

function normalizeIncludedNodeIds(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value[Symbol.iterator] !== "function") return [];
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || seen.has(item.trim())) continue;
    const nodeId = item.trim();
    seen.add(nodeId);
    ids.push(nodeId);
  }
  return ids;
}

function addKeys(target, source) {
  if (!source) return;
  if (typeof source === "string") {
    target.add(source);
    return;
  }
  if (typeof source[Symbol.iterator] === "function") {
    for (const value of source) {
      target.add(Array.isArray(value) ? value[0] : value);
    }
    return;
  }
  if (typeof source === "object") {
    for (const key of Object.keys(source)) target.add(key);
  }
}

function fingerprintNodeContent(node) {
  return fingerprintValues([node.title, node.summary, node.detail]);
}

function fingerprintValues(values) {
  const serialized = values
    .map((value) => `${value.length}:${value}`)
    .join("|");
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

function fingerprintDeepTermContext(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unsignedHex(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

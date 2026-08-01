const KEY_PREFIX = "scene-preparation:v1";
const MAX_DOCUMENT_NODES = 80;
const MAX_DOCUMENT_DEPTH = 12;

/**
 * A failed background expansion is tied to the selected node's trusted body,
 * not the document version. Expanding an unrelated sibling therefore does not
 * create a retry storm, while a real content change permits another attempt.
 */
export function scenePreparationKey(document, node) {
  return [
    KEY_PREFIX,
    encodeURIComponent(requiredString(document?.id, "document.id")),
    encodeURIComponent(requiredString(node?.id, "node.id")),
    fingerprintValues([
      requiredString(node?.title, "node.title"),
      requiredString(node?.summary, "node.summary"),
      requiredString(node?.detail, "node.detail"),
    ]),
  ].join(":");
}

/**
 * Return only the active scene's direct, expandable, unprepared entrances in
 * their canonical childIds order. The caller performs at most one request and
 * rebuilds this queue from the newly accepted document before continuing.
 */
export function buildScenePrefetchQueue(document, activeNodeId, options = {}) {
  if (
    !document ||
    typeof document.id !== "string" ||
    !Array.isArray(document.nodes) ||
    document.nodes.length > MAX_DOCUMENT_NODES ||
    MAX_DOCUMENT_NODES - document.nodes.length < 3
  ) {
    return [];
  }

  const nodesById = new Map(
    document.nodes
      .filter((node) => node && typeof node.id === "string")
      .map((node) => [node.id, node]),
  );
  const active = nodesById.get(activeNodeId);
  if (!active || !Array.isArray(active.childIds)) return [];

  const excluded = new Set();
  addKeys(excluded, options.failedKeys);
  addKeys(excluded, options.inFlightKeys);
  addKeys(excluded, options.excludedKeys);

  const queue = [];
  for (const nodeId of active.childIds) {
    const node = nodesById.get(nodeId);
    if (!isEligibleDirectEntrance(node, active.id)) continue;
    const key = scenePreparationKey(document, node);
    if (excluded.has(key)) continue;
    queue.push({
      key,
      documentId: document.id,
      nodeId: node.id,
      parentId: active.id,
      depth: node.depth,
    });
  }

  const limit = normalizeLimit(options.limit);
  return queue.slice(0, limit);
}

function isEligibleDirectEntrance(node, parentId) {
  return Boolean(
    node &&
      node.parentId === parentId &&
      Number.isInteger(node.depth) &&
      node.depth >= 0 &&
      node.depth < MAX_DOCUMENT_DEPTH &&
      node.expandable === true &&
      node.expansionState !== "terminal" &&
      Array.isArray(node.childIds) &&
      node.childIds.length === 0 &&
      typeof node.title === "string" &&
      typeof node.summary === "string" &&
      typeof node.detail === "string",
  );
}

function normalizeLimit(value) {
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(value));
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

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

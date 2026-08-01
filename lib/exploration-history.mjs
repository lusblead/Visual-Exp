/**
 * @typedef {{ entries: string[], cursor: number }} ExplorationHistory
 */

/**
 * @param {string} rootId
 * @returns {ExplorationHistory}
 */
export function createExplorationHistory(rootId) {
  return { entries: [rootId], cursor: 0 };
}

/**
 * @param {ExplorationHistory} history
 * @param {string} nodeId
 * @returns {ExplorationHistory}
 */
export function pushExplorationHistory(history, nodeId) {
  if (history.entries[history.cursor] === nodeId) return history;
  const entries = [...history.entries.slice(0, history.cursor + 1), nodeId].slice(-60);
  return { entries, cursor: entries.length - 1 };
}

/**
 * @param {ExplorationHistory} history
 * @param {-1 | 1} delta
 * @returns {ExplorationHistory}
 */
export function moveExplorationHistory(history, delta) {
  const cursor = Math.max(0, Math.min(history.entries.length - 1, history.cursor + delta));
  return cursor === history.cursor ? history : { ...history, cursor };
}

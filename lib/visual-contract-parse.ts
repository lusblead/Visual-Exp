import {
  CONFIDENCE_LEVELS,
  EMPHASIS_LEVELS,
  EXPANSION_STATES,
  EXPLANATION_VIEWS,
  SOURCE_STATUSES,
  VISUAL_NODE_KINDS,
  VISUAL_RELATION_KINDS,
  type VisualDocument,
  type VisualEvidence,
  type VisualNode,
  type VisualNodePatch,
  type VisualRelation,
} from "./visual-contract-types";
import { assertVisualNodeTerms } from "./visual-content-quality";
import { parsePrimaryMaterial } from "./primary-material";

export function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

export function stringValue(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${path} 必须是${allowEmpty ? "" : "非空"}字符串`);
  }
  return value.trim();
}

export function nullableStringValue(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path, true);
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值`);
  return value;
}

export function nullableBooleanValue(value: unknown, path: string): boolean | null {
  if (value === null) return null;
  return booleanValue(value, path);
}

export function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
  const result = value.map((item, index) => stringValue(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${path} 不能包含重复值`);
  return result;
}

export function oneOf<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${path} 不是受支持的值`);
  }
  return value as T;
}

export function nullableOneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T | null {
  if (value === null) return null;
  return oneOf(value, choices, path);
}

export function integer(value: unknown, path: string, min: number, max?: number): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (max !== undefined && (value as number) > max)
  ) {
    throw new Error(`${path} 必须是 ${min}${max === undefined ? " 以上" : ` 到 ${max}`} 的整数`);
  }
  return value as number;
}

export function parseEvidence(value: unknown, path: string): VisualEvidence {
  const item = record(value, path);
  const url = item.url;
  if (url !== null && typeof url !== "string") {
    throw new Error(`${path}.url 必须是字符串或 null`);
  }
  return {
    label: stringValue(item.label, `${path}.label`),
    detail: stringValue(item.detail, `${path}.detail`),
    url: typeof url === "string" ? url.trim() : null,
  };
}

export function parseNode(value: unknown, path: string): VisualNode {
  const node = record(value, path);
  if (!Array.isArray(node.evidence)) throw new Error(`${path}.evidence 必须是数组`);
  const parentId = node.parentId;
  if (parentId !== null && typeof parentId !== "string") {
    throw new Error(`${path}.parentId 必须是字符串或 null`);
  }
  const parsed: VisualNode = {
    id: stringValue(node.id, `${path}.id`),
    parentId: typeof parentId === "string" ? stringValue(parentId, `${path}.parentId`) : null,
    title: stringValue(node.title, `${path}.title`),
    eyebrow: stringValue(node.eyebrow, `${path}.eyebrow`, true),
    summary: stringValue(node.summary, `${path}.summary`),
    detail: stringValue(node.detail, `${path}.detail`, true),
    // Compatibility migration: documents created before body-term annotations
    // did not carry this field. Canonical documents always serialize it.
    terms: node.terms === undefined ? [] : stringArray(node.terms, `${path}.terms`),
    kind: oneOf(node.kind, VISUAL_NODE_KINDS, `${path}.kind`),
    view: oneOf(node.view, EXPLANATION_VIEWS, `${path}.view`),
    depth: integer(node.depth, `${path}.depth`, 0, 12),
    childIds: stringArray(node.childIds, `${path}.childIds`),
    expandable: booleanValue(node.expandable, `${path}.expandable`),
    expansionState: oneOf(node.expansionState, EXPANSION_STATES, `${path}.expansionState`),
    emphasis: oneOf(node.emphasis, EMPHASIS_LEVELS, `${path}.emphasis`),
    confidence: oneOf(node.confidence, CONFIDENCE_LEVELS, `${path}.confidence`),
    sourceStatus: oneOf(node.sourceStatus, SOURCE_STATUSES, `${path}.sourceStatus`),
    evidence: node.evidence.map((item, index) =>
      parseEvidence(item, `${path}.evidence[${index}]`),
    ),
  };
  assertVisualNodeTerms(parsed);
  return parsed;
}

export function parseRelation(value: unknown, path: string): VisualRelation {
  const relation = record(value, path);
  return {
    id: stringValue(relation.id, `${path}.id`),
    scopeId: stringValue(relation.scopeId, `${path}.scopeId`),
    from: stringValue(relation.from, `${path}.from`),
    to: stringValue(relation.to, `${path}.to`),
    kind: oneOf(relation.kind, VISUAL_RELATION_KINDS, `${path}.kind`),
    label: stringValue(relation.label, `${path}.label`, true),
  };
}

export function parsePatch(value: unknown, path: string): VisualNodePatch {
  const patch = record(value, path);
  return {
    title: nullableStringValue(patch.title, `${path}.title`),
    eyebrow: nullableStringValue(patch.eyebrow, `${path}.eyebrow`),
    summary: nullableStringValue(patch.summary, `${path}.summary`),
    detail: nullableStringValue(patch.detail, `${path}.detail`),
    terms:
      patch.terms === undefined || patch.terms === null
        ? null
        : stringArray(patch.terms, `${path}.terms`),
    view: nullableOneOf(patch.view, EXPLANATION_VIEWS, `${path}.view`),
    expandable: nullableBooleanValue(patch.expandable, `${path}.expandable`),
    expansionState: nullableOneOf(
      patch.expansionState,
      EXPANSION_STATES,
      `${path}.expansionState`,
    ),
    emphasis: nullableOneOf(patch.emphasis, EMPHASIS_LEVELS, `${path}.emphasis`),
  };
}

export function parseVisualDocument(value: unknown): VisualDocument {
  const document = record(value, "document");
  if (document.protocol !== "visual-explanation-document/2") {
    throw new Error("document.protocol 不受支持");
  }
  if (!Array.isArray(document.nodes) || document.nodes.length === 0) {
    throw new Error("document.nodes 至少需要一个节点");
  }
  if (document.nodes.length > 80) throw new Error("document.nodes 超出单文档上限");
  if (!Array.isArray(document.relations)) throw new Error("document.relations 必须是数组");

  const parsed: VisualDocument = {
    protocol: "visual-explanation-document/2",
    id: stringValue(document.id, "document.id"),
    question: stringValue(document.question, "document.question"),
    title: stringValue(document.title, "document.title"),
    thesis: stringValue(document.thesis, "document.thesis"),
    rootId: stringValue(document.rootId, "document.rootId"),
    primaryMaterial: parsePrimaryMaterial(document.primaryMaterial),
    nodes: document.nodes.map((item, index) => parseNode(item, `document.nodes[${index}]`)),
    relations: document.relations.map((item, index) =>
      parseRelation(item, `document.relations[${index}]`),
    ),
    version: integer(document.version, "document.version", 1),
  };

  assertDocumentGraph(parsed);
  return parsed;
}

function assertDocumentGraph(document: VisualDocument): void {
  const nodeById = new Map<string, VisualNode>();
  for (const node of document.nodes) {
    if (nodeById.has(node.id)) throw new Error(`节点 ID 重复：${node.id}`);
    nodeById.set(node.id, node);
  }

  const root = nodeById.get(document.rootId);
  if (!root) throw new Error("rootId 指向的节点不存在");
  if (root.parentId !== null || root.depth !== 0) {
    throw new Error("根节点必须 parentId 为 null 且 depth 为 0");
  }

  const expectedChildren = new Map<string, string[]>();
  for (const node of document.nodes) {
    if (node.id === document.rootId) continue;
    if (node.parentId === null) throw new Error(`非根节点 ${node.id} 缺少 parentId`);
    const parent = nodeById.get(node.parentId);
    if (!parent) throw new Error(`节点 ${node.id} 的父节点不存在：${node.parentId}`);
    if (node.depth !== parent.depth + 1) {
      throw new Error(`节点 ${node.id} 的 depth 与父节点不一致`);
    }
    const siblings = expectedChildren.get(parent.id) ?? [];
    siblings.push(node.id);
    expectedChildren.set(parent.id, siblings);
  }

  for (const node of document.nodes) {
    const expected = expectedChildren.get(node.id) ?? [];
    if (expected.length > 8) throw new Error(`节点 ${node.id} 的直接子节点超过 8 个`);
    if (
      node.childIds.length !== expected.length ||
      node.childIds.some((id, index) => id !== expected[index])
    ) {
      throw new Error(`节点 ${node.id} 的 childIds 与 parentId 关系不一致`);
    }
    if (node.expansionState === "terminal") {
      if (node.childIds.length > 0) throw new Error(`终点节点 ${node.id} 不能包含子节点`);
      if (node.expandable) throw new Error(`终点节点 ${node.id} 不能继续展开`);
    }
    if (node.expansionState === "outline") {
      if (node.childIds.length > 0) throw new Error(`未展开节点 ${node.id} 不能包含子节点`);
      if (!node.expandable) throw new Error(`未展开节点 ${node.id} 必须允许进入下一层`);
    }
    if (node.expansionState === "expanded" && node.childIds.length === 0) {
      throw new Error(`已展开节点 ${node.id} 必须包含子节点`);
    }
    if (node.childIds.length > 0 && node.expansionState !== "expanded") {
      throw new Error(`包含子节点的节点 ${node.id} 必须标记为 expanded`);
    }
  }

  for (const node of document.nodes) {
    const visited = new Set<string>();
    let cursor: VisualNode | undefined = node;
    while (cursor?.parentId) {
      if (visited.has(cursor.id)) throw new Error(`节点 ${node.id} 出现父子循环`);
      visited.add(cursor.id);
      cursor = nodeById.get(cursor.parentId);
    }
  }

  const relationIds = new Set<string>();
  for (const relation of document.relations) {
    if (relationIds.has(relation.id)) throw new Error(`关系 ID 重复：${relation.id}`);
    relationIds.add(relation.id);
    const scope = nodeById.get(relation.scopeId);
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!scope || !from || !to) throw new Error(`关系 ${relation.id} 引用了不存在的节点`);
    if (from.id === to.id) throw new Error(`关系 ${relation.id} 不能连接节点自身`);
    if (from.parentId !== scope.id || to.parentId !== scope.id) {
      throw new Error(`关系 ${relation.id} 只能连接 scope 的直接子节点`);
    }
  }
}

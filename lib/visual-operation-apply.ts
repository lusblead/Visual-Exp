import type {
  VisualDocument,
  VisualOperationBatch,
} from "./visual-contract-types";
import { parseVisualDocument } from "./visual-contract-parse";

export function applyVisualOperations(
  document: VisualDocument,
  batch: VisualOperationBatch,
): VisualDocument {
  if (batch.baseVersion !== document.version) {
    throw new Error(`版本冲突：当前为 ${document.version}，操作基于 ${batch.baseVersion}`);
  }

  const next: VisualDocument = {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      childIds: [...node.childIds],
      terms: [...node.terms],
      evidence: node.evidence.map((item) => ({ ...item })),
    })),
    relations: document.relations.map((relation) => ({ ...relation })),
    version: document.version + 1,
  };

  for (const operation of batch.operations) {
    if (operation.kind === "add_node" && operation.node) {
      if (next.nodes.some((node) => node.id === operation.node?.id)) {
        throw new Error(`新增节点 ID 已存在：${operation.node.id}`);
      }
      next.nodes.push({
        ...operation.node,
        childIds: [...operation.node.childIds],
        terms: [...operation.node.terms],
      });
      continue;
    }

    if (operation.kind === "add_relation" && operation.relation) {
      if (next.relations.some((relation) => relation.id === operation.relation?.id)) {
        throw new Error(`新增关系 ID 已存在：${operation.relation.id}`);
      }
      next.relations.push({ ...operation.relation });
      continue;
    }

    if (operation.kind === "update_node" && operation.nodeId && operation.patch) {
      const index = next.nodes.findIndex((node) => node.id === operation.nodeId);
      if (index < 0) throw new Error(`待更新节点不存在：${operation.nodeId}`);
      const node = next.nodes[index];
      const patch = operation.patch;
      next.nodes[index] = {
        ...node,
        title: patch.title ?? node.title,
        eyebrow: patch.eyebrow ?? node.eyebrow,
        summary: patch.summary ?? node.summary,
        detail: patch.detail ?? node.detail,
        terms: patch.terms ?? node.terms,
        view: patch.view ?? node.view,
        expandable: patch.expandable ?? node.expandable,
        expansionState: patch.expansionState ?? node.expansionState,
        emphasis: patch.emphasis ?? node.emphasis,
      };
    }
  }

  // parentId is the source of truth. childIds are rebuilt deterministically so a
  // model never has to coordinate the same relationship in two places.
  const childIdsByParent = new Map<string, string[]>();
  for (const node of next.nodes) {
    if (!node.parentId) continue;
    const childIds = childIdsByParent.get(node.parentId) ?? [];
    childIds.push(node.id);
    childIdsByParent.set(node.parentId, childIds);
  }
  next.nodes = next.nodes.map((node) => {
    const childIds = childIdsByParent.get(node.id) ?? [];
    return {
      ...node,
      childIds,
      expansionState: childIds.length > 0 ? "expanded" : node.expansionState,
    };
  });

  return parseVisualDocument(next);
}

import type {
  VisualNode,
  VisualRelation,
  VisualRelationKind,
} from "./lineage-contracts";

const MAX_CONCEPT_NODES = 8;
const MAX_CONCEPT_RELATIONS = 12;
const MAX_NODE_LABEL_LENGTH = 36;
const MAX_RELATION_LABEL_LENGTH = 24;

const RELATION_FALLBACK_LABELS: Record<VisualRelationKind, string> = {
  sequence: "下一步",
  supports: "支持",
  contrasts: "对比",
  causes: "导致",
  part_of: "属于",
  relates: "相关",
};

export function buildOpeningConceptMermaid({
  root,
  orderedChildIds,
  nodes,
  relations,
}: {
  root: VisualNode;
  orderedChildIds: readonly string[];
  nodes: readonly VisualNode[];
  relations: readonly VisualRelation[];
}): string | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const children = orderedChildIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is VisualNode => Boolean(node))
    .slice(0, MAX_CONCEPT_NODES);
  if (children.length < 2) return null;

  const localIdByCanonicalId = new Map(
    children.map((node, index) => [node.id, `N${index + 1}`]),
  );
  const lines = [
    "flowchart LR",
    `    R(["${safeLabel(root.title, "主题", MAX_NODE_LABEL_LENGTH)}"])`,
  ];

  for (const [index, node] of children.entries()) {
    const localId = `N${index + 1}`;
    lines.push(
      `    ${localId}["${safeLabel(
        node.title,
        `概念 ${index + 1}`,
        MAX_NODE_LABEL_LENGTH,
      )}"]`,
    );
    lines.push(`    R --> ${localId}`);
  }

  const seenRelations = new Set<string>();
  for (const relation of relations) {
    if (seenRelations.size >= MAX_CONCEPT_RELATIONS) break;
    if (relation.scopeId !== root.id || relation.from === relation.to) continue;
    const from = localIdByCanonicalId.get(relation.from);
    const to = localIdByCanonicalId.get(relation.to);
    if (!from || !to) continue;
    const label = safeLabel(
      relation.label,
      RELATION_FALLBACK_LABELS[relation.kind],
      MAX_RELATION_LABEL_LENGTH,
    );
    const identity = `${from}\u0000${to}\u0000${label}`;
    if (seenRelations.has(identity)) continue;
    seenRelations.add(identity);
    lines.push(`    ${from} -->|${label}| ${to}`);
  }

  return lines.join("\n");
}

function safeLabel(value: string, fallback: string, maximumLength: number): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s.,，。:：;；!?！？()（）/、·+\-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const bounded = Array.from(normalized).slice(0, maximumLength).join("").trim();
  return bounded || fallback;
}

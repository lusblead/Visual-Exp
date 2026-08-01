import { useId } from "react";
import type {
  ExplanationView,
  VisualNode,
  VisualRelation,
  VisualRelationKind,
} from "../lib/lineage-contracts";

const DIAGRAM_VIEWS = new Set<ExplanationView>([
  "sequence",
  "timeline",
  "compare",
  "cluster",
]);

const RELATION_GLYPHS: Record<VisualRelationKind, string> = {
  sequence: "→",
  supports: "→",
  contrasts: "↔",
  causes: "→",
  part_of: "∈",
  relates: "—",
};

export function SemanticDiagram({
  view,
  orderedChildIds,
  nodes,
  relations,
  onEnter,
}: {
  view: ExplanationView;
  orderedChildIds: readonly string[];
  nodes: readonly VisualNode[];
  relations: readonly VisualRelation[];
  onEnter: (node: VisualNode) => void | Promise<void>;
}) {
  const headingId = useId();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const orderedNodes = orderedChildIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is VisualNode => Boolean(node));
  const visibleNodeIds = new Set(orderedNodes.map((node) => node.id));
  const visibleRelations = relations.filter(
    (relation) =>
      relation.from !== relation.to &&
      visibleNodeIds.has(relation.from) &&
      visibleNodeIds.has(relation.to),
  );

  if (
    orderedNodes.length < 2 ||
    (!DIAGRAM_VIEWS.has(view) && visibleRelations.length === 0)
  ) {
    return null;
  }

  return (
    <section
      className={`semantic-diagram semantic-diagram-${view}`}
      aria-labelledby={headingId}
      data-projection-view={view}
    >
      <div className="semantic-diagram-heading">
        <span className="semantic-diagram-kicker" aria-hidden="true">
          结构一览
        </span>
        <h2 id={headingId}>当前层级的关系投影</h2>
        <p>用于快速定位；完整说明和可解释名词仍在下方正文。</p>
      </div>

      <ol className="semantic-diagram-nodes">
        {orderedNodes.map((node, index) => (
          <li key={node.id} data-node-kind={node.kind}>
            <button
              type="button"
              className="semantic-diagram-node"
              onClick={() => void onEnter(node)}
              aria-label={`进入 ${node.title}`}
            >
              <span className="semantic-diagram-order" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="semantic-diagram-node-copy">
                <strong>{node.title}</strong>
                <span>{node.summary}</span>
              </span>
              <span className="semantic-diagram-enter" aria-hidden="true">
                →
              </span>
            </button>
          </li>
        ))}
      </ol>

      {visibleRelations.length > 0 ? (
        <ul className="semantic-diagram-relations" aria-label="当前层级的语义关系">
          {visibleRelations.map((relation) => {
            const from = nodeById.get(relation.from);
            const to = nodeById.get(relation.to);
            if (!from || !to) return null;

            return (
              <li
                key={relation.id}
                data-relation-kind={relation.kind}
                aria-label={`${from.title}，${relation.label}，${to.title}`}
              >
                <span className="semantic-diagram-relation-endpoint">
                  {from.title}
                </span>
                <span className="semantic-diagram-relation-copy">
                  <span aria-hidden="true">{RELATION_GLYPHS[relation.kind]}</span>
                  <small>{relation.label}</small>
                </span>
                <span className="semantic-diagram-relation-endpoint">
                  {to.title}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

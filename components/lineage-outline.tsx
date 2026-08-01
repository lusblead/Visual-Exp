import type { VisualNode } from "../lib/lineage-contracts";

export function OutlinePanel({
  open,
  rootId,
  nodeById,
  activeNodeId,
  pathIds,
  atRoot,
  canUndo,
  onClose,
  onSelect,
  onHome,
  onUndo,
}: {
  open: boolean;
  rootId: string;
  nodeById: Map<string, VisualNode>;
  activeNodeId: string;
  pathIds: Set<string>;
  atRoot: boolean;
  canUndo: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onHome: () => void;
  onUndo: () => void;
}) {
  return (
    <aside className={`outline-panel ${open ? "is-open" : ""}`}>
      <div className="panel-heading">
        <div>
          <span className="panel-kicker">STRUCTURE</span>
          <h2>结构地图</h2>
        </div>
        <button className="mobile-close" type="button" onClick={onClose} aria-label="关闭结构地图">
          ×
        </button>
      </div>
      <p className="panel-intro">你可以从任何已生成节点跳转。当前位置始终保留在整体结构中。</p>
      <nav className="outline-tree" aria-label="解释结构">
        <OutlineBranch
          nodeId={rootId}
          nodeById={nodeById}
          activeNodeId={activeNodeId}
          pathIds={pathIds}
          onSelect={onSelect}
        />
      </nav>
      <div className="outline-actions">
        <button type="button" onClick={onHome} disabled={atRoot}>
          <span aria-hidden="true">⌂</span>
          回到全局
        </button>
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          <span aria-hidden="true">↶</span>
          撤销生成
        </button>
      </div>
    </aside>
  );
}

function OutlineBranch({
  nodeId,
  nodeById,
  activeNodeId,
  pathIds,
  onSelect,
}: {
  nodeId: string;
  nodeById: Map<string, VisualNode>;
  activeNodeId: string;
  pathIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const node = nodeById.get(nodeId);
  if (!node) return null;
  return (
    <div className="outline-branch">
      <button
        type="button"
        className={`${node.id === activeNodeId ? "is-active" : ""} ${
          pathIds.has(node.id) ? "is-on-path" : ""
        }`}
        onClick={() => onSelect(node.id)}
      >
        <span className={`tree-dot ${node.childIds.length ? "has-children" : ""}`} />
        <span>{node.parentId === null ? "全局" : node.title}</span>
        {node.childIds.length ? <small>{node.childIds.length}</small> : null}
      </button>
      {node.childIds.length > 0 ? (
        <div className="outline-children">
          {node.childIds.map((childId) => (
            <OutlineBranch
              key={childId}
              nodeId={childId}
              nodeById={nodeById}
              activeNodeId={activeNodeId}
              pathIds={pathIds}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

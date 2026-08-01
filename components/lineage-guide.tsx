import type { VisualNode } from "../lib/lineage-contracts";
import { SOURCE_LABELS, VIEW_META } from "./lineage-studio-data";

export function GuidePanel({
  guideNode,
  previewNode,
  activeNode,
  onEnter,
}: {
  guideNode: VisualNode;
  previewNode: VisualNode | null;
  activeNode: VisualNode;
  onEnter: (node: VisualNode) => void | Promise<void>;
}) {
  return (
    <aside className="guide-panel">
      <div className="guide-heading">
        <span className="panel-kicker">CURRENT FOCUS</span>
        <p>{previewNode ? "即将进入" : "当前场景"}</p>
      </div>
      <div className="focus-card" data-kind={guideNode.kind}>
        <div className="focus-topline">
          <span>{guideNode.eyebrow || "当前节点"}</span>
          <span>第 {guideNode.depth + 1} 层</span>
        </div>
        <h2>{guideNode.title}</h2>
        <p>{guideNode.detail || guideNode.summary}</p>
        <dl>
          <div>
            <dt>内部表达</dt>
            <dd>{VIEW_META[guideNode.view].label}</dd>
          </div>
          <div>
            <dt>已生成子层</dt>
            <dd>{guideNode.childIds.length || "尚未"}</dd>
          </div>
          <div>
            <dt>知识状态</dt>
            <dd>{SOURCE_LABELS[guideNode.sourceStatus]}</dd>
          </div>
        </dl>
        {previewNode ? (
          <button type="button" className="focus-action" onClick={() => void onEnter(previewNode)}>
            进入这一层 <span aria-hidden="true">↗</span>
          </button>
        ) : activeNode.childIds.length === 0 && activeNode.expandable ? (
          <button type="button" className="focus-action" onClick={() => void onEnter(activeNode)}>
            生成下一层 <span aria-hidden="true">↘</span>
          </button>
        ) : null}
      </div>

      <div className="guide-note">
        <span aria-hidden="true">◎</span>
        <div>
          <strong>这里不是固定模板</strong>
          <p>AI 只维护节点、层级与关系。你切换视觉形式时，底层内容和探索路径不会丢失。</p>
        </div>
      </div>
    </aside>
  );
}

import type {
  PrimaryMaterial,
  VisualNode,
  VisualRelation,
} from "../lib/lineage-contracts";
import {
  AnnotatedParagraphs,
  AnnotatedText,
  DeepReadingSection,
  KnowledgeSection,
  SceneLoading,
  SelectionAction,
  type DeepReadingState,
  type DeepenTerm,
  type ScenePreparationStatus,
  type SelectionActionState,
} from "./lineage-scene-primitives";
import { PrimaryMaterialBlock } from "./primary-material-block";
import { OpeningConceptDiagram } from "./opening-concept-diagram";
import { SemanticDiagram } from "./semantic-diagram";

type PreparationIndex =
  | Readonly<Record<string, ScenePreparationStatus>>
  | ReadonlyMap<string, ScenePreparationStatus>;

export function StageColumn({
  activeNode,
  primaryMaterial,
  childNodes,
  relations,
  isLoadingCurrent,
  error,
  onEnter,
  onExplain,
  onClearError,
  onDeepen,
  preparationByNodeId,
  scenePreparationByNodeId,
  deepReading,
  onCloseDeepReading,
  onExplainDeepTerm,
  onDeepenDeepTerm,
  selectionAction,
  onAskSelection,
  onDeepenSelection,
}: {
  activeNode: VisualNode;
  primaryMaterial?: PrimaryMaterial | null;
  childNodes: VisualNode[];
  /** Relations may add an auxiliary overview; the full projection stays linear. */
  relations: VisualRelation[];
  isLoadingCurrent: boolean;
  error: string | null;
  onEnter: (node: VisualNode) => void | Promise<void>;
  onExplain: (
    node: VisualNode,
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  onClearError: () => void;
  onDeepen?: DeepenTerm;
  preparationByNodeId?: PreparationIndex;
  /** Backward-compatible controller name used by the scene prefetch integration. */
  scenePreparationByNodeId?: PreparationIndex;
  deepReading?: DeepReadingState | null;
  onCloseDeepReading?: () => void;
  onExplainDeepTerm?: (
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  onDeepenDeepTerm?: (
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  selectionAction?: SelectionActionState | null;
  onAskSelection?: () => void | Promise<void>;
  onDeepenSelection?: () => void | Promise<void>;
}) {
  const activeDeepReading =
    deepReading &&
    (!deepReading.sourceNodeId || deepReading.sourceNodeId === activeNode.id)
      ? deepReading
      : null;

  return (
    <section className="stage-column" aria-labelledby="scene-title">
      <div className="semantic-viewport">
        <article
          className={`semantic-scene projection-${activeNode.view}`}
          key={activeNode.id}
          data-depth={activeNode.depth}
        >
          <div className="knowledge-network knowledge-spine">
            {primaryMaterial ? (
              <PrimaryMaterialBlock material={primaryMaterial} />
            ) : null}
            <header
              className="network-core scene-orientation"
              data-node-id={activeNode.id}
            >
              <div className="core-marker" aria-hidden="true">
                <span>{String(activeNode.depth + 1).padStart(2, "0")}</span>
              </div>
              {activeNode.eyebrow ? (
                <p className="core-eyebrow">{activeNode.eyebrow}</p>
              ) : null}
              <h1 id="scene-title" tabIndex={-1}>
                <AnnotatedText
                  node={activeNode}
                  text={activeNode.title}
                  onExplain={onExplain}
                  onDeepen={onDeepen}
                />
              </h1>
              {activeNode.depth === 0 && childNodes.length > 1 ? (
                <OpeningConceptDiagram
                  root={activeNode}
                  orderedChildIds={activeNode.childIds}
                  nodes={childNodes}
                  relations={relations}
                  onEnter={onEnter}
                />
              ) : null}
              <p className="core-summary">
                <AnnotatedText
                  node={activeNode}
                  text={activeNode.summary}
                  onExplain={onExplain}
                  onDeepen={onDeepen}
                />
              </p>
              {activeNode.detail ? (
                <AnnotatedParagraphs
                  className="core-detail"
                  node={activeNode}
                  text={activeNode.detail}
                  onExplain={onExplain}
                  onDeepen={onDeepen}
                />
              ) : null}

              {isLoadingCurrent ? <SceneLoading node={activeNode} /> : null}

              {!isLoadingCurrent &&
              childNodes.length === 0 &&
              activeNode.expandable &&
              activeNode.expansionState !== "terminal" ? (
                <button
                  type="button"
                  className="core-expand"
                  onClick={() => void onEnter(activeNode)}
                  aria-label={`重新展开 ${activeNode.title}`}
                >
                  <span aria-hidden="true">↻</span>
                </button>
              ) : null}
            </header>

            {activeDeepReading ? (
              <DeepReadingSection
                state={activeDeepReading}
                onClose={onCloseDeepReading}
                onExplainTerm={onExplainDeepTerm}
                onDeepenTerm={onDeepenDeepTerm}
              />
            ) : null}

            {childNodes.length > 0 ? (
              <>
                {activeNode.depth > 0 ? (
                  <SemanticDiagram
                    view={activeNode.view}
                    orderedChildIds={activeNode.childIds}
                    nodes={childNodes}
                    relations={relations}
                    onEnter={onEnter}
                  />
                ) : null}
                <ol
                  className="network-node-list"
                  aria-label={`${activeNode.title}的下一层`}
                >
                  {childNodes.map((node, index) => {
                    const childDeepReading =
                      deepReading?.sourceNodeId === node.id ? deepReading : null;
                    return (
                      <li key={node.id}>
                        <KnowledgeSection
                          node={node}
                          index={index}
                          onEnter={onEnter}
                          onExplain={onExplain}
                          onDeepen={onDeepen}
                          preparationStatus={readPreparationStatus(
                            preparationByNodeId ?? scenePreparationByNodeId,
                            node.id,
                          )}
                        />
                        {childDeepReading ? (
                          <DeepReadingSection
                            state={childDeepReading}
                            onClose={onCloseDeepReading}
                            onExplainTerm={onExplainDeepTerm}
                            onDeepenTerm={onDeepenDeepTerm}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : null}
          </div>
        </article>
      </div>

      {selectionAction && onAskSelection && onDeepenSelection ? (
        <SelectionAction
          state={selectionAction}
          onAsk={onAskSelection}
          onDeepen={onDeepenSelection}
        />
      ) : null}

      {error ? (
        <div className="stage-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onClearError} aria-label="关闭错误提示">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function readPreparationStatus(
  index: PreparationIndex | undefined,
  nodeId: string,
): ScenePreparationStatus {
  if (!index) return "idle";
  const mapLike = index as ReadonlyMap<string, ScenePreparationStatus>;
  const value =
    typeof mapLike.get === "function"
      ? mapLike.get(nodeId)
      : (index as Readonly<Record<string, ScenePreparationStatus>>)[nodeId];
  return value ?? "idle";
}

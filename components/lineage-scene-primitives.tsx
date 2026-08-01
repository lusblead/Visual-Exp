import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import type { VisualNode } from "../lib/lineage-contracts";
import type { DeepExplanation } from "../lib/deep-explanation";
import type { TermExplanation } from "../lib/term-explanation";
import { annotateTerms } from "../lib/annotated-term-match.mjs";
import { shouldEnterKnowledgeNode } from "../lib/knowledge-node-interaction.mjs";

// Keep the pending single action long enough for slower OS/browser double-click
// thresholds. The second click always cancels this timer before `dblclick` fires.
const MULTI_CLICK_DELAY_MS = 450;

export type ExplainTerm = (
  node: VisualNode,
  term: string,
  trigger: HTMLButtonElement,
) => void | Promise<void>;

export type DeepenTerm = ExplainTerm;

type ActivateAnnotatedTerm = (
  term: string,
  trigger: HTMLButtonElement,
) => void | Promise<void>;

export interface AnnotatedTextProps {
  text: string;
  node?: VisualNode;
  terms?: string[];
  onExplain?: ExplainTerm;
  onDeepen?: DeepenTerm;
  onTermActivate?: ActivateAnnotatedTerm;
  onTermDeepen?: ActivateAnnotatedTerm;
}

/**
 * Render a bounded set of semantic annotations without coupling the renderer to
 * one source shape. `node`/`onExplain` preserve the original scene API, while
 * `terms`/`onTermActivate` let term and deep-reading results reuse the same UI.
 */
export function AnnotatedText({
  node,
  text,
  terms = node?.terms ?? [],
  onExplain,
  onDeepen,
  onTermActivate,
  onTermDeepen,
}: AnnotatedTextProps) {
  const pendingSingleActivation = useRef<number | null>(null);
  const activate =
    onTermActivate ??
    (node && onExplain
      ? (term: string, trigger: HTMLButtonElement) =>
          onExplain(node, term, trigger)
      : undefined);
  const deepen =
    onTermDeepen ??
    (node && onDeepen
      ? (term: string, trigger: HTMLButtonElement) =>
          onDeepen(node, term, trigger)
      : undefined);
  const fragments = annotateTerms(text, activate ? terms : []);

  function cancelPendingSingleActivation() {
    if (pendingSingleActivation.current === null) return;
    window.clearTimeout(pendingSingleActivation.current);
    pendingSingleActivation.current = null;
  }

  useEffect(() => cancelPendingSingleActivation, []);

  function handleTermClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    term: string,
  ) {
    event.stopPropagation();
    const trigger = event.currentTarget;

    if (!activate) return;
    if (!deepen || event.detail === 0) {
      cancelPendingSingleActivation();
      void activate(term, trigger);
      return;
    }

    if (event.detail !== 1) {
      cancelPendingSingleActivation();
      return;
    }

    cancelPendingSingleActivation();
    pendingSingleActivation.current = window.setTimeout(() => {
      pendingSingleActivation.current = null;
      void activate(term, trigger);
    }, MULTI_CLICK_DELAY_MS);
  }

  function handleTermDoubleClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    term: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    cancelPendingSingleActivation();
    if (deepen) void deepen(term, event.currentTarget);
  }

  return (
    <>
      {fragments.map((fragment, index): ReactNode => {
        if (fragment.term === null) return fragment.text;
        return (
          <button
            key={`${fragment.start}-${fragment.term}-${index}`}
            type="button"
            className="inline-term knowledge-term"
            onClick={(event) => handleTermClick(event, fragment.term!)}
            onDoubleClick={(event) =>
              handleTermDoubleClick(event, fragment.term!)
            }
            aria-label={
              deepen
                ? `解释名词：${fragment.text}；双击深入理解`
                : `解释名词：${fragment.text}`
            }
          >
            {fragment.text}
          </button>
        );
      })}
    </>
  );
}

export function AnnotatedParagraphs({
  className,
  text,
  ...annotationProps
}: Omit<AnnotatedTextProps, "text"> & {
  className: string;
  text: string;
}) {
  return (
    <div className={className}>
      {splitParagraphs(text).map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`}>
          <AnnotatedText
            {...annotationProps}
            text={paragraph}
          />
        </p>
      ))}
    </div>
  );
}

export type ScenePreparationStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "failed";

export function KnowledgeSection({
  node,
  index,
  onEnter,
  onExplain,
  onDeepen,
  preparationStatus = "idle",
}: {
  node: VisualNode;
  index: number;
  onEnter: (node: VisualNode) => void | Promise<void>;
  onExplain: ExplainTerm;
  onDeepen?: DeepenTerm;
  preparationStatus?: ScenePreparationStatus;
}) {
  const pendingEntry = useRef<number | null>(null);

  function cancelPendingEntry() {
    if (pendingEntry.current === null) return;
    window.clearTimeout(pendingEntry.current);
    pendingEntry.current = null;
  }

  useEffect(() => cancelPendingEntry, []);

  function handleSectionClick(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (
      !shouldEnterKnowledgeNode({
        targetIsInteractive: Boolean(
          target.closest("button, a, input, textarea, select"),
        ),
        selectionType: window.getSelection()?.type,
      })
    ) {
      cancelPendingEntry();
      return;
    }

    if (event.detail !== 1) {
      cancelPendingEntry();
      return;
    }

    cancelPendingEntry();
    pendingEntry.current = window.setTimeout(() => {
      pendingEntry.current = null;
      void onEnter(node);
    }, MULTI_CLICK_DELAY_MS);
  }

  return (
    <article
      className={`knowledge-node knowledge-section emphasis-${node.emphasis}`}
      data-node-id={node.id}
      data-kind={node.kind}
      data-preparation={preparationStatus}
      style={{ "--node-delay": `${index * 45}ms` } as CSSProperties}
      onClick={handleSectionClick}
      onDoubleClick={cancelPendingEntry}
    >
      <span className="knowledge-spine-marker" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="knowledge-node-copy">
        {node.eyebrow ? <p className="knowledge-eyebrow">{node.eyebrow}</p> : null}
        <h2>
          <AnnotatedText
            node={node}
            text={node.title}
            onExplain={onExplain}
            onDeepen={onDeepen}
          />
        </h2>
        <p className="knowledge-summary">
          <AnnotatedText
            node={node}
            text={node.summary}
            onExplain={onExplain}
            onDeepen={onDeepen}
          />
        </p>
        {node.detail ? (
          <AnnotatedParagraphs
            className="knowledge-detail"
            node={node}
            text={node.detail}
            onExplain={onExplain}
            onDeepen={onDeepen}
          />
        ) : null}
      </div>
      <div className="knowledge-node-actions">
        {preparationStatus === "preparing" ? (
          <span className="knowledge-preparation" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          className="knowledge-enter"
          onClick={(event) => {
            event.stopPropagation();
            cancelPendingEntry();
            void onEnter(node);
          }}
          aria-label={
            preparationStatus === "preparing"
              ? `进入 ${node.title}；下一层正在准备`
              : `进入 ${node.title}`
          }
          aria-busy={preparationStatus === "preparing"}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

// Keep the original export stable while the controller migrates to the new
// semantic component name.
export const KnowledgeNode = KnowledgeSection;

export function SceneLoading({ node }: { node: VisualNode }) {
  return (
    <div className="scene-loading" role="status" aria-live="polite">
      <span className="loading-pulse" aria-hidden="true" />
      <p>正在准备「{node.title}」的下一层…</p>
    </div>
  );
}

export function CreationLoading({ question }: { question: string }) {
  return (
    <section className="creation-loading" role="status" aria-live="polite">
      <div className="creation-core" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{question}</p>
    </section>
  );
}

export interface TermOverlayEntry {
  term: string;
  nodeId: string;
  status: "loading" | "ready" | "error";
  /** Identifies the foreground request that owns a loading stack entry. */
  requestIdentity?: number;
  explanation?: TermExplanation;
  error?: string;
}

export interface TermOverlayState extends TermOverlayEntry {
  stack?: TermOverlayEntry[];
}

export interface TermWorkspaceCard {
  key: string;
  state: TermOverlayState;
}

export function TermWorkspace({
  cards,
  onClose,
  onBack,
  onExplainNested,
  onDeepenTerm,
  onDeepen,
}: {
  cards: TermWorkspaceCard[];
  onClose: (cardKey: string) => void;
  onBack?: (cardKey: string) => void;
  onExplainNested?: (
    cardKey: string,
    parent: TermOverlayEntry,
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  onDeepenTerm?: (
    cardKey: string,
    parent: TermOverlayEntry,
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  onDeepen?: (
    cardKey: string,
    entry: TermOverlayEntry,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
}) {
  if (cards.length === 0) return null;

  return (
    <aside
      className="term-workspace"
      role="region"
      aria-label="名词解释区"
    >
      {cards.map((card) => (
        <TermPopover
          key={card.key}
          cardKey={card.key}
          state={card.state}
          onClose={() => onClose(card.key)}
          onBack={onBack ? () => onBack(card.key) : undefined}
          onExplainNested={
            onExplainNested
              ? (parent, term, trigger) =>
                  onExplainNested(card.key, parent, term, trigger)
              : undefined
          }
          onDeepenTerm={
            onDeepenTerm
              ? (parent, term, trigger) =>
                  onDeepenTerm(card.key, parent, term, trigger)
              : undefined
          }
          onDeepen={
            onDeepen
              ? (entry, trigger) => onDeepen(card.key, entry, trigger)
              : undefined
          }
        />
      ))}
    </aside>
  );
}

export function TermPopover({
  cardKey,
  state,
  onClose,
  onBack,
  onExplainNested,
  onDeepenTerm,
  onDeepen,
}: {
  cardKey?: string;
  state: TermOverlayState;
  onClose: () => void;
  onBack?: () => void;
  onExplainNested?: (
    parent: TermOverlayEntry,
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  onDeepenTerm?: (
    parent: TermOverlayEntry,
    term: string,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
  onDeepen?: (
    entry: TermOverlayEntry,
    trigger: HTMLButtonElement,
  ) => void | Promise<void>;
}) {
  const entries = state.stack?.length ? state.stack : [state];
  const current = entries.at(-1)!;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const nestedTerms = readExplanationTerms(current.explanation);

  useEffect(() => {
    titleRef.current?.focus();
  }, [current.term, entries.length]);

  return (
    <article
      className="term-popover"
      data-term-card-key={cardKey}
      aria-labelledby={titleId}
      aria-busy={current.status === "loading"}
    >
      {entries.length > 1 && onBack ? (
        <button
          type="button"
          className="term-back"
          onClick={onBack}
          aria-label="返回上一层名词解释"
        >
          <span aria-hidden="true">‹</span>
        </button>
      ) : null}
      <button
        type="button"
        className="term-close"
        onClick={onClose}
        aria-label="关闭解释"
      >
        <span aria-hidden="true">×</span>
      </button>
      <p className="term-kicker">
        {entries.length > 1 ? `名词解释 · ${entries.length}` : "名词解释"}
      </p>
      <h2 id={titleId} ref={titleRef} tabIndex={-1}>
        {current.term}
      </h2>
      <div className="term-content" aria-live="polite">
        {current.status === "loading" ? (
          <div className="term-loading">
            <span aria-hidden="true" />
            <p>正在结合当前内容解释…</p>
          </div>
        ) : null}
        {current.status === "ready" && current.explanation ? (
          <>
            <p className="term-definition">
              <AnnotatedText
                text={current.explanation.definition}
                terms={nestedTerms}
                onTermActivate={
                  onExplainNested
                    ? (term, trigger) =>
                        onExplainNested(current, term, trigger)
                    : undefined
                }
                onTermDeepen={
                  onDeepenTerm
                    ? (term, trigger) => onDeepenTerm(current, term, trigger)
                    : undefined
                }
              />
            </p>
            <div className="term-relevance">
              <span>在这里</span>
              <p>
                <AnnotatedText
                  text={current.explanation.relevance}
                  terms={nestedTerms}
                  onTermActivate={
                    onExplainNested
                      ? (term, trigger) =>
                          onExplainNested(current, term, trigger)
                      : undefined
                  }
                  onTermDeepen={
                    onDeepenTerm
                      ? (term, trigger) => onDeepenTerm(current, term, trigger)
                      : undefined
                  }
                />
              </p>
            </div>
            {onDeepen ? (
              <button
                type="button"
                className="term-deepen"
                onClick={(event) => void onDeepen(current, event.currentTarget)}
              >
                深入 <span aria-hidden="true">→</span>
              </button>
            ) : null}
          </>
        ) : null}
        {current.status === "error" ? (
          <p className="term-error" role="alert">
            {current.error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export interface DeepReadingParagraph {
  id?: string;
  label?: string;
  text: string;
}

export interface DeepReadingState {
  status: "loading" | "ready" | "error";
  subject: string;
  sourceNodeId?: string;
  /** Retained so every annotated deep term can be validated in its source context. */
  explanation?: DeepExplanation;
  title?: string;
  paragraphs?: DeepReadingParagraph[];
  terms?: string[];
  error?: string;
}

export function DeepReadingSection({
  state,
  onClose,
  onExplainTerm,
  onDeepenTerm,
}: {
  state: DeepReadingState;
  onClose?: () => void;
  onExplainTerm?: ActivateAnnotatedTerm;
  onDeepenTerm?: ActivateAnnotatedTerm;
}) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (state.status === "ready") titleRef.current?.focus();
  }, [state.status, state.subject]);

  return (
    <section
      className="deep-reading-section"
      data-node-id={state.sourceNodeId}
      data-deep-explanation={state.explanation ? "true" : undefined}
      aria-labelledby={titleId}
      aria-busy={state.status === "loading"}
    >
      {onClose ? (
        <button
          type="button"
          className="deep-reading-close"
          onClick={onClose}
          aria-label="关闭深入解释"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <p className="deep-reading-kicker">深入理解</p>
      <h2 id={titleId} ref={titleRef} tabIndex={-1}>
        {state.title || state.subject}
      </h2>
      {state.status === "loading" ? (
        <div className="deep-reading-loading" role="status" aria-live="polite">
          <span className="loading-pulse" aria-hidden="true" />
          <p>正在补充背景、机制与边界…</p>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <div className="deep-reading-body">
          {(state.paragraphs ?? []).map((paragraph, index) => (
            <section key={paragraph.id ?? `${index}-${paragraph.text.slice(0, 24)}`}>
              {paragraph.label ? <h3>{paragraph.label}</h3> : null}
              <AnnotatedParagraphs
                className="deep-reading-prose"
                text={paragraph.text}
                terms={state.terms}
                onTermActivate={onExplainTerm}
                onTermDeepen={onDeepenTerm}
              />
            </section>
          ))}
        </div>
      ) : null}
      {state.status === "error" ? (
        <p className="deep-reading-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

export interface SelectionActionState {
  text: string;
  busy?: boolean;
  anchor?: {
    top: number;
    left: number;
  };
}

export function SelectionAction({
  state,
  onAsk,
  onDeepen,
}: {
  state: SelectionActionState;
  onAsk: () => void | Promise<void>;
  onDeepen: () => void | Promise<void>;
}) {
  const style = state.anchor
    ? ({
        "--selection-top": `${state.anchor.top}px`,
        "--selection-left": `${state.anchor.left}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      className="selection-action"
      role="group"
      aria-label="所选内容操作"
      style={style}
    >
      <button
        type="button"
        className="selection-ask"
        disabled={state.busy}
        onClick={() => void onAsk()}
        aria-label="向 AI 提问所选内容"
      >
        向 AI 提问
      </button>
      <button
        type="button"
        className="selection-deepen"
        disabled={state.busy}
        onClick={() => void onDeepen()}
        aria-label={state.busy ? "正在深入解释所选内容" : "深入解释所选内容"}
      >
        {state.busy ? "…" : "深入"}
      </button>
    </div>
  );
}

function splitParagraphs(text: string): string[] {
  const paragraphs = text
    .trim()
    .split(/\r?\n(?:[\t ]*\r?\n)+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs : [text];
}

function readExplanationTerms(explanation?: TermExplanation): string[] {
  if (!explanation) return [];
  const terms = (explanation as TermExplanation & { terms?: unknown }).terms;
  if (!Array.isArray(terms)) return [];
  return terms.filter(
    (term): term is string => typeof term === "string" && term.trim().length > 0,
  );
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type {
  VisualNode,
  VisualRelation,
} from "../lib/lineage-contracts";
import { buildOpeningConceptMermaid } from "../lib/opening-concept-diagram";
import { SemanticDiagram } from "./semantic-diagram";

type MermaidApi = (typeof import("mermaid"))["default"];

let mermaidApiPromise: Promise<MermaidApi> | null = null;
const MIN_DIAGRAM_ZOOM = 1;
const MAX_DIAGRAM_ZOOM = 3;
const DIAGRAM_ZOOM_STEP = 0.25;

export function OpeningConceptDiagram({
  root,
  orderedChildIds,
  nodes,
  relations,
  onEnter,
}: {
  root: VisualNode;
  orderedChildIds: readonly string[];
  nodes: readonly VisualNode[];
  relations: readonly VisualRelation[];
  onEnter: (node: VisualNode) => void | Promise<void>;
}) {
  const headingId = useId();
  const reactId = useId();
  const renderEpoch = useRef(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [zoom, setZoom] = useState(MIN_DIAGRAM_ZOOM);
  const [renderResult, setRenderResult] = useState<{
    source: string;
    imageUrl: string | null;
    failed: boolean;
  } | null>(null);
  const source = useMemo(
    () =>
      buildOpeningConceptMermaid({
        root,
        orderedChildIds,
        nodes,
        relations,
      }),
    [nodes, orderedChildIds, relations, root],
  );
  const renderId = useMemo(
    () => `opening-concept-${reactId.replace(/[^A-Za-z0-9_-]/gu, "")}`,
    [reactId],
  );
  const dialogId = `${renderId}-dialog`;

  useEffect(() => {
    if (!source) return;
    const epoch = renderEpoch.current + 1;
    renderEpoch.current = epoch;
    let disposed = false;
    let objectUrl: string | null = null;

    void loadMermaid()
      .then((mermaid) => mermaid.render(`${renderId}-${epoch}`, source))
      .then(({ svg }) => {
        objectUrl = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        );
        if (disposed || renderEpoch.current !== epoch) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setRenderResult({ source, imageUrl: objectUrl, failed: false });
      })
      .catch(() => {
        if (!disposed && renderEpoch.current === epoch) {
          setRenderResult({ source, imageUrl: null, failed: true });
        }
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [renderId, source]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isExpanded && !dialog.open) {
      dialog.showModal();
    } else if (!isExpanded && dialog.open) {
      dialog.close();
    }
  }, [isExpanded]);

  const currentResult = renderResult?.source === source ? renderResult : null;
  const imageUrl = currentResult?.imageUrl ?? null;
  const failed = currentResult?.failed ?? false;
  const diagramAlt = `${root.title}与${nodes.map((node) => node.title).join("、")}的概念关系图`;

  const changeZoom = (delta: number) => {
    setZoom((current) =>
      Math.min(MAX_DIAGRAM_ZOOM, Math.max(MIN_DIAGRAM_ZOOM, current + delta)),
    );
  };

  if (!source || failed) {
    return (
      <SemanticDiagram
        view={root.view}
        orderedChildIds={orderedChildIds}
        nodes={nodes}
        relations={relations}
        onEnter={onEnter}
      />
    );
  }

  return (
    <section
      className="opening-concept-diagram"
      aria-labelledby={headingId}
      data-renderer="mermaid"
    >
      <div className="opening-concept-heading">
        <span aria-hidden="true">概念总览</span>
        <h2 id={headingId}>先看节点关系，再进入细节</h2>
      </div>
      {imageUrl ? (
        <>
          <div className="opening-concept-image-frame">
            {/* Blob-backed SVG cannot use Next Image optimization; keeping it in an
                img avoids injecting Mermaid's markup into the document DOM. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="opening-concept-preview-image" src={imageUrl} alt={diagramAlt} />
            <button
              type="button"
              className="opening-concept-expand"
              aria-controls={dialogId}
              aria-haspopup="dialog"
              onClick={() => {
                setZoom(MIN_DIAGRAM_ZOOM);
                setIsExpanded(true);
              }}
            >
              <span aria-hidden="true">↗</span>
              查看大图
            </button>
          </div>

          <dialog
            ref={dialogRef}
            id={dialogId}
            className="opening-concept-dialog"
            aria-labelledby={`${dialogId}-title`}
            onClose={() => setIsExpanded(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsExpanded(false);
            }}
          >
            <header className="opening-concept-dialog-header">
              <div>
                <span>概念总览</span>
                <strong id={`${dialogId}-title`}>{root.title}</strong>
              </div>
              <div className="opening-concept-dialog-controls" aria-label="概念图缩放控制">
                <button
                  type="button"
                  aria-label="缩小概念图"
                  disabled={zoom <= MIN_DIAGRAM_ZOOM}
                  onClick={() => changeZoom(-DIAGRAM_ZOOM_STEP)}
                >
                  −
                </button>
                <output aria-live="polite">{Math.round(zoom * 100)}%</output>
                <button
                  type="button"
                  aria-label="放大概念图"
                  disabled={zoom >= MAX_DIAGRAM_ZOOM}
                  onClick={() => changeZoom(DIAGRAM_ZOOM_STEP)}
                >
                  +
                </button>
                <button type="button" onClick={() => setZoom(MIN_DIAGRAM_ZOOM)}>
                  适应
                </button>
                <button type="button" onClick={() => setIsExpanded(false)}>
                  关闭
                </button>
              </div>
            </header>
            <div className="opening-concept-dialog-viewport">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={diagramAlt}
                draggable={false}
                style={{ width: `${zoom * 100}%` }}
              />
            </div>
          </dialog>
        </>
      ) : (
        <div className="opening-concept-loading" role="status">
          正在整理概念关系…
        </div>
      )}
    </section>
  );
}

function loadMermaid(): Promise<MermaidApi> {
  mermaidApiPromise ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: {
        background: "#fbfcfb",
        primaryColor: "#f4f3ff",
        primaryTextColor: "#171a18",
        primaryBorderColor: "#6f63d9",
        lineColor: "#8b8f8c",
        secondaryColor: "#f1f4f2",
        tertiaryColor: "#ffffff",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
      flowchart: {
        curve: "basis",
        htmlLabels: false,
        useMaxWidth: true,
      },
    });
    return mermaid;
  });
  return mermaidApiPromise;
}

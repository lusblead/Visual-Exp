"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VisualDocument, VisualNode } from "../lib/lineage-contracts";
import {
  buildScenePrefetchQueue,
  scenePreparationKey,
} from "../lib/scene-prefetch-priority.mjs";
import {
  buildTermPrefetchBatches,
  deepTermExplanationCacheKey,
  nestedTermExplanationCacheKey,
  termExplanationCacheKey,
} from "../lib/term-prefetch-priority.mjs";
import {
  createDeepReadingStore,
  deepReadingCacheKey,
} from "../lib/deep-reading-cache.mjs";
import {
  buildPrefetchPlan,
  DEFAULT_PREFETCH_PROFILE,
  prefetchFrontierKey,
} from "../lib/prefetch-policy.mjs";
import {
  createKnowledgeSession,
  KNOWLEDGE_SESSION_MAX_DEEP_RESULTS,
  KNOWLEDGE_SESSION_MAX_TERM_CARDS,
  KNOWLEDGE_SESSION_MAX_TERM_RESULTS,
  KNOWLEDGE_SESSION_MAX_USAGE_RECEIPTS,
  type GenerationUsageReceipt,
  type KnowledgeSession,
  type PersistedDeepReadingState,
  type PregenerationProfile,
} from "../lib/knowledge-session-contract";
import {
  type KnowledgeSessionSummary,
} from "../lib/knowledge-session-repository";
import { BackendKnowledgeSessionRepository } from "../lib/backend-knowledge-session-repository";
import {
  createKnowledgeExportArtifact,
  type KnowledgeExportArtifact,
} from "../lib/knowledge-export";
import type { ModelUsageEvent } from "../lib/model-port";
import type { SelectionChatContext } from "../lib/selection-chat-client";
import { isTermExplanation, type TermExplanation } from "../lib/term-explanation";
import {
  isDeepExplanation,
  type DeepExplanation,
} from "../lib/deep-explanation";
import { HistoryControls, QuestionComposer } from "./lineage-header";
import {
  CreationLoading,
  TermWorkspace,
  type DeepReadingState,
  type SelectionActionState,
  type TermOverlayEntry,
  type TermOverlayState,
  type TermWorkspaceCard,
} from "./lineage-scene-primitives";
import { StageColumn } from "./lineage-stage";
import {
  createExplorationHistory,
  getSessionId,
  INITIAL_DOCUMENT,
  isVisualDocument,
  moveExplorationHistory,
  pushExplorationHistory,
  readApiError,
  type ApiPayload,
  type ExplorationHistory,
} from "./lineage-studio-data";
import {
  ModelSettingsDialog,
  type ModelSettingsStatus,
} from "./model-settings-dialog";
import {
  KnowledgeSessionControls,
  type KnowledgeSaveStatus,
} from "./knowledge-session-controls";
import { SelectionChatPanel } from "./selection-chat-panel";

type DocumentRequest =
  | { kind: "create"; requestId: number }
  | { kind: "expand"; requestId: number; nodeId: string }
  | null;

type CreateSearchMode = "on" | "off";

interface PendingQuestion {
  question: string;
  searchMode: CreateSearchMode;
}

interface TextSelectionState extends SelectionActionState {
  nodeId: string;
  parentExplanation?: TermExplanation;
  parentDeepExplanation?: DeepExplanation;
}

interface TermPrefetchItem {
  key: string;
  nodeId: string;
  term: string;
}

interface TermPrefetchBatch {
  nodeId: string;
  items: TermPrefetchItem[];
}

interface DeepReadingCacheSnapshot {
  activeKey: string | null;
  entries: Array<{
    key: string;
    status: "pending" | "success" | "error";
    value?: DeepReadingState;
  }>;
}

interface SignedExplanation<T extends TermExplanation | DeepExplanation> {
  explanation: T;
  contextToken: string;
  usage: ModelUsageEvent[];
}

export type ScenePreparationState = "idle" | "preparing" | "ready" | "failed";
const PREFETCH_PROFILE_SETTLE_MS = 450;

export function LineageStudio() {
  const [visualDocument, setVisualDocument] = useState<VisualDocument>(INITIAL_DOCUMENT);
  const [question, setQuestion] = useState("");
  const [createSearchEnabled, setCreateSearchEnabled] = useState(false);
  const [hasDocument, setHasDocument] = useState(false);
  const [navigation, setNavigation] = useState<ExplorationHistory>(() =>
    createExplorationHistory(INITIAL_DOCUMENT.rootId),
  );
  const [documentRequest, setDocumentRequest] = useState<DocumentRequest>(null);
  const [error, setError] = useState<string | null>(null);
  const [termCardsByKey, setTermCardsByKey] = useState<
    Record<string, TermOverlayState>
  >({});
  const [visibleTermCardKeys, setVisibleTermCardKeys] = useState<string[]>([]);
  const [termCache, setTermCache] = useState<Record<string, TermExplanation>>({});
  const [termPrefetchRestart, setTermPrefetchRestart] = useState(0);
  const [textSelection, setTextSelection] = useState<TextSelectionState | null>(null);
  const [chatSelection, setChatSelection] =
    useState<SelectionChatContext | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [deepReading, setDeepReading] = useState<DeepReadingState | null>(null);
  const [scenePreparationByNodeId, setScenePreparationByNodeId] = useState<
    Record<string, ScenePreparationState>
  >({});
  const [backgroundRestart, setBackgroundRestart] = useState(0);
  const [pageVisible, setPageVisible] = useState(true);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelSettingsStatus | null>(null);
  const [modelStatusBusy, setModelStatusBusy] = useState(true);
  const [modelSettingsError, setModelSettingsError] = useState<string | null>(null);
  const [prefetchProfile, setPrefetchProfile] = useState<PregenerationProfile>(
    DEFAULT_PREFETCH_PROFILE,
  );
  const [backgroundPrefetchProfile, setBackgroundPrefetchProfile] =
    useState<PregenerationProfile>(DEFAULT_PREFETCH_PROFILE);
  const [usageReceipts, setUsageReceipts] = useState<GenerationUsageReceipt[]>([]);
  const [sessionSummaries, setSessionSummaries] = useState<
    KnowledgeSessionSummary[]
  >([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [hydrationReady, setHydrationReady] = useState(false);
  const [saveStatus, setSaveStatus] =
    useState<KnowledgeSaveStatus>("restoring");
  const [saveRetry, setSaveRetry] = useState(0);
  const [deepCacheRevision, setDeepCacheRevision] = useState(0);

  const documentRequestEpoch = useRef(0);
  const termRequestEpoch = useRef(0);
  const deepRequestEpoch = useRef(0);
  const visualDocumentRef = useRef(visualDocument);
  const documentAbort = useRef<AbortController | null>(null);
  const scenePrefetchAbort = useRef<AbortController | null>(null);
  const prefetchProfileIntentEpoch = useRef(0);
  const prefetchProfileSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const termJobs = useRef(
    new Map<string, { generation: number; controller: AbortController }>(),
  );
  const termPrefetchAbort = useRef<AbortController | null>(null);
  const deepJobs = useRef(
    new Map<string, { generation: number; controller: AbortController }>(),
  );
  const [deepReadingStore] = useState(() =>
    createDeepReadingStore({ maxEntries: 32 }),
  );
  const termCacheRef = useRef<Record<string, TermExplanation>>({});
  const explanationContextTokens = useRef(
    new WeakMap<TermExplanation | DeepExplanation, string>(),
  );
  const contextTokensByCacheKey = useRef(new Map<string, string>());
  const sessionRepository = useRef<BackendKnowledgeSessionRepository | null>(
    null,
  );
  const sessionCreatedAt = useRef<string | null>(null);
  const sessionRevision = useRef(0);
  const skipNextAutosave = useRef(false);
  const latestSnapshot = useRef<ReturnType<typeof createKnowledgeSession> | null>(
    null,
  );
  const termPrefetchFailures = useRef(new Set<string>());
  const scenePrefetchFailures = useRef(new Set<string>());
  const termTriggers = useRef(new Map<string, HTMLButtonElement>());
  const pendingQuestion = useRef<PendingQuestion | null>(null);

  const appendUsageReceipt = useCallback(
    (
      receipt: Omit<
        GenerationUsageReceipt,
        "id" | "recordedAt"
      >,
    ) => {
      const next: GenerationUsageReceipt = {
        id: createLocalIdentity("usage"),
        recordedAt: new Date().toISOString(),
        ...receipt,
      };
      setUsageReceipts((receipts) =>
        [...receipts, next].slice(-KNOWLEDGE_SESSION_MAX_USAGE_RECEIPTS),
      );
    },
    [],
  );

  const nodeById = useMemo(
    () => new Map(visualDocument.nodes.map((node) => [node.id, node])),
    [visualDocument.nodes],
  );
  const activeNodeId =
    navigation.entries[navigation.cursor] ?? visualDocument.rootId;
  const activeNode =
    nodeById.get(activeNodeId) ?? nodeById.get(visualDocument.rootId)!;
  const children = activeNode.childIds
    .map((id) => nodeById.get(id))
    .filter((node): node is VisualNode => Boolean(node));
  const relations = visualDocument.relations.filter(
    (relation) => relation.scopeId === activeNode.id,
  );
  const visibleTermCards = useMemo(
    () =>
      visibleTermCardKeys
        .map((key): TermWorkspaceCard | null => {
          const state = termCardsByKey[key];
          return state ? { key, state } : null;
        })
        .filter((card): card is TermWorkspaceCard => Boolean(card)),
    [termCardsByKey, visibleTermCardKeys],
  );

  const isCreating = documentRequest?.kind === "create";
  const started = hasDocument || isCreating;
  const isLoadingCurrent =
    documentRequest?.kind === "expand" && documentRequest.nodeId === activeNode.id;
  const canGoBack = navigation.cursor > 0;
  const canGoForward = navigation.cursor < navigation.entries.length - 1;

  const abortAllTermJobs = useCallback(() => {
    for (const job of termJobs.current.values()) job.controller.abort();
    termJobs.current.clear();
  }, []);

  const hideAllTermCards = useCallback(() => {
    setVisibleTermCardKeys([]);
  }, []);

  const closeTermCard = useCallback(
    (cardKey: string, restoreFocus = true) => {
      setVisibleTermCardKeys((keys) => keys.filter((key) => key !== cardKey));
      if (restoreFocus) {
        const trigger = termTriggers.current.get(cardKey);
        queueMicrotask(() => trigger?.focus());
      }
    },
    [],
  );

  const closeDeepReading = useCallback(() => {
    deepReadingStore.hide();
    setDeepReading(null);
    setTextSelection(null);
  }, [deepReadingStore]);

  const abortAllDeepJobs = useCallback(() => {
    for (const job of deepJobs.current.values()) job.controller.abort();
    deepJobs.current.clear();
    deepReadingStore.reset();
  }, [deepReadingStore]);

  const popTermCard = useCallback((cardKey: string) => {
    setTermCardsByKey((cards) => {
      const state = cards[cardKey];
      const stack = state?.stack;
      if (!state || !stack || stack.length <= 1) return cards;
      const nextStack = stack.slice(0, -1);
      return {
        ...cards,
        [cardKey]: { ...nextStack.at(-1)!, stack: nextStack },
      };
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      const lastTermCardKey = visibleTermCardKeys.at(-1);
      if (event.key === "Escape" && lastTermCardKey) {
        event.preventDefault();
        const state = termCardsByKey[lastTermCardKey];
        if ((state?.stack?.length ?? 1) > 1) popTermCard(lastTermCardKey);
        else closeTermCard(lastTermCardKey);
        return;
      }
      if (event.key === "Escape" && deepReading) {
        event.preventDefault();
        closeDeepReading();
        return;
      }
      if (isTyping || !event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        hideAllTermCards();
        closeDeepReading();
        setError(null);
        setNavigation((history) => moveExplorationHistory(history, -1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        hideAllTermCards();
        closeDeepReading();
        setError(null);
        setNavigation((history) => moveExplorationHistory(history, 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeDeepReading,
    closeTermCard,
    deepReading,
    hideAllTermCards,
    popTermCard,
    termCardsByKey,
    visibleTermCardKeys,
  ]);

  useEffect(() => {
    if (!hasDocument) return;

    const captureSelection = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, textarea, select, .selection-action")) {
        return;
      }
      const selection = window.getSelection();
      if (!selection || selection.rangeCount !== 1 || selection.type !== "Range") {
        setTextSelection(null);
        return;
      }
      const text = selection.toString().replace(/\s+/gu, " ").trim();
      if (!text || Array.from(text).length > 600) {
        setTextSelection(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const common = selectionContainerElement(range.commonAncestorContainer);
      const nodeElement = common?.closest<HTMLElement>("[data-node-id]");
      const popoverElement = common?.closest<HTMLElement>(".term-popover");
      const deepElement = common?.closest<HTMLElement>(".deep-reading-section");
      let nodeId: string | null = nodeElement?.dataset.nodeId ?? null;
      let parentExplanation: TermExplanation | undefined;
      let parentDeepExplanation: DeepExplanation | undefined;
      if (
        deepElement &&
        deepReading?.explanation &&
        deepReading.sourceNodeId &&
        deepReading.sourceNodeId === deepElement.dataset.nodeId
      ) {
        nodeId = deepReading.sourceNodeId;
        parentDeepExplanation = deepReading.explanation;
      } else if (!nodeId && popoverElement) {
        const cardKey = popoverElement.getAttribute("data-term-card-key");
        const current = cardKey
          ? currentTermOverlayEntry(termCardsByKey[cardKey] ?? null)
          : null;
        nodeId = current?.nodeId ?? null;
        parentExplanation = current?.explanation;
      }
      if (
        !nodeId ||
        (!nodeElement && !parentExplanation && !parentDeepExplanation)
      ) {
        setTextSelection(null);
        return;
      }
      const bounds = range.getBoundingClientRect();
      setTextSelection({
        text,
        nodeId,
        parentExplanation,
        parentDeepExplanation,
        anchor:
          bounds.width > 0 || bounds.height > 0
            ? {
                top: Math.max(54, bounds.top),
                left: Math.min(
                  window.innerWidth - 112,
                  Math.max(112, bounds.left + bounds.width / 2),
                ),
              }
            : undefined,
      });
    };

    document.addEventListener("pointerup", captureSelection);
    document.addEventListener("keyup", captureSelection);
    return () => {
      document.removeEventListener("pointerup", captureSelection);
      document.removeEventListener("keyup", captureSelection);
    };
  }, [deepReading, hasDocument, termCardsByKey]);

  useEffect(
    () => () => {
      documentAbort.current?.abort();
      scenePrefetchAbort.current?.abort();
      abortAllTermJobs();
      termPrefetchAbort.current?.abort();
      abortAllDeepJobs();
      if (prefetchProfileSettleTimer.current) {
        clearTimeout(prefetchProfileSettleTimer.current);
        prefetchProfileSettleTimer.current = null;
      }
    },
    [abortAllDeepJobs, abortAllTermJobs],
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState !== "hidden";
      setPageVisible(visible);
      if (!visible) {
        scenePrefetchAbort.current?.abort();
        termPrefetchAbort.current?.abort();
      } else {
        setBackgroundRestart((value) => value + 1);
      }
    };
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const restoreKnowledgeSession = useCallback(
    (session: KnowledgeSession) => {
      documentAbort.current?.abort();
      scenePrefetchAbort.current?.abort();
      termPrefetchAbort.current?.abort();
      abortAllTermJobs();
      abortAllDeepJobs();
      documentRequestEpoch.current += 1;
      setDocumentRequest(null);

      const restoredTermCache = Object.fromEntries(
        session.termResults.map((result) => [result.key, result.explanation]),
      );
      const restoredTokens = new Map<string, string>();
      const restoredContexts = new WeakMap<
        TermExplanation | DeepExplanation,
        string
      >();
      for (const result of session.termResults) {
        restoredTokens.set(result.key, result.contextToken);
        restoredContexts.set(result.explanation, result.contextToken);
      }

      const restoredCards: Record<string, TermOverlayState> = {};
      for (const [cardKey, resultKeys] of Object.entries(session.termCards)) {
        const stack = resultKeys.flatMap((resultKey) => {
          const explanation = restoredTermCache[resultKey];
          if (!explanation) return [];
          return [
            {
              term: explanation.term,
              nodeId: explanation.nodeId,
              status: "ready" as const,
              explanation,
            },
          ];
        });
        if (stack.length !== resultKeys.length || stack.length === 0) continue;
        restoredCards[cardKey] = {
          ...stack.at(-1)!,
          stack,
        };
      }

      for (const result of session.deepResults) {
        restoredTokens.set(result.key, result.contextToken);
        restoredContexts.set(result.state.explanation, result.contextToken);
        const generation = deepRequestEpoch.current + 1;
        deepRequestEpoch.current = generation;
        deepReadingStore.activate(result.key);
        deepReadingStore.begin(result.key, generation);
        deepReadingStore.succeed(result.key, generation, result.state);
      }
      const activeDeepResult = session.activeDeepKey
        ? session.deepResults.find(
            (result) => result.key === session.activeDeepKey,
          )
        : null;
      if (activeDeepResult) deepReadingStore.activate(activeDeepResult.key);
      else deepReadingStore.hide();

      visualDocumentRef.current = session.document;
      termCacheRef.current = restoredTermCache;
      explanationContextTokens.current = restoredContexts;
      contextTokensByCacheKey.current = restoredTokens;
      latestSnapshot.current = session;
      sessionCreatedAt.current = session.createdAt;
      sessionRevision.current = session.revision;
      skipNextAutosave.current = true;

      setVisualDocument(session.document);
      setQuestion(session.document.question);
      setHasDocument(true);
      setNavigation(session.navigation);
      setTermCache(restoredTermCache);
      setTermCardsByKey(restoredCards);
      setVisibleTermCardKeys(session.visibleTermCardKeys);
      setDeepReading(activeDeepResult?.state ?? null);
      setTextSelection(null);
      setChatSelection(null);
      setChatPanelOpen(false);
      setScenePreparationByNodeId({});
      prefetchProfileIntentEpoch.current += 1;
      if (prefetchProfileSettleTimer.current) {
        clearTimeout(prefetchProfileSettleTimer.current);
        prefetchProfileSettleTimer.current = null;
      }
      setPrefetchProfile(session.prefetchProfile);
      setBackgroundPrefetchProfile(session.prefetchProfile);
      setUsageReceipts(session.usageReceipts);
      setActiveSessionId(session.id);
      setError(null);
      setDeepCacheRevision((revision) => revision + 1);
      termTriggers.current.clear();
      termPrefetchFailures.current.clear();
      scenePrefetchFailures.current.clear();
    },
    [abortAllDeepJobs, abortAllTermJobs, deepReadingStore],
  );

  const buildKnowledgeSessionSnapshot = useCallback(
    ({
      id,
      createdAt,
      updatedAt,
      revision,
    }: {
      id: string;
      createdAt: string;
      updatedAt: string;
      revision: number;
    }): KnowledgeSession => {
      const termEntries = Object.entries(termCache)
        .filter(([key]) => contextTokensByCacheKey.current.has(key))
        .slice(-KNOWLEDGE_SESSION_MAX_TERM_RESULTS);
      const retainedTermKeys = new Set(termEntries.map(([key]) => key));
      const keyByExplanation = new Map(
        termEntries.map(([key, explanation]) => [explanation, key]),
      );
      const termCards: Record<string, string[]> = {};
      for (const [cardKey, state] of Object.entries(termCardsByKey)) {
        if (Object.keys(termCards).length >= KNOWLEDGE_SESSION_MAX_TERM_CARDS) {
          break;
        }
        const stack = state.stack?.length ? state.stack : [state];
        const resultKeys = stack.flatMap((entry) => {
          if (entry.status !== "ready" || !entry.explanation) return [];
          const key = keyByExplanation.get(entry.explanation);
          return key ? [key] : [];
        });
        if (
          resultKeys.length === stack.length &&
          resultKeys[0] === cardKey &&
          resultKeys.every((key) => retainedTermKeys.has(key))
        ) {
          termCards[cardKey] = resultKeys;
        }
      }

      const deepSnapshot =
        deepReadingStore.snapshot() as unknown as DeepReadingCacheSnapshot;
      const deepResults = deepSnapshot.entries.flatMap((entry) => {
          const state = entry.status === "success" ? entry.value : null;
          const token = contextTokensByCacheKey.current.get(entry.key);
          if (
            !state ||
            state.status !== "ready" ||
            !state.explanation ||
            !state.sourceNodeId ||
            !token
          ) {
            return [];
          }
          return [
            {
              key: entry.key,
              state: state as PersistedDeepReadingState,
              contextToken: token,
            },
          ];
        })
        .slice(-KNOWLEDGE_SESSION_MAX_DEEP_RESULTS);
      const retainedDeepKeys = new Set(
        deepResults.map((result) => result.key),
      );
      const activeDeepKey =
        deepReadingStore.activeKey &&
        retainedDeepKeys.has(deepReadingStore.activeKey)
          ? deepReadingStore.activeKey
          : null;

      return createKnowledgeSession({
        id,
        createdAt,
        updatedAt,
        revision,
        document: visualDocument,
        navigation,
        termResults: termEntries.map(([key, explanation]) => ({
          key,
          explanation,
          contextToken: contextTokensByCacheKey.current.get(key)!,
        })),
        termCards,
        visibleTermCardKeys: visibleTermCardKeys.filter(
          (key) => key in termCards,
        ),
        deepResults,
        activeDeepKey,
        prefetchProfile,
        usageReceipts: usageReceipts.slice(
          -KNOWLEDGE_SESSION_MAX_USAGE_RECEIPTS,
        ),
      });
    },
    [
      deepReadingStore,
      navigation,
      prefetchProfile,
      termCache,
      termCardsByKey,
      usageReceipts,
      visibleTermCardKeys,
      visualDocument,
    ],
  );

  useEffect(() => {
    void refreshModelStatus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let repository: BackendKnowledgeSessionRepository;
    try {
      repository = new BackendKnowledgeSessionRepository();
      sessionRepository.current = repository;
    } catch {
      queueMicrotask(() => {
        if (cancelled) return;
        setHydrationReady(true);
        setSaveStatus("unavailable");
      });
      return;
    }

    void repository
      .restoreLatest()
      .then((result) => {
        if (cancelled) return;
        setSessionSummaries(result.sessions);
        if (result.session) restoreKnowledgeSession(result.session);
        setHydrationReady(true);
        setSaveStatus("saved");
      })
      .catch(() => {
        if (cancelled) return;
        setHydrationReady(true);
        setSaveStatus("error");
      });

    return () => {
      cancelled = true;
      if (sessionRepository.current === repository) {
        sessionRepository.current = null;
      }
      repository.close();
    };
  }, [restoreKnowledgeSession]);

  useEffect(() => {
    if (!hydrationReady || !hasDocument || !activeSessionId) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const repository = sessionRepository.current;
    if (!repository) {
      setSaveStatus("unavailable");
      return;
    }

    try {
      const now = new Date().toISOString();
      sessionCreatedAt.current ??= now;
      const revision = sessionRevision.current + 1;
      const snapshot = buildKnowledgeSessionSnapshot({
        id: activeSessionId,
        createdAt: sessionCreatedAt.current,
        updatedAt: now,
        revision,
      });
      sessionRevision.current = revision;
      latestSnapshot.current = snapshot;
      queueMicrotask(() => setSaveStatus("saving"));
      void repository
        .save(snapshot)
        .then((result) => {
          if (sessionRevision.current !== revision) return;
          setSessionSummaries(result.sessions);
          setSaveStatus("saved");
        })
        .catch(() => {
          if (sessionRevision.current === revision) setSaveStatus("error");
        });
    } catch {
      queueMicrotask(() => setSaveStatus("error"));
    }
  }, [
    activeSessionId,
    deepCacheRevision,
    deepReading,
    hasDocument,
    hydrationReady,
    navigation,
    prefetchProfile,
    saveRetry,
    termCache,
    termCardsByKey,
    usageReceipts,
    visibleTermCardKeys,
    visualDocument,
    buildKnowledgeSessionSnapshot,
  ]);

  useEffect(() => {
    const persistLatest = () => {
      const repository = sessionRepository.current;
      const snapshot = latestSnapshot.current;
      if (repository && snapshot) void repository.save(snapshot);
    };
    window.addEventListener("pagehide", persistLatest);
    return () => window.removeEventListener("pagehide", persistLatest);
  }, []);

  const storeTermExplanation = useCallback(
    (
      cacheKey: string,
      explanation: TermExplanation,
      contextToken?: string,
    ) => {
      if (contextToken) contextTokensByCacheKey.current.set(cacheKey, contextToken);
      setTermCache((cache) => {
        const next = { ...cache, [cacheKey]: explanation };
        termCacheRef.current = next;
        return next;
      });
    },
    [],
  );

  const rememberExplanationContext = useCallback(
    <T extends TermExplanation | DeepExplanation>(
      signed: SignedExplanation<T>,
      cacheKey: string,
    ): T => {
      explanationContextTokens.current.set(
        signed.explanation,
        signed.contextToken,
      );
      contextTokensByCacheKey.current.set(cacheKey, signed.contextToken);
      return signed.explanation;
    },
    [],
  );

  useEffect(() => {
    if (!hydrationReady || !hasDocument || documentRequest || !pageVisible) return;

    const documentSnapshot = visualDocument;
    const queue = buildScenePrefetchQueue(documentSnapshot, activeNode.id, {
      failedKeys: scenePrefetchFailures.current,
    });
    const frontierKey = prefetchFrontierKey(documentSnapshot, activeNode.id);
    const plan = buildPrefetchPlan({
      profile: backgroundPrefetchProfile,
      frontierKey,
      sceneQueue: queue,
      receipts: usageReceipts,
    });
    const item = plan.sceneQueue[0];
    if (!item) return;

    const controller = new AbortController();
    scenePrefetchAbort.current?.abort();
    scenePrefetchAbort.current = controller;
    const ownsScenePreparation = () =>
      scenePrefetchAbort.current === controller;
    const settleScenePreparation = (state: ScenePreparationState) => {
      if (!ownsScenePreparation()) return;
      setScenePreparationByNodeId((states) => ({
        ...states,
        [item.nodeId]: state,
      }));
    };
    setScenePreparationByNodeId((states) => ({
      ...states,
      [item.nodeId]: "preparing",
    }));

    void (async () => {
      const startedAt = performance.now();
      let requestStarted = false;
      let receiptRecorded = false;
      const record = (
        outcome: GenerationUsageReceipt["outcome"],
        usage: ModelUsageEvent[] = [],
      ) => {
        if (receiptRecorded || !requestStarted) return;
        receiptRecorded = true;
        appendUsageReceipt({
          action: "expand",
          lane: "background",
          model: "deepseek-v4-pro",
          durationMs: performance.now() - startedAt,
          outcome,
          frontierKey,
          resourceKey: item.nodeId,
          usage: aggregateModelUsage(usage),
          preparedConsumed: false,
        });
      };
      try {
        await waitForBackgroundTurn(controller.signal);
        requestStarted = true;
        const payload = await requestSceneExpansion(
          documentSnapshot,
          item.nodeId,
          controller.signal,
        );
        if (controller.signal.aborted) {
          record("aborted", payload.usage);
          settleScenePreparation("idle");
          return;
        }
        const authoritative = visualDocumentRef.current;
        if (
          !ownsScenePreparation() ||
          authoritative.id !== documentSnapshot.id ||
          authoritative.version !== documentSnapshot.version ||
          !payload.document ||
          !isVisualDocument(payload.document) ||
          payload.document.id !== documentSnapshot.id ||
          payload.document.version !== documentSnapshot.version + 1
        ) {
          record("discarded", payload.usage);
          settleScenePreparation("idle");
          return;
        }
        record("success", payload.usage);
        visualDocumentRef.current = payload.document;
        setVisualDocument(payload.document);
        scenePrefetchFailures.current.delete(item.key);
        settleScenePreparation("ready");
      } catch (prefetchError) {
        if (controller.signal.aborted || isAbortError(prefetchError)) {
          record("aborted");
          settleScenePreparation("idle");
          return;
        }
        record("error");
        if (!ownsScenePreparation()) return;
        scenePrefetchFailures.current.add(item.key);
        settleScenePreparation("failed");
      } finally {
        if (scenePrefetchAbort.current === controller) {
          scenePrefetchAbort.current = null;
        }
      }
    })();

    return () => controller.abort();
  }, [
    activeNode.id,
    appendUsageReceipt,
    backgroundRestart,
    documentRequest,
    hasDocument,
    hydrationReady,
    pageVisible,
    backgroundPrefetchProfile,
    usageReceipts,
    visualDocument,
  ]);

  useEffect(() => {
    if (!hydrationReady || !hasDocument || documentRequest || !pageVisible) return;

    const documentSnapshot = visualDocument;
    const frontierKey = prefetchFrontierKey(documentSnapshot, activeNode.id);
    const remainingScenePlan = buildPrefetchPlan({
      profile: backgroundPrefetchProfile,
      frontierKey,
      sceneQueue: buildScenePrefetchQueue(documentSnapshot, activeNode.id, {
        failedKeys: scenePrefetchFailures.current,
      }),
      receipts: usageReceipts,
    });
    if (remainingScenePlan.sceneQueue.length > 0) return;

    const nodesById = new Map(
      documentSnapshot.nodes.map((node) => [node.id, node]),
    );
    const candidateBatches = buildTermPrefetchBatches(documentSnapshot, {
      cachedKeys: termCacheRef.current,
      failedKeys: termPrefetchFailures.current,
      includedNodeIds: [activeNode.id, ...activeNode.childIds],
    }) as TermPrefetchBatch[];
    const plan = buildPrefetchPlan({
      profile: backgroundPrefetchProfile,
      frontierKey,
      termBatches: candidateBatches,
      receipts: usageReceipts,
    });
    const batches = plan.termBatches as TermPrefetchBatch[];
    if (batches.length === 0) return;

    const controller = new AbortController();
    termPrefetchAbort.current?.abort();
    termPrefetchAbort.current = controller;

    void (async () => {
      for (const batch of batches) {
        const pendingItems = batch.items.filter(
          (item) => !termCacheRef.current[item.key],
        );
        if (pendingItems.length === 0) continue;
        const startedAt = performance.now();
        let requestStarted = false;
        let receiptRecorded = false;
        const record = (
          outcome: GenerationUsageReceipt["outcome"],
          usage: ModelUsageEvent[] = [],
        ) => {
          if (receiptRecorded || !requestStarted) return;
          receiptRecorded = true;
          appendUsageReceipt({
            action: "define_batch",
            lane: "background",
            model: "deepseek-v4-flash",
            durationMs: performance.now() - startedAt,
            outcome,
            frontierKey,
            resourceKey: `terms:${batch.nodeId}`,
            usage: aggregateModelUsage(usage),
            preparedConsumed: false,
          });
        };
        try {
          await waitForBackgroundTurn(controller.signal);
          const node = nodesById.get(batch.nodeId);
          if (!node) continue;
          requestStarted = true;
          const result = await requestTermDefinitions(
            documentSnapshot,
            node,
            pendingItems.map((item) => item.term),
            controller.signal,
          );
          if (
            controller.signal.aborted ||
            termPrefetchAbort.current !== controller
          ) {
            record(controller.signal.aborted ? "aborted" : "discarded", result.usage);
            return;
          }
          record("success", result.usage);
          pendingItems.forEach((item, index) => {
            const signed = result.explanations[index];
            if (!signed) return;
            const explanation = rememberExplanationContext(signed, item.key);
            termPrefetchFailures.current.delete(item.key);
            storeTermExplanation(item.key, explanation, signed.contextToken);
          });
        } catch (prefetchError) {
          if (controller.signal.aborted || isAbortError(prefetchError)) {
            record("aborted");
            return;
          }
          record("error");
          if (termPrefetchAbort.current !== controller) return;
          pendingItems.forEach((item) =>
            termPrefetchFailures.current.add(item.key),
          );
          if (
            prefetchError instanceof StudioApiError &&
            isCredentialError(prefetchError.code)
          ) {
            return;
          }
        }
      }
    })();

    return () => {
      controller.abort();
      if (termPrefetchAbort.current === controller) {
        termPrefetchAbort.current = null;
      }
    };
  }, [
    documentRequest,
    activeNode.id,
    activeNode.childIds,
    appendUsageReceipt,
    hasDocument,
    hydrationReady,
    pageVisible,
    backgroundPrefetchProfile,
    rememberExplanationContext,
    storeTermExplanation,
    termPrefetchRestart,
    usageReceipts,
    visualDocument,
  ]);

  async function refreshModelStatus(): Promise<ModelSettingsStatus | null> {
    setModelStatusBusy(true);
    try {
      const response = await fetch("/api/model-settings", {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isModelSettingsStatus(payload)) {
        throw new Error(readSettingsError(payload));
      }
      setModelStatus(payload);
      return payload;
    } catch {
      const unavailable: ModelSettingsStatus = {
        configured: false,
        provider: "deepseek",
        model: "deepseek-v4-pro",
        source: "none",
        persistentAvailable: false,
        companionAvailable: false,
      };
      setModelStatus(unavailable);
      return unavailable;
    } finally {
      setModelStatusBusy(false);
    }
  }

  function openModelSettings() {
    setModelSettingsError(null);
    setModelSettingsOpen(true);
    void refreshModelStatus();
  }

  async function saveModelCredential(apiKey: string): Promise<boolean> {
    setModelStatusBusy(true);
    setModelSettingsError(null);
    try {
      const response = await fetch("/api/model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isModelSettingsStatus(payload)) {
        throw new Error(readSettingsError(payload));
      }
      setModelStatus(payload);
      setModelSettingsOpen(false);
      const queuedQuestion = pendingQuestion.current;
      pendingQuestion.current = null;
      if (queuedQuestion) {
        queueMicrotask(
          () =>
            void createExplanation(
              queuedQuestion.question,
              true,
              queuedQuestion.searchMode,
            ),
        );
      }
      return true;
    } catch (settingsRequestError) {
      setModelSettingsError(
        settingsRequestError instanceof Error
          ? settingsRequestError.message
          : "API Key 暂时无法保存，请稍后重试。",
      );
      return false;
    } finally {
      setModelStatusBusy(false);
    }
  }

  async function deleteModelCredential(): Promise<void> {
    setModelStatusBusy(true);
    setModelSettingsError(null);
    try {
      const response = await fetch("/api/model-settings", { method: "DELETE" });
      const payload = (await response.json()) as unknown;
      if (!response.ok || !isModelSettingsStatus(payload)) {
        throw new Error(readSettingsError(payload));
      }
      setModelStatus(payload);
    } catch (settingsRequestError) {
      setModelSettingsError(
        settingsRequestError instanceof Error
          ? settingsRequestError.message
          : "本地 API Key 暂时无法删除，请稍后重试。",
      );
    } finally {
      setModelStatusBusy(false);
    }
  }

  function requestCredential(
    error: unknown,
    queuedQuestion?: PendingQuestion,
  ): boolean {
    if (!(error instanceof StudioApiError) || !isCredentialError(error.code)) {
      return false;
    }
    if (queuedQuestion) pendingQuestion.current = queuedQuestion;
    setModelSettingsError(error.message);
    setModelSettingsOpen(true);
    void refreshModelStatus();
    return true;
  }

  function markPreparedConsumed(
    action: "expand" | "define_batch",
    resourceKey: string,
  ) {
    setUsageReceipts((receipts) => {
      const index = receipts.findLastIndex(
        (receipt) =>
          receipt.lane === "background" &&
          receipt.action === action &&
          receipt.outcome === "success" &&
          receipt.resourceKey === resourceKey &&
          !receipt.preparedConsumed,
      );
      if (index < 0) return receipts;
      return receipts.map((receipt, receiptIndex) =>
        receiptIndex === index
          ? { ...receipt, preparedConsumed: true }
          : receipt,
      );
    });
  }

  function recordForegroundCall(
    action: "define" | "dive",
    resourceKey: string,
    fallbackModel: string,
    startedAt: number,
    outcome: GenerationUsageReceipt["outcome"],
    usage: ModelUsageEvent[] = [],
  ) {
    appendUsageReceipt({
      action,
      lane: "foreground",
      model: usage.at(-1)?.model ?? fallbackModel,
      durationMs: performance.now() - startedAt,
      outcome,
      frontierKey: null,
      resourceKey,
      usage: aggregateModelUsage(usage),
      preparedConsumed: false,
    });
  }

  function changePrefetchProfile(profile: PregenerationProfile) {
    if (profile === prefetchProfile) return;
    const intentEpoch = prefetchProfileIntentEpoch.current + 1;
    prefetchProfileIntentEpoch.current = intentEpoch;
    scenePrefetchAbort.current?.abort();
    termPrefetchAbort.current?.abort();
    setPrefetchProfile(profile);
    setBackgroundPrefetchProfile("on_demand");
    if (prefetchProfileSettleTimer.current) {
      clearTimeout(prefetchProfileSettleTimer.current);
      prefetchProfileSettleTimer.current = null;
    }
    if (profile === "on_demand") return;
    prefetchProfileSettleTimer.current = setTimeout(() => {
      if (prefetchProfileIntentEpoch.current !== intentEpoch) return;
      prefetchProfileSettleTimer.current = null;
      setBackgroundPrefetchProfile(profile);
    }, PREFETCH_PROFILE_SETTLE_MS);
  }

  async function selectKnowledgeSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    const repository = sessionRepository.current;
    if (!repository) return;
    setSaveStatus("restoring");
    setError(null);
    try {
      const pendingSnapshot = latestSnapshot.current;
      if (pendingSnapshot) await repository.save(pendingSnapshot);
      const session = await repository.read(sessionId);
      if (!session) throw new Error("这条知识记录已不存在。");
      restoreKnowledgeSession(session);
      await repository.activate(session.id);
      setSessionSummaries(await repository.list());
      setSaveStatus("saved");
    } catch (selectionError) {
      setSaveStatus("error");
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "知识记录暂时无法恢复。",
      );
    }
  }

  function exportKnowledge(format: "json" | "markdown") {
    if (!hydrationReady || !hasDocument || !activeSessionId) return;
    try {
      const artifact = createKnowledgeExportArtifact(
        {
          document: visualDocument,
          navigation,
          termExplanations: Object.values(termCache),
          deepExplanations: (
            deepReadingStore.snapshot() as unknown as DeepReadingCacheSnapshot
          ).entries.flatMap((entry) =>
            entry.status === "success" && entry.value ? [entry.value] : [],
          ),
        },
        format,
      );
      downloadKnowledgeArtifact(artifact);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "知识文档暂时无法导出。",
      );
    }
  }

  async function createExplanation(
    questionOverride?: string,
    credentialReady = false,
    searchModeOverride?: CreateSearchMode,
  ) {
    if (!hydrationReady) return;
    const cleanQuestion = (questionOverride ?? question).trim();
    const requestedSearchMode =
      searchModeOverride ?? (createSearchEnabled ? "on" : "off");
    if (!cleanQuestion) {
      setError("请输入你的问题");
      return;
    }

    if (!credentialReady) {
      const status = modelStatus ?? (await refreshModelStatus());
      if (status?.persistentAvailable && !status.configured) {
        pendingQuestion.current = {
          question: cleanQuestion,
          searchMode: requestedSearchMode,
        };
        setModelSettingsError(
          status.companionAvailable
            ? null
            : "本地凭据服务未连接，请重新运行本地启动命令。",
        );
        setModelSettingsOpen(true);
        return;
      }
    }

    abortAllTermJobs();
    for (const job of deepJobs.current.values()) job.controller.abort();
    deepJobs.current.clear();
    hideAllTermCards();
    deepReadingStore.hide();
    setDeepReading(null);
    setTextSelection(null);
    setChatSelection(null);
    setChatPanelOpen(false);
    scenePrefetchAbort.current?.abort();
    termPrefetchAbort.current?.abort();
    documentAbort.current?.abort();
    const controller = new AbortController();
    documentAbort.current = controller;
    const requestId = documentRequestEpoch.current + 1;
    documentRequestEpoch.current = requestId;
    setDocumentRequest({ kind: "create", requestId });
    setError(null);
    const startedAt = performance.now();

    try {
      const response = await fetch("/api/lineage", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          question: cleanQuestion,
          sessionId: getSessionId(),
          searchMode: requestedSearchMode,
        }),
      });
      const payload = (await response.json()) as ApiPayload | VisualDocument;
      if (!response.ok) throw new StudioApiError(payload);
      if (requestId !== documentRequestEpoch.current) return;

      const nextDocument = isVisualDocument(payload)
        ? payload
        : payload.document && isVisualDocument(payload.document)
          ? payload.document
          : null;
      if (!nextDocument) throw new Error("AI 返回的解释结构不完整，请重新生成。");

      const now = new Date().toISOString();
      const nextSessionId = createLocalIdentity("knowledge");
      const usage =
        !isVisualDocument(payload) && Array.isArray(payload.usage)
          ? payload.usage
          : [];
      const createReceipt: GenerationUsageReceipt = {
        id: createLocalIdentity("usage"),
        recordedAt: now,
        action: "create",
        lane: "foreground",
        model:
          !isVisualDocument(payload) && typeof payload.model === "string"
            ? payload.model
            : "deepseek-v4-pro",
        durationMs: performance.now() - startedAt,
        outcome: "success",
        frontierKey: null,
        resourceKey: nextDocument.rootId,
        usage: aggregateModelUsage(usage),
        preparedConsumed: false,
      };

      abortAllDeepJobs();
      visualDocumentRef.current = nextDocument;
      setVisualDocument(nextDocument);
      setQuestion(nextDocument.question || cleanQuestion);
      setHasDocument(true);
      setNavigation(createExplorationHistory(nextDocument.rootId));
      termCacheRef.current = {};
      explanationContextTokens.current = new WeakMap();
      contextTokensByCacheKey.current.clear();
      setTermCache({});
      setTermCardsByKey({});
      setVisibleTermCardKeys([]);
      termTriggers.current.clear();
      termPrefetchFailures.current.clear();
      scenePrefetchFailures.current.clear();
      setScenePreparationByNodeId({});
      setUsageReceipts([createReceipt]);
      setActiveSessionId(nextSessionId);
      sessionCreatedAt.current = now;
      sessionRevision.current = 0;
      latestSnapshot.current = null;
      skipNextAutosave.current = false;
      setDeepCacheRevision((revision) => revision + 1);
    } catch (requestError) {
      if (isAbortError(requestError) || requestId !== documentRequestEpoch.current) return;
      if (
        requestCredential(requestError, {
          question: cleanQuestion,
          searchMode: requestedSearchMode,
        })
      ) {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "视觉解释暂时没有生成，请再试一次。",
      );
    } finally {
      if (requestId === documentRequestEpoch.current) {
        setDocumentRequest(null);
        documentAbort.current = null;
      }
    }
  }

  async function enterNode(node: VisualNode) {
    hideAllTermCards();
    closeDeepReading();
    setError(null);
    setNavigation((history) => pushExplorationHistory(history, node.id));

    const authoritativeDocument = visualDocumentRef.current;
    const currentNode =
      authoritativeDocument.nodes.find((candidate) => candidate.id === node.id) ?? node;

    if (
      currentNode.childIds.length > 0 ||
      !currentNode.expandable ||
      currentNode.expansionState === "terminal"
    ) {
      if (currentNode.childIds.length > 0) {
        markPreparedConsumed("expand", currentNode.id);
      }
      return;
    }

    termPrefetchAbort.current?.abort();
    scenePrefetchAbort.current?.abort();
    documentAbort.current?.abort();
    const controller = new AbortController();
    documentAbort.current = controller;
    const requestId = documentRequestEpoch.current + 1;
    documentRequestEpoch.current = requestId;
    setDocumentRequest({ kind: "expand", requestId, nodeId: currentNode.id });
    const baseDocument = visualDocumentRef.current;
    scenePrefetchFailures.current.delete(
      scenePreparationKey(baseDocument, currentNode),
    );
    const startedAt = performance.now();
    let receiptRecorded = false;
    const record = (
      outcome: GenerationUsageReceipt["outcome"],
      usage: ModelUsageEvent[] = [],
      model = "deepseek-v4-pro",
    ) => {
      if (receiptRecorded) return;
      receiptRecorded = true;
      appendUsageReceipt({
        action: "expand",
        lane: "foreground",
        model,
        durationMs: performance.now() - startedAt,
        outcome,
        frontierKey: null,
        resourceKey: currentNode.id,
        usage: aggregateModelUsage(usage),
        preparedConsumed: false,
      });
    };

    try {
      const response = await fetch("/api/lineage", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "expand",
          document: baseDocument,
          nodeId: currentNode.id,
          sessionId: getSessionId(),
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new StudioApiError(payload);
      if (requestId !== documentRequestEpoch.current) return;
      if (!payload.document || !isVisualDocument(payload.document)) {
        throw new Error("AI 返回的下一层结构不完整，请重新进入。");
      }

      record("success", payload.usage, payload.model);
      visualDocumentRef.current = payload.document;
      setVisualDocument(payload.document);
      setScenePreparationByNodeId((states) => ({
        ...states,
        [currentNode.id]: "ready",
      }));
    } catch (requestError) {
      if (isAbortError(requestError) || requestId !== documentRequestEpoch.current) {
        record("aborted");
        return;
      }
      record("error");
      if (requestCredential(requestError)) return;
      setScenePreparationByNodeId((states) => ({
        ...states,
        [currentNode.id]: "failed",
      }));
      setError(
        requestError instanceof Error
          ? requestError.message
          : "这一层暂时没有展开，请再试一次。",
      );
    } finally {
      if (requestId === documentRequestEpoch.current) {
        setDocumentRequest(null);
        documentAbort.current = null;
      }
    }
  }

  function moveInHistory(delta: -1 | 1) {
    hideAllTermCards();
    closeDeepReading();
    setError(null);
    setNavigation((history) => moveExplorationHistory(history, delta));
  }

  async function explainTerm(
    node: VisualNode,
    term: string,
    trigger: HTMLButtonElement,
  ) {
    const selectedTerm = term.trim();
    if (!selectedTerm) return;
    const cacheKey = termExplanationCacheKey(
      visualDocument,
      node,
      selectedTerm,
    );
    termTriggers.current.set(cacheKey, trigger);
    const cached = termCacheRef.current[cacheKey];
    if (cached) {
      markPreparedConsumed("define_batch", `terms:${node.id}`);
      const entry: TermOverlayEntry = {
        term: selectedTerm,
        nodeId: node.id,
        status: "ready",
        explanation: cached,
      };
      showTermCard(cacheKey, { ...entry, stack: [entry] });
      return;
    }

    const existingJob = termJobs.current.get(cacheKey);
    if (existingJob) {
      const loadingEntry: TermOverlayEntry = {
        term: selectedTerm,
        nodeId: node.id,
        status: "loading",
        requestIdentity: existingJob.generation,
      };
      revealTermCard(cacheKey, { ...loadingEntry, stack: [loadingEntry] });
      return;
    }

    termPrefetchAbort.current?.abort();
    const job = beginTermJob(cacheKey);
    const startedAt = performance.now();
    const loadingEntry: TermOverlayEntry = {
      term: selectedTerm,
      nodeId: node.id,
      status: "loading",
      requestIdentity: job.generation,
    };
    showTermCard(cacheKey, { ...loadingEntry, stack: [loadingEntry] });

    try {
      const signed = await requestTermDefinition(
        visualDocument,
        node,
        selectedTerm,
        job.controller.signal,
      );
      if (!termJobIsCurrent(cacheKey, job.generation)) return;
      const explanation = rememberExplanationContext(signed, cacheKey);

      termPrefetchFailures.current.delete(cacheKey);
      storeTermExplanation(cacheKey, explanation, signed.contextToken);
      recordForegroundCall(
        "define",
        cacheKey,
        "deepseek-v4-flash",
        startedAt,
        "success",
        signed.usage,
      );
      const entry: TermOverlayEntry = {
        term: selectedTerm,
        nodeId: node.id,
        status: "ready",
        explanation,
      };
      replaceCurrentTermCardEntry(cacheKey, entry, job.generation);
    } catch (requestError) {
      if (isAbortError(requestError)) {
        recordForegroundCall(
          "define",
          cacheKey,
          "deepseek-v4-flash",
          startedAt,
          "aborted",
        );
        return;
      }
      if (!termJobIsCurrent(cacheKey, job.generation)) return;
      recordForegroundCall(
        "define",
        cacheKey,
        "deepseek-v4-flash",
        startedAt,
        "error",
      );
      requestCredential(requestError);
      termPrefetchFailures.current.add(cacheKey);
      const entry: TermOverlayEntry = {
        term: selectedTerm,
        nodeId: node.id,
        status: "error",
        error:
          requestError instanceof Error
            ? requestError.message
            : "名词解释暂时不可用，请稍后重试。",
      };
      replaceCurrentTermCardEntry(cacheKey, entry, job.generation);
    } finally {
      finishTermJob(cacheKey, job.generation);
      setTermPrefetchRestart((value) => value + 1);
    }
  }

  async function explainNestedTerm(
    cardKey: string,
    parent: TermOverlayEntry,
    term: string,
  ) {
    if (!parent.explanation) return;
    if (parent.explanation.termPath.length >= 4) {
      await requestDeepReading(parent.nodeId, term, parent.explanation);
      return;
    }
    const documentSnapshot = visualDocumentRef.current;
    const node = documentSnapshot.nodes.find(
      (candidate) => candidate.id === parent.nodeId,
    );
    if (!node) return;
    const selectedTerm = term.trim();
    if (!selectedTerm) return;
    const cacheKey = nestedTermExplanationCacheKey(
      documentSnapshot,
      node,
      selectedTerm,
      parent.explanation,
    );
    const cached = termCacheRef.current[cacheKey];
    if (cached) {
      markPreparedConsumed("define_batch", `terms:${node.id}`);
      pushTermCardEntry(cardKey, {
        term: selectedTerm,
        nodeId: node.id,
        status: "ready",
        explanation: cached,
      });
      return;
    }

    const existingJob = termJobs.current.get(cacheKey);
    if (existingJob) {
      pushTermCardEntry(cardKey, {
        term: selectedTerm,
        nodeId: node.id,
        status: "loading",
        requestIdentity: existingJob.generation,
      });
      return;
    }

    termPrefetchAbort.current?.abort();
    const job = beginTermJob(cacheKey);
    const startedAt = performance.now();
    pushTermCardEntry(cardKey, {
      term: selectedTerm,
      nodeId: node.id,
      status: "loading",
      requestIdentity: job.generation,
    });

    try {
      const signed = await requestTermDefinition(
        documentSnapshot,
        node,
        selectedTerm,
        job.controller.signal,
        parent.explanation,
        undefined,
        explanationContextTokens.current.get(parent.explanation),
      );
      if (!termJobIsCurrent(cacheKey, job.generation)) return;
      const explanation = rememberExplanationContext(signed, cacheKey);
      termPrefetchFailures.current.delete(cacheKey);
      storeTermExplanation(cacheKey, explanation, signed.contextToken);
      recordForegroundCall(
        "define",
        cacheKey,
        "deepseek-v4-flash",
        startedAt,
        "success",
        signed.usage,
      );
      replaceCurrentTermCardEntry(
        cardKey,
        {
          term: selectedTerm,
          nodeId: node.id,
          status: "ready",
          explanation,
        },
        job.generation,
      );
    } catch (requestError) {
      if (isAbortError(requestError)) {
        recordForegroundCall(
          "define",
          cacheKey,
          "deepseek-v4-flash",
          startedAt,
          "aborted",
        );
        return;
      }
      if (!termJobIsCurrent(cacheKey, job.generation)) return;
      recordForegroundCall(
        "define",
        cacheKey,
        "deepseek-v4-flash",
        startedAt,
        "error",
      );
      requestCredential(requestError);
      termPrefetchFailures.current.add(cacheKey);
      replaceCurrentTermCardEntry(
        cardKey,
        {
          term: selectedTerm,
          nodeId: node.id,
          status: "error",
          error:
            requestError instanceof Error
              ? requestError.message
              : "这一层名词解释暂时不可用，请稍后重试。",
        },
        job.generation,
      );
    } finally {
      finishTermJob(cacheKey, job.generation);
      setTermPrefetchRestart((value) => value + 1);
    }
  }

  function beginTermJob(cacheKey: string) {
    const generation = termRequestEpoch.current + 1;
    termRequestEpoch.current = generation;
    const job = { generation, controller: new AbortController() };
    termJobs.current.set(cacheKey, job);
    return job;
  }

  function termJobIsCurrent(cacheKey: string, generation: number): boolean {
    return termJobs.current.get(cacheKey)?.generation === generation;
  }

  function finishTermJob(cacheKey: string, generation: number) {
    if (termJobIsCurrent(cacheKey, generation)) termJobs.current.delete(cacheKey);
  }

  function showTermCard(cardKey: string, state: TermOverlayState) {
    setTermCardsByKey((cards) => ({ ...cards, [cardKey]: state }));
    setVisibleTermCardKeys((keys) => [
      ...keys.filter((key) => key !== cardKey),
      cardKey,
    ]);
  }

  function revealTermCard(cardKey: string, fallback: TermOverlayState) {
    setTermCardsByKey((cards) =>
      cards[cardKey] ? cards : { ...cards, [cardKey]: fallback },
    );
    setVisibleTermCardKeys((keys) => [
      ...keys.filter((key) => key !== cardKey),
      cardKey,
    ]);
  }

  function pushTermCardEntry(cardKey: string, entry: TermOverlayEntry) {
    setTermCardsByKey((cards) => {
      const state = cards[cardKey];
      const stack = state?.stack?.length ? state.stack : state ? [state] : [];
      const nextStack = [...stack, entry];
      return {
        ...cards,
        [cardKey]: { ...entry, stack: nextStack },
      };
    });
    setVisibleTermCardKeys((keys) => [
      ...keys.filter((key) => key !== cardKey),
      cardKey,
    ]);
  }

  function replaceCurrentTermCardEntry(
    cardKey: string,
    entry: TermOverlayEntry,
    requestIdentity: number,
  ) {
    setTermCardsByKey((cards) => {
      const state = cards[cardKey];
      const stack = state?.stack?.length ? state.stack : state ? [state] : [];
      if (stack.at(-1)?.requestIdentity !== requestIdentity) return cards;
      const nextStack = stack.length > 0 ? [...stack.slice(0, -1), entry] : [entry];
      return {
        ...cards,
        [cardKey]: { ...entry, stack: nextStack },
      };
    });
  }

  async function explainDeepReadingTerm(
    term: string,
    trigger: HTMLButtonElement,
  ) {
    const parentDeepExplanation = deepReading?.explanation;
    const sourceNodeId = deepReading?.sourceNodeId;
    const selectedTerm = term.trim();
    if (!parentDeepExplanation || !sourceNodeId || !selectedTerm) return;

    const documentSnapshot = visualDocumentRef.current;
    const node = documentSnapshot.nodes.find(
      (candidate) => candidate.id === sourceNodeId,
    );
    if (!node || parentDeepExplanation.nodeId !== node.id) return;

    const cacheKey = deepTermExplanationCacheKey(
      documentSnapshot,
      node,
      selectedTerm,
      parentDeepExplanation,
    );
    const cached = termCacheRef.current[cacheKey];
    termTriggers.current.set(cacheKey, trigger);
    if (cached) {
      markPreparedConsumed("define_batch", `terms:${node.id}`);
      const entry: TermOverlayEntry = {
        term: selectedTerm,
        nodeId: node.id,
        status: "ready",
        explanation: cached,
      };
      showTermCard(cacheKey, { ...entry, stack: [entry] });
      return;
    }

    const existingJob = termJobs.current.get(cacheKey);
    if (existingJob) {
      const loadingEntry: TermOverlayEntry = {
        term: selectedTerm,
        nodeId: node.id,
        status: "loading",
        requestIdentity: existingJob.generation,
      };
      revealTermCard(cacheKey, { ...loadingEntry, stack: [loadingEntry] });
      return;
    }

    termPrefetchAbort.current?.abort();
    const job = beginTermJob(cacheKey);
    const startedAt = performance.now();
    const loadingEntry: TermOverlayEntry = {
      term: selectedTerm,
      nodeId: node.id,
      status: "loading",
      requestIdentity: job.generation,
    };
    showTermCard(cacheKey, { ...loadingEntry, stack: [loadingEntry] });

    try {
      const signed = await requestTermDefinition(
        documentSnapshot,
        node,
        selectedTerm,
        job.controller.signal,
        undefined,
        parentDeepExplanation,
        explanationContextTokens.current.get(parentDeepExplanation),
      );
      if (!termJobIsCurrent(cacheKey, job.generation)) return;
      const explanation = rememberExplanationContext(signed, cacheKey);
      termPrefetchFailures.current.delete(cacheKey);
      storeTermExplanation(cacheKey, explanation, signed.contextToken);
      recordForegroundCall(
        "define",
        cacheKey,
        "deepseek-v4-flash",
        startedAt,
        "success",
        signed.usage,
      );
      replaceCurrentTermCardEntry(
        cacheKey,
        {
          term: selectedTerm,
          nodeId: node.id,
          status: "ready",
          explanation,
        },
        job.generation,
      );
    } catch (requestError) {
      if (isAbortError(requestError)) {
        recordForegroundCall(
          "define",
          cacheKey,
          "deepseek-v4-flash",
          startedAt,
          "aborted",
        );
        return;
      }
      if (!termJobIsCurrent(cacheKey, job.generation)) return;
      recordForegroundCall(
        "define",
        cacheKey,
        "deepseek-v4-flash",
        startedAt,
        "error",
      );
      requestCredential(requestError);
      termPrefetchFailures.current.add(cacheKey);
      replaceCurrentTermCardEntry(
        cacheKey,
        {
          term: selectedTerm,
          nodeId: node.id,
          status: "error",
          error:
            requestError instanceof Error
              ? requestError.message
              : "这一层名词解释暂时不可用，请稍后重试。",
        },
        job.generation,
      );
    } finally {
      finishTermJob(cacheKey, job.generation);
      setTermPrefetchRestart((value) => value + 1);
    }
  }

  async function deepenNodeTerm(
    node: VisualNode,
    term: string,
  ) {
    await requestDeepReading(node.id, term, undefined);
  }

  async function deepenNestedTerm(
    _cardKey: string,
    parent: TermOverlayEntry,
    term: string,
  ) {
    await requestDeepReading(parent.nodeId, term, parent.explanation);
  }

  async function deepenTermEntry(
    _cardKey: string,
    entry: TermOverlayEntry,
  ) {
    await requestDeepReading(entry.nodeId, entry.term, entry.explanation);
  }

  async function deepenDeepReadingTerm(term: string) {
    if (!deepReading?.sourceNodeId || !deepReading.explanation) return;
    await requestDeepReading(
      deepReading.sourceNodeId,
      term,
      undefined,
      deepReading.explanation,
    );
  }

  async function deepenSelectedText() {
    if (!textSelection) return;
    await requestDeepReading(
      textSelection.nodeId,
      textSelection.text,
      textSelection.parentExplanation,
      textSelection.parentDeepExplanation,
    );
  }

  function askAboutSelectedText() {
    if (!textSelection) return;
    const parentContext =
      textSelection.parentExplanation ?? textSelection.parentDeepExplanation;
    const contextToken = parentContext
      ? explanationContextTokens.current.get(parentContext)
      : undefined;
    setChatSelection({
      nodeId: textSelection.nodeId,
      text: textSelection.text,
      ...(contextToken ? { contextToken } : {}),
    });
    setChatPanelOpen(true);
    setTextSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  async function requestDeepReading(
    nodeId: string,
    subject: string,
    parentExplanation?: TermExplanation,
    parentDeepExplanation?: DeepExplanation,
  ) {
    const cleanSubject = subject.replace(/\s+/gu, " ").trim();
    if (!cleanSubject) return;
    const documentSnapshot = visualDocumentRef.current;
    const node = documentSnapshot.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;

    termPrefetchAbort.current?.abort();
    const cacheKey = deepReadingCacheKey(
      documentSnapshot,
      node,
      cleanSubject,
      parentExplanation
        ? { parentTermExplanation: parentExplanation }
        : parentDeepExplanation
          ? { parentDeepExplanation }
          : {},
    );
    const store = deepReadingStore;
    store.activate(cacheKey);
    const cachedEntry = store.get(cacheKey) as
      | {
          status: "pending" | "success" | "error";
          value?: DeepReadingState;
        }
      | null;
    if (cachedEntry?.status === "success") {
      if (!cachedEntry.value) return;
      setDeepReading(cachedEntry.value);
      setTextSelection(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    const existingJob = deepJobs.current.get(cacheKey);
    if (cachedEntry?.status === "pending" && existingJob) {
      setDeepReading({
        status: "loading",
        subject: cleanSubject,
        sourceNodeId: node.id,
      });
      return;
    }

    const controller = new AbortController();
    const requestId = deepRequestEpoch.current + 1;
    deepRequestEpoch.current = requestId;
    store.begin(cacheKey, requestId);
    deepJobs.current.set(cacheKey, {
      generation: requestId,
      controller,
    });
    const startedAt = performance.now();
    setTextSelection((selection) =>
      selection ? { ...selection, busy: true } : selection,
    );
    setDeepReading({
      status: "loading",
      subject: cleanSubject,
      sourceNodeId: node.id,
    });

    try {
      const signed = await requestDeepExplanation(
        documentSnapshot,
        node,
        cleanSubject,
        controller.signal,
        parentExplanation,
        parentDeepExplanation,
        parentExplanation
          ? explanationContextTokens.current.get(parentExplanation)
          : parentDeepExplanation
            ? explanationContextTokens.current.get(parentDeepExplanation)
            : undefined,
      );
      const explanation = rememberExplanationContext(signed, cacheKey);
      const nextState = toDeepReadingState(explanation);
      if (!store.succeed(cacheKey, requestId, nextState)) return;
      contextTokensByCacheKey.current.set(cacheKey, signed.contextToken);
      setDeepCacheRevision((revision) => revision + 1);
      recordForegroundCall(
        "dive",
        cacheKey,
        "deepseek-v4-pro",
        startedAt,
        "success",
        signed.usage,
      );
      if (store.activeKey === cacheKey) {
        setDeepReading(nextState);
        setTextSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    } catch (requestError) {
      if (isAbortError(requestError)) {
        recordForegroundCall(
          "dive",
          cacheKey,
          "deepseek-v4-pro",
          startedAt,
          "aborted",
        );
        return;
      }
      recordForegroundCall(
        "dive",
        cacheKey,
        "deepseek-v4-pro",
        startedAt,
        "error",
      );
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : "深入解释暂时不可用，请稍后重试。";
      if (!store.fail(cacheKey, requestId, errorMessage)) return;
      if (requestCredential(requestError)) {
        if (store.activeKey === cacheKey) setDeepReading(null);
        return;
      }
      if (store.activeKey === cacheKey) setDeepReading({
        status: "error",
        subject: cleanSubject,
        sourceNodeId: node.id,
        error:
          requestError instanceof Error
            ? requestError.message
            : "深入解释暂时不可用，请稍后重试。",
      });
    } finally {
      const currentJob = deepJobs.current.get(cacheKey);
      if (currentJob?.generation === requestId) {
        deepJobs.current.delete(cacheKey);
      }
      if (store.activeKey === cacheKey) {
        setTextSelection((selection) =>
          selection ? { ...selection, busy: false } : selection,
        );
      }
    }
  }

  const chatAvailable =
    hasDocument && !isCreating && activeSessionId !== null;
  const chatWorkspaceVisible = chatAvailable && chatPanelOpen;
  const termWorkspaceVisible =
    hasDocument && !isCreating && visibleTermCards.length > 0;

  return (
    <main
      className={`visual-app ${started ? "has-started" : "is-idle"}${
        chatWorkspaceVisible ? " has-chat-workspace" : ""
      }${termWorkspaceVisible ? " has-term-workspace" : ""}`}
    >
      <QuestionComposer
        question={question}
        started={started}
        busy={isCreating || !hydrationReady}
        modelConfigured={Boolean(modelStatus?.configured)}
        modelStatusBusy={modelStatusBusy}
        onQuestionChange={setQuestion}
        onCreate={() => void createExplanation()}
        onOpenModelSettings={openModelSettings}
      />

      <HistoryControls
        visible={hasDocument && !isCreating}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={() => moveInHistory(-1)}
        onForward={() => moveInHistory(1)}
      />

      <KnowledgeSessionControls
        visible={hydrationReady && !isCreating}
        activeSessionId={activeSessionId}
        sessions={sessionSummaries}
        profile={prefetchProfile}
        receipts={usageReceipts}
        saveStatus={saveStatus}
        onProfileChange={changePrefetchProfile}
        onSelectSession={(sessionId) => void selectKnowledgeSession(sessionId)}
        onExport={exportKnowledge}
        onRetrySave={() => setSaveRetry((retry) => retry + 1)}
      />

      {started ? (
        <div
          className={`experience-stage${
            chatWorkspaceVisible ? " has-chat-workspace" : ""
          }${termWorkspaceVisible ? " has-term-workspace" : ""}`}
        >
          {chatAvailable ? (
            <SelectionChatPanel
              key={activeSessionId}
              sessionId={activeSessionId}
              selection={chatSelection}
              open={chatPanelOpen}
              onOpenChange={setChatPanelOpen}
              onClearSelection={() => setChatSelection(null)}
            />
          ) : null}
          {isCreating ? (
            <CreationLoading question={question.trim()} />
          ) : hasDocument ? (
            <StageColumn
              activeNode={activeNode}
              primaryMaterial={
                activeNode.depth === 0 ? visualDocument.primaryMaterial : null
              }
              childNodes={children}
              relations={relations}
              scenePreparationByNodeId={scenePreparationByNodeId}
              isLoadingCurrent={isLoadingCurrent}
              error={error}
              onEnter={enterNode}
              onExplain={explainTerm}
              onDeepen={deepenNodeTerm}
              deepReading={deepReading}
              onCloseDeepReading={closeDeepReading}
              onExplainDeepTerm={explainDeepReadingTerm}
              onDeepenDeepTerm={deepenDeepReadingTerm}
              selectionAction={textSelection}
              onAskSelection={askAboutSelectedText}
              onDeepenSelection={deepenSelectedText}
              onClearError={() => setError(null)}
            />
          ) : null}
          {hasDocument && !isCreating && visibleTermCards.length > 0 ? (
            <TermWorkspace
              cards={visibleTermCards}
              onClose={closeTermCard}
              onBack={popTermCard}
              onExplainNested={explainNestedTerm}
              onDeepenTerm={deepenNestedTerm}
              onDeepen={deepenTermEntry}
            />
          ) : null}
        </div>
      ) : null}

      {!started && error ? (
        <div className="entry-error" role="alert">
          {error}
        </div>
      ) : null}

      <ModelSettingsDialog
        open={modelSettingsOpen}
        status={modelStatus}
        busy={modelStatusBusy}
        error={modelSettingsError}
        searchEnabled={createSearchEnabled}
        onClose={() => {
          setModelSettingsOpen(false);
          setModelSettingsError(null);
          pendingQuestion.current = null;
        }}
        onSave={saveModelCredential}
        onDelete={deleteModelCredential}
        onSearchEnabledChange={setCreateSearchEnabled}
      />
    </main>
  );
}

function aggregateModelUsage(
  events: readonly ModelUsageEvent[],
): GenerationUsageReceipt["usage"] {
  const unknown = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    promptCacheHitTokens: null,
    promptCacheMissTokens: null,
  };
  if (events.length === 0 || events.some((event) => event.usage === null)) {
    return unknown;
  }

  const usages = events.map((event) => event.usage!);
  const sum = (select: (usage: NonNullable<ModelUsageEvent["usage"]>) => number) =>
    usages.reduce((total, usage) => total + select(usage), 0);
  const sumNullable = (
    select: (
      usage: NonNullable<ModelUsageEvent["usage"]>,
    ) => number | null,
  ) =>
    usages.every((usage) => select(usage) !== null)
      ? usages.reduce(
          (total, usage) => total + (select(usage) ?? 0),
          0,
        )
      : null;

  return {
    promptTokens: sum((usage) => usage.promptTokens),
    completionTokens: sum((usage) => usage.completionTokens),
    totalTokens: sum((usage) => usage.totalTokens),
    promptCacheHitTokens: sumNullable(
      (usage) => usage.promptCacheHitTokens,
    ),
    promptCacheMissTokens: sumNullable(
      (usage) => usage.promptCacheMissTokens,
    ),
  };
}

function createLocalIdentity(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function downloadKnowledgeArtifact(artifact: KnowledgeExportArtifact): void {
  const blob = new Blob([artifact.content], {
    type: `${artifact.mediaType};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

async function requestTermDefinition(
  document: VisualDocument,
  node: VisualNode,
  term: string,
  signal: AbortSignal,
  parentExplanation?: TermExplanation,
  parentDeepExplanation?: DeepExplanation,
  parentContextToken?: string,
): Promise<SignedExplanation<TermExplanation>> {
  const response = await fetch("/api/lineage", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "define",
      document,
      nodeId: node.id,
      term,
      parentExplanation,
      parentDeepExplanation,
      parentContextToken,
      sessionId: getSessionId(),
    }),
  });
  const payload = (await response.json()) as ApiPayload;
  if (!response.ok) throw new StudioApiError(payload);
  if (!isTermExplanation(payload.explanation)) {
    throw new Error("AI 返回的名词解释不完整，请再试一次。");
  }
  return {
    explanation: payload.explanation,
    contextToken: readExplanationContextToken(payload.contextToken),
    usage: payload.usage ?? [],
  };
}

async function requestTermDefinitions(
  document: VisualDocument,
  node: VisualNode,
  terms: string[],
  signal: AbortSignal,
): Promise<{
  explanations: Array<SignedExplanation<TermExplanation>>;
  usage: ModelUsageEvent[];
}> {
  const response = await fetch("/api/lineage", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "define_batch",
      document,
      nodeId: node.id,
      terms,
      sessionId: getSessionId(),
    }),
  });
  const payload = (await response.json()) as ApiPayload;
  if (!response.ok) throw new StudioApiError(payload);
  if (
    !Array.isArray(payload.explanations) ||
    payload.explanations.length !== terms.length ||
    !payload.explanations.every(isTermExplanation) ||
    !Array.isArray(payload.contextTokens) ||
    payload.contextTokens.length !== terms.length
  ) {
    throw new Error("AI 返回的批量名词解释不完整，请再试一次。");
  }
  const usage = payload.usage ?? [];
  return {
    explanations: payload.explanations.map((explanation, index) => ({
      explanation,
      contextToken: readExplanationContextToken(payload.contextTokens?.[index]),
      usage,
    })),
    usage,
  };
}

async function requestDeepExplanation(
  document: VisualDocument,
  node: VisualNode,
  selection: string,
  signal: AbortSignal,
  parentExplanation?: TermExplanation,
  parentDeepExplanation?: DeepExplanation,
  parentContextToken?: string,
): Promise<SignedExplanation<DeepExplanation>> {
  const response = await fetch("/api/lineage", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "dive",
      document,
      nodeId: node.id,
      selection,
      parentExplanation,
      parentDeepExplanation,
      parentContextToken,
      sessionId: getSessionId(),
    }),
  });
  const payload = (await response.json()) as ApiPayload;
  if (!response.ok) throw new StudioApiError(payload);
  if (!isDeepExplanation(payload.deepExplanation ?? payload.explanation)) {
    throw new Error("AI 返回的深入解释不完整，请再试一次。");
  }
  return {
    explanation: (payload.deepExplanation ?? payload.explanation) as DeepExplanation,
    contextToken: readExplanationContextToken(payload.contextToken),
    usage: payload.usage ?? [],
  };
}

function readExplanationContextToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^ect1\.[A-Za-z0-9_-]{43}$/u.test(value)
  ) {
    throw new Error("AI 返回的解释上下文凭据不完整，请重新生成解释。");
  }
  return value;
}

async function requestSceneExpansion(
  document: VisualDocument,
  nodeId: string,
  signal: AbortSignal,
): Promise<ApiPayload> {
  const response = await fetch("/api/lineage", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "expand",
      document,
      nodeId,
      sessionId: getSessionId(),
    }),
  });
  const payload = (await response.json()) as ApiPayload;
  if (!response.ok) throw new StudioApiError(payload);
  return payload;
}

function toDeepReadingState(explanation: DeepExplanation): DeepReadingState {
  return {
    status: "ready",
    subject: explanation.subject,
    sourceNodeId: explanation.nodeId,
    explanation,
    title: `深入理解：${explanation.subject}`,
    terms: explanation.terms,
    paragraphs: [
      { id: "direct", label: "直接理解", text: explanation.directAnswer },
      { id: "background", label: "为什么会出现", text: explanation.background },
      { id: "role", label: "在这里的作用", text: explanation.role },
      { id: "mechanism", label: "它如何工作", text: explanation.mechanism },
      { id: "boundary", label: "边界", text: explanation.boundary },
    ],
  };
}

function currentTermOverlayEntry(
  state: TermOverlayState | null,
): TermOverlayEntry | null {
  if (!state) return null;
  return state.stack?.at(-1) ?? state;
}

function selectionContainerElement(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

function waitForBackgroundTurn(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(finish, 250);
    signal.addEventListener("abort", abort, { once: true });
  });
}

class StudioApiError extends Error {
  readonly code: string;

  constructor(payload: ApiPayload | VisualDocument) {
    super(readApiError(payload));
    this.name = "StudioApiError";
    this.code =
      !isVisualDocument(payload) &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      typeof payload.error.code === "string"
        ? payload.error.code
        : "request_failed";
  }
}

function isCredentialError(code: string): boolean {
  return [
    "credential_required",
    "invalid_credential",
    "provider_auth_failed",
    "local_companion_required",
    "local_companion_unavailable",
  ].includes(code);
}

function isModelSettingsStatus(value: unknown): value is ModelSettingsStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const status = value as Partial<ModelSettingsStatus>;
  return (
    typeof status.configured === "boolean" &&
    status.provider === "deepseek" &&
    status.model === "deepseek-v4-pro" &&
    ["local_vault", "environment", "none"].includes(status.source ?? "") &&
    typeof status.persistentAvailable === "boolean" &&
    typeof status.companionAvailable === "boolean"
  );
}

function readSettingsError(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "模型设置暂时不可用。";
  }
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return "模型设置暂时不可用。";
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.length <= 240
    ? message
    : "模型设置暂时不可用。";
}

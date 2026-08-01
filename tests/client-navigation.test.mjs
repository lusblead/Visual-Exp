import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createExplorationHistory,
  moveExplorationHistory,
  pushExplorationHistory,
} from "../lib/exploration-history.mjs";
import { shouldEnterKnowledgeNode } from "../lib/knowledge-node-interaction.mjs";

test("exploration history supports backward, forward, and branch replacement", () => {
  let history = createExplorationHistory("root");
  history = pushExplorationHistory(history, "a");
  history = pushExplorationHistory(history, "a");
  history = pushExplorationHistory(history, "a-1");
  assert.deepEqual(history, { entries: ["root", "a", "a-1"], cursor: 2 });

  history = moveExplorationHistory(history, -1);
  assert.equal(history.entries[history.cursor], "a");
  history = moveExplorationHistory(history, 1);
  assert.equal(history.entries[history.cursor], "a-1");

  history = moveExplorationHistory(history, -1);
  history = pushExplorationHistory(history, "a-2");
  assert.deepEqual(history, { entries: ["root", "a", "a-2"], cursor: 2 });
  assert.equal(moveExplorationHistory(history, 1), history);
});

test("a new document starts with only its root", () => {
  const history = createExplorationHistory("new-root");
  assert.deepEqual(history, { entries: ["new-root"], cursor: 0 });
});

test("knowledge-node click keeps term explanation and scene entry mutually exclusive", () => {
  assert.equal(
    shouldEnterKnowledgeNode({
      targetIsInteractive: true,
      selectionType: "None",
    }),
    false,
    "an inline Agent or RAG button owns its click and must not enter the node",
  );
  assert.equal(
    shouldEnterKnowledgeNode({
      targetIsInteractive: false,
      selectionType: "None",
    }),
    true,
    "ordinary title, summary, or detail prose enters the node",
  );
  assert.equal(
    shouldEnterKnowledgeNode({
      targetIsInteractive: false,
      selectionType: "Range",
    }),
    false,
    "selecting text must not navigate or request a definition",
  );
});

test("current-layer term preparation is batched and foreground clicks take priority", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(controller, /buildTermPrefetchBatches\(documentSnapshot/);
  assert.match(
    controller,
    /includedNodeIds:\s*\[activeNode\.id,\s*\.\.\.activeNode\.childIds\]/,
  );
  assert.match(controller, /await requestTermDefinitions\(/);
  assert.doesNotMatch(controller, /TERM_PREFETCH_LIMIT/);
  assert.match(
    controller,
    /async function explainTerm[\s\S]*?termPrefetchAbort\.current\?\.abort\(\)[\s\S]*?requestTermDefinition\(/,
  );
  assert.doesNotMatch(
    controller,
    /setVisualDocument\(payload\.document\)[\s\S]{0,160}setTermCache\(\{\}\)/,
    "expanding an unrelated branch must not clear cached definitions",
  );
});

test("scene preparation is one-frontier, cancellable, and version guarded", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    controller,
    /const queue = buildScenePrefetchQueue\(documentSnapshot, activeNode\.id,[\s\S]*?const plan = buildPrefetchPlan\(\{[\s\S]*?profile: backgroundPrefetchProfile,[\s\S]*?sceneQueue: queue,[\s\S]*?receipts: usageReceipts,[\s\S]*?const item = plan\.sceneQueue\[0\]/,
  );
  assert.match(controller, /scenePrefetchAbort\.current\?\.abort\(\)/);
  assert.match(
    controller,
    /authoritative\.version !== documentSnapshot\.version[\s\S]*?payload\.document\.version !== documentSnapshot\.version \+ 1/,
  );
  assert.match(
    controller,
    /async function enterNode[\s\S]*?scenePrefetchAbort\.current\?\.abort\(\)/,
  );
});

test("rapid profile switching coalesces background restart to the latest intent", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );
  const profileChange =
    controller.match(
      /function changePrefetchProfile[\s\S]*?(?=\n  async function selectKnowledgeSession)/,
    )?.[0] ?? "";

  assert.match(profileChange, /scenePrefetchAbort\.current\?\.abort\(\)/);
  assert.match(profileChange, /termPrefetchAbort\.current\?\.abort\(\)/);
  assert.match(profileChange, /setPrefetchProfile\(profile\)/);
  assert.match(profileChange, /setBackgroundPrefetchProfile\("on_demand"\)/);
  assert.match(profileChange, /clearTimeout\(prefetchProfileSettleTimer\.current\)/);
  assert.match(profileChange, /if \(profile === "on_demand"\) return/);
  assert.match(profileChange, /prefetchProfileSettleTimer\.current = setTimeout/);
  assert.match(
    profileChange,
    /if \(prefetchProfileIntentEpoch\.current !== intentEpoch\) return/,
  );
  assert.match(profileChange, /setBackgroundPrefetchProfile\(profile\)/);
  assert.match(profileChange, /PREFETCH_PROFILE_SETTLE_MS/);
  assert.doesNotMatch(
    profileChange,
    /setBackgroundRestart|setTermPrefetchRestart/,
    "intermediate profile choices must not immediately restart background work",
  );
  assert.doesNotMatch(profileChange, /documentAbort|abortAllTermJobs|abortAllDeepJobs/);
  assert.doesNotMatch(
    profileChange,
    /setTermCache|termCacheRef|deepReadingStore|setTermCardsByKey/,
    "changing the background budget must not clear paid foreground or completed cache state",
  );

  assert.match(controller, /const PREFETCH_PROFILE_SETTLE_MS = 450/);
  assert.match(controller, /const ownsScenePreparation = \(\) =>/);
  assert.match(
    controller,
    /controller\.signal\.aborted \|\| isAbortError\(prefetchError\)[\s\S]*?settleScenePreparation\("idle"\)/,
    "a cancelled current scene must leave preparing state",
  );
  assert.match(
    controller,
    /if \(!ownsScenePreparation\(\)\) return;[\s\S]*?scenePrefetchFailures\.current\.add/,
    "a stale controller must not mark the replacement request as failed",
  );
});

test("background work records one receipt for every issued terminal outcome", async () => {
  const controller = (
    await readFile(
      new URL("../components/lineage-studio.tsx", import.meta.url),
      "utf8",
    )
  ).replace(/\r\n?/gu, "\n");
  const sceneBlock =
    controller.match(
      /void \(async \(\) => \{\s*const startedAt[\s\S]*?(?=\n  \}, \[\n    activeNode\.id)/,
    )?.[0] ?? "";
  const termBlock =
    controller.match(
      /void \(async \(\) => \{\s*for \(const batch of batches\)[\s\S]*?(?=\n  \}, \[\n    documentRequest)/,
    )?.[0] ?? "";

  for (const block of [sceneBlock, termBlock]) {
    assert.match(block, /let requestStarted = false/);
    assert.match(block, /let receiptRecorded = false/);
    assert.match(
      block,
      /if \(receiptRecorded \|\| !requestStarted\) return;\s*receiptRecorded = true;/,
      "an issued request must have a single idempotent receipt write",
    );
    assert.match(block, /lane: "background"/);
    assert.match(block, /record\("success"/);
    assert.match(block, /record\("error"/);
    assert.match(block, /record\("aborted"/);
  }
  assert.match(
    sceneBlock,
    /record\("discarded"/,
    "a completed scene rejected by version guards still consumes its issued budget",
  );
});

test("session hydration gates creation and every background model effect", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    controller,
    /async function createExplanation[\s\S]*?if \(!hydrationReady\) return;/,
  );
  assert.equal(
    (
      controller.match(
        /if \(!hydrationReady \|\| !hasDocument \|\| documentRequest \|\| !pageVisible\) return;/g,
      ) ?? []
    ).length,
    2,
    "scene and term background effects must both wait for restore",
  );
  assert.match(controller, /busy=\{isCreating \|\| !hydrationReady\}/);
});

test("empty composer exposes profile and saved-session controls after hydration", async () => {
  const [controller, controls] = await Promise.all([
    readFile(
      new URL("../components/lineage-studio.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/knowledge-session-controls.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    controller,
    /<KnowledgeSessionControls[\s\S]*?visible=\{hydrationReady && !isCreating\}/,
    "the compact session control must not depend on an accepted document",
  );
  assert.doesNotMatch(
    controller,
    /<KnowledgeSessionControls[\s\S]*?visible=\{hasDocument && !isCreating\}/,
  );
  assert.match(
    controller,
    /if \(!hydrationReady \|\| !hasDocument \|\| !activeSessionId\) return;/,
    "an empty-workspace profile change must not create an IndexedDB session",
  );
  assert.equal(
    (
      controller.match(
        /if \(!hydrationReady \|\| !hasDocument \|\| documentRequest \|\| !pageVisible\) return;/g,
      ) ?? []
    ).length,
    2,
    "an empty-workspace profile change must not start scene or term preparation",
  );

  const createBlock =
    controller.match(
      /async function createExplanation[\s\S]*?(?=\n  async function enterNode)/,
    )?.[0] ?? "";
  assert.doesNotMatch(
    createBlock,
    /setPrefetchProfile\(/,
    "the first accepted question must inherit the preselected profile",
  );
  assert.match(controls, /const hasActiveSession = activeSessionId !== null/);
  assert.match(controls, /className="knowledge-session-empty">暂无记录</);
  assert.match(
    controls,
    /\{hasActiveSession \? \(\s*<section>\s*<h2>导出<\/h2>/,
    "export actions stay unavailable until an accepted active session exists",
  );
  assert.match(
    controller,
    /function exportKnowledge[\s\S]*?if \(!hydrationReady \|\| !hasDocument \|\| !activeSessionId\) return;/,
    "the export handler must also reject an empty workspace",
  );
});

test("main question search permission is colocated with providers defaults off and only travels with create", async () => {
  const [controller, header, modelSettings, providerSettings] = await Promise.all([
    readFile(
      new URL("../components/lineage-studio.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/lineage-header.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/model-settings-dialog.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/provider-settings-panel.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  const createBlock =
    controller.match(
      /async function createExplanation[\s\S]*?(?=\n  async function enterNode)/,
    )?.[0] ?? "";
  const expandBlock =
    controller.match(
      /async function enterNode[\s\S]*?(?=\n  async function explainTerm)/,
    )?.[0] ?? "";
  const explanationHelpers =
    controller.match(
      /async function requestTermDefinition[\s\S]*?(?=\nfunction toDeepReadingState)/,
    )?.[0] ?? "";

  assert.match(
    controller,
    /const \[createSearchEnabled, setCreateSearchEnabled\] = useState\(false\)/,
  );
  assert.match(controller, /searchEnabled=\{createSearchEnabled\}/);
  assert.match(controller, /onSearchEnabledChange=\{setCreateSearchEnabled\}/);
  assert.doesNotMatch(header, /question-search-toggle|searchEnabled|>\s*联网\s*</);
  assert.match(modelSettings, /<ProviderSettingsPanel[\s\S]*?searchEnabled=\{searchEnabled\}/);
  assert.match(
    modelSettings,
    /onSearchEnabledChange=\{onSearchEnabledChange\}/,
  );
  assert.match(providerSettings, /允许下一次主问题联网/);
  assert.match(providerSettings, /role="switch"/);
  assert.match(providerSettings, /aria-checked=\{searchEnabled\}/);
  assert.match(
    providerSettings,
    /disabled=\{Boolean\(action\) \|\| loading \|\| !activeSearchProvider\}/,
  );
  assert.match(
    providerSettings,
    /if \(!loading && searchEnabled && !activeSearchProvider\)[\s\S]*?onSearchEnabledChange\(false\)/,
    "removing the active search provider must fail closed",
  );
  assert.match(providerSettings, /启用供应商不会自动打开联网/);
  assert.match(
    createBlock,
    /searchModeOverride \?\? \(createSearchEnabled \? "on" : "off"\)/,
  );
  assert.match(
    createBlock,
    /action: "create",[\s\S]*?searchMode: requestedSearchMode/,
  );
  assert.match(
    controller,
    /createExplanation\([\s\S]*?queuedQuestion\.searchMode/,
    "credential setup must preserve the originally submitted search mode",
  );
  assert.doesNotMatch(expandBlock, /searchMode/);
  assert.doesNotMatch(explanationHelpers, /searchMode/);
});

test("download helper revokes its temporary Blob URL without mutating session state", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );
  const helper =
    controller.match(
      /function downloadKnowledgeArtifact[\s\S]*?(?=\nfunction isAbortError)/,
    )?.[0] ?? "";

  assert.match(helper, /const url = URL\.createObjectURL\(blob\)/);
  assert.match(helper, /anchor\.click\(\)/);
  assert.match(helper, /anchor\.remove\(\)/);
  assert.match(helper, /URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(
    helper,
    /(?:^|[^\w.])set[A-Z]|repository|visualDocumentRef|navigation|termCache|deepReadingStore/,
  );
});

test("selection and recursive terms route to explicit deep and nested actions", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );

  assert.match(controller, /selection\.type !== "Range"/);
  assert.match(controller, /Array\.from\(text\)\.length > 600/);
  assert.match(controller, /async function explainNestedTerm/);
  assert.match(controller, /nestedTermExplanationCacheKey/);
  assert.match(controller, /action: "dive"/);
  assert.match(controller, /onDeepenSelection=\{deepenSelectedText\}/);
});

test("selected prose offers independent AI question and deep-reading actions", async () => {
  const [controller, stage, primitives, chatPanel] = await Promise.all([
    readFile(
      new URL("../components/lineage-studio.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/lineage-stage.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/lineage-scene-primitives.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/selection-chat-panel.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  const askBlock =
    controller.match(
      /function askAboutSelectedText[\s\S]*?(?=\n  async function requestDeepReading)/,
    )?.[0] ?? "";
  const deepenBlock =
    controller.match(
      /async function deepenSelectedText[\s\S]*?(?=\n  function askAboutSelectedText)/,
    )?.[0] ?? "";

  assert.match(primitives, />\s*向 AI 提问\s*</);
  assert.match(primitives, />\s*深入\s*</);
  assert.match(primitives, /onClick=\{\(\) => void onAsk\(\)\}/);
  assert.match(primitives, /onClick=\{\(\) => void onDeepen\(\)\}/);
  assert.match(stage, /onAsk=\{onAskSelection\}/);
  assert.match(controller, /onAskSelection=\{askAboutSelectedText\}/);
  assert.match(askBlock, /setChatSelection\(\{/);
  assert.match(askBlock, /explanationContextTokens\.current\.get\(parentContext\)/);
  assert.doesNotMatch(askBlock, /requestDeepReading\(/);
  assert.match(deepenBlock, /requestDeepReading\(/);
  assert.match(chatPanel, /createSelectionChatTurn\(/);
  assert.match(chatPanel, /useState<SelectionChatSearchMode>\("auto"\)/);
  assert.match(chatPanel, /searchMode,/);
  assert.match(chatPanel, /value: "off", label: "关闭"/);
  assert.match(chatPanel, /value: "auto", label: "自动"/);
  assert.match(chatPanel, /value: "force", label: "强制"/);
  assert.match(chatPanel, /searchStatusLabel\(turn\.search\.status/);
  assert.match(chatPanel, /已联网 · \$\{callCount\} 次/);
  assert.match(chatPanel, /setUncertainClientTurnId\(clientTurnId\)/);
  assert.match(chatPanel, /请先刷新会话状态，避免重复发送/);
  assert.match(chatPanel, /const panelVisible = open/);
  assert.doesNotMatch(chatPanel, /const panelVisible = desktop \|\| open/);
  assert.match(chatPanel, /role=\{!desktop \? "dialog" : undefined\}/);
  assert.match(chatPanel, /aria-modal=\{!desktop && panelVisible \? true : undefined\}/);
  assert.match(chatPanel, /event\.key === "Escape"/);
  assert.match(chatPanel, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(chatPanel, /previousFocus\.current/);
  assert.match(
    controller,
    /const chatWorkspaceVisible = chatAvailable && chatPanelOpen/,
  );
  assert.match(controller, /\{chatAvailable \? \(\s*<SelectionChatPanel/);
});

test("mobile AI dialog is focusable as soon as it opens", async () => {
  const styles = await readFile(
    new URL("../app/styles/selection-chat.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.selection-chat-panel\s*\{[\s\S]*?visibility 0s linear 240ms;/,
    "closing may defer visibility until the slide-out transition finishes",
  );
  assert.match(
    styles,
    /\.selection-chat-panel\.is-open\s*\{[\s\S]*?transition-delay: 0s;/,
    "opening must make the dialog focusable before the focus effect runs",
  );
});

test("knowledge sessions use the backend repository without removing the offline implementation", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );
  const offlineRepository = await readFile(
    new URL("../lib/knowledge-session-repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(controller, /import \{ BackendKnowledgeSessionRepository \}/);
  assert.match(controller, /new BackendKnowledgeSessionRepository\(\)/);
  assert.doesNotMatch(controller, /new IndexedDbKnowledgeSessionRepository\(\)/);
  assert.match(
    offlineRepository,
    /export class IndexedDbKnowledgeSessionRepository/,
    "the IndexedDB implementation remains available for migration or offline caching",
  );
});

test("term card navigation preserves hidden work and guards the owning entry", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );
  const primitives = await readFile(
    new URL("../components/lineage-scene-primitives.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    controller,
    /const closeTermCard = useCallback\([\s\S]*?setVisibleTermCardKeys\(\(keys\) => keys\.filter\(\(key\) => key !== cardKey\)\)/,
    "closing one card must change only its visible identity",
  );
  assert.match(
    controller,
    /const popTermCard = useCallback\(\(cardKey: string\) => \{[\s\S]*?stack\.slice\(0, -1\)/,
    "popping one recursive definition must change only that card stack",
  );
  assert.match(
    controller,
    /stack\.at\(-1\)\?\.requestIdentity !== requestIdentity/,
    "a late response must not replace whichever ancestor is now visible",
  );
  assert.doesNotMatch(
    controller.match(/const closeTermCard[\s\S]*?\n  \);/)?.[0] ?? "",
    /\.abort\(\)/,
    "hiding a card must not cancel its in-flight task",
  );
  assert.match(primitives, /export function TermWorkspace/);
  assert.match(primitives, /requestIdentity\?: number/);
});

test("deep-reading terms retain trusted source context and are interactive", async () => {
  const controller = await readFile(
    new URL("../components/lineage-studio.tsx", import.meta.url),
    "utf8",
  );
  const primitives = await readFile(
    new URL("../components/lineage-scene-primitives.tsx", import.meta.url),
    "utf8",
  );

  assert.match(controller, /async function explainDeepReadingTerm/);
  assert.match(controller, /async function deepenDeepReadingTerm/);
  assert.match(controller, /parentDeepExplanation/);
  assert.match(controller, /onExplainDeepTerm=\{explainDeepReadingTerm\}/);
  assert.match(controller, /onDeepenDeepTerm=\{deepenDeepReadingTerm\}/);
  assert.match(
    controller,
    /function toDeepReadingState[\s\S]*?sourceNodeId: explanation\.nodeId,[\s\S]*?explanation,/,
  );
  assert.match(primitives, /data-node-id=\{state\.sourceNodeId\}/);
  assert.match(primitives, /onTermActivate=\{onExplainTerm\}/);
  assert.match(primitives, /onTermDeepen=\{onDeepenTerm\}/);
});

test("term and section single actions wait through a 450ms slow double click", async () => {
  const primitives = await readFile(
    new URL("../components/lineage-scene-primitives.tsx", import.meta.url),
    "utf8",
  );

  assert.match(primitives, /const MULTI_CLICK_DELAY_MS = 450/);
  assert.match(
    primitives,
    /pendingSingleActivation\.current = window\.setTimeout\([\s\S]*?MULTI_CLICK_DELAY_MS/,
  );
  assert.match(
    primitives,
    /pendingEntry\.current = window\.setTimeout\([\s\S]*?MULTI_CLICK_DELAY_MS/,
  );
  assert.match(primitives, /onDoubleClick=\{cancelPendingEntry\}/);
});

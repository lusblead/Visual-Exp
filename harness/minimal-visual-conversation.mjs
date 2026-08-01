import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

for (const args of [["test"], ["run", "typecheck"], ["run", "lint"]]) {
  const command = `npm ${args.join(" ")}`;
  const result = spawnSync(command, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed`);
}

const [
  controller,
  stage,
  primitives,
  annotationMatcher,
  nodeInteraction,
  sceneStyles,
  workspaceStyles,
  stateStyles,
  responsiveStyles,
  settingsRoute,
  lineageRoute,
  companion,
  viteConfig,
  deepseekModel,
  deepseekDraftContract,
  termPrefetchPriority,
  scenePrefetchPriority,
  termExplanation,
  deepExplanation,
  modelPort,
  companionProxy,
  providerErrors,
  explanationContextToken,
  localLauncher,
  minimalSpec,
  sourceSpec,
  checklist,
] = await Promise.all([
  readFile(new URL("components/lineage-studio.tsx", projectRoot), "utf8"),
  readFile(new URL("components/lineage-stage.tsx", projectRoot), "utf8"),
  readFile(new URL("components/lineage-scene-primitives.tsx", projectRoot), "utf8"),
  readFile(new URL("lib/annotated-term-match.mjs", projectRoot), "utf8"),
  readFile(new URL("lib/knowledge-node-interaction.mjs", projectRoot), "utf8"),
  readFile(new URL("app/styles/scenes.css", projectRoot), "utf8"),
  readFile(new URL("app/styles/workspace.css", projectRoot), "utf8"),
  readFile(new URL("app/styles/states.css", projectRoot), "utf8"),
  readFile(new URL("app/styles/responsive.css", projectRoot), "utf8"),
  readFile(new URL("app/api/model-settings/route.ts", projectRoot), "utf8"),
  readFile(new URL("app/api/lineage/route.ts", projectRoot), "utf8"),
  readFile(
    new URL("companion/VisualizedExp.Companion/WindowsCredentialStore.cs", projectRoot),
    "utf8",
  ),
  readFile(new URL("vite.config.ts", projectRoot), "utf8"),
  readFile(new URL("lib/deepseek-model.ts", projectRoot), "utf8"),
  readFile(new URL("lib/deepseek-draft-contract.ts", projectRoot), "utf8"),
  readFile(new URL("lib/term-prefetch-priority.mjs", projectRoot), "utf8"),
  readFile(new URL("lib/scene-prefetch-priority.mjs", projectRoot), "utf8"),
  readFile(new URL("lib/term-explanation.ts", projectRoot), "utf8"),
  readFile(new URL("lib/deep-explanation.ts", projectRoot), "utf8"),
  readFile(new URL("lib/model-port.ts", projectRoot), "utf8"),
  readFile(
    new URL("companion/VisualizedExp.Companion/DeepSeekProxy.cs", projectRoot),
    "utf8",
  ),
  readFile(new URL("lib/provider-errors.ts", projectRoot), "utf8"),
  readFile(new URL("lib/explanation-context-token.ts", projectRoot), "utf8"),
  readFile(new URL("scripts/start-local.mjs", projectRoot), "utf8"),
  readFile(new URL("specs/minimal-visual-conversation.md", projectRoot), "utf8"),
  readFile(new URL("specs/conversation-source-and-credentials.md", projectRoot), "utf8"),
  readFile(new URL("harness/acceptance-checklist.md", projectRoot), "utf8"),
]);

const [
  semanticDiagram,
  primaryMaterialBlock,
  primaryMaterial,
  explanationTaskCache,
  deepReadingCache,
  primaryMaterialStyles,
] = await Promise.all([
  readFile(new URL("components/semantic-diagram.tsx", projectRoot), "utf8"),
  readFile(new URL("components/primary-material-block.tsx", projectRoot), "utf8"),
  readFile(new URL("lib/primary-material.ts", projectRoot), "utf8"),
  readFile(new URL("lib/explanation-task-cache.mjs", projectRoot), "utf8"),
  readFile(new URL("lib/deep-reading-cache.mjs", projectRoot), "utf8"),
  readFile(new URL("app/styles/primary-material.css", projectRoot), "utf8"),
]);

assert.doesNotMatch(controller, /OutlinePanel|GuidePanel|viewOverrides|outlineOpen/);
assert.match(controller, /createExplorationHistory/);
assert.match(controller, /action: "define"/);
assert.match(controller, /action: "define_batch"/);
assert.match(controller, /action: "dive"/);
assert.match(controller, /ModelSettingsDialog/);
assert.match(stage, /AnnotatedText/);
assert.match(stage, /knowledge-network knowledge-spine/);
assert.match(stage, /DeepReadingSection/);
assert.match(stage, /SelectionAction/);
assert.match(stage, /SemanticDiagram/);
assert.match(stage, /PrimaryMaterialBlock/);
assert.doesNotMatch(stage, /relation-band/);
assert.match(primitives, /fragment\.term/);
assert.match(primitives, /event\.stopPropagation\(\)/);
assert.match(primitives, /onExplain\(node, term, trigger\)/);
assert.match(primitives, /onDoubleClick/);
assert.match(primitives, /onExplainNested/);
assert.match(primitives, /deep-reading-section/);
assert.match(primitives, /selection-action/);
assert.match(primitives, /shouldEnterKnowledgeNode/);
assert.match(primitives, /TermWorkspace/);
assert.match(primitives, /data-term-card-key/);
assert.match(semanticDiagram, /orderedChildIds/);
assert.match(semanticDiagram, /visibleRelations/);
assert.doesNotMatch(semanticDiagram, /dangerouslySetInnerHTML|mermaid|<svg|x:|y:/i);
assert.match(primaryMaterialBlock, /primary-material-body/);
assert.match(primaryMaterial, /parsePrimaryMaterial/);
assert.match(primaryMaterial, /public_domain_verified/);
assert.match(primaryMaterial, /模型凭记忆重构/);
assert.match(explanationTaskCache, /createExplanationTaskStore/);
assert.match(explanationTaskCache, /dismiss/);
assert.match(deepReadingCache, /createDeepReadingStore/);
assert.match(deepReadingCache, /deepReadingCacheKey/);
assert.match(annotationMatcher, /SINGLE_HAN_GRAMMATICAL_BOUNDARIES/);
assert.match(annotationMatcher, /characters\.length === 1 && isHan\(first\)/);
assert.match(annotationMatcher, /isAsciiWord\(first\) && isAsciiWord\(before\)/);
assert.match(nodeInteraction, /targetIsInteractive/);
assert.match(nodeInteraction, /selectionType !== "Range"/);
const allVisualStyles = [
  sceneStyles,
  workspaceStyles,
  stateStyles,
  responsiveStyles,
  primaryMaterialStyles,
].join("\n");
assert.match(sceneStyles, /\.knowledge-network\s*\{[^}]*width:\s*min\(840px, 100%\)/s);
assert.match(sceneStyles, /\.knowledge-node\s*\{[^}]*background:\s*transparent/s);
assert.match(sceneStyles, /\.core-summary\s*\{[^}]*font-size:\s*clamp\(19px/s);
assert.match(sceneStyles, /\.knowledge-detail\s*\{[^}]*line-height:\s*1\.84/s);
assert.doesNotMatch(allVisualStyles, /\.relation-band\s*\{/);
assert.match(stateStyles, /\.creation-loading\s*>\s*p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
assert.match(
  stateStyles,
  /\.scene-loading p,\s*\.deep-reading-loading p\s*\{[^}]*overflow-wrap:\s*anywhere/s,
);
assert.match(stateStyles, /\.term-definition,[^]*?overflow-wrap:\s*anywhere/s);
assert.match(stateStyles, /\.term-workspace\s*\{/);
assert.match(primaryMaterialStyles, /\.primary-material-body\s*\{[^}]*white-space:\s*pre-wrap/s);
assert.match(
  workspaceStyles,
  /\.is-docked\s+\.question-composer\s+\.question-submit,[^}]*width:\s*44px;[^}]*height:\s*44px/s,
);
assert.match(workspaceStyles, /\.settings-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
assert.match(
  stateStyles,
  /\.term-close,\s*\.term-back\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s,
);
assert.match(stateStyles, /\.stage-error\s+button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
assert.match(
  responsiveStyles,
  /\.question-shell\.is-docked\s+\.question-composer,[^}]*height:\s*62px/s,
);
assert.doesNotMatch(allVisualStyles, /line-clamp/);
assert.doesNotMatch(allVisualStyles, /text-overflow:\s*ellipsis/);
assert.match(settingsRoute, /deepseek-v4-pro/);
assert.match(lineageRoute, /issueExplanationContextToken/);
assert.match(lineageRoute, /verifyExplanationContextToken/);
assert.match(lineageRoute, /parentContextToken/);
assert.match(companion, /CredentialPersistLocalMachine/);
assert.match(viteConfig, /VISUALIZED_EXP_COMPANION_URL/);
assert.match(viteConfig, /VISUALIZED_EXP_COMPANION_TOKEN/);
assert.match(deepseekModel, /thinking:\s*\{\s*type:\s*"disabled"/);
assert.match(deepseekModel, /response_format:\s*\{\s*type:\s*"json_object"/);
assert.match(deepseekModel, /buildContentRepairPrompt/);
assert.match(deepseekModel, /requestProviderCompletion/);
assert.match(deepseekDraftContract, /assembleVisualDocument/);
assert.match(deepseekDraftContract, /assembleVisualOperations/);
assert.match(deepseekDraftContract, /sanitizeDraftTerms/);
assert.match(controller, /termPrefetchAbort\.current\?\.abort\(\)/);
assert.match(controller, /scenePrefetchAbort\.current\?\.abort\(\)/);
assert.match(controller, /visualDocumentRef/);
assert.match(controller, /requestDeepExplanation/);
assert.match(controller, /visibleTermCardKeys/);
assert.match(controller, /closeTermCard/);
assert.match(controller, /deepReadingCacheKey/);
assert.match(termPrefetchPriority, /left\.depth - right\.depth/);
assert.match(termPrefetchPriority, /right\.frequency - left\.frequency/);
assert.match(termPrefetchPriority, /fingerprintNodeContent/);
assert.match(termPrefetchPriority, /buildTermPrefetchBatches/);
assert.match(scenePrefetchPriority, /buildScenePrefetchQueue/);
assert.match(scenePrefetchPriority, /active\.childIds/);
assert.match(termExplanation, /visual-term-explanation\/2/);
assert.match(termExplanation, /MAX_TERM_EXPLANATION_DEPTH = 4/);
assert.match(deepExplanation, /visual-deep-explanation\/1/);
assert.match(modelPort, /termModelName:\s*"deepseek-v4-flash"/);
assert.match(modelPort, /deepModelName/);
assert.match(deepseekModel, /const SCENE_MODEL = "deepseek-v4-pro"/);
assert.match(deepseekModel, /const TERM_MODEL = "deepseek-v4-flash"/);
assert.match(companionProxy, /"deepseek-v4-pro"/);
assert.match(companionProxy, /"deepseek-v4-flash"/);
assert.match(providerErrors, /provider_insufficient_balance/);
assert.match(providerErrors, /provider_invalid_parameters/);
assert.match(providerErrors, /provider_content_filtered/);
assert.match(providerErrors, /provider_insufficient_resources/);
assert.match(explanationContextToken, /createHmac\("sha256"/);
assert.match(explanationContextToken, /timingSafeEqual/);
assert.match(localLauncher, /EXPLANATION_CONTEXT_TOKEN_SECRET/);
assert.doesNotMatch(
  `${controller}\n${settingsRoute}`,
  /(?:localStorage|indexedDB)[\s\S]{0,300}api.?key|api.?key[\s\S]{0,300}(?:localStorage|indexedDB)/i,
);

const clientFiles = await readdir(new URL("dist/client/", projectRoot), {
  recursive: true,
});
const clientSource = (
  await Promise.all(
    clientFiles
      .filter((file) => /\.(?:js|css|html)$/u.test(file))
      .map((file) =>
        readFile(
          new URL(`dist/client/${file.replaceAll("\\", "/")}`, projectRoot),
          "utf8",
        ),
      ),
  )
).join("\n");
assert.doesNotMatch(clientSource, /VISUALIZED_EXP_COMPANION_TOKEN|DEEPSEEK_API_KEY/);
assert.match(minimalSpec, /visual-term-explanation\/2/);
assert.match(minimalSpec, /visual-deep-explanation\/1/);
assert.match(minimalSpec, /one-layer-ahead scene pre-generation/iu);
assert.match(minimalSpec, /Linear explanatory reading/);
assert.match(minimalSpec, /Renderer-owned semantic diagrams/);
assert.match(minimalSpec, /Primary material before interpretation/);
assert.match(minimalSpec, /avoid \| optional \| requested/);
assert.match(minimalSpec, /Windows Credential Manager/);
assert.match(sourceSpec, /ConversationSnapshot/);
assert.match(sourceSpec, /loopback companion/i);
assert.match(sourceSpec, /interface GenerationGateway/);
assert.match(sourceSpec, /blocked_by_provider_terms/);
assert.match(sourceSpec, /Personal Hub extension reference/);
assert.match(checklist, /Desktop reading experience/);

console.log("Minimal visual conversation harness passed.");

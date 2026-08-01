import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

for (const [command, args, shell] of [
  [
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "tests/knowledge-session.test.mjs",
      "tests/knowledge-session-repository.test.mjs",
      "tests/knowledge-export.test.mjs",
    ],
    false,
  ],
  [
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    false,
  ],
]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

const [
  controller,
  controls,
  contract,
  repository,
  exporter,
  launcher,
  companion,
  specification,
] = await Promise.all([
  readFile(new URL("components/lineage-studio.tsx", projectRoot), "utf8"),
  readFile(
    new URL("components/knowledge-session-controls.tsx", projectRoot),
    "utf8",
  ),
  readFile(new URL("lib/knowledge-session-contract.ts", projectRoot), "utf8"),
  readFile(
    new URL("lib/knowledge-session-repository.ts", projectRoot),
    "utf8",
  ),
  readFile(new URL("lib/knowledge-export.ts", projectRoot), "utf8"),
  readFile(new URL("scripts/start-local.mjs", projectRoot), "utf8"),
  readFile(
    new URL("companion/VisualizedExp.Companion/Program.cs", projectRoot),
    "utf8",
  ),
  readFile(
    new URL("specs/knowledge-session-persistence.md", projectRoot),
    "utf8",
  ),
]);

assert.match(contract, /visual-knowledge-session\/1/);
assert.match(contract, /KNOWLEDGE_SESSION_MAX_BYTES/);
assert.match(contract, /FORBIDDEN_FIELD_NAMES/);
assert.match(contract, /contextToken/);
assert.match(repository, /globalThis\.indexedDB/);
assert.match(repository, /restoreLatest/);
assert.match(repository, /quarantine/);
assert.match(repository, /structuredClone/);
assert.match(controller, /restoreKnowledgeSession/);
assert.match(controller, /buildKnowledgeSessionSnapshot/);
assert.match(controller, /contextTokensByCacheKey/);
assert.match(controller, /skipNextAutosave/);
assert.match(controller, /createKnowledgeExportArtifact/);
assert.match(controller, /buildPrefetchPlan/);
assert.match(controller, /markPreparedConsumed/);
assert.match(controller, /KnowledgeSessionControls/);
assert.match(
  controller,
  /<KnowledgeSessionControls[\s\S]*?visible=\{hydrationReady && !isCreating\}/,
  "empty workspace controls must appear after hydration",
);
assert.doesNotMatch(
  controller,
  /<KnowledgeSessionControls[\s\S]*?visible=\{hasDocument && !isCreating\}/,
);
assert.match(controls, /on_demand/);
assert.match(controls, /balanced/);
assert.match(controls, /deep/);
assert.match(controls, /const hasActiveSession = activeSessionId !== null/);
assert.match(controls, /className="knowledge-session-empty">暂无记录</);
assert.match(
  controls,
  /\{hasActiveSession \? \(\s*<section>\s*<h2>导出<\/h2>/,
  "empty workspace controls must not expose export",
);
assert.match(
  controller,
  /function exportKnowledge[\s\S]*?if \(!hydrationReady \|\| !hasDocument \|\| !activeSessionId\) return;/,
  "empty workspace export must fail closed",
);
assert.match(controls, /summarizeProviderUsageReceipts/);
assert.match(exporter, /visual-knowledge-export\/1/);
assert.match(exporter, /childIds/);
assert.match(exporter, /runtime-free contract/);
assert.match(
  launcher,
  /\/v1\/runtime\/explanation-context-secret/,
);
assert.match(
  companion,
  /\/v1\/runtime\/explanation-context-secret/,
);
assert.match(specification, /hydration barrier/i);
assert.match(specification, /IndexedDB/);
assert.match(specification, /3\.5 MiB/);
assert.match(specification, /Markdown/);
assert.match(specification, /character counts are never presented/);

console.log("Knowledge session persistence harness passed.");

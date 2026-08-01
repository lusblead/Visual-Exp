import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildPrefetchPlan,
  prefetchFrontierKey,
} from "../../lib/prefetch-policy.mjs";
import { summarizeProviderUsageReceipts } from "../../lib/usage-receipt-metrics.mjs";

const suite = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);

assert.equal(suite.protocol, "visual-token-economy-eval/1");
assert.equal(suite.network, "forbidden");
assert.ok(Number.isSafeInteger(suite.seed));
assert.ok(Array.isArray(suite.cases) && suite.cases.length > 0);

const document = Object.freeze({
  id: "token-economy-fixture",
  version: 9,
  nodes: Object.freeze([
    Object.freeze({
      id: "root",
      title: "Transformer",
      summary: "先建立整体结构。",
      detail: "只准备当前语义层的直接入口。",
      childIds: Object.freeze(["encoder", "attention"]),
      terms: Object.freeze(["Transformer", "Encoder（编码器）"]),
    }),
    Object.freeze({
      id: "encoder",
      title: "Encoder（编码器）",
      summary: "把输入转换为上下文表示。",
      detail: "此节点只用于构造稳定的离线评测前沿。",
      childIds: Object.freeze([]),
      terms: Object.freeze(["上下文表示"]),
    }),
    Object.freeze({
      id: "attention",
      title: "注意力",
      summary: "建立输入位置之间的关系。",
      detail: "评测不调用模型，也不生成内容。",
      childIds: Object.freeze([]),
      terms: Object.freeze(["注意力"]),
    }),
  ]),
});
const activeFrontierKey = prefetchFrontierKey(document, "root");

const results = [];
for (const testCase of suite.cases) {
  const startedAt = performance.now();
  try {
    const actual = evaluateCase(testCase);
    assert.deepEqual(actual, testCase.expected);
    results.push({
      id: testCase.id,
      severity: testCase.severity,
      category: testCase.category,
      passed: true,
      durationMs: performance.now() - startedAt,
    });
  } catch (error) {
    results.push({
      id: testCase.id,
      severity: testCase.severity,
      category: testCase.category,
      passed: false,
      durationMs: performance.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const failures = results.filter((result) => !result.passed);
for (const result of results) {
  const marker = result.passed ? "PASS" : "FAIL";
  const detail = result.passed ? "" : ` - ${result.message}`;
  console.log(`[${marker}] ${result.id}${detail}`);
}
console.log(
  `Token economy eval: ${results.length - failures.length}/${results.length} passed; ` +
    `${failures.filter((result) => result.severity === "critical").length} critical failures.`,
);

if (failures.length > 0) {
  process.exitCode = 1;
}

function evaluateCase(testCase) {
  assert.equal(typeof testCase.id, "string");
  assert.equal(testCase.severity, "critical");

  if (testCase.kind === "prefetch-plan") {
    return evaluatePrefetchPlan(testCase.input);
  }
  if (testCase.kind === "usage-summary") {
    return evaluateUsageSummary(testCase.input);
  }
  throw new Error(`unknown eval kind: ${testCase.kind}`);
}

function evaluatePrefetchPlan(input) {
  const sceneQueue = Array.from(
    { length: input.sceneCandidates },
    (_, index) => ({ id: `scene-${index + 1}` }),
  );
  const termBatches = Array.from(
    { length: input.termCandidates },
    (_, index) => ({ id: `terms-${index + 1}` }),
  );
  const receipts = input.receipts.map((receipt) => ({
    ...receipt,
    frontierKey:
      receipt.frontier === "active"
        ? activeFrontierKey
        : "prefetch-frontier:v1:other:other:0000000000000000",
  }));
  const plan = buildPrefetchPlan({
    profile: input.profile,
    frontierKey: activeFrontierKey,
    sceneQueue,
    termBatches,
    receipts,
    consumed: input.reservations,
  });

  return {
    limits: plan.limits,
    consumed: plan.consumed,
    remaining: plan.remaining,
    selectedSceneIds: plan.sceneQueue.map((candidate) => candidate.id),
    selectedTermIds: plan.termBatches.map((candidate) => candidate.id),
  };
}

function evaluateUsageSummary(input) {
  assert.ok(
    Array.isArray(input.untrustedCharacterCounts),
    "negative-control character counts are required",
  );
  assert.ok(
    input.untrustedCharacterCounts.some((value) => value > 10000),
    "negative control must contain a tempting large character count",
  );

  const summary = summarizeProviderUsageReceipts(input.receipts);
  assert.equal(
    containsEstimatedField(summary),
    false,
    "usage summary must not expose an estimated-token field",
  );
  return summary;
}

function containsEstimatedField(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /estimated|character/i.test(key) || containsEstimatedField(nested),
  );
}

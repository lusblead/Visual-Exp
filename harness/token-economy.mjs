import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

for (const args of [
  ["--test", "tests/prefetch-policy.test.mjs"],
  ["evals/token-economy/run.mjs"],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${process.execPath} ${args.join(" ")} failed`);
}

const [casesSource, runner, policy, metrics, specification] =
  await Promise.all([
    readFile(new URL("evals/token-economy/cases.json", projectRoot), "utf8"),
    readFile(new URL("evals/token-economy/run.mjs", projectRoot), "utf8"),
    readFile(new URL("lib/prefetch-policy.mjs", projectRoot), "utf8"),
    readFile(new URL("lib/usage-receipt-metrics.mjs", projectRoot), "utf8"),
    readFile(
      new URL("specs/knowledge-session-persistence.md", projectRoot),
      "utf8",
    ),
  ]);

const cases = JSON.parse(casesSource);
assert.equal(cases.protocol, "visual-token-economy-eval/1");
assert.equal(cases.network, "forbidden");
assert.equal(cases.cases.length, 7);
assert.deepEqual(
  new Set(cases.cases.map((testCase) => testCase.severity)),
  new Set(["critical"]),
);
assert.deepEqual(
  new Set(
    cases.cases
      .filter((testCase) => testCase.category === "profile-budget")
      .map((testCase) => testCase.input.profile),
  ),
  new Set(["on_demand", "balanced", "deep"]),
);
assert.ok(
  cases.cases.some(
    (testCase) =>
      testCase.category === "receipt-integrity" &&
      new Set(testCase.input.receipts.map((receipt) => receipt.id)).size <
        testCase.input.receipts.length,
  ),
);
assert.ok(
  cases.cases.some(
    (testCase) =>
      testCase.category === "budget-exhaustion" &&
      testCase.expected.remaining.sceneCalls === 0 &&
      testCase.expected.remaining.termBatches === 0,
  ),
);
assert.ok(
  cases.cases.some(
    (testCase) =>
      testCase.category === "usage-accounting" &&
      testCase.expected.fields.totalTokens.unknownReceipts > 0,
  ),
);

assert.match(policy, /seenReceiptIds/);
assert.match(metrics, /dedupeGenerationReceipts/);
assert.match(metrics, /value === null/);
assert.doesNotMatch(metrics, /Math\.(?:ceil|floor|round)|\.length\s*\/\s*[234]/);
assert.doesNotMatch(runner, /\bfetch\s*\(|https?:\/\//i);
assert.match(runner, /untrustedCharacterCounts/);
assert.match(
  specification,
  /Unavailable counts are stored as `null`; character counts are never presented\s+as token counts\./,
);

console.log("Token economy harness passed.");

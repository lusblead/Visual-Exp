import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PREFETCH_PROFILE,
  PREFETCH_PROFILE_LIMITS,
  buildPrefetchPlan,
  countPrefetchReceipts,
  parsePrefetchProfile,
  prefetchFrontierKey,
  remainingPrefetchBudget,
} from "../lib/prefetch-policy.mjs";

const document = {
  id: "document-prefetch",
  version: 3,
  nodes: [
    {
      id: "root",
      title: "Transformer",
      summary: "先理解整体数据流。",
      detail: "输入依次经过编码器、注意力和输出层。",
      childIds: ["encoder", "attention"],
      terms: ["Transformer", "编码器"],
    },
    {
      id: "encoder",
      title: "编码器",
      summary: "编码输入。",
      detail: "编码器生成上下文表示。",
      childIds: [],
      terms: ["上下文表示"],
    },
    {
      id: "attention",
      title: "注意力",
      summary: "建立位置关系。",
      detail: "注意力决定当前位置应读取哪些信息。",
      childIds: [],
      terms: ["注意力"],
    },
  ],
};

const sceneQueue = Object.freeze(
  Array.from({ length: 6 }, (_, index) =>
    Object.freeze({
      nodeId: `scene-${index + 1}`,
      children: Object.freeze([{ nodeId: `grandchild-${index + 1}` }]),
    }),
  ),
);
const termBatches = Object.freeze(
  Array.from({ length: 6 }, (_, index) =>
    Object.freeze({
      nodeId: `term-node-${index + 1}`,
      items: Object.freeze([{ term: `term-${index + 1}` }]),
    }),
  ),
);

test("profile parser defaults to balanced and rejects unknown stored values", () => {
  assert.equal(DEFAULT_PREFETCH_PROFILE, "balanced");
  assert.equal(parsePrefetchProfile(undefined), "balanced");
  assert.equal(parsePrefetchProfile(null), "balanced");
  assert.equal(parsePrefetchProfile(" balanced "), "balanced");
  assert.equal(parsePrefetchProfile("on_demand"), "on_demand");
  assert.equal(parsePrefetchProfile("deep"), "deep");
  assert.throws(() => parsePrefetchProfile("turbo"), /unknown prefetch profile/u);
  assert.throws(() => parsePrefetchProfile({}), /must be a string/u);
});

test("profiles expose the exact hard per-frontier limits", () => {
  assert.deepEqual(PREFETCH_PROFILE_LIMITS.on_demand, {
    sceneCalls: 0,
    termBatches: 0,
  });
  assert.deepEqual(PREFETCH_PROFILE_LIMITS.balanced, {
    sceneCalls: 1,
    termBatches: 1,
  });
  assert.deepEqual(PREFETCH_PROFILE_LIMITS.deep, {
    sceneCalls: 5,
    termBatches: 4,
  });
});

test("frontier identity survives document version and descendant changes", () => {
  const first = prefetchFrontierKey(document, "root");
  const versionAdvanced = prefetchFrontierKey(
    {
      ...document,
      version: 4,
      nodes: document.nodes.map((node) =>
        node.id === "encoder"
          ? { ...node, detail: "编码器已经在后台展开，但根层没有变化。" }
          : node,
      ),
    },
    "root",
  );
  const activeBodyChanged = prefetchFrontierKey(
    {
      ...document,
      version: 4,
      nodes: document.nodes.map((node) =>
        node.id === "root"
          ? { ...node, detail: `${node.detail} 现在补充了新的边界。` }
          : node,
      ),
    },
    "root",
  );

  assert.equal(versionAdvanced, first);
  assert.notEqual(activeBodyChanged, first);
  assert.match(first, /^prefetch-frontier:v1:/u);
  assert.throws(
    () => prefetchFrontierKey(document, "missing"),
    /must identify a node/u,
  );
});

test("on-demand mode performs zero background work without mutating candidates", () => {
  const frontierKey = prefetchFrontierKey(document, "root");
  const scenesBefore = structuredClone(sceneQueue);
  const batchesBefore = structuredClone(termBatches);
  const plan = buildPrefetchPlan({
    profile: "on_demand",
    frontierKey,
    sceneQueue,
    termBatches,
  });

  assert.deepEqual(plan.sceneQueue, []);
  assert.deepEqual(plan.termBatches, []);
  assert.deepEqual(plan.remaining, { sceneCalls: 0, termBatches: 0 });
  assert.deepEqual(sceneQueue, scenesBefore);
  assert.deepEqual(termBatches, batchesBefore);
});

test("balanced and deep trim only the caller-provided top-level candidates", () => {
  const frontierKey = prefetchFrontierKey(document, "root");
  const balanced = buildPrefetchPlan({
    profile: "balanced",
    frontierKey,
    sceneQueue,
    termBatches,
  });
  const deep = buildPrefetchPlan({
    profile: "deep",
    frontierKey,
    sceneQueue,
    termBatches,
  });

  assert.deepEqual(
    balanced.sceneQueue.map((item) => item.nodeId),
    ["scene-1"],
  );
  assert.deepEqual(
    balanced.termBatches.map((item) => item.nodeId),
    ["term-node-1"],
  );
  assert.equal(balanced.sceneQueue[0].children.length, 1);
  assert.equal(
    balanced.sceneQueue.some((item) => item.nodeId.startsWith("grandchild-")),
    false,
  );

  assert.deepEqual(
    deep.sceneQueue.map((item) => item.nodeId),
    ["scene-1", "scene-2", "scene-3", "scene-4", "scene-5"],
  );
  assert.deepEqual(
    deep.termBatches.map((item) => item.nodeId),
    ["term-node-1", "term-node-2", "term-node-3", "term-node-4"],
  );
  assert.notEqual(deep.sceneQueue, sceneQueue);
  assert.notEqual(deep.termBatches, termBatches);
});

test("matching receipts and current reservations consume the same hard budget", () => {
  const frontierKey = prefetchFrontierKey(document, "root");
  const otherFrontierKey = prefetchFrontierKey(document, "encoder");
  const receipts = Object.freeze([
    Object.freeze({
      lane: "background",
      action: "expand",
      frontierKey,
      outcome: "failed",
    }),
    Object.freeze({
      lane: "background",
      action: "define_batch",
      frontierKey,
      outcome: "accepted",
    }),
    Object.freeze({
      lane: "foreground",
      action: "expand",
      frontierKey,
      outcome: "accepted",
    }),
    Object.freeze({
      lane: "background",
      action: "expand",
      frontierKey: otherFrontierKey,
      outcome: "accepted",
    }),
  ]);

  assert.deepEqual(countPrefetchReceipts(receipts, frontierKey), {
    sceneCalls: 1,
    termBatches: 1,
  });

  const balanced = buildPrefetchPlan({
    profile: "balanced",
    frontierKey,
    sceneQueue,
    termBatches,
    receipts,
  });
  assert.deepEqual(balanced.remaining, { sceneCalls: 0, termBatches: 0 });
  assert.deepEqual(balanced.sceneQueue, []);
  assert.deepEqual(balanced.termBatches, []);

  const deep = buildPrefetchPlan({
    profile: "deep",
    frontierKey,
    sceneQueue,
    termBatches,
    receipts,
    consumed: { sceneCalls: 2, termBatches: 1 },
  });
  assert.deepEqual(deep.consumed, { sceneCalls: 3, termBatches: 2 });
  assert.deepEqual(deep.remaining, { sceneCalls: 2, termBatches: 2 });
  assert.equal(deep.sceneQueue.length, 2);
  assert.equal(deep.termBatches.length, 2);
});

test("replayed receipt IDs consume a frontier budget only once", () => {
  const frontierKey = prefetchFrontierKey(document, "root");
  const duplicateScene = {
    id: "receipt-scene-1",
    lane: "background",
    action: "expand",
    frontierKey,
    outcome: "accepted",
  };
  const duplicateTerms = {
    id: "receipt-terms-1",
    lane: "background",
    action: "define_batch",
    frontierKey,
    outcome: "failed",
  };
  const receipts = [
    duplicateScene,
    { ...duplicateScene, outcome: "failed" },
    duplicateTerms,
    { ...duplicateTerms, outcome: "accepted" },
  ];

  assert.deepEqual(countPrefetchReceipts(receipts, frontierKey), {
    sceneCalls: 1,
    termBatches: 1,
  });

  const plan = buildPrefetchPlan({
    profile: "deep",
    frontierKey,
    sceneQueue,
    termBatches,
    receipts,
  });
  assert.deepEqual(plan.consumed, { sceneCalls: 1, termBatches: 1 });
  assert.deepEqual(plan.remaining, { sceneCalls: 4, termBatches: 3 });
});

test("exhausted and excessive counts clamp remaining work to zero", () => {
  assert.deepEqual(
    remainingPrefetchBudget("deep", {
      sceneCalls: 5,
      termBatches: 4,
    }),
    { sceneCalls: 0, termBatches: 0 },
  );
  assert.deepEqual(
    remainingPrefetchBudget("deep", {
      sceneCalls: 500,
      termBatches: 400,
    }),
    { sceneCalls: 0, termBatches: 0 },
  );
  assert.throws(
    () => remainingPrefetchBudget("balanced", { sceneCalls: -1 }),
    /non-negative safe integer/u,
  );
});

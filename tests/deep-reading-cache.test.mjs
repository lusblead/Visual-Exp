import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeepReadingStore,
  deepReadingCacheKey,
} from "../lib/deep-reading-cache.mjs";

const documentV1 = {
  protocol: "visual-explanation-document/2",
  id: "visual_transformer",
  version: 1,
};

const node = {
  id: "visual_transformer_node_1",
  title: "编码器与解码器",
  summary: "编码器理解输入，解码器逐步生成输出。",
  detail: "Encoder 和 Decoder 通过注意力机制传递上下文。",
};

const termParent = {
  protocol: "visual-term-explanation/2",
  term: "编码器",
  termPath: ["编码器"],
  nodeId: node.id,
  definition: "编码器（Encoder）把输入转换为上下文表示。",
  relevance: "它为解码器提供可读取的输入信息。",
  terms: ["上下文表示"],
  confidence: "high",
  sourceStatus: "model_knowledge",
};

const deepParent = {
  protocol: "visual-deep-explanation/1",
  subject: "注意力机制",
  nodeId: node.id,
  directAnswer: "注意力机制让当前位置读取其他位置的信息。",
  background: "固定长度表示难以保留所有上下文。",
  role: "它连接编码器和解码器中的信息。",
  mechanism: "查询与键计算相关性，再对值进行加权汇总。",
  boundary: "注意力本身不等于完整推理。",
  terms: ["查询", "键", "值"],
  confidence: "high",
  sourceStatus: "model_knowledge",
};

test("deep-reading identity survives unrelated version changes but invalidates changed source prose", () => {
  const original = deepReadingCacheKey(documentV1, node, "  Encoder\n架构 ");
  const versionAdvanced = deepReadingCacheKey(
    { ...documentV1, version: 2 },
    node,
    "encoder 架构",
  );
  const changedNode = deepReadingCacheKey(
    { ...documentV1, version: 2 },
    { ...node, detail: `${node.detail} 新增交叉注意力。` },
    "encoder 架构",
  );

  assert.equal(original, versionAdvanced);
  assert.notEqual(original, changedNode);
});

test("deep-reading identity uses structural parent content rather than object identity", () => {
  const first = deepReadingCacheKey(documentV1, node, "上下文表示", {
    parentTermExplanation: termParent,
  });
  const clone = deepReadingCacheKey(documentV1, node, "上下文表示", {
    parentTermExplanation: structuredClone(termParent),
  });
  const changedParent = deepReadingCacheKey(documentV1, node, "上下文表示", {
    parentTermExplanation: {
      ...termParent,
      relevance: `${termParent.relevance} 它还决定可用信息的范围。`,
    },
  });
  const deepContext = deepReadingCacheKey(documentV1, node, "上下文表示", {
    parentDeepExplanation: deepParent,
  });

  assert.equal(first, clone);
  assert.notEqual(first, changedParent);
  assert.notEqual(first, deepContext);
});

test("cache-key inputs fail closed for ambiguous or malformed trusted context", () => {
  assert.throws(
    () => deepReadingCacheKey(documentV1, node, "编码器", {
      parentTermExplanation: termParent,
      parentDeepExplanation: deepParent,
    }),
    /mutually exclusive/,
  );
  assert.throws(
    () => deepReadingCacheKey(documentV1, node, "编码器", {
      parentTermExplanation: { ...termParent, nodeId: "other-node" },
    }),
    /must belong to node\.id/,
  );
  assert.throws(
    () => deepReadingCacheKey(documentV1, node, "   "),
    /must not be empty/,
  );
  assert.throws(
    () => deepReadingCacheKey({ ...documentV1, protocol: "legacy" }, node, "编码器"),
    /document\.protocol/,
  );
  assert.throws(
    () => deepReadingCacheKey(documentV1, node, "编码器", { token: "not-identity" }),
    /parentContext\.token is not allowed/,
  );
});

test("A and B deep tasks settle independently and cached results restore without refetch", () => {
  const store = createDeepReadingStore();

  assert.equal(store.activate("A", { subject: "词 A" }), true);
  assert.equal(store.begin("A", 1), true);
  assert.equal(store.activate("B", { subject: "词 B" }), true);
  assert.equal(store.begin("B", 2), true);
  assert.equal(store.activeKey, "B");

  assert.equal(store.succeed("A", 1, { answer: "A 的深入解释" }), true);
  assert.equal(store.activeKey, "B");
  assert.equal(store.getActive().status, "pending");
  assert.equal(store.get("A").status, "success");

  assert.equal(store.activate("A", { subject: "词 A" }), false);
  assert.equal(store.activeKey, "A");
  assert.deepEqual(store.getActive().value, { answer: "A 的深入解释" });
});

test("the same pending identity is deduplicated and only its current generation may settle", () => {
  const store = createDeepReadingStore();

  assert.equal(store.activate("A"), true);
  assert.equal(store.begin("A", 7), true);
  assert.equal(store.activate("A"), false);
  assert.throws(() => store.begin("A", 8), /already owns another generation/);
  assert.equal(store.succeed("A", 6, { answer: "stale" }), false);
  assert.equal(store.succeed("A", 7, { answer: "current" }), true);
  assert.equal(store.succeed("A", 7, { answer: "duplicate" }), false);
  assert.deepEqual(store.get("A").value, { answer: "current" });
});

test("an error remains cached until an explicit retry begins a new generation", () => {
  const store = createDeepReadingStore();

  store.activate("A");
  store.begin("A", 1);
  assert.equal(store.fail("A", 1, new Error("第一次失败")), true);

  store.activate("B");
  store.begin("B", 2);
  assert.equal(store.activate("A"), false);
  assert.equal(store.getActive().status, "error");
  assert.equal(store.getActive().error, "第一次失败");

  assert.equal(store.begin("A", 3), true);
  assert.equal(store.get("A").status, "pending");
  assert.equal(store.succeed("A", 1, { answer: "迟到的旧结果" }), false);
  assert.equal(store.fail("A", 1, "迟到的旧错误"), false);
  assert.equal(store.succeed("A", 3, { answer: "重试成功" }), true);
  assert.deepEqual(store.get("A").value, { answer: "重试成功" });
});

test("hide preserves work, while reset rejects every late completion", () => {
  const store = createDeepReadingStore();

  store.activate("A");
  store.begin("A", 1);
  store.hide();
  assert.equal(store.activeKey, null);
  assert.equal(store.get("A").status, "pending");

  store.reset();
  assert.equal(store.size, 0);
  assert.equal(store.succeed("A", 1, { answer: "late" }), false);
  assert.equal(store.fail("A", 1, "late"), false);
});

test("capacity evicts the oldest non-active settled entry without evicting pending work", () => {
  const store = createDeepReadingStore({ maxEntries: 3 });

  store.activate("settled-oldest");
  store.begin("settled-oldest", 1);
  store.succeed("settled-oldest", 1, { answer: "oldest" });

  store.activate("settled-newer");
  store.begin("settled-newer", 2);
  store.succeed("settled-newer", 2, { answer: "newer" });

  store.activate("pending-kept");
  store.begin("pending-kept", 3);
  store.activate("active-pending");
  store.begin("active-pending", 4);

  assert.equal(store.size, 3);
  assert.equal(store.get("settled-oldest"), null);
  assert.equal(store.get("settled-newer").status, "success");
  assert.equal(store.get("pending-kept").status, "pending");
  assert.equal(store.get("active-pending").status, "pending");
});

test("store configuration and transitions validate their inputs", () => {
  assert.throws(() => createDeepReadingStore({ maxEntries: 0 }), /maxEntries/);
  assert.throws(() => createDeepReadingStore({ maxEntries: 257 }), /maxEntries/);
  assert.throws(() => createDeepReadingStore({ unknown: true }), /not allowed/);

  const store = createDeepReadingStore();
  assert.throws(() => store.activate(""), /must not be empty/);
  assert.throws(() => store.activate("A", []), /metadata must be an object/);
  assert.throws(() => store.begin("A", 1), /requires an activated/);
  store.activate("A");
  assert.throws(() => store.begin("A", 0), /positive safe integer/);
  store.begin("A", 1);
  assert.throws(() => store.succeed("A", 1, "not-an-object"), /value must be an object/);
  assert.throws(() => store.fail("A", 1, ""), /must not be empty/);
});

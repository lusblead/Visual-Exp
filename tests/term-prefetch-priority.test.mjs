import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTermPrefetchBatches,
  buildTermPrefetchQueue,
  deepTermExplanationCacheKey,
  nestedTermExplanationCacheKey,
  termExplanationCacheKey,
} from "../lib/term-prefetch-priority.mjs";

test("term prefetch ranks shallow nodes before deeper nodes and frequency within a depth", () => {
  const document = createDocument([
    node({
      id: "root",
      depth: 0,
      title: "缓存治理",
      summary: "冷门术语只在根节点出现一次。",
      detail: "先从全局边界进入，再展开 Agent 与 RAG 的协作机制。",
      terms: ["冷门术语"],
    }),
    node({
      id: "agent",
      depth: 1,
      title: "Agent",
      summary: "Agent 负责规划，RAG 提供材料。",
      detail: "Agent 在执行前调用 RAG，执行后仍由 Agent 检查结果。",
      terms: ["Agent", "RAG"],
    }),
    node({
      id: "rag",
      depth: 1,
      title: "RAG",
      summary: "RAG 检索材料，Agent 使用材料。",
      detail: "RAG 不等于 storage；RAG 需要保留证据边界。",
      terms: ["证据边界"],
    }),
    node({
      id: "stable-first",
      depth: 2,
      title: "稳定甲",
      summary: "甲术语说明甲机制。",
      detail: "甲术语只出现两次，用于验证稳定顺序。",
      terms: ["甲术语"],
    }),
    node({
      id: "stable-second",
      depth: 2,
      title: "稳定乙",
      summary: "乙术语说明乙机制。",
      detail: "乙术语只出现两次，用于验证稳定顺序。",
      terms: ["乙术语"],
    }),
    node({
      id: "later",
      depth: 3,
      title: "后续术语",
      summary: "后续术语属于更深层。",
      detail: "后续术语不会挤进默认的六项预取波次。",
      terms: ["后续术语"],
    }),
  ]);

  const queue = buildTermPrefetchQueue(document, { limit: 20 });

  assert.deepEqual(
    queue.map(({ nodeId, term }) => [nodeId, term]),
    [
      ["root", "冷门术语"],
      ["agent", "RAG"],
      ["agent", "Agent"],
      ["rag", "证据边界"],
      ["stable-first", "甲术语"],
      ["stable-second", "乙术语"],
      ["later", "后续术语"],
    ],
  );
  assert.ok(queue[0].frequency < queue[1].frequency);
  assert.ok(queue[1].frequency > queue[2].frequency);
  assert.deepEqual(buildTermPrefetchQueue(document), queue);
});

test("term prefetch limits work to the active reading layer and batches by node", () => {
  const document = createDocument([
    node({
      id: "root",
      depth: 0,
      title: "Transformer 与注意力",
      summary: "Transformer 使用注意力组织上下文。",
      detail: "注意力帮助模型建立位置之间的联系。",
      terms: ["Transformer", "注意力"],
    }),
    node({
      id: "block",
      depth: 1,
      title: "前馈网络",
      summary: "前馈网络使用 ReLU 或 GELU。",
      detail: "Dropout 可以用于训练期正则化。ReLU 是非线性激活函数。",
      terms: ["ReLU", "GELU", "Dropout", "非线性激活函数"],
    }),
    node({
      id: "other",
      depth: 1,
      title: "未显示兄弟",
      summary: "未显示兄弟不应进入当前队列。",
      detail: "未显示兄弟属于其他阅读上下文。",
      terms: ["未显示兄弟"],
    }),
    node({
      id: "deep",
      depth: 2,
      title: "更深术语",
      summary: "更深术语尚未进入当前阅读层。",
      detail: "更深术语不应提前解释。",
      terms: ["更深术语"],
    }),
  ]);

  const queue = buildTermPrefetchQueue(document, {
    includedNodeIds: ["root", "block"],
  });
  assert.deepEqual(
    queue.map(({ nodeId, term }) => [nodeId, term]),
    [
      ["root", "注意力"],
      ["root", "Transformer"],
      ["block", "ReLU"],
      ["block", "GELU"],
      ["block", "Dropout"],
      ["block", "非线性激活函数"],
    ],
  );

  const batches = buildTermPrefetchBatches(document, {
    includedNodeIds: ["root", "block"],
  });
  assert.deepEqual(
    batches.map((batch) => [batch.nodeId, batch.items.map((item) => item.term)]),
    [
      ["root", ["注意力", "Transformer"]],
      ["block", ["ReLU", "GELU", "Dropout", "非线性激活函数"]],
    ],
  );
});

test("term prefetch excludes cached in-flight and failed content identities", () => {
  const document = createDocument([
    node({
      id: "root",
      depth: 0,
      title: "Agent 与 RAG",
      summary: "Agent 调用 RAG。",
      detail: "ＡＧＥＮＴ 负责规划，RAG 提供受控材料。",
      terms: ["Agent", "ＡＧＥＮＴ", "RAG"],
    }),
    node({
      id: "retrieval",
      depth: 1,
      title: "向量检索",
      summary: "向量检索召回候选。",
      detail: "向量检索需要受范围约束。",
      terms: ["向量检索"],
    }),
    node({
      id: "boundary",
      depth: 1,
      title: "证据边界",
      summary: "证据边界限制结论强度。",
      detail: "证据边界也标记知识不足。",
      terms: ["证据边界"],
    }),
  ]);
  const agentKey = termExplanationCacheKey(
    document,
    document.nodes[0],
    "Agent",
  );
  const ragKey = termExplanationCacheKey(document, document.nodes[0], "RAG");
  const retrievalKey = termExplanationCacheKey(
    document,
    document.nodes[1],
    "向量检索",
  );

  const queue = buildTermPrefetchQueue(document, {
    cachedKeys: { [agentKey]: { definition: "cached" } },
    inFlightKeys: new Set([ragKey]),
    failedKeys: [retrievalKey],
    limit: 20,
  });

  assert.deepEqual(queue.map(({ term }) => term), ["证据边界"]);
  assert.equal(
    termExplanationCacheKey(document, document.nodes[0], "ＡＧＥＮＴ"),
    agentKey,
  );
});

test("term cache identity changes only when its node content changes", () => {
  const document = createDocument([
    node({
      id: "root",
      depth: 0,
      title: "Agent",
      summary: "Agent 负责规划。",
      detail: "Agent 根据反馈调整下一步动作。",
      terms: ["Agent"],
    }),
    node({
      id: "sibling",
      depth: 1,
      title: "RAG",
      summary: "RAG 提供材料。",
      detail: "RAG 只影响自己的节点正文。",
      terms: ["RAG"],
    }),
  ]);
  const original = termExplanationCacheKey(document, document.nodes[0], "Agent");

  const versionOnly = structuredClone(document);
  versionOnly.version += 1;
  assert.equal(
    termExplanationCacheKey(versionOnly, versionOnly.nodes[0], "Agent"),
    original,
  );

  const siblingOnly = structuredClone(versionOnly);
  siblingOnly.nodes[1].detail = "RAG 的兄弟节点正文已经更新。";
  assert.equal(
    termExplanationCacheKey(siblingOnly, siblingOnly.nodes[0], "Agent"),
    original,
  );

  for (const field of ["title", "summary", "detail"]) {
    const changed = structuredClone(document);
    changed.nodes[0][field] += " 已更新";
    assert.notEqual(
      termExplanationCacheKey(changed, changed.nodes[0], "Agent"),
      original,
      field,
    );
  }

  const anotherDocument = structuredClone(document);
  anotherDocument.id = "visual_other";
  assert.notEqual(
    termExplanationCacheKey(
      anotherDocument,
      anotherDocument.nodes[0],
      "Agent",
    ),
    original,
  );
});

test("nested term cache identity includes the validated parent explanation", () => {
  const document = createDocument([
    node({
      id: "root",
      depth: 0,
      title: "GELU",
      summary: "GELU 是一种激活函数。",
      detail: "激活函数为网络提供非线性。",
      terms: ["GELU"],
    }),
  ]);
  const parent = {
    term: "GELU",
    termPath: ["GELU"],
    definition: "GELU 是一种平滑的非线性激活函数。",
    relevance: "它位于前馈网络的两层线性变换之间。",
  };
  const original = nestedTermExplanationCacheKey(
    document,
    document.nodes[0],
    "非线性激活函数",
    parent,
  );
  assert.equal(
    nestedTermExplanationCacheKey(
      document,
      document.nodes[0],
      "非线性激活函数",
      structuredClone(parent),
    ),
    original,
  );
  const changed = structuredClone(parent);
  changed.relevance += " 它决定表示能力。";
  assert.notEqual(
    nestedTermExplanationCacheKey(
      document,
      document.nodes[0],
      "非线性激活函数",
      changed,
    ),
    original,
  );
});

test("deep term cache identity remains compatible after extraction from the UI", () => {
  const key = deepTermExplanationCacheKey(
    { id: "doc" },
    { id: "node" },
    " GELU ",
    {
      protocol: "visual-deep-explanation/1",
      subject: "前馈网络",
      nodeId: "node",
      directAnswer: "a",
      background: "b",
      role: "c",
      mechanism: "d",
      boundary: "e",
      terms: ["GELU", "ReLU"],
    },
  );

  assert.equal(
    key,
    "deep-term-definition:v1:doc:node:gelu:d7f3cfc1",
  );
});

function createDocument(nodes) {
  return {
    protocol: "visual-explanation-document/2",
    id: "visual_prefetch",
    version: 1,
    rootId: nodes[0].id,
    nodes,
  };
}

function node({
  id,
  depth,
  title,
  summary,
  detail,
  terms,
}) {
  return { id, depth, title, summary, detail, terms };
}

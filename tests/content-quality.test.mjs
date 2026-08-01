import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTextMatchesMathPreference,
  assertVisualDocumentContentQuality,
  assertVisualExpansionContentQuality,
  assertVisualNodeContentQuality,
  normalizeTermIdentity,
  questionRequestsMathematics,
  resolveMathMode,
} from "../lib/visual-content-quality.ts";

function node(overrides = {}) {
  return {
    id: "node-agent",
    parentId: "root",
    title: "Agent 与 RAG",
    eyebrow: "机制",
    summary: "Agent 根据目标规划任务，并用 RAG 补充受控知识上下文。",
    detail:
      "Agent 把目标拆成步骤并调用外部工具，RAG 则在生成前检索相关材料。两者必须由权限、来源校验和执行反馈约束，否则流畅回答并不等于可靠结果。",
    terms: ["Agent", "RAG"],
    kind: "system",
    view: "cluster",
    depth: 1,
    childIds: [],
    expandable: true,
    expansionState: "outline",
    emphasis: "primary",
    confidence: "medium",
    sourceStatus: "model_knowledge",
    evidence: [],
    ...overrides,
  };
}

test("content quality accepts substantive content and actual body terms", () => {
  assert.doesNotThrow(() => assertVisualNodeContentQuality(node()));
  assert.equal(normalizeTermIdentity("ＡＧＥＮＴ"), "agent");
});

test("content quality rejects thin, repeated, and navigation-filled text", () => {
  assert.throws(
    () => assertVisualNodeContentQuality(node({ summary: "太短" })),
    /summary/,
  );
  assert.throws(
    () => assertVisualNodeContentQuality(node({ detail: "内容太薄。" })),
    /detail/,
  );
  const repeated =
    "Agent 与 RAG 分别负责执行规划和受控知识补充，并共同受权限与来源边界约束。";
  assert.throws(
    () =>
      assertVisualNodeContentQuality(
        node({ summary: repeated, detail: repeated, terms: ["Agent", "RAG"] }),
      ),
    /不能重复/,
  );
  assert.throws(
    () =>
      assertVisualNodeContentQuality(
        node({
          detail:
            "点击 Agent 后继续进入下一层内容，可以查看更多说明。这句话只描述界面导航，没有解释机制、重要性或边界。",
          terms: ["Agent"],
        }),
      ),
    /导航填充/,
  );
});

test("terms are single-line, normalized-deduplicated, bounded, and present in content", () => {
  assert.throws(
    () =>
      assertVisualNodeContentQuality(
        node({ terms: ["Agent", "ＡＧＥＮＴ", "RAG"] }),
      ),
    /重复/,
  );
  assert.throws(
    () => assertVisualNodeContentQuality(node({ terms: ["Agent\nRAG"] })),
    /单行/,
  );
  assert.throws(
    () =>
      assertVisualNodeContentQuality(
        node({
          title: "Storage",
          summary: "Storage 保存模型运行所需的数据和状态，但它本身不是检索增强生成。",
          detail:
            "Storage 负责持久化与恢复，设计重点是版本、权限和数据完整性。它不应因为英文拼写中含有连续字母，就被误标注成另一个术语。",
          terms: ["RAG"],
        }),
      ),
    /没有实际出现在/,
  );
  assert.throws(
    () => assertVisualNodeContentQuality(node({ terms: ["A".repeat(41)] })),
    /术语长度/,
  );
  assert.throws(
    () =>
      assertVisualNodeContentQuality(
        node({ terms: ["ＡＧＥＮＴ", "RAG"] }),
      ),
    /没有实际出现在/,
  );
});

test("terms allow eight visible annotations and reject a ninth", () => {
  const terms = ["Agent", "RAG", "LLM", "API", "MCP", "Embedding", "向量检索", "权限边界"];
  const content = `${terms.join("、")}共同构成可观察的知识与执行系统。`;
  assert.doesNotThrow(() =>
    assertVisualNodeContentQuality(
      node({
        title: "八个关键术语",
        summary: content,
        detail: `${content} 每个术语都必须实际出现在正文，并拥有明确的作用范围和失败边界。`,
        terms,
      }),
    ),
  );
  assert.throws(
    () =>
      assertVisualNodeContentQuality(
        node({
          title: "九个关键术语",
          summary: `${content}、审计共同参与系统治理。`,
          detail: `${content}、审计都需要独立说明其责任和边界，不能只作为标签出现。`,
          terms: [...terms, "审计"],
        }),
      ),
    /不能超过 8/,
  );
});

test("math mode distinguishes avoid optional and requested explanations", () => {
  assert.equal(resolveMathMode("请不要用公式，通俗解释注意力"), "avoid");
  assert.equal(resolveMathMode("Explain attention without equations"), "avoid");
  assert.equal(resolveMathMode("Explain attention without using formulas"), "avoid");
  assert.equal(resolveMathMode("我不想看公式，只讲直觉"), "avoid");
  assert.equal(resolveMathMode("Transformer 架构是什么？"), "optional");
  assert.equal(resolveMathMode("请推导注意力公式"), "requested");
  assert.equal(resolveMathMode("请解释 FFN(x)=W2x"), "requested");
  assert.equal(resolveMathMode("请给出公式，但不要推导过程"), "requested");

  assert.equal(questionRequestsMathematics("请推导注意力公式"), true);
  assert.equal(questionRequestsMathematics("请解释 FFN(x)=W2x"), true);
  assert.equal(questionRequestsMathematics("Transformer 架构是什么？"), false);
  assert.equal(questionRequestsMathematics("请不要用公式解释"), false);
});

test("optional math accepts one explained formula but rejects unexplained or repeated formulas", () => {
  assert.doesNotThrow(() =>
    assertTextMatchesMathPreference(
      "Transformer 架构是什么？",
      "前馈层可写成 FFN(x)=W₂x，表示它把当前位置的表示变换后交给下一层处理。",
    ),
  );
  assert.throws(
    () =>
      assertTextMatchesMathPreference(
        "Transformer 架构是什么？",
        "前馈层直接计算 FFN(x)=W2x，再把结果交给下一层。",
      ),
    /紧跟通俗解释/,
  );
  assert.throws(
    () =>
      assertTextMatchesMathPreference(
        "Transformer 架构是什么？",
        "先计算 a=1，表示第一步的输入；再计算 b=2，表示第二步的输出。",
      ),
    /最多允许一个/,
  );
});

test("avoid math rejects notation while requested math permits a full derivation", () => {
  assert.throws(
    () =>
      assertTextMatchesMathPreference(
        "请不要用公式，通俗解释 Transformer",
        "前馈层可以写为 FFN(x)=W2x。",
      ),
    /不能加入公式/,
  );
  assert.doesNotThrow(() =>
    assertTextMatchesMathPreference(
      "请推导 Transformer 的数学公式",
      "先写 FFN(x)=W2x，再用 y=x+FFN(x) 推导残差路径。",
    ),
  );
});

test("optional math budget is shared across one generated visual document", () => {
  const first = node({
    id: "node-first",
    detail:
      "Agent 可以把一个状态写为 a=1，表示当前任务已经进入执行阶段，随后再根据工具反馈更新状态。",
  });
  const second = node({
    id: "node-second",
    detail:
      "RAG 可以把另一个状态写为 b=2，表示受控材料已经进入当前上下文，随后才允许生成回答。",
  });
  assert.throws(
    () =>
      assertVisualDocumentContentQuality({
        protocol: "visual-explanation-document/2",
        id: "doc-math-budget",
        question: "Agent 与 RAG 如何协作？",
        title: "协作机制",
        thesis: "执行与知识上下文必须分开治理。",
        rootId: first.id,
        nodes: [first, second],
        relations: [],
        version: 1,
      }),
    /最多允许一个/,
  );
});

test("expansion requires exactly one current-node detail/view/terms update", () => {
  const parent = node();
  const document = {
    protocol: "visual-explanation-document/2",
    id: "doc",
    question: "Agent 与 RAG 如何协作？",
    title: "Agent 与 RAG",
    thesis: "执行规划与受控知识应由不同机制承担。",
    rootId: parent.id,
    nodes: [{ ...parent, parentId: null, depth: 0 }],
    relations: [],
    version: 1,
  };
  const child = node({
    id: "child",
    parentId: parent.id,
    title: "工具执行",
    summary: "Agent 通过受约束的工具接口读取或修改外部系统状态。",
    detail:
      "工具执行把语言判断转换成真实操作，因此必须在调用前检查权限和参数。调用后还要记录结果并处理失败，避免把模型输出直接当作已完成动作。",
    terms: ["Agent"],
    depth: 1,
  });
  const validUpdate = {
    kind: "update_node",
    node: null,
    relation: null,
    nodeId: parent.id,
    patch: {
      title: null,
      eyebrow: null,
      summary: null,
      detail:
        "Agent 负责目标分解与工具编排，RAG 负责把受控材料带入当前推理。两者协作时仍需分开治理执行权限、检索来源与失败恢复，因为知识相关不代表动作安全。",
      terms: ["Agent", "RAG"],
      view: "sequence",
      expandable: null,
      expansionState: null,
      emphasis: null,
    },
  };
  const batch = {
    protocol: "visual-explanation-operations/2",
    baseVersion: 1,
    operations: [
      validUpdate,
      {
        kind: "add_node",
        node: child,
        relation: null,
        nodeId: null,
        patch: null,
      },
    ],
  };

  assert.doesNotThrow(() =>
    assertVisualExpansionContentQuality(document, parent.id, batch),
  );
  assert.throws(
    () =>
      assertVisualExpansionContentQuality(document, parent.id, {
        ...batch,
        operations: batch.operations.slice(1),
      }),
    /恰好包含一个/,
  );
  assert.throws(
    () =>
      assertVisualExpansionContentQuality(document, parent.id, {
        ...batch,
        operations: [
          {
            ...validUpdate,
            patch: { ...validUpdate.patch, summary: "不允许更新摘要" },
          },
          batch.operations[1],
        ],
      }),
    /只能修改 detail、view 与 terms/,
  );
});

process.env.EXPLANATION_MODEL_PROVIDER = "demo";
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("content-quality-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const workerEnvironment = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

function post(body) {
  return worker.fetch(
    new Request("http://localhost/api/lineage", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    workerEnvironment,
    executionContext,
  );
}

test("legacy documents without terms are normalized and remain expandable", async () => {
  const created = await (
    await post({
      action: "create",
      question: "Agent 和 RAG 应该如何组成一个可靠系统？",
    })
  ).json();
  const legacyDocument = structuredClone(created.document);
  for (const item of legacyDocument.nodes) delete item.terms;
  const selected = legacyDocument.nodes.find(
    (item) => item.parentId === legacyDocument.rootId,
  );
  assert.ok(selected);

  const response = await post({
    action: "expand",
    document: legacyDocument,
    nodeId: selected.id,
  });
  assert.equal(response.status, 200);
  const expanded = await response.json();
  assert.ok(expanded.document.nodes.every((item) => Array.isArray(item.terms)));
});

test("demo create and expand satisfy the shared content-quality invariant", async () => {
  const created = await (
    await post({
      action: "create",
      question: "Agent 和 RAG 应该如何组成一个可靠系统？",
    })
  ).json();
  for (const item of created.document.nodes) {
    assert.doesNotThrow(() => assertVisualNodeContentQuality(item));
  }
  const root = created.document.nodes.find(
    (item) => item.id === created.document.rootId,
  );
  assert.ok(root.terms.some((term) => normalizeTermIdentity(term) === "agent"));
  assert.ok(root.terms.some((term) => normalizeTermIdentity(term) === "rag"));

  const selected = created.document.nodes.find(
    (item) => item.parentId === created.document.rootId,
  );
  const expanded = await (
    await post({
      action: "expand",
      document: created.document,
      nodeId: selected.id,
    })
  ).json();
  assert.equal(
    expanded.operations.operations.filter((operation) => operation.kind === "update_node")
      .length,
    1,
  );
  for (const item of expanded.document.nodes) {
    assert.doesNotThrow(() => assertVisualNodeContentQuality(item));
  }
});

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (error) {
        if (
          error?.code === "ERR_MODULE_NOT_FOUND" &&
          /^\\.{1,2}\\//u.test(specifier) &&
          !/\\.[^/]+$/u.test(specifier)
        ) {
          return nextResolve(specifier + ".ts", context);
        }
        throw error;
      }
    }
  `)}`,
  import.meta.url,
);

const {
  createKnowledgeExport,
  createKnowledgeExportArtifact,
  renderKnowledgeExportMarkdown,
  safeKnowledgeExportFilename,
  serializeKnowledgeExport,
} = await import("../lib/knowledge-export.ts");

const FORBIDDEN_CONTEXT_TOKEN = "ect1.forbidden-export-token";
const FORBIDDEN_SECRET = "sk-forbidden-export-secret";
const FORBIDDEN_RECEIPT_ID = "usage-internal-id-42";

test("JSON and Markdown exports are deterministic and secret free", () => {
  const first = createKnowledgeExport({
    document: documentFixture({
      apiKey: FORBIDDEN_SECRET,
      runtimeController: { secret: FORBIDDEN_SECRET },
    }),
    navigation: {
      entries: ["root", "architecture", "encoder"],
      cursor: 1,
      runtimeRequestId: 99,
    },
    termExplanations: [
      {
        cacheKey: "internal-term-cache-key",
        contextToken: FORBIDDEN_CONTEXT_TOKEN,
        explanation: termExplanation("Self-Attention（自注意力）", "attention"),
      },
      {
        contextToken: FORBIDDEN_CONTEXT_TOKEN,
        explanation: termExplanation("Encoder（编码器）", "encoder"),
      },
    ],
    deepExplanations: [
      {
        receiptId: FORBIDDEN_RECEIPT_ID,
        usage: { promptTokens: 123 },
        secret: FORBIDDEN_SECRET,
        state: {
          explanation: deepExplanation("Encoder（编码器）", "encoder"),
        },
      },
    ],
    apiKey: FORBIDDEN_SECRET,
  });

  const second = createKnowledgeExport({
    document: documentFixture(),
    navigation: { entries: ["root", "architecture", "encoder"], cursor: 1 },
    termExplanations: [
      termExplanation("Encoder（编码器）", "encoder"),
      termExplanation("Self-Attention（自注意力）", "attention"),
    ],
    deepExplanations: [deepExplanation("Encoder（编码器）", "encoder")],
  });

  assert.deepEqual(first, second);
  assert.equal(first.protocol, "visual-knowledge-export/1");
  assert.deepEqual(first.navigation, {
    entries: ["root", "architecture", "encoder"],
    cursor: 1,
  });
  assert.deepEqual(
    first.explanations.terms.map((item) => item.nodeId),
    ["encoder", "attention"],
  );

  const json = serializeKnowledgeExport(first);
  const markdown = renderKnowledgeExportMarkdown(first);
  assert.deepEqual(JSON.parse(json), first);
  const forgedEnvelope = serializeKnowledgeExport({
    ...first,
    contextToken: FORBIDDEN_CONTEXT_TOKEN,
    usage: { id: FORBIDDEN_RECEIPT_ID },
  });
  assert.deepEqual(JSON.parse(forgedEnvelope), first);
  for (const forbidden of [
    FORBIDDEN_CONTEXT_TOKEN,
    FORBIDDEN_SECRET,
    FORBIDDEN_RECEIPT_ID,
    "contextToken",
    "cacheKey",
    "runtimeController",
    "runtimeRequestId",
    '"usage"',
  ]) {
    assert.equal(json.includes(forbidden), false, forbidden);
    assert.equal(markdown.includes(forbidden), false, forbidden);
  }
});

test("Markdown follows canonical childIds and includes source, relations, and completed explanations", () => {
  const value = createKnowledgeExport({
    document: documentFixture(),
    navigation: { entries: ["root"], cursor: 0 },
    termExplanations: [
      termExplanation("Self-Attention（自注意力）", "attention"),
      termExplanation("Encoder（编码器）", "encoder"),
    ],
    deepExplanations: [deepExplanation("Encoder（编码器）", "encoder")],
  });
  const markdown = renderKnowledgeExportMarkdown(value);

  assert.match(markdown, /^# Transformer 架构$/mu);
  assert.match(markdown, /\*\*问题：\*\* Transformer 架构如何工作？/u);
  assert.match(markdown, /## 原始材料/u);
  assert.match(markdown, /> 输入 token 序列/u);
  assert.match(markdown, /## Transformer 的整体信息流/u);
  assert.match(markdown, /\*\*核心结论：\*\* Transformer 先编码输入，再按任务产生输出。/u);
  assert.match(markdown, /\*\*关系\*\*/u);
  assert.match(markdown, /架构主体 —先理解结构→ 注意力机制/u);
  assert.match(markdown, /\*\*名词解释\*\*/u);
  assert.match(markdown, /Self-Attention（自注意力）/u);
  assert.match(markdown, /\*\*深入解释\*\*/u);
  assert.match(markdown, /机制：编码器逐层整合上下文/u);

  const architectureIndex = markdown.indexOf("### 1 架构主体");
  const encoderIndex = markdown.indexOf("#### 1.1 Encoder（编码器）");
  const attentionIndex = markdown.indexOf("### 2 注意力机制");
  assert.ok(architectureIndex > 0);
  assert.ok(encoderIndex > architectureIndex);
  assert.ok(attentionIndex > encoderIndex);
});

test("export rejects invalid navigation and explanations from another document", () => {
  const document = documentFixture();
  assert.throws(
    () =>
      createKnowledgeExport({
        document,
        navigation: { entries: ["root", "missing"], cursor: 1 },
      }),
    /指向的节点不存在/u,
  );
  assert.throws(
    () =>
      createKnowledgeExport({
        document,
        navigation: { entries: ["root"], cursor: 2 },
      }),
    /cursor 超出历史范围/u,
  );
  assert.throws(
    () =>
      createKnowledgeExport({
        document,
        navigation: { entries: ["root"], cursor: 0 },
        deepExplanations: [deepExplanation("陌生主题", "other-document-node")],
      }),
    /指向的节点不存在/u,
  );
  assert.throws(
    () =>
      createKnowledgeExport({
        document,
        navigation: { entries: ["root"], cursor: 0 },
        termExplanations: [
          {
            status: "pending",
            explanation: termExplanation("Encoder（编码器）", "encoder"),
          },
        ],
      }),
    /不是已完成状态/u,
  );
});

test("artifact creation is pure and produces safe portable filenames", () => {
  const input = {
    document: documentFixture({ title: '  CON: Transformer / "架构"  ' }),
    navigation: { entries: ["root"], cursor: 0 },
  };
  const before = structuredClone(input);
  const json = createKnowledgeExportArtifact(input, "json");
  const markdown = createKnowledgeExportArtifact(input, "markdown");

  assert.deepEqual(input, before);
  assert.equal(json.mediaType, "application/json");
  assert.equal(markdown.mediaType, "text/markdown");
  assert.match(json.filename, /^CON-Transformer-架构\.json$/u);
  assert.match(markdown.filename, /^CON-Transformer-架构\.md$/u);
  assert.equal(JSON.parse(json.content).protocol, "visual-knowledge-export/1");
  assert.match(markdown.content, /^# CON: Transformer \/ "架构"$/mu);

  assert.equal(safeKnowledgeExportFilename(" NUL ", "json"), "knowledge-NUL.json");
  assert.equal(safeKnowledgeExportFilename(" ?<> ", "markdown"), "knowledge.md");
  assert.throws(
    () => createKnowledgeExportArtifact(input, "xml"),
    /format 必须是 json 或 markdown/u,
  );
});

function documentFixture(overrides = {}) {
  const root = node({
    id: "root",
    parentId: null,
    depth: 0,
    title: "Transformer 的整体信息流",
    summary: "Transformer 先编码输入，再按任务产生输出。",
    detail:
      "它解决序列信息难以并行处理的问题。\n\n架构主体与注意力机制共同承担信息组织。",
    childIds: ["architecture", "attention"],
  });
  const architecture = node({
    id: "architecture",
    parentId: "root",
    depth: 1,
    title: "架构主体",
    summary: "架构主体由编码与输出路径组成。",
    detail: "这一层说明信息先在哪里被组织，再如何交给下游任务。",
    childIds: ["encoder"],
  });
  const encoder = node({
    id: "encoder",
    parentId: "architecture",
    depth: 2,
    title: "Encoder（编码器）",
    summary: "Encoder（编码器）把输入整理成上下文表示。",
    detail: "它逐层读取各位置之间的联系，并保留可供后续使用的信息。",
    terms: ["Encoder（编码器）"],
    childIds: [],
    expandable: false,
    expansionState: "terminal",
  });
  const attention = node({
    id: "attention",
    parentId: "root",
    depth: 1,
    title: "注意力机制",
    summary: "Self-Attention（自注意力）让各位置直接交换信息。",
    detail: "它根据当前任务动态决定哪些位置更值得参考，并汇总相关内容。",
    terms: ["Self-Attention（自注意力）"],
    childIds: [],
    expandable: false,
    expansionState: "terminal",
  });

  return {
    protocol: "visual-explanation-document/2",
    id: "visual_transformer_export",
    question: "Transformer 架构如何工作？",
    title: "Transformer 架构",
    thesis: "先理解信息流，再深入组件，避免把术语列表误当成整体解释。",
    rootId: "root",
    primaryMaterial: {
      protocol: "visual-primary-material/1",
      kind: "code",
      title: "示意输入",
      creator: null,
      display: "complete",
      provenance: "user_supplied",
      body: "输入 token 序列",
      attribution: "由用户提供的抽象输入",
      sourceUrl: null,
      omissionReason: null,
    },
    nodes: [root, architecture, encoder, attention],
    relations: [
      {
        id: "relation-root",
        scopeId: "root",
        from: "architecture",
        to: "attention",
        kind: "sequence",
        label: "先理解结构",
      },
    ],
    version: 3,
    ...overrides,
  };
}

function node({
  id,
  parentId,
  depth,
  title,
  summary,
  detail,
  childIds,
  terms = [],
  expandable = childIds.length > 0,
  expansionState = childIds.length > 0 ? "expanded" : "outline",
}) {
  return {
    id,
    parentId,
    title,
    eyebrow: "",
    summary,
    detail,
    terms,
    kind: "concept",
    view: "sequence",
    depth,
    childIds,
    expandable,
    expansionState,
    emphasis: depth === 0 ? "primary" : "secondary",
    confidence: "high",
    sourceStatus: "model_knowledge",
    evidence: [],
  };
}

function termExplanation(term, nodeId) {
  return {
    protocol: "visual-term-explanation/2",
    term,
    termPath: [term],
    nodeId,
    definition: `${term} 是当前结构中的关键组件。`,
    relevance: `${term} 用于解释当前节点承担的职责。`,
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

function deepExplanation(subject, nodeId) {
  return {
    protocol: "visual-deep-explanation/1",
    subject,
    nodeId,
    directAnswer: `${subject} 负责形成可供后续读取的上下文。`,
    background: "逐词串行处理会增加长距离信息传递成本。",
    role: "它把原始输入转换为结构化的中间表示。",
    mechanism: "编码器逐层整合上下文，并把结果传递给后续路径。",
    boundary: "它本身不决定最终任务的输出形式。",
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

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
  KNOWLEDGE_SESSION_MAX_TERM_RESULTS,
  createKnowledgeSession,
  parseKnowledgeSession,
} = await import("../lib/knowledge-session-contract.ts");
const {
  deepTermExplanationCacheKey,
  nestedTermExplanationCacheKey,
  termExplanationCacheKey,
} = await import("../lib/term-prefetch-priority.mjs");
const { deepReadingCacheKey } = await import(
  "../lib/deep-reading-cache.mjs"
);

const CONTEXT_TOKEN = `ect1.${"A".repeat(43)}`;

function document() {
  return {
    protocol: "visual-explanation-document/2",
    id: "knowledge_transformer",
    question: "Transformer 是怎样工作的？",
    title: "Transformer 架构",
    thesis: "先理解输入表示，再观察注意力如何连接编码器与解码器。",
    rootId: "transformer-root",
    nodes: [
      {
        id: "transformer-root",
        parentId: null,
        title: "Transformer 架构",
        eyebrow: "整体",
        summary: "Transformer 用注意力机制组织序列信息。",
        detail: "编码器（Encoder）读取输入，解码器（Decoder）逐步生成输出。",
        terms: ["注意力机制", "编码器（Encoder）", "解码器（Decoder）"],
        kind: "topic",
        view: "sequence",
        depth: 0,
        childIds: [],
        expandable: false,
        expansionState: "terminal",
        emphasis: "primary",
        confidence: "high",
        sourceStatus: "model_knowledge",
        evidence: [],
      },
    ],
    relations: [],
    version: 1,
  };
}

function termExplanation(term = "注意力机制") {
  return {
    protocol: "visual-term-explanation/2",
    term,
    termPath: [term],
    nodeId: "transformer-root",
    definition: `${term}让序列中的一个位置读取其他位置的信息。`,
    relevance: `在当前架构中，${term}负责建立输入之间的联系。`,
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

function deepExplanation() {
  return {
    protocol: "visual-deep-explanation/1",
    subject: "编码器（Encoder）",
    nodeId: "transformer-root",
    directAnswer: "编码器把输入序列转换为可供后续读取的上下文表示。",
    background: "逐词孤立处理无法保留词语之间的关系，因此需要统一编码输入。",
    role: "它为解码器提供包含语义和位置联系的输入表示。",
    mechanism: "输入依次经过注意力层和前馈网络，并通过残差连接保留信息。",
    boundary: "编码器负责表示输入，本身不决定最终输出顺序。",
    terms: ["注意力层", "前馈网络", "残差连接"],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

function nestedTermExplanation(parent, term) {
  return {
    protocol: "visual-term-explanation/2",
    term,
    termPath: [...parent.termPath, term],
    nodeId: parent.nodeId,
    definition: `${term}是当前父级解释中继续展开的概念。`,
    relevance: `${term}补充说明父级机制如何传递信息。`,
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

function deepTermExplanation(parent, term) {
  return {
    protocol: "visual-term-explanation/2",
    term,
    termPath: [parent.subject, term],
    nodeId: parent.nodeId,
    definition: `${term}是深入解释正文中标注的结构。`,
    relevance: `${term}说明当前深入机制中的一个直接组成部分。`,
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

function dependentDeepExplanation(subject) {
  return {
    protocol: "visual-deep-explanation/1",
    subject,
    nodeId: "transformer-root",
    directAnswer: `${subject}可以在父解释基础上继续建立更细的理解。`,
    background: `只看父级结论不足以解释${subject}的内部原因。`,
    role: `${subject}承担父级机制中的局部职责。`,
    mechanism: `${subject}读取父级上下文并形成下一层解释。`,
    boundary: `${subject}只解释当前局部，不替代整体结构。`,
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
}

function persistedDeepResult(key, explanation) {
  return {
    key,
    state: {
      status: "ready",
      subject: explanation.subject,
      sourceNodeId: explanation.nodeId,
      explanation,
      title: `深入理解：${explanation.subject}`,
      terms: explanation.terms,
    },
    contextToken: CONTEXT_TOKEN,
  };
}

function draft(overrides = {}) {
  const visualDocument = document();
  const node = visualDocument.nodes[0];
  const explanation = termExplanation();
  const deep = deepExplanation();
  const termKey = termExplanationCacheKey(
    visualDocument,
    node,
    explanation.term,
  );
  const deepKey = deepReadingCacheKey(
    visualDocument,
    node,
    deep.subject,
  );
  return {
    id: "session-transformer",
    createdAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:05:00.000Z",
    revision: 3,
    document: visualDocument,
    navigation: { entries: ["transformer-root"], cursor: 0 },
    termResults: [
      {
        key: termKey,
        explanation,
        contextToken: CONTEXT_TOKEN,
      },
    ],
    termCards: { [termKey]: [termKey] },
    visibleTermCardKeys: [termKey],
    deepResults: [
      {
        key: deepKey,
        state: {
          status: "ready",
          subject: deep.subject,
          sourceNodeId: deep.nodeId,
          explanation: deep,
          title: `深入理解：${deep.subject}`,
          paragraphs: [
            {
              id: "direct",
              label: "直接理解",
              text: deep.directAnswer,
            },
          ],
          terms: deep.terms,
        },
        contextToken: CONTEXT_TOKEN,
      },
    ],
    activeDeepKey: deepKey,
    prefetchProfile: "balanced",
    usageReceipts: [
      {
        id: "receipt-1",
        recordedAt: "2026-07-28T09:04:00.000Z",
        action: "expand",
        lane: "background",
        model: "deepseek-v4-pro",
        durationMs: 1280.5,
        outcome: "success",
        frontierKey: "frontier-transformer-root-v1",
        resourceKey: "node-attention",
        usage: {
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
          promptCacheHitTokens: null,
          promptCacheMissTokens: null,
        },
        preparedConsumed: true,
      },
      {
        id: "receipt-2",
        recordedAt: "2026-07-28T09:04:30.000Z",
        action: "define",
        lane: "foreground",
        model: "deepseek-v4-flash",
        durationMs: 620,
        outcome: "success",
        frontierKey: null,
        resourceKey: "node-root",
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          promptCacheHitTokens: null,
          promptCacheMissTokens: null,
        },
        preparedConsumed: false,
      },
    ],
    ...overrides,
  };
}

test("createKnowledgeSession produces a canonical v1 record that round-trips", () => {
  const created = createKnowledgeSession(draft());
  assert.equal(created.protocol, "visual-knowledge-session/1");
  assert.equal(created.document.protocol, "visual-explanation-document/2");
  assert.equal(created.termResults[0].explanation.protocol, "visual-term-explanation/2");
  assert.equal(created.deepResults[0].state.status, "ready");
  assert.equal(created.usageReceipts[0].usage.promptTokens, 120);
  assert.equal(created.usageReceipts[1].usage.promptTokens, null);
  assert.deepEqual(parseKnowledgeSession(structuredClone(created)), created);
});

test("restore recomputes a base term key and drops a mismatched persisted key", () => {
  const persisted = createKnowledgeSession(draft());
  const wrongKey = `${persisted.termResults[0].key}:stale`;
  persisted.termResults[0].key = wrongKey;
  persisted.termCards = { [wrongKey]: [wrongKey] };
  persisted.visibleTermCardKeys = [wrongKey];

  const restored = parseKnowledgeSession(persisted);

  assert.deepEqual(restored.termResults, []);
  assert.deepEqual(restored.termCards, {});
  assert.deepEqual(restored.visibleTermCardKeys, []);
  assert.equal(restored.deepResults.length, 1);
});

test("restore keeps nested and deep-term results only through canonical parents", () => {
  const source = draft();
  const node = source.document.nodes[0];
  const base = source.termResults[0];
  base.explanation.definition +=
    " 查询向量决定当前位置要从其他位置读取什么信息。";
  base.explanation.terms = ["查询向量"];
  const nested = nestedTermExplanation(base.explanation, "查询向量");
  const nestedKey = nestedTermExplanationCacheKey(
    source.document,
    node,
    nested.term,
    base.explanation,
  );
  source.termResults.push({
    key: nestedKey,
    explanation: nested,
    contextToken: CONTEXT_TOKEN,
  });
  source.termCards[base.key] = [base.key, nestedKey];

  const deepParent = source.deepResults[0].state.explanation;
  const deepTerm = deepTermExplanation(deepParent, "注意力层");
  const deepTermKey = deepTermExplanationCacheKey(
    source.document,
    node,
    deepTerm.term,
    deepParent,
  );
  source.termResults.push({
    key: deepTermKey,
    explanation: deepTerm,
    contextToken: CONTEXT_TOKEN,
  });
  source.termCards[deepTermKey] = [deepTermKey];
  source.visibleTermCardKeys = [base.key, deepTermKey];

  const created = createKnowledgeSession(source);
  const restored = parseKnowledgeSession(structuredClone(created));

  assert.deepEqual(
    restored.termResults.map((result) => result.key),
    [base.key, nestedKey, deepTermKey],
  );
  assert.deepEqual(restored.termCards[base.key], [base.key, nestedKey]);
  assert.deepEqual(restored.termCards[deepTermKey], [deepTermKey]);
});

test("canonical deep lineage is retained and dependent caches are cleaned when its parent key is corrupt", () => {
  const source = draft();
  const node = source.document.nodes[0];
  const parent = source.deepResults[0];
  const childExplanation = dependentDeepExplanation("残差连接");
  const childKey = deepReadingCacheKey(
    source.document,
    node,
    childExplanation.subject,
    { parentDeepExplanation: parent.state.explanation },
  );
  source.deepResults.push(
    persistedDeepResult(childKey, childExplanation),
  );

  const childTerm = deepTermExplanation(
    parent.state.explanation,
    "注意力层",
  );
  const childTermKey = deepTermExplanationCacheKey(
    source.document,
    node,
    childTerm.term,
    parent.state.explanation,
  );
  source.termResults.push({
    key: childTermKey,
    explanation: childTerm,
    contextToken: CONTEXT_TOKEN,
  });
  source.termCards[childTermKey] = [childTermKey];
  source.visibleTermCardKeys = [childTermKey];
  source.activeDeepKey = childKey;

  const created = createKnowledgeSession(source);
  assert.deepEqual(
    created.deepResults.map((result) => result.key),
    [parent.key, childKey],
  );

  created.deepResults[0].key = `${parent.key}:corrupt`;
  const restored = parseKnowledgeSession(created);

  assert.deepEqual(restored.deepResults, []);
  assert.equal(
    restored.termResults.some((result) => result.key === childTermKey),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(restored.termCards, childTermKey),
    false,
  );
  assert.deepEqual(restored.visibleTermCardKeys, []);
  assert.equal(restored.activeDeepKey, null);
});

test("one corrupt cache entry is isolated while strict creation still rejects it", () => {
  const valid = createKnowledgeSession(draft());
  const corrupt = {
    key: "term-definition:v2:corrupt",
    explanation: termExplanation("损坏缓存"),
    contextToken: "not-a-context-token",
  };
  const persisted = structuredClone(valid);
  persisted.termResults.push(corrupt);

  const restored = parseKnowledgeSession(persisted);

  assert.equal(restored.document.id, valid.document.id);
  assert.deepEqual(restored.navigation, valid.navigation);
  assert.deepEqual(restored.termResults, valid.termResults);
  assert.throws(
    () =>
      createKnowledgeSession({
        ...draft(),
        termResults: [...draft().termResults, corrupt],
      }),
    /opaque ect1 context token/u,
  );
});

test("strict creation rejects a well-formed cache with a noncanonical identity", () => {
  const source = draft();
  const originalKey = source.termResults[0].key;
  const wrongKey = `${originalKey}:wrong-source`;
  source.termResults[0].key = wrongKey;
  source.termCards = { [wrongKey]: [wrongKey] };
  source.visibleTermCardKeys = [wrongKey];

  assert.throws(
    () => createKnowledgeSession(source),
    /cache identity does not match a canonical explanation source/u,
  );
});

test("duplicate cache identities are all dropped instead of selecting by record order", () => {
  const persisted = createKnowledgeSession(draft());
  persisted.termResults.push(structuredClone(persisted.termResults[0]));

  const restored = parseKnowledgeSession(persisted);

  assert.deepEqual(restored.termResults, []);
  assert.deepEqual(restored.termCards, {});
  assert.deepEqual(restored.visibleTermCardKeys, []);
});

test("invalid navigation repairs to the canonical root without rejecting knowledge", () => {
  const valid = createKnowledgeSession(draft());
  const invalidNavigations = [
    { entries: ["transformer-root", "missing-node"], cursor: 1 },
    { entries: [], cursor: 0 },
    { entries: ["transformer-root"], cursor: -1 },
    { entries: ["transformer-root"], cursor: 1 },
    { entries: ["transformer-root"], cursor: 0.5 },
    { entries: ["transformer-root"], cursor: 0, future: true },
  ];
  for (const navigation of invalidNavigations) {
    const persisted = structuredClone(valid);
    persisted.navigation = navigation;
    const parsed = parseKnowledgeSession(persisted);
    assert.deepEqual(parsed.navigation, {
      entries: ["transformer-root"],
      cursor: 0,
    });
    assert.deepEqual(parsed.termResults, valid.termResults);
    assert.deepEqual(parsed.deepResults, valid.deepResults);
  }
});

test("broken card and active-deep view references are removed, not adopted", () => {
  const validDraft = draft();
  const termKey = validDraft.termResults[0].key;
  const parsed = createKnowledgeSession(
    {
      ...validDraft,
      termCards: {
        [termKey]: [termKey],
        "missing-card": ["missing-card"],
      },
      visibleTermCardKeys: [
        "missing-card",
        termKey,
        termKey,
      ],
      activeDeepKey: "missing-deep",
    },
  );
  assert.deepEqual(parsed.termCards, { [termKey]: [termKey] });
  assert.deepEqual(parsed.visibleTermCardKeys, [termKey]);
  assert.equal(parsed.activeDeepKey, null);
});

test("unfinished or mismatched explanation state fails closed", () => {
  const loading = draft();
  loading.deepResults[0].state.status = "loading";
  assert.throws(
    () => createKnowledgeSession(loading),
    /status must be ready/u,
  );

  const mismatched = draft();
  mismatched.deepResults[0].state.subject = "另一个主题";
  assert.throws(
    () => createKnowledgeSession(mismatched),
    /does not match its completed explanation/u,
  );

  const pendingTerm = draft();
  pendingTerm.termResults[0].status = "pending";
  assert.throws(
    () => createKnowledgeSession(pendingTerm),
    /status is not allowed/u,
  );
});

test("the existing explanation validators guard restored cache content", () => {
  const invalidTerm = draft();
  invalidTerm.termResults[0].explanation.protocol =
    "visual-term-explanation/future";
  assert.throws(
    () => createKnowledgeSession(invalidTerm),
    /名词解释协议/u,
  );

  const invalidDeep = draft();
  invalidDeep.deepResults[0].state.explanation.terms = ["正文里没有的名词"];
  invalidDeep.deepResults[0].state.terms = ["正文里没有的名词"];
  assert.throws(
    () => createKnowledgeSession(invalidDeep),
    /没有逐字出现在深入解释正文/u,
  );

  const unknownNode = draft();
  unknownNode.termResults[0].explanation.nodeId = "missing-node";
  assert.throws(
    () => createKnowledgeSession(unknownNode),
    /unknown node/u,
  );
});

test("unsupported and sensitive fields are rejected at every persistence boundary", () => {
  assert.throws(
    () => parseKnowledgeSession({
      protocol: "visual-knowledge-session/1",
      ...draft(),
      futureField: true,
    }),
    /futureField is not allowed/u,
  );

  const leakedKey = draft();
  leakedKey.document.apiKey = "should-never-be-persisted";
  assert.throws(
    () => createKnowledgeSession(leakedKey),
    /apiKey is forbidden/u,
  );

  const providerBody = draft();
  providerBody.usageReceipts[0].providerBody = { raw: "response" };
  assert.throws(
    () => createKnowledgeSession(providerBody),
    /providerBody is forbidden/u,
  );

  const controller = draft();
  controller.deepResults[0].controller = {};
  assert.throws(
    () => createKnowledgeSession(controller),
    /controller is forbidden/u,
  );
});

test("cache, payload and signed-token bounds reject ambiguous persistence", () => {
  const tooManyTerms = draft({
    termResults: Array.from(
      { length: KNOWLEDGE_SESSION_MAX_TERM_RESULTS + 1 },
      (_, index) => ({
        key: `term-${index}`,
        explanation: termExplanation(`术语${index}`),
        contextToken: CONTEXT_TOKEN,
      }),
    ),
    termCards: {},
    visibleTermCardKeys: [],
  });
  assert.throws(
    () => createKnowledgeSession(tooManyTerms),
    new RegExp(`at most ${KNOWLEDGE_SESSION_MAX_TERM_RESULTS} items`, "u"),
  );
  assert.throws(
    () =>
      parseKnowledgeSession({
        protocol: "visual-knowledge-session/1",
        ...tooManyTerms,
      }),
    new RegExp(`at most ${KNOWLEDGE_SESSION_MAX_TERM_RESULTS} items`, "u"),
  );

  const malformedCollection = createKnowledgeSession(draft());
  malformedCollection.termResults = {};
  assert.throws(
    () => parseKnowledgeSession(malformedCollection),
    /session\.termResults must be an array/u,
  );

  const badToken = draft();
  badToken.termResults[0].contextToken = "not-a-context-token";
  assert.throws(
    () => createKnowledgeSession(badToken),
    /opaque ect1 context token/u,
  );

  const oversized = draft({
    id: "x".repeat(3_800_000),
  });
  assert.throws(
    () => createKnowledgeSession(oversized),
    /3\.5 MiB persistence limit/u,
  );
});

test("usage accepts only finite numeric counts or null and enforces lane metadata", () => {
  const negativeUsage = draft();
  negativeUsage.usageReceipts[0].usage.promptTokens = -1;
  assert.throws(
    () => createKnowledgeSession(negativeUsage),
    /safe integer of at least 0/u,
  );

  const estimatedUsage = draft();
  estimatedUsage.usageReceipts[0].usage.completionTokens = "about 80";
  assert.throws(
    () => createKnowledgeSession(estimatedUsage),
    /safe integer of at least 0/u,
  );

  const backgroundWithoutFrontier = draft();
  backgroundWithoutFrontier.usageReceipts[0].frontierKey = null;
  assert.throws(
    () => createKnowledgeSession(backgroundWithoutFrontier),
    /required for background work/u,
  );

  const foregroundMarkedConsumed = draft();
  foregroundMarkedConsumed.usageReceipts[1].preparedConsumed = true;
  assert.throws(
    () => createKnowledgeSession(foregroundMarkedConsumed),
    /only valid for background work/u,
  );

  const duplicateReceipt = draft();
  duplicateReceipt.usageReceipts[1].id =
    duplicateReceipt.usageReceipts[0].id;
  assert.throws(
    () => createKnowledgeSession(duplicateReceipt),
    /id is duplicated/u,
  );
});

test("the canonical record contains no runtime or credential field names", () => {
  const serialized = JSON.stringify(createKnowledgeSession(draft()));
  assert.doesNotMatch(
    serialized,
    /apiKey|authorization|bearer|hmacSecret|signingSecret|providerBody|requestBody|responseBody|AbortController|"pending"|controller/iu,
  );
});

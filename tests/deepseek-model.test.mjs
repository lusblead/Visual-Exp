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
  assembleVisualDocument,
  createSceneDraftExample,
  expansionSceneDraftExample,
} = await import("../lib/deepseek-draft-contract.ts");
const { DeepSeekVisualModel } = await import("../lib/deepseek-model.ts");
const { OpenAIVisualModel } = await import("../lib/openai-model.ts");

const API_KEY = "sk-test-deepseek-adapter";
const QUESTION = "缓存雪崩应该如何治理？";
const DIAGNOSTIC_KEYS = [
  "action",
  "category",
  "contentLength",
  "durationMs",
  "finishReason",
  "outcome",
  "phase",
  "providerAttempt",
].sort();

test("DeepSeek create assembles canonical document identity and graph locally", async () => {
  const fake = createFakeFetch([
    () => chatCompletion(createSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const document = await model.create(QUESTION);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].body.model, "deepseek-v4-pro");
  assert.equal(document.protocol, "visual-explanation-document/2");
  assert.equal(document.question, QUESTION);
  assert.equal(document.version, 1);
  assert.match(document.id, /^visual_/);
  assert.equal(document.nodes.length, createSceneDraftExample.children.length + 1);
  assert.equal(document.nodes[0].id, document.rootId);
  assert.deepEqual(
    document.nodes[0].childIds,
    document.nodes.slice(1).map((node) => node.id),
  );
  assert.ok(
    document.nodes.slice(1).every(
      (node) =>
        node.parentId === document.rootId &&
        node.depth === 1 &&
        node.childIds.length === 0 &&
        node.expansionState === "outline" &&
        node.evidence.length === 0,
    ),
  );
  assert.ok(document.nodes.every((node) => !node.id.includes("缓存雪崩")));
  assert.match(
    fake.calls[0].body.messages[0].content,
    /Encoder（编码器）.*Decoder（解码器）.*terms 必须把完整双语写法作为一个字面项/su,
  );
  assert.match(
    fake.calls[0].body.messages[0].content,
    /不得输出坐标.*Mermaid\/UML 源码.*视觉投影由本地渲染器完成/su,
  );
  assert.match(
    fake.calls[0].body.messages[1].content,
    /数学模式：optional：.*最多一个.*紧跟通俗解释/su,
  );
  assertDiagnosticSequence(diagnostics, [
    { action: "create", phase: "primary", providerAttempt: 1, outcome: "success" },
  ]);
});

test("DeepSeek create treats server search results as untrusted stable-ID evidence", async () => {
  const candidate = structuredClone(createSceneDraftExample);
  candidate.root.evidenceRefs = ["S1"];
  const fake = createFakeFetch([
    () => chatCompletion(candidate),
  ]);
  const model = createModel(fake.fetchImpl, []);
  const searchEvidence = [
    {
      id: "S1",
      title: "官方发布说明",
      url: "https://example.com/release",
      snippet: "当前版本在本周发布。",
      publishedAt: "2026-07-30",
    },
  ];

  const document = await model.create("当前版本是什么？", { searchEvidence });
  const root = document.nodes.find((node) => node.id === document.rootId);

  assert.ok(root);
  assert.equal(root.sourceStatus, "source_backed");
  assert.equal(root.evidence[0].url, searchEvidence[0].url);
  assert.match(
    fake.calls[0].body.messages[0].content,
    /外部不可信证据.*只能在 evidenceRefs 中引用.*不得生成 URL/su,
  );
  assert.doesNotMatch(
    fake.calls[0].body.messages[0].content,
    /本次调用没有联网或检索能力/u,
  );
  assert.match(
    fake.calls[0].body.messages[1].content,
    /"id":"S1".*"title":"官方发布说明"/su,
  );
});

test("DeepSeek create prompts preserve explicit avoid and requested math modes", async () => {
  const avoidFake = createFakeFetch([
    () => chatCompletion(createSceneDraftExample),
  ]);
  const requestedFake = createFakeFetch([
    () => chatCompletion(createSceneDraftExample),
  ]);

  await createModel(avoidFake.fetchImpl, []).create(
    "请不要用公式，通俗解释 Transformer",
  );
  await createModel(requestedFake.fetchImpl, []).create(
    "请推导 Transformer 的注意力公式",
  );

  assert.match(
    avoidFake.calls[0].body.messages[1].content,
    /数学模式：avoid：.*只使用自然语言/su,
  );
  assert.match(
    requestedFake.calls[0].body.messages[1].content,
    /数学模式：requested：.*所需公式或推导.*通俗解释/su,
  );
});

test("DeepSeek JSON mode follows the official boundary and reports provider usage", async () => {
  const firstUsage = {
    prompt_tokens: 810,
    completion_tokens: 0,
    total_tokens: 810,
    prompt_cache_hit_tokens: 600,
    prompt_cache_miss_tokens: 210,
  };
  const repairedUsage = {
    prompt_tokens: 1_020,
    completion_tokens: 940,
    total_tokens: 1_960,
    prompt_cache_hit_tokens: 800,
    prompt_cache_miss_tokens: 220,
  };
  const fake = createFakeFetch([
    () =>
      Response.json({
        choices: [{ finish_reason: "stop", message: { content: "" } }],
        usage: firstUsage,
      }),
    () => chatCompletion(createSceneDraftExample, { usage: repairedUsage }),
  ]);
  const usage = [];
  const model = createModel(fake.fetchImpl, []);

  await model.create(QUESTION, {
    onUsage: (event) => usage.push(event),
  });

  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    assert.deepEqual(call.body.response_format, { type: "json_object" });
    assert.equal(call.body.max_tokens, 6_000);
    assert.equal(call.body.stream, false);
    assert.match(call.body.messages[0].content, /JSON/u);
    assert.match(
      call.body.messages.map((message) => message.content).join("\n"),
      /JSON Schema[\s\S]*完整 JSON 示例/u,
    );
  }
  assert.deepEqual(usage, [
    {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      phase: "primary",
      providerAttempt: 1,
      usage: {
        promptTokens: 810,
        completionTokens: 0,
        totalTokens: 810,
        promptCacheHitTokens: 600,
        promptCacheMissTokens: 210,
      },
    },
    {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      phase: "repair",
      providerAttempt: 1,
      usage: {
        promptTokens: 1_020,
        completionTokens: 940,
        totalTokens: 1_960,
        promptCacheHitTokens: 800,
        promptCacheMissTokens: 220,
      },
    },
  ]);
});

test("DeepSeek create repairs content-invalid draft with one targeted second request", async () => {
  const invalidDraft = structuredClone(createSceneDraftExample);
  invalidDraft.children[0].summary = "太短";
  const fake = createFakeFetch([
    () => chatCompletion(invalidDraft),
    () => chatCompletion(createSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const document = await model.create(QUESTION);

  assert.equal(document.nodes.length, createSceneDraftExample.children.length + 1);
  assert.equal(fake.calls.length, 2);
  assert.notDeepEqual(fake.calls[1].body.messages, fake.calls[0].body.messages);
  assertDiagnosticSequence(diagnostics, [
    { action: "create", phase: "primary", providerAttempt: 1, outcome: "success" },
    { action: "create", phase: "primary", providerAttempt: 1, outcome: "retry" },
    { action: "create", phase: "repair", providerAttempt: 1, outcome: "success" },
  ]);
  assert.equal(diagnostics[1].category, "content_quality_invalid");
  assert.match(
    fake.calls[1].body.messages.at(-1).content,
    /summary、whyHere、detail/u,
  );
});

test("DeepSeek repair classifies relation failures before child shape", async () => {
  const invalidDraft = structuredClone(createSceneDraftExample);
  invalidDraft.relations = [
    {
      fromIndex: 0,
      toIndex: 0,
      kind: "supports",
      label: "错误的自连接",
    },
  ];
  const fake = createFakeFetch([
    () => chatCompletion(invalidDraft),
    () => chatCompletion(createSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const document = await model.create(QUESTION);

  assert.equal(document.protocol, "visual-explanation-document/2");
  assert.equal(fake.calls.length, 2);
  assert.equal(diagnostics[1].category, "relation_reference_invalid");
  assert.match(
    fake.calls[1].body.messages.at(-1).content,
    /fromIndex 与 toIndex.*不能相同/u,
  );
  assert.match(
    fake.calls[1].body.messages.at(-1).content,
    /修复当前类别时不得放松其他约束.*avoid 禁止公式.*optional 最多一个.*requested 才允许/su,
  );
});

test("DeepSeek repair removes unsolicited formulas with targeted guidance", async () => {
  const invalidDraft = structuredClone(createSceneDraftExample);
  invalidDraft.root.orientation.mechanism =
    "系统先计算 f(x)=max(0,x)，再把结果交给下一层继续处理。";
  const fake = createFakeFetch([
    () => chatCompletion(invalidDraft),
    () => chatCompletion(createSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const document = await model.create("请面向初学者解释 ReLU 的作用");

  assert.equal(document.protocol, "visual-explanation-document/2");
  assert.equal(fake.calls.length, 2);
  assert.equal(diagnostics[1].category, "math_preference_invalid");
  assert.match(
    fake.calls[1].body.messages.at(-1).content,
    /avoid 删除全部公式和推导.*optional 只保留一个.*requested 才可/su,
  );
});

test("DeepSeek keeps provider retry separate from content repair", async () => {
  const invalidDraft = structuredClone(createSceneDraftExample);
  invalidDraft.children = [];
  const fake = createFakeFetch([
    () =>
      Response.json(
        { error: { code: "server_error", message: "temporary upstream failure" } },
        { status: 503 },
      ),
    () => chatCompletion(invalidDraft),
    () => chatCompletion(createSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const document = await model.create(QUESTION);

  assert.equal(document.question, QUESTION);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[1].body, fake.calls[0].body);
  assert.notDeepEqual(fake.calls[2].body.messages, fake.calls[1].body.messages);
  assert.ok(
    diagnostics.some(
      (event) =>
        event.phase === "primary" &&
        event.providerAttempt === 1 &&
        event.outcome === "retry",
    ),
  );
  assert.ok(
    diagnostics.some(
      (event) => event.phase === "repair" && event.outcome === "success",
    ),
  );
});

test("DeepSeek caller abort cancels the upstream request without provider retry", async () => {
  const controller = new AbortController();
  const diagnostics = [];
  let upstreamSignal;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let calls = 0;
  const fetchImpl = async (_input, init = {}) => {
    calls += 1;
    upstreamSignal = init.signal;
    markStarted();
    return new Promise((_, reject) => {
      if (init.signal.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  };
  const model = createModel(fetchImpl, diagnostics);

  const pending = model.create(QUESTION, { signal: controller.signal });
  await started;
  const rejection = assert.rejects(
    pending,
    (error) => error?.name === "AbortError",
  );
  controller.abort();
  await rejection;

  assert.equal(calls, 1);
  assert.equal(upstreamSignal.aborted, true);
  assert.deepEqual(diagnostics, []);
});

test("DeepSeek caller abort after validation failure prevents content repair", async () => {
  const invalidDraft = structuredClone(createSceneDraftExample);
  invalidDraft.children[0].summary = "太短";
  const fake = createFakeFetch([
    () => chatCompletion(invalidDraft),
  ]);
  const controller = new AbortController();
  const diagnostics = [];
  const model = new DeepSeekVisualModel({
    apiKey: API_KEY,
    fetchImpl: fake.fetchImpl,
    onDiagnostic: (event) => {
      diagnostics.push(event);
      if (event.phase === "primary" && event.outcome === "retry") {
        controller.abort();
      }
    },
  });

  await assert.rejects(
    model.create(QUESTION, { signal: controller.signal }),
    (error) => error?.name === "AbortError",
  );

  assert.equal(fake.calls.length, 1);
  assert.equal(
    diagnostics.some((event) => event.phase === "repair"),
    false,
  );
});

test("OpenAI caller abort is combined with timeout and reaches upstream fetch", async () => {
  const controller = new AbortController();
  let upstreamSignal;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let calls = 0;
  const fetchImpl = async (_input, init = {}) => {
    calls += 1;
    upstreamSignal = init.signal;
    markStarted();
    return new Promise((_, reject) => {
      if (init.signal.aborted) {
        reject(init.signal.reason);
        return;
      }
      init.signal.addEventListener(
        "abort",
        () => reject(init.signal.reason),
        { once: true },
      );
    });
  };
  const model = new OpenAIVisualModel({
    apiKey: "sk-test-openai-adapter",
    fetchImpl,
  });

  const pending = model.create(QUESTION, { signal: controller.signal });
  await started;
  const rejection = assert.rejects(
    pending,
    (error) => error?.name === "AbortError",
  );
  controller.abort();
  await rejection;

  assert.equal(calls, 1);
  assert.notEqual(upstreamSignal, controller.signal);
  assert.equal(upstreamSignal.aborted, true);
});

test("DeepSeek rejects a successful response that echoes its credential", async () => {
  const fake = createFakeFetch([
    () => chatCompletion({ echoed: API_KEY }),
  ]);
  const model = createModel(fake.fetchImpl, []);

  await assert.rejects(
    model.create(QUESTION),
    (error) =>
      error?.code === "provider_response_invalid" &&
      error?.retryable === false &&
      !String(error.message).includes(API_KEY),
  );
  assert.equal(fake.calls.length, 1);
});

test("OpenAI rejects a successful response that echoes its credential", async () => {
  const apiKey = "sk-test-openai-response-guard";
  const model = new OpenAIVisualModel({
    apiKey,
    fetchImpl: async (_input, init = {}) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), `Bearer ${apiKey}`);
      return Response.json({ output_text: apiKey });
    },
  });

  await assert.rejects(
    model.create(QUESTION),
    (error) =>
      error?.code === "provider_response_invalid" &&
      error?.retryable === false &&
      !String(error.message).includes(apiKey),
  );
});

test("DeepSeek retries a 503 by replaying the original request unchanged", async () => {
  const fake = createFakeFetch([
    () =>
      Response.json(
        { error: { code: "server_error", message: "temporary upstream failure" } },
        { status: 503 },
      ),
    () => chatCompletion(createSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const document = await model.create(QUESTION);

  assert.equal(document.question, QUESTION);
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[1].body, fake.calls[0].body);
  assertDiagnosticSequence(diagnostics, [
    { action: "create", phase: "primary", providerAttempt: 1, outcome: "retry" },
    { action: "create", phase: "primary", providerAttempt: 2, outcome: "success" },
  ]);
  assert.match(diagnostics[0].category, /provider|upstream|http|availability/iu);
});

test("DeepSeek does not retry a content_filter finish reason", async () => {
  const fake = createFakeFetch([
    () =>
      chatCompletion(createSceneDraftExample, {
        finishReason: "content_filter",
      }),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  await assert.rejects(
    model.create(QUESTION),
    (error) => error?.retryable === false,
  );

  assert.equal(fake.calls.length, 1);
  assertDiagnosticSequence(diagnostics, [
    {
      action: "create",
      phase: "primary",
      providerAttempt: 1,
      outcome: "failure",
      finishReason: "content_filter",
    },
  ]);
  assert.match(diagnostics[0].category, /finish|content_filter|safety/iu);
});

test("DeepSeek stops after one failed content repair", async () => {
  const fake = createFakeFetch([
    () => chatCompletion({}),
    () => chatCompletion({}),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  await assert.rejects(
    model.create(QUESTION),
    (error) =>
      error?.code === "provider_response_invalid" &&
      /自动修复/u.test(error.message),
  );

  assert.equal(fake.calls.length, 2);
  assert.equal(diagnostics.at(-1).phase, "repair");
  assert.equal(diagnostics.at(-1).outcome, "failure");
});

test("DeepSeek expand assembles operation envelopes, IDs, and graph fields locally", async () => {
  const document = assembleVisualDocument(QUESTION, createSceneDraftExample);
  const selected = document.nodes.find((node) => node.parentId === document.rootId);
  assert.ok(selected);
  const fake = createFakeFetch([
    () => chatCompletion(expansionSceneDraftExample),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const batch = await model.expand(document, selected.id);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].body.model, "deepseek-v4-pro");
  assert.equal(batch.protocol, "visual-explanation-operations/2");
  assert.equal(batch.baseVersion, document.version);
  assert.match(
    fake.calls[0].body.messages[1].content,
    /"mathMode":"optional".*数学模式：optional：/su,
  );
  assert.match(
    fake.calls[0].body.messages[1].content,
    /Encoder（编码器）.*不得拆成两个术语/su,
  );
  const updates = batch.operations.filter((operation) => operation.kind === "update_node");
  const additions = batch.operations.filter((operation) => operation.kind === "add_node");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].nodeId, selected.id);
  assert.equal(updates[0].node, null);
  assert.equal(updates[0].relation, null);
  assert.equal(additions.length, expansionSceneDraftExample.children.length);
  assert.ok(
    additions.every(
      (operation) =>
        operation.node.parentId === selected.id &&
        operation.node.depth === selected.depth + 1 &&
        operation.node.childIds.length === 0 &&
        operation.node.evidence.length === 0 &&
        operation.relation === null &&
        operation.nodeId === null &&
        operation.patch === null,
    ),
  );
  assert.equal(new Set(additions.map((operation) => operation.node.id)).size, additions.length);
  assertDiagnosticSequence(diagnostics, [
    { action: "expand", phase: "primary", providerAttempt: 1, outcome: "success" },
  ]);
});

test("DeepSeek define returns the validated JSON definition", async () => {
  const definition = {
    definition:
      "RAG 是在生成回答前检索受控知识，并把相关材料加入模型上下文的机制。",
    relevance:
      "在当前场景中，它负责把答案约束在可检查的材料范围内，并暴露知识不足的边界。",
    terms: ["检索", "上下文"],
  };
  const fake = createFakeFetch([
    () => chatCompletion(definition),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const result = await model.defineTerm({
    term: "RAG",
    question: "Agent 与 RAG 如何组成可靠系统？",
    path: ["可靠系统", "知识边界"],
    scene: {
      title: "知识边界",
      summary: "RAG 为生成提供受控材料，但不能自动证明材料可靠。",
      detail:
        "检索结果必须保留来源身份、时间范围和适用条件。相关性分数只表示匹配程度，不能替代真实性校验。",
    },
  });

  assert.deepEqual(result, definition);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].body.model, "deepseek-v4-flash");
  assert.match(
    fake.calls[0].body.messages[0].content,
    /三态数学模式.*完整双语写法作为一个字面项.*Mermaid\/UML/su,
  );
  assert.match(
    fake.calls[0].body.messages[1].content,
    /数学模式：optional：.*最多一个.*紧跟通俗解释/su,
  );
  assertDiagnosticSequence(diagnostics, [
    { action: "define", phase: "primary", providerAttempt: 1, outcome: "success" },
  ]);
});

test("DeepSeek define enforces the optional formula budget before accepting Flash output", async () => {
  const invalid = {
    definition:
      "RAG 先记录 a=1，表示已经找到候选材料；再记录 b=2，表示候选材料已经进入当前上下文。",
    relevance:
      "在当前场景中，这两个状态用于说明检索与生成之间的先后边界。",
    terms: ["检索", "上下文"],
  };
  const valid = {
    definition: "RAG 会先检索受控材料，再把相关内容放入当前上下文。",
    relevance: "在当前场景中，它负责把生成约束在可以检查的材料范围内。",
    terms: ["检索", "上下文"],
  };
  const fake = createFakeFetch([
    () => chatCompletion(invalid),
    () => chatCompletion(valid),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const result = await model.defineTerm(termContext("RAG"));

  assert.deepEqual(result, valid);
  assert.equal(fake.calls.length, 2);
  assert.equal(diagnostics[1].category, "math_preference_invalid");
  assert.match(
    fake.calls[1].body.messages.at(-1).content,
    /optional 只保留一个.*紧跟通俗解释/su,
  );
});

test("DeepSeek batches same-scene definitions on Flash and restores request order", async () => {
  const inputs = [
    termContext("RAG"),
    termContext("Agent"),
  ];
  const fake = createFakeFetch([
    () =>
      chatCompletion({
        definitions: [
          {
            term: "Agent",
            definition: "Agent 会围绕目标规划步骤并调用工具。",
            relevance: "在当前段落中，Agent 负责执行受约束的行动。",
            terms: ["工具"],
          },
          {
            term: "RAG",
            definition: "RAG 会先检索材料，再把材料加入上下文。",
            relevance: "在当前段落中，RAG 负责提供可检查的知识材料。",
            terms: ["检索", "上下文"],
          },
        ],
      }),
  ]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const results = await model.defineTerms(inputs);

  assert.deepEqual(results.map((item) => item.definition), [
    "RAG 会先检索材料，再把材料加入上下文。",
    "Agent 会围绕目标规划步骤并调用工具。",
  ]);
  assert.equal(fake.calls[0].body.model, "deepseek-v4-flash");
  assertDiagnosticSequence(diagnostics, [
    { action: "define_batch", phase: "primary", providerAttempt: 1, outcome: "success" },
  ]);
});

test("DeepSeek deep explanations use Pro and reject unsolicited formulas", async () => {
  const valid = {
    directAnswer: "残差连接会把子层输入直接加入处理结果。",
    background: "深层网络连续处理信息时，早期信号可能逐层变弱。",
    role: "它为注意力层和前馈网络保留一条较短的信息路径。",
    mechanism: "子层只需学习对现有表示的修正，原始表示沿旁路继续传递。",
    boundary: "它改善训练稳定性，但不能替代数据质量和合理结构。",
    terms: ["前馈网络"],
  };
  const fake = createFakeFetch([() => chatCompletion(valid)]);
  const diagnostics = [];
  const model = createModel(fake.fetchImpl, diagnostics);

  const result = await model.deepDive({
    subject: "残差连接",
    question: "Transformer 架构是什么？",
    path: ["Transformer", "残差连接"],
    scene: {
      title: "残差连接",
      summary: "残差连接保留原始信息。",
      detail: "它把子层输入直接加入处理结果，让深层网络更容易训练。",
    },
    allowMath: false,
  });

  assert.deepEqual(result, valid);
  assert.equal(fake.calls[0].body.model, "deepseek-v4-pro");
  assert.match(
    fake.calls[0].body.messages[1].content,
    /"mathMode":"optional"/u,
  );
  assert.doesNotMatch(
    fake.calls[0].body.messages[1].content,
    /"allowMath":false/u,
  );
  assert.match(
    fake.calls[0].body.messages[1].content,
    /Encoder（编码器）.*不得拆成两个术语.*Mermaid\/UML/su,
  );
  assertDiagnosticSequence(diagnostics, [
    { action: "dive", phase: "primary", providerAttempt: 1, outcome: "success" },
  ]);
});

function createModel(fetchImpl, diagnostics) {
  return new DeepSeekVisualModel({
    apiKey: API_KEY,
    fetchImpl,
    onDiagnostic: (event) => diagnostics.push(event),
  });
}

function createFakeFetch(responders) {
  const queue = [...responders];
  const calls = [];
  return {
    calls,
    fetchImpl: async (input, init = {}) => {
      const responder = queue.shift();
      assert.ok(responder, "unexpected DeepSeek request");
      assert.equal(init.method, "POST");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), `Bearer ${API_KEY}`);
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(input), body });
      return responder({ input, init, body });
    },
  };
}

function chatCompletion(value, { finishReason = "stop", usage } = {}) {
  return Response.json({
    choices: [
      {
        finish_reason: finishReason,
        message: {
          content: JSON.stringify(value),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  });
}

function assertDiagnosticSequence(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (const [index, subset] of expected.entries()) {
    const event = actual[index];
    assert.deepEqual(Object.keys(event).sort(), DIAGNOSTIC_KEYS);
    assert.ok(
      event.action === "create" ||
        event.action === "expand" ||
        event.action === "define" ||
        event.action === "define_batch" ||
        event.action === "dive",
    );
    assert.ok(event.phase === "primary" || event.phase === "repair");
    assert.ok(event.providerAttempt === 1 || event.providerAttempt === 2);
    assert.ok(
      event.outcome === "success" ||
        event.outcome === "retry" ||
        event.outcome === "failure",
    );
    assert.equal(typeof event.durationMs, "number");
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    assert.ok(event.finishReason === null || typeof event.finishReason === "string");
    assert.equal(typeof event.contentLength, "number");
    assert.ok(Number.isInteger(event.contentLength) && event.contentLength >= 0);
    assert.equal(typeof event.category, "string");
    assert.ok(event.category.length > 0);
    for (const [key, value] of Object.entries(subset)) {
      assert.equal(event[key], value, `diagnostic ${index}.${key}`);
    }
  }
}

function termContext(term) {
  return {
    term,
    nodeId: "node-knowledge-boundary",
    question: "Agent 与 RAG 如何组成可靠系统？",
    path: ["可靠系统", "知识边界"],
    scene: {
      title: "知识边界",
      summary: "Agent 与 RAG 分别承担行动和知识约束。",
      detail: "Agent 负责执行步骤，RAG 负责检索材料并把材料加入上下文。",
    },
  };
}

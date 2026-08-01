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

process.env.EXPLANATION_MODEL_PROVIDER = "demo";
process.env.NODE_ENV = "test";
process.env.EXPLANATION_CONTEXT_TOKEN_SECRET =
  "api-lineage-context-token-test-secret-2026";

const { createSceneDraftExample } = await import(
  "../lib/deepseek-draft-contract.ts"
);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("api-semantic-scenes-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const workerEnvironment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

function post(body, { headers = {}, signal } = {}) {
  return worker.fetch(
    new Request("http://localhost/api/lineage", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    }),
    workerEnvironment,
    executionContext,
  );
}

test("API creates a high-level scene and lazily expands one selected branch", async () => {
  const createResponse = await post({
    action: "create",
    question: "一个 AI 原生的项目管理产品应该如何设计？",
    sessionId: "api-semantic-scenes-test",
  });

  assert.equal(createResponse.status, 200);
  assert.match(createResponse.headers.get("content-type") ?? "", /^application\/json\b/i);

  const created = await createResponse.json();
  assert.equal(created.provider, "demo");
  assert.equal(created.document.protocol, "visual-explanation-document/2");
  assert.equal(created.focusNodeId, created.document.rootId);
  assert.equal(created.document.version, 1);

  const root = created.document.nodes.find((node) => node.id === created.document.rootId);
  assert.ok(root);
  assert.equal(root.parentId, null);
  assert.equal(root.depth, 0);
  assert.ok(root.childIds.length >= 3 && root.childIds.length <= 6);

  const firstLayer = created.document.nodes.filter((node) => node.parentId === root.id);
  assert.equal(firstLayer.length, root.childIds.length);
  assert.ok(firstLayer.every((node) => node.depth === 1));
  assert.ok(firstLayer.every((node) => node.childIds.length === 0));
  assert.ok(firstLayer.every((node) => node.expansionState === "outline"));
  assert.ok(created.document.nodes.every((node) => node.depth <= 1));

  const selected = firstLayer[0];
  const expandResponse = await post({
    action: "expand",
    document: created.document,
    nodeId: selected.id,
    sessionId: "api-semantic-scenes-test",
  });

  assert.equal(expandResponse.status, 200);
  const expanded = await expandResponse.json();
  assert.equal(expanded.provider, "demo");
  assert.equal(expanded.focusNodeId, selected.id);
  assert.equal(expanded.operations.protocol, "visual-explanation-operations/2");
  assert.equal(expanded.operations.baseVersion, created.document.version);
  assert.equal(expanded.document.version, created.document.version + 1);

  const expandedParent = expanded.document.nodes.find((node) => node.id === selected.id);
  assert.ok(expandedParent);
  assert.ok(expandedParent.childIds.length >= 3 && expandedParent.childIds.length <= 5);
  const generatedChildren = expanded.document.nodes.filter(
    (node) => node.parentId === selected.id,
  );
  assert.equal(generatedChildren.length, expandedParent.childIds.length);
  assert.ok(generatedChildren.every((node) => node.depth === selected.depth + 1));

  const untouchedSibling = firstLayer[1];
  const siblingAfter = expanded.document.nodes.find((node) => node.id === untouchedSibling.id);
  assert.deepEqual(siblingAfter, untouchedSibling);
});

test("expanding an already generated scene is idempotent", async () => {
  const created = await (
    await post({ action: "create", question: "Transformer 的工作流程是什么？" })
  ).json();
  const targetId = created.document.nodes.find(
    (node) => node.parentId === created.document.rootId,
  ).id;
  const firstExpansion = await (
    await post({ action: "expand", document: created.document, nodeId: targetId })
  ).json();

  const secondResponse = await post({
    action: "expand",
    document: firstExpansion.document,
    nodeId: targetId,
  });
  assert.equal(secondResponse.status, 200);
  const secondExpansion = await secondResponse.json();
  assert.equal(secondExpansion.operations, null);
  assert.deepEqual(secondExpansion.document, firstExpansion.document);
});

test("API defines only an annotated body term without mutating the document", async () => {
  const created = await (
    await post({ action: "create", question: "Agent 和 RAG 应该如何组成可靠系统？" })
  ).json();
  const selected = created.document.nodes.find(
    (node) => node.terms.includes("Agent"),
  );
  assert.ok(selected);
  assert.match(`${selected.summary} ${selected.detail}`, /\bAgent\b/i);

  const firstResponse = await post({
    action: "define",
    document: created.document,
    nodeId: selected.id,
    term: "Agent",
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.provider, "demo");
  assert.equal(first.explanation.protocol, "visual-term-explanation/2");
  assert.equal(first.explanation.term, "Agent");
  assert.deepEqual(first.explanation.termPath, ["Agent"]);
  assert.equal(first.explanation.nodeId, selected.id);
  assert.ok(first.explanation.definition.length > 0);
  assert.ok(first.explanation.relevance.length > 0);
  assert.ok(Array.isArray(first.explanation.terms));
  assert.match(first.contextToken, /^ect1\.[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first.explanation.sourceStatus, "source_backed");
  assert.equal("document" in first, false);
  assert.equal("operations" in first, false);

  const repeated = await (
    await post({
      action: "define",
      document: created.document,
      nodeId: selected.id,
      term: "Agent",
    })
  ).json();
  assert.deepEqual(repeated.explanation, first.explanation);

  const mismatchResponse = await post({
    action: "define",
    document: created.document,
    nodeId: selected.id,
    term: "未标注名词",
  });
  assert.equal(mismatchResponse.status, 400);
  const mismatch = await mismatchResponse.json();
  assert.equal(mismatch.error.code, "invalid_request");
});

test("API batches same-node terms, supports nested definitions, and never mutates the document", async () => {
  const created = await (
    await post({ action: "create", question: "Agent 和 RAG 如何协作？" })
  ).json();
  const selected = created.document.nodes.find(
    (node) => node.terms.includes("Agent") && node.terms.includes("RAG"),
  );
  assert.ok(selected);

  const batchResponse = await post({
    action: "define_batch",
    document: created.document,
    nodeId: selected.id,
    terms: ["Agent", "RAG"],
  });
  assert.equal(batchResponse.status, 200);
  const batch = await batchResponse.json();
  assert.equal(batch.model, "deterministic-semantic-scenes/2");
  assert.deepEqual(
    batch.explanations.map((item) => item.term),
    ["Agent", "RAG"],
  );
  assert.ok(
    batch.explanations.every(
      (item) => item.protocol === "visual-term-explanation/2",
    ),
  );
  assert.equal(batch.contextTokens.length, 2);
  assert.ok(
    batch.contextTokens.every((token) => /^ect1\.[A-Za-z0-9_-]{43}$/u.test(token)),
  );
  assert.equal("document" in batch, false);

  const agent = batch.explanations[0];
  assert.ok(agent.terms.includes("工具"));
  const nestedResponse = await post({
    action: "define",
    document: created.document,
    nodeId: selected.id,
    term: "工具",
    parentExplanation: agent,
    parentContextToken: batch.contextTokens[0],
  });
  assert.equal(nestedResponse.status, 200);
  const nested = await nestedResponse.json();
  assert.deepEqual(nested.explanation.termPath, ["Agent", "工具"]);
  assert.equal(nested.explanation.nodeId, selected.id);
  assert.equal("document" in nested, false);

  const forgedNested = await post({
    action: "define",
    document: created.document,
    nodeId: selected.id,
    term: "未列出的术语",
    parentExplanation: agent,
    parentContextToken: batch.contextTokens[0],
  });
  assert.equal(forgedNested.status, 400);

  const fullyForgedParent = {
    ...agent,
    definition: `${agent.definition} 伪造词出现在这里。`,
    terms: ["伪造词"],
  };
  const forgedParentResponse = await post({
    action: "define",
    document: created.document,
    nodeId: selected.id,
    term: "伪造词",
    parentExplanation: fullyForgedParent,
    parentContextToken: batch.contextTokens[0],
  });
  assert.equal(forgedParentResponse.status, 400);
});

test("API deeply explains only literal trusted selections without mutating the document", async () => {
  const created = await (
    await post({ action: "create", question: "Transformer 为什么需要注意力机制？" })
  ).json();
  const selected = created.document.nodes.find((node) =>
    `${node.title} ${node.summary} ${node.detail}`.includes("Transformer"),
  );
  assert.ok(selected);

  const diveResponse = await post({
    action: "dive",
    document: created.document,
    nodeId: selected.id,
    selection: "Transformer",
  });
  assert.equal(diveResponse.status, 200);
  const dive = await diveResponse.json();
  assert.equal(dive.explanation.protocol, "visual-deep-explanation/1");
  assert.equal(dive.explanation.subject, "Transformer");
  assert.equal(dive.explanation.nodeId, selected.id);
  assert.ok(dive.explanation.directAnswer.length > 0);
  assert.ok(dive.explanation.mechanism.length > 0);
  assert.match(dive.contextToken, /^ect1\.[A-Za-z0-9_-]{43}$/u);
  assert.equal("document" in dive, false);
  assert.equal("operations" in dive, false);

  const forgedResponse = await post({
    action: "dive",
    document: created.document,
    nodeId: selected.id,
    selection: "这段文字从未出现在当前节点中",
  });
  assert.equal(forgedResponse.status, 400);
  const forged = await forgedResponse.json();
  assert.equal(forged.error.code, "invalid_request");

  assert.ok(dive.explanation.terms.includes("检索"));
  const deepTermResponse = await post({
    action: "define",
    document: created.document,
    nodeId: selected.id,
    term: "检索",
    parentDeepExplanation: dive.explanation,
    parentContextToken: dive.contextToken,
  });
  assert.equal(deepTermResponse.status, 200);
  const deepTerm = await deepTermResponse.json();
  assert.deepEqual(deepTerm.explanation.termPath, ["Transformer", "检索"]);
  assert.match(deepTerm.contextToken, /^ect1\.[A-Za-z0-9_-]{43}$/u);

  const tamperedDeepResponse = await post({
    action: "dive",
    document: created.document,
    nodeId: selected.id,
    selection: "伪造深读词",
    parentDeepExplanation: {
      ...dive.explanation,
      mechanism: `${dive.explanation.mechanism} 伪造深读词。`,
      terms: ["伪造深读词"],
    },
    parentContextToken: dive.contextToken,
  });
  assert.equal(tamperedDeepResponse.status, 400);
});

test("API rejects malformed requests", async () => {
  const response = await post({ action: "create", question: "" });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "invalid_request");
  assert.equal(typeof body.error.message, "string");
  assert.ok(body.error.message.length > 0);
});

test("API rejects cross-site non-JSON and oversized requests before external work", async () => {
  await withLineageEnvironment(remoteDeepSeekEnvironment(), async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("rejected requests must not perform network I/O");
    };

    const crossSite = await worker.fetch(
      new Request("http://localhost/api/lineage", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ action: "create", question: "consume quota" }),
      }),
      workerEnvironment,
      executionContext,
    );
    assert.equal(crossSite.status, 403);
    assert.equal((await crossSite.json()).error.code, "origin_rejected");

    const nonJson = await worker.fetch(
      new Request("http://localhost/api/lineage", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ action: "create", question: "consume quota" }),
      }),
      workerEnvironment,
      executionContext,
    );
    assert.equal(nonJson.status, 415);
    assert.equal((await nonJson.json()).error.code, "unsupported_media_type");

    const oversized = await worker.fetch(
      new Request("http://localhost/api/lineage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array(4 * 1024 * 1024 + 1),
      }),
      workerEnvironment,
      executionContext,
    );
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "request_too_large");
    assert.equal(fetchCalls, 0);
  });
});

test("create with searchMode off never calls the internal search service", async () => {
  await withLineageEnvironment(
    {
      EXPLANATION_MODEL_PROVIDER: "demo",
      VISUALIZED_EXP_BACKEND_URL: "https://backend.example",
      VISUALIZED_EXP_BACKEND_TOKEN: "server-internal-test-bearer",
    },
    async () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls += 1;
        throw new Error("searchMode off must not perform network I/O");
      };

      const response = await post({
        action: "create",
        question: "解释一个不需要联网的问题",
        searchMode: "off",
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.search, {
        mode: "off",
        status: "disabled",
        callCount: 0,
        sourceCount: 0,
      });
      assert.equal(fetchCalls, 0);
    },
  );
});

test("create with searchMode on searches once and gives the model only stable evidence IDs", async () => {
  await withLineageEnvironment(remoteDeepSeekEnvironment(), async () => {
    const sources = [
      {
        title: "Official current release",
        url: "https://example.com/releases/current",
        snippet: "The current release shipped this week.",
        publishedAt: "2026-07-30",
        apiKey: "must-not-reach-the-model",
      },
      {
        title: "Official compatibility note",
        url: "https://docs.example.com/compatibility",
        snippet: "The compatibility matrix was updated today.",
        publishedAt: "2026-07-30",
        token: "must-not-reach-the-model",
      },
    ];
    const draft = structuredClone(createSceneDraftExample);
    draft.root.evidenceRefs = ["S1"];
    draft.children[0].evidenceRefs = ["S2"];
    let searchCalls = 0;
    let modelCalls = 0;
    let modelRequestBody;

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url === "https://backend.example/internal/v1/search") {
        searchCalls += 1;
        const headers = new Headers(init.headers);
        assert.equal(
          headers.get("Authorization"),
          "Bearer server-internal-test-bearer",
        );
        assert.match(
          headers.get("X-Owner-Id") ?? "",
          /^[0-9a-f-]{36}$/u,
        );
        assert.deepEqual(JSON.parse(String(init.body)), {
          query: "2026 年当前兼容版本是什么？",
          maxResults: 5,
          freshness: "any",
        });
        return Response.json({
          sources,
          ciphertext: "must-not-leave-the-search-boundary",
        });
      }
      if (url === "https://model.example/chat/completions") {
        modelCalls += 1;
        modelRequestBody = JSON.parse(String(init.body));
        return chatCompletion(draft);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = await post({
      action: "create",
      question: "2026 年当前兼容版本是什么？",
      searchMode: "on",
    });

    assert.equal(response.status, 200);
    assert.equal(searchCalls, 1);
    assert.equal(modelCalls, 1);
    const body = await response.json();
    assert.deepEqual(body.search, {
      mode: "on",
      status: "used",
      callCount: 1,
      sourceCount: 2,
    });
    const modelInput = modelRequestBody.messages
      .map((message) => message.content)
      .join("\n");
    assert.match(
      modelInput,
      /"id":"S1".*"url":"https:\/\/example\.com\/releases\/current"/su,
    );
    assert.match(
      modelInput,
      /"id":"S2".*"url":"https:\/\/docs\.example\.com\/compatibility"/su,
    );
    assert.doesNotMatch(
      modelInput,
      /S404|S999|must-not|apiKey|ciphertext/iu,
    );

    const evidenceUrls = body.document.nodes
      .flatMap((node) => node.evidence)
      .map((evidence) => evidence.url);
    assert.deepEqual(evidenceUrls, [
      "https://example.com/releases/current",
      "https://docs.example.com/compatibility",
    ]);
    assert.ok(
      body.document.nodes.every((node) =>
        node.evidence.every((evidence) =>
          sources.some((source) => source.url === evidence.url),
        ),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(body),
      /S404|S999|must-not|apiKey|ciphertext|server-internal-test-bearer/iu,
    );
  });
});

test("search configuration and provider failures stop before the model with typed errors", async (t) => {
  const cases = [
    {
      name: "no active search provider",
      status: 409,
      error: {
        code: "provider_not_configured",
        message: "unsafe provider detail",
        retryable: false,
      },
      expectedMessage: "请先在 AI 服务设置中配置并选择一个搜索服务。",
    },
    {
      name: "search provider unavailable",
      status: 503,
      error: {
        code: "search_provider_unavailable",
        message: "联网搜索服务暂时不可用，请稍后重试。",
        retryable: true,
      },
      expectedMessage: "联网搜索服务暂时不可用，请稍后重试。",
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      await withLineageEnvironment(remoteDeepSeekEnvironment(), async () => {
        let searchCalls = 0;
        let modelCalls = 0;
        globalThis.fetch = async (input) => {
          const url = String(input);
          if (url === "https://backend.example/internal/v1/search") {
            searchCalls += 1;
            return Response.json(
              {
                error: {
                  ...testCase.error,
                  apiKey: "must-not-leave-java",
                },
              },
              { status: testCase.status },
            );
          }
          modelCalls += 1;
          return chatCompletion(createSceneDraftExample);
        };

        const response = await post({
          action: "create",
          question: "需要当前资料的问题",
          searchMode: "on",
        });
        const body = await response.json();

        assert.equal(response.status, testCase.status);
        assert.equal(searchCalls, 1);
        assert.equal(modelCalls, 0);
        assert.deepEqual(body, {
          error: {
            code: testCase.error.code,
            message: testCase.expectedMessage,
            retryable: testCase.error.retryable,
          },
        });
        assert.doesNotMatch(
          JSON.stringify(body),
          /must-not|apiKey|server-internal-test-bearer/iu,
        );
      });
    });
  }
});

test("request abort reaches the in-flight internal search and prevents model execution", async () => {
  await withLineageEnvironment(remoteDeepSeekEnvironment(), async () => {
    const controller = new AbortController();
    let resolveSearchStarted;
    const searchStarted = new Promise((resolve) => {
      resolveSearchStarted = resolve;
    });
    let searchSignal;
    let modelCalls = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url === "https://backend.example/internal/v1/search") {
        searchSignal = init.signal;
        resolveSearchStarted();
        return new Promise((resolve, reject) => {
          const guard = setTimeout(
            () => reject(new Error("request abort did not reach search fetch")),
            500,
          );
          guard.unref?.();
          init.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(guard);
              reject(
                init.signal.reason instanceof Error
                  ? init.signal.reason
                  : new DOMException("Aborted", "AbortError"),
              );
            },
            { once: true },
          );
        });
      }
      modelCalls += 1;
      return chatCompletion(createSceneDraftExample);
    };
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const responsePromise = post(
        {
          action: "create",
          question: "取消这个联网问题",
          searchMode: "on",
        },
        { signal: controller.signal },
      );
      await searchStarted;
      assert.equal(searchSignal.aborted, false);

      controller.abort();
      const response = await responsePromise;

      assert.ok(response.status >= 400);
      assert.equal(searchSignal.aborted, true);
      assert.equal(modelCalls, 0);
    } finally {
      console.error = originalConsoleError;
    }
  });
});

const LINEAGE_ENVIRONMENT_NAMES = [
  "EXPLANATION_MODEL_PROVIDER",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "VISUALIZED_EXP_BACKEND_URL",
  "VISUALIZED_EXP_BACKEND_TOKEN",
  "VISUALIZED_EXP_COMPANION_URL",
  "VISUALIZED_EXP_COMPANION_TOKEN",
  "NODE_ENV",
];

async function withLineageEnvironment(overrides, run) {
  const previous = new Map(
    LINEAGE_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]),
  );
  const originalFetch = globalThis.fetch;
  try {
    for (const [name, value] of Object.entries(overrides)) {
      restoreEnvironment(name, value);
    }
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previous) {
      restoreEnvironment(name, value);
    }
  }
}

function remoteDeepSeekEnvironment() {
  return {
    EXPLANATION_MODEL_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "test-model-credential",
    DEEPSEEK_BASE_URL: "https://model.example",
    VISUALIZED_EXP_BACKEND_URL: "https://backend.example",
    VISUALIZED_EXP_BACKEND_TOKEN: "server-internal-test-bearer",
    VISUALIZED_EXP_COMPANION_URL: undefined,
    VISUALIZED_EXP_COMPANION_TOKEN: undefined,
    NODE_ENV: "test",
  };
}

function chatCompletion(value) {
  return Response.json({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify(value),
        },
      },
    ],
  });
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

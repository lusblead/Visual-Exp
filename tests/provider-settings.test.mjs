import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  API_FORMAT_OPTIONS,
  ProviderSettingsError,
  activateProvider,
  buildProviderWriteBody,
  createProvider,
  deleteProvider,
  draftForProvider,
  emptyProviderDraft,
  parseProviderListResponse,
  presetsForKind,
  updateProvider,
} from "../lib/provider-settings.ts";

const timestamp = "2026-07-30T09:10:11Z";

function modelSummary(overrides = {}) {
  return {
    id: "provider-1",
    name: "工作模型",
    kind: "model",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    configured: true,
    active: true,
    lastVerifiedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function searchSummary(overrides = {}) {
  return {
    id: "search-1",
    name: "Tavily",
    kind: "search",
    provider: "tavily",
    baseUrl: "https://api.tavily.com",
    defaultModel: null,
    apiFormat: null,
    endpointMode: "base_url",
    authType: "bearer",
    authHeader: null,
    configured: true,
    active: true,
    lastVerifiedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test("provider presets expose Kimi and GLM while search stays Tavily and Brave only", () => {
  assert.deepEqual(
    presetsForKind("model").map((preset) => preset.id),
    [
      "openai",
      "anthropic",
      "deepseek",
      "kimi",
      "glm",
      "gemini",
      "qwen",
      "openrouter",
      "custom_openai_compatible",
    ],
  );
  assert.deepEqual(
    presetsForKind("search").map((preset) => preset.id),
    ["tavily", "brave"],
  );
  assert.deepEqual(
    API_FORMAT_OPTIONS.map((option) => option.value),
    ["openai_chat_completions", "anthropic_messages"],
  );

  const kimi = draftForProvider("kimi");
  assert.equal(kimi.baseUrl, "https://api.moonshot.cn/v1");
  assert.equal(kimi.defaultModel, "kimi-k3");
  assert.equal(kimi.apiFormat, "openai_chat_completions");
  assert.equal(kimi.authType, "bearer");

  const glm = draftForProvider("glm");
  assert.equal(glm.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
  assert.equal(glm.defaultModel, "glm-5.2");
  assert.equal(glm.apiFormat, "openai_chat_completions");
  assert.equal(glm.authType, "bearer");
});

test("model presets are editable templates for the two implemented wire formats", () => {
  const anthropic = draftForProvider("anthropic");
  assert.deepEqual(
    {
      apiFormat: anthropic.apiFormat,
      endpointMode: anthropic.endpointMode,
      authType: anthropic.authType,
      authHeader: anthropic.authHeader,
    },
    {
      apiFormat: "anthropic_messages",
      endpointMode: "base_url",
      authType: "x_api_key",
      authHeader: "",
    },
  );

  const openai = draftForProvider("openai");
  assert.equal(openai.apiFormat, "openai_chat_completions");
  assert.equal(openai.authType, "bearer");
  assert.equal(openai.baseUrl, "https://api.openai.com/v1");
});

test("model write body preserves an edited HTTPS request address and protocol", () => {
  const body = buildProviderWriteBody(
    {
      ...draftForProvider("openai"),
      name: " OpenAI 企业网关 ",
      apiKey: " sk-test-value ",
      baseUrl: "https://gateway.example.com/ai/v1/",
      defaultModel: " company-chat ",
      authType: "custom_header",
      authHeader: "X-Company-Key",
    },
    "create",
  );
  assert.deepEqual(body, {
    name: "OpenAI 企业网关",
    kind: "model",
    provider: "openai",
    apiKey: "sk-test-value",
    baseUrl: "https://gateway.example.com/ai/v1",
    defaultModel: "company-chat",
    apiFormat: "openai_chat_completions",
    endpointMode: "base_url",
    authType: "custom_header",
    authHeader: "X-Company-Key",
    activate: true,
  });
});

test("full URL mode carries the complete request endpoint in baseUrl", () => {
  const body = buildProviderWriteBody(
    {
      ...draftForProvider("anthropic"),
      name: "Claude 代理",
      apiKey: "anthropic-key",
      endpointMode: "full_url",
      baseUrl: "https://gateway.example.com/claude/messages",
    },
    "create",
  );
  assert.equal(
    body.baseUrl,
    "https://gateway.example.com/claude/messages",
  );
  assert.equal(body.endpointMode, "full_url");
  assert.equal(body.apiFormat, "anthropic_messages");
});

test("model request address and custom auth header fail closed on unsafe input", () => {
  assert.throws(
    () =>
      buildProviderWriteBody(
        {
          ...draftForProvider("openai"),
          apiKey: "openai-key",
          baseUrl: "http://127.0.0.1:9000/v1",
        },
        "create",
      ),
    (error) =>
      error instanceof ProviderSettingsError &&
      error.code === "validation_error",
  );

  assert.throws(
    () =>
      buildProviderWriteBody(
        {
          ...draftForProvider("openai"),
          apiKey: "openai-key",
          authType: "custom_header",
          authHeader: "X-Key: injected",
        },
        "create",
      ),
    (error) =>
      error instanceof ProviderSettingsError &&
      error.code === "validation_error",
  );
});

test("updates omit a blank key but keep the selected protocol metadata", () => {
  const body = buildProviderWriteBody(
    {
      ...draftForProvider("gemini"),
      apiKey: "  ",
    },
    "update",
  );
  assert.equal("apiKey" in body, false);
  assert.equal(body.apiFormat, "openai_chat_completions");
  assert.equal(body.authType, "bearer");
  assert.equal(body.authHeader, null);
});

test("search writes keep model-only wire fields null and require a search key", () => {
  const body = buildProviderWriteBody(
    {
      ...emptyProviderDraft("search"),
      name: "Tavily",
      apiKey: "tvly-test",
      baseUrl: "https://attacker.example",
      defaultModel: "ignored-model",
      apiFormat: "anthropic_messages",
      endpointMode: "full_url",
      authType: "custom_header",
      authHeader: "X-Ignored",
    },
    "create",
  );
  assert.deepEqual(body, {
    name: "Tavily",
    kind: "search",
    provider: "tavily",
    apiKey: "tvly-test",
    baseUrl: null,
    defaultModel: null,
    apiFormat: null,
    endpointMode: null,
    authType: null,
    authHeader: null,
    activate: true,
  });

  assert.throws(
    () =>
      buildProviderWriteBody(
        { ...emptyProviderDraft("search"), apiKey: "" },
        "create",
      ),
    (error) =>
      error instanceof ProviderSettingsError &&
      error.code === "validation_error",
  );
});

test("status parser enforces the distinct model and search wire shapes", () => {
  assert.deepEqual(
    parseProviderListResponse({
      providers: [modelSummary(), searchSummary()],
    }),
    [modelSummary(), searchSummary()],
  );

  assert.throws(
    () =>
      parseProviderListResponse({
        providers: [modelSummary({ apiFormat: null })],
      }),
    ProviderSettingsError,
  );
  assert.throws(
    () =>
      parseProviderListResponse({
        providers: [
          searchSummary({ apiFormat: "openai_chat_completions" }),
        ],
      }),
    ProviderSettingsError,
  );
});

test("status parser rejects any secret-shaped response field", () => {
  for (const leakedField of ["apiKey", "maskedApiKey", "ciphertext", "token"]) {
    assert.throws(
      () =>
        parseProviderListResponse({
          providers: [
            {
              ...modelSummary(),
              [leakedField]: "must-not-cross-the-boundary",
            },
          ],
        }),
      (error) =>
        error instanceof ProviderSettingsError &&
        error.code === "provider_response_invalid",
    );
  }
});

test("provider client uses the same-origin Java proxy without echoing keys", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    });
    return Response.json({ provider: modelSummary() }, { status: 201 });
  };
  const secret = "secret-only-in-request";
  const result = await createProvider(
    {
      ...draftForProvider("openai"),
      name: "工作模型",
      apiKey: secret,
    },
    fetcher,
  );

  assert.equal(requests[0].url, "/api/backend/v1/providers");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body.apiKey, secret);
  assert.equal(requests[0].body.apiFormat, "openai_chat_completions");
  assert.equal(requests[0].body.endpointMode, "base_url");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, "u"));
});

test("update, activate, and delete address one encoded provider profile", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push([String(url), init.method, init.body ?? null]);
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ provider: modelSummary() });
  };
  const id = "provider/profile 1";
  await updateProvider(
    id,
    {
      ...draftForProvider("openai"),
      name: "工作模型",
      apiKey: "",
    },
    fetcher,
  );
  await activateProvider(id, fetcher);
  await deleteProvider(id, fetcher);

  assert.deepEqual(
    requests.map(([url, method]) => [url, method]),
    [
      ["/api/backend/v1/providers/provider%2Fprofile%201", "PUT"],
      ["/api/backend/v1/providers/provider%2Fprofile%201/activate", "POST"],
      ["/api/backend/v1/providers/provider%2Fprofile%201", "DELETE"],
    ],
  );
  assert.equal(JSON.parse(requests[0][2]).apiKey, undefined);
});

test("typed backend errors preserve safe request correlation metadata", async () => {
  const fetcher = async () =>
    Response.json(
      {
        code: "credential_invalid",
        message: "API Key 无法通过供应商验证。",
        retryable: false,
        requestId: "req-safe-1",
      },
      { status: 401 },
    );

  await assert.rejects(
    () =>
      createProvider(
        {
          ...draftForProvider("openai"),
          name: "OpenAI",
          apiKey: "wrong-key",
        },
        fetcher,
      ),
    (error) =>
      error instanceof ProviderSettingsError &&
      error.code === "credential_invalid" &&
      error.requestId === "req-safe-1" &&
      error.retryable === false,
  );
});

test("settings UI colocates search permission and gives the editor more visual space", async () => {
  const [source, styles] = await Promise.all([
    readFile(
      new URL("../components/provider-settings-panel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/styles/workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /<details className="provider-advanced">/u);
  assert.match(source, /完整请求 URL/u);
  assert.match(source, /Tavily/u);
  assert.match(source, /模型覆盖（可选）/u);
  assert.match(source, /当前模型覆盖/u);
  assert.match(source, /当前搜索服务/u);
  assert.match(source, /defaultChatAvailable/u);
  assert.match(source, /上方本机 DeepSeek 当前不可用于 AI 对话/u);
  assert.match(source, /允许下一次主问题联网/u);
  assert.match(source, /当前搜索服务只决定请求线路，不代表已经开启联网/u);
  assert.match(source, /AI 对话仍按每轮选择/u);
  assert.match(source, /role="switch"/u);
  assert.match(source, /!activeSearchProvider/u);
  assert.match(
    styles,
    /\.provider-settings-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(205px, 0\.58fr\) minmax\(0, 1\.42fr\)/u,
  );
  assert.match(
    styles,
    /\.provider-profile-section,[\s\S]*?\.provider-editor\s*\{[\s\S]*?border-radius:\s*6px/u,
  );
  assert.doesNotMatch(source, /启用项会用于|验证成功后立即启用|启用中/u);
  assert.doesNotMatch(
    source,
    /searchMode|SearXNG|原生搜索|headerOverrides|bodyOverrides/u,
  );
});

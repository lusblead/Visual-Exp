import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { readExplanationContextSecret } from "../scripts/read-explanation-context-secret.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const companionDll =
  process.env.VISUALIZED_EXP_COMPANION_TEST_DLL ??
  resolve(
    projectRoot,
    "companion",
    "VisualizedExp.Companion",
    "bin",
    "Release",
    "net10.0",
    "VisualizedExp.Companion.dll",
  );
const validSentinel = `sk-valid-${randomBytes(18).toString("hex")}`;
const invalidSentinel = `sk-invalid-${randomBytes(18).toString("hex")}`;
const upstreamMessageSentinel = `upstream-private-${randomBytes(18).toString("hex")}`;
const bearerToken = randomBytes(32).toString("base64url");
const credentialTarget = `VisualizedExp.Tests.${randomUUID()}`;
const contextSecretTarget = `${credentialTarget}.ExplanationContext`;

test("provider mapping preserves safe companion error types", async () => {
  const { providerHttpError } = await loadProviderErrors();
  const cases = [
    {
      status: 402,
      payload: { error: { message: upstreamMessageSentinel } },
      code: "provider_insufficient_balance",
      outputStatus: 402,
      retryable: false,
    },
    {
      status: 422,
      payload: { error: { message: upstreamMessageSentinel } },
      code: "provider_invalid_parameters",
      outputStatus: 422,
      retryable: false,
    },
    {
      status: 422,
      payload: {
        error: {
          code: "provider_content_filtered",
          message: upstreamMessageSentinel,
        },
      },
      code: "provider_content_filtered",
      outputStatus: 422,
      retryable: false,
    },
    {
      status: 503,
      payload: {
        error: {
          code: "provider_insufficient_resources",
          message: upstreamMessageSentinel,
        },
      },
      code: "provider_insufficient_resources",
      outputStatus: 503,
      retryable: true,
    },
  ];

  for (const testCase of cases) {
    const error = providerHttpError(testCase.status, testCase.payload);
    assert.equal(error.code, testCase.code);
    assert.equal(error.status, testCase.outputStatus);
    assert.equal(error.retryable, testCase.retryable);
    assert.doesNotMatch(error.message, new RegExp(escapeRegExp(upstreamMessageSentinel)));
  }
});

test(
  "companion refuses to start without an environment bearer",
  { skip: process.platform !== "win32" && "Windows Credential Manager is required." },
  async () => {
  const environment = { ...process.env };
  delete environment.VISUALIZED_EXP_COMPANION_TOKEN;
  const child = spawn("dotnet", [companionDll], {
    cwd: projectRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 2);
  assert.match(output, /STARTUP_ERROR missing_companion_token/);
  assert.doesNotMatch(output, /READY http:/);
  },
);

test("launcher rejects invalid explanation-context secret responses", async () => {
  const invalidResponses = [
    new Response("unavailable", { status: 503 }),
    Response.json(null),
    Response.json({}),
    Response.json({ secret: "too-short" }),
  ];

  for (const response of invalidResponses) {
    await assert.rejects(() =>
      readExplanationContextSecret(
        "http://127.0.0.1:43210",
        "launcher-test-token",
        async () => response,
      ),
    );
  }

  let authorization = null;
  const secret = "x".repeat(32);
  const result = await readExplanationContextSecret(
    "http://127.0.0.1:43210",
    "launcher-test-token",
    async (_url, init) => {
      authorization = init.headers.Authorization;
      return Response.json({ secret });
    },
  );
  assert.equal(result, secret);
  assert.equal(authorization, "Bearer launcher-test-token");
});

test(
  "local launcher bridges the companion into the Vinext worker",
  { skip: process.platform !== "win32" && "Windows local mode is required." },
  async (t) => {
    const upstream = await startFakeDeepSeek();
    const port = await reserveLoopbackPort();
    const backendPort = await reserveLoopbackPort();
    const launcherCredentialTarget =
      `VisualizedExp.Test.Launcher.Credential.${randomBytes(12).toString("hex")}`;
    const launcherContextTarget =
      `VisualizedExp.Test.Launcher.Context.${randomBytes(12).toString("hex")}`;
    const child = spawn("node", ["scripts/start-local.mjs"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: String(port),
        BACKEND_PORT: String(backendPort),
        APP_DATABASE_URL: `jdbc:h2:mem:launcher-${process.pid}-${Date.now()};MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1`,
        VISUALIZED_EXP_COMPANION_TEST_MODE: "1",
        VISUALIZED_EXP_COMPANION_TEST_CREDENTIAL_TARGET:
          launcherCredentialTarget,
        VISUALIZED_EXP_COMPANION_TEST_CONTEXT_TARGET: launcherContextTarget,
        VISUALIZED_EXP_COMPANION_TEST_DEEPSEEK_BASE_URL: upstream.baseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    t.after(async () => {
      try {
        await fetch(`http://localhost:${port}/api/model-settings`, {
          method: "DELETE",
        });
      } catch {
        // The launcher may have failed before the web API became reachable.
      }
      await stopProcessTree(child);
      await upstream.stop();
    });

    const deadline = Date.now() + 150_000;
    let status = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Local launcher exited before readiness: ${output}`);
      }
      try {
        const response = await fetch(`http://localhost:${port}/api/model-settings`);
        if (response.ok) {
          status = await response.json();
          if (status.persistentAvailable && status.companionAvailable) break;
        }
      } catch {
        // The web worker is still starting.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    assert.ok(status, `Local model status did not become available: ${output}`);
    assert.equal(status.provider, "deepseek");
    assert.equal(status.model, "deepseek-v4-pro");
    assert.equal(status.persistentAvailable, true);
    assert.equal(status.companionAvailable, true);
    assert.equal("apiKey" in status, false);

    const saved = await fetch(`http://localhost:${port}/api/model-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: validSentinel }),
    });
    assert.equal(saved.status, 200);
    const savedStatus = await saved.json();
    assert.equal(savedStatus.configured, true);
    assert.equal("apiKey" in savedStatus, false);

    const chat = await fetch(
      `http://localhost:${port}/api/backend/v1/chat/turns`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "launcher-companion-chat",
          clientTurnId: "launcher-companion-turn",
          question: "解释这句话",
          selection: {
            nodeId: "launcher-node",
            text: "本机 DeepSeek 默认模型",
          },
        }),
      },
    );
    assert.equal(chat.status, 200);
    const chatTurn = await chat.json();
    assert.equal(chatTurn.status, "completed");
    assert.equal(chatTurn.assistantText, "{\"ok\":true}");
    assert.equal(
      upstream.chatRequests.at(-1).authorization,
      `Bearer ${validSentinel}`,
    );
    assert.equal(
      upstream.chatRequests.at(-1).body.model,
      "deepseek-v4-pro",
    );
  },
);

test(
  "Windows local companion credential lifecycle",
  { skip: process.platform !== "win32" && "Windows Credential Manager is required." },
  async (t) => {
  const upstream = await startFakeDeepSeek();
  let companion = await startCompanion(upstream.baseUrl);
  let contextSecret = null;

  t.after(async () => {
    if (companion) {
      try {
        await companion.request("/v1/credentials/deepseek", { method: "DELETE" });
        await companion.request("/v1/runtime/explanation-context-secret", {
          method: "DELETE",
        });
      } catch {
        // Best-effort cleanup for a failed test run.
      }
      await companion.stop();
    }
    await upstream.stop();
  });

  await t.test("companion rejects wrong bearer and direct browser origin", async () => {
    const missing = await fetch(`${companion.baseUrl}/v1/status`);
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${companion.baseUrl}/v1/credentials/deepseek`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer definitely-wrong",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiKey: validSentinel }),
    });
    assert.equal(wrong.status, 401);

    const origin = await fetch(`${companion.baseUrl}/v1/credentials/deepseek`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({ apiKey: validSentinel }),
    });
    assert.equal(origin.status, 403);
    assert.equal(upstream.modelAuthorizations.length, 0);

    const status = await companion.request("/v1/status");
    assert.equal(status.response.status, 200);
    assert.equal(status.body.configured, false);
    assert.doesNotMatch(JSON.stringify(status.body), /valid-|invalid-/);
  });

  await t.test("companion requires authentication and a configured credential", async () => {
    const result = await companion.request("/v1/deepseek/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "caller-controlled-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error.code, "credential_required");
    assert.equal(upstream.chatRequests.length, 0);
  });

  await t.test("context signing secret is launcher-only and stable", async () => {
    const missing = await fetch(
      `${companion.baseUrl}/v1/runtime/explanation-context-secret`,
    );
    assert.equal(missing.status, 401);

    const origin = await fetch(
      `${companion.baseUrl}/v1/runtime/explanation-context-secret`,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Origin: "http://127.0.0.1:3000",
        },
      },
    );
    assert.equal(origin.status, 403);

    const result = await companion.request(
      "/v1/runtime/explanation-context-secret",
    );
    assert.equal(result.response.status, 200);
    assert.equal(typeof result.body.secret, "string");
    assert.ok(Buffer.byteLength(result.body.secret, "utf8") >= 32);
    assert.doesNotMatch(companion.output(), new RegExp(escapeRegExp(result.body.secret)));
    contextSecret = result.body.secret;
  });

  await t.test("companion persists one verified credential without exposing it", async () => {
    const result = await companion.request("/v1/credentials/deepseek", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: validSentinel }),
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, {
      configured: true,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      storage: "windows_credential_manager",
    });
    assert.doesNotMatch(result.raw, new RegExp(escapeRegExp(validSentinel)));
    assert.equal(upstream.modelAuthorizations.at(-1), `Bearer ${validSentinel}`);
    assert.doesNotMatch(companion.output(), new RegExp(escapeRegExp(validSentinel)));
  });

  await t.test("credential verification requires both product models", async () => {
    await companion.request("/v1/credentials/deepseek", { method: "DELETE" });
    upstream.setAvailableModels(["deepseek-v4-pro"]);
    try {
      const result = await companion.request("/v1/credentials/deepseek", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: validSentinel }),
      });
      assert.equal(result.response.status, 422);
      assert.equal(result.body.error.code, "model_unavailable");
      const status = await companion.request("/v1/status");
      assert.equal(status.body.configured, false);
    } finally {
      upstream.setAvailableModels([
        "deepseek-v4-pro",
        "deepseek-v4-flash",
      ]);
    }

    const restored = await companion.request("/v1/credentials/deepseek", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: validSentinel }),
    });
    assert.equal(restored.response.status, 200);
  });

  await t.test("companion forwards only the pro and flash model allowlist", async () => {
    for (const model of ["deepseek-v4-pro", "deepseek-v4-flash"]) {
      const proxied = await companion.request("/v1/deepseek/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: `use-${model}` }],
          stream: false,
        }),
      });
      assert.equal(proxied.response.status, 200);
      assert.equal(upstream.chatRequests.at(-1).body.model, model);
    }

    for (const body of [
      {
        model: "caller-controlled-model",
        messages: [{ role: "user", content: "must-not-forward" }],
      },
      {
        messages: [{ role: "user", content: "missing-model-must-not-forward" }],
      },
    ]) {
      const requestCount = upstream.chatRequests.length;
      const rejected = await companion.request("/v1/deepseek/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(rejected.response.status, 400);
      assert.equal(rejected.body.error.code, "model_not_allowed");
      assert.equal(upstream.chatRequests.length, requestCount);
    }
  });

  await t.test("credential survives companion restart until explicit deletion", async () => {
    await companion.stop();
    companion = await startCompanion(upstream.baseUrl);

    const result = await companion.request("/v1/status");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.configured, true);
    assert.doesNotMatch(result.raw, new RegExp(escapeRegExp(validSentinel)));

    const restoredContext = await companion.request(
      "/v1/runtime/explanation-context-secret",
    );
    assert.equal(restoredContext.body.secret, contextSecret);
  });

  await t.test("invalid replacement preserves the previously verified credential", async () => {
    const replacement = await companion.request("/v1/credentials/deepseek", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: invalidSentinel }),
    });
    assert.equal(replacement.response.status, 401);
    assert.equal(replacement.body.error.code, "credential_invalid");
    assert.doesNotMatch(replacement.raw, new RegExp(escapeRegExp(invalidSentinel)));

    const status = await companion.request("/v1/status");
    assert.equal(status.body.configured, true);

    const proxied = await companion.request("/v1/deepseek/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "return structured JSON" }],
        response_format: { type: "json_object" },
        max_tokens: 777,
        stream: false,
      }),
    });
    assert.equal(proxied.response.status, 200);
    assert.equal(proxied.body.choices[0].message.content, "{\"ok\":true}");
    assert.equal(upstream.chatRequests.at(-1).authorization, `Bearer ${validSentinel}`);
    assert.equal(upstream.chatRequests.at(-1).body.model, "deepseek-v4-pro");
    assert.deepEqual(
      upstream.chatRequests.at(-1).body.response_format,
      { type: "json_object" },
    );
    assert.equal(upstream.chatRequests.at(-1).body.max_tokens, 777);
    assert.doesNotMatch(proxied.raw, new RegExp(escapeRegExp(validSentinel)));
    assert.doesNotMatch(companion.output(), new RegExp(escapeRegExp(validSentinel)));
    assert.doesNotMatch(companion.output(), /Authorization|return structured JSON/);
  });

  await t.test("companion streams SSE without buffering the full response", async () => {
    const startedAt = performance.now();
    const response = await fetch(
      `${companion.baseUrl}/v1/deepseek/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "stream-probe" }],
          response_format: { type: "json_object" },
          max_tokens: 123,
          stream: true,
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/event-stream/iu,
    );
    assert.ok(response.body);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    const firstChunkMs = performance.now() - startedAt;
    assert.equal(first.done, false);
    let raw = decoder.decode(first.value, { stream: true });
    while (true) {
      const chunk = await reader.read();
      raw += decoder.decode(chunk.value, { stream: !chunk.done });
      if (chunk.done) break;
    }
    const totalMs = performance.now() - startedAt;

    assert.match(raw, /"content":"\{"/u);
    assert.match(raw, /"finish_reason":"stop"/u);
    assert.match(raw, /data: \[DONE\]/u);
    assert.ok(
      totalMs - firstChunkMs >= 40,
      `Expected incremental delivery, first=${firstChunkMs}ms total=${totalMs}ms`,
    );
    assert.equal(upstream.chatRequests.at(-1).body.model, "deepseek-v4-pro");
    assert.equal(upstream.chatRequests.at(-1).body.stream, true);
    assert.deepEqual(upstream.chatRequests.at(-1).body.response_format, {
      type: "json_object",
    });
    assert.equal(upstream.chatRequests.at(-1).body.max_tokens, 123);
    assert.doesNotMatch(raw, new RegExp(escapeRegExp(validSentinel)));
    assert.doesNotMatch(companion.output(), /stream-probe/);
    assert.doesNotMatch(
      companion.output(),
      new RegExp(escapeRegExp(validSentinel)),
    );
  });

  await t.test("companion rejects a credential split across stream chunks", async () => {
    const response = await fetch(
      `${companion.baseUrl}/v1/deepseek/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          messages: [{ role: "user", content: "stream-secret-probe" }],
          stream: true,
        }),
      },
    );

    let visible = "";
    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        visible += decoder.decode(chunk.value, { stream: !chunk.done });
        if (chunk.done) break;
      }
    } catch {
      // The proxy closes an already-started stream after rejecting unsafe data.
    }

    assert.doesNotMatch(visible, new RegExp(escapeRegExp(validSentinel)));
    assert.doesNotMatch(
      companion.output(),
      new RegExp(escapeRegExp(validSentinel)),
    );
  });

  await t.test(
    "companion preserves safe upstream failure classes without leaking messages",
    async () => {
      const cases = [
        {
          prompt: "simulate-402",
          status: 402,
          code: "provider_insufficient_balance",
        },
        {
          prompt: "simulate-422",
          status: 422,
          code: "provider_invalid_parameters",
        },
        {
          prompt: "simulate-content-filter",
          status: 422,
          code: "provider_content_filtered",
        },
        {
          prompt: "simulate-insufficient-resource",
          status: 503,
          code: "provider_insufficient_resources",
        },
      ];

      for (const testCase of cases) {
        const result = await companion.request("/v1/deepseek/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: testCase.prompt }],
            response_format: { type: "json_object" },
            stream: false,
          }),
        });
        assert.equal(result.response.status, testCase.status);
        assert.equal(result.body.error.code, testCase.code);
        assert.doesNotMatch(
          result.raw,
          new RegExp(escapeRegExp(upstreamMessageSentinel)),
        );
      }

      assert.doesNotMatch(
        companion.output(),
        new RegExp(escapeRegExp(upstreamMessageSentinel)),
      );
    },
  );

  await t.test("companion delete is idempotent and removes persistent status", async () => {
    const first = await companion.request("/v1/credentials/deepseek", {
      method: "DELETE",
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.body.configured, false);

    const second = await companion.request("/v1/credentials/deepseek", {
      method: "DELETE",
    });
    assert.equal(second.response.status, 200);
    assert.equal(second.body.configured, false);

    await companion.stop();
    companion = await startCompanion(upstream.baseUrl);
    const status = await companion.request("/v1/status");
    assert.equal(status.body.configured, false);
  });
  },
);

async function startFakeDeepSeek() {
  const modelAuthorizations = [];
  const chatRequests = [];
  let availableModels = ["deepseek-v4-pro", "deepseek-v4-flash"];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/models") {
      modelAuthorizations.push(request.headers.authorization ?? "");
      if (request.headers.authorization !== `Bearer ${validSentinel}`) {
        sendJson(response, 401, { error: { message: "invalid" } });
        return;
      }
      sendJson(response, 200, {
        data: availableModels.map((id) => ({ id, object: "model" })),
      });
      return;
    }

    if (request.method === "POST" && request.url === "/chat/completions") {
      const raw = await readBody(request);
      const body = JSON.parse(raw);
      chatRequests.push({
        authorization: request.headers.authorization ?? "",
        body,
      });
      const prompt = body.messages?.at(-1)?.content;
      if (prompt === "simulate-402") {
        sendJson(response, 402, {
          error: { message: upstreamMessageSentinel },
        });
        return;
      }
      if (prompt === "simulate-422") {
        sendJson(response, 422, {
          error: { message: upstreamMessageSentinel },
        });
        return;
      }
      if (prompt === "simulate-content-filter") {
        sendJson(response, 200, {
          choices: [
            {
              finish_reason: "content_filter",
              message: { content: upstreamMessageSentinel },
            },
          ],
        });
        return;
      }
      if (prompt === "simulate-insufficient-resource") {
        sendJson(response, 200, {
          choices: [
            {
              finish_reason: "insufficient_system_resource",
              message: { content: upstreamMessageSentinel },
            },
          ],
        });
        return;
      }
      if (prompt === "stream-secret-probe") {
        response.writeHead(200, {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        response.flushHeaders();
        const splitAt = Math.floor(validSentinel.length / 2);
        response.write(
          `data: {"choices":[{"delta":{"content":"${validSentinel.slice(0, splitAt)}`,
        );
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        response.end(
          `${validSentinel.slice(splitAt)}"},"finish_reason":null}]}\n\n`,
        );
        return;
      }
      if (body.stream === true) {
        response.writeHead(200, {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
        });
        response.flushHeaders();
        sendSse(response, {
          id: "stream-test",
          model: body.model,
          choices: [
            {
              delta: { content: "{" },
              finish_reason: null,
            },
          ],
        });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
        sendSse(response, {
          id: "stream-test",
          model: body.model,
          choices: [
            {
              delta: { content: "\"ok\":true}" },
              finish_reason: null,
            },
          ],
        });
        sendSse(response, {
          id: "stream-test",
          model: body.model,
          choices: [
            {
              delta: {},
              finish_reason: "stop",
            },
          ],
        });
        response.end("data: [DONE]\n\n");
        return;
      }
      sendJson(response, 200, {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "{\"ok\":true}" },
          },
        ],
      });
      return;
    }

    sendJson(response, 404, { error: { message: "not found" } });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    modelAuthorizations,
    chatRequests,
    setAvailableModels(models) {
      availableModels = [...models];
    },
    async stop() {
      server.close();
      await once(server, "close");
    },
  };
}

async function reserveLoopbackPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function stopProcessTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    await once(killer, "exit");
  } else {
    child.kill("SIGTERM");
  }
  if (child.exitCode !== null) return;
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Local launcher did not stop.")), 5_000).unref();
    }),
  ]);
}

async function startCompanion(upstreamUrl) {
  const child = spawn("dotnet", [companionDll], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DOTNET_ENVIRONMENT: "Production",
      VISUALIZED_EXP_COMPANION_TOKEN: bearerToken,
      VISUALIZED_EXP_COMPANION_TEST_MODE: "1",
      VISUALIZED_EXP_COMPANION_TEST_CREDENTIAL_TARGET: credentialTarget,
      VISUALIZED_EXP_COMPANION_TEST_CONTEXT_TARGET: contextSecretTarget,
      VISUALIZED_EXP_COMPANION_TEST_DEEPSEEK_BASE_URL: upstreamUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const baseUrl = await waitForReady(child, () => output);
  return {
    baseUrl,
    output: () => output,
    async request(path, init = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${bearerToken}`,
        },
      });
      const raw = await response.text();
      return {
        response,
        raw,
        body: raw ? JSON.parse(raw) : null,
      };
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Companion did not stop.")), 5_000).unref();
        }),
      ]);
    },
  };
}

async function waitForReady(child, readOutput) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const match = /READY (http:\/\/127\.0\.0\.1:\d+)/.exec(readOutput());
    if (match) return match[1];
    if (child.exitCode !== null) {
      throw new Error(`Companion exited before readiness: ${readOutput()}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  child.kill();
  throw new Error(`Companion readiness timed out: ${readOutput()}`);
}

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function sendSse(response, body) {
  response.write(`data: ${JSON.stringify(body)}\n\n`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadProviderErrors() {
  const source = await readFile(
    resolve(projectRoot, "lib", "provider-errors.ts"),
    "utf8",
  );
  const javascript = stripTypeScriptTypes(source, { mode: "strip" });
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

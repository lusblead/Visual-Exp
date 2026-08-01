import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

delete process.env.DEEPSEEK_API_KEY;
delete process.env.VISUALIZED_EXP_COMPANION_URL;
delete process.env.VISUALIZED_EXP_COMPANION_TOKEN;

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("model-settings-test", `${process.pid}-${Date.now()}`);
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

function request(method, body) {
  return worker.fetch(
    new Request("http://localhost/api/model-settings", {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    workerEnvironment,
    executionContext,
  );
}

test("model settings expose only fixed-model status when no local companion exists", async () => {
  const response = await request("GET");
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.deepEqual(status, {
    configured: false,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    source: "none",
    persistentAvailable: false,
    companionAvailable: false,
  });
  assert.equal("apiKey" in status, false);
  assert.equal("token" in status, false);
});

test("model settings reject malformed input before contacting the companion", async () => {
  const response = await request("PUT", { apiKey: "short" });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_credential_input");
});

test("model settings reject cross-site, non-JSON, and streamed oversized writes", async () => {
  const crossSite = await worker.fetch(
    new Request("http://localhost/api/model-settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ apiKey: "sk-test-settings-cross-site" }),
    }),
    workerEnvironment,
    executionContext,
  );
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).error.code, "origin_rejected");

  const nonJson = await worker.fetch(
    new Request("http://localhost/api/model-settings", {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ apiKey: "sk-test-settings-media-type" }),
    }),
    workerEnvironment,
    executionContext,
  );
  assert.equal(nonJson.status, 415);
  assert.equal((await nonJson.json()).error.code, "unsupported_media_type");

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2049));
      controller.close();
    },
  });
  const oversized = await worker.fetch(
    new Request("http://localhost/api/model-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    }),
    workerEnvironment,
    executionContext,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "invalid_credential_input");
});

test("model settings never echo a credential when the companion is unavailable", async () => {
  const sentinel = "sk-local-test-sentinel-not-a-real-key";
  const response = await request("PUT", { apiKey: sentinel });
  assert.equal(response.status, 409);
  const responseText = await response.text();
  assert.doesNotMatch(responseText, new RegExp(sentinel));
  const payload = JSON.parse(responseText);
  assert.equal(payload.error.code, "local_companion_required");
});

test("model settings explain the local DeepSeek default and optional override boundary", async () => {
  const source = await readFile(
    new URL("../components/model-settings-dialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /本机 DeepSeek 同时是深入解释和 AI 对话默认模型/u,
  );
  assert.match(source, /只有设置下方的模型覆盖后/u);
  assert.match(source, /本机 DeepSeek API Key/u);
});

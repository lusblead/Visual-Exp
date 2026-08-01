import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  searchVisualEvidence,
  ServerWebSearchError,
} from "../lib/server-web-search.ts";

const originalBackendUrl = process.env.VISUALIZED_EXP_BACKEND_URL;
const originalBackendToken = process.env.VISUALIZED_EXP_BACKEND_TOKEN;
const originalNodeEnvironment = process.env.NODE_ENV;

afterEach(() => {
  restoreEnvironment(
    "VISUALIZED_EXP_BACKEND_URL",
    originalBackendUrl,
  );
  restoreEnvironment(
    "VISUALIZED_EXP_BACKEND_TOKEN",
    originalBackendToken,
  );
  restoreEnvironment("NODE_ENV", originalNodeEnvironment);
});

test("server search sends only server identity, bounds the query, and projects safe source fields", async () => {
  process.env.NODE_ENV = "test";
  process.env.VISUALIZED_EXP_BACKEND_URL =
    "https://backend.example/base/";
  process.env.VISUALIZED_EXP_BACKEND_TOKEN =
    "internal-server-search-token";
  const ownerId = "5aa62812-4f8d-4c61-9d21-e872fbcc5b4d";
  const signal = new AbortController().signal;
  const rawQuery = `  ${"x".repeat(180)}\n ${"y".repeat(180)}  `;
  const expectedQuery = rawQuery.replace(/\s+/gu, " ").trim().slice(0, 300);
  let captured;

  const result = await searchVisualEvidence({
    query: rawQuery,
    ownerId,
    signal,
    fetchImpl: async (input, init) => {
      captured = { input: String(input), init };
      return Response.json({
        apiKey: "must-not-leave-java",
        sources: [
          {
            title: "  Official release  ",
            url: "https://example.com/releases/current",
            snippet: "Released this week.",
            publishedAt: "2026-07-30",
            token: "must-not-reach-the-model",
            ciphertext: "must-not-reach-the-model",
          },
        ],
      });
    },
  });

  assert.equal(
    captured.input,
    "https://backend.example/base/internal/v1/search",
  );
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.cache, "no-store");
  assert.equal(captured.init.redirect, "manual");
  assert.equal(captured.init.signal, signal);
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("X-Owner-Id"), ownerId);
  assert.equal(
    headers.get("Authorization"),
    "Bearer internal-server-search-token",
  );
  assert.equal(headers.get("Cookie"), null);
  assert.equal(headers.get("Accept"), "application/json");
  assert.deepEqual(JSON.parse(captured.init.body), {
    query: expectedQuery,
    maxResults: 5,
    freshness: "any",
  });
  assert.equal(expectedQuery.length, 300);
  assert.deepEqual(result, [
    {
      id: "S1",
      title: "Official release",
      url: "https://example.com/releases/current",
      snippet: "Released this week.",
      publishedAt: "2026-07-30",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /apiKey|ciphertext|must-not|token/iu,
  );
});

test("server search rejects malformed, non-HTTPS, and oversized responses", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.VISUALIZED_EXP_BACKEND_URL = "https://backend.example";
  process.env.VISUALIZED_EXP_BACKEND_TOKEN =
    "internal-server-search-token";

  const cases = [
    {
      name: "malformed JSON",
      response: () =>
        new Response("{not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
    {
      name: "non-HTTPS source",
      response: () =>
        Response.json({
          sources: [
            {
              title: "Unsafe source",
              url: "http://example.com/plaintext",
              snippet: null,
              publishedAt: null,
            },
          ],
        }),
    },
    {
      name: "oversized body",
      response: () =>
        Response.json({
          sources: [],
          padding: "x".repeat(1024 * 1024),
        }),
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      await assert.rejects(
        searchVisualEvidence({
          query: "latest verified release",
          ownerId: "5aa62812-4f8d-4c61-9d21-e872fbcc5b4d",
          fetchImpl: async () => testCase.response(),
        }),
        (error) => {
          assert.ok(error instanceof ServerWebSearchError);
          assert.equal(error.code, "search_response_invalid");
          assert.equal(error.status, 502);
          assert.equal(error.retryable, true);
          return true;
        },
      );
    });
  }
});

test("server search preserves typed provider errors without exposing secret fields", async () => {
  process.env.NODE_ENV = "test";
  process.env.VISUALIZED_EXP_BACKEND_URL = "https://backend.example";
  process.env.VISUALIZED_EXP_BACKEND_TOKEN =
    "internal-server-search-token";

  await assert.rejects(
    searchVisualEvidence({
      query: "current provider status",
      ownerId: "5aa62812-4f8d-4c61-9d21-e872fbcc5b4d",
      fetchImpl: async () =>
        Response.json(
          {
            error: {
              code: "provider_not_configured",
              message: "unsafe upstream message must be replaced",
              retryable: false,
              apiKey: "secret-api-key",
              token: "secret-token",
            },
            ciphertext: "secret-ciphertext",
          },
          { status: 409 },
        ),
    }),
    (error) => {
      assert.ok(error instanceof ServerWebSearchError);
      assert.equal(error.code, "provider_not_configured");
      assert.equal(error.status, 409);
      assert.equal(error.retryable, false);
      assert.equal(
        error.message,
        "请先在 AI 服务设置中配置并选择一个搜索服务。",
      );
      assert.equal("apiKey" in error, false);
      assert.equal("token" in error, false);
      assert.equal("ciphertext" in error, false);
      assert.doesNotMatch(
        JSON.stringify({
          code: error.code,
          message: error.message,
          status: error.status,
          retryable: error.retryable,
        }),
        /secret|apiKey|ciphertext/iu,
      );
      return true;
    },
  );
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

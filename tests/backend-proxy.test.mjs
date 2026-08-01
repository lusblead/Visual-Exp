import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, test } from "node:test";

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

const { GET, POST } = await import(
  "../app/api/backend/[...path]/route.ts"
);

const originalFetch = globalThis.fetch;
const originalBackendUrl = process.env.VISUALIZED_EXP_BACKEND_URL;
const originalBackendToken = process.env.VISUALIZED_EXP_BACKEND_TOKEN;
const originalNodeEnvironment = process.env.NODE_ENV;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

test("backend proxy creates an HttpOnly device owner and forwards only server identity", async () => {
  process.env.VISUALIZED_EXP_BACKEND_URL = "http://127.0.0.1:8080";
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ ok: true });
  };

  const response = await GET(
    new Request("http://localhost:3000/api/backend/v1/providers?kind=model", {
      headers: { Authorization: "Bearer browser-token" },
    }),
    { params: Promise.resolve({ path: ["v1", "providers"] }) },
  );

  assert.equal(response.status, 200);
  assert.equal(
    captured.url,
    "http://127.0.0.1:8080/api/v1/providers?kind=model",
  );
  assert.match(captured.init.headers.get("X-Owner-Id"), /^[0-9a-f-]{36}$/u);
  assert.equal(captured.init.headers.get("Authorization"), null);
  assert.match(response.headers.get("set-cookie"), /vexp_owner=/u);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/u);
  assert.match(response.headers.get("set-cookie"), /SameSite=Lax/u);
});

test("backend proxy preserves a valid owner, adds only its internal bearer, and forwards JSON", async () => {
  process.env.VISUALIZED_EXP_BACKEND_URL = "https://backend.example/base";
  process.env.VISUALIZED_EXP_BACKEND_TOKEN = "server-only-token";
  const owner = "5aa62812-4f8d-4c61-9d21-e872fbcc5b4d";
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(null, {
      status: 202,
      headers: { "Set-Cookie": "upstream_secret=do-not-forward" },
    });
  };

  const response = await POST(
    new Request("https://app.example/api/backend/v1/chat/turns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `theme=paper; vexp_owner=${owner}`,
        Origin: "https://app.example",
      },
      body: JSON.stringify({ clientTurnId: "turn-1" }),
    }),
    { params: Promise.resolve({ path: ["v1", "chat", "turns"] }) },
  );

  assert.equal(response.status, 202);
  assert.equal(
    captured.url,
    "https://backend.example/base/api/v1/chat/turns",
  );
  assert.equal(
    captured.init.headers.get("Authorization"),
    "Bearer server-only-token",
  );
  assert.equal(captured.init.headers.get("X-Owner-Id"), owner);
  assert.equal(captured.init.headers.get("Cookie"), null);
  assert.equal(
    new TextDecoder().decode(captured.init.body),
    JSON.stringify({ clientTurnId: "turn-1" }),
  );
  assert.equal(response.headers.get("set-cookie"), null);
});

test("backend proxy fails closed for insecure or unauthenticated production wiring", async () => {
  process.env.NODE_ENV = "production";
  process.env.VISUALIZED_EXP_BACKEND_URL = "http://backend.example";
  process.env.VISUALIZED_EXP_BACKEND_TOKEN = "long-enough-server-token";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };

  const insecure = await GET(
    new Request("https://app.example/api/backend/v1/providers"),
    { params: Promise.resolve({ path: ["v1", "providers"] }) },
  );
  assert.equal(insecure.status, 503);
  assert.equal((await insecure.json()).error.code, "backend_unconfigured");

  process.env.VISUALIZED_EXP_BACKEND_URL = "https://backend.example";
  delete process.env.VISUALIZED_EXP_BACKEND_TOKEN;
  const unauthenticated = await GET(
    new Request("https://app.example/api/backend/v1/providers"),
    { params: Promise.resolve({ path: ["v1", "providers"] }) },
  );
  assert.equal(unauthenticated.status, 503);
  assert.equal(
    (await unauthenticated.json()).error.code,
    "backend_unconfigured",
  );
  assert.equal(called, false);
});

test("backend proxy rejects cross-origin writes before contacting Java", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };

  const response = await POST(
    new Request("http://localhost:3000/api/backend/v1/chat/turns", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
    { params: Promise.resolve({ path: ["v1", "chat", "turns"] }) },
  );

  assert.equal(response.status, 403);
  assert.equal(called, false);
  assert.equal((await response.json()).error.code, "origin_rejected");
});

test("backend proxy rejects cross-site metadata and chunked oversized bodies before Java", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  const context = { params: Promise.resolve({ path: ["v1", "chat", "turns"] }) };

  const crossSite = await POST(
    new Request("http://localhost:3000/api/backend/v1/chat/turns", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    }),
    context,
  );
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).error.code, "origin_rejected");

  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
      controller.close();
    },
  });
  const oversized = await POST(
    new Request("http://localhost:3000/api/backend/v1/chat/turns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
      duplex: "half",
    }),
    context,
  );
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error.code, "request_too_large");
  assert.equal(called, false);
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

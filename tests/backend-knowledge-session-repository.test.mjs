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

const { BackendKnowledgeSessionRepository } = await import(
  "../lib/backend-knowledge-session-repository.ts"
);
const { createKnowledgeSession } = await import(
  "../lib/knowledge-session-contract.ts"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("backend repository restores the authoritative session envelope", async () => {
  const session = makeSession();
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/backend/v1/sessions/restore");
    assert.equal(init.method, "GET");
    return Response.json({
      session,
      sessions: [
        {
          id: session.id,
          question: session.document.question,
          title: session.document.title,
          updatedAt: session.updatedAt,
        },
      ],
      quarantinedIds: [],
    });
  };

  const repository = new BackendKnowledgeSessionRepository();
  const restored = await repository.restoreLatest();

  assert.equal(restored.session?.id, session.id);
  assert.deepEqual(restored.quarantinedIds, []);
  assert.equal(restored.sessions[0].title, session.document.title);
});

test("backend repository saves the complete protocol with revision CAS semantics", async () => {
  const session = makeSession();
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return Response.json({
      saved: true,
      stale: false,
      sessions: [
        {
          id: session.id,
          question: session.document.question,
          title: session.document.title,
          updatedAt: session.updatedAt,
        },
      ],
    });
  };

  const repository = new BackendKnowledgeSessionRepository();
  const result = await repository.save(session);

  assert.equal(
    captured.url,
    `/api/backend/v1/sessions/${session.id}`,
  );
  assert.equal(captured.init.method, "PUT");
  assert.equal(JSON.parse(captured.init.body).protocol, "visual-knowledge-session/1");
  assert.deepEqual(result, {
    saved: true,
    stale: false,
    sessions: [
      {
        id: session.id,
        question: session.document.question,
        title: session.document.title,
        updatedAt: session.updatedAt,
      },
    ],
  });
});

test("backend repository serializes rapid mutations and continues after failure", async () => {
  const firstSession = makeSession();
  const secondSession = {
    ...structuredClone(firstSession),
    revision: 2,
    updatedAt: "2026-07-30T01:02:00.000Z",
    prefetchProfile: "deep",
  };
  const pendingResponses = [];
  const starts = [];
  let inFlight = 0;
  let maxInFlight = 0;

  globalThis.fetch = async (url, init) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const request = {
      url: String(url),
      method: init.method,
      body: init.body ? JSON.parse(init.body) : null,
    };
    starts.push(request);
    return new Promise((resolve) => {
      pendingResponses.push((response) => {
        inFlight -= 1;
        resolve(response);
      });
    });
  };

  const repository = new BackendKnowledgeSessionRepository();
  const first = repository.save(firstSession);
  const second = repository.save(secondSession);
  secondSession.prefetchProfile = "on_demand";
  const activation = repository.activate(firstSession.id);
  const deletion = repository.delete(firstSession.id);

  await nextTurn();
  assert.equal(maxInFlight, 1);
  assert.deepEqual(starts.map((request) => request.method), ["PUT"]);

  pendingResponses.shift()(Response.json(
    { error: { code: "backend_busy" } },
    { status: 503 },
  ));
  await assert.rejects(first, /backend_busy/u);
  await nextTurn();
  assert.deepEqual(starts.map((request) => request.method), ["PUT", "PUT"]);
  assert.equal(starts[1].body.revision, 2);
  assert.equal(starts[1].body.prefetchProfile, "deep");

  pendingResponses.shift()(Response.json({
    saved: true,
    stale: false,
    sessions: [],
  }));
  await second;
  await nextTurn();
  assert.deepEqual(starts.map((request) => request.method), [
    "PUT",
    "PUT",
    "POST",
  ]);

  pendingResponses.shift()(new Response(null, { status: 204 }));
  await activation;
  await nextTurn();
  assert.deepEqual(starts.map((request) => request.method), [
    "PUT",
    "PUT",
    "POST",
    "DELETE",
  ]);

  pendingResponses.shift()(new Response(null, { status: 204 }));
  await deletion;
  assert.equal(maxInFlight, 1);
});

test("backend repository reads, activates, and deletes one selected session", async () => {
  const session = makeSession();
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([String(url), init.method]);
    if (init.method === "GET") {
      return Response.json({ session });
    }
    return new Response(null, { status: 204 });
  };

  const repository = new BackendKnowledgeSessionRepository();
  const restored = await repository.read(session.id);
  await repository.activate(session.id);
  await repository.delete(session.id);

  assert.equal(restored?.id, session.id);
  assert.deepEqual(requests, [
    [`/api/backend/v1/sessions/${session.id}`, "GET"],
    [`/api/backend/v1/sessions/${session.id}/activate`, "POST"],
    [`/api/backend/v1/sessions/${session.id}`, "DELETE"],
  ]);
});

test("backend repository rejects a mismatched selected session envelope", async () => {
  const session = makeSession();
  globalThis.fetch = async () =>
    Response.json({
      session: {
        ...session,
        id: "knowledge-different-session",
      },
    });

  const repository = new BackendKnowledgeSessionRepository();
  await assert.rejects(
    () => repository.read(session.id),
    /knowledge_session_response_id_mismatch/u,
  );
});

test("backend repository aborts in-flight reads when closed", async () => {
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });

  const repository = new BackendKnowledgeSessionRepository();
  const pending = repository.list();
  repository.close();

  await assert.rejects(pending, { name: "AbortError" });
});

function makeSession() {
  const document = makeDocument();
  return createKnowledgeSession({
    id: "knowledge-6fdbd525-a78d-4f45-8db1-d49f20fb3ca1",
    createdAt: "2026-07-30T01:00:00.000Z",
    updatedAt: "2026-07-30T01:01:00.000Z",
    revision: 1,
    document,
    navigation: { entries: [document.rootId], cursor: 0 },
    termResults: [],
    termCards: {},
    visibleTermCardKeys: [],
    deepResults: [],
    activeDeepKey: null,
    prefetchProfile: "on_demand",
    usageReceipts: [],
  });
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeDocument() {
  return {
    protocol: "visual-explanation-document/2",
    id: "document-backend-history",
    question: "How does durable session history work?",
    title: "Durable session history",
    thesis: "The Java backend stores accepted knowledge independently from the view.",
    rootId: "root-backend-history",
    nodes: [
      {
        id: "root-backend-history",
        parentId: null,
        title: "Durable session history",
        eyebrow: "Overview",
        summary: "A revision guard prevents an older browser write from replacing newer accepted knowledge.",
        detail: "The semantic document remains the source of truth while the backend owns durable history and active-session state.",
        terms: ["revision guard", "semantic document"],
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

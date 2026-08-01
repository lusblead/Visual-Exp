import assert from "node:assert/strict";
import test from "node:test";
import {
  SelectionChatClientError,
  createSelectionChatTurn,
  listSelectionChatTurns,
} from "../lib/selection-chat-client.ts";

const baseTurn = {
  id: "turn-server-1",
  clientTurnId: "turn-client-1",
  status: "COMPLETED",
  userText: "这句话为什么重要？",
  assistantText: "它界定了模型理解与确定性执行之间的边界。",
  createdAt: "2026-07-30T08:00:00.000Z",
  completedAt: "2026-07-30T08:00:01.000Z",
  sources: [
    {
      title: "Primary source",
      url: "https://example.com/source",
      snippet: "A short source summary.",
      publishedAt: null,
    },
  ],
  search: {
    mode: "AUTO",
    status: "USED",
    providerConfigId: "search-provider-1",
    callCount: 1,
  },
};

test("selection chat history uses the same-origin BFF and normalizes turn status", async () => {
  const calls = [];
  const turns = await listSelectionChatTurns("knowledge-session_1", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ turns: [baseTurn] });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "/api/backend/v1/chat/sessions/knowledge-session_1/turns",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(turns[0].status, "completed");
  assert.equal(turns[0].sources[0].publishedAt, null);
  assert.deepEqual(turns[0].search, {
    mode: "auto",
    status: "used",
    providerConfigId: "search-provider-1",
    callCount: 1,
  });
});

test("selection chat POST defaults each turn to auto search and accepts 202", async () => {
  const input = {
    sessionId: "knowledge-550e8400-e29b-41d4-a716-446655440000",
    clientTurnId: "550e8400-e29b-41d4-a716-446655440001",
    question: "这句话与幂等性有什么关系？",
    selection: {
      nodeId: "node-1",
      text: "响应丢失后的结果恢复",
      contextToken: "signed-context-token",
    },
  };
  let request;

  const turn = await createSelectionChatTurn(input, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse(
        {
          ...baseTurn,
          clientTurnId: input.clientTurnId,
          status: "UNKNOWN",
          userText: input.question,
          assistantText: null,
          completedAt: null,
          sources: [],
          search: {
            mode: "AUTO",
            status: "OFFERED",
            providerConfigId: "search-provider-1",
            callCount: 0,
          },
        },
        202,
      );
    },
  });

  assert.equal(request.url, "/api/backend/v1/chat/turns");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.init.body), {
    ...input,
    searchMode: "auto",
  });
  assert.equal(turn.status, "unknown");
  assert.equal(turn.clientTurnId, input.clientTurnId);
  assert.equal(turn.search.status, "offered");
});

test("selection chat POST preserves an explicit force search choice", async () => {
  const input = {
    sessionId: "knowledge-1",
    clientTurnId: "client-force-1",
    question: "请核查最新进展。",
    selection: { nodeId: "node-1", text: "选中的句子" },
    searchMode: "force",
  };
  let body;

  await createSelectionChatTurn(input, {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return jsonResponse({
        ...baseTurn,
        clientTurnId: input.clientTurnId,
        userText: input.question,
        search: {
          mode: "FORCE",
          status: "USED",
          providerConfigId: "search-provider-1",
          callCount: 1,
        },
      });
    },
  });

  assert.equal(body.searchMode, "force");
});

test("selection chat surfaces structured backend errors without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      createSelectionChatTurn(
        {
          sessionId: "knowledge-1",
          clientTurnId: "client-1",
          question: "为什么？",
          selection: { nodeId: "node-1", text: "选中的句子" },
        },
        {
          fetchImpl: async () => {
            calls += 1;
            return jsonResponse(
              {
                error: {
                  code: "provider_not_configured",
                  message: "请先配置模型供应商。",
                },
              },
              409,
            );
          },
        },
      ),
    (error) => {
      assert.ok(error instanceof SelectionChatClientError);
      assert.equal(error.code, "provider_not_configured");
      assert.equal(error.message, "请先配置模型供应商。");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(calls, 1, "the client must not blindly replay a failed write");
});

test("selection chat rejects malformed success payloads", async () => {
  await assert.rejects(
    () =>
      listSelectionChatTurns("knowledge-1", {
        fetchImpl: async () =>
          jsonResponse({
            turns: [{ ...baseTurn, sources: "not-an-array" }],
          }),
      }),
    (error) => {
      assert.ok(error instanceof SelectionChatClientError);
      assert.equal(error.code, "selection_chat_response_invalid");
      assert.match(error.message, /sources must be an array/);
      return true;
    },
  );
});

test("selection chat rejects malformed search execution metadata", async () => {
  await assert.rejects(
    () =>
      listSelectionChatTurns("knowledge-1", {
        fetchImpl: async () =>
          jsonResponse({
            turns: [
              {
                ...baseTurn,
                search: {
                  ...baseTurn.search,
                  callCount: 3,
                },
              },
            ],
          }),
      }),
    (error) => {
      assert.ok(error instanceof SelectionChatClientError);
      assert.equal(error.code, "selection_chat_response_invalid");
      assert.match(error.message, /callCount must be an integer from 0 to 2/);
      return true;
    },
  );
});

test("selection chat maps a legacy turn without search metadata to unknown", async () => {
  const legacyTurn = { ...baseTurn };
  delete legacyTurn.search;
  const turns = await listSelectionChatTurns("knowledge-1", {
    fetchImpl: async () => jsonResponse({ turns: [legacyTurn] }),
  });

  assert.deepEqual(turns[0].search, {
    mode: "auto",
    status: "legacy_unknown",
    providerConfigId: null,
    callCount: 0,
  });
});

test("selection chat still rejects an explicitly null search object", async () => {
  await assert.rejects(
    () =>
      listSelectionChatTurns("knowledge-1", {
        fetchImpl: async () =>
          jsonResponse({ turns: [{ ...baseTurn, search: null }] }),
      }),
    (error) => {
      assert.ok(error instanceof SelectionChatClientError);
      assert.equal(error.code, "selection_chat_response_invalid");
      assert.match(error.message, /search must be an object/);
      return true;
    },
  );
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

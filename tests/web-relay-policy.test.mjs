import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceSpec = await readFile(
  new URL("../specs/conversation-source-and-credentials.md", import.meta.url),
  "utf8",
);

test("website generation remains a replaceable gateway owned by the product UI", () => {
  assert.match(sourceSpec, /Visualized Exp question and trusted context/u);
  assert.match(sourceSpec, /interface GenerationGateway/u);
  assert.match(sourceSpec, /jobId/u);
  assert.match(sourceSpec, /one jobId -> at most one submitted user message/u);
  assert.match(sourceSpec, /only the correlated answer/u);
});

test("ChatGPT automatic extraction is blocked until provider authorization exists", () => {
  assert.match(sourceSpec, /blocked_by_provider_terms/u);
  assert.match(sourceSpec, /automatically or\s+programmatically extracting/u);
  assert.match(sourceSpec, /https:\/\/openai\.com\/policies\/terms-of-use\//u);
  assert.match(
    sourceSpec,
    /must not ship a\s+ChatGPT DOM automation backend/u,
  );
});

test("Personal Hub is treated as a capture reference rather than a two-way relay", () => {
  assert.match(sourceSpec, /Personal Hub extension reference/u);
  assert.match(
    sourceSpec,
    /useful\s+capture reference, not an existing two-way relay/u,
  );
  assert.match(sourceSpec, /streaming and final-message completion checks/u);
  assert.match(sourceSpec, /jobId -> user message -> assistant message/u);
});

test("cost routing sends bounded action context instead of the whole graph", () => {
  assert.match(sourceSpec, /must not send the complete graph/u);
  assert.match(sourceSpec, /deepseek-v4-flash/u);
  assert.match(sourceSpec, /deepseek-v4-pro/u);
  assert.match(sourceSpec, /Stable content fingerprints cache/u);
});

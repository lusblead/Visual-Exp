import assert from "node:assert/strict";
import test from "node:test";

import { createExplanationTaskStore } from "../lib/explanation-task-cache.mjs";

test("term cards preserve pending and ready work across hide and reopen", () => {
  const store = createExplanationTaskStore();

  assert.equal(store.reveal("agent", { term: "Agent" }), true);
  assert.equal(store.begin("agent", 1), true);
  assert.equal(store.dismiss("agent"), true);
  assert.deepEqual(store.visibleKeys, []);
  assert.equal(store.get("agent").status, "pending");

  assert.equal(store.reveal("agent"), false);
  assert.deepEqual(store.visibleKeys, ["agent"]);
  assert.equal(store.begin("agent", 1), false);

  const explanation = { definition: "A task-oriented software actor." };
  assert.equal(store.succeed("agent", 1, explanation), true);
  assert.equal(store.dismiss("agent"), true);
  assert.equal(store.get("agent").status, "ready");

  assert.equal(store.reveal("agent"), false);
  assert.equal(store.getVisible()[0].value, explanation);
  assert.throws(() => store.begin("agent", 2), /ready cache entry/);
});

test("A and B term tasks settle independently and keep card order", () => {
  const store = createExplanationTaskStore();

  store.reveal("A");
  store.begin("A", 1);
  store.reveal("B");
  store.begin("B", 2);

  assert.deepEqual(store.visibleKeys, ["A", "B"]);
  assert.equal(store.succeed("B", 2, { definition: "second" }), true);
  assert.equal(store.get("A").status, "pending");
  assert.equal(store.get("B").status, "ready");

  assert.equal(store.succeed("A", 1, { definition: "first" }), true);
  assert.equal(store.get("A").value.definition, "first");
  assert.equal(store.get("B").value.definition, "second");

  store.reveal("A");
  assert.deepEqual(store.visibleKeys, ["B", "A"]);
  assert.equal(store.getVisible().length, 2);
});

test("same-key pending work is deduplicated and stale generations cannot settle", () => {
  const store = createExplanationTaskStore();

  assert.equal(store.reveal("RAG"), true);
  assert.equal(store.begin("RAG", 7), true);
  assert.equal(store.reveal("RAG"), false);
  assert.equal(store.begin("RAG", 7), false);
  assert.throws(
    () => store.begin("RAG", 8),
    /already owns another generation/,
  );

  assert.equal(store.succeed("RAG", 6, { definition: "stale" }), false);
  assert.equal(store.fail("RAG", 8, "also stale"), false);
  assert.equal(store.get("RAG").status, "pending");

  assert.equal(store.succeed("RAG", 7, { definition: "current" }), true);
  assert.equal(store.fail("RAG", 7, "late failure"), false);
  assert.equal(store.get("RAG").value.definition, "current");
});

test("errors remain cached until an explicit retry owns a new generation", () => {
  const store = createExplanationTaskStore();

  store.reveal("Encoder");
  store.begin("Encoder", 1);
  assert.equal(store.fail("Encoder", 1, new Error("provider unavailable")), true);
  store.dismiss("Encoder");

  assert.equal(store.reveal("Encoder"), false);
  assert.equal(store.get("Encoder").status, "error");
  assert.equal(store.get("Encoder").error, "provider unavailable");

  assert.equal(store.begin("Encoder", 2), true);
  assert.equal(store.succeed("Encoder", 2, { definition: "编码器" }), true);
  assert.equal(store.get("Encoder").status, "ready");
});

test("bounded capacity never evicts pending or visible entries", () => {
  const store = createExplanationTaskStore({ maxEntries: 2 });

  store.reveal("visible-ready");
  store.begin("visible-ready", 1);
  store.succeed("visible-ready", 1, { definition: "keep while visible" });

  store.reveal("hidden-pending");
  store.begin("hidden-pending", 2);
  store.dismiss("hidden-pending");

  store.reveal("visible-pending");
  store.begin("visible-pending", 3);

  assert.equal(store.size, 3);
  assert.equal(store.get("visible-ready").status, "ready");
  assert.equal(store.get("hidden-pending").status, "pending");
  assert.equal(store.get("visible-pending").status, "pending");

  store.dismiss("visible-ready");
  assert.equal(store.get("visible-ready"), null);
  assert.equal(store.size, 2);

  assert.equal(
    store.succeed("hidden-pending", 2, { definition: "settled offscreen" }),
    true,
  );
  assert.equal(store.get("hidden-pending").status, "ready");
  assert.equal(store.get("visible-pending").status, "pending");
});

test("reset clears visibility and cache while rejecting every late completion", () => {
  const store = createExplanationTaskStore();

  store.reveal("Dropout");
  store.begin("Dropout", 1);
  store.reset();

  assert.deepEqual(store.snapshot(), { visibleKeys: [], entries: [] });
  assert.equal(store.succeed("Dropout", 1, { definition: "late" }), false);
  assert.equal(store.fail("Dropout", 1, "late"), false);

  store.reveal("Dropout");
  store.begin("Dropout", 2);
  assert.equal(store.succeed("Dropout", 1, { definition: "older" }), false);
  assert.equal(store.succeed("Dropout", 2, { definition: "current" }), true);
  assert.equal(store.get("Dropout").value.definition, "current");
});

test("the task store rejects ambiguous keys, generations, values, and options", () => {
  assert.throws(
    () => createExplanationTaskStore({ maxEntries: 0 }),
    /maxEntries/,
  );
  assert.throws(
    () => createExplanationTaskStore({ maxEntries: 257 }),
    /maxEntries/,
  );
  assert.throws(
    () => createExplanationTaskStore({ unknown: true }),
    /not allowed/,
  );

  const store = createExplanationTaskStore();
  assert.throws(() => store.reveal(" "), /must not be empty/);
  assert.throws(() => store.begin("missing", 1), /requires a revealed/);
  store.reveal("valid");
  assert.throws(() => store.begin("valid", 0), /positive safe integer/);
  store.begin("valid", 1);
  assert.throws(
    () => store.succeed("valid", 1, "not-an-object"),
    /value must be an object/,
  );
  assert.throws(() => store.fail("valid", 1, ""), /must not be empty/);
});

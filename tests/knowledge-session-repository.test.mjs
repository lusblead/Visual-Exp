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

const { createKnowledgeSession } = await import(
  "../lib/knowledge-session-contract.ts"
);
const { IndexedDbKnowledgeSessionRepository } = await import(
  "../lib/knowledge-session-repository.ts"
);
const { termExplanationCacheKey } = await import(
  "../lib/term-prefetch-priority.mjs"
);

const CONTEXT_TOKEN = `ect1.${"A".repeat(43)}`;

function knowledgeSession({
  id,
  updatedAt,
  revision = 1,
  title = `知识会话 ${id}`,
}) {
  return createKnowledgeSession({
    id,
    createdAt: "2026-07-28T08:00:00.000Z",
    updatedAt,
    revision,
    document: {
      protocol: "visual-explanation-document/2",
      id: `document-${id}`,
      question: `${title}应该如何理解？`,
      title,
      thesis: "先建立整体结构，再按需进入下一层理解细节。",
      rootId: `root-${id}`,
      nodes: [
        {
          id: `root-${id}`,
          parentId: null,
          title,
          eyebrow: "整体",
          summary: "这是一个可恢复且不需要再次请求模型的知识会话。",
          detail: "本地存储保留已经接受的知识文档和当前阅读位置。",
          terms: ["本地存储", "知识文档"],
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
    },
    navigation: { entries: [`root-${id}`], cursor: 0 },
    termResults: [],
    termCards: {},
    visibleTermCardKeys: [],
    deepResults: [],
    activeDeepKey: null,
    prefetchProfile: "balanced",
    usageReceipts: [],
  });
}

test("restore quarantines a corrupt active record and falls back to the newest valid session", async () => {
  const factory = new MemoryIdbFactory();
  const repository = repositoryFor(factory, "restore-fallback");
  const older = knowledgeSession({
    id: "older",
    updatedAt: "2026-07-28T09:00:00.000Z",
  });
  const newer = knowledgeSession({
    id: "newer",
    updatedAt: "2026-07-28T10:00:00.000Z",
  });
  await repository.save(older);
  await repository.save(newer);

  factory.putRaw("restore-fallback", "sessions", {
    ...structuredClone(newer),
    id: "corrupt-active",
    updatedAt: "2026-07-28T11:00:00.000Z",
    document: { broken: true },
  });
  factory.putRaw("restore-fallback", "meta", {
    key: "active-session",
    value: "corrupt-active",
  });

  const restored = await repository.restoreLatest();

  assert.equal(restored.session?.id, "newer");
  assert.deepEqual(
    restored.sessions.map((session) => session.id),
    ["newer", "older"],
  );
  assert.deepEqual(restored.quarantinedIds, ["corrupt-active"]);
  assert.equal(
    factory.readRaw("restore-fallback", "sessions", "corrupt-active"),
    undefined,
  );
  assert.equal(
    factory.readRaw("restore-fallback", "meta", "active-session").value,
    "newer",
  );
});

test("restore removes a current-protocol record whose stored key is not canonical", async () => {
  const factory = new MemoryIdbFactory();
  const repository = repositoryFor(factory, "canonical-id");
  const valid = knowledgeSession({
    id: "valid",
    updatedAt: "2026-07-28T10:00:00.000Z",
  });
  await repository.save(valid);

  factory.putRaw("canonical-id", "sessions", {
    ...structuredClone(valid),
    id: " noncanonical ",
    updatedAt: "2026-07-28T11:00:00.000Z",
  });
  factory.putRaw("canonical-id", "meta", {
    key: "active-session",
    value: " noncanonical ",
  });

  const restored = await repository.restoreLatest();

  assert.equal(restored.session?.id, "valid");
  assert.deepEqual(restored.quarantinedIds, [" noncanonical "]);
  assert.equal(
    factory.readRaw("canonical-id", "sessions", " noncanonical "),
    undefined,
  );
});

test("one corrupt cache entry does not quarantine its valid knowledge session", async () => {
  const factory = new MemoryIdbFactory();
  const repository = repositoryFor(factory, "cache-isolation");
  const empty = knowledgeSession({
    id: "cache-session",
    updatedAt: "2026-07-28T10:00:00.000Z",
  });
  const node = empty.document.nodes[0];
  const explanation = {
    protocol: "visual-term-explanation/2",
    term: "本地存储",
    termPath: ["本地存储"],
    nodeId: node.id,
    definition: "本地存储让已经接受的知识在重新打开页面后仍然可用。",
    relevance: "当前会话使用本地存储恢复知识文档和阅读位置。",
    terms: [],
    confidence: "high",
    sourceStatus: "model_knowledge",
  };
  const termKey = termExplanationCacheKey(
    empty.document,
    node,
    explanation.term,
  );
  const draft = structuredClone(empty);
  delete draft.protocol;
  draft.termResults = [
    { key: termKey, explanation, contextToken: CONTEXT_TOKEN },
  ];
  draft.termCards = { [termKey]: [termKey] };
  draft.visibleTermCardKeys = [termKey];
  const valid = createKnowledgeSession(draft);
  await repository.save(valid);

  const persisted = structuredClone(valid);
  persisted.termResults.push({
    key: "term-definition:v2:corrupt",
    explanation,
    contextToken: "invalid-token",
  });
  factory.putRaw("cache-isolation", "sessions", persisted);

  const restored = await repository.restoreLatest();

  assert.equal(restored.session?.id, valid.id);
  assert.deepEqual(restored.quarantinedIds, []);
  assert.deepEqual(restored.session?.termResults, valid.termResults);
  assert.ok(
    factory.readRaw("cache-isolation", "sessions", valid.id),
    "cache isolation must not delete the accepted document record",
  );
});

test("serialized saves reject stale revisions and retain an immutable snapshot", async () => {
  const factory = new MemoryIdbFactory();
  const repository = repositoryFor(factory, "revision");
  const current = knowledgeSession({
    id: "revisioned",
    updatedAt: "2026-07-28T10:00:00.000Z",
    revision: 2,
    title: "当前标题",
  });
  const save = repository.save(current);
  current.document.title = "调用保存后发生的内存修改";
  await save;

  const stale = knowledgeSession({
    id: "revisioned",
    updatedAt: "2026-07-28T09:00:00.000Z",
    revision: 1,
    title: "过时标题",
  });
  const staleResult = await repository.save(stale);
  const persisted = await repository.read("revisioned");

  assert.equal(staleResult.saved, false);
  assert.equal(staleResult.stale, true);
  assert.equal(persisted?.revision, 2);
  assert.equal(persisted?.document.title, "当前标题");
});

test("saving a new active session evicts only the oldest inactive valid session", async () => {
  const factory = new MemoryIdbFactory();
  const repository = repositoryFor(factory, "bounded", 2);
  await repository.save(
    knowledgeSession({
      id: "oldest",
      updatedAt: "2026-07-28T09:00:00.000Z",
    }),
  );
  await repository.save(
    knowledgeSession({
      id: "middle",
      updatedAt: "2026-07-28T10:00:00.000Z",
    }),
  );
  const result = await repository.save(
    knowledgeSession({
      id: "active-new",
      updatedAt: "2026-07-28T11:00:00.000Z",
    }),
  );

  assert.deepEqual(
    result.sessions.map((session) => session.id),
    ["active-new", "middle"],
  );
  assert.equal(await repository.read("oldest"), null);
  assert.equal((await repository.read("active-new"))?.id, "active-new");
});

test("a failed database open is not cached and a later retry can recover", async () => {
  const factory = new MemoryIdbFactory();
  factory.failNextOpen = true;
  const repository = repositoryFor(factory, "open-retry");

  await assert.rejects(
    repository.list(),
    /knowledge_session_database_open_failed/u,
  );
  assert.deepEqual(await repository.list(), []);
  assert.equal(factory.openCount, 2);
});

function repositoryFor(factory, databaseName, maxSessions = 12) {
  return new IndexedDbKnowledgeSessionRepository({
    factory,
    databaseName,
    maxSessions,
  });
}

class MemoryIdbFactory {
  databases = new Map();
  failNextOpen = false;
  openCount = 0;

  open(name) {
    this.openCount += 1;
    const request = new MemoryRequest();
    setImmediate(() => {
      if (this.failNextOpen) {
        this.failNextOpen = false;
        request.onerror?.();
        return;
      }

      let database = this.databases.get(name);
      const upgrade = database === undefined;
      if (upgrade) {
        database = new MemoryDatabase();
        this.databases.set(name, database);
      }
      request.result = database;
      if (upgrade) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }

  putRaw(databaseName, storeName, value) {
    const store = this.#store(databaseName, storeName);
    store.values.set(value[store.keyPath], structuredClone(value));
  }

  readRaw(databaseName, storeName, key) {
    const value = this.#store(databaseName, storeName).values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  #store(databaseName, storeName) {
    const database = this.databases.get(databaseName);
    assert.ok(database, `database ${databaseName} must exist`);
    const store = database.stores.get(storeName);
    assert.ok(store, `store ${storeName} must exist`);
    return store;
  }
}

class MemoryDatabase {
  stores = new Map();
  onversionchange = null;
  objectStoreNames = {
    contains: (name) => this.stores.has(name),
  };

  createObjectStore(name, options) {
    const store = {
      keyPath: options.keyPath,
      values: new Map(),
    };
    this.stores.set(name, store);
    return {
      createIndex() {},
    };
  }

  transaction() {
    return new MemoryTransaction(this);
  }

  close() {}
}

class MemoryTransaction {
  oncomplete = null;
  onabort = null;
  onerror = null;
  pending = 0;
  finished = false;
  aborted = false;
  completionHandle = null;

  constructor(database) {
    this.database = database;
  }

  objectStore(name) {
    const store = this.database.stores.get(name);
    if (!store) throw new Error(`missing store: ${name}`);
    return new MemoryObjectStore(this, store);
  }

  request(operation) {
    if (this.finished || this.aborted) {
      throw new Error("transaction inactive");
    }
    if (this.completionHandle !== null) {
      clearImmediate(this.completionHandle);
      this.completionHandle = null;
    }
    this.pending += 1;
    const request = new MemoryRequest();
    setImmediate(() => {
      if (this.aborted) {
        this.pending -= 1;
        return;
      }
      try {
        request.result = operation();
        request.onsuccess?.();
      } catch {
        request.onerror?.();
        this.fail();
      } finally {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
    return request;
  }

  abort() {
    if (this.finished || this.aborted) return;
    this.aborted = true;
    if (this.completionHandle !== null) {
      clearImmediate(this.completionHandle);
    }
    setImmediate(() => this.onabort?.());
  }

  fail() {
    if (this.finished || this.aborted) return;
    this.aborted = true;
    this.onerror?.();
    setImmediate(() => this.onabort?.());
  }

  scheduleCompletion() {
    if (
      this.finished ||
      this.aborted ||
      this.pending !== 0 ||
      this.completionHandle !== null
    ) {
      return;
    }
    this.completionHandle = setImmediate(() => {
      this.completionHandle = null;
      if (this.finished || this.aborted || this.pending !== 0) return;
      this.finished = true;
      this.oncomplete?.();
    });
  }
}

class MemoryObjectStore {
  constructor(transaction, store) {
    this.transaction = transaction;
    this.store = store;
  }

  get(key) {
    return this.transaction.request(() => {
      const value = this.store.values.get(key);
      return value === undefined ? undefined : structuredClone(value);
    });
  }

  put(value) {
    return this.transaction.request(() => {
      const snapshot = structuredClone(value);
      const key = snapshot[this.store.keyPath];
      if (key === undefined) throw new Error("missing key");
      this.store.values.set(key, snapshot);
      return key;
    });
  }

  delete(key) {
    return this.transaction.request(() => {
      this.store.values.delete(key);
      return undefined;
    });
  }

  getAll() {
    return this.transaction.request(() =>
      [...this.store.values.values()].map((value) => structuredClone(value)),
    );
  }
}

class MemoryRequest {
  result = undefined;
  onsuccess = null;
  onerror = null;
  onblocked = null;
  onupgradeneeded = null;
}

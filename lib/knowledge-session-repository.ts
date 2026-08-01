import {
  KNOWLEDGE_SESSION_PROTOCOL,
  parseKnowledgeSession,
  type KnowledgeSession,
} from "./knowledge-session-contract";

const DEFAULT_DATABASE_NAME = "visualized-exp-knowledge-sessions";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";
const META_STORE = "meta";
const ACTIVE_SESSION_KEY = "active-session";
const DEFAULT_MAX_SESSIONS = 12;

export interface KnowledgeSessionSummary {
  id: string;
  question: string;
  title: string;
  updatedAt: string;
}

export interface KnowledgeSessionRestoreResult {
  session: KnowledgeSession | null;
  sessions: KnowledgeSessionSummary[];
  quarantinedIds: string[];
}

export interface KnowledgeSessionSaveResult {
  saved: boolean;
  stale: boolean;
  sessions: KnowledgeSessionSummary[];
}

interface ActiveSessionRecord {
  key: typeof ACTIVE_SESSION_KEY;
  value: string;
}

export interface KnowledgeSessionRepository {
  restoreLatest(): Promise<KnowledgeSessionRestoreResult>;
  read(id: string): Promise<KnowledgeSession | null>;
  list(): Promise<KnowledgeSessionSummary[]>;
  save(session: KnowledgeSession): Promise<KnowledgeSessionSaveResult>;
  activate(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  quarantine(id: string): Promise<void>;
  close(): void;
}

/**
 * Native IndexedDB repository for accepted local knowledge.
 *
 * Every mutating operation is queued. The queue captures a structured clone so
 * later React mutations cannot change an already-enqueued write.
 */
export class IndexedDbKnowledgeSessionRepository
  implements KnowledgeSessionRepository
{
  private readonly factory: IDBFactory;
  private readonly databaseName: string;
  private readonly maxSessions: number;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(options: {
    factory?: IDBFactory;
    databaseName?: string;
    maxSessions?: number;
  } = {}) {
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error("indexeddb_unavailable");
    const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 50) {
      throw new Error("maxSessions must be an integer between 1 and 50");
    }
    this.factory = factory;
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.maxSessions = maxSessions;
  }

  async restoreLatest(): Promise<KnowledgeSessionRestoreResult> {
    const archive = await this.readArchive();
    const candidates = orderPersistedCandidates(
      archive.sessions,
      archive.activeId,
    );
    const valid: KnowledgeSession[] = [];
    const quarantinedIds = new Set<string>();
    let restored: KnowledgeSession | null = null;

    for (const candidate of candidates) {
      try {
        const session = parseStoredKnowledgeSession(candidate);
        valid.push(session);
        restored ??= session;
      } catch {
        if (
          isRecord(candidate) &&
          candidate.protocol === KNOWLEDGE_SESSION_PROTOCOL &&
          typeof candidate.id === "string"
        ) {
          quarantinedIds.add(candidate.id);
        }
      }
    }

    for (const id of quarantinedIds) {
      await this.quarantine(id);
    }
    if (restored && restored.id !== archive.activeId) {
      await this.activate(restored.id);
    }

    return {
      session: restored,
      sessions: valid.sort(compareUpdatedDescending).map(toSummary),
      quarantinedIds: [...quarantinedIds],
    };
  }

  async read(id: string): Promise<KnowledgeSession | null> {
    const sessionId = requiredId(id);
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const value = await requestResult<unknown>(
      transaction.objectStore(SESSION_STORE).get(sessionId),
    );
    await transactionComplete(transaction);
    if (value === undefined) return null;
    return parseStoredKnowledgeSession(value);
  }

  async list(): Promise<KnowledgeSessionSummary[]> {
    const archive = await this.readArchive();
    return archive.sessions
      .flatMap((candidate) => {
        try {
          return [toSummary(parseStoredKnowledgeSession(candidate))];
        } catch {
          return [];
        }
      })
      .sort(compareUpdatedDescending);
  }

  save(session: KnowledgeSession): Promise<KnowledgeSessionSaveResult> {
    const snapshot = structuredClone(parseKnowledgeSession(session));
    return this.enqueueWrite(() => this.saveSnapshot(snapshot));
  }

  activate(id: string): Promise<void> {
    const sessionId = requiredId(id);
    return this.enqueueWrite(async () => {
      const database = await this.open();
      const transaction = database.transaction(
        [SESSION_STORE, META_STORE],
        "readwrite",
      );
      const existing = await requestResult<unknown>(
        transaction.objectStore(SESSION_STORE).get(sessionId),
      );
      if (existing === undefined) {
        transaction.abort();
        throw new Error("knowledge_session_not_found");
      }
      transaction.objectStore(META_STORE).put({
        key: ACTIVE_SESSION_KEY,
        value: sessionId,
      } satisfies ActiveSessionRecord);
      await transactionComplete(transaction);
    });
  }

  delete(id: string): Promise<void> {
    const sessionId = requiredId(id);
    return this.enqueueWrite(async () => {
      const database = await this.open();
      const transaction = database.transaction(
        [SESSION_STORE, META_STORE],
        "readwrite",
      );
      transaction.objectStore(SESSION_STORE).delete(sessionId);
      const active = await requestResult<ActiveSessionRecord | undefined>(
        transaction.objectStore(META_STORE).get(ACTIVE_SESSION_KEY),
      );
      if (active?.value === sessionId) {
        transaction.objectStore(META_STORE).delete(ACTIVE_SESSION_KEY);
      }
      await transactionComplete(transaction);
    });
  }

  quarantine(id: string): Promise<void> {
    return this.delete(id);
  }

  close(): void {
    if (!this.databasePromise) return;
    void this.databasePromise.then(
      (database) => database.close(),
      () => undefined,
    );
    this.databasePromise = null;
  }

  private async saveSnapshot(
    snapshot: KnowledgeSession,
  ): Promise<KnowledgeSessionSaveResult> {
    const database = await this.open();
    const transaction = database.transaction(
      [SESSION_STORE, META_STORE],
      "readwrite",
    );
    const sessions = transaction.objectStore(SESSION_STORE);
    const existing = await requestResult<unknown>(sessions.get(snapshot.id));
    if (existing !== undefined) {
      const parsed = parseStoredKnowledgeSession(existing);
      if (parsed.revision >= snapshot.revision) {
        transaction.objectStore(META_STORE).put({
          key: ACTIVE_SESSION_KEY,
          value: snapshot.id,
        } satisfies ActiveSessionRecord);
        await transactionComplete(transaction);
        return {
          saved: false,
          stale: true,
          sessions: await this.list(),
        };
      }
    }

    sessions.put(snapshot);
    transaction.objectStore(META_STORE).put({
      key: ACTIVE_SESSION_KEY,
      value: snapshot.id,
    } satisfies ActiveSessionRecord);

    const all = await requestResult<unknown[]>(sessions.getAll());
    const parsedArchive = all
      .flatMap((candidate) => {
        try {
          return [parseStoredKnowledgeSession(candidate)];
        } catch {
          return [];
        }
      })
      .sort(compareUpdatedDescending);
    const evicted = parsedArchive
      .filter((candidate) => candidate.id !== snapshot.id)
      .slice(Math.max(0, this.maxSessions - 1));
    for (const candidate of evicted) sessions.delete(candidate.id);

    await transactionComplete(transaction);
    return {
      saved: true,
      stale: false,
      sessions: parsedArchive
        .filter((candidate) => !evicted.some((item) => item.id === candidate.id))
        .slice(0, this.maxSessions)
        .map(toSummary),
    };
  }

  private async readArchive(): Promise<{
    activeId: string | null;
    sessions: unknown[];
  }> {
    const database = await this.open();
    const transaction = database.transaction(
      [SESSION_STORE, META_STORE],
      "readonly",
    );
    const sessionsRequest = transaction.objectStore(SESSION_STORE).getAll();
    const activeRequest = transaction
      .objectStore(META_STORE)
      .get(ACTIVE_SESSION_KEY);
    const [sessions, active] = await Promise.all([
      requestResult<unknown[]>(sessionsRequest),
      requestResult<ActiveSessionRecord | undefined>(activeRequest),
    ]);
    await transactionComplete(transaction);
    return {
      activeId:
        active && typeof active.value === "string" ? active.value : null,
      sessions,
    };
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    let abandoned = false;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const store = database.createObjectStore(SESSION_STORE, {
            keyPath: "id",
          });
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        if (abandoned) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(new Error("knowledge_session_database_open_failed"));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error("knowledge_session_database_blocked"));
      };
    });
    this.databasePromise = pending;
    void pending.catch(() => {
      if (this.databasePromise === pending) {
        this.databasePromise = null;
      }
    });
    return pending;
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("knowledge_session_database_request_failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(new Error("knowledge_session_database_transaction_aborted"));
    transaction.onerror = () =>
      reject(new Error("knowledge_session_database_transaction_failed"));
  });
}

function compareUpdatedDescending(
  left: Pick<KnowledgeSession, "id" | "updatedAt">,
  right: Pick<KnowledgeSession, "id" | "updatedAt">,
): number {
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

function toSummary(session: KnowledgeSession): KnowledgeSessionSummary {
  return {
    id: session.id,
    question: session.document.question,
    title: session.document.title,
    updatedAt: session.updatedAt,
  };
}

function requiredId(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("knowledge session id is required");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedSessionId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

function parseStoredKnowledgeSession(value: unknown): KnowledgeSession {
  const session = parseKnowledgeSession(value);
  if (storedSessionId(value) !== session.id) {
    throw new Error("stored session id is not canonical");
  }
  return session;
}

function orderPersistedCandidates(
  sessions: readonly unknown[],
  activeId: string | null,
): unknown[] {
  const active: unknown[] = [];
  const remaining: unknown[] = [];
  for (const candidate of sessions) {
    if (activeId !== null && storedSessionId(candidate) === activeId) {
      active.push(candidate);
    } else {
      remaining.push(candidate);
    }
  }
  return [...active, ...remaining.sort(comparePersistedUpdatedDescending)];
}

function comparePersistedUpdatedDescending(
  left: unknown,
  right: unknown,
): number {
  const leftUpdatedAt = persistedUpdatedTime(left);
  const rightUpdatedAt = persistedUpdatedTime(right);
  return (
    rightUpdatedAt - leftUpdatedAt ||
    (storedSessionId(right) ?? "").localeCompare(storedSessionId(left) ?? "")
  );
}

function persistedUpdatedTime(value: unknown): number {
  if (!isRecord(value) || typeof value.updatedAt !== "string") {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value.updatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

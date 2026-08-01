import {
  parseKnowledgeSession,
  type KnowledgeSession,
} from "./knowledge-session-contract";
import type {
  KnowledgeSessionRepository,
  KnowledgeSessionRestoreResult,
  KnowledgeSessionSaveResult,
  KnowledgeSessionSummary,
} from "./knowledge-session-repository";

const API_ROOT = "/api/backend/v1/sessions";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;

export class BackendKnowledgeSessionRepository
  implements KnowledgeSessionRepository
{
  private readonly requestControllers = new Set<AbortController>();
  private writeTail: Promise<void> = Promise.resolve();
  private closed = false;

  async restoreLatest(): Promise<KnowledgeSessionRestoreResult> {
    const value = await this.request("GET", `${API_ROOT}/restore`);
    const record = requiredRecord(value, "restore response");
    const session =
      record.session === null
        ? null
        : parseKnowledgeSession(record.session);
    return {
      session,
      sessions: parseSummaries(record.sessions),
      quarantinedIds: parseIds(record.quarantinedIds, "quarantinedIds"),
    };
  }

  async read(id: string): Promise<KnowledgeSession | null> {
    const sessionId = requiredId(id);
    const value = await this.request(
      "GET",
      `${API_ROOT}/${encodeURIComponent(sessionId)}`,
    );
    const record = requiredRecord(value, "read response");
    if (record.session === null) return null;
    const session = parseKnowledgeSession(record.session);
    if (session.id !== sessionId) {
      throw new Error("knowledge_session_response_id_mismatch");
    }
    return session;
  }

  async list(): Promise<KnowledgeSessionSummary[]> {
    const value = await this.request("GET", API_ROOT);
    return parseSummaries(requiredRecord(value, "list response").sessions);
  }

  save(
    session: KnowledgeSession,
  ): Promise<KnowledgeSessionSaveResult> {
    const snapshot = structuredClone(parseKnowledgeSession(session));
    return this.enqueueWrite(async () => {
      const value = await this.request(
        "PUT",
        `${API_ROOT}/${encodeURIComponent(snapshot.id)}`,
        snapshot,
      );
      const record = requiredRecord(value, "save response");
      return {
        saved: requiredBoolean(record.saved, "saved"),
        stale: requiredBoolean(record.stale, "stale"),
        sessions: parseSummaries(record.sessions),
      };
    });
  }

  activate(id: string): Promise<void> {
    const sessionId = requiredId(id);
    return this.enqueueWrite(async () => {
      await this.request(
        "POST",
        `${API_ROOT}/${encodeURIComponent(sessionId)}/activate`,
        undefined,
        true,
      );
    });
  }

  delete(id: string): Promise<void> {
    const sessionId = requiredId(id);
    return this.enqueueWrite(async () => {
      await this.request(
        "DELETE",
        `${API_ROOT}/${encodeURIComponent(sessionId)}`,
        undefined,
        true,
      );
    });
  }

  async quarantine(id: string): Promise<void> {
    await this.delete(id);
  }

  close(): void {
    this.closed = true;
    for (const controller of this.requestControllers) controller.abort();
    this.requestControllers.clear();
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async request(
    method: string,
    url: string,
    body?: unknown,
    emptyResponse = false,
  ): Promise<unknown> {
    if (this.closed) throw new Error("knowledge_session_repository_closed");
    const controller = new AbortController();
    this.requestControllers.add(controller);
    try {
      const response = await fetch(url, {
        method,
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await safeErrorCode(response));
      }
      if (emptyResponse || response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new Error("knowledge_session_backend_response_invalid");
      }
    } finally {
      this.requestControllers.delete(controller);
    }
  }
}

function requiredRecord(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseSummaries(value: unknown): KnowledgeSessionSummary[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("knowledge session summaries are invalid");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const summary = requiredRecord(item, `sessions[${index}]`);
    const id = requiredId(summary.id);
    if (seen.has(id)) throw new Error("knowledge session summary is duplicated");
    seen.add(id);
    return {
      id,
      question: boundedString(
        summary.question,
        `sessions[${index}].question`,
        1200,
      ),
      title: boundedString(
        summary.title,
        `sessions[${index}].title`,
        240,
      ),
      updatedAt: timestamp(
        summary.updatedAt,
        `sessions[${index}].updatedAt`,
      ),
    };
  });
}

function parseIds(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error(`${path} must be a bounded array`);
  }
  return value.map((id, index) => requiredId(id, `${path}[${index}]`));
}

function requiredId(value: unknown, path = "session id"): string {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    throw new Error(`${path} is invalid`);
  }
  return value;
}

function boundedString(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > maximumLength
  ) {
    throw new Error(`${path} is invalid`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  const result = boundedString(value, path, 64);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`${path} is invalid`);
  }
  return result;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

async function safeErrorCode(response: Response): Promise<string> {
  try {
    const value = requiredRecord(await response.json(), "error response");
    const nested =
      typeof value.error === "object" &&
      value.error !== null &&
      !Array.isArray(value.error)
        ? (value.error as Record<string, unknown>)
        : value;
    if (
      typeof nested.code === "string" &&
      /^[a-z][a-z0-9_]{1,80}$/u.test(nested.code)
    ) {
      return nested.code;
    }
  } catch {
    // Fall through to the stable HTTP category below.
  }
  return `knowledge_session_backend_${response.status}`;
}

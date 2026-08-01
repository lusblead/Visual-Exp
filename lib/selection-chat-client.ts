export type SelectionChatTurnStatus =
  | "pending"
  | "completed"
  | "failed"
  | "unknown";

export type SelectionChatSearchMode = "off" | "auto" | "force";

export type SelectionChatSearchStatus =
  | "disabled"
  | "unavailable"
  | "offered"
  | "used"
  | "failed"
  | "legacy_unknown";

export interface SelectionChatSource {
  title: string;
  url: string;
  snippet: string | null;
  publishedAt: string | null;
}

export interface SelectionChatSearchExecution {
  mode: SelectionChatSearchMode;
  status: SelectionChatSearchStatus;
  providerConfigId: string | null;
  callCount: number;
}

export interface SelectionChatTurn {
  id: string;
  clientTurnId: string;
  status: SelectionChatTurnStatus;
  userText: string;
  assistantText: string | null;
  createdAt: string;
  completedAt: string | null;
  sources: SelectionChatSource[];
  search: SelectionChatSearchExecution;
}

export interface SelectionChatContext {
  nodeId: string;
  text: string;
  contextToken?: string;
}

export interface CreateSelectionChatTurnInput {
  sessionId: string;
  clientTurnId: string;
  question: string;
  selection: SelectionChatContext;
  searchMode?: SelectionChatSearchMode;
}

export interface SelectionChatRequestOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class SelectionChatClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SelectionChatClientError";
    this.code = code;
    this.status = status;
  }
}

const CHAT_API_ROOT = "/api/backend/v1/chat";
const TURN_STATUSES = new Set<SelectionChatTurnStatus>([
  "pending",
  "completed",
  "failed",
  "unknown",
]);
const SEARCH_MODES = new Set<SelectionChatSearchMode>([
  "off",
  "auto",
  "force",
]);
const SEARCH_STATUSES = new Set<SelectionChatSearchStatus>([
  "disabled",
  "unavailable",
  "offered",
  "used",
  "failed",
  "legacy_unknown",
]);

export async function listSelectionChatTurns(
  sessionId: string,
  options: SelectionChatRequestOptions = {},
): Promise<SelectionChatTurn[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${CHAT_API_ROOT}/sessions/${encodeURIComponent(requiredText(sessionId, "sessionId"))}/turns`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw readApiError(response, payload);
  const record = requiredRecord(payload, "chat history response");
  if (!Array.isArray(record.turns)) {
    throw invalidResponse(response.status, "turns must be an array");
  }
  return record.turns.map((turn, index) =>
    parseSelectionChatTurn(turn, `turns[${index}]`, response.status),
  );
}

export async function createSelectionChatTurn(
  input: CreateSelectionChatTurnInput,
  options: SelectionChatRequestOptions = {},
): Promise<SelectionChatTurn> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchMode = input.searchMode ?? "auto";
  const response = await fetchImpl(`${CHAT_API_ROOT}/turns`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...input, searchMode }),
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });
  const payload = await readPayload(response);
  if (response.status !== 200 && response.status !== 202) {
    throw readApiError(response, payload);
  }
  return parseSelectionChatTurn(payload, "chat turn response", response.status);
}

function parseSelectionChatTurn(
  value: unknown,
  path: string,
  status: number,
): SelectionChatTurn {
  const record = requiredRecord(value, path, status);
  const normalizedStatus =
    typeof record.status === "string"
      ? record.status.toLowerCase()
      : "";
  if (!TURN_STATUSES.has(normalizedStatus as SelectionChatTurnStatus)) {
    throw invalidResponse(status, `${path}.status is invalid`);
  }

  const sources = record.sources;
  if (!Array.isArray(sources)) {
    throw invalidResponse(status, `${path}.sources must be an array`);
  }

  return {
    id: requiredText(record.id, `${path}.id`, status),
    clientTurnId: requiredText(
      record.clientTurnId,
      `${path}.clientTurnId`,
      status,
    ),
    status: normalizedStatus as SelectionChatTurnStatus,
    userText: requiredText(record.userText, `${path}.userText`, status),
    assistantText: nullableText(
      record.assistantText,
      `${path}.assistantText`,
      status,
    ),
    createdAt: requiredText(record.createdAt, `${path}.createdAt`, status),
    completedAt: nullableText(
      record.completedAt,
      `${path}.completedAt`,
      status,
    ),
    sources: sources.map((source, index) =>
      parseSelectionChatSource(source, `${path}.sources[${index}]`, status),
    ),
    search: Object.hasOwn(record, "search")
      ? parseSelectionChatSearch(record.search, `${path}.search`, status)
      : {
          mode: "auto",
          status: "legacy_unknown",
          providerConfigId: null,
          callCount: 0,
        },
  };
}

function parseSelectionChatSearch(
  value: unknown,
  path: string,
  status: number,
): SelectionChatSearchExecution {
  const record = requiredRecord(value, path, status);
  const mode =
    typeof record.mode === "string" ? record.mode.toLowerCase() : "";
  const searchStatus =
    typeof record.status === "string" ? record.status.toLowerCase() : "";
  if (!SEARCH_MODES.has(mode as SelectionChatSearchMode)) {
    throw invalidResponse(status, `${path}.mode is invalid`);
  }
  if (!SEARCH_STATUSES.has(searchStatus as SelectionChatSearchStatus)) {
    throw invalidResponse(status, `${path}.status is invalid`);
  }
  if (
    typeof record.callCount !== "number" ||
    !Number.isInteger(record.callCount) ||
    record.callCount < 0 ||
    record.callCount > 2
  ) {
    throw invalidResponse(status, `${path}.callCount must be an integer from 0 to 2`);
  }

  return {
    mode: mode as SelectionChatSearchMode,
    status: searchStatus as SelectionChatSearchStatus,
    providerConfigId: nullableRequiredText(
      record.providerConfigId,
      `${path}.providerConfigId`,
      status,
    ),
    callCount: record.callCount,
  };
}

function parseSelectionChatSource(
  value: unknown,
  path: string,
  status: number,
): SelectionChatSource {
  const record = requiredRecord(value, path, status);
  return {
    title: requiredText(record.title, `${path}.title`, status),
    url: requiredText(record.url, `${path}.url`, status),
    snippet: nullableText(record.snippet, `${path}.snippet`, status),
    publishedAt: nullableText(
      record.publishedAt,
      `${path}.publishedAt`,
      status,
    ),
  };
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw invalidResponse(response.status, "response body is not valid JSON");
  }
}

function readApiError(
  response: Response,
  payload: unknown,
): SelectionChatClientError {
  const record =
    isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
  const code =
    isRecord(record) && typeof record.code === "string"
      ? record.code
      : `selection_chat_http_${response.status}`;
  const message =
    isRecord(record) && typeof record.message === "string"
      ? record.message
      : "AI 对话服务暂时不可用。";
  return new SelectionChatClientError(code, message, response.status);
}

function requiredRecord(
  value: unknown,
  path: string,
  status = 200,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidResponse(status, `${path} must be an object`);
  }
  return value;
}

function requiredText(
  value: unknown,
  path: string,
  status = 0,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidResponse(status, `${path} must be a non-empty string`);
  }
  return value;
}

function nullableText(
  value: unknown,
  path: string,
  status: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw invalidResponse(status, `${path} must be a string or null`);
  }
  return value;
}

function nullableRequiredText(
  value: unknown,
  path: string,
  status: number,
): string | null {
  if (value === null) return null;
  return requiredText(value, path, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(
  status: number,
  detail: string,
): SelectionChatClientError {
  return new SelectionChatClientError(
    "selection_chat_response_invalid",
    `AI 对话服务返回了不完整的数据：${detail}`,
    status,
  );
}

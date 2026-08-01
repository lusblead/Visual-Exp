import type { VisualDocument } from "./visual-contract-types";
import { parseVisualDocument } from "./visual-contract-parse";
import {
  parseTermExplanation,
  type TermExplanation,
} from "./term-explanation";
import {
  parseDeepExplanationResult,
  type DeepExplanation,
} from "./deep-explanation";
import {
  deepTermExplanationCacheKey,
  nestedTermExplanationCacheKey,
  termExplanationCacheKey,
} from "./term-prefetch-priority.mjs";
import { deepReadingCacheKey } from "./deep-reading-cache.mjs";

export const KNOWLEDGE_SESSION_PROTOCOL = "visual-knowledge-session/1" as const;
export const KNOWLEDGE_SESSION_MAX_BYTES = 3_670_016;
export const KNOWLEDGE_SESSION_MAX_HISTORY_ENTRIES = 60;
export const KNOWLEDGE_SESSION_MAX_TERM_RESULTS = 48;
export const KNOWLEDGE_SESSION_MAX_TERM_CARDS = 24;
export const KNOWLEDGE_SESSION_MAX_DEEP_RESULTS = 32;
export const KNOWLEDGE_SESSION_MAX_USAGE_RECEIPTS = 256;

export const PREGENERATION_PROFILES = [
  "on_demand",
  "balanced",
  "deep",
] as const;

export const GENERATION_ACTIONS = [
  "create",
  "expand",
  "define",
  "define_batch",
  "dive",
] as const;

export const GENERATION_LANES = ["foreground", "background"] as const;
export const GENERATION_OUTCOMES = [
  "success",
  "error",
  "aborted",
  "discarded",
] as const;

export type PregenerationProfile = (typeof PREGENERATION_PROFILES)[number];
export type GenerationAction = (typeof GENERATION_ACTIONS)[number];
export type GenerationLane = (typeof GENERATION_LANES)[number];
export type GenerationOutcome = (typeof GENERATION_OUTCOMES)[number];

export interface ExplorationSnapshot {
  entries: string[];
  cursor: number;
}

export interface PersistedTermResult {
  key: string;
  explanation: TermExplanation;
  contextToken: string;
}

export interface PersistedDeepReadingParagraph {
  id?: string;
  label?: string;
  text: string;
}

export interface PersistedDeepReadingState {
  status: "ready";
  subject: string;
  sourceNodeId: string;
  explanation: DeepExplanation;
  title?: string;
  paragraphs?: PersistedDeepReadingParagraph[];
  terms?: string[];
}

export interface PersistedDeepResult {
  key: string;
  state: PersistedDeepReadingState;
  contextToken: string;
}

export interface ProviderTokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
}

export interface GenerationUsageReceipt {
  id: string;
  recordedAt: string;
  action: GenerationAction;
  lane: GenerationLane;
  model: string;
  durationMs: number;
  outcome: GenerationOutcome;
  frontierKey: string | null;
  resourceKey: string;
  usage: ProviderTokenUsage;
  preparedConsumed: boolean;
}

export interface KnowledgeSession {
  protocol: typeof KNOWLEDGE_SESSION_PROTOCOL;
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  document: VisualDocument;
  navigation: ExplorationSnapshot;
  termResults: PersistedTermResult[];
  termCards: Record<string, string[]>;
  visibleTermCardKeys: string[];
  deepResults: PersistedDeepResult[];
  activeDeepKey: string | null;
  prefetchProfile: PregenerationProfile;
  usageReceipts: GenerationUsageReceipt[];
}

export type KnowledgeSessionDraft = Omit<KnowledgeSession, "protocol">;

type InvalidCacheBehavior = "reject" | "drop";

const TOP_LEVEL_KEYS = [
  "protocol",
  "id",
  "createdAt",
  "updatedAt",
  "revision",
  "document",
  "navigation",
  "termResults",
  "termCards",
  "visibleTermCardKeys",
  "deepResults",
  "activeDeepKey",
  "prefetchProfile",
  "usageReceipts",
] as const;

const DRAFT_KEYS = TOP_LEVEL_KEYS.filter((key) => key !== "protocol");
const DOCUMENT_KEYS = [
  "protocol",
  "id",
  "question",
  "title",
  "thesis",
  "rootId",
  "primaryMaterial",
  "nodes",
  "relations",
  "version",
] as const;
const DOCUMENT_REQUIRED_KEYS = DOCUMENT_KEYS.filter(
  (key) => key !== "primaryMaterial",
);
const NODE_KEYS = [
  "id",
  "parentId",
  "title",
  "eyebrow",
  "summary",
  "detail",
  "terms",
  "kind",
  "view",
  "depth",
  "childIds",
  "expandable",
  "expansionState",
  "emphasis",
  "confidence",
  "sourceStatus",
  "evidence",
] as const;
const NODE_REQUIRED_KEYS = NODE_KEYS.filter((key) => key !== "terms");
const EVIDENCE_KEYS = ["label", "detail", "url"] as const;
const RELATION_KEYS = ["id", "scopeId", "from", "to", "kind", "label"] as const;
const TERM_RESULT_KEYS = ["key", "explanation", "contextToken"] as const;
const DEEP_RESULT_KEYS = ["key", "state", "contextToken"] as const;
const DEEP_STATE_KEYS = [
  "status",
  "subject",
  "sourceNodeId",
  "explanation",
  "title",
  "paragraphs",
  "terms",
] as const;
const DEEP_STATE_REQUIRED_KEYS = [
  "status",
  "subject",
  "sourceNodeId",
  "explanation",
] as const;
const DEEP_PARAGRAPH_KEYS = ["id", "label", "text"] as const;
const DEEP_PARAGRAPH_REQUIRED_KEYS = ["text"] as const;
const RECEIPT_KEYS = [
  "id",
  "recordedAt",
  "action",
  "lane",
  "model",
  "durationMs",
  "outcome",
  "frontierKey",
  "resourceKey",
  "usage",
  "preparedConsumed",
] as const;
const USAGE_KEYS = [
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "promptCacheHitTokens",
  "promptCacheMissTokens",
] as const;

const MAX_SESSION_ID_LENGTH = 512;
const MAX_CACHE_KEY_LENGTH = 8_192;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_MODEL_LENGTH = 180;
const MAX_RECEIPT_ID_LENGTH = 180;
const MAX_DEEP_TITLE_LENGTH = 800;
const MAX_DEEP_PARAGRAPHS = 8;
const MAX_DEEP_PARAGRAPH_TEXT_LENGTH = 2_000;
const MAX_DEEP_TERM_LENGTH = 40;
const MAX_DEEP_TERMS = 8;
const CONTEXT_TOKEN_PATTERN = /^ect1\.[A-Za-z0-9_-]{43}$/u;
const DANGEROUS_RECORD_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const FORBIDDEN_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "bearer",
  "bearertoken",
  "companionbearer",
  "companiontoken",
  "hmacsecret",
  "signingsecret",
  "environmentsecret",
  "prompt",
  "providerbody",
  "requestbody",
  "responsebody",
  "pending",
  "controller",
  "abortcontroller",
]);

/**
 * Build a canonical v1 session from trusted in-memory state.
 *
 * Writes stay strict so an internal cache identity bug is reported instead of
 * being silently persisted. Restore uses the same structural parser with
 * per-entry cache isolation because accepted knowledge must survive one
 * corrupt derived result.
 */
export function createKnowledgeSession(value: KnowledgeSessionDraft): KnowledgeSession {
  const draft = strictRecord(value, "session draft", DRAFT_KEYS);
  return parseKnowledgeSessionInternal(
    {
      ...draft,
      protocol: KNOWLEDGE_SESSION_PROTOCOL,
    },
    "reject",
  );
}

/**
 * Parse one untrusted persistence candidate.
 *
 * Invalid navigation is the only repaired structural field: it safely returns
 * to the canonical root. Broken view references are dropped after their
 * completed cache records have been validated.
 */
export function parseKnowledgeSession(value: unknown): KnowledgeSession {
  return parseKnowledgeSessionInternal(value, "drop");
}

function parseKnowledgeSessionInternal(
  value: unknown,
  invalidCacheBehavior: InvalidCacheBehavior,
): KnowledgeSession {
  assertPayloadSize(value);
  assertNoForbiddenFields(value);

  const session = strictRecord(value, "session", TOP_LEVEL_KEYS);
  if (session.protocol !== KNOWLEDGE_SESSION_PROTOCOL) {
    throw new Error(`session.protocol must be ${KNOWLEDGE_SESSION_PROTOCOL}`);
  }

  const id = boundedString(session.id, "session.id", MAX_SESSION_ID_LENGTH);
  const createdAt = timestamp(session.createdAt, "session.createdAt");
  const updatedAt = timestamp(session.updatedAt, "session.updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error("session.updatedAt must not precede session.createdAt");
  }

  assertStrictVisualDocumentShape(session.document);
  const document = parseVisualDocument(session.document);
  const nodeIds = new Set(document.nodes.map((node) => node.id));

  const termCandidates = parseTermResults(
    session.termResults,
    nodeIds,
    invalidCacheBehavior,
  );
  const termCandidateKeys = new Set(
    termCandidates.map((entry) => entry.key),
  );
  const candidateTermCards = parseTermCards(
    session.termCards,
    termCandidateKeys,
  );
  const deepCandidates = parseDeepResults(
    session.deepResults,
    nodeIds,
    invalidCacheBehavior,
  );
  const retainedCaches = retainCanonicalExplanationCaches(
    document,
    termCandidates,
    candidateTermCards,
    deepCandidates,
  );
  if (
    invalidCacheBehavior === "reject" &&
    (retainedCaches.termResults.length !== termCandidates.length ||
      retainedCaches.deepResults.length !== deepCandidates.length)
  ) {
    throw new Error(
      "session cache identity does not match a canonical explanation source",
    );
  }
  const termResults = retainedCaches.termResults;
  const termCards = retainedCaches.termCards;
  const visibleTermCardKeys = parseVisibleTermCardKeys(
    session.visibleTermCardKeys,
    termCards,
  );

  const deepResults = retainedCaches.deepResults;
  const deepKeys = new Set(deepResults.map((entry) => entry.key));
  const activeDeepKey = parseActiveDeepKey(
    session.activeDeepKey,
    deepKeys,
  );

  return {
    protocol: KNOWLEDGE_SESSION_PROTOCOL,
    id,
    createdAt,
    updatedAt,
    revision: safeInteger(session.revision, "session.revision", 1),
    document,
    navigation: parseNavigation(session.navigation, document.rootId, nodeIds),
    termResults,
    termCards,
    visibleTermCardKeys,
    deepResults,
    activeDeepKey,
    prefetchProfile: oneOf(
      session.prefetchProfile,
      PREGENERATION_PROFILES,
      "session.prefetchProfile",
    ),
    usageReceipts: parseUsageReceipts(session.usageReceipts),
  };
}

function parseNavigation(
  value: unknown,
  rootId: string,
  nodeIds: ReadonlySet<string>,
): ExplorationSnapshot {
  try {
    const navigation = strictRecord(
      value,
      "session.navigation",
      ["entries", "cursor"] as const,
    );
    const entries = boundedStringArray(
      navigation.entries,
      "session.navigation.entries",
      KNOWLEDGE_SESSION_MAX_HISTORY_ENTRIES,
      MAX_SESSION_ID_LENGTH,
    );
    const cursor = safeInteger(
      navigation.cursor,
      "session.navigation.cursor",
      0,
    );
    if (
      entries.length === 0 ||
      cursor >= entries.length ||
      entries.some((entry) => !nodeIds.has(entry))
    ) {
      throw new Error("navigation does not resolve inside the document");
    }
    return { entries, cursor };
  } catch {
    return { entries: [rootId], cursor: 0 };
  }
}

function parseTermResults(
  value: unknown,
  nodeIds: ReadonlySet<string>,
  invalidCacheBehavior: InvalidCacheBehavior,
): PersistedTermResult[] {
  const values = boundedArray(
    value,
    "session.termResults",
    KNOWLEDGE_SESSION_MAX_TERM_RESULTS,
  );
  const keyCounts = countRawCacheKeys(values, "session.termResults");
  const parsed = values.flatMap((item, index) => {
    const path = `session.termResults[${index}]`;
    try {
      const result = strictRecord(item, path, TERM_RESULT_KEYS);
      const key = cacheKey(result.key, `${path}.key`);
      if ((keyCounts.get(key) ?? 0) > 1) {
        if (invalidCacheBehavior === "reject") {
          throw new Error(`${path}.key is duplicated`);
        }
        return [];
      }
      const explanation = parseTermExplanation(result.explanation);
      if (!nodeIds.has(explanation.nodeId)) {
        throw new Error(`${path}.explanation belongs to an unknown node`);
      }
      return [
        {
          key,
          explanation,
          contextToken: contextToken(
            result.contextToken,
            `${path}.contextToken`,
          ),
        },
      ];
    } catch (error) {
      if (invalidCacheBehavior === "reject") throw error;
      return [];
    }
  });
  return parsed;
}

function parseTermCards(
  value: unknown,
  termKeys: ReadonlySet<string>,
): Record<string, string[]> {
  const cards = record(value, "session.termCards");
  const cardKeys = Object.keys(cards);
  if (cardKeys.length > KNOWLEDGE_SESSION_MAX_TERM_CARDS) {
    throw new Error(
      `session.termCards must contain at most ${KNOWLEDGE_SESSION_MAX_TERM_CARDS} cards`,
    );
  }

  const parsed: Record<string, string[]> = {};
  for (const rawCardKey of cardKeys) {
    try {
      const cardKey = cacheKey(rawCardKey, "session.termCards key");
      const stack = boundedStringArray(
        cards[rawCardKey],
        `session.termCards[${JSON.stringify(rawCardKey)}]`,
        4,
        MAX_CACHE_KEY_LENGTH,
      ).map((key, index) =>
        cacheKey(
          key,
          `session.termCards[${JSON.stringify(rawCardKey)}][${index}]`,
        ),
      );
      if (
        stack.length === 0 ||
        stack[0] !== cardKey ||
        new Set(stack).size !== stack.length ||
        stack.some((key) => !termKeys.has(key))
      ) {
        continue;
      }
      parsed[cardKey] = stack;
    } catch {
      continue;
    }
  }
  return parsed;
}

function parseVisibleTermCardKeys(
  value: unknown,
  cards: Readonly<Record<string, string[]>>,
): string[] {
  const values = boundedArray(
    value,
    "session.visibleTermCardKeys",
    KNOWLEDGE_SESSION_MAX_TERM_CARDS,
  );
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    try {
      const key = cacheKey(
        value,
        `session.visibleTermCardKeys[${index}]`,
      );
      if (
        !Object.prototype.hasOwnProperty.call(cards, key) ||
        seen.has(key)
      ) {
        return [];
      }
      seen.add(key);
      return [key];
    } catch {
      return [];
    }
  });
}

function parseActiveDeepKey(
  value: unknown,
  deepKeys: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  try {
    const key = cacheKey(value, "session.activeDeepKey");
    return deepKeys.has(key) ? key : null;
  } catch {
    return null;
  }
}

function parseDeepResults(
  value: unknown,
  nodeIds: ReadonlySet<string>,
  invalidCacheBehavior: InvalidCacheBehavior,
): PersistedDeepResult[] {
  const values = boundedArray(
    value,
    "session.deepResults",
    KNOWLEDGE_SESSION_MAX_DEEP_RESULTS,
  );
  const keyCounts = countRawCacheKeys(values, "session.deepResults");
  const parsed = values.flatMap((item, index) => {
    const path = `session.deepResults[${index}]`;
    try {
      const result = strictRecord(item, path, DEEP_RESULT_KEYS);
      const key = cacheKey(result.key, `${path}.key`);
      if ((keyCounts.get(key) ?? 0) > 1) {
        if (invalidCacheBehavior === "reject") {
          throw new Error(`${path}.key is duplicated`);
        }
        return [];
      }
      return [
        {
          key,
          state: parseDeepState(result.state, `${path}.state`, nodeIds),
          contextToken: contextToken(
            result.contextToken,
            `${path}.contextToken`,
          ),
        },
      ];
    } catch (error) {
      if (invalidCacheBehavior === "reject") throw error;
      return [];
    }
  });
  return parsed;
}

function retainCanonicalExplanationCaches(
  document: VisualDocument,
  termCandidates: PersistedTermResult[],
  termCards: Record<string, string[]>,
  deepCandidates: PersistedDeepResult[],
): {
  termResults: PersistedTermResult[];
  termCards: Record<string, string[]>;
  deepResults: PersistedDeepResult[];
} {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const termByKey = new Map(
    termCandidates.map((result) => [result.key, result]),
  );
  const deepByKey = new Map(
    deepCandidates.map((result) => [result.key, result]),
  );
  const retainedTermKeys = new Set<string>();
  const retainedDeepKeys = new Set<string>();
  const rootTermKeys = new Set<string>();

  for (const result of termCandidates) {
    const node = nodes.get(result.explanation.nodeId);
    if (
      node &&
      result.explanation.termPath.length === 1 &&
      result.explanation.termPath[0] === result.explanation.term &&
      node.terms.includes(result.explanation.term) &&
      cacheIdentityMatches(() =>
        termExplanationCacheKey(
          document,
          node,
          result.explanation.term,
        ), result.key)
    ) {
      retainedTermKeys.add(result.key);
      rootTermKeys.add(result.key);
    }
  }

  for (const result of deepCandidates) {
    const node = nodes.get(result.state.sourceNodeId);
    if (
      node &&
      cacheIdentityMatches(
        () =>
          deepReadingCacheKey(
            document,
            node,
            result.state.subject,
          ),
        result.key,
      )
    ) {
      retainedDeepKeys.add(result.key);
    }
  }

  const maximumPasses = termCandidates.length + deepCandidates.length;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;

    for (const stack of Object.values(termCards)) {
      for (let index = 1; index < stack.length; index += 1) {
        const parent = termByKey.get(stack[index - 1]);
        const child = termByKey.get(stack[index]);
        if (
          !parent ||
          !child ||
          !retainedTermKeys.has(parent.key) ||
          retainedTermKeys.has(child.key)
        ) {
          continue;
        }
        const node = nodes.get(child.explanation.nodeId);
        if (
          node &&
          parent.explanation.nodeId === child.explanation.nodeId &&
          parent.explanation.terms.includes(child.explanation.term) &&
          termPathExtends(
            child.explanation.termPath,
            parent.explanation.termPath,
            child.explanation.term,
          ) &&
          cacheIdentityMatches(
            () =>
              nestedTermExplanationCacheKey(
                document,
                node,
                child.explanation.term,
                parent.explanation,
              ),
            child.key,
          )
        ) {
          retainedTermKeys.add(child.key);
          changed = true;
        }
      }
    }

    for (const result of termCandidates) {
      if (retainedTermKeys.has(result.key)) continue;
      const node = nodes.get(result.explanation.nodeId);
      if (!node) continue;
      for (const parentKey of retainedDeepKeys) {
        const parent = deepByKey.get(parentKey);
        if (
          !parent ||
          parent.state.sourceNodeId !== result.explanation.nodeId ||
          !parent.state.explanation.terms.includes(
            result.explanation.term,
          ) ||
          !deepTermPathMatches(
            result.explanation.termPath,
            parent.state.explanation.subject,
            result.explanation.term,
          )
        ) {
          continue;
        }
        if (
          cacheIdentityMatches(
            () =>
              deepTermExplanationCacheKey(
                document,
                node,
                result.explanation.term,
                parent.state.explanation,
              ),
            result.key,
          )
        ) {
          retainedTermKeys.add(result.key);
          rootTermKeys.add(result.key);
          changed = true;
          break;
        }
      }
    }

    for (const result of deepCandidates) {
      if (retainedDeepKeys.has(result.key)) continue;
      const node = nodes.get(result.state.sourceNodeId);
      if (!node) continue;

      for (const parentKey of retainedTermKeys) {
        const parent = termByKey.get(parentKey);
        if (
          parent?.explanation.nodeId === result.state.sourceNodeId &&
          cacheIdentityMatches(
            () =>
              deepReadingCacheKey(
                document,
                node,
                result.state.subject,
                { parentTermExplanation: parent.explanation },
              ),
            result.key,
          )
        ) {
          retainedDeepKeys.add(result.key);
          changed = true;
          break;
        }
      }
      if (retainedDeepKeys.has(result.key)) continue;

      for (const parentKey of retainedDeepKeys) {
        const parent = deepByKey.get(parentKey);
        if (
          parent?.key !== result.key &&
          parent?.state.sourceNodeId === result.state.sourceNodeId &&
          cacheIdentityMatches(
            () =>
              deepReadingCacheKey(
                document,
                node,
                result.state.subject,
                { parentDeepExplanation: parent.state.explanation },
              ),
            result.key,
          )
        ) {
          retainedDeepKeys.add(result.key);
          changed = true;
          break;
        }
      }
    }

    if (!changed) break;
  }

  const retainedTermCards: Record<string, string[]> = {};
  for (const [cardKey, stack] of Object.entries(termCards)) {
    if (
      rootTermKeys.has(cardKey) &&
      stack.every((key) => retainedTermKeys.has(key)) &&
      canonicalTermCardStack(document, nodes, termByKey, stack)
    ) {
      retainedTermCards[cardKey] = stack;
    }
  }

  return {
    termResults: termCandidates.filter((result) =>
      retainedTermKeys.has(result.key),
    ),
    termCards: retainedTermCards,
    deepResults: deepCandidates.filter((result) =>
      retainedDeepKeys.has(result.key),
    ),
  };
}

function canonicalTermCardStack(
  document: VisualDocument,
  nodes: ReadonlyMap<string, VisualDocument["nodes"][number]>,
  termByKey: ReadonlyMap<string, PersistedTermResult>,
  stack: string[],
): boolean {
  for (let index = 1; index < stack.length; index += 1) {
    const parent = termByKey.get(stack[index - 1]);
    const child = termByKey.get(stack[index]);
    const node = child ? nodes.get(child.explanation.nodeId) : undefined;
    if (
      !parent ||
      !child ||
      !node ||
      parent.explanation.nodeId !== child.explanation.nodeId ||
      !parent.explanation.terms.includes(child.explanation.term) ||
      !termPathExtends(
        child.explanation.termPath,
        parent.explanation.termPath,
        child.explanation.term,
      ) ||
      !cacheIdentityMatches(
        () =>
          nestedTermExplanationCacheKey(
            document,
            node,
            child.explanation.term,
            parent.explanation,
          ),
        child.key,
      )
    ) {
      return false;
    }
  }
  return true;
}

function cacheIdentityMatches(createKey: () => string, storedKey: string): boolean {
  try {
    return createKey() === storedKey;
  } catch {
    return false;
  }
}

function termPathExtends(
  childPath: readonly string[],
  parentPath: readonly string[],
  childTerm: string,
): boolean {
  return (
    childPath.length === parentPath.length + 1 &&
    parentPath.every((term, index) => childPath[index] === term) &&
    childPath.at(-1) === childTerm
  );
}

function deepTermPathMatches(
  childPath: readonly string[],
  parentSubject: string,
  childTerm: string,
): boolean {
  return (
    childPath.length === 2 &&
    childPath[0] === parentSubject &&
    childPath[1] === childTerm
  );
}

function parseDeepState(
  value: unknown,
  path: string,
  nodeIds: ReadonlySet<string>,
): PersistedDeepReadingState {
  const state = strictRecord(
    value,
    path,
    DEEP_STATE_KEYS,
    DEEP_STATE_REQUIRED_KEYS,
  );
  if (state.status !== "ready") {
    throw new Error(`${path}.status must be ready`);
  }
  const explanation = parseDeepExplanationResult(state.explanation);
  const subject = boundedString(state.subject, `${path}.subject`, 600);
  const sourceNodeId = boundedString(
    state.sourceNodeId,
    `${path}.sourceNodeId`,
    MAX_SESSION_ID_LENGTH,
  );
  if (
    explanation.subject !== subject ||
    explanation.nodeId !== sourceNodeId ||
    !nodeIds.has(sourceNodeId)
  ) {
    throw new Error(`${path} does not match its completed explanation`);
  }

  const parsed: PersistedDeepReadingState = {
    status: "ready",
    subject,
    sourceNodeId,
    explanation,
  };
  if (state.title !== undefined) {
    parsed.title = boundedString(
      state.title,
      `${path}.title`,
      MAX_DEEP_TITLE_LENGTH,
    );
  }
  if (state.paragraphs !== undefined) {
    parsed.paragraphs = parseDeepParagraphs(state.paragraphs, `${path}.paragraphs`);
  }
  if (state.terms !== undefined) {
    const terms = boundedStringArray(
      state.terms,
      `${path}.terms`,
      MAX_DEEP_TERMS,
      MAX_DEEP_TERM_LENGTH,
    );
    if (
      terms.length !== explanation.terms.length ||
      terms.some((term, index) => term !== explanation.terms[index])
    ) {
      throw new Error(`${path}.terms must match explanation.terms`);
    }
    parsed.terms = terms;
  }
  return parsed;
}

function parseDeepParagraphs(
  value: unknown,
  path: string,
): PersistedDeepReadingParagraph[] {
  return boundedArray(value, path, MAX_DEEP_PARAGRAPHS).map((item, index) => {
    const paragraphPath = `${path}[${index}]`;
    const paragraph = strictRecord(
      item,
      paragraphPath,
      DEEP_PARAGRAPH_KEYS,
      DEEP_PARAGRAPH_REQUIRED_KEYS,
    );
    const parsed: PersistedDeepReadingParagraph = {
      text: boundedString(
        paragraph.text,
        `${paragraphPath}.text`,
        MAX_DEEP_PARAGRAPH_TEXT_LENGTH,
      ),
    };
    if (paragraph.id !== undefined) {
      parsed.id = boundedString(paragraph.id, `${paragraphPath}.id`, 120);
    }
    if (paragraph.label !== undefined) {
      parsed.label = boundedString(paragraph.label, `${paragraphPath}.label`, 120);
    }
    return parsed;
  });
}

function parseUsageReceipts(value: unknown): GenerationUsageReceipt[] {
  const seenIds = new Set<string>();
  return boundedArray(
    value,
    "session.usageReceipts",
    KNOWLEDGE_SESSION_MAX_USAGE_RECEIPTS,
  ).map((item, index) => {
    const path = `session.usageReceipts[${index}]`;
    const receipt = strictRecord(item, path, RECEIPT_KEYS);
    const lane = oneOf(receipt.lane, GENERATION_LANES, `${path}.lane`);
    const frontierKey =
      receipt.frontierKey === null
        ? null
        : cacheKey(receipt.frontierKey, `${path}.frontierKey`);
    if (lane === "background" && frontierKey === null) {
      throw new Error(`${path}.frontierKey is required for background work`);
    }
    if (lane === "foreground" && frontierKey !== null) {
      throw new Error(`${path}.frontierKey must be null for foreground work`);
    }

    const usage = strictRecord(receipt.usage, `${path}.usage`, USAGE_KEYS);
    const id = boundedString(
      receipt.id,
      `${path}.id`,
      MAX_RECEIPT_ID_LENGTH,
    );
    if (seenIds.has(id)) throw new Error(`${path}.id is duplicated`);
    seenIds.add(id);
    const preparedConsumed = booleanValue(
      receipt.preparedConsumed,
      `${path}.preparedConsumed`,
    );
    if (lane === "foreground" && preparedConsumed) {
      throw new Error(`${path}.preparedConsumed is only valid for background work`);
    }

    return {
      id,
      recordedAt: timestamp(receipt.recordedAt, `${path}.recordedAt`),
      action: oneOf(receipt.action, GENERATION_ACTIONS, `${path}.action`),
      lane,
      model: boundedString(receipt.model, `${path}.model`, MAX_MODEL_LENGTH),
      durationMs: finiteNumber(receipt.durationMs, `${path}.durationMs`, 0),
      outcome: oneOf(receipt.outcome, GENERATION_OUTCOMES, `${path}.outcome`),
      frontierKey,
      resourceKey: cacheKey(receipt.resourceKey, `${path}.resourceKey`),
      usage: {
        promptTokens: nullableTokenCount(
          usage.promptTokens,
          `${path}.usage.promptTokens`,
        ),
        completionTokens: nullableTokenCount(
          usage.completionTokens,
          `${path}.usage.completionTokens`,
        ),
        totalTokens: nullableTokenCount(
          usage.totalTokens,
          `${path}.usage.totalTokens`,
        ),
        promptCacheHitTokens: nullableTokenCount(
          usage.promptCacheHitTokens,
          `${path}.usage.promptCacheHitTokens`,
        ),
        promptCacheMissTokens: nullableTokenCount(
          usage.promptCacheMissTokens,
          `${path}.usage.promptCacheMissTokens`,
        ),
      },
      preparedConsumed,
    };
  });
}

function assertStrictVisualDocumentShape(value: unknown): void {
  const document = strictRecord(
    value,
    "session.document",
    DOCUMENT_KEYS,
    DOCUMENT_REQUIRED_KEYS,
  );
  if (!Array.isArray(document.nodes)) {
    throw new Error("session.document.nodes must be an array");
  }
  document.nodes.forEach((value, nodeIndex) => {
    const nodePath = `session.document.nodes[${nodeIndex}]`;
    const node = strictRecord(
      value,
      nodePath,
      NODE_KEYS,
      NODE_REQUIRED_KEYS,
    );
    if (!Array.isArray(node.evidence)) {
      throw new Error(`${nodePath}.evidence must be an array`);
    }
    node.evidence.forEach((evidence, evidenceIndex) => {
      strictRecord(
        evidence,
        `${nodePath}.evidence[${evidenceIndex}]`,
        EVIDENCE_KEYS,
      );
    });
  });
  if (!Array.isArray(document.relations)) {
    throw new Error("session.document.relations must be an array");
  }
  document.relations.forEach((relation, index) => {
    strictRecord(
      relation,
      `session.document.relations[${index}]`,
      RELATION_KEYS,
    );
  });
}

function assertPayloadSize(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("session must be JSON serializable");
  }
  if (typeof serialized !== "string") {
    throw new Error("session must be JSON serializable");
  }
  if (new TextEncoder().encode(serialized).byteLength > KNOWLEDGE_SESSION_MAX_BYTES) {
    throw new Error("session exceeds the 3.5 MiB persistence limit");
  }
}

function assertNoForbiddenFields(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoForbiddenFields(item, seen));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const identity = key.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("und");
    if (FORBIDDEN_FIELD_NAMES.has(identity)) {
      throw new Error(`session field ${key} is forbidden`);
    }
    assertNoForbiddenFields(child, seen);
  }
}

function strictRecord<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowedKeys: T,
  requiredKeys: readonly string[] = allowedKeys,
): Record<T[number], unknown> {
  const item = record(value, path);
  const allowed = new Set<string>(allowedKeys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is not allowed`);
  }
  for (const key of requiredKeys) {
    if (!(key in item)) throw new Error(`${path}.${key} is required`);
  }
  return item as Record<T[number], unknown>;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedArray(
  value: unknown,
  path: string,
  maximumItems: number,
): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > maximumItems) {
    throw new Error(`${path} must contain at most ${maximumItems} items`);
  }
  return value;
}

function boundedStringArray(
  value: unknown,
  path: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  return boundedArray(value, path, maximumItems).map((item, index) =>
    boundedString(item, `${path}[${index}]`, maximumLength),
  );
}

function boundedString(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${path} must not be empty`);
  if (Array.from(normalized).length > maximumLength) {
    throw new Error(`${path} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function countRawCacheKeys(
  values: readonly unknown[],
  path: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      continue;
    }
    try {
      const key = cacheKey(
        (value as Record<string, unknown>).key,
        `${path}[${index}].key`,
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    } catch {
      // The owning entry parser handles malformed keys. Invalid keys cannot
      // collide with a canonical entry until cacheKey has accepted them.
    }
  }
  return counts;
}

function cacheKey(value: unknown, path: string): string {
  const key = boundedString(value, path, MAX_CACHE_KEY_LENGTH);
  if (DANGEROUS_RECORD_KEYS.has(key)) {
    throw new Error(`${path} is not a safe record key`);
  }
  return key;
}

function timestamp(value: unknown, path: string): string {
  const result = boundedString(value, path, MAX_TIMESTAMP_LENGTH);
  if (!Number.isFinite(Date.parse(result))) {
    throw new Error(`${path} must be a valid timestamp`);
  }
  return result;
}

function contextToken(value: unknown, path: string): string {
  if (typeof value !== "string" || !CONTEXT_TOKEN_PATTERN.test(value)) {
    throw new Error(`${path} must be an opaque ect1 context token`);
  }
  return value;
}

function safeInteger(
  value: unknown,
  path: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} must be a safe integer of at least ${minimum}`);
  }
  return value as number;
}

function finiteNumber(
  value: unknown,
  path: string,
  minimum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    throw new Error(`${path} must be a finite number of at least ${minimum}`);
  }
  return value;
}

function nullableTokenCount(value: unknown, path: string): number | null {
  if (value === null) return null;
  return safeInteger(value, path, 0);
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new Error(`${path} is not supported`);
  }
  return value as T[number];
}

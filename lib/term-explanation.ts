import type { Confidence, SourceStatus } from "./lineage-contracts";
import { containsAnnotatedTerm } from "./annotated-term-match.mjs";
import {
  assertTextMatchesMathPreference,
  normalizeTermIdentity,
} from "./visual-content-quality";

export const TERM_EXPLANATION_PROTOCOL = "visual-term-explanation/2" as const;
export const MAX_TERM_EXPLANATION_DEPTH = 4;
export const MAX_TERM_BATCH_SIZE = 8;
const MAX_NESTED_TERMS = 4;
const MAX_TERM_LENGTH = 40;

/** Minimal structural view needed when a term originates in a deep reading. */
export interface DeepTermDefinitionParent {
  protocol: "visual-deep-explanation/1";
  subject: string;
  nodeId: string;
  directAnswer: string;
  background: string;
  role: string;
  mechanism: string;
  boundary: string;
  terms: string[];
}

export interface TermDefinitionContext {
  term: string;
  question: string;
  path: string[];
  scene: {
    title: string;
    summary: string;
    detail: string;
  };
  /** Optional during the compatibility transition; results always contain it. */
  termPath?: string[];
  /** Present when the term originated in another short explanation. */
  parentExplanation?: TermExplanation;
  /** Present when the term originated in a signed deep-reading result. */
  parentDeepExplanation?: DeepTermDefinitionParent;
  /** Allows a batch caller to prove that all items belong to one node. */
  nodeId?: string;
}

export interface TermDefinitionDraft {
  definition: string;
  relevance: string;
  terms: string[];
}

export interface TermDefinitionBatchDraft {
  definitions: Array<TermDefinitionDraft & { term: string }>;
}

export interface TermExplanation extends TermDefinitionDraft {
  protocol: typeof TERM_EXPLANATION_PROTOCOL;
  term: string;
  termPath: string[];
  nodeId: string;
  confidence: Confidence;
  sourceStatus: SourceStatus;
}

export const termDefinitionDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["definition", "relevance", "terms"],
  properties: {
    definition: { type: "string", minLength: 1, maxLength: 500 },
    relevance: { type: "string", minLength: 1, maxLength: 500 },
    terms: {
      type: "array",
      maxItems: MAX_NESTED_TERMS,
      items: { type: "string", minLength: 1, maxLength: MAX_TERM_LENGTH },
    },
  },
} as const;

export const termDefinitionBatchDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["definitions"],
  properties: {
    definitions: {
      type: "array",
      minItems: 1,
      maxItems: MAX_TERM_BATCH_SIZE,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition", "relevance", "terms"],
        properties: {
          term: { type: "string", minLength: 1, maxLength: MAX_TERM_LENGTH },
          definition: termDefinitionDraftSchema.properties.definition,
          relevance: termDefinitionDraftSchema.properties.relevance,
          terms: termDefinitionDraftSchema.properties.terms,
        },
      },
    },
  },
} as const;

export function parseTermDefinition(
  value: unknown,
  context?: TermDefinitionContext,
): TermDefinitionDraft {
  const record = strictRecord(
    value,
    "名词解释",
    new Set(["definition", "relevance", "terms"]),
  );
  const draft = {
    definition: boundedText(record.definition, "definition", 500),
    relevance: boundedText(record.relevance, "relevance", 500),
    terms: sanitizeAnnotatedTerms(
      record.terms,
      `${String(record.definition ?? "")} ${String(record.relevance ?? "")}`,
      context ? resolvedTermPath(context) : [],
      MAX_NESTED_TERMS,
    ),
  };
  if (context) {
    assertTextMatchesMathPreference(
      context.question,
      `${draft.definition}\n${draft.relevance}`,
    );
  }
  return draft;
}

/**
 * Parse one Flash response for up to eight definitions and return drafts in the
 * same order as the requested contexts, regardless of provider output order.
 */
export function parseTermDefinitions(
  value: unknown,
  contexts: TermDefinitionContext[],
): TermDefinitionDraft[] {
  assertTermDefinitionBatchContexts(contexts);
  const record = strictRecord(value, "批量名词解释", new Set(["definitions"]));
  if (!Array.isArray(record.definitions)) {
    throw new Error("definitions 必须是数组");
  }
  if (record.definitions.length !== contexts.length) {
    throw new Error("definitions 必须与请求术语一一对应");
  }

  const requested = new Map(
    contexts.map((context) => [normalizeTermIdentity(context.term), context]),
  );
  const parsed = new Map<string, TermDefinitionDraft>();
  for (const [index, candidate] of record.definitions.entries()) {
    const item = strictRecord(
      candidate,
      `definitions[${index}]`,
      new Set(["term", "definition", "relevance", "terms"]),
    );
    const term = boundedText(item.term, `definitions[${index}].term`, MAX_TERM_LENGTH);
    const identity = normalizeTermIdentity(term);
    const context = requested.get(identity);
    if (!context) throw new Error(`definitions[${index}].term 不在请求术语中`);
    if (parsed.has(identity)) throw new Error(`definitions 包含重复术语：${term}`);
    parsed.set(
      identity,
      parseTermDefinition(
        {
          definition: item.definition,
          relevance: item.relevance,
          terms: item.terms,
        },
        context,
      ),
    );
  }

  return contexts.map((context) => {
    const draft = parsed.get(normalizeTermIdentity(context.term));
    if (!draft) throw new Error(`definitions 缺少术语：${context.term}`);
    return draft;
  });
}

export function assertTermDefinitionBatchContexts(
  contexts: TermDefinitionContext[],
): void {
  if (!Array.isArray(contexts) || contexts.length < 1 || contexts.length > MAX_TERM_BATCH_SIZE) {
    throw new Error(`批量名词解释必须包含 1 到 ${MAX_TERM_BATCH_SIZE} 个术语`);
  }
  const reference = contextIdentity(contexts[0]);
  const terms = new Set<string>();
  for (const [index, context] of contexts.entries()) {
    if (contextIdentity(context) !== reference) {
      throw new Error(`批量名词解释必须来自同一个节点和解释上下文（第 ${index + 1} 项不一致）`);
    }
    const identity = normalizeTermIdentity(context.term);
    if (!identity) throw new Error("批量名词解释不能包含空术语");
    if (terms.has(identity)) throw new Error(`批量名词解释包含重复术语：${context.term}`);
    terms.add(identity);
    resolvedTermPath(context);
  }
}

export function createTermExplanation(
  context: TermDefinitionContext,
  nodeId: string,
  confidence: Confidence,
  sourceStatus: SourceStatus,
  draft: TermDefinitionDraft,
): TermExplanation {
  const parsedDraft = parseTermDefinition(draft, context);
  return {
    protocol: TERM_EXPLANATION_PROTOCOL,
    term: context.term.trim(),
    termPath: resolvedTermPath(context),
    nodeId,
    ...parsedDraft,
    confidence,
    sourceStatus,
  };
}

export function parseTermExplanation(value: unknown): TermExplanation {
  const record = strictRecord(
    value,
    "名词解释结果",
    new Set([
      "protocol",
      "term",
      "termPath",
      "nodeId",
      "definition",
      "relevance",
      "terms",
      "confidence",
      "sourceStatus",
    ]),
  );
  if (record.protocol !== TERM_EXPLANATION_PROTOCOL) {
    throw new Error(`名词解释协议必须是 ${TERM_EXPLANATION_PROTOCOL}`);
  }
  const term = boundedText(record.term, "term", MAX_TERM_LENGTH);
  const termPath = parseTermPath(record.termPath, term);
  const nodeId = boundedText(record.nodeId, "nodeId", 180);
  const confidence = parseConfidence(record.confidence);
  const sourceStatus = parseSourceStatus(record.sourceStatus);
  const draft = parseTermDefinition(
    {
      definition: record.definition,
      relevance: record.relevance,
      terms: record.terms,
    },
    {
      term,
      termPath,
      question: "已验证的数学公式解释",
      path: [],
      scene: { title: "validated explanation", summary: "context", detail: "context" },
    },
  );
  return {
    protocol: TERM_EXPLANATION_PROTOCOL,
    term,
    termPath,
    nodeId,
    ...draft,
    confidence,
    sourceStatus,
  };
}

export function isTermExplanation(value: unknown): value is TermExplanation {
  try {
    parseTermExplanation(value);
    return true;
  } catch {
    return false;
  }
}

function resolvedTermPath(context: TermDefinitionContext): string[] {
  const source = context.termPath ??
    (context.parentExplanation
      ? [...context.parentExplanation.termPath, context.term]
      : context.parentDeepExplanation
        ? [context.parentDeepExplanation.subject, context.term]
      : [context.term]);
  return parseTermPath(source, context.term);
}

function parseTermPath(value: unknown, currentTerm: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TERM_EXPLANATION_DEPTH) {
    throw new Error(`termPath 必须包含 1 到 ${MAX_TERM_EXPLANATION_DEPTH} 个术语`);
  }
  const identities = new Set<string>();
  const path = value.map((item, index) => {
    const term = boundedText(item, `termPath[${index}]`, MAX_TERM_LENGTH);
    const identity = normalizeTermIdentity(term);
    if (identities.has(identity)) throw new Error(`termPath 包含循环或重复术语：${term}`);
    identities.add(identity);
    return term;
  });
  if (normalizeTermIdentity(path.at(-1) ?? "") !== normalizeTermIdentity(currentTerm)) {
    throw new Error("termPath 最后一项必须是当前术语");
  }
  return path;
}

function sanitizeAnnotatedTerms(
  value: unknown,
  content: string,
  excludedPath: string[],
  maximum: number,
): string[] {
  if (!Array.isArray(value)) return [];
  const excluded = new Set(excludedPath.map(normalizeTermIdentity));
  const identities = new Set<string>();
  const terms: string[] = [];
  for (const item of value) {
    if (terms.length >= maximum) break;
    if (typeof item !== "string") continue;
    const term = item.trim();
    if (
      term.length === 0 ||
      Array.from(term).length > MAX_TERM_LENGTH ||
      /\r|\n|\u2028|\u2029/u.test(term)
    ) {
      continue;
    }
    const identity = normalizeTermIdentity(term);
    if (!identity || excluded.has(identity) || identities.has(identity)) continue;
    if (!containsAnnotatedTerm(content, term)) continue;
    identities.add(identity);
    terms.push(term);
  }
  return terms;
}

function contextIdentity(context: TermDefinitionContext): string {
  const parent = context.parentExplanation;
  const deepParent = context.parentDeepExplanation;
  return JSON.stringify({
    nodeId: context.nodeId ?? null,
    question: context.question,
    path: context.path,
    scene: context.scene,
    parent: parent
      ? {
          nodeId: parent.nodeId,
          termPath: parent.termPath,
          definition: parent.definition,
          relevance: parent.relevance,
        }
      : null,
    deepParent: deepParent
      ? {
          nodeId: deepParent.nodeId,
          subject: deepParent.subject,
          directAnswer: deepParent.directAnswer,
          background: deepParent.background,
          role: deepParent.role,
          mechanism: deepParent.mechanism,
          boundary: deepParent.boundary,
        }
      : null,
  });
}

function strictRecord(
  value: unknown,
  label: string,
  allowed: Set<string>,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error(`${label} 包含未允许的字段`);
  }
  return record;
}

function boundedText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串`);
  }
  const normalized = value.trim();
  if (Array.from(normalized).length > maximum) {
    throw new Error(`${path} 超过 ${maximum} 个字符`);
  }
  return normalized;
}

function parseConfidence(value: unknown): Confidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  throw new Error("confidence 不合法");
}

function parseSourceStatus(value: unknown): SourceStatus {
  if (
    value === "source_backed" ||
    value === "model_knowledge" ||
    value === "needs_source"
  ) {
    return value;
  }
  throw new Error("sourceStatus 不合法");
}

import type { Confidence, SourceStatus } from "./lineage-contracts";
import { containsAnnotatedTerm } from "./annotated-term-match.mjs";
import {
  parseTermExplanation,
  type TermExplanation,
} from "./term-explanation";
import {
  assertTextMatchesMathPreference,
  normalizeTermIdentity,
} from "./visual-content-quality";

export const DEEP_EXPLANATION_PROTOCOL = "visual-deep-explanation/1" as const;
const MAX_DEEP_TERMS = 8;
const MAX_TERM_LENGTH = 40;

export interface DeepExplanationContext {
  subject: string;
  question: string;
  path: string[];
  scene: {
    title: string;
    summary: string;
    detail: string;
  };
  /** False is the product default; only explicit requests should set true. */
  allowMath: boolean;
  parentExplanation?: TermExplanation;
  parentDeepExplanation?: DeepExplanation;
}

export interface DeepExplanationDraft {
  directAnswer: string;
  background: string;
  role: string;
  mechanism: string;
  boundary: string;
  terms: string[];
}

export interface DeepExplanation extends DeepExplanationDraft {
  protocol: typeof DEEP_EXPLANATION_PROTOCOL;
  subject: string;
  nodeId: string;
  confidence: Confidence;
  sourceStatus: SourceStatus;
}

export interface DeepExplanationRequest {
  nodeId: string;
  selection: string;
  parentExplanation: TermExplanation | null;
  parentDeepExplanation: DeepExplanation | null;
}

export const deepExplanationDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "directAnswer",
    "background",
    "role",
    "mechanism",
    "boundary",
    "terms",
  ],
  properties: {
    directAnswer: { type: "string", minLength: 1, maxLength: 400 },
    background: { type: "string", minLength: 1, maxLength: 600 },
    role: { type: "string", minLength: 1, maxLength: 600 },
    mechanism: { type: "string", minLength: 1, maxLength: 900 },
    boundary: { type: "string", minLength: 1, maxLength: 500 },
    terms: {
      type: "array",
      maxItems: MAX_DEEP_TERMS,
      items: { type: "string", minLength: 1, maxLength: MAX_TERM_LENGTH },
    },
  },
} as const;

export function parseDeepExplanation(
  value: unknown,
  context?: DeepExplanationContext,
): DeepExplanationDraft {
  const record = strictRecord(
    value,
    "深入解释",
    new Set([
      "directAnswer",
      "background",
      "role",
      "mechanism",
      "boundary",
      "terms",
    ]),
  );
  const draft: DeepExplanationDraft = {
    directAnswer: boundedText(record.directAnswer, "directAnswer", 400),
    background: boundedText(record.background, "background", 600),
    role: boundedText(record.role, "role", 600),
    mechanism: boundedText(record.mechanism, "mechanism", 900),
    boundary: boundedText(record.boundary, "boundary", 500),
    terms: [],
  };
  const content = [
    draft.directAnswer,
    draft.background,
    draft.role,
    draft.mechanism,
    draft.boundary,
  ].join(" ");
  draft.terms = parseTerms(record.terms, content, context?.subject);
  if (context && !context.allowMath) {
    assertTextMatchesMathPreference(context.question, content);
  }
  return draft;
}

export function createDeepExplanation(
  context: DeepExplanationContext,
  nodeId: string,
  confidence: Confidence,
  sourceStatus: SourceStatus,
  draft: DeepExplanationDraft,
): DeepExplanation {
  return {
    protocol: DEEP_EXPLANATION_PROTOCOL,
    subject: context.subject.trim(),
    nodeId,
    ...parseDeepExplanation(draft, context),
    confidence,
    sourceStatus,
  };
}

export function parseDeepExplanationResult(value: unknown): DeepExplanation {
  const record = strictRecord(
    value,
    "深入解释结果",
    new Set([
      "protocol",
      "subject",
      "nodeId",
      "directAnswer",
      "background",
      "role",
      "mechanism",
      "boundary",
      "terms",
      "confidence",
      "sourceStatus",
    ]),
  );
  if (record.protocol !== DEEP_EXPLANATION_PROTOCOL) {
    throw new Error(`深入解释协议必须是 ${DEEP_EXPLANATION_PROTOCOL}`);
  }
  const subject = boundedText(record.subject, "subject", 600);
  const nodeId = boundedText(record.nodeId, "nodeId", 180);
  const draft = parseDeepExplanation(
    {
      directAnswer: record.directAnswer,
      background: record.background,
      role: record.role,
      mechanism: record.mechanism,
      boundary: record.boundary,
      terms: record.terms,
    },
    {
      subject,
      question: "explicit mathematics validation is unavailable for a stored result",
      path: [],
      scene: { title: "validated explanation", summary: "context", detail: "context" },
      allowMath: true,
    },
  );
  return {
    protocol: DEEP_EXPLANATION_PROTOCOL,
    subject,
    nodeId,
    ...draft,
    confidence: parseConfidence(record.confidence),
    sourceStatus: parseSourceStatus(record.sourceStatus),
  };
}

export function isDeepExplanation(value: unknown): value is DeepExplanation {
  try {
    parseDeepExplanationResult(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the action-specific request envelope after the API has selected its
 * `dive` branch. Literal membership in the document is intentionally verified
 * by the API because this module does not own the canonical graph.
 */
export function parseDeepExplanationRequest(value: unknown): DeepExplanationRequest {
  const record = strictRecord(
    value,
    "深入解释请求",
    new Set([
      "nodeId",
      "selection",
      "parentExplanation",
      "parentDeepExplanation",
    ]),
  );
  const parent =
    record.parentExplanation === undefined || record.parentExplanation === null
      ? null
      : parseTermExplanation(record.parentExplanation);
  const deepParent =
    record.parentDeepExplanation === undefined ||
    record.parentDeepExplanation === null
      ? null
      : parseDeepExplanationResult(record.parentDeepExplanation);
  if (parent && deepParent) {
    throw new Error("parentExplanation 与 parentDeepExplanation 只能提供一个");
  }
  return {
    nodeId: boundedText(record.nodeId, "nodeId", 180),
    selection: boundedText(record.selection, "selection", 600),
    parentExplanation: parent,
    parentDeepExplanation: deepParent,
  };
}

function parseTerms(value: unknown, content: string, subject?: string): string[] {
  if (!Array.isArray(value)) throw new Error("terms 必须是数组");
  if (value.length > MAX_DEEP_TERMS) {
    throw new Error(`terms 不能超过 ${MAX_DEEP_TERMS} 个术语`);
  }
  const subjectIdentity = subject ? normalizeTermIdentity(subject) : "";
  const identities = new Set<string>();
  return value.map((item, index) => {
    const term = boundedText(item, `terms[${index}]`, MAX_TERM_LENGTH);
    if (/\r|\n|\u2028|\u2029/u.test(term)) throw new Error(`terms[${index}] 必须保持单行`);
    const identity = normalizeTermIdentity(term);
    if (identity === subjectIdentity) throw new Error("terms 不能重复深入解释的主题");
    if (identities.has(identity)) throw new Error(`terms 包含规范化后重复的术语：${term}`);
    if (!containsAnnotatedTerm(content, term)) {
      throw new Error(`术语“${term}”没有逐字出现在深入解释正文中`);
    }
    identities.add(identity);
    return term;
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

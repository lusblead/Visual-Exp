import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  parseDeepExplanationResult,
  type DeepExplanation,
} from "./deep-explanation";
import {
  parseTermExplanation,
  type TermExplanation,
} from "./term-explanation";

export const EXPLANATION_CONTEXT_TOKEN_PROTOCOL = "ect1" as const;
export const EXPLANATION_CONTEXT_TOKEN_SECRET_ENV =
  "EXPLANATION_CONTEXT_TOKEN_SECRET" as const;

const CONTEXT_DOMAIN = "visual-explanation-context-token/1";
const NODE_FINGERPRINT_DOMAIN = "visual-explanation-node-content/1";
const TOKEN_MAC_BYTES = 32;
const TOKEN_PATTERN = /^ect1\.([A-Za-z0-9_-]{43})$/u;
const MINIMUM_SECRET_BYTES = 32;

let developmentFallbackSecret: Buffer | undefined;

/**
 * Only the content that an explanation is derived from belongs here. Layout,
 * hover state, history, and other client projections deliberately do not.
 */
export interface ExplanationContextNode {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  detail: string;
  terms: readonly string[];
}

export interface ExplanationContextBinding {
  documentId: string;
  node: ExplanationContextNode;
  explanation: TermExplanation | DeepExplanation;
}

/**
 * Issue a compact, payload-free context MAC.
 *
 * The token is not a bearer authorization credential and carries no claims.
 * Verification requires the server to rebuild the complete expected binding,
 * which keeps explanation text, document identifiers, and provider secrets out
 * of the token itself.
 */
export function issueExplanationContextToken(
  binding: ExplanationContextBinding,
): string {
  const canonicalContext = canonicalizeBinding(binding);
  const signature = signCanonicalContext(canonicalContext);
  return `${EXPLANATION_CONTEXT_TOKEN_PROTOCOL}.${signature.toString("base64url")}`;
}

/**
 * Verify a token against the complete expected server-side context.
 *
 * Invalid context shapes and malformed tokens fail closed. A missing or weak
 * production signing secret remains a configuration error instead of being
 * hidden as an ordinary invalid token.
 */
export function verifyExplanationContextToken(
  token: unknown,
  binding: ExplanationContextBinding,
): boolean {
  let canonicalContext: string;
  try {
    canonicalContext = canonicalizeBinding(binding);
  } catch {
    return false;
  }

  const expected = signCanonicalContext(canonicalContext);
  const matched = typeof token === "string" ? TOKEN_PATTERN.exec(token) : null;
  const encodedSignature = matched?.[1] ?? "";
  const supplied = decodeSignature(encodedSignature);

  // timingSafeEqual requires equal lengths. Copy any supplied bytes into a
  // fixed-size buffer so even malformed-length signatures take the same
  // constant-time comparison path as well-formed signatures.
  const fixedSizeSupplied = Buffer.alloc(TOKEN_MAC_BYTES);
  supplied.copy(
    fixedSizeSupplied,
    0,
    0,
    Math.min(supplied.length, TOKEN_MAC_BYTES),
  );
  const signaturesMatch = timingSafeEqual(fixedSizeSupplied, expected);

  return (
    matched !== null &&
    supplied.length === TOKEN_MAC_BYTES &&
    signaturesMatch
  );
}

/**
 * Stable, non-secret fingerprint used inside the signed binding. This helper is
 * exported so API integration and cache diagnostics can use exactly the same
 * node-content identity without duplicating canonicalization rules.
 */
export function fingerprintExplanationNodeContent(
  node: ExplanationContextNode,
): string {
  const canonicalNode = canonicalizeNode(node);
  return createHash("sha256")
    .update(NODE_FINGERPRINT_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(canonicalNode, "utf8")
    .digest("base64url");
}

function canonicalizeBinding(binding: ExplanationContextBinding): string {
  if (typeof binding !== "object" || binding === null) {
    throw new Error("解释上下文必须是对象");
  }
  const documentId = nonEmptyString(binding.documentId, "documentId");
  const node = canonicalNodeValue(binding.node);
  const explanation = canonicalExplanationValue(binding.explanation);

  if (explanation.nodeId !== node.id) {
    throw new Error("解释必须属于签名上下文中的节点");
  }

  return JSON.stringify([
    CONTEXT_DOMAIN,
    documentId,
    node.id,
    fingerprintExplanationNodeContent(node),
    explanation.value,
  ]);
}

function canonicalizeNode(node: ExplanationContextNode): string {
  return JSON.stringify(canonicalNodeValue(node));
}

function canonicalNodeValue(node: ExplanationContextNode) {
  if (typeof node !== "object" || node === null) {
    throw new Error("node 必须是对象");
  }
  return {
    id: nonEmptyString(node.id, "node.id"),
    title: nonEmptyString(node.title, "node.title"),
    eyebrow: stringValue(node.eyebrow, "node.eyebrow"),
    summary: nonEmptyString(node.summary, "node.summary"),
    detail: nonEmptyString(node.detail, "node.detail"),
    terms: stringArray(node.terms, "node.terms"),
  };
}

function canonicalExplanationValue(
  value: TermExplanation | DeepExplanation,
): {
  nodeId: string;
  value: readonly unknown[];
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("解释结果必须是对象");
  }

  if (value.protocol === "visual-term-explanation/2") {
    const explanation = parseTermExplanation(value);
    return {
      nodeId: explanation.nodeId,
      value: [
        "term",
        explanation.protocol,
        explanation.nodeId,
        explanation.term,
        explanation.termPath,
        explanation.definition,
        explanation.relevance,
        explanation.terms,
        explanation.confidence,
        explanation.sourceStatus,
      ],
    };
  }

  if (value.protocol === "visual-deep-explanation/1") {
    const explanation = parseDeepExplanationResult(value);
    return {
      nodeId: explanation.nodeId,
      value: [
        "deep",
        explanation.protocol,
        explanation.nodeId,
        explanation.subject,
        explanation.directAnswer,
        explanation.background,
        explanation.role,
        explanation.mechanism,
        explanation.boundary,
        explanation.terms,
        explanation.confidence,
        explanation.sourceStatus,
      ],
    };
  }

  throw new Error("不支持的解释协议");
}

function signCanonicalContext(canonicalContext: string): Buffer {
  return createHmac("sha256", resolveSigningSecret())
    .update(canonicalContext, "utf8")
    .digest();
}

function resolveSigningSecret(): Buffer {
  const configured = process.env[EXPLANATION_CONTEXT_TOKEN_SECRET_ENV]?.trim();
  if (configured) {
    const secret = Buffer.from(configured, "utf8");
    if (secret.length < MINIMUM_SECRET_BYTES) {
      throw new Error(
        `${EXPLANATION_CONTEXT_TOKEN_SECRET_ENV} 必须至少包含 ${MINIMUM_SECRET_BYTES} 字节`,
      );
    }
    return secret;
  }

  const runtime = process.env.NODE_ENV?.trim().toLowerCase();
  if (runtime !== "development" && runtime !== "test") {
    throw new Error(
      `生产环境必须配置 ${EXPLANATION_CONTEXT_TOKEN_SECRET_ENV}`,
    );
  }

  developmentFallbackSecret ??= randomBytes(TOKEN_MAC_BYTES);
  return developmentFallbackSecret;
}

function decodeSignature(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return Buffer.alloc(0);
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return Buffer.alloc(0);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  const normalized = stringValue(value, path).trim();
  if (!normalized) throw new Error(`${path} 不能为空`);
  return normalized;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} 必须是字符串`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
  return value.map((item, index) =>
    nonEmptyString(item, `${path}[${index}]`),
  );
}

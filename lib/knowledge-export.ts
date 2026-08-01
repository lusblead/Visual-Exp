import {
  parseDeepExplanationResult,
  type DeepExplanation,
} from "./deep-explanation";
import {
  parseTermExplanation,
  type TermExplanation,
} from "./term-explanation";
import { parseVisualDocument } from "./visual-contract-parse";
import type {
  PrimaryMaterial,
  VisualDocument,
  VisualNode,
  VisualRelation,
} from "./visual-contract-types";

export const KNOWLEDGE_EXPORT_PROTOCOL = "visual-knowledge-export/1" as const;

const MAX_HISTORY_ENTRIES = 60;
const MAX_TERM_EXPLANATIONS = 48;
const MAX_DEEP_EXPLANATIONS = 32;

export interface KnowledgeExportNavigation {
  entries: string[];
  cursor: number;
}

export interface KnowledgeExportExplanations {
  terms: TermExplanation[];
  deep: DeepExplanation[];
}

export interface KnowledgeExportDocument {
  protocol: typeof KNOWLEDGE_EXPORT_PROTOCOL;
  document: VisualDocument;
  navigation: KnowledgeExportNavigation;
  explanations: KnowledgeExportExplanations;
}

export interface CreateKnowledgeExportInput {
  document: unknown;
  navigation: unknown;
  /**
   * Callers may pass a validated explanation directly or a persisted/runtime
   * wrapper that exposes it through `explanation` or `value.explanation`.
   * Every other wrapper field is deliberately ignored.
   */
  termExplanations?: readonly unknown[];
  deepExplanations?: readonly unknown[];
}

export type KnowledgeExportFormat = "json" | "markdown";

export interface KnowledgeExportArtifact {
  filename: string;
  mediaType: "application/json" | "text/markdown";
  content: string;
}

/**
 * Project accepted local knowledge into a portable, runtime-free contract.
 *
 * There is intentionally no spread from the input: credentials, opaque
 * context tokens, usage receipts, cache IDs and live task fields therefore
 * have no path into the result.
 */
export function createKnowledgeExport(
  input: CreateKnowledgeExportInput,
): KnowledgeExportDocument {
  assertRecord(input, "input");
  const document = parseVisualDocument(input.document);
  const navigation = parseExportNavigation(input.navigation, document);
  const nodeOrder = orderedNodeIds(document);
  const terms = parseCompletedExplanations(
    input.termExplanations,
    document,
    parseTermExplanation,
    termSortKey,
    "termExplanations",
    nodeOrder,
    MAX_TERM_EXPLANATIONS,
  );
  const deep = parseCompletedExplanations(
    input.deepExplanations,
    document,
    parseDeepExplanationResult,
    deepSortKey,
    "deepExplanations",
    nodeOrder,
    MAX_DEEP_EXPLANATIONS,
  );

  return {
    protocol: KNOWLEDGE_EXPORT_PROTOCOL,
    document,
    navigation,
    explanations: { terms, deep },
  };
}

export function serializeKnowledgeExport(
  value: KnowledgeExportDocument,
): string {
  const canonical = canonicalKnowledgeExport(value);
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/**
 * Render a deterministic reading document from canonical childIds. The
 * projection never depends on the current viewport, card visibility or cache
 * insertion order.
 */
export function renderKnowledgeExportMarkdown(
  value: KnowledgeExportDocument,
): string {
  const canonical = canonicalKnowledgeExport(value);
  const { document } = canonical;
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const termsByNode = groupByNode(canonical.explanations.terms);
  const deepByNode = groupByNode(canonical.explanations.deep);
  const lines: string[] = [
    `# ${escapeInline(document.title)}`,
    "",
    `**问题：** ${escapeProse(document.question)}`,
    "",
    `> ${escapeProse(document.thesis).replace(/\n/gu, "\n> ")}`,
    "",
  ];

  if (document.primaryMaterial) {
    appendPrimaryMaterial(lines, document.primaryMaterial);
  }

  const root = nodeById.get(document.rootId);
  if (!root) throw new Error("export.document.rootId 指向的节点不存在");
  appendNode(
    lines,
    root,
    [],
    document,
    nodeById,
    termsByNode,
    deepByNode,
  );

  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

export function createKnowledgeExportArtifact(
  input: CreateKnowledgeExportInput,
  format: KnowledgeExportFormat,
): KnowledgeExportArtifact {
  const value = createKnowledgeExport(input);
  if (format === "json") {
    return {
      filename: safeKnowledgeExportFilename(value.document.title, "json"),
      mediaType: "application/json",
      content: serializeKnowledgeExport(value),
    };
  }
  if (format === "markdown") {
    return {
      filename: safeKnowledgeExportFilename(value.document.title, "markdown"),
      mediaType: "text/markdown",
      content: renderKnowledgeExportMarkdown(value),
    };
  }
  throw new Error("format 必须是 json 或 markdown");
}

export function safeKnowledgeExportFilename(
  title: string,
  format: KnowledgeExportFormat,
): string {
  if (typeof title !== "string") throw new Error("title 必须是字符串");
  if (format !== "json" && format !== "markdown") {
    throw new Error("format 必须是 json 或 markdown");
  }

  let basename = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, " ")
    .replace(/\s+/gu, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/gu, "")
    .slice(0, 72)
    .replace(/[.\-\s]+$/gu, "");
  if (!basename) basename = "knowledge";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(basename)) {
    basename = `knowledge-${basename}`;
  }
  return `${basename}.${format === "json" ? "json" : "md"}`;
}

function parseExportNavigation(
  value: unknown,
  document: VisualDocument,
): KnowledgeExportNavigation {
  const navigation = assertRecord(value, "navigation");
  if (!Array.isArray(navigation.entries)) {
    throw new Error("navigation.entries 必须是数组");
  }
  if (
    navigation.entries.length < 1 ||
    navigation.entries.length > MAX_HISTORY_ENTRIES
  ) {
    throw new Error(
      `navigation.entries 必须包含 1 到 ${MAX_HISTORY_ENTRIES} 个节点`,
    );
  }
  const knownNodes = new Set(document.nodes.map((node) => node.id));
  const entries = navigation.entries.map((entry, index) => {
    if (typeof entry !== "string" || !knownNodes.has(entry)) {
      throw new Error(`navigation.entries[${index}] 指向的节点不存在`);
    }
    return entry;
  });
  if (
    !Number.isSafeInteger(navigation.cursor) ||
    (navigation.cursor as number) < 0 ||
    (navigation.cursor as number) >= entries.length
  ) {
    throw new Error("navigation.cursor 超出历史范围");
  }
  return { entries, cursor: navigation.cursor as number };
}

function parseCompletedExplanations<T extends { nodeId: string }>(
  values: readonly unknown[] | undefined,
  document: VisualDocument,
  parser: (value: unknown) => T,
  sortKey: (value: T) => string,
  label: string,
  nodeOrder: Map<string, number>,
  maximumItems: number,
): T[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error(`${label} 必须是数组`);
  if (values.length > maximumItems) {
    throw new Error(`${label} 不能超过 ${maximumItems} 项`);
  }
  const knownNodes = new Set(document.nodes.map((node) => node.id));
  const parsed = values.map((candidate, index) => {
    const result = parser(unwrapExplanation(candidate, `${label}[${index}]`));
    if (!knownNodes.has(result.nodeId)) {
      throw new Error(`${label}[${index}] 指向的节点不存在`);
    }
    return result;
  });

  parsed.sort((left, right) => {
    const nodeDifference =
      (nodeOrder.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) -
      (nodeOrder.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER);
    if (nodeDifference) return nodeDifference;
    const leftKey = sortKey(left);
    const rightKey = sortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  const seen = new Set<string>();
  return parsed.filter((value) => {
    const identity = JSON.stringify(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function unwrapExplanation(value: unknown, path: string): unknown {
  const candidate = assertRecord(value, path);
  if (typeof candidate.protocol === "string") return candidate;
  assertCompletedStatus(candidate.status, `${path}.status`);
  if (candidate.explanation !== undefined) return candidate.explanation;
  if (candidate.value !== undefined) {
    const nested = assertRecord(candidate.value, `${path}.value`);
    assertCompletedStatus(nested.status, `${path}.value.status`);
    if (nested.explanation !== undefined) return nested.explanation;
  }
  if (candidate.state !== undefined) {
    const nested = assertRecord(candidate.state, `${path}.state`);
    assertCompletedStatus(nested.status, `${path}.state.status`);
    if (nested.explanation !== undefined) return nested.explanation;
  }
  throw new Error(`${path} 不包含已完成解释`);
}

function assertCompletedStatus(value: unknown, path: string): void {
  if (
    value !== undefined &&
    value !== "ready" &&
    value !== "success"
  ) {
    throw new Error(`${path} 不是已完成状态`);
  }
}

function canonicalKnowledgeExport(
  value: KnowledgeExportDocument,
): KnowledgeExportDocument {
  const candidate = assertRecord(value, "export");
  if (candidate.protocol !== KNOWLEDGE_EXPORT_PROTOCOL) {
    throw new Error(`export.protocol 必须是 ${KNOWLEDGE_EXPORT_PROTOCOL}`);
  }
  const explanations = assertRecord(
    candidate.explanations,
    "export.explanations",
  );
  if (!Array.isArray(explanations.terms)) {
    throw new Error("export.explanations.terms 必须是数组");
  }
  if (!Array.isArray(explanations.deep)) {
    throw new Error("export.explanations.deep 必须是数组");
  }
  return createKnowledgeExport({
    document: candidate.document,
    navigation: candidate.navigation,
    termExplanations: explanations.terms,
    deepExplanations: explanations.deep,
  });
}

function orderedNodeIds(document: VisualDocument): Map<string, number> {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const order = new Map<string, number>();

  function visit(nodeId: string): void {
    if (order.has(nodeId)) return;
    const node = nodeById.get(nodeId);
    if (!node) return;
    order.set(nodeId, order.size);
    for (const childId of node.childIds) visit(childId);
  }

  visit(document.rootId);
  return order;
}

function termSortKey(value: TermExplanation): string {
  return [
    value.termPath.join("\u0000"),
    value.definition,
    value.relevance,
  ].join("\u0001");
}

function deepSortKey(value: DeepExplanation): string {
  return [
    value.subject,
    value.directAnswer,
    value.background,
    value.role,
    value.mechanism,
    value.boundary,
  ].join("\u0001");
}

function groupByNode<T extends { nodeId: string }>(
  values: readonly T[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const current = result.get(value.nodeId) ?? [];
    current.push(value);
    result.set(value.nodeId, current);
  }
  return result;
}

function appendPrimaryMaterial(
  lines: string[],
  material: PrimaryMaterial,
): void {
  lines.push("## 原始材料", "", `### ${escapeInline(material.title)}`, "");
  if (material.creator) {
    lines.push(`**作者：** ${escapeProse(material.creator)}`, "");
  }
  if (material.body) {
    lines.push(
      ...escapeProse(material.body)
        .split("\n")
        .map((line) => `> ${line}`),
      "",
    );
  }
  if (material.omissionReason) {
    lines.push(`> ${escapeProse(material.omissionReason)}`, "");
  }
  lines.push(`来源说明：${escapeProse(material.attribution)}`);
  const sourceUrl = safeWebUrl(material.sourceUrl);
  if (sourceUrl) lines.push(`来源链接：<${sourceUrl}>`);
  lines.push("");
}

function appendNode(
  lines: string[],
  node: VisualNode,
  path: number[],
  document: VisualDocument,
  nodeById: Map<string, VisualNode>,
  termsByNode: Map<string, TermExplanation[]>,
  deepByNode: Map<string, DeepExplanation[]>,
): void {
  const headingLevel = Math.min(2 + node.depth, 6);
  const sectionNumber = path.length > 0 ? `${path.join(".")} ` : "";
  lines.push(
    `${"#".repeat(headingLevel)} ${sectionNumber}${escapeInline(node.title)}`,
    "",
    `**核心结论：** ${escapeProse(node.summary)}`,
    "",
  );
  appendParagraphs(lines, node.detail);

  if (node.evidence.length > 0) {
    lines.push("**证据与来源**", "");
    for (const evidence of node.evidence) {
      const url = safeWebUrl(evidence.url);
      const label = escapeInline(evidence.label);
      lines.push(
        `- ${url ? `[${label}](${url})` : label}：${escapeProse(evidence.detail)}`,
      );
    }
    lines.push("");
  }

  const scopedRelations = document.relations.filter(
    (relation) => relation.scopeId === node.id,
  );
  if (scopedRelations.length > 0) {
    appendRelations(lines, scopedRelations, nodeById);
  }

  const termExplanations = termsByNode.get(node.id) ?? [];
  if (termExplanations.length > 0) {
    lines.push("**名词解释**", "");
    for (const explanation of termExplanations) {
      lines.push(
        `- **${escapeInline(explanation.termPath.join(" → "))}**：${escapeProse(explanation.definition)}`,
        `  - 在这里：${escapeProse(explanation.relevance)}`,
      );
    }
    lines.push("");
  }

  const deepExplanations = deepByNode.get(node.id) ?? [];
  if (deepExplanations.length > 0) {
    lines.push("**深入解释**", "");
    for (const explanation of deepExplanations) {
      lines.push(
        `- **${escapeInline(explanation.subject)}**`,
        `  - 直接理解：${escapeProse(explanation.directAnswer)}`,
        `  - 背景：${escapeProse(explanation.background)}`,
        `  - 作用：${escapeProse(explanation.role)}`,
        `  - 机制：${escapeProse(explanation.mechanism)}`,
        `  - 边界：${escapeProse(explanation.boundary)}`,
      );
    }
    lines.push("");
  }

  node.childIds.forEach((childId, index) => {
    const child = nodeById.get(childId);
    if (!child) throw new Error(`节点 ${node.id} 的子节点不存在：${childId}`);
    appendNode(
      lines,
      child,
      [...path, index + 1],
      document,
      nodeById,
      termsByNode,
      deepByNode,
    );
  });
}

function appendParagraphs(lines: string[], value: string): void {
  const paragraphs = value
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) {
    lines.push(escapeProse(paragraph), "");
  }
}

function appendRelations(
  lines: string[],
  relations: VisualRelation[],
  nodeById: Map<string, VisualNode>,
): void {
  lines.push("**关系**", "");
  for (const relation of relations) {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to) continue;
    const relationText = relation.label || relation.kind;
    lines.push(
      `- ${escapeInline(from.title)} —${escapeInline(relationText)}→ ${escapeInline(to.title)}`,
    );
  }
  lines.push("");
}

function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function escapeInline(value: string): string {
  return escapeProse(value)
    .replace(/[\r\n]+/gu, " ")
    .replace(/([\\`*_[\]#])/gu, "\\$1");
}

function escapeProse(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

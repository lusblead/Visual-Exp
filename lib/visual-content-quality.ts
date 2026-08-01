import type {
  VisualDocument,
  VisualNode,
  VisualOperationBatch,
} from "./visual-contract-types";
import { containsAnnotatedTerm } from "./annotated-term-match.mjs";

export const VISUAL_CONTENT_LIMITS = {
  summary: { min: 8, max: 220 },
  detail: { min: 24, max: 800 },
  terms: { maxItems: 8, minLength: 1, maxLength: 40 },
} as const;

const NAVIGATION_FILLER =
  /点击(?:这里|任意(?:节点|内容)|节点|术语)|继续进入后|进入后.{0,12}(查看|展开)|返回上层|下一层内容|语义入口|本层已经拆成|恢复整体位置/iu;

export type MathMode = "avoid" | "optional" | "requested";

const MATH_AVOIDANCE =
  /不(?:要|用|需要|必需|涉及|展示|显示|写|给|讲)(?:使用|用|加入|给出|给我)?(?:任何|具体)?(?:数学(?:内容|符号)?|LaTeX\s*|公式|方程)|不想(?:看|要|用|涉及)?(?:任何|具体)?(?:数学(?:内容|符号)?|LaTeX\s*|公式|方程)|不讲数学|无需(?:任何|具体)?(?:数学(?:内容|符号)?|LaTeX\s*|公式|方程)|避免(?:使用|出现|展示)?(?:数学(?:内容|符号)?|LaTeX\s*|公式|方程)|只(?:要|用|使用)(?:(?:通俗|自然|日常)(?:语言|文字)|纯?文字)(?:解释|说明)?|(?:no(?:\s+need\s+for)?|without|avoid)\s+(?:using\s+)?(?:any\s+)?(?:math(?:ematics)?|formulas?|equations?)|plain\s+language\s+only/iu;

const MATH_REQUEST =
  /公式|数学|推导|证明|方程|矩阵(?:运算|计算)|计算过程|复杂度|定理|等式|不等式|微分|积分|equation|formula|deriv(?:e|ation)|proof|mathemat|complexity/iu;

const MATHEMATICAL_NOTATION_PATTERNS = [
  /\$\$[\s\S]{1,500}?\$\$/gu,
  /\$[^$\r\n]{1,240}\$/gu,
  /\\\([^\r\n]{1,240}\\\)/gu,
  /\\\[[\s\S]{1,500}?\\\]/gu,
  /\\(?:frac|dfrac|tfrac|sum|prod|sqrt|cdot|times|begin|end|left|right|mathbf|mathrm)\b[^\r\n，。；;！？!?]{0,160}/gu,
  /\b[A-Za-z][A-Za-z0-9_]{0,20}\([^()\r\n]{0,100}\)\s*=\s*[^=\r\n，。；;！？!?]{1,160}/gu,
  /\bO\([^\r\n)]{1,80}\)/gu,
  /\b[A-Za-z][A-Za-z0-9_]{0,20}\s*=\s*[^=\r\n，。；;！？!?]{1,120}/gu,
] as const;

/**
 * JavaScript has no native Unicode case-fold operation. NFKC plus lower-case,
 * sharp-s expansion and final-sigma folding covers the compatibility and case
 * variants that matter for protocol identity without introducing a dependency.
 */
export function normalizeTermIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/\u00df/gu, "ss")
    .replace(/\u03c2/gu, "\u03c3")
    .trim();
}

export function assertVisualNodeTerms(node: Pick<VisualNode, "title" | "summary" | "detail" | "terms">): void {
  if (!Array.isArray(node.terms)) {
    throw new Error("node.terms 必须是数组");
  }
  if (node.terms.length > VISUAL_CONTENT_LIMITS.terms.maxItems) {
    throw new Error(`node.terms 不能超过 ${VISUAL_CONTENT_LIMITS.terms.maxItems} 个`);
  }

  const identities = new Set<string>();
  const content = `${node.title} ${node.summary} ${node.detail}`;
  for (const term of node.terms) {
    if (typeof term !== "string") {
      throw new Error("node.terms 只能包含字符串");
    }
    const trimmed = term.trim();
    const length = characterCount(trimmed);
    if (
      length < VISUAL_CONTENT_LIMITS.terms.minLength ||
      length > VISUAL_CONTENT_LIMITS.terms.maxLength
    ) {
      throw new Error(
        `术语长度必须为 ${VISUAL_CONTENT_LIMITS.terms.minLength} 到 ${VISUAL_CONTENT_LIMITS.terms.maxLength} 个字符`,
      );
    }
    if (/[\r\n\u2028\u2029]/u.test(term)) {
      throw new Error(`术语“${trimmed}”必须保持单行`);
    }

    const identity = normalizeTermIdentity(trimmed);
    if (identities.has(identity)) {
      throw new Error(`node.terms 包含规范化后重复的术语：${trimmed}`);
    }
    identities.add(identity);

    if (!containsAnnotatedTerm(content, trimmed)) {
      throw new Error(`术语“${trimmed}”没有实际出现在节点正文中`);
    }
  }
}

export function assertVisualNodeContentQuality(node: VisualNode): void {
  assertBoundedContent(node.summary, "summary", VISUAL_CONTENT_LIMITS.summary);
  assertBoundedContent(node.detail, "detail", VISUAL_CONTENT_LIMITS.detail);

  if (normalizeComparable(node.summary) === normalizeComparable(node.detail)) {
    throw new Error(`节点 ${node.id} 的 summary 与 detail 不能重复`);
  }
  if (NAVIGATION_FILLER.test(node.summary) || NAVIGATION_FILLER.test(node.detail)) {
    throw new Error(`节点 ${node.id} 包含导航填充语句，必须改为知识内容`);
  }

  assertVisualNodeTerms(node);
}

export function assertVisualDocumentContentQuality(document: VisualDocument): void {
  for (const node of document.nodes) {
    assertVisualNodeContentQuality(node);
  }
  assertTextMatchesMathPreference(
    document.question,
    document.nodes
      .map((node) => `${node.title}\n${node.summary}\n${node.detail}`)
      .join("\n"),
  );
}

/**
 * Expansion has one semantic responsibility: enrich the selected scene and add
 * its direct children. The guard rejects structurally valid but content-thin
 * batches before they can be applied to the authoritative document.
 */
export function assertVisualExpansionContentQuality(
  document: VisualDocument,
  nodeId: string,
  batch: VisualOperationBatch,
): void {
  const parent = document.nodes.find((node) => node.id === nodeId);
  if (!parent) throw new Error("待展开节点不存在");

  const updates = batch.operations.filter(
    (operation) => operation.kind === "update_node",
  );
  if (updates.length !== 1) {
    throw new Error("每次展开必须恰好包含一个 update_node");
  }

  const update = updates[0];
  if (update.nodeId !== nodeId || !update.patch) {
    throw new Error("展开时只能更新当前节点");
  }
  const patch = update.patch;
  if (patch.detail === null || patch.view === null || patch.terms === null) {
    throw new Error("展开必须更新当前节点的 detail、view 与 terms");
  }
  if (
    patch.title !== null ||
    patch.eyebrow !== null ||
    patch.summary !== null ||
    patch.expandable !== null ||
    patch.expansionState !== null ||
    patch.emphasis !== null
  ) {
    throw new Error("展开的 update_node 只能修改 detail、view 与 terms");
  }
  if (normalizeComparable(patch.detail) === normalizeComparable(parent.detail)) {
    throw new Error("展开后的 detail 必须补充新的实质内容");
  }

  assertVisualNodeContentQuality({
    ...parent,
    detail: patch.detail,
    view: patch.view,
    terms: patch.terms,
  });

  const generatedText = [patch.detail];
  for (const operation of batch.operations) {
    if (operation.kind === "add_node" && operation.node) {
      assertVisualNodeContentQuality(operation.node);
      generatedText.push(
        `${operation.node.title}\n${operation.node.summary}\n${operation.node.detail}`,
      );
    }
  }
  assertTextMatchesMathPreference(document.question, generatedText.join("\n"));
}

/**
 * Mathematical notation follows a three-state preference. Explicit opt-out is
 * strict, explicit requests are unrestricted by this guard, and the default
 * allows one compact formula only when it is immediately translated into
 * ordinary language. Technical prose such as "Q、K、V" remains valid.
 */
export function assertTextMatchesMathPreference(
  question: string,
  text: string,
): void {
  const mode = resolveMathMode(question);
  if (mode === "requested") return;

  const notation = mathematicalNotationSpans(text);
  if (mode === "avoid" && notation.length > 0) {
    throw new Error("当前问题明确要求避免数学内容，解释中不能加入公式或推导");
  }
  if (mode === "optional" && notation.length > 1) {
    throw new Error("默认数学模式最多允许一个有助理解的小公式");
  }
  if (
    mode === "optional" &&
    notation.length === 1 &&
    !hasImmediatePlainLanguageExplanation(text, notation[0])
  ) {
    throw new Error("默认数学模式中的公式后必须紧跟通俗解释");
  }
}

export function resolveMathMode(question: string): MathMode {
  if (MATH_AVOIDANCE.test(question)) return "avoid";
  if (MATH_REQUEST.test(question) || containsMathematicalNotation(question)) {
    return "requested";
  }
  return "optional";
}

/**
 * Compatibility helper for call sites that still expose a binary permission.
 * It remains true only for an explicit mathematical request; callers that need
 * the default optional behavior must use resolveMathMode.
 */
export function questionRequestsMathematics(question: string): boolean {
  return resolveMathMode(question) === "requested";
}

function assertBoundedContent(
  value: string,
  field: "summary" | "detail",
  limits: { min: number; max: number },
): void {
  const length = characterCount(value.trim());
  if (length < limits.min || length > limits.max) {
    throw new Error(`${field} 必须为 ${limits.min} 到 ${limits.max} 个字符`);
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeComparable(value: string): string {
  return normalizeTermIdentity(value).replace(/\s+/gu, "");
}

function containsMathematicalNotation(value: string): boolean {
  return mathematicalNotationSpans(value).length > 0;
}

interface TextSpan {
  start: number;
  end: number;
}

function mathematicalNotationSpans(value: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const pattern of MATHEMATICAL_NOTATION_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      if (match.index === undefined || match[0].length === 0) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  spans.sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: TextSpan[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function hasImmediatePlainLanguageExplanation(
  text: string,
  notation: TextSpan,
): boolean {
  const following = text
    .slice(notation.end, notation.end + 180)
    .replace(/^[\s，,。；;：:—-]+/u, "");
  const explanationCue =
    /^(?:也就是|表示|意思是|意味着|其中|这里|换句话说|直观地说|直观来说|用通俗的话说|这个公式|这个式子|即|this means|which means|where\b|in plain (?:terms|language)|it (?:means|represents))/iu;
  if (!explanationCue.test(following)) return false;

  const plainWindow = following.slice(0, 120);
  const cjkCharacters = plainWindow.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const latinWords = plainWindow.match(/\b[\p{L}]{2,}\b/gu)?.length ?? 0;
  return cjkCharacters >= 6 || latinWords >= 6;
}

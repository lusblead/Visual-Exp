import {
  applyVisualOperations,
  parseVisualDocument,
  type VisualDocument,
} from "../../../lib/lineage-contracts";
import {
  resolveVisualModel,
  type ModelUsageEvent,
} from "../../../lib/model-port";
import {
  createDeepExplanation,
  parseDeepExplanationResult,
  parseDeepExplanationRequest,
  type DeepExplanation,
  type DeepExplanationContext,
} from "../../../lib/deep-explanation";
import {
  issueExplanationContextToken,
  verifyExplanationContextToken,
} from "../../../lib/explanation-context-token";
import {
  createTermExplanation,
  MAX_TERM_BATCH_SIZE,
  MAX_TERM_EXPLANATION_DEPTH,
  parseTermExplanation,
  type TermExplanation,
  type TermDefinitionContext,
} from "../../../lib/term-explanation";
import { ModelProviderError } from "../../../lib/provider-errors";
import {
  deviceOwnerCookie,
  resolveDeviceOwner,
  type DeviceOwner,
} from "../../../lib/server-owner";
import {
  searchVisualEvidence,
  ServerWebSearchError,
} from "../../../lib/server-web-search";
import {
  normalizeTermIdentity,
  questionRequestsMathematics,
} from "../../../lib/visual-content-quality";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

class RequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    code = "invalid_request",
    status = 400,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function POST(request: Request): Promise<Response> {
  let responseOwner: DeviceOwner | null = null;
  try {
    assertTrustedMutation(request);
    const body = await readBody(request);
    const action = requiredString(body.action, "action");
    const resolved = resolveVisualModel();
    const usage: ModelUsageEvent[] = [];
    const context = {
      safetyIdentifier: safetyIdentifier(body.sessionId),
      signal: request.signal,
      onUsage: (event: ModelUsageEvent) => usage.push(event),
    };

    if (action === "create") {
      const question = requiredString(body.question, "question", 1200);
      const searchMode = createSearchMode(body.searchMode);
      if (searchMode === "on" && resolved.provider === "demo") {
        throw new ModelProviderError(
          "credential_required",
          "开启联网生成前，请先配置可用的 AI 模型。",
          409,
          false,
        );
      }
      const owner =
        searchMode === "on"
          ? resolveDeviceOwner(request.headers.get("cookie"))
          : null;
      responseOwner = owner;
      const searchEvidence = owner
        ? await searchVisualEvidence({
            query: question,
            ownerId: owner.id,
            signal: request.signal,
          })
        : [];
      if (owner && searchEvidence.length === 0) {
        throw new ServerWebSearchError(
          "search_no_results",
          "联网搜索没有找到可用来源，请调整问题或关闭联网后重试。",
          422,
          false,
        );
      }
      const document = await resolved.model.create(question, {
        ...context,
        searchEvidence,
      });
      return json(
        {
          document,
          provider: resolved.provider,
          model: resolved.modelName,
          fallbackReason: resolved.fallbackReason,
          focusNodeId: document.rootId,
          usage,
          search: {
            mode: searchMode,
            status: searchMode === "on" ? "used" : "disabled",
            callCount: searchMode === "on" ? 1 : 0,
            sourceCount: searchEvidence.length,
          },
        },
        200,
        owner,
        request,
      );
    }

    if (action === "expand") {
      const document = parseRequestDocument(body.document);
      const nodeId = requiredString(body.nodeId, "nodeId", 180);
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new RequestError("nodeId 不在当前解释空间中");
      if (node.childIds.length > 0) {
        return json(
          {
            document,
            operations: null,
            provider: resolved.provider,
            model: resolved.modelName,
            fallbackReason: resolved.fallbackReason,
            focusNodeId: nodeId,
            usage,
          },
          200,
        );
      }
      if (!node.expandable || node.expansionState === "terminal") {
        throw new RequestError("当前节点已经到达可阅读细节，不能继续自动展开");
      }

      const operations = await resolved.model.expand(document, nodeId, context);
      const nextDocument = applyVisualOperations(document, operations);
      return json(
        {
          document: nextDocument,
          operations,
          provider: resolved.provider,
          model: resolved.modelName,
          fallbackReason: resolved.fallbackReason,
          focusNodeId: nodeId,
          usage,
        },
        200,
      );
    }

    if (action === "define") {
      const document = parseRequestDocument(body.document);
      const nodeId = requiredString(body.nodeId, "nodeId", 180);
      const term = requiredString(body.term, "term", 40);
      if (/[\r\n]/.test(term)) throw new RequestError("term 必须是单行短语");
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new RequestError("nodeId 不在当前解释空间中");
      const parentExplanation = parseOptionalParentExplanation(
        body.parentExplanation,
        body.parentDeepExplanation,
        body.parentContextToken,
        document,
        node,
      );
      const input = createDefinitionContext(
        document,
        node,
        term,
        parentExplanation,
      );
      const draft = await resolved.model.defineTerm(input, context);
      const explanation = createTermExplanation(
        input,
        node.id,
        node.confidence,
        safeGeneratedSourceStatus(node.sourceStatus),
        draft,
      );
      return json(
        {
          explanation,
          contextToken: issueExplanationContextToken({
            documentId: document.id,
            node,
            explanation,
          }),
          provider: resolved.provider,
          model: resolved.termModelName,
          fallbackReason: resolved.fallbackReason,
          usage,
        },
        200,
      );
    }

    if (action === "define_batch") {
      const document = parseRequestDocument(body.document);
      const nodeId = requiredString(body.nodeId, "nodeId", 180);
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new RequestError("nodeId 不在当前解释空间中");
      if (!Array.isArray(body.terms)) {
        throw new RequestError("terms 必须是数组");
      }
      if (body.terms.length < 1 || body.terms.length > MAX_TERM_BATCH_SIZE) {
        throw new RequestError(
          `terms 必须包含 1 到 ${MAX_TERM_BATCH_SIZE} 个当前节点名词`,
        );
      }
      const identities = new Set<string>();
      const inputs = body.terms.map((value, index) => {
        const term = requiredString(value, `terms[${index}]`, 40);
        if (/[\r\n]/.test(term)) throw new RequestError(`terms[${index}] 必须是单行短语`);
        const identity = normalizeTermIdentity(term);
        if (identities.has(identity)) {
          throw new RequestError(`terms 包含重复名词：${term}`);
        }
        identities.add(identity);
        return createDefinitionContext(document, node, term, null);
      });
      const drafts = await resolved.model.defineTerms(inputs, context);
      if (drafts.length !== inputs.length) {
        throw new Error("批量名词解释与请求项数量不一致");
      }
      const explanations = drafts.map((draft, index) =>
        createTermExplanation(
          inputs[index],
          node.id,
          node.confidence,
          safeGeneratedSourceStatus(node.sourceStatus),
          draft,
        ),
      );
      const contextTokens = explanations.map((explanation) =>
        issueExplanationContextToken({
          documentId: document.id,
          node,
          explanation,
        }),
      );
      return json(
        {
          explanations,
          contextTokens,
          provider: resolved.provider,
          model: resolved.termModelName,
          fallbackReason: resolved.fallbackReason,
          usage,
        },
        200,
      );
    }

    if (action === "dive") {
      const document = parseRequestDocument(body.document);
      const diveRequest = parseDiveRequest({
        nodeId: body.nodeId,
        selection: body.selection,
        parentExplanation: body.parentExplanation,
        parentDeepExplanation: body.parentDeepExplanation,
      });
      const node = document.nodes.find(
        (candidate) => candidate.id === diveRequest.nodeId,
      );
      if (!node) throw new RequestError("nodeId 不在当前解释空间中");
      const parentExplanation =
        diveRequest.parentExplanation ?? diveRequest.parentDeepExplanation;
      assertTrustedParentContext(
        body.parentContextToken,
        document,
        node,
        parentExplanation,
      );
      const trustedFields = parentExplanation
        ? trustedExplanationFields(parentExplanation)
        : [node.title, node.summary, node.detail];
      if (!trustedFields.some((field) => containsNormalizedSelection(field, diveRequest.selection))) {
        throw new RequestError("selection 必须逐字来自当前节点或已验证的名词解释");
      }
      const input: DeepExplanationContext = {
        subject: diveRequest.selection,
        question: document.question,
        path: buildNodePath(document, node),
        scene: {
          title: node.title,
          summary: node.summary,
          detail: node.detail,
        },
        allowMath: questionRequestsMathematics(
          `${document.question} ${diveRequest.selection}`,
        ),
        parentExplanation: diveRequest.parentExplanation ?? undefined,
        parentDeepExplanation:
          diveRequest.parentDeepExplanation ?? undefined,
      };
      const draft = await resolved.model.deepDive(input, context);
      const explanation = createDeepExplanation(
        input,
        node.id,
        node.confidence,
        safeGeneratedSourceStatus(node.sourceStatus),
        draft,
      );
      return json(
        {
          explanation,
          contextToken: issueExplanationContextToken({
            documentId: document.id,
            node,
            explanation,
          }),
          provider: resolved.provider,
          model: resolved.deepModelName,
          fallbackReason: resolved.fallbackReason,
          usage,
        },
        200,
      );
    }

    throw new RequestError(
      "action 仅支持 create、expand、define、define_batch 或 dive",
    );
  } catch (error) {
    if (error instanceof RequestError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }

    if (error instanceof ModelProviderError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
        responseOwner,
        request,
      );
    }

    if (error instanceof ServerWebSearchError) {
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
        },
        error.status,
        responseOwner,
        request,
      );
    }

    console.error("visual explanation generation failed", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return json(
      {
        error: {
          code: "generation_failed",
          message: "视觉解释暂时没有完成，请稍后重试。",
        },
      },
      502,
      responseOwner,
      request,
    );
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const mediaType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new RequestError(
      "请求体必须使用 application/json。",
      "unsupported_media_type",
      415,
    );
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength.trim())) {
      throw new RequestError("Content-Length 无效。");
    }
    if (Number(declaredLength) > MAX_REQUEST_BYTES) {
      throw requestTooLarge();
    }
  }

  const raw = await boundedRequestText(request);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestError("请求体必须是合法 JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestError("请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

function assertTrustedMutation(request: Request): void {
  const fetchSite = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new RequestError(
      "请求来源不受信任。",
      "origin_rejected",
      403,
    );
  }

  const origin = request.headers.get("Origin");
  if (!origin) return;
  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(origin).origin;
  } catch {
    throw new RequestError(
      "请求来源不受信任。",
      "origin_rejected",
      403,
    );
  }
  if (sourceOrigin !== new URL(request.url).origin) {
    throw new RequestError(
      "请求来源不受信任。",
      "origin_rejected",
      403,
    );
  }
}

async function boundedRequestText(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw requestTooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestError("请求体必须是合法 UTF-8 JSON");
  }
}

function requestTooLarge(): RequestError {
  return new RequestError(
    "请求体超过 4 MiB 上限。",
    "request_too_large",
    413,
  );
}

function requiredString(value: unknown, field: string, maxLength = 32): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestError(`${field} 必须是非空字符串`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new RequestError(`${field} 超过 ${maxLength} 个字符`);
  }
  return normalized;
}

function parseRequestDocument(value: unknown): VisualDocument {
  try {
    return parseVisualDocument(value);
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "document 不符合解释协议");
  }
}

function parseOptionalParentExplanation(
  termValue: unknown,
  deepValue: unknown,
  contextToken: unknown,
  document: VisualDocument,
  node: VisualDocument["nodes"][number],
): TermExplanation | DeepExplanation | null {
  if (
    termValue !== undefined &&
    termValue !== null &&
    deepValue !== undefined &&
    deepValue !== null
  ) {
    throw new RequestError(
      "parentExplanation 与 parentDeepExplanation 只能提供一个",
    );
  }
  if (
    (termValue === undefined || termValue === null) &&
    (deepValue === undefined || deepValue === null)
  ) {
    if (contextToken !== undefined && contextToken !== null) {
      throw new RequestError("parentContextToken 缺少对应的父解释");
    }
    return null;
  }
  let explanation: TermExplanation | DeepExplanation;
  try {
    explanation =
      termValue !== undefined && termValue !== null
        ? parseTermExplanation(termValue)
        : parseDeepExplanationResult(deepValue);
  } catch (error) {
    throw new RequestError(
      error instanceof Error ? error.message : "parentExplanation 不符合解释协议",
    );
  }
  assertTrustedParentContext(
    contextToken,
    document,
    node,
    explanation,
  );
  return explanation;
}

function createDefinitionContext(
  document: VisualDocument,
  node: VisualDocument["nodes"][number],
  requestedTerm: string,
  parentExplanation: TermExplanation | DeepExplanation | null,
): TermDefinitionContext {
  const termIdentity = normalizeTermIdentity(requestedTerm);
  const sourceTerms = parentExplanation?.terms ?? node.terms;
  const annotatedTerm = sourceTerms.find(
    (candidate) => normalizeTermIdentity(candidate) === termIdentity,
  );
  if (!annotatedTerm) {
    throw new RequestError(
      parentExplanation
        ? "term 必须是父解释中已标注的可解释名词"
        : "term 必须是当前节点正文中已标注的可解释名词",
    );
  }
  if (parentExplanation) {
    if (
      parentExplanation.protocol === "visual-term-explanation/2" &&
      parentExplanation.termPath.length >= MAX_TERM_EXPLANATION_DEPTH
    ) {
      throw new RequestError(`名词解释最多进入 ${MAX_TERM_EXPLANATION_DEPTH} 层`);
    }
    if (!trustedExplanationFields(parentExplanation).some((field) =>
      containsNormalizedSelection(field, annotatedTerm),
    )) {
      throw new RequestError("term 没有逐字出现在父解释正文中");
    }
  }
  const termParent =
    parentExplanation?.protocol === "visual-term-explanation/2"
      ? parentExplanation
      : null;
  const deepParent =
    parentExplanation?.protocol === "visual-deep-explanation/1"
      ? parentExplanation
      : null;
  return {
    term: annotatedTerm,
    termPath: termParent
      ? [...termParent.termPath, annotatedTerm]
      : deepParent
        ? [deepParent.subject, annotatedTerm]
        : [annotatedTerm],
    question: document.question,
    path: buildNodePath(document, node),
    scene: {
      title: node.title,
      summary: node.summary,
      detail: node.detail,
    },
    parentExplanation: termParent ?? undefined,
    parentDeepExplanation: deepParent ?? undefined,
    nodeId: node.id,
  };
}

function assertTrustedParentContext(
  contextToken: unknown,
  document: VisualDocument,
  node: VisualDocument["nodes"][number],
  explanation: TermExplanation | DeepExplanation | null,
): void {
  if (!explanation) {
    if (contextToken !== undefined && contextToken !== null) {
      throw new RequestError("parentContextToken 缺少对应的父解释");
    }
    return;
  }
  if (explanation.nodeId !== node.id) {
    throw new RequestError("父解释不属于当前节点");
  }
  if (
    !verifyExplanationContextToken(contextToken, {
      documentId: document.id,
      node,
      explanation,
    })
  ) {
    throw new RequestError("父解释上下文无效或已经过期");
  }
}

function trustedExplanationFields(
  explanation: TermExplanation | DeepExplanation,
): string[] {
  return explanation.protocol === "visual-term-explanation/2"
    ? [explanation.term, explanation.definition, explanation.relevance]
    : [
        explanation.subject,
        explanation.directAnswer,
        explanation.background,
        explanation.role,
        explanation.mechanism,
        explanation.boundary,
      ];
}

function buildNodePath(
  document: VisualDocument,
  node: VisualDocument["nodes"][number],
): string[] {
  const nodeById = new Map(
    document.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const path: string[] = [];
  const visited = new Set<string>();
  let cursor: VisualDocument["nodes"][number] | undefined = node;
  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor.title);
    visited.add(cursor.id);
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return path;
}

function parseDiveRequest(value: unknown) {
  try {
    return parseDeepExplanationRequest(value);
  } catch (error) {
    throw new RequestError(
      error instanceof Error ? error.message : "深入解释请求不合法",
    );
  }
}

function containsNormalizedSelection(content: string, selection: string): boolean {
  const normalize = (value: string) =>
    value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("und");
  const haystack = normalize(content);
  const needle = normalize(selection);
  return Boolean(needle) && haystack.includes(needle);
}

function safeGeneratedSourceStatus(
  status: VisualDocument["nodes"][number]["sourceStatus"],
): "model_knowledge" | "needs_source" {
  return status === "needs_source" ? "needs_source" : "model_knowledge";
}

function safetyIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) return undefined;
  return `visual_explanation_${normalized}`;
}

function createSearchMode(value: unknown): "off" | "on" {
  if (value === undefined || value === null || value === "off") return "off";
  if (value === "on") return "on";
  throw new RequestError("searchMode 仅支持 off 或 on");
}

function json(
  value: unknown,
  status: number,
  owner: DeviceOwner | null = null,
  request: Request | null = null,
): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (owner?.created && request) {
    headers.append(
      "Set-Cookie",
      deviceOwnerCookie(
        owner.id,
        new URL(request.url).protocol === "https:",
      ),
    );
  }
  return Response.json(value, {
    status,
    headers,
  });
}

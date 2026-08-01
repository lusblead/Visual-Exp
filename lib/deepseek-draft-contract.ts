import {
  CONFIDENCE_LEVELS,
  EMPHASIS_LEVELS,
  EXPLANATION_VIEWS,
  VISUAL_NODE_KINDS,
  VISUAL_RELATION_KINDS,
  assertVisualNodeTerms,
  booleanValue,
  integer,
  normalizeTermIdentity,
  oneOf,
  parseVisualDocument,
  parseVisualOperationBatch,
  record,
  stringValue,
  type Confidence,
  type Emphasis,
  type ExplanationView,
  type VisualDocument,
  type VisualNode,
  type VisualNodeKind,
  type VisualOperationBatch,
  type VisualRelation,
  type VisualRelationKind,
} from "./lineage-contracts";
import { resolvePrimaryMaterial } from "./primary-material";
import type { VisualSearchEvidence } from "./model-port";

const MODEL_SOURCE_STATUSES = ["model_knowledge", "needs_source"] as const;
const MAX_DOCUMENT_NODES = 80;
const MAX_DOCUMENT_DEPTH = 12;
const MAX_DRAFT_TERM_CANDIDATES = 12;

interface OrientationDraft {
  directAnswer: string;
  background: string;
  role: string;
  mechanism: string;
  boundary: string;
}

interface RootDraft {
  orientation: OrientationDraft;
  terms: string[];
  view: ExplanationView;
  confidence: Confidence;
  sourceStatus: (typeof MODEL_SOURCE_STATUSES)[number];
  evidenceRefs: string[];
}

interface NodeDraft {
  title: string;
  eyebrow: string;
  summary: string;
  whyHere: string;
  detail: string;
  terms: string[];
  kind: VisualNodeKind;
  view: ExplanationView;
  emphasis: Emphasis;
  confidence: Confidence;
  sourceStatus: (typeof MODEL_SOURCE_STATUSES)[number];
  evidenceRefs: string[];
  terminal: boolean;
}

interface RelationDraft {
  fromIndex: number;
  toIndex: number;
  kind: VisualRelationKind;
  label: string;
}

export interface CreateSceneDraft {
  title: string;
  thesis: string;
  root: RootDraft;
  children: NodeDraft[];
  relations: RelationDraft[];
}

export interface ExpansionSceneDraft {
  parent: {
    orientation: OrientationDraft;
    terms: string[];
    view: ExplanationView;
  };
  children: NodeDraft[];
  relations: RelationDraft[];
}

const termsSchema = {
  type: "array",
  maxItems: 8,
  items: { type: "string", minLength: 1, maxLength: 40 },
} as const;

const orientationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    directAnswer: { type: "string", minLength: 8, maxLength: 220 },
    background: { type: "string", minLength: 16, maxLength: 160 },
    role: { type: "string", minLength: 16, maxLength: 160 },
    mechanism: { type: "string", minLength: 24, maxLength: 260 },
    boundary: { type: "string", minLength: 8, maxLength: 140 },
  },
  required: ["directAnswer", "background", "role", "mechanism", "boundary"],
} as const;

const semanticNodeProperties = {
  title: { type: "string", minLength: 2, maxLength: 100 },
  eyebrow: { type: "string", maxLength: 40 },
  summary: { type: "string", minLength: 8, maxLength: 220 },
  whyHere: { type: "string", minLength: 16, maxLength: 220 },
  detail: { type: "string", minLength: 24, maxLength: 500 },
  terms: termsSchema,
  kind: { type: "string", enum: VISUAL_NODE_KINDS },
  view: { type: "string", enum: EXPLANATION_VIEWS },
  emphasis: { type: "string", enum: EMPHASIS_LEVELS },
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
  sourceStatus: { type: "string", enum: MODEL_SOURCE_STATUSES },
} as const;

const evidenceRefsSchema = {
  type: "array",
  maxItems: 5,
  items: { type: "string", pattern: "^S[1-5]$" },
} as const;

const relationDraftSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fromIndex: { type: "integer", minimum: 0, maximum: 5 },
    toIndex: { type: "integer", minimum: 0, maximum: 5 },
    kind: { type: "string", enum: VISUAL_RELATION_KINDS },
    label: { type: "string", maxLength: 80 },
  },
  required: ["fromIndex", "toIndex", "kind", "label"],
} as const;

export const createSceneDraftSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 2, maxLength: 120 },
    thesis: { type: "string", minLength: 8, maxLength: 260 },
    root: {
      type: "object",
      additionalProperties: false,
      properties: {
        orientation: orientationSchema,
        terms: termsSchema,
        view: semanticNodeProperties.view,
        confidence: semanticNodeProperties.confidence,
        sourceStatus: semanticNodeProperties.sourceStatus,
        evidenceRefs: evidenceRefsSchema,
      },
      required: [
        "orientation",
        "terms",
        "view",
        "confidence",
        "sourceStatus",
        "evidenceRefs",
      ],
    },
    children: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...semanticNodeProperties,
          evidenceRefs: evidenceRefsSchema,
        },
        required: [...Object.keys(semanticNodeProperties), "evidenceRefs"],
      },
    },
    relations: {
      type: "array",
      maxItems: 12,
      items: relationDraftSchema,
    },
  },
  required: ["title", "thesis", "root", "children", "relations"],
} as const;

export const expansionSceneDraftSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    parent: {
      type: "object",
      additionalProperties: false,
      properties: {
        orientation: orientationSchema,
        terms: termsSchema,
        view: semanticNodeProperties.view,
      },
      required: ["orientation", "terms", "view"],
    },
    children: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...semanticNodeProperties,
          terminal: { type: "boolean" },
        },
        required: [...Object.keys(semanticNodeProperties), "terminal"],
      },
    },
    relations: {
      type: "array",
      maxItems: 10,
      items: relationDraftSchema,
    },
  },
  required: ["parent", "children", "relations"],
} as const;

export const createSceneDraftExample = {
  title: "缓存雪崩的治理结构",
  thesis: "治理缓存雪崩需要同时约束失效节奏、回源压力与恢复路径。",
  root: {
    orientation: {
      directAnswer: "缓存雪崩不是单点缓存失效，而是大量请求在同一时间穿透到后端。",
      background: "缓存把高频读取挡在后端之前，但大量缓存若同时失效，原本被吸收的请求会在短时间集中释放。",
      role: "治理的作用不是保证缓存永不失败，而是让失效时的请求量仍处于后端可以承受的范围。",
      mechanism: "系统需要拆散过期时间、合并重复回源，并在容量不足时执行限流和降级，使压力逐层被吸收。",
      boundary: "这些措施必须根据真实流量和后端容量校准，固定阈值不能替代持续观测。",
    },
    terms: ["缓存雪崩", "回源"],
    view: "cluster",
    confidence: "high",
    sourceStatus: "model_knowledge",
    evidenceRefs: [],
  },
  children: [
    {
      title: "错峰失效",
      eyebrow: "预防",
      summary: "随机过期时间可以降低大量缓存键在同一瞬间失效的概率。",
      whyHere: "治理首先处理失效发生的时间相关性，因为这是请求峰值同时出现的直接诱因。",
      detail:
        "错峰只处理时间相关性，不能替代容量规划。若热点键本身流量过高，还需要预热、分层缓存或热点隔离共同承担压力。",
      terms: ["随机过期时间", "热点键"],
      kind: "concept",
      view: "timeline",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidenceRefs: [],
    },
    {
      title: "回源保护",
      eyebrow: "限流",
      summary: "限流与请求合并可以把缓存失效后的后端并发控制在容量以内。",
      whyHere: "错开失效仍不能消除回源，因此下一步要约束真正到达后端的并发量。",
      detail:
        "同一数据的并发请求应尽量合并为一次加载，并对整体回源设置硬上限。保护阈值必须根据真实后端容量校准，否则只是把故障从数据库转移到等待队列。",
      terms: ["请求合并", "回源"],
      kind: "process",
      view: "sequence",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidenceRefs: [],
    },
    {
      title: "降级与恢复",
      eyebrow: "兜底",
      summary: "缓存和后端都承压时，系统需要优先保住核心读路径与可恢复状态。",
      whyHere: "预防和限流都有容量边界，最后还需要在保护措施不足时提供可恢复的兜底路径。",
      detail:
        "降级结果必须标明新鲜度与适用范围，避免旧数据被当作实时事实。恢复阶段还要逐步放量，防止全部流量同时回归再次形成峰值。",
      terms: ["降级", "逐步放量"],
      kind: "stage",
      view: "sequence",
      emphasis: "secondary",
      confidence: "medium",
      sourceStatus: "model_knowledge",
      evidenceRefs: [],
    },
  ],
  relations: [
    {
      fromIndex: 0,
      toIndex: 1,
      kind: "supports",
      label: "降低失效峰值后再约束回源",
    },
  ],
} as const;

export const expansionSceneDraftExample = {
  parent: {
    orientation: {
      directAnswer: "RAG 在回答生成前先取得与问题相关的材料，再把材料加入模型当前可见的上下文。",
      background: "模型参数中的知识可能过时或无法追溯，因此系统需要把当前可验证的材料带入一次具体回答。",
      role: "它在系统中负责缩小回答的知识边界，让后续判断能够对应到实际取得的材料。",
      mechanism: "系统依次构造查询、召回候选、排序并组装上下文，生成模型再依据这些材料组织回答。",
      boundary: "检索相关不等于事实可靠，来源身份、时间范围和冲突仍需单独校验。",
    },
    terms: ["RAG", "检索范围"],
    view: "sequence",
  },
  children: [
    {
      title: "查询构造",
      eyebrow: "输入",
      summary: "查询构造把当前问题转换成可检索、可约束的检索表达。",
      whyHere: "检索系统首先需要明确要寻找什么，否则后续召回会围绕错误的问题优化。",
      detail:
        "好的查询需要保留用户真正关心的对象、条件和时间范围。若查询过度改写，后续检索即使分数很高，也可能回答了另一个问题。",
      terms: ["查询构造", "检索表达"],
      kind: "process",
      view: "sequence",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      terminal: false,
    },
    {
      title: "候选召回",
      eyebrow: "检索",
      summary: "候选召回决定系统是否有机会看见支持答案的材料。",
      whyHere: "查询形成后，系统必须先找到足够覆盖面的候选材料，再谈精确排序。",
      detail:
        "召回阶段应优先覆盖可能相关的材料，再由后续排序缩小范围。只优化排序无法补回从未进入候选集的关键证据。",
      terms: ["候选召回", "排序"],
      kind: "system",
      view: "cluster",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      terminal: false,
    },
    {
      title: "上下文组装",
      eyebrow: "生成前",
      summary: "上下文组装选择有限材料，并保留它们与原始来源的对应关系。",
      whyHere: "候选材料通常超过模型一次可读的范围，因此生成前还需要做取舍并保存来源边界。",
      detail:
        "材料数量受上下文预算限制，因此需要去重、截断和冲突处理。若来源身份在拼接时丢失，生成阶段就无法区分证据与模型自身知识。",
      terms: ["上下文预算", "来源身份"],
      kind: "concept",
      view: "compare",
      emphasis: "secondary",
      confidence: "medium",
      sourceStatus: "model_knowledge",
      terminal: false,
    },
  ],
  relations: [
    {
      fromIndex: 0,
      toIndex: 1,
      kind: "sequence",
      label: "构造查询后召回候选",
    },
    {
      fromIndex: 1,
      toIndex: 2,
      kind: "sequence",
      label: "从候选中组装上下文",
    },
  ],
} as const;

export function parseCreateSceneDraft(value: unknown): CreateSceneDraft {
  const draft = record(value, "createDraft");
  const root = record(draft.root, "createDraft.root");
  if (!Array.isArray(draft.children)) {
    throw new Error("createDraft.children 必须是数组");
  }
  if (draft.children.length < 3 || draft.children.length > 6) {
    throw new Error("createDraft.children 必须包含 3 到 6 个入口");
  }

  return {
    title: stringValue(draft.title, "createDraft.title"),
    thesis: stringValue(draft.thesis, "createDraft.thesis"),
    root: {
      orientation: parseOrientation(
        root.orientation,
        "createDraft.root.orientation",
      ),
      terms: parseDraftTerms(root.terms),
      view: optionalOneOf(root.view, EXPLANATION_VIEWS, "createDraft.root.view", "cluster"),
      confidence: optionalOneOf(
        root.confidence,
        CONFIDENCE_LEVELS,
        "createDraft.root.confidence",
        "medium",
      ),
      sourceStatus: optionalOneOf(
        root.sourceStatus,
        MODEL_SOURCE_STATUSES,
        "createDraft.root.sourceStatus",
        "model_knowledge",
      ),
      evidenceRefs: parseEvidenceRefs(
        root.evidenceRefs,
        "createDraft.root.evidenceRefs",
      ),
    },
    children: draft.children.map((item, index) =>
      parseNodeDraft(item, `createDraft.children[${index}]`, false),
    ),
    relations: parseRelations(draft.relations, draft.children.length, "createDraft.relations"),
  };
}

export function parseExpansionSceneDraft(
  value: unknown,
  maximumChildren = 5,
): ExpansionSceneDraft {
  const draft = record(value, "expandDraft");
  const parent = record(draft.parent, "expandDraft.parent");
  if (!Array.isArray(draft.children)) {
    throw new Error("expandDraft.children 必须是数组");
  }
  if (!Number.isInteger(maximumChildren) || maximumChildren < 0) {
    throw new Error("maximumChildren 必须是非负整数");
  }
  const upperBound = Math.min(5, maximumChildren);
  if (upperBound < 3) {
    throw new Error("当前解释空间剩余容量不足 3 个节点");
  }
  if (draft.children.length < 3 || draft.children.length > upperBound) {
    throw new Error(`expandDraft.children 必须包含 3 到 ${upperBound} 个入口`);
  }

  return {
    parent: {
      orientation: parseOrientation(
        parent.orientation,
        "expandDraft.parent.orientation",
      ),
      terms: parseDraftTerms(parent.terms),
      view: optionalOneOf(
        parent.view,
        EXPLANATION_VIEWS,
        "expandDraft.parent.view",
        "grid",
      ),
    },
    children: draft.children.map((item, index) =>
      parseNodeDraft(item, `expandDraft.children[${index}]`, true),
    ),
    relations: parseRelations(draft.relations, draft.children.length, "expandDraft.relations"),
  };
}

export function assembleVisualDocument(
  question: string,
  draft: CreateSceneDraft,
  searchEvidence: readonly VisualSearchEvidence[] = [],
): VisualDocument {
  const documentId = `visual_${stableHash(question)}`;
  const rootId = `${documentId}_root`;
  const childIds = draft.children.map((_, index) => `${documentId}_node_${index + 1}`);

  const rootEvidence = resolveEvidence(draft.root.evidenceRefs, searchEvidence);
  const root: VisualNode = {
    id: rootId,
    parentId: null,
    title: draft.title,
    eyebrow: "全局视图",
    summary: draft.root.orientation.directAnswer,
    detail: assembleOrientation(draft.root.orientation),
    terms: sanitizeDraftTerms(
      draft.root.terms,
      draft.title,
      draft.root.orientation.directAnswer,
      assembleOrientation(draft.root.orientation),
    ),
    kind: "topic",
    view: draft.root.view,
    depth: 0,
    childIds,
    expandable: true,
    expansionState: "expanded",
    emphasis: "primary",
    confidence: draft.root.confidence,
    sourceStatus:
      rootEvidence.length > 0 ? "source_backed" : draft.root.sourceStatus,
    evidence: rootEvidence,
  };

  const children = draft.children.map((child, index): VisualNode => {
    const evidence = resolveEvidence(child.evidenceRefs, searchEvidence);
    return {
      id: childIds[index],
      parentId: rootId,
      title: child.title,
      eyebrow: child.eyebrow,
      summary: child.summary,
      detail: assembleChildDetail(child),
      terms: sanitizeDraftTerms(
        child.terms,
        child.title,
        child.summary,
        assembleChildDetail(child),
      ),
      kind: child.kind,
      view: child.view,
      depth: 1,
      childIds: [],
      expandable: true,
      expansionState: "outline",
      emphasis: child.emphasis,
      confidence: child.confidence,
      sourceStatus: evidence.length > 0 ? "source_backed" : child.sourceStatus,
      evidence,
    };
  });

  const relations = assembleRelations(
    draft.relations,
    rootId,
    childIds,
    `${documentId}_relation`,
  );

  return parseVisualDocument({
    protocol: "visual-explanation-document/2",
    id: documentId,
    question,
    title: draft.title,
    thesis: draft.thesis,
    rootId,
    primaryMaterial: resolvePrimaryMaterial(question),
    nodes: [root, ...children],
    relations,
    version: 1,
  });
}

export function assembleVisualOperations(
  document: VisualDocument,
  nodeId: string,
  draft: ExpansionSceneDraft,
): VisualOperationBatch {
  const parent = document.nodes.find((node) => node.id === nodeId);
  if (!parent) throw new Error("待展开节点不存在");
  if (parent.depth >= MAX_DOCUMENT_DEPTH) {
    throw new Error(`节点已达到最大深度 ${MAX_DOCUMENT_DEPTH}`);
  }
  const remainingCapacity = MAX_DOCUMENT_NODES - document.nodes.length;
  if (remainingCapacity < 3) {
    throw new Error("当前解释空间剩余容量不足 3 个节点");
  }
  if (draft.children.length > remainingCapacity) {
    throw new Error("新增节点超过当前解释空间剩余容量");
  }

  const nextDepth = parent.depth + 1;
  const existingIds = new Set(document.nodes.map((node) => node.id));
  const childIds = draft.children.map((_, index) =>
    uniqueId(`node_${document.version + 1}_${index + 1}`, existingIds),
  );
  const projectedNodeCount = document.nodes.length + draft.children.length;
  const newBranchesHaveCapacity = MAX_DOCUMENT_NODES - projectedNodeCount >= 3;

  const operations: VisualOperationBatch["operations"] = [
    {
      kind: "update_node",
      node: null,
      relation: null,
      nodeId,
      patch: {
        title: null,
        eyebrow: null,
        summary: null,
        detail: assembleOrientation(draft.parent.orientation),
        terms: sanitizeDraftTerms(
          draft.parent.terms,
          parent.title,
          parent.summary,
          assembleOrientation(draft.parent.orientation),
        ),
        view: draft.parent.view,
        expandable: null,
        expansionState: null,
        emphasis: null,
      },
    },
  ];

  for (const [index, child] of draft.children.entries()) {
    const terminal =
      child.terminal || nextDepth >= MAX_DOCUMENT_DEPTH || !newBranchesHaveCapacity;
    operations.push({
      kind: "add_node",
      node: {
        id: childIds[index],
        parentId: nodeId,
        title: child.title,
        eyebrow: child.eyebrow,
        summary: child.summary,
        detail: assembleChildDetail(child),
        terms: sanitizeDraftTerms(
          child.terms,
          child.title,
          child.summary,
          assembleChildDetail(child),
        ),
        kind: child.kind,
        view: child.view,
        depth: nextDepth,
        childIds: [],
        expandable: !terminal,
        expansionState: terminal ? "terminal" : "outline",
        emphasis: child.emphasis,
        confidence: child.confidence,
        sourceStatus: child.sourceStatus,
        evidence: [],
      },
      relation: null,
      nodeId: null,
      patch: null,
    });
  }

  for (const relation of assembleRelations(
    draft.relations,
    nodeId,
    childIds,
    `relation_${document.version + 1}`,
    new Set(document.relations.map((relation) => relation.id)),
  )) {
    operations.push({
      kind: "add_relation",
      node: null,
      relation,
      nodeId: null,
      patch: null,
    });
  }

  return parseVisualOperationBatch({
    protocol: "visual-explanation-operations/2",
    baseVersion: document.version,
    operations,
  });
}

export function remainingExpansionCapacity(document: VisualDocument): number {
  return Math.max(0, MAX_DOCUMENT_NODES - document.nodes.length);
}

function parseNodeDraft(value: unknown, path: string, terminalAllowed: boolean): NodeDraft {
  const node = record(value, path);
  return {
    title: stringValue(node.title, `${path}.title`),
    eyebrow:
      node.eyebrow === undefined ? "" : stringValue(node.eyebrow, `${path}.eyebrow`, true),
    summary: stringValue(node.summary, `${path}.summary`),
    whyHere: stringValue(node.whyHere, `${path}.whyHere`),
    detail: stringValue(node.detail, `${path}.detail`),
    terms: parseDraftTerms(node.terms),
    kind: optionalOneOf(node.kind, VISUAL_NODE_KINDS, `${path}.kind`, "concept"),
    view: optionalOneOf(node.view, EXPLANATION_VIEWS, `${path}.view`, "grid"),
    emphasis: optionalOneOf(
      node.emphasis,
      EMPHASIS_LEVELS,
      `${path}.emphasis`,
      "secondary",
    ),
    confidence: optionalOneOf(
      node.confidence,
      CONFIDENCE_LEVELS,
      `${path}.confidence`,
      "medium",
    ),
    sourceStatus: optionalOneOf(
      node.sourceStatus,
      MODEL_SOURCE_STATUSES,
      `${path}.sourceStatus`,
      "model_knowledge",
    ),
    evidenceRefs: parseEvidenceRefs(node.evidenceRefs, `${path}.evidenceRefs`),
    terminal:
      terminalAllowed && node.terminal !== undefined
        ? booleanValue(node.terminal, `${path}.terminal`)
        : false,
  };
}

function parseEvidenceRefs(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error(`${path} 必须是最多包含 5 个搜索结果 ID 的数组`);
  }
  const refs = value.map((item, index) =>
    stringValue(item, `${path}[${index}]`),
  );
  if (refs.some((ref) => !/^S[1-5]$/u.test(ref)) || new Set(refs).size !== refs.length) {
    throw new Error(`${path} 包含无效或重复的搜索结果 ID`);
  }
  return refs;
}

function resolveEvidence(
  refs: readonly string[],
  evidence: readonly VisualSearchEvidence[],
): VisualNode["evidence"] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return refs.map((ref) => {
    const source = byId.get(ref);
    if (!source) {
      throw new Error(`模型引用了未提供的搜索结果 ${ref}`);
    }
    const detail = source.snippet?.trim()
      || (source.publishedAt ? `发布于 ${source.publishedAt}` : "联网搜索结果");
    return {
      label: source.title,
      detail,
      url: source.url,
    };
  });
}

function parseDraftTerms(value: unknown): string[] {
  if (value === undefined) return [];
  // Terms are optional annotations, not graph integrity. A malformed term must
  // not force otherwise valid explanatory content into the repair loop.
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_DRAFT_TERM_CANDIDATES)
    .filter((item): item is string => typeof item === "string");
}

function parseOrientation(value: unknown, path: string): OrientationDraft {
  const orientation = record(value, path);
  return {
    directAnswer: stringValue(
      orientation.directAnswer,
      `${path}.directAnswer`,
    ),
    background: stringValue(orientation.background, `${path}.background`),
    role: stringValue(orientation.role, `${path}.role`),
    mechanism: stringValue(orientation.mechanism, `${path}.mechanism`),
    boundary: stringValue(orientation.boundary, `${path}.boundary`),
  };
}

function assembleOrientation(orientation: OrientationDraft): string {
  return [
    orientation.background,
    orientation.role,
    orientation.mechanism,
    orientation.boundary,
  ].join("\n\n");
}

function assembleChildDetail(child: Pick<NodeDraft, "whyHere" | "detail">): string {
  return `${child.whyHere}\n\n${child.detail}`;
}

function parseRelations(
  value: unknown,
  childCount: number,
  path: string,
): RelationDraft[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组`);
  if (value.length > 12) throw new Error(`${path} 不能超过 12 条`);
  return value.map((item, index) => {
    const relationPath = `${path}[${index}]`;
    const relation = record(item, relationPath);
    const fromIndex = integer(
      relation.fromIndex,
      `${relationPath}.fromIndex`,
      0,
      childCount - 1,
    );
    const toIndex = integer(
      relation.toIndex,
      `${relationPath}.toIndex`,
      0,
      childCount - 1,
    );
    if (fromIndex === toIndex) {
      throw new Error(`${relationPath} 不能连接同一个子节点`);
    }
    return {
      fromIndex,
      toIndex,
      kind: oneOf(
        relation.kind,
        VISUAL_RELATION_KINDS,
        `${relationPath}.kind`,
      ),
      label:
        relation.label === undefined
          ? ""
          : stringValue(relation.label, `${relationPath}.label`, true),
    };
  });
}

function assembleRelations(
  drafts: RelationDraft[],
  scopeId: string,
  childIds: string[],
  idPrefix: string,
  existingIds = new Set<string>(),
): VisualRelation[] {
  const seen = new Set<string>();
  const relations: VisualRelation[] = [];
  for (const draft of drafts) {
    const signature = `${draft.fromIndex}:${draft.toIndex}:${draft.kind}:${draft.label}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    relations.push({
      id: uniqueId(`${idPrefix}_${relations.length + 1}`, existingIds),
      scopeId,
      from: childIds[draft.fromIndex],
      to: childIds[draft.toIndex],
      kind: draft.kind,
      label: draft.label,
    });
  }
  return relations;
}

function sanitizeDraftTerms(
  candidates: string[],
  title: string,
  summary: string,
  detail: string,
): string[] {
  const accepted: string[] = [];
  const identities = new Set<string>();
  for (const candidate of candidates) {
    const term = candidate.trim();
    const identity = normalizeTermIdentity(term);
    if (
      !term ||
      Array.from(term).length > 40 ||
      /[\r\n\u2028\u2029]/u.test(term) ||
      identities.has(identity)
    ) {
      continue;
    }
    try {
      assertVisualNodeTerms({ title, summary, detail, terms: [term] });
    } catch {
      continue;
    }
    identities.add(identity);
    accepted.push(term);
    if (accepted.length === 8) break;
  }
  return accepted;
}

function optionalOneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
  fallback: T,
): T {
  return value === undefined ? fallback : oneOf(value, choices, path);
}

function uniqueId(base: string, existing: Set<string>): string {
  let candidate = base;
  let suffix = 1;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  existing.add(candidate);
  return candidate;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

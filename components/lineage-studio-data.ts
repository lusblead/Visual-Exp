import type {
  ExplanationView,
  SourceStatus,
  VisualDocument,
  VisualNode,
  VisualOperationBatch,
} from "../lib/lineage-contracts";
import type { TermExplanation } from "../lib/term-explanation";
import type { DeepExplanation } from "../lib/deep-explanation";
import type { ModelUsageEvent } from "../lib/model-port";
export {
  createExplorationHistory,
  moveExplorationHistory,
  pushExplorationHistory,
} from "../lib/exploration-history.mjs";
import { createExplorationHistory } from "../lib/exploration-history.mjs";

export interface HistoryEntry {
  document: VisualDocument;
  activeNodeId: string;
}

export interface ApiPayload {
  document?: VisualDocument;
  operations?: VisualOperationBatch | null;
  provider?: "deepseek" | "openai" | "demo" | string;
  model?: string;
  fallbackReason?: string | null;
  focusNodeId?: string;
  explanation?: TermExplanation | DeepExplanation;
  explanations?: TermExplanation[];
  contextToken?: string;
  contextTokens?: string[];
  deepExplanation?: DeepExplanation;
  usage?: ModelUsageEvent[];
  error?: string | { code?: string; message?: string };
}

export type ExplorationHistory = ReturnType<typeof createExplorationHistory>;

export const VIEW_META: Record<ExplanationView, { label: string; description: string }> = {
  grid: { label: "主题网格", description: "并列查看同一层的重要入口" },
  sequence: { label: "路径", description: "按照过程或依赖逐步推进" },
  timeline: { label: "时间线", description: "沿阶段与变化顺序理解" },
  compare: { label: "对比", description: "在共同标准下观察差异" },
  cluster: { label: "聚类", description: "围绕核心主题建立组成关系" },
};

export const SOURCE_LABELS: Record<SourceStatus, string> = {
  source_backed: "已有来源支持",
  model_knowledge: "基于模型知识组织",
  needs_source: "具体结论仍需来源",
};

export const STARTER_QUESTIONS = [
  "Transformer 是怎么工作的？",
  "一个 AI Agent 系统应该怎么设计？",
  "React Flow 和 tldraw 应该怎么选？",
];

export const INITIAL_DOCUMENT: VisualDocument = {
  protocol: "visual-explanation-document/2",
  id: "initial-visualized-exp",
  question: "AI 可视化对话产品应该如何设计？",
  title: "AI 可视化对话产品的整体结构",
  thesis:
    "先看理解体验、语义空间、视觉表达、AI 操控闭环与产品演进；进入任意节点后，再生成更具体的一层。",
  rootId: "initial-root",
  version: 1,
  relations: [],
  nodes: [
    {
      id: "initial-root",
      parentId: null,
      title: "AI 可视化对话产品的整体结构",
      eyebrow: "全局视图",
      summary:
        "这不是固定的四阶段知识谱系，而是一张可以逐层进入的解释空间。首页只保留高抽象度入口。",
      detail:
        "点击某个节点后，界面会进入新的场景；已经生成的结构仍保留在左侧地图中，随时可以返回。",
      kind: "topic",
      view: "cluster",
      depth: 0,
      childIds: [
        "initial-understanding",
        "initial-semantic",
        "initial-visual",
        "initial-agent",
        "initial-product",
      ],
      expandable: true,
      expansionState: "expanded",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidence: [],
      terms: [],
    },
    {
      id: "initial-understanding",
      parentId: "initial-root",
      title: "理解体验",
      eyebrow: "01 · USER",
      summary: "用户怎样先看见整体，再根据自己的兴趣进入局部。",
      detail: "目标不是生成一张大图，而是降低阅读长文本和在脑中重建结构的成本。",
      kind: "question",
      view: "grid",
      depth: 1,
      childIds: [],
      expandable: true,
      expansionState: "outline",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidence: [],
      terms: [],
    },
    {
      id: "initial-semantic",
      parentId: "initial-root",
      title: "语义空间",
      eyebrow: "02 · MODEL",
      summary: "内容、层级和关系独立于任何具体页面与像素布局。",
      detail: "节点既是一段内容，也是进入下一层场景的入口。缩放对应理解层次变化。",
      kind: "system",
      view: "cluster",
      depth: 1,
      childIds: [],
      expandable: true,
      expansionState: "outline",
      emphasis: "primary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidence: [],
      terms: [],
    },
    {
      id: "initial-visual",
      parentId: "initial-root",
      title: "视觉表达",
      eyebrow: "03 · VIEW",
      summary: "每个场景根据内容关系选择不同表现形式，而不是统一卡片模板。",
      detail: "同一份语义内容可以显示为网格、路径、时间线、对比或聚类。",
      kind: "concept",
      view: "compare",
      depth: 1,
      childIds: [],
      expandable: true,
      expansionState: "outline",
      emphasis: "secondary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidence: [],
      terms: [],
    },
    {
      id: "initial-agent",
      parentId: "initial-root",
      title: "AI 操控闭环",
      eyebrow: "04 · AGENT",
      summary: "AI 读取当前场景，以受限制的增量操作继续组织和修改表达。",
      detail: "模型不直接输出坐标和样式，只添加节点、建立关系或更新当前场景。",
      kind: "process",
      view: "sequence",
      depth: 1,
      childIds: [],
      expandable: true,
      expansionState: "outline",
      emphasis: "secondary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidence: [],
      terms: [],
    },
    {
      id: "initial-product",
      parentId: "initial-root",
      title: "产品演进",
      eyebrow: "05 · ROADMAP",
      summary: "从可探索回答，逐步发展为讲解器、视觉引擎和长期工作空间。",
      detail: "每一阶段验证一个新的核心假设，而不是一次堆满所有能力。",
      kind: "stage",
      view: "timeline",
      depth: 1,
      childIds: [],
      expandable: true,
      expansionState: "outline",
      emphasis: "secondary",
      confidence: "high",
      sourceStatus: "model_knowledge",
      evidence: [],
      terms: [],
    },
  ],
};

export function isVisualDocument(value: unknown): value is VisualDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<VisualDocument>;
  return (
    candidate.protocol === "visual-explanation-document/2" &&
    typeof candidate.rootId === "string" &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.relations)
  );
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "server-render";
  const key = "visualized-exp-session";
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const generated = `session_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  window.sessionStorage.setItem(key, generated);
  return generated;
}

export function providerLabel(provider: string, busy: boolean): string {
  if (busy) return "AI 正在组织场景";
  if (provider === "deepseek") return "DeepSeek · live";
  if (provider === "openai") return "OpenAI · live";
  return "离线语义引擎";
}

export function buildPath(node: VisualNode, nodeById: Map<string, VisualNode>): VisualNode[] {
  const path: VisualNode[] = [];
  const visited = new Set<string>();
  let cursor: VisualNode | undefined = node;
  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor);
    visited.add(cursor.id);
    cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
  }
  return path;
}

export function readApiError(payload: ApiPayload | VisualDocument): string {
  if (isVisualDocument(payload)) return "请求失败，请再试一次。";
  if (typeof payload.error === "string") return payload.error;
  return payload.error?.message || "视觉解释暂时没有完成，请再试一次。";
}

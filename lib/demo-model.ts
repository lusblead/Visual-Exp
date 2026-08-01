import type {
  ExplanationView,
  VisualDocument,
  VisualNode,
  VisualOperation,
  VisualOperationBatch,
  VisualRelation,
} from "./lineage-contracts";
import {
  assertVisualDocumentContentQuality,
  assertVisualExpansionContentQuality,
} from "./visual-content-quality";
import { DETAIL_BLUEPRINTS } from "./demo-detail-blueprints";
import type {
  DeepExplanationContext,
  DeepExplanationDraft,
} from "./deep-explanation";
import { detail, type BlueprintItem, type RootBlueprint } from "./demo-blueprint-types";
import { ROOT_BLUEPRINTS } from "./demo-root-blueprints";
import type { VisualModelPort } from "./model-port";
import type {
  TermDefinitionContext,
  TermDefinitionDraft,
} from "./term-explanation";
import { assertTermDefinitionBatchContexts } from "./term-explanation";
import { resolvePrimaryMaterial } from "./primary-material";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slug(namespace: string, key: string): string {
  return `${namespace}-${key}`;
}

function shortQuestion(question: string): string {
  const clean = question
    .trim()
    .replace(/[？?。！!]+$/g, "")
    .replace(/^(请|请你|帮我|给我|我想知道|解释一下)\s*/u, "");
  return clean.length > 32 ? `${clean.slice(0, 31)}…` : clean;
}

function chooseBlueprint(question: string): RootBlueprint {
  if (/区别|对比|比较|选型|怎么选|如何选|选择|哪个好|方案|\bvs\b/i.test(question)) return ROOT_BLUEPRINTS.compare;
  if (/历史|发展|演化|阶段|时间线|从.+到/u.test(question)) return ROOT_BLUEPRINTS.timeline;
  if (/流程|如何工作|怎么工作|原理|步骤|生命周期/u.test(question)) return ROOT_BLUEPRINTS.process;
  if (/系统|架构|产品|平台|智能体|agent|设计|构建|实现/i.test(question)) {
    return ROOT_BLUEPRINTS.system;
  }
  return ROOT_BLUEPRINTS.concept;
}

function nodeFromBlueprint(
  item: BlueprintItem,
  id: string,
  parentId: string,
  depth: number,
  terminal: boolean,
): VisualNode {
  return {
    id,
    parentId,
    title: item.title,
    eyebrow: item.eyebrow,
    summary: item.summary,
    detail: materializeDetail(item),
    terms: item.terms ?? [],
    kind: item.kind,
    view: item.view,
    depth,
    childIds: [],
    expandable: !terminal,
    expansionState: terminal ? "terminal" : "outline",
    emphasis: item.emphasis ?? "secondary",
    confidence: "medium",
    sourceStatus: terminal ? "needs_source" : "model_knowledge",
    evidence: [],
  };
}

function materializeDetail(item: BlueprintItem): string {
  const kindBoundary: Record<BlueprintItem["kind"], string> = {
    topic: "需要把主要分支放回同一问题框架中比较，并明确结论依赖的上下文。",
    stage: "判断这一阶段时既要看它解决了什么，也要看尚未满足的进入条件和退出条件。",
    concept: "准确理解它需要同时说明定义、作用对象以及容易被混淆的相邻概念。",
    process: "机制分析应交代输入、转换、输出和反馈，任何一环缺失都会改变最终结果。",
    system: "系统价值来自责任边界与协作关系，而不是简单增加组件数量。",
    argument: "这个判断只在给定目标和约束下成立，条件变化时结论也必须重新评估。",
    example: "例子用于检验抽象判断，但不能替代对机制和适用边界的说明。",
    evidence: "证据必须对应明确判断，并区分可观察结果、推断与尚待验证的假设。",
    question: "回答时要先固定对象、目标和限制，否则相同词语可能对应完全不同的问题。",
  };
  const detail = item.detail.trim();
  const explanation =
    Array.from(detail).length >= 24 && sentenceCount(detail) >= 2
      ? detail
      : `${detail} ${kindBoundary[item.kind]}`;
  return `这一部分之所以出现在当前层，是因为它负责把“${item.title}”放回整体问题中定位，而不是只提供一个分类标签。\n\n${explanation}`;
}

function sentenceCount(value: string): number {
  return value.split(/[。！？.!?]+/u).filter((part) => part.trim().length > 0).length;
}

function relationsFor(
  scopeId: string,
  childIds: string[],
  view: ExplanationView,
  namespace: string,
): VisualRelation[] {
  if (childIds.length < 2) return [];
  if (view === "sequence" || view === "timeline") {
    return childIds.slice(1).map((id, index) => ({
      id: slug(namespace, `relation-${index + 1}`),
      scopeId,
      from: childIds[index],
      to: id,
      kind: "sequence",
      label: view === "timeline" ? "进入下一阶段" : "继续推进",
    }));
  }
  if (view === "compare") {
    return [
      {
        id: slug(namespace, "relation-contrast"),
        scopeId,
        from: childIds[0],
        to: childIds[1],
        kind: "contrasts",
        label: "在同一标准下比较",
      },
    ];
  }
  return [];
}

export function createDemoExplanation(question: string): VisualDocument {
  const blueprint = chooseBlueprint(question);
  const namespace = `demo-${stableHash(question.trim())}`;
  const rootId = slug(namespace, "root");
  const childNodes = blueprint.items.map((item) =>
    nodeFromBlueprint(item, slug(namespace, item.key), rootId, 1, false),
  );
  const rootTitle = `${blueprint.titlePrefix}：${shortQuestion(question)}`;
  const rootDetail = `很多复杂问题之所以难懂，不是因为缺少名词，而是因为背景、作用和前后关系没有先被说明。\n\n围绕“${shortQuestion(question)}”，当前层先给出核心判断，再说明各部分在整体中的责任。\n\n接下来的章节按理解顺序展开机制、组成、权衡和落地条件，让每一步都能解释前一步留下的问题。\n\n这些判断只适用于当前问题给出的目标和约束，条件改变时需要重新评估。`;
  const root: VisualNode = {
    id: rootId,
    parentId: null,
    title: rootTitle,
    eyebrow: "全局视图",
    summary: blueprint.thesis,
    detail: rootDetail,
    terms: extractQuestionTerms(
      question,
      `${rootTitle} ${blueprint.thesis} ${rootDetail}`,
    ),
    kind: "topic",
    view: blueprint.view,
    depth: 0,
    childIds: childNodes.map((node) => node.id),
    expandable: true,
    expansionState: "expanded",
    emphasis: "primary",
    confidence: "medium",
    sourceStatus: "model_knowledge",
    evidence: [],
  };

  const document: VisualDocument = {
    protocol: "visual-explanation-document/2",
    id: namespace,
    question,
    title: root.title,
    thesis: blueprint.thesis,
    rootId,
    primaryMaterial: resolvePrimaryMaterial(question),
    nodes: [root, ...childNodes],
    relations: relationsFor(rootId, root.childIds, root.view, namespace),
    version: 1,
  };
  assertVisualDocumentContentQuality(document);
  return document;
}

function chooseDetailItems(parent: VisualNode): BlueprintItem[] {
  const id = parent.id;
  const title = parent.title;
  if (/purpose|目标|边界|定义|标准/.test(`${id} ${title}`)) return DETAIL_BLUEPRINTS.purpose;
  if (/mechanism|机制|原理|流程|工作|判断|转换/.test(`${id} ${title}`)) {
    return DETAIL_BLUEPRINTS.mechanism;
  }
  if (/components|组成|结构|系统|架构|能力|方案/.test(`${id} ${title}`)) {
    return DETAIL_BLUEPRINTS.components;
  }
  if (/tradeoffs|约束|权衡|限制|误区|风险|差异/.test(`${id} ${title}`)) {
    return DETAIL_BLUEPRINTS.tradeoffs;
  }
  if (/roadmap|落地|阶段|路径|现在|未来/.test(`${id} ${title}`)) {
    return DETAIL_BLUEPRINTS.roadmap;
  }

  return [
    detail("definition", "定义", `先准确理解${parent.title}`, `明确它在当前问题中的含义与边界。`, "concept", "grid"),
    detail("parts", "组成", "拆成关键要素", `识别构成${parent.title}的主要部分。`, "system", "cluster"),
    detail("mechanism", "机制", "看见它如何运作", `解释这些要素怎样共同产生结果。`, "process", "sequence"),
    detail("example", "例子", "放进真实情境", `用具体场景检验对${parent.title}的理解。`, "example", "grid"),
  ];
}

export function expandDemoExplanation(
  document: VisualDocument,
  nodeId: string,
): VisualOperationBatch {
  const parent = document.nodes.find((node) => node.id === nodeId);
  if (!parent) throw new Error("无法展开：目标节点不存在");
  if (parent.childIds.length > 0) throw new Error("该节点已经展开");
  if (!parent.expandable || parent.expansionState === "terminal") {
    throw new Error("该节点已经到达当前解释深度");
  }

  const depth = parent.depth + 1;
  const terminal = depth >= 3;
  const items = chooseDetailItems(parent).slice(0, depth >= 2 ? 4 : 5);
  const namespace = `${document.id}-${stableHash(`${parent.id}:${document.version + 1}`)}`;
  const children = items.map((item) =>
    nodeFromBlueprint(item, slug(namespace, item.key), parent.id, depth, terminal),
  );

  const parentView: ExplanationView =
    /阶段|路径|过程|流程/.test(parent.title)
      ? "sequence"
      : /区别|权衡|差异|方案/.test(parent.title)
        ? "compare"
        : parent.view;

  const updateParent: VisualOperation = {
    kind: "update_node",
    node: null,
    relation: null,
    nodeId: parent.id,
    patch: {
      title: null,
      eyebrow: null,
      summary: null,
      detail: `${parent.detail} 进一步分析表明，这一主题需要同时处理 ${children
        .slice(0, 3)
        .map((node) => node.title)
        .join("、")}等要素；它们分别解释机制、条件与结果，不能相互替代。`,
      terms: parent.terms,
      view: parentView,
      expandable: null,
      expansionState: null,
      emphasis: null,
    },
  };

  const addNodes: VisualOperation[] = children.map((node) => ({
    kind: "add_node",
    node,
    relation: null,
    nodeId: null,
    patch: null,
  }));
  const addRelations: VisualOperation[] = relationsFor(
    parent.id,
    children.map((node) => node.id),
    parentView,
    namespace,
  ).map((relation) => ({
    kind: "add_relation",
    node: null,
    relation,
    nodeId: null,
    patch: null,
  }));

  const batch: VisualOperationBatch = {
    protocol: "visual-explanation-operations/2",
    baseVersion: document.version,
    operations: [updateParent, ...addNodes, ...addRelations],
  };
  assertVisualExpansionContentQuality(document, nodeId, batch);
  return batch;
}

export class DemoVisualModel implements VisualModelPort {
  async create(question: string): Promise<VisualDocument> {
    return createDemoExplanation(question);
  }

  async expand(document: VisualDocument, nodeId: string): Promise<VisualOperationBatch> {
    return expandDemoExplanation(document, nodeId);
  }

  async defineTerm(input: TermDefinitionContext): Promise<TermDefinitionDraft> {
    const known = DEMO_TERM_DEFINITIONS[normalizeDemoTerm(input.term)];
    if (known) {
      return {
        definition: known,
        relevance: `在“${input.scene.title}”中，${input.term}直接影响${input.scene.summary.replace(/[。！？.!?]+$/u, "")}。`,
        terms: demoNestedTerms(known),
      };
    }
    return {
      definition: `${input.term}是当前问题中一个需要单独澄清的概念；这里按“${input.scene.title}”的语境理解，而不是把它当作脱离上下文的通用定义。`,
      relevance: `它与当前场景的关系是：${input.scene.summary}`,
      terms: ["上下文"],
    };
  }

  async defineTerms(inputs: TermDefinitionContext[]): Promise<TermDefinitionDraft[]> {
    assertTermDefinitionBatchContexts(inputs);
    return Promise.all(inputs.map((input) => this.defineTerm(input)));
  }

  async deepDive(input: DeepExplanationContext): Promise<DeepExplanationDraft> {
    return {
      directAnswer: `${input.subject}需要结合“${input.scene.title}”理解，它不是脱离当前问题的孤立标签。`,
      background: `用户正在理解“${input.question}”，当前选区来自路径“${input.path.join(" / ") || input.scene.title}”。复杂概念通常需要先说明它为了解决什么问题而出现。`,
      role: `在当前场景中，它的作用是补足这项判断：${input.scene.summary}`,
      mechanism: `理解它时可以依次追问输入是什么、发生了什么转换、产生什么结果，以及结果如何影响下一步。这样能够把名词还原为可以观察的过程。`,
      boundary: `这是一份确定性的离线说明，没有检索外部材料；涉及具体版本、实时数据或来源时仍需要单独验证。`,
      terms: ["检索"],
    };
  }
}

const DEMO_TERM_DEFINITIONS: Record<string, string> = {
  agent:
    "Agent（智能体）是能够接收目标和上下文、规划步骤、调用工具并根据结果继续调整行动的软件执行单元；它与只生成一次文本的模型调用不同。",
  rag:
    "RAG（检索增强生成）是在生成回答前从受控知识源检索相关材料，并把材料作为上下文交给模型的机制；它改善的是知识可追溯性与时效性，而不是保证模型永不出错。",
  llm:
    "LLM（大语言模型）是根据上下文预测和生成语言内容的基础模型；在系统中它通常负责理解、规划或表达，但权限、数据和执行结果仍需由外部组件约束。",
  transformer:
    "Transformer 是一种以注意力机制处理序列关系的神经网络架构；它让模型能并行建模远距离上下文，但并不自动提供事实来源或工具执行能力。",
  api:
    "API 是软件组件之间约定请求、响应与错误语义的接口边界；稳定的 API 应隐藏内部实现，同时明确权限、版本和失败行为。",
};

function normalizeDemoTerm(term: string): string {
  return term.normalize("NFKC").trim().toLocaleLowerCase("und");
}

function extractQuestionTerms(question: string, content: string): string[] {
  const candidates =
    question.match(
      /\b(?:Agent|RAG|LLM|Transformer|API|MCP|Embedding|Vector DB|AI)\b/giu,
    ) ?? [];
  const normalizedContent = content.normalize("NFKC").toLocaleLowerCase("und");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeDemoTerm(candidate);
    if (seen.has(normalized) || !normalizedContent.includes(normalized)) continue;
    seen.add(normalized);
    result.push(candidate);
    if (result.length === 8) break;
  }
  return result;
}

function demoNestedTerms(content: string): string[] {
  return ["上下文", "工具", "注意力机制"]
    .filter((term) => content.includes(term))
    .slice(0, 4);
}

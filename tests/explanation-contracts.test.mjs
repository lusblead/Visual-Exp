import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      try {
        return await nextResolve(specifier, context);
      } catch (error) {
        if (
          error?.code === "ERR_MODULE_NOT_FOUND" &&
          /^\\.{1,2}\\//u.test(specifier) &&
          !/\\.[^/]+$/u.test(specifier)
        ) {
          return nextResolve(specifier + ".ts", context);
        }
        throw error;
      }
    }
  `)}`,
  import.meta.url,
);

const {
  createDeepExplanation,
  parseDeepExplanation,
  parseDeepExplanationRequest,
} = await import("../lib/deep-explanation.ts");
const {
  createTermExplanation,
  parseTermDefinition,
  parseTermDefinitions,
  parseTermExplanation,
} = await import("../lib/term-explanation.ts");

const scene = {
  title: "知识边界",
  summary: "RAG 用检索材料约束回答所依赖的上下文。",
  detail: "系统先执行检索，再把材料加入上下文，但相关材料仍需要真实性校验。",
};

function termContext(term, overrides = {}) {
  return {
    term,
    nodeId: "node-rag",
    question: "RAG 如何约束回答？",
    path: ["可靠回答", "知识边界"],
    scene,
    ...overrides,
  };
}

test("term explanation v2 validates literal nested terms and a bounded path", () => {
  const rootContext = termContext("RAG");
  const root = createTermExplanation(
    rootContext,
    "node-rag",
    "high",
    "model_knowledge",
    {
      definition: "RAG 会先执行检索，再把取得的材料加入模型上下文。",
      relevance: "在当前段落中，它让回答能够对应到实际取得的材料。",
      terms: ["检索", "上下文"],
    },
  );

  assert.equal(root.protocol, "visual-term-explanation/2");
  assert.deepEqual(root.termPath, ["RAG"]);
  assert.deepEqual(parseTermExplanation(root), root);

  const nested = createTermExplanation(
    termContext("上下文", { parentExplanation: root }),
    "node-rag",
    "high",
    "model_knowledge",
    {
      definition: "上下文是模型当前一次处理时能够读取的信息范围。",
      relevance: "在这里，检索材料只有进入上下文后才会影响回答。",
      terms: ["模型"],
    },
  );
  assert.deepEqual(nested.termPath, ["RAG", "上下文"]);

  assert.throws(
    () =>
      parseTermDefinition(
        {
          definition: "RAG 可以写成 RAG(x)=retrieve(x)。",
          relevance: "它用于验证短解释不会提前展示公式。",
          terms: [],
        },
        rootContext,
      ),
    /公式后必须紧跟通俗解释/,
  );
  assert.throws(
    () =>
      createTermExplanation(
        termContext("第四层", {
          termPath: ["第一层", "第二层", "第三层", "第四层", "第五层"],
        }),
        "node-rag",
        "medium",
        "model_knowledge",
        {
          definition: "第四层用于验证递归解释的边界。",
          relevance: "它不应超过协议允许的层级。",
          terms: [],
        },
      ),
    /1 到 4/,
  );
});

test("invalid optional nested annotations are dropped without rejecting useful prose", () => {
  const rootContext = termContext("RAG");
  assert.deepEqual(
    parseTermDefinition(
      {
        definition: "这里只解释检索。",
        relevance: "它影响当前回答。",
        terms: ["向量数据库"],
      },
      rootContext,
    ).terms,
    [],
  );

  const sanitized = parseTermDefinition(
    {
      definition: "激活函数通过非线性变换处理输入，ReLU 和 GELU 都是常见选择。",
      relevance: "非线性让网络不只会叠加线性变换，Dropout 则用于正则化。",
      terms: [
        "不存在的术语",
        "RAG",
        42,
        "换行\n术语",
        "过长".repeat(21),
        "非线性",
        " ReLU ",
        "relu",
        "GELU",
        "Dropout",
        "激活函数",
      ],
    },
    rootContext,
  );
  assert.deepEqual(sanitized.terms, ["非线性", "ReLU", "GELU", "Dropout"]);
  assert.deepEqual(
    parseTermDefinition(
      {
        definition: "这段正文仍然可以使用。",
        relevance: "可选标注缺失不影响正文。",
        terms: null,
      },
      rootContext,
    ).terms,
    [],
  );

  const sanitizedBatch = parseTermDefinitions(
    {
      definitions: [
        {
          term: "RAG",
          definition: "RAG 会先执行检索并取得材料。",
          relevance: "检索使当前回答能够利用外部材料。",
          terms: ["不存在的术语", "RAG", "检索"],
        },
      ],
    },
    [rootContext],
  );
  assert.deepEqual(sanitizedBatch[0].terms, ["检索"]);
});

test("batch definitions are same-context, exact-set, and returned in request order", () => {
  const inputs = [termContext("RAG"), termContext("上下文")];
  const parsed = parseTermDefinitions(
    {
      definitions: [
        {
          term: "上下文",
          definition: "上下文是模型当前能够读取的信息范围。",
          relevance: "检索材料需要进入上下文才能影响回答。",
          terms: ["模型"],
        },
        {
          term: "RAG",
          definition: "RAG 会先执行检索并取得材料。",
          relevance: "它为当前回答提供可检查的知识范围。",
          terms: ["检索"],
        },
      ],
    },
    inputs,
  );
  assert.match(parsed[0].definition, /^RAG/u);
  assert.match(parsed[1].definition, /^上下文/u);

  assert.throws(
    () =>
      parseTermDefinitions(
        { definitions: [] },
        [termContext("RAG"), termContext("Agent", { nodeId: "another-node" })],
      ),
    /同一个节点/,
  );
});

test("deep explanation contract validates request, literal terms, and math preference", () => {
  const context = {
    subject: "残差连接",
    question: "Transformer 架构是什么？",
    path: ["Transformer", "残差连接"],
    scene: {
      title: "残差连接",
      summary: "残差连接帮助深层网络保留原始信息。",
      detail: "它把子层输入加入处理结果，使训练更稳定。",
    },
    allowMath: false,
  };
  const draft = {
    directAnswer: "残差连接会把子层输入加入处理结果。",
    background: "深层网络连续转换信息时，早期信号可能逐层变弱。",
    role: "它为注意力层和前馈网络保留较短的信息路径。",
    mechanism: "子层只需学习修正量，原始信息沿旁路继续传递。",
    boundary: "它改善训练稳定性，但不能替代合理的网络设计。",
    terms: ["前馈网络"],
  };

  const explanation = createDeepExplanation(
    context,
    "node-residual",
    "high",
    "model_knowledge",
    draft,
  );
  assert.equal(explanation.protocol, "visual-deep-explanation/1");
  assert.deepEqual(parseDeepExplanation(draft, context), draft);
  assert.deepEqual(
    parseDeepExplanationRequest({
      nodeId: "node-residual",
      selection: "残差连接",
      parentExplanation: null,
    }),
    {
      nodeId: "node-residual",
      selection: "残差连接",
      parentExplanation: null,
      parentDeepExplanation: null,
    },
  );

  assert.throws(
    () =>
      parseDeepExplanation(
        {
          ...draft,
          mechanism: "它直接计算 FFN(x)=x+1，再把结果向后传递。",
        },
        context,
      ),
    /公式后必须紧跟通俗解释/,
  );
  assert.throws(
    () => parseDeepExplanation({ ...draft, terms: ["未出现术语"] }, context),
    /没有逐字出现/,
  );
});

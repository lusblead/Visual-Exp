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
  assembleVisualDocument,
  assembleVisualOperations,
  createSceneDraftExample,
  expansionSceneDraftExample,
  parseCreateSceneDraft,
  parseExpansionSceneDraft,
  remainingExpansionCapacity,
} = await import("../lib/deepseek-draft-contract.ts");
const {
  parseVisualDocument,
} = await import("../lib/visual-contract-parse.ts");
const {
  applyVisualOperations,
} = await import("../lib/visual-operation-apply.ts");

test("create assembly owns deterministic IDs and resolves relation indexes locally", () => {
  const candidate = structuredClone(createSceneDraftExample);
  candidate.relations = [
    {
      fromIndex: 2,
      toIndex: 0,
      kind: "supports",
      label: "恢复依赖错峰失效",
    },
    {
      fromIndex: 2,
      toIndex: 0,
      kind: "supports",
      label: "恢复依赖错峰失效",
    },
  ];
  const draft = parseCreateSceneDraft(candidate);

  const first = assembleVisualDocument("缓存雪崩应该如何治理？", draft);
  const second = assembleVisualDocument("缓存雪崩应该如何治理？", draft);

  assert.deepEqual(second, first);
  assert.match(first.id, /^visual_[a-z0-9]+$/u);
  assert.equal(new Set(first.nodes.map((node) => node.id)).size, first.nodes.length);
  assert.equal(first.relations.length, 1, "identical draft relations are deduplicated");
  assert.equal(first.relations[0].scopeId, first.rootId);
  assert.equal(first.relations[0].from, first.nodes[3].id);
  assert.equal(first.relations[0].to, first.nodes[1].id);
  const root = first.nodes.find((node) => node.id === first.rootId);
  assert.ok(root);
  assert.equal(root.summary, candidate.root.orientation.directAnswer);
  assert.deepEqual(
    root.detail.split("\n\n"),
    [
      candidate.root.orientation.background,
      candidate.root.orientation.role,
      candidate.root.orientation.mechanism,
      candidate.root.orientation.boundary,
    ],
  );
  assert.equal(
    first.nodes[1].detail,
    `${candidate.children[0].whyHere}\n\n${candidate.children[0].detail}`,
  );
});

test("create assembly maps only provided stable search references into canonical evidence", () => {
  const candidate = structuredClone(createSceneDraftExample);
  candidate.root.evidenceRefs = ["S1"];
  candidate.children[0].evidenceRefs = ["S2"];
  const evidence = [
    {
      id: "S1",
      title: "官方发布说明",
      url: "https://example.com/release",
      snippet: "当前版本在本周发布。",
      publishedAt: "2026-07-30",
    },
    {
      id: "S2",
      title: "官方迁移指南",
      url: "https://example.com/migration",
      snippet: null,
      publishedAt: "2026-07-29",
    },
  ];

  const document = assembleVisualDocument(
    "当前版本有哪些变化？",
    parseCreateSceneDraft(candidate),
    evidence,
  );
  const root = document.nodes.find((node) => node.id === document.rootId);

  assert.ok(root);
  assert.equal(root.sourceStatus, "source_backed");
  assert.deepEqual(root.evidence, [
    {
      label: "官方发布说明",
      detail: "当前版本在本周发布。",
      url: "https://example.com/release",
    },
  ]);
  assert.equal(document.nodes[1].sourceStatus, "source_backed");
  assert.deepEqual(document.nodes[1].evidence, [
    {
      label: "官方迁移指南",
      detail: "发布于 2026-07-29",
      url: "https://example.com/migration",
    },
  ]);

  const unknown = structuredClone(createSceneDraftExample);
  unknown.root.evidenceRefs = ["S5"];
  assert.throws(
    () =>
      assembleVisualDocument(
        "当前版本有哪些变化？",
        parseCreateSceneDraft(unknown),
        evidence,
      ),
    /未提供的搜索结果 S5/u,
  );
});

test("malformed term annotations are bounded and safely discarded", () => {
  const candidate = structuredClone(createSceneDraftExample);
  candidate.root.orientation.mechanism +=
    " 回源、Straße 与 STRASSE 在这里同时出现，用于验证规范化后的术语身份。";
  candidate.root.terms = [
    null,
    42,
    " ",
    "不存在术语",
    "缓存雪崩",
    " 缓存雪崩 ",
    "Straße",
    "STRASSE",
    "超".repeat(41),
    "跨行\n术语",
    "回源",
    "另一个不存在术语",
    "治理",
  ];
  candidate.children[0].terms = { malformed: true };

  const draft = parseCreateSceneDraft(candidate);
  const document = assembleVisualDocument("缓存雪崩应该如何治理？", draft);
  const root = document.nodes.find((node) => node.id === document.rootId);
  const firstChild = document.nodes.find(
    (node) => node.parentId === document.rootId,
  );

  assert.ok(root);
  assert.ok(firstChild);
  assert.deepEqual(root.terms, ["缓存雪崩", "Straße", "回源"]);
  assert.deepEqual(firstChild.terms, []);
});

test("relation indexes reject missing children and self edges", () => {
  const outOfRange = structuredClone(createSceneDraftExample);
  outOfRange.relations = [
    {
      fromIndex: 0,
      toIndex: outOfRange.children.length,
      kind: "supports",
      label: "越界",
    },
  ];
  assert.throws(
    () => parseCreateSceneDraft(outOfRange),
    /toIndex/u,
  );

  const selfEdge = structuredClone(createSceneDraftExample);
  selfEdge.relations = [
    {
      fromIndex: 1,
      toIndex: 1,
      kind: "supports",
      label: "自连接",
    },
  ];
  assert.throws(
    () => parseCreateSceneDraft(selfEdge),
    /不能连接同一个子节点/u,
  );
});

test("77 nodes can fill the document, while 78 through 80 reject before assembly", () => {
  const expansion = parseExpansionSceneDraft(
    structuredClone(expansionSceneDraftExample),
    3,
  );

  for (const nodeCount of [77, 78, 79, 80]) {
    const document = buildDocument({ nodeCount, targetDepth: 1 });
    const capacity = 80 - nodeCount;
    assert.equal(remainingExpansionCapacity(document), capacity);

    if (nodeCount === 77) {
      const batch = assembleVisualOperations(document, "target", expansion);
      const additions = addedNodes(batch);
      assert.equal(additions.length, 3);
      assert.ok(
        additions.every(
          (node) =>
            node.expansionState === "terminal" &&
            node.expandable === false,
        ),
      );
      assert.equal(applyVisualOperations(document, batch).nodes.length, 80);
      continue;
    }

    assert.throws(
      () =>
        parseExpansionSceneDraft(
          structuredClone(expansionSceneDraftExample),
          capacity,
        ),
      /剩余容量不足 3 个节点/u,
    );
    assert.throws(
      () => assembleVisualOperations(document, "target", expansion),
      /剩余容量不足 3 个节点/u,
    );
  }
});

test("depth 11 creates terminal depth-12 nodes and depth 12 cannot expand", () => {
  const expansion = parseExpansionSceneDraft(
    structuredClone(expansionSceneDraftExample),
  );
  const depthEleven = buildDocument({ nodeCount: 12, targetDepth: 11 });

  const batch = assembleVisualOperations(depthEleven, "target", expansion);
  const additions = addedNodes(batch);
  assert.equal(additions.length, 3);
  assert.ok(
    additions.every(
      (node) =>
        node.depth === 12 &&
        node.expansionState === "terminal" &&
        node.expandable === false,
    ),
  );
  assert.doesNotThrow(() => applyVisualOperations(depthEleven, batch));

  const depthTwelve = buildDocument({ nodeCount: 13, targetDepth: 12 });
  assert.throws(
    () => assembleVisualOperations(depthTwelve, "target", expansion),
    /最大深度 12/u,
  );
});

test("expansion node and relation IDs stay deterministic and avoid existing IDs", () => {
  const document = buildDocument({
    nodeCount: 6,
    targetDepth: 1,
    version: 7,
    firstFillerId: "node_8_1",
    existingRelationId: "relation_8_1",
  });
  const candidate = structuredClone(expansionSceneDraftExample);
  candidate.relations = [
    candidate.relations[0],
    structuredClone(candidate.relations[0]),
    candidate.relations[1],
  ];
  const draft = parseExpansionSceneDraft(candidate);

  const first = assembleVisualOperations(document, "target", draft);
  const second = assembleVisualOperations(document, "target", draft);
  assert.deepEqual(second, first);

  const additions = addedNodes(first);
  assert.deepEqual(
    additions.map((node) => node.id),
    ["node_8_1_2", "node_8_2", "node_8_3"],
  );

  const relations = first.operations
    .filter((operation) => operation.kind === "add_relation")
    .map((operation) => operation.relation);
  assert.equal(relations.length, 2, "duplicate indexed relations are deduplicated");
  assert.deepEqual(
    relations.map((relation) => relation.id),
    ["relation_8_1_2", "relation_8_2"],
  );
  assert.deepEqual(
    relations.map((relation) => [relation.from, relation.to]),
    [
      [additions[0].id, additions[1].id],
      [additions[1].id, additions[2].id],
    ],
  );
  assert.doesNotThrow(() => applyVisualOperations(document, first));
});

function addedNodes(batch) {
  return batch.operations
    .filter((operation) => operation.kind === "add_node")
    .map((operation) => operation.node);
}

function buildDocument({
  nodeCount,
  targetDepth,
  version = 1,
  firstFillerId = null,
  existingRelationId = null,
}) {
  assert.ok(targetDepth >= 1 && targetDepth <= 12);
  assert.ok(nodeCount >= targetDepth + 1 && nodeCount <= 80);

  const nodes = [];
  const nodeIds = new Set();
  const root = makeNode("root", null, 0);
  nodes.push(root);
  nodeIds.add(root.id);

  let chainParent = root;
  for (let depth = 1; depth <= targetDepth; depth += 1) {
    const id = depth === targetDepth ? "target" : `chain_${depth}`;
    const node = makeNode(id, chainParent.id, depth);
    chainParent.childIds.push(id);
    nodes.push(node);
    nodeIds.add(id);
    chainParent = node;
  }

  const parentQueue = nodes.filter(
    (node) => node.id !== "target" && node.depth < 12,
  );
  let fillerIndex = 0;
  while (nodes.length < nodeCount) {
    const parent = parentQueue.find((node) => node.childIds.length < 8);
    assert.ok(parent, "fixture must have capacity for another valid node");
    fillerIndex += 1;
    let id =
      fillerIndex === 1 && firstFillerId
        ? firstFillerId
        : `filler_${fillerIndex}`;
    while (nodeIds.has(id)) {
      fillerIndex += 1;
      id = `filler_${fillerIndex}`;
    }
    const child = makeNode(id, parent.id, parent.depth + 1);
    parent.childIds.push(id);
    nodes.push(child);
    nodeIds.add(id);
    if (child.depth < 12) parentQueue.push(child);
  }

  for (const node of nodes) {
    if (node.childIds.length > 0) {
      node.expandable = true;
      node.expansionState = "expanded";
    } else if (node.id === "target") {
      node.expandable = true;
      node.expansionState = "outline";
    } else {
      node.expandable = false;
      node.expansionState = "terminal";
    }
  }

  const relations = [];
  if (existingRelationId) {
    assert.ok(root.childIds.length >= 2);
    relations.push({
      id: existingRelationId,
      scopeId: root.id,
      from: root.childIds[0],
      to: root.childIds[1],
      kind: "supports",
      label: "已有关系",
    });
  }

  return parseVisualDocument({
    protocol: "visual-explanation-document/2",
    id: "fixture_document",
    question: "用于验证 DeepSeek 草稿装配边界的问题",
    title: "DeepSeek 草稿装配边界",
    thesis: "本测试文档覆盖容量、深度、标识符和关系索引的不变量。",
    rootId: root.id,
    nodes,
    relations,
    version,
  });
}

function makeNode(id, parentId, depth) {
  return {
    id,
    parentId,
    title: `测试节点 ${id}`,
    eyebrow: "测试",
    summary: "这是用于容量和深度边界验证的完整摘要。",
    detail:
      "这是用于构建有效语义文档的详细说明，包含足够的事实性文本以验证草稿装配边界。",
    terms: [],
    kind: depth === 0 ? "topic" : "concept",
    view: "grid",
    depth,
    childIds: [],
    expandable: false,
    expansionState: "terminal",
    emphasis: depth === 0 ? "primary" : "secondary",
    confidence: "medium",
    sourceStatus: "model_knowledge",
    evidence: [],
  };
}

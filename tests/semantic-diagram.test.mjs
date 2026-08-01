import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildOpeningConceptMermaid } from "../lib/opening-concept-diagram.ts";

const componentUrl = new URL("../components/semantic-diagram.tsx", import.meta.url);
const openingComponentUrl = new URL(
  "../components/opening-concept-diagram.tsx",
  import.meta.url,
);
const stageUrl = new URL("../components/lineage-stage.tsx", import.meta.url);

test("semantic diagram is a renderer-owned projection of canonical scene data", async () => {
  const component = await readFile(componentUrl, "utf8");

  assert.match(component, /view:\s*ExplanationView/);
  assert.match(component, /orderedChildIds:\s*readonly string\[\]/);
  assert.match(component, /nodes:\s*readonly VisualNode\[\]/);
  assert.match(component, /relations:\s*readonly VisualRelation\[\]/);
  assert.match(component, /orderedChildIds[\s\S]*?nodeById\.get/);
  assert.match(component, /visibleRelations = relations\.filter/);
  assert.doesNotMatch(
    component,
    /dangerouslySetInnerHTML|innerHTML|mermaid|<svg|<iframe|\bx\s*=|\by\s*=|\bstyle\s*=/i,
  );
});

test("semantic diagram never invents relation rows and falls back when projection is not useful", async () => {
  const component = await readFile(componentUrl, "utf8");

  assert.match(
    component,
    /orderedNodes\.length < 2[\s\S]*?!DIAGRAM_VIEWS\.has\(view\) && visibleRelations\.length === 0[\s\S]*?return null/,
  );
  assert.match(
    component,
    /\{visibleRelations\.length > 0 \? \([\s\S]*?visibleRelations\.map\(/,
  );
  assert.doesNotMatch(component, /relations\.push|syntheticRelation|inferRelation/);
});

test("diagram navigation is accessible and the full linear explanation remains authoritative", async () => {
  const [component, stage] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(stageUrl, "utf8"),
  ]);

  assert.match(component, /aria-labelledby=\{headingId\}/);
  assert.match(component, /aria-label=\{`进入 \$\{node\.title\}`\}/);
  assert.match(component, /onClick=\{\(\) => void onEnter\(node\)\}/);
  assert.match(component, /aria-label="当前层级的语义关系"/);
  assert.match(
    stage,
    /<SemanticDiagram[\s\S]*?<ol[\s\S]*?className="network-node-list"/,
  );
  assert.match(stage, /<KnowledgeSection[\s\S]*?onExplain=\{onExplain\}/);
});

test("opening Mermaid source is deterministic bounded and syntax safe", () => {
  const root = { id: "root", title: "Agent 总览", view: "network" };
  const nodes = [
    { id: "ignored", title: "不应出现" },
    { id: "b", title: "检索 %%{init: bad} <script>" },
    { id: "a", title: "规划\n与执行" },
    { id: "c", title: '回答 "][click root callback]' },
  ];
  const relations = [
    {
      id: "valid",
      scopeId: "root",
      from: "a",
      to: "b",
      kind: "sequence",
      label: "先后 | click bad",
    },
    {
      id: "wrong-scope",
      scopeId: "other",
      from: "b",
      to: "c",
      kind: "supports",
      label: "不应出现",
    },
    {
      id: "hidden-endpoint",
      scopeId: "root",
      from: "ignored",
      to: "a",
      kind: "relates",
      label: "不应出现",
    },
  ];
  const input = {
    root,
    orderedChildIds: ["a", "b", "c"],
    nodes,
    relations,
  };

  const first = buildOpeningConceptMermaid(input);
  const second = buildOpeningConceptMermaid(input);
  assert.equal(first, second);
  assert.equal(
    first,
    [
      "flowchart LR",
      '    R(["Agent 总览"])',
      '    N1["规划 与执行"]',
      "    R --> N1",
      '    N2["检索 init: bad script"]',
      "    R --> N2",
      '    N3["回答 click root callback"]',
      "    R --> N3",
      "    N1 -->|先后 click bad| N2",
    ].join("\n"),
  );
  assert.doesNotMatch(first, /%%|<script|^\s*click\s|wrong-scope|不应出现/mu);

  const manyNodes = Array.from({ length: 12 }, (_, index) => ({
    id: `child-${index}`,
    title: `节点 ${index}`,
  }));
  const bounded = buildOpeningConceptMermaid({
    root,
    orderedChildIds: manyNodes.map((node) => node.id),
    nodes: manyNodes,
    relations: [],
  });
  assert.equal((bounded?.match(/^    N\d+\["/gmu) ?? []).length, 8);
});

test("root scenes use the Mermaid concept graph while deeper scenes keep the semantic projection", async () => {
  const [openingComponent, stage] = await Promise.all([
    readFile(openingComponentUrl, "utf8"),
    readFile(stageUrl, "utf8"),
  ]);

  assert.match(openingComponent, /import\("mermaid"\)/);
  assert.match(openingComponent, /securityLevel:\s*"strict"/);
  assert.match(openingComponent, /htmlLabels:\s*false/);
  assert.match(openingComponent, /new Blob\(\[svg\]/);
  assert.match(openingComponent, /URL\.revokeObjectURL/);
  assert.doesNotMatch(
    openingComponent,
    /dangerouslySetInnerHTML|innerHTML|<svg|<iframe/i,
  );
  assert.match(
    stage,
    /activeNode\.depth === 0 && childNodes\.length > 1[\s\S]*?<OpeningConceptDiagram/,
  );
  assert.match(
    stage,
    /activeNode\.depth > 0[\s\S]*?<SemanticDiagram/,
  );
  assert.match(stage, /<ol[\s\S]*?className="network-node-list"/);
});

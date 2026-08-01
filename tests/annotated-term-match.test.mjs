import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateTerms,
  containsAnnotatedTerm,
  findAnnotatedTermMatches,
} from "../lib/annotated-term-match.mjs";
import { assertVisualNodeTerms } from "../lib/visual-content-quality.ts";

test("single Han terms require a semantic boundary without breaking long or ASCII matching", () => {
  const text = "这是关键步骤。查询、键和值向量需要分别处理。";
  const matches = findAnnotatedTermMatches(text, ["键"]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].start, text.indexOf("键和值"));
  assert.equal(text.slice(matches[0].start, matches[0].end), "键");
  assert.equal(containsAnnotatedTerm("关键、主键、按键、键值、键盘", "键"), false);

  const chinese = findAnnotatedTermMatches("自注意力依赖注意力", [
    "注意力",
    "自注意力",
  ]);
  assert.deepEqual(
    chinese.map((match) => ({
      text: "自注意力依赖注意力".slice(match.start, match.end),
      term: match.term,
    })),
    [
      { text: "自注意力", term: "自注意力" },
      { text: "注意力", term: "注意力" },
    ],
  );

  const englishText = "Agent AGENT agentic superAgent RAG";
  assert.deepEqual(
    findAnnotatedTermMatches(englishText, ["Agent", "RAG"]).map((match) =>
      englishText.slice(match.start, match.end),
    ),
    ["Agent", "AGENT", "RAG"],
  );
});

test("single Han terms remain interactive in explicitly delimited semantic positions", () => {
  const text = "键、值；“键”与值；查询、键和值向量。";
  const fragments = annotateTerms(text, ["键"]);

  assert.deepEqual(
    fragments.filter((fragment) => fragment.term).map((fragment) => fragment.text),
    ["键", "键", "键"],
  );
});

test("content validation and DOM splitting share the same boundary rule", () => {
  assert.throws(() =>
    assertVisualNodeTerms({
      title: "关键步骤",
      summary: "关键步骤决定后续处理。",
      detail: "这里的关键步骤需要先确认输入，再执行后续计算。",
      terms: ["键"],
    }),
  );

  assert.doesNotThrow(() =>
    assertVisualNodeTerms({
      title: "查询、键和值向量",
      summary: "查询、键和值向量承担不同职责。",
      detail: "注意力会比较查询、键和值向量，再组合相关信息。",
      terms: ["键"],
    }),
  );
});

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
  parsePrimaryMaterial,
  resolvePrimaryMaterial,
} = await import("../lib/primary-material.ts");

test("primary material distinguishes complete excerpt and unavailable content", () => {
  const complete = parsePrimaryMaterial({
    protocol: "visual-primary-material/1",
    kind: "poem",
    title: "示例",
    creator: "作者",
    display: "complete",
    provenance: "public_domain_verified",
    body: "第一行\n第二行",
    attribution: "可信公共领域语料",
    sourceUrl: "https://example.com/source",
    omissionReason: null,
  });
  const excerpt = parsePrimaryMaterial({
    protocol: "visual-primary-material/1",
    kind: "passage",
    title: "受保护作品",
    creator: null,
    display: "excerpt",
    provenance: "protected",
    body: "为理解当前问题所需的短摘录。",
    attribution: "必要短摘录",
    sourceUrl: null,
    omissionReason: null,
  });
  const unavailable = parsePrimaryMaterial({
    protocol: "visual-primary-material/1",
    kind: "other",
    title: "未知作品",
    creator: null,
    display: "unavailable",
    provenance: "unknown",
    body: null,
    attribution: "尚无可验证来源",
    sourceUrl: null,
    omissionReason: "不能从模型记忆重构。",
  });

  assert.equal(complete?.display, "complete");
  assert.equal(excerpt?.display, "excerpt");
  assert.equal(unavailable?.display, "unavailable");
  assert.equal(unavailable?.body, null);
});

test("complete material fails closed when provenance does not permit reproduction", () => {
  assert.throws(
    () =>
      parsePrimaryMaterial({
        protocol: "visual-primary-material/1",
        kind: "passage",
        title: "受保护作品",
        creator: null,
        display: "complete",
        provenance: "protected",
        body: "不能作为完整正文采用。",
        attribution: "模型记忆",
        sourceUrl: null,
        omissionReason: null,
      }),
    /complete primary material requires/u,
  );
});

test("resolver shows verified originals and never invents an unavailable work", () => {
  const poem = resolvePrimaryMaterial("李白的《静夜思》怎么看？");
  const unknown = resolvePrimaryMaterial("《不存在于本地语料的作品》怎么解读？");

  assert.equal(poem?.display, "complete");
  assert.match(poem?.body ?? "", /床前明月光/u);
  assert.equal(unknown?.display, "unavailable");
  assert.equal(unknown?.body, null);
  assert.match(unknown?.omissionReason ?? "", /不会让模型伪造原文/u);
});

test("a fenced user source is retained literally and classified as user supplied", () => {
  const supplied = resolvePrimaryMaterial(
    "请解释这段代码：\n```ts\nconst answer = 42;\n```",
  );
  assert.equal(supplied?.kind, "code");
  assert.equal(supplied?.provenance, "user_supplied");
  assert.equal(supplied?.body, "const answer = 42;");
});

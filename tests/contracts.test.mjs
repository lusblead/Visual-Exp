import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("visual document protocol supports recursive semantic scenes instead of four fixed stages", async () => {
  const schema = JSON.parse(await read("schemas/visual-lineage-document.schema.json"));
  const node = schema.$defs.node.properties;

  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.protocol.const, "visual-explanation-document/2");
  assert.ok("rootId" in schema.properties);
  assert.ok("primaryMaterial" in schema.properties);
  assert.deepEqual(schema.$defs.primaryMaterial.properties.display.enum, [
    "complete",
    "excerpt",
    "unavailable",
  ]);
  assert.ok(!("html" in schema.$defs.primaryMaterial.properties));
  assert.ok(!("style" in schema.$defs.primaryMaterial.properties));
  assert.ok(!("lineageType" in schema.properties));
  assert.ok(!("stageLabels" in schema.properties));
  assert.ok(!("stageQuestions" in schema.properties));

  assert.ok("parentId" in node);
  assert.ok("depth" in node);
  assert.ok("childIds" in node);
  assert.ok("terms" in node);
  assert.equal(node.terms.maxItems, 8);
  assert.ok(schema.$defs.node.required.includes("terms"));
  assert.deepEqual(node.view.enum, ["grid", "sequence", "timeline", "compare", "cluster"]);
  assert.ok(!("generation" in node));
  assert.ok(!("x" in node));
  assert.ok(!("y" in node));
  assert.ok(!("style" in node));
});

test("incremental operation protocol mutates semantic nodes and relations only", async () => {
  const schema = JSON.parse(await read("schemas/visual-lineage-operations.schema.json"));
  const operation = schema.properties.operations.items;
  const patch = operation.properties.patch.anyOf[0];

  assert.equal(schema.properties.protocol.const, "visual-explanation-operations/2");
  assert.deepEqual(operation.properties.kind.enum, [
    "add_node",
    "add_relation",
    "update_node",
  ]);
  assert.deepEqual(operation.required, ["kind", "node", "relation", "nodeId", "patch"]);
  assert.ok("terms" in patch.properties);
  assert.ok(patch.required.includes("terms"));
  assert.doesNotMatch(JSON.stringify(schema), /"x"|"y"|"fontSize"|"color"/);
});

test("model prompts preserve one-layer generation and beginner-first linear explanation", async () => {
  const [deepseek, openai, demo] = await Promise.all([
    read("lib/deepseek-model.ts"),
    read("lib/openai-model.ts"),
    read("lib/demo-model.ts"),
  ]);

  for (const adapter of [deepseek, openai]) {
    assert.match(adapter, /3 到 6 个一级/);
    assert.match(adapter, /不要提前生成第二层|不生成第二层|不能生成 depth 大于 1/);
    assert.match(adapter, /grid/);
    assert.match(adapter, /sequence/);
    assert.match(adapter, /timeline/);
    assert.match(adapter, /compare/);
    assert.match(adapter, /cluster/);
    assert.match(adapter, /orientation/);
    assert.match(adapter, /whyHere/);
    assert.match(adapter, /直接答案/);
    assert.match(adapter, /背景/);
    assert.match(adapter, /作用/);
    assert.match(adapter, /机制/);
    assert.match(adapter, /边界/);
    assert.match(adapter, /线性|阅读顺序/);
    assert.match(adapter, /首个技术名词|第一个技术名词/);
    assert.match(adapter, /禁止公式|不得输出公式/);
    assert.match(adapter, /最多 8 个/);
    assert.match(adapter, /terms/);
    assert.match(adapter, /Agent/);
    assert.match(adapter, /RAG/);
  }

  assert.match(deepseek, /语义规划器|线性阅读场景/);
  assert.match(deepseek, /完整 JSON 示例/);
  assert.match(deepseek, /assembleVisualDocument/);
  assert.match(deepseek, /assembleVisualOperations/);
  assert.match(deepseek, /thinking:\s*\{\s*type:\s*"disabled"/);
  assert.match(openai, /assembleVisualOperations/);

  assert.match(demo, /createDemoExplanation/);
  assert.match(demo, /expandDemoExplanation/);
  assert.match(demo, /parentId/);
  assert.doesNotMatch(demo, /LineageGeneration|stageLabels/);
});

test("provider port keeps server-only provider selection and compatibility alias", async () => {
  const [port, env] = await Promise.all([read("lib/model-port.ts"), read(".env.example")]);

  assert.match(port, /EXPLANATION_MODEL_PROVIDER/);
  assert.match(port, /LINEAGE_MODEL_PROVIDER/);
  assert.match(port, /process\.env\.DEEPSEEK_API_KEY/);
  assert.match(port, /process\.env\.OPENAI_API_KEY/);
  assert.match(port, /companionTransport/);
  assert.match(port, /const modelName = "deepseek-v4-pro"/);
  assert.doesNotMatch(port, /process\.env\.DEEPSEEK_MODEL/);
  assert.match(port, /new DemoVisualModel/);
  assert.doesNotMatch(env, /^NEXT_PUBLIC_/m);
});

test("DeepSeek failures use typed safe errors and bounded retry policy", async () => {
  const [adapter, errors, route] = await Promise.all([
    read("lib/deepseek-model.ts"),
    read("lib/provider-errors.ts"),
    read("app/api/lineage/route.ts"),
  ]);

  assert.match(adapter, /providerHttpError/);
  assert.match(adapter, /requestProviderCompletion/);
  assert.match(adapter, /buildContentRepairPrompt/);
  assert.match(adapter, /providerAttempt === 2/);
  assert.match(adapter, /phase:\s*"repair"/);
  assert.doesNotMatch(adapter, /payload\.error\?\.message/);
  assert.match(errors, /credential_required/);
  assert.match(errors, /provider_auth_failed/);
  assert.match(errors, /provider_insufficient_balance/);
  assert.match(errors, /provider_invalid_parameters/);
  assert.match(errors, /provider_content_filtered/);
  assert.match(errors, /provider_insufficient_resources/);
  assert.match(errors, /provider_rate_limited/);
  assert.match(route, /error instanceof ModelProviderError/);
  assert.doesNotMatch(route, /message:\s*error instanceof Error \? error\.message/);
});

test("API creates a root scene and expands only a selected node", async () => {
  const route = await read("app/api/lineage/route.ts");

  assert.match(route, /action === "create"/);
  assert.match(route, /action === "expand"/);
  assert.match(route, /action === "define_batch"/);
  assert.match(route, /action === "dive"/);
  assert.match(route, /applyVisualOperations/);
  assert.match(route, /focusNodeId: document\.rootId/);
  assert.match(route, /node\.childIds\.length > 0/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.doesNotMatch(route, /lineageType|parseLineageType/);
});

test("explanation protocols keep model routing and trusted request boundaries explicit", async () => {
  const [route, port, term, deep] = await Promise.all([
    read("app/api/lineage/route.ts"),
    read("lib/model-port.ts"),
    read("lib/term-explanation.ts"),
    read("lib/deep-explanation.ts"),
  ]);

  assert.match(term, /visual-term-explanation\/2/);
  assert.match(term, /MAX_TERM_EXPLANATION_DEPTH = 4/);
  assert.match(term, /MAX_TERM_BATCH_SIZE = 8/);
  assert.match(deep, /visual-deep-explanation\/1/);
  assert.match(deep, /selection.{0,24}600/s);
  assert.match(port, /defineTerms/);
  assert.match(port, /deepDive/);
  assert.match(route, /parseOptionalParentExplanation/);
  assert.match(route, /containsNormalizedSelection/);
  assert.match(route, /safeGeneratedSourceStatus/);
});

test("source safety still rejects invented evidence", async () => {
  const [safety, deepseekPrompt, docs] = await Promise.all([
    read("lib/source-safety.ts"),
    read("lib/deepseek-model.ts"),
    read("docs/lineage-mvp.md"),
  ]);

  assert.match(safety, /assertCreateHasNoFabricatedSources/);
  assert.match(safety, /未经输入文档确认的来源/);
  assert.match(deepseekPrompt, /不得伪造来源/);
  assert.match(docs, /递归场景/);
  assert.match(docs, /语义缩放/);
});

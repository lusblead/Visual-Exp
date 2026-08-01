import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the minimal visual conversation entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>[^<]*Visualized Exp[^<]*<\/title>/i);
  assert.match(html, /请输入你的问题/);
  assert.match(html, /question-shell is-centered/);
  assert.doesNotMatch(html, /结构地图|理解体验|文档 v|LEVEL 0|主题网格/);
  assert.doesNotMatch(html, /provider-status|outline-panel|guide-panel|view-menu/);
  assert.doesNotMatch(html, /Codex is working|Your site is taking shape/);
});

test("keeps one minimal controller and removes workspace navigation from the render path", async () => {
  await assert.rejects(access(new URL("app/_sites-preview/", projectRoot)));

  const [page, layout, controller, stage, primitives, styles, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("components/lineage-studio.tsx", projectRoot), "utf8"),
    readFile(new URL("components/lineage-stage.tsx", projectRoot), "utf8"),
    readFile(new URL("components/lineage-scene-primitives.tsx", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);
  const components = `${controller}\n${stage}\n${primitives}`;

  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.match(layout, /Visualized Exp/);
  assert.match(controller, /createExplorationHistory/);
  assert.match(controller, /moveInHistory/);
  assert.match(controller, /explainTerm/);
  assert.match(controller, /documentRequestEpoch/);
  assert.match(stage, /knowledge-network/);
  assert.match(primitives, /knowledge-term/);
  assert.match(primitives, /knowledge-enter/);
  assert.match(styles, /styles\/responsive\.css/);
  assert.doesNotMatch(controller, /OutlinePanel|GuidePanel|viewOverrides|outlineOpen/);
  assert.doesNotMatch(stage, /breadcrumbs|view-menu|starter-row|scene-footer/);
  assert.doesNotMatch(components, /nodesByGeneration|stageLabels|第 4 代/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|drizzle/);
});

test("allows the document to shrink below 320 CSS pixels when a classic scrollbar is present", async () => {
  const styleDirectory = new URL("app/styles/", projectRoot);
  const styleFiles = await readdir(styleDirectory);
  const styles = (
    await Promise.all(
      styleFiles
        .filter((file) => file.endsWith(".css"))
        .map((file) => readFile(new URL(file, styleDirectory), "utf8")),
    )
  ).join("\n");

  assert.doesNotMatch(
    styles,
    /(?:html|body|\.visual-app)\s*\{[^}]*\bmin-width\s*:\s*320px\b/is,
  );
  assert.doesNotMatch(
    styles,
    /\.(?:question-shell|model-settings-dialog)[^{]*\{[^}]*\bwidth\s*:\s*calc\(100vw\b/is,
  );
});

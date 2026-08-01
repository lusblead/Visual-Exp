import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScenePrefetchQueue,
  scenePreparationKey,
} from "../lib/scene-prefetch-priority.mjs";

test("scene prefetch includes only the active semantic frontier", () => {
  const document = createDocument([
    node({ id: "root", parentId: null, depth: 0, childIds: ["a", "b", "c", "terminal"] }),
    node({ id: "a", parentId: "root", depth: 1 }),
    node({ id: "b", parentId: "root", depth: 1, childIds: ["b-1"] }),
    node({ id: "b-1", parentId: "b", depth: 2 }),
    node({ id: "c", parentId: "root", depth: 1 }),
    node({ id: "terminal", parentId: "root", depth: 1, expandable: false, expansionState: "terminal" }),
  ]);

  assert.deepEqual(
    buildScenePrefetchQueue(document, "root").map((item) => item.nodeId),
    ["a", "c"],
  );
  assert.deepEqual(buildScenePrefetchQueue(document, "b"), [
    {
      key: scenePreparationKey(document, document.nodes[3]),
      documentId: document.id,
      nodeId: "b-1",
      parentId: "b",
      depth: 2,
    },
  ]);
});

test("scene prefetch excludes failed identities without coupling to document version", () => {
  const document = createDocument([
    node({ id: "root", parentId: null, depth: 0, childIds: ["a", "b"] }),
    node({ id: "a", parentId: "root", depth: 1 }),
    node({ id: "b", parentId: "root", depth: 1 }),
  ]);
  const failed = scenePreparationKey(document, document.nodes[1]);

  assert.deepEqual(
    buildScenePrefetchQueue(document, "root", { failedKeys: [failed] }).map(
      (item) => item.nodeId,
    ),
    ["b"],
  );

  const versionOnly = structuredClone(document);
  versionOnly.version += 1;
  assert.equal(scenePreparationKey(versionOnly, versionOnly.nodes[1]), failed);

  const changed = structuredClone(document);
  changed.nodes[1].detail += " 已更新";
  assert.notEqual(scenePreparationKey(changed, changed.nodes[1]), failed);
});

test("scene prefetch stops at depth and capacity boundaries", () => {
  const deep = createDocument([
    node({ id: "root", parentId: null, depth: 11, childIds: ["depth-12"] }),
    node({ id: "depth-12", parentId: "root", depth: 12 }),
  ]);
  assert.deepEqual(buildScenePrefetchQueue(deep, "root"), []);

  const full = createDocument([
    node({ id: "root", parentId: null, depth: 0, childIds: ["a"] }),
    node({ id: "a", parentId: "root", depth: 1 }),
    ...Array.from({ length: 76 }, (_, index) =>
      node({ id: `filler-${index}`, parentId: null, depth: 1, expandable: false }),
    ),
  ]);
  assert.equal(full.nodes.length, 78);
  assert.deepEqual(buildScenePrefetchQueue(full, "root"), []);
});

function createDocument(nodes) {
  return {
    protocol: "visual-explanation-document/2",
    id: "visual_scene_prefetch",
    version: 1,
    rootId: nodes[0].id,
    nodes,
  };
}

function node({
  id,
  parentId,
  depth,
  childIds = [],
  expandable = true,
  expansionState = "outline",
}) {
  return {
    id,
    parentId,
    depth,
    childIds,
    expandable,
    expansionState,
    title: id,
    summary: `${id} summary`,
    detail: `${id} detail`,
  };
}

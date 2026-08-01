import type {
  VisualOperationBatch,
} from "./visual-contract-types";
import {
  integer,
  oneOf,
  parseNode,
  parsePatch,
  parseRelation,
  record,
  stringValue,
} from "./visual-contract-parse";

export function parseVisualOperationBatch(value: unknown): VisualOperationBatch {
  const batch = record(value, "operations");
  if (batch.protocol !== "visual-explanation-operations/2") {
    throw new Error("operations.protocol 不受支持");
  }
  if (!Array.isArray(batch.operations) || batch.operations.length === 0) {
    throw new Error("operations.operations 至少需要一个操作");
  }
  if (batch.operations.length > 24) throw new Error("单次操作数量超过上限");

  return {
    protocol: "visual-explanation-operations/2",
    baseVersion: integer(batch.baseVersion, "operations.baseVersion", 1),
    operations: batch.operations.map((value, index) => {
      const path = `operations.operations[${index}]`;
      const operation = record(value, path);
      const kind = oneOf(
        operation.kind,
        ["add_node", "add_relation", "update_node"] as const,
        `${path}.kind`,
      );

      if (kind === "add_node") {
        if (operation.relation !== null || operation.nodeId !== null || operation.patch !== null) {
          throw new Error(`${path} 的 add_node 只能携带 node`);
        }
        return {
          kind,
          node: parseNode(operation.node, `${path}.node`),
          relation: null,
          nodeId: null,
          patch: null,
        };
      }

      if (kind === "add_relation") {
        if (operation.node !== null || operation.nodeId !== null || operation.patch !== null) {
          throw new Error(`${path} 的 add_relation 只能携带 relation`);
        }
        return {
          kind,
          node: null,
          relation: parseRelation(operation.relation, `${path}.relation`),
          nodeId: null,
          patch: null,
        };
      }

      if (operation.node !== null || operation.relation !== null) {
        throw new Error(`${path} 的 update_node 只能携带 nodeId 与 patch`);
      }
      return {
        kind,
        node: null,
        relation: null,
        nodeId: stringValue(operation.nodeId, `${path}.nodeId`),
        patch: parsePatch(operation.patch, `${path}.patch`),
      };
    }),
  };
}

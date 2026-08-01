import type { VisualDocument, VisualOperationBatch } from "./lineage-contracts";
import type { VisualSearchEvidence } from "./model-port";

/**
 * Visual model adapters never receive arbitrary browsing authority. Create may
 * receive bounded server-search evidence with stable IDs, but the model must not
 * manufacture or rewrite a source and label it verified.
 */
export function assertCreateHasNoFabricatedSources(
  document: VisualDocument,
  searchEvidence: readonly VisualSearchEvidence[] = [],
): void {
  const allowedEvidence = new Set(
    searchEvidence.map((source) =>
      evidenceFingerprint({
        label: source.title,
        detail:
          source.snippet?.trim()
          || (source.publishedAt
            ? `发布于 ${source.publishedAt}`
            : "联网搜索结果"),
        url: source.url,
      }),
    ),
  );
  for (const node of document.nodes) {
    if (node.sourceStatus === "source_backed" && node.evidence.length === 0) {
      throw new Error(`节点 ${node.id} 声称有来源但没有证据条目`);
    }
    if (node.sourceStatus !== "source_backed" && node.evidence.length > 0) {
      throw new Error(`节点 ${node.id} 的来源状态与证据条目不一致`);
    }
    for (const evidence of node.evidence) {
      if (!allowedEvidence.has(evidenceFingerprint(evidence))) {
        throw new Error(`节点 ${node.id} 引用了未提供的搜索证据`);
      }
    }
  }
  if (
    searchEvidence.length > 0
    && !document.nodes.some((node) => node.evidence.length > 0)
  ) {
    throw new Error("联网搜索证据已提供，但生成结果没有引用任何证据");
  }
}

export function assertExpansionHasNoFabricatedSources(
  document: VisualDocument,
  batch: VisualOperationBatch,
): void {
  const allowedEvidence = new Set(
    document.nodes.flatMap((node) =>
      node.evidence.map((evidence) => evidenceFingerprint(evidence)),
    ),
  );

  for (const operation of batch.operations) {
    if (operation.kind !== "add_node" || !operation.node) continue;
    const node = operation.node;
    for (const evidence of node.evidence) {
      if (!allowedEvidence.has(evidenceFingerprint(evidence))) {
        throw new Error(`节点 ${node.id} 引入了未经输入文档确认的来源`);
      }
    }
    if (node.sourceStatus === "source_backed" && node.evidence.length === 0) {
      throw new Error(`节点 ${node.id} 声称有来源但没有复用现有证据`);
    }
  }
}

function evidenceFingerprint(evidence: {
  label: string;
  detail: string;
  url: string | null;
}): string {
  return JSON.stringify([evidence.label, evidence.detail, evidence.url]);
}

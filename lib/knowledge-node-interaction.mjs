export function shouldEnterKnowledgeNode({
  targetIsInteractive,
  selectionType,
}) {
  return !targetIsInteractive && selectionType !== "Range";
}

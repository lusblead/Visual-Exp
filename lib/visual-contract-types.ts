export const EXPLANATION_VIEWS = [
  "grid",
  "sequence",
  "timeline",
  "compare",
  "cluster",
] as const;

export const VISUAL_NODE_KINDS = [
  "topic",
  "stage",
  "concept",
  "process",
  "system",
  "argument",
  "example",
  "evidence",
  "question",
] as const;

export const VISUAL_RELATION_KINDS = [
  "sequence",
  "supports",
  "contrasts",
  "causes",
  "part_of",
  "relates",
] as const;

export const EXPANSION_STATES = ["outline", "expanded", "terminal"] as const;
export const EMPHASIS_LEVELS = ["primary", "secondary", "detail"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const SOURCE_STATUSES = [
  "source_backed",
  "model_knowledge",
  "needs_source",
] as const;

export type ExplanationView = (typeof EXPLANATION_VIEWS)[number];
export type VisualNodeKind = (typeof VISUAL_NODE_KINDS)[number];
export type VisualRelationKind = (typeof VISUAL_RELATION_KINDS)[number];
export type ExpansionState = (typeof EXPANSION_STATES)[number];
export type Emphasis = (typeof EMPHASIS_LEVELS)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const PRIMARY_MATERIAL_KINDS = [
  "poem",
  "passage",
  "statute",
  "code",
  "other",
] as const;
export const PRIMARY_MATERIAL_DISPLAYS = [
  "complete",
  "excerpt",
  "unavailable",
] as const;
export const PRIMARY_MATERIAL_PROVENANCE = [
  "user_supplied",
  "public_domain_verified",
  "licensed",
  "protected",
  "unknown",
] as const;

export type PrimaryMaterialKind = (typeof PRIMARY_MATERIAL_KINDS)[number];
export type PrimaryMaterialDisplay = (typeof PRIMARY_MATERIAL_DISPLAYS)[number];
export type PrimaryMaterialProvenance =
  (typeof PRIMARY_MATERIAL_PROVENANCE)[number];

/**
 * A source object shown before interpretation. It contains content and
 * provenance only; the renderer owns every presentation choice.
 */
export interface PrimaryMaterial {
  protocol: "visual-primary-material/1";
  kind: PrimaryMaterialKind;
  title: string;
  creator: string | null;
  display: PrimaryMaterialDisplay;
  provenance: PrimaryMaterialProvenance;
  body: string | null;
  attribution: string;
  sourceUrl: string | null;
  omissionReason: string | null;
}

export interface VisualEvidence {
  label: string;
  detail: string;
  url: string | null;
}

/**
 * A node is both a piece of content and the entrance to another scene. The node
 * never stores coordinates, colors, font sizes, or component names. Those are
 * projections chosen by the renderer from semantic fields such as view/kind.
 */
export interface VisualNode {
  id: string;
  parentId: string | null;
  title: string;
  eyebrow: string;
  summary: string;
  detail: string;
  /**
   * Explicit terms that may receive an inline explanation in the renderer.
   * Terms are semantic annotations, never DOM ranges or pixel coordinates.
   */
  terms: string[];
  kind: VisualNodeKind;
  view: ExplanationView;
  depth: number;
  childIds: string[];
  expandable: boolean;
  expansionState: ExpansionState;
  emphasis: Emphasis;
  confidence: Confidence;
  sourceStatus: SourceStatus;
  evidence: VisualEvidence[];
}

/** Relations only connect direct children inside one scene. */
export interface VisualRelation {
  id: string;
  scopeId: string;
  from: string;
  to: string;
  kind: VisualRelationKind;
  label: string;
}

export interface VisualDocument {
  protocol: "visual-explanation-document/2";
  id: string;
  question: string;
  title: string;
  thesis: string;
  rootId: string;
  primaryMaterial?: PrimaryMaterial | null;
  nodes: VisualNode[];
  relations: VisualRelation[];
  version: number;
}

/**
 * All properties are present and nullable to remain compatible with strict JSON
 * schema output. Runtime validation still limits which fields may be non-null.
 */
export interface VisualNodePatch {
  title: string | null;
  eyebrow: string | null;
  summary: string | null;
  detail: string | null;
  terms: string[] | null;
  view: ExplanationView | null;
  expandable: boolean | null;
  expansionState: ExpansionState | null;
  emphasis: Emphasis | null;
}

export type VisualOperationKind = "add_node" | "add_relation" | "update_node";

export interface VisualOperation {
  kind: VisualOperationKind;
  node: VisualNode | null;
  relation: VisualRelation | null;
  nodeId: string | null;
  patch: VisualNodePatch | null;
}

export interface VisualOperationBatch {
  protocol: "visual-explanation-operations/2";
  baseVersion: number;
  operations: VisualOperation[];
}

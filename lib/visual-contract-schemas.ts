import {
  CONFIDENCE_LEVELS,
  EMPHASIS_LEVELS,
  EXPANSION_STATES,
  EXPLANATION_VIEWS,
  PRIMARY_MATERIAL_DISPLAYS,
  PRIMARY_MATERIAL_KINDS,
  PRIMARY_MATERIAL_PROVENANCE,
  SOURCE_STATUSES,
  VISUAL_NODE_KINDS,
  VISUAL_RELATION_KINDS,
} from "./visual-contract-types";

const primaryMaterialSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    protocol: { type: "string", enum: ["visual-primary-material/1"] },
    kind: { type: "string", enum: PRIMARY_MATERIAL_KINDS },
    title: { type: "string" },
    creator: { type: ["string", "null"] },
    display: { type: "string", enum: PRIMARY_MATERIAL_DISPLAYS },
    provenance: { type: "string", enum: PRIMARY_MATERIAL_PROVENANCE },
    body: { type: ["string", "null"] },
    attribution: { type: "string" },
    sourceUrl: { type: ["string", "null"] },
    omissionReason: { type: ["string", "null"] },
  },
  required: [
    "protocol",
    "kind",
    "title",
    "creator",
    "display",
    "provenance",
    "body",
    "attribution",
    "sourceUrl",
    "omissionReason",
  ],
} as const;

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: { type: "string" },
    detail: { type: "string" },
    url: { type: ["string", "null"] },
  },
  required: ["label", "detail", "url"],
} as const;

const nodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    parentId: { type: ["string", "null"] },
    title: { type: "string" },
    eyebrow: { type: "string" },
    summary: { type: "string" },
    detail: { type: "string" },
    terms: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 40 },
      maxItems: 8,
    },
    kind: { type: "string", enum: VISUAL_NODE_KINDS },
    view: { type: "string", enum: EXPLANATION_VIEWS },
    depth: { type: "integer", minimum: 0, maximum: 12 },
    childIds: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    expandable: { type: "boolean" },
    expansionState: { type: "string", enum: EXPANSION_STATES },
    emphasis: { type: "string", enum: EMPHASIS_LEVELS },
    confidence: { type: "string", enum: CONFIDENCE_LEVELS },
    sourceStatus: { type: "string", enum: SOURCE_STATUSES },
    evidence: { type: "array", items: evidenceSchema },
  },
  required: [
    "id",
    "parentId",
    "title",
    "eyebrow",
    "summary",
    "detail",
    "terms",
    "kind",
    "view",
    "depth",
    "childIds",
    "expandable",
    "expansionState",
    "emphasis",
    "confidence",
    "sourceStatus",
    "evidence",
  ],
} as const;

const relationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    scopeId: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    kind: { type: "string", enum: VISUAL_RELATION_KINDS },
    label: { type: "string" },
  },
  required: ["id", "scopeId", "from", "to", "kind", "label"],
} as const;

const nullableString = { type: ["string", "null"] } as const;
const nullableBoolean = { type: ["boolean", "null"] } as const;
const patchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: nullableString,
    eyebrow: nullableString,
    summary: nullableString,
    detail: nullableString,
    terms: {
      anyOf: [
        {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 40 },
          maxItems: 8,
        },
        { type: "null" },
      ],
    },
    view: { enum: [...EXPLANATION_VIEWS, null] },
    expandable: nullableBoolean,
    expansionState: { enum: [...EXPANSION_STATES, null] },
    emphasis: { enum: [...EMPHASIS_LEVELS, null] },
  },
  required: [
    "title",
    "eyebrow",
    "summary",
    "detail",
    "terms",
    "view",
    "expandable",
    "expansionState",
    "emphasis",
  ],
} as const;

export const visualExplanationDocumentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    protocol: { type: "string", enum: ["visual-explanation-document/2"] },
    id: { type: "string" },
    question: { type: "string" },
    title: { type: "string" },
    thesis: { type: "string" },
    rootId: { type: "string" },
    primaryMaterial: primaryMaterialSchema,
    nodes: { type: "array", minItems: 1, maxItems: 80, items: nodeSchema },
    relations: { type: "array", items: relationSchema },
    version: { type: "integer", minimum: 1 },
  },
  required: [
    "protocol",
    "id",
    "question",
    "title",
    "thesis",
    "rootId",
    "nodes",
    "relations",
    "version",
  ],
} as const;

export const visualExplanationOperationsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    protocol: { type: "string", enum: ["visual-explanation-operations/2"] },
    baseVersion: { type: "integer", minimum: 1 },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["add_node", "add_relation", "update_node"],
          },
          node: { anyOf: [nodeSchema, { type: "null" }] },
          relation: { anyOf: [relationSchema, { type: "null" }] },
          nodeId: { type: ["string", "null"] },
          patch: { anyOf: [patchSchema, { type: "null" }] },
        },
        required: ["kind", "node", "relation", "nodeId", "patch"],
      },
    },
  },
  required: ["protocol", "baseVersion", "operations"],
} as const;

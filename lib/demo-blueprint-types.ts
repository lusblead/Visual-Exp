import type { Emphasis, ExplanationView, VisualNodeKind } from "./lineage-contracts";

export interface BlueprintItem {
  key: string;
  eyebrow: string;
  title: string;
  summary: string;
  detail: string;
  terms?: string[];
  kind: VisualNodeKind;
  view: ExplanationView;
  emphasis?: Emphasis;
}

export interface RootBlueprint {
  titlePrefix: string;
  thesis: string;
  view: ExplanationView;
  items: BlueprintItem[];
}

export function detail(
  key: string,
  eyebrow: string,
  title: string,
  summary: string,
  kind: VisualNodeKind,
  view: ExplanationView,
): BlueprintItem {
  return {
    key,
    eyebrow,
    title,
    summary,
    detail: `${summary} 这一部分需要同时说明作用机制、成立条件和失效边界，避免把局部结论误当成脱离情境的通用规则。`,
    terms: [],
    kind,
    view,
  };
}

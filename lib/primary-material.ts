import {
  PRIMARY_MATERIAL_DISPLAYS,
  PRIMARY_MATERIAL_KINDS,
  PRIMARY_MATERIAL_PROVENANCE,
  type PrimaryMaterial,
  type PrimaryMaterialDisplay,
  type PrimaryMaterialKind,
  type PrimaryMaterialProvenance,
} from "./visual-contract-types";

const MAX_COMPLETE_CHARACTERS = 20_000;
const MAX_EXCERPT_CHARACTERS = 600;
const COMPLETE_PROVENANCE = new Set<PrimaryMaterialProvenance>([
  "user_supplied",
  "public_domain_verified",
  "licensed",
]);

/**
 * Parse a primary object at the trust boundary. Complete text is accepted only
 * when its provenance allows reproduction; unknown or protected text can never
 * be silently promoted to a complete source.
 */
export function parsePrimaryMaterial(value: unknown): PrimaryMaterial | null {
  if (value === undefined || value === null) return null;
  const item = strictRecord(value, "primaryMaterial", [
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
  ]);
  if (item.protocol !== "visual-primary-material/1") {
    throw new Error(
      "primaryMaterial.protocol must be visual-primary-material/1",
    );
  }

  const kind = oneOf(
    item.kind,
    PRIMARY_MATERIAL_KINDS,
    "primaryMaterial.kind",
  );
  const display = oneOf(
    item.display,
    PRIMARY_MATERIAL_DISPLAYS,
    "primaryMaterial.display",
  );
  const provenance = oneOf(
    item.provenance,
    PRIMARY_MATERIAL_PROVENANCE,
    "primaryMaterial.provenance",
  );
  const body = nullableString(item.body, "primaryMaterial.body");
  const omissionReason = nullableString(
    item.omissionReason,
    "primaryMaterial.omissionReason",
  );
  const sourceUrl = safeSourceUrl(item.sourceUrl);
  const title = boundedString(item.title, "primaryMaterial.title", 160);
  const creator =
    item.creator === null
      ? null
      : boundedString(item.creator, "primaryMaterial.creator", 120);
  const attribution = boundedString(
    item.attribution,
    "primaryMaterial.attribution",
    300,
  );

  assertDisplayPolicy(display, provenance, body, omissionReason);

  return {
    protocol: "visual-primary-material/1",
    kind,
    title,
    creator,
    display,
    provenance,
    body,
    attribution,
    sourceUrl,
    omissionReason,
  };
}

/**
 * Resolve only material whose bytes are already trusted locally. This is not a
 * retrieval engine and never asks the language model to recreate an original.
 * Unknown works remain explicit placeholders for a future source adapter.
 */
export function resolvePrimaryMaterial(question: string): PrimaryMaterial | null {
  const cleanQuestion = question.normalize("NFKC").trim();
  const supplied = userSuppliedMaterial(cleanQuestion);
  if (supplied) return parsePrimaryMaterial(supplied);

  if (/静夜思|靜夜思/u.test(cleanQuestion)) {
    return parsePrimaryMaterial({
      protocol: "visual-primary-material/1",
      kind: "poem",
      title: "静夜思",
      creator: "李白",
      display: "complete",
      provenance: "public_domain_verified",
      body: "床前明月光，\n疑是地上霜。\n举头望明月，\n低头思故乡。",
      attribution: "唐·李白；正文采用现代通行版本，来源页同时说明版本异文。",
      sourceUrl:
        "https://zh.wikisource.org/zh-hans/%E9%9D%9C%E5%A4%9C%E6%80%9D",
      omissionReason: null,
    });
  }

  if (/朱自清.{0,8}背影|背影.{0,8}朱自清/u.test(cleanQuestion)) {
    return unavailableMaterial(
      "背影",
      "朱自清",
      "https://zh.wikisource.org/zh-hans/%E8%83%8C%E5%BD%B1",
      "已识别到可核验的公共文本来源，但当前本地语料尚未保存经逐字校验的正文；为避免由模型凭记忆重构，暂不显示全文。",
      "passage",
      "public_domain_verified",
    );
  }

  const titledWork = cleanQuestion.match(/《([^》\r\n]{1,80})》/u)?.[1]?.trim();
  if (titledWork) {
    return unavailableMaterial(
      titledWork,
      null,
      null,
      "当前没有连接到该作品的可验证正文来源；分析可以继续，但不会让模型伪造原文。",
      "other",
      "unknown",
    );
  }

  return null;
}

function userSuppliedMaterial(question: string): PrimaryMaterial | null {
  const block = question.match(/```([^\r\n`]*)\r?\n([\s\S]+?)```/u);
  if (!block) return null;
  const language = block[1].trim().toLocaleLowerCase("und");
  const body = block[2].trim();
  if (!body || Array.from(body).length > MAX_COMPLETE_CHARACTERS) return null;
  const beforeBlock = question.slice(0, block.index).trim();
  const title =
    beforeBlock.match(/《([^》\r\n]{1,80})》/u)?.[1]?.trim() ??
    (language ? `${language} 材料` : "用户提供的材料");
  return {
    protocol: "visual-primary-material/1",
    kind: language ? "code" : "other",
    title,
    creator: null,
    display: "complete",
    provenance: "user_supplied",
    body,
    attribution: "由用户在当前问题中提供",
    sourceUrl: null,
    omissionReason: null,
  };
}

function unavailableMaterial(
  title: string,
  creator: string | null,
  sourceUrl: string | null,
  omissionReason: string,
  kind: PrimaryMaterialKind,
  provenance: PrimaryMaterialProvenance,
): PrimaryMaterial {
  return {
    protocol: "visual-primary-material/1",
    kind,
    title,
    creator,
    display: "unavailable",
    provenance,
    body: null,
    attribution: sourceUrl ? "已识别来源，正文尚未进入本地可信语料" : "尚无可验证来源",
    sourceUrl,
    omissionReason,
  };
}

function assertDisplayPolicy(
  display: PrimaryMaterialDisplay,
  provenance: PrimaryMaterialProvenance,
  body: string | null,
  omissionReason: string | null,
): void {
  if (display === "unavailable") {
    if (body !== null) {
      throw new Error("unavailable primary material must not contain body");
    }
    if (!omissionReason) {
      throw new Error("unavailable primary material requires omissionReason");
    }
    return;
  }

  if (!body) throw new Error(`${display} primary material requires body`);
  if (omissionReason !== null) {
    throw new Error(`${display} primary material cannot have omissionReason`);
  }
  const length = Array.from(body).length;
  if (display === "complete") {
    if (!COMPLETE_PROVENANCE.has(provenance)) {
      throw new Error(
        "complete primary material requires user, public-domain, or licensed provenance",
      );
    }
    if (length > MAX_COMPLETE_CHARACTERS) {
      throw new Error("complete primary material exceeds the local safety limit");
    }
    return;
  }
  if (length > MAX_EXCERPT_CHARACTERS) {
    throw new Error("primary material excerpt exceeds the bounded excerpt limit");
  }
}

function strictRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const item = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is not allowed`);
  }
  return item;
}

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${path} is not supported`);
  }
  return value as T;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return boundedString(value, path, MAX_COMPLETE_CHARACTERS);
}

function boundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  const clean = value.trim();
  if (!clean) throw new Error(`${path} must not be empty`);
  if (Array.from(clean).length > maximum) {
    throw new Error(`${path} exceeds ${maximum} characters`);
  }
  return clean;
}

function safeSourceUrl(value: unknown): string | null {
  if (value === null) return null;
  const sourceUrl = boundedString(value, "primaryMaterial.sourceUrl", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error("primaryMaterial.sourceUrl must be an absolute URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("primaryMaterial.sourceUrl must use HTTPS");
  }
  return parsed.toString();
}

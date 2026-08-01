/*
 * A one-character Han term has no reliable word boundary of its own. These
 * grammatical neighbours may delimit a standalone term when the other side is
 * punctuation, whitespace, or the start/end of the text. The intentionally
 * small set keeps the rule explainable; prose can always use punctuation when
 * a single-character technical term would otherwise be ambiguous.
 */
const SINGLE_HAN_GRAMMATICAL_BOUNDARIES = new Set([
  "与",
  "和",
  "及",
  "或",
  "是",
  "为",
  "的",
  "即",
]);

/**
 * @typedef {{ start: number, end: number, term: string }} AnnotatedTermMatch
 * @typedef {{ start: number, text: string, term: string | null }} AnnotatedFragment
 */

/**
 * @param {string} text
 * @param {readonly string[]} terms
 * @returns {AnnotatedTermMatch[]}
 */
export function findAnnotatedTermMatches(text, terms) {
  if (!text || terms.length === 0) return [];

  /** @type {AnnotatedTermMatch[]} */
  const matches = [];
  const candidates = [...terms]
    .map((term) => term.trim())
    .filter(Boolean)
    .sort(
      (left, right) =>
        Array.from(right).length - Array.from(left).length ||
        right.length - left.length,
    );

  for (const term of candidates) {
    const matcher = new RegExp(escapeRegExp(term), "giu");
    for (const match of text.matchAll(matcher)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!hasRenderableTermBoundary(text, match[0], start, end)) continue;

      const overlaps = matches.some(
        (existing) => start < existing.end && end > existing.start,
      );
      if (!overlaps) matches.push({ start, end, term });
    }
  }

  return matches.sort((left, right) => left.start - right.start);
}

/**
 * @param {string} text
 * @param {readonly string[]} terms
 * @returns {AnnotatedFragment[]}
 */
export function annotateTerms(text, terms) {
  const matches = findAnnotatedTermMatches(text, terms);
  if (matches.length === 0) {
    return [{ start: 0, text, term: null }];
  }

  /** @type {AnnotatedFragment[]} */
  const fragments = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      fragments.push({
        start: cursor,
        text: text.slice(cursor, match.start),
        term: null,
      });
    }
    fragments.push({
      start: match.start,
      text: text.slice(match.start, match.end),
      term: match.term,
    });
    cursor = match.end;
  }
  if (cursor < text.length) {
    fragments.push({ start: cursor, text: text.slice(cursor), term: null });
  }
  return fragments;
}

/**
 * @param {string} text
 * @param {string} term
 */
export function containsAnnotatedTerm(text, term) {
  return findAnnotatedTermMatches(text, [term]).length > 0;
}

function hasRenderableTermBoundary(text, matchedText, start, end) {
  const characters = Array.from(matchedText);
  const first = characters[0] ?? "";
  const last = characters.at(-1) ?? "";
  const before = codePointBefore(text, start);
  const after = codePointAt(text, end);

  if (isAsciiWord(first) && isAsciiWord(before)) return false;
  if (isAsciiWord(last) && isAsciiWord(after)) return false;

  if (characters.length === 1 && isHan(first)) {
    const leftBoundary = isHardBoundary(before);
    const rightBoundary = isHardBoundary(after);
    return (
      (leftBoundary && rightBoundary) ||
      (leftBoundary && SINGLE_HAN_GRAMMATICAL_BOUNDARIES.has(after)) ||
      (rightBoundary && SINGLE_HAN_GRAMMATICAL_BOUNDARIES.has(before))
    );
  }

  return true;
}

function codePointBefore(value, index) {
  if (index <= 0) return "";
  const codePoint = value.codePointAt(
    index >= 2 && isLowSurrogate(value.charCodeAt(index - 1))
      ? index - 2
      : index - 1,
  );
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function codePointAt(value, index) {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function isLowSurrogate(value) {
  return value >= 0xdc00 && value <= 0xdfff;
}

function isAsciiWord(value) {
  return /^[a-z0-9_]$/iu.test(value);
}

function isHan(value) {
  return /^\p{Script=Han}$/u.test(value);
}

function isHardBoundary(value) {
  return (
    value === "" ||
    /^[\p{White_Space}\p{Punctuation}\p{Symbol}]$/u.test(value)
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

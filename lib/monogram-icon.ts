export const MAX_MONOGRAM_GRAPHEMES = 5;

const MAX_MONOGRAM_UTF8_BYTES = 120;
const MONOGRAM_PREFIX = "monogram:";
const MONOGRAM_ACCENTS = [
  "2768ed",
  "6d5ce7",
  "0f8f83",
  "147dce",
  "b3541e",
  "b53b72",
  "526a14",
  "8a4fc4",
] as const;

const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value);
}

function encodeBase64Url(value: string) {
  const bytes = utf8Bytes(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[a-z0-9_-]+$/i.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function graphemes(value: string) {
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

export function monogramGraphemeCount(raw: unknown) {
  if (typeof raw !== "string") return 0;
  const normalized = raw.normalize("NFKC").replace(/\p{White_Space}+/gu, "");
  return graphemes(normalized).length;
}

function isAllowedGrapheme(value: string) {
  // Letters from every writing system are supported. A grapheme may contain
  // combining marks, but a mark may not stand on its own. Numeric graphemes
  // are accepted separately; punctuation, symbols and emoji are not.
  return /^(?:\p{L}\p{M}*)+$/u.test(value) || /^\p{N}$/u.test(value);
}

export function normalizeMonogramText(raw: unknown) {
  if (typeof raw !== "string") throw new Error("请输入字母图标文字");
  const normalized = raw.normalize("NFKC").replace(/\p{White_Space}+/gu, "");
  if (!normalized) throw new Error("请输入字母图标文字");

  const parts = graphemes(normalized);
  if (parts.length > MAX_MONOGRAM_GRAPHEMES) {
    throw new Error(`字母图标最多 ${MAX_MONOGRAM_GRAPHEMES} 个字符`);
  }
  if (!parts.every(isAllowedGrapheme)) {
    throw new Error("字母图标只能使用文字、英文字母或数字");
  }
  if (utf8Bytes(normalized).length > MAX_MONOGRAM_UTF8_BYTES) {
    throw new Error("字母图标内容过长");
  }
  return normalized;
}

export function monogramAccent(raw: unknown) {
  const bytes = utf8Bytes(normalizeMonogramText(raw));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return MONOGRAM_ACCENTS[(hash >>> 0) % MONOGRAM_ACCENTS.length];
}

export function normalizeMonogramAccent(raw: unknown, text?: unknown) {
  if (raw == null || (typeof raw === "string" && !raw.trim())) return monogramAccent(text);
  if (typeof raw !== "string") throw new Error("图标颜色格式不正确");
  const accent = raw.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(accent)) throw new Error("图标颜色格式不正确");
  return accent;
}

export function monogramUpstreamKey(raw: unknown, rawAccent?: unknown) {
  const text = normalizeMonogramText(raw);
  const accent = normalizeMonogramAccent(rawAccent, text);
  return `${encodeBase64Url(text)}.${accent}`;
}

export function monogramIconId(raw: unknown, rawAccent?: unknown) {
  return `${MONOGRAM_PREFIX}${monogramUpstreamKey(raw, rawAccent)}`;
}

type ParsedMonogramIconId = {
  text: string;
  accent: string;
  upstreamKey: string;
  isLegacy: boolean;
};

function parseMonogramIconId(rawIconId: unknown): ParsedMonogramIconId | null {
  if (typeof rawIconId !== "string" || !rawIconId.startsWith(MONOGRAM_PREFIX)) return null;
  const upstreamKey = rawIconId.slice(MONOGRAM_PREFIX.length);
  const match = upstreamKey.match(/^([a-z0-9_-]+)(?:\.([0-9a-f]{6}))?$/i);
  if (!match) return null;
  const [, encoded, explicitAccent] = match;
  const decoded = decodeBase64Url(encoded);
  if (!decoded) return null;
  try {
    const text = normalizeMonogramText(decoded);
    if (encodeBase64Url(text) !== encoded) return null;
    const accent = explicitAccent ? normalizeMonogramAccent(explicitAccent, text) : monogramAccent(text);
    const canonicalKey = explicitAccent ? `${encoded}.${accent}` : encoded;
    if (`${MONOGRAM_PREFIX}${canonicalKey}` !== rawIconId) return null;
    return { text, accent, upstreamKey: canonicalKey, isLegacy: !explicitAccent };
  } catch {
    return null;
  }
}

export function monogramTextFromIconId(rawIconId: unknown) {
  return parseMonogramIconId(rawIconId)?.text ?? null;
}

export function monogramAccentFromIconId(rawIconId: unknown) {
  return parseMonogramIconId(rawIconId)?.accent ?? null;
}

export function monogramUpstreamKeyFromIconId(rawIconId: unknown) {
  return parseMonogramIconId(rawIconId)?.upstreamKey ?? null;
}

export function isLegacyMonogramIconId(rawIconId: unknown) {
  return parseMonogramIconId(rawIconId)?.isLegacy ?? false;
}

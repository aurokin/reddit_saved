const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&apos;": "'",
  "&nbsp;": "\u00A0",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&hellip;": "\u2026",
  "&#38;": "&",
  "&#60;": "<",
  "&#62;": ">",
  "&#34;": '"',
};

const ENTITY_PATTERN =
  /&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|#039|#39|#x27|#x2F|#38|#60|#62|#34);/g;

/** Decode known HTML entities, plus generic numeric/hex entities as fallback. */
export function decodeHtmlEntities(str: string): string {
  return str
    .replace(ENTITY_PATTERN, (match) => HTML_ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (match, dec) => safeFromCodePoint(Number(dec), match))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
      safeFromCodePoint(Number.parseInt(hex, 16), match),
    );
}

/** Convert a codepoint to a character, returning the original match for invalid or
 * dangerous values (null byte, surrogates, out-of-range). */
function safeFromCodePoint(cp: number, original: string): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return original;
  }
  return String.fromCodePoint(cp);
}

/** Escape a string for safe HTML interpolation */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

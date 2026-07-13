/**
 * URL extraction and canonicalization for the link index.
 * Pure functions — no network, no database.
 */

// Match http(s) URLs in plain text or markdown. ']' and quotes end a URL
// (markdown link syntax); ')' is allowed inside and unbalanced trailing ones
// are trimmed afterwards so both `[t](https://x)` and wikipedia-style
// `https://en.wikipedia.org/wiki/Foo_(bar)` come out right.
const URL_REGEX = /https?:\/\/[^\s<>"'\]]+/g;

function trimUrlTail(raw: string): string {
  let url = raw.replace(/[.,;:!?*_~]+$/, "");
  while (url.endsWith(")")) {
    const opens = (url.match(/\(/g) ?? []).length;
    const closes = (url.match(/\)/g) ?? []).length;
    if (closes <= opens) break;
    url = url.slice(0, -1).replace(/[.,;:!?*_~]+$/, "");
  }
  return url;
}

/** All http(s) URLs in a text, in order of first appearance, deduplicated. */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.matchAll(URL_REGEX)) {
    const url = trimUrlTail(match[0]);
    if (url.length > "https://x".length && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

// Tracking params dropped during canonicalization (plus any utm_* prefix).
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "twclid",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "vero_id",
  "yclid",
  "wickedid",
  "si", // youtube/spotify share tracking
  "share_id",
  "ref_source",
  "cmdf",
]);

export interface CanonicalUrl {
  /** Scheme-less canonical form: host + path + sorted significant params */
  canonical: string;
  /** Lowercased host without a www. prefix */
  host: string;
}

/** Canonicalize for grouping: lowercase host, strip www., drop the fragment
 *  and tracking params, sort remaining params, trim the trailing slash.
 *  The scheme is dropped so http/https duplicates collapse.
 *  Returns null for unparseable or non-http(s) URLs. */
export function canonicalizeUrl(url: string): CanonicalUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return null;

  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) && !/^utm_/i.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path === "/") path = "";

  const port = parsed.port ? `:${parsed.port}` : "";
  return {
    canonical: `${host}${port}${path}${query ? `?${query}` : ""}`,
    host,
  };
}

/** Hosts owned by Reddit — excluded by `links top --exclude-reddit`. */
export function isRedditHost(host: string): boolean {
  return (
    host === "reddit.com" ||
    host.endsWith(".reddit.com") ||
    host === "redd.it" ||
    host.endsWith(".redd.it") ||
    host === "redditmedia.com" ||
    host.endsWith(".redditmedia.com") ||
    host === "redditstatic.com" ||
    host.endsWith(".redditstatic.com")
  );
}

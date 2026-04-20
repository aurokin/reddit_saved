export const REDDIT_WWW_URL = "https://www.reddit.com/";
const DEFAULT_COOKIE_STORE_IDS = new Set(["0", "firefox-default"]);

function domainMatches(hostname, cookieDomain) {
  const normalized = (cookieDomain || "").toLowerCase().replace(/^\./, "");
  return !!normalized && (hostname === normalized || hostname.endsWith(`.${normalized}`));
}

function pathMatches(requestPath, cookiePath) {
  const normalized = cookiePath || "/";
  if (normalized === "/") return true;
  if (requestPath === normalized) return true;
  if (normalized.endsWith("/")) return requestPath.startsWith(normalized);
  return requestPath.startsWith(`${normalized}/`);
}

export function filterCookiesForUrl(cookies, url) {
  const target = url instanceof URL ? url : new URL(url);
  const hostname = target.hostname.toLowerCase();
  const requestPath = target.pathname || "/";
  const isHttps = target.protocol === "https:";

  return cookies.filter((cookie) => {
    if (!domainMatches(hostname, cookie.domain)) return false;
    if (!pathMatches(requestPath, cookie.path)) return false;
    if (cookie.secure && !isHttps) return false;
    return true;
  });
}

export function filterCookiesForStore(cookies, storeId) {
  if (!storeId) return cookies;
  return cookies.filter((cookie) => cookie.storeId === storeId);
}

export function pickPrimaryStoreId(storeIds) {
  const uniqueStoreIds = [...new Set(storeIds.filter(Boolean))];
  if (uniqueStoreIds.length <= 1) return uniqueStoreIds[0] ?? null;

  let bestStoreId = uniqueStoreIds[0];
  let bestRank = Infinity;

  for (const storeId of uniqueStoreIds) {
    const normalized = storeId.toLowerCase();
    let rank = 4;
    if (DEFAULT_COOKIE_STORE_IDS.has(normalized)) rank = 0;
    else if (normalized.includes("default")) rank = 1;
    else if (/(private|incognito)/.test(normalized)) rank = 3;
    else if (normalized.includes("container")) rank = 4;
    else rank = 2;

    if (rank < bestRank) {
      bestRank = rank;
      bestStoreId = storeId;
    }
  }

  return bestStoreId;
}

export function serializeCookieHeader(cookies) {
  // Preserve all matching cookies. Browsers may send duplicate names when
  // domain/path scoping differs, and Reddit can depend on the full header.
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

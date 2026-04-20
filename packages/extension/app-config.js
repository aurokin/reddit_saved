export const DEFAULT_APP_BASE_URL = "http://localhost:3001";
export const APP_BASE_URL_KEY = "appBaseUrl";

export function normalizeAppBaseUrl(value) {
  const input = (value ?? "").trim();
  if (!input) return DEFAULT_APP_BASE_URL;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid http://localhost or http://127.0.0.1 URL.");
  }

  if (url.protocol !== "http:") {
    throw new Error("The local app URL must use http://.");
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("The local app URL must point to localhost or 127.0.0.1.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("The local app URL must be a bare origin like http://localhost:3001.");
  }

  return url.origin;
}

export function candidateBaseUrls(baseUrl) {
  const normalized = normalizeAppBaseUrl(baseUrl);
  const url = new URL(normalized);
  const variants = [url.origin];
  const twin = new URL(url.origin);
  twin.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
  if (twin.origin !== url.origin) variants.push(twin.origin);
  return variants;
}

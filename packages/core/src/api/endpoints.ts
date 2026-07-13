import {
  COMMENT_MAX_DEPTH,
  COMMENT_MAX_TOP_LEVEL,
  CONTENT_TYPE_FORM_URLENCODED,
  HEADER_CONTENT_TYPE,
  USER_AGENT_TEMPLATE,
  VERSION,
} from "../constants";
import type { AuthContext, CommentSortOrder, RequestParams } from "../types";

/** Validate that a permalink is safe to interpolate into a URL path */
function validatePermalink(permalink: string): void {
  if (!permalink.startsWith("/r/") && !permalink.startsWith("/u/")) {
    throw new Error("Invalid permalink: must start with /r/ or /u/");
  }
  if (/[?#%]|\.\./.test(permalink)) {
    throw new Error("Invalid permalink: must not contain '?', '#', '%', or '..' sequences");
  }
  // Block any character outside printable non-space ASCII (0x21-0x7e).
  // Permalinks are URL paths — spaces and non-ASCII are invalid.
  if (/[^\x21-\x7e]/.test(permalink)) {
    throw new Error("Invalid permalink: must contain only printable ASCII characters");
  }
}

/** Build user-agent string from template */
export function buildUserAgent(username: string): string {
  return USER_AGENT_TEMPLATE.replace("{version}", VERSION).replace(
    "{username}",
    username || "unknown",
  );
}

/** Build RequestParams for a user content page fetch (saved, upvoted, submitted, comments) */
export function buildContentPageRequest(
  auth: AuthContext,
  endpoint: string,
  pageSize: number,
  after?: string | null,
): RequestParams {
  const clampedPageSize = Math.max(1, Math.min(100, pageSize));
  // raw_json=1 stops Reddit from HTML-escaping &, <, > in text fields — without
  // it, titles/selftext/body are stored entity-escaped, which corrupts FTS
  // search and renders literal entities in the UI.
  let url = `${auth.baseUrl}/user/${encodeURIComponent(auth.username)}/${encodeURIComponent(endpoint)}${auth.pathSuffix}?raw_json=1&limit=${clampedPageSize}`;
  if (after) url += `&after=${encodeURIComponent(after)}`;

  return {
    url,
    method: "GET",
    headers: { ...auth.headers },
  };
}

/** Inbox listing boxes under /message/ */
export type InboxBox = "inbox" | "unread" | "sent" | "mentions";

/** Build RequestParams for an inbox page fetch (/message/inbox etc.) */
export function buildInboxPageRequest(
  auth: AuthContext,
  box: InboxBox,
  pageSize: number,
  after?: string | null,
): RequestParams {
  const clampedPageSize = Math.max(1, Math.min(100, pageSize));
  let url = `${auth.baseUrl}/message/${box}${auth.pathSuffix}?raw_json=1&limit=${clampedPageSize}`;
  if (after) url += `&after=${encodeURIComponent(after)}`;

  return {
    url,
    method: "GET",
    headers: { ...auth.headers },
  };
}

/** Max fullnames per /api/info request (Reddit's per-request cap) */
export const INFO_BATCH_MAX = 100;

/** Build RequestParams for GET /api/info — batch item lookup by fullname
 *  (comma-joined ids). Throws when given more than INFO_BATCH_MAX fullnames;
 *  callers batch above that. */
export function buildInfoRequest(auth: AuthContext, fullnames: string[]): RequestParams {
  if (fullnames.length === 0) {
    throw new Error("buildInfoRequest requires at least one fullname");
  }
  if (fullnames.length > INFO_BATCH_MAX) {
    throw new Error(
      `buildInfoRequest accepts at most ${INFO_BATCH_MAX} fullnames per request, got ${fullnames.length}`,
    );
  }
  const ids = fullnames.map(encodeURIComponent).join(",");
  return {
    url: `${auth.baseUrl}/api/info${auth.pathSuffix}?raw_json=1&id=${ids}`,
    method: "GET",
    headers: { ...auth.headers },
  };
}

/** Build RequestParams for POST /api/unsave */
export function buildUnsaveRequest(auth: AuthContext, fullname: string): RequestParams {
  return {
    url: `${auth.baseUrl}/api/unsave`,
    method: "POST",
    headers: {
      ...auth.headers,
      [HEADER_CONTENT_TYPE]: CONTENT_TYPE_FORM_URLENCODED,
    },
    body: `id=${encodeURIComponent(fullname)}`,
  };
}

/** Build RequestParams for GET /api/v1/me or /api/me.json */
export function buildMeRequest(auth: AuthContext): RequestParams {
  const url =
    auth.pathSuffix === ".json" ? `${auth.baseUrl}/api/me.json` : `${auth.baseUrl}/api/v1/me`;
  return {
    url,
    method: "GET",
    headers: { ...auth.headers },
  };
}

/** Build RequestParams for fetching post comments */
export function buildCommentsRequest(
  auth: AuthContext,
  permalink: string,
  limit: number = COMMENT_MAX_TOP_LEVEL,
  depth: number = COMMENT_MAX_DEPTH,
  sort: CommentSortOrder = "top",
): RequestParams {
  validatePermalink(permalink);
  const cleanPermalink = permalink.replace(/\/+$/, "");
  const clampedLimit = Math.max(1, Math.min(100, limit));
  const clampedDepth = Math.max(1, Math.min(10, depth));
  return {
    url: `${auth.baseUrl}${cleanPermalink}.json?raw_json=1&limit=${clampedLimit}&depth=${clampedDepth}&sort=${encodeURIComponent(sort)}`,
    method: "GET",
    headers: { ...auth.headers },
  };
}

/** Build RequestParams for fetching a comment with parent context */
export function buildCommentContextRequest(
  auth: AuthContext,
  commentPermalink: string,
  contextDepth = 3,
): RequestParams {
  validatePermalink(commentPermalink);
  const cleanPermalink = commentPermalink.replace(/\/+$/, "");
  const depth = Math.max(1, Math.min(10, contextDepth));
  return {
    url: `${auth.baseUrl}${cleanPermalink}.json?raw_json=1&context=${depth}`,
    method: "GET",
    headers: { ...auth.headers },
  };
}

/** Build RequestParams for fetching a full comment thread */
export function buildCommentThreadRequest(
  auth: AuthContext,
  postId: string,
  subreddit: string,
  sort = "best",
): RequestParams {
  return {
    url: `${auth.baseUrl}/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}.json?raw_json=1&sort=${encodeURIComponent(sort)}&limit=${COMMENT_MAX_TOP_LEVEL}&depth=${COMMENT_MAX_DEPTH}`,
    method: "GET",
    headers: { ...auth.headers },
  };
}

import {
  COMMENT_MAX_DEPTH,
  COMMENT_MAX_TOP_LEVEL,
  CONTENT_TYPE_FORM_URLENCODED,
  HEADER_AUTHORIZATION,
  HEADER_CONTENT_TYPE,
  HEADER_USER_AGENT,
  REDDIT_OAUTH_BASE_URL,
  USER_AGENT_TEMPLATE,
  VERSION,
} from "../constants";
import type { CommentSortOrder, RequestParams } from "../types";

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
  accessToken: string,
  username: string,
  endpoint: string,
  pageSize: number,
  userAgent: string,
  after?: string | null,
  baseUrl: string = REDDIT_OAUTH_BASE_URL,
): RequestParams {
  const clampedPageSize = Math.max(1, Math.min(100, pageSize));
  let url = `${baseUrl}/user/${encodeURIComponent(username)}/${encodeURIComponent(endpoint)}?limit=${clampedPageSize}`;
  if (after) url += `&after=${encodeURIComponent(after)}`;

  return {
    url,
    method: "GET",
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${accessToken}`,
      [HEADER_USER_AGENT]: userAgent,
    },
  };
}

/** Build RequestParams for POST /api/unsave */
export function buildUnsaveRequest(
  accessToken: string,
  fullname: string,
  userAgent: string,
  baseUrl: string = REDDIT_OAUTH_BASE_URL,
): RequestParams {
  return {
    url: `${baseUrl}/api/unsave`,
    method: "POST",
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${accessToken}`,
      [HEADER_CONTENT_TYPE]: CONTENT_TYPE_FORM_URLENCODED,
      [HEADER_USER_AGENT]: userAgent,
    },
    body: `id=${encodeURIComponent(fullname)}`,
  };
}

/** Build RequestParams for GET /api/v1/me */
export function buildMeRequest(
  accessToken: string,
  userAgent: string,
  baseUrl: string = REDDIT_OAUTH_BASE_URL,
): RequestParams {
  return {
    url: `${baseUrl}/api/v1/me`,
    method: "GET",
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${accessToken}`,
      [HEADER_USER_AGENT]: userAgent,
    },
  };
}

/** Build RequestParams for fetching post comments */
export function buildCommentsRequest(
  accessToken: string,
  permalink: string,
  userAgent: string,
  limit: number = COMMENT_MAX_TOP_LEVEL,
  depth: number = COMMENT_MAX_DEPTH,
  sort: CommentSortOrder = "top",
  baseUrl: string = REDDIT_OAUTH_BASE_URL,
): RequestParams {
  validatePermalink(permalink);
  const cleanPermalink = permalink.replace(/\/+$/, "");
  const clampedLimit = Math.max(1, Math.min(100, limit));
  const clampedDepth = Math.max(1, Math.min(10, depth));
  return {
    url: `${baseUrl}${cleanPermalink}.json?limit=${clampedLimit}&depth=${clampedDepth}&sort=${encodeURIComponent(sort)}`,
    method: "GET",
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${accessToken}`,
      [HEADER_USER_AGENT]: userAgent,
    },
  };
}

/** Build RequestParams for fetching a comment with parent context */
export function buildCommentContextRequest(
  accessToken: string,
  commentPermalink: string,
  userAgent: string,
  contextDepth = 3,
  baseUrl: string = REDDIT_OAUTH_BASE_URL,
): RequestParams {
  validatePermalink(commentPermalink);
  const cleanPermalink = commentPermalink.replace(/\/+$/, "");
  const depth = Math.max(1, Math.min(10, contextDepth));
  return {
    url: `${baseUrl}${cleanPermalink}.json?context=${depth}`,
    method: "GET",
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${accessToken}`,
      [HEADER_USER_AGENT]: userAgent,
    },
  };
}

/** Build RequestParams for fetching a full comment thread */
export function buildCommentThreadRequest(
  accessToken: string,
  postId: string,
  subreddit: string,
  userAgent: string,
  sort = "best",
  baseUrl: string = REDDIT_OAUTH_BASE_URL,
): RequestParams {
  return {
    url: `${baseUrl}/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}.json?sort=${encodeURIComponent(sort)}&limit=${COMMENT_MAX_TOP_LEVEL}&depth=${COMMENT_MAX_DEPTH}`,
    method: "GET",
    headers: {
      [HEADER_AUTHORIZATION]: `Bearer ${accessToken}`,
      [HEADER_USER_AGENT]: userAgent,
    },
  };
}

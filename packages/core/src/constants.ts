import type { ContentOrigin, FilterSettings, PostType } from "./types";

// ============================================================================
// App Info
// ============================================================================

export const VERSION = "0.1.0";
export const USER_AGENT_TEMPLATE = "bun:reddit-saved:v{version} (by /u/{username})";

// ============================================================================
// OAuth Configuration
// ============================================================================

export const DEFAULT_REDIRECT_PORT = 9638;
export const DEFAULT_OAUTH_HOST = "127.0.0.1";
/** Default redirect URI using the static default host. For dynamic host resolution
 *  (e.g. from REDDIT_OAUTH_HOST env var), use startOAuthServer which builds the URI at call time. */
export const OAUTH_REDIRECT_URI = `http://${DEFAULT_OAUTH_HOST}:${DEFAULT_REDIRECT_PORT}/callback`;
export const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/** Timeout for individual auth-related fetch calls (token exchange, refresh, /me) */
export const AUTH_FETCH_TIMEOUT_MS = 30_000; // 30 seconds
export const OAUTH_SCOPES = "identity history read save";
export const OAUTH_DURATION = "permanent";
export const OAUTH_RESPONSE_TYPE = "code";
export const OAUTH_STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// ============================================================================
// Reddit API Configuration
// ============================================================================

export const REDDIT_MAX_ITEMS = 1000; // Reddit's hard limit
export const REDDIT_PAGE_SIZE = 100; // Max items per request
export const REDDIT_BASE_URL = "https://www.reddit.com";
export const REDDIT_OAUTH_BASE_URL = "https://oauth.reddit.com";
export const REDDIT_OAUTH_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";
export const REDDIT_OAUTH_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

// ============================================================================
// Rate Limiting
// ============================================================================

/** Token bucket: 60 requests per 60 seconds */
export const RATE_LIMIT_TOKENS = 60;
export const RATE_LIMIT_INTERVAL_MS = 60_000;

export const DEFAULT_RATE_LIMIT_DELAY_MS = 2000;
export const RATE_LIMIT_WARNING_THRESHOLD = 10;
export const RATE_LIMIT_SAFE_THRESHOLD = 50;
export const RATE_LIMIT_MIN_DELAY_MS = 100;
export const RATE_LIMIT_NORMAL_DELAY_MS = 500;
export const MAX_REQUEST_RETRIES = 3;
export const RETRY_AFTER_DEFAULT_SECONDS = 60;

// ============================================================================
// Circuit Breaker
// ============================================================================

export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30_000; // 30 seconds

// ============================================================================
// Backoff
// ============================================================================

export const BACKOFF_MAX_DELAY_MS = 30_000; // 30 seconds max backoff

// ============================================================================
// Pagination
// ============================================================================

export const MAX_PAGES_SAFETY_LIMIT = 50;

// ============================================================================
// Offline Queue
// ============================================================================

export const OFFLINE_QUEUE_MAX_SIZE = 100;

// ============================================================================
// HTTP Headers
// ============================================================================

export const HEADER_CONTENT_TYPE = "Content-Type";
export const HEADER_AUTHORIZATION = "Authorization";
export const HEADER_USER_AGENT = "User-Agent";
export const HEADER_RETRY_AFTER = "retry-after";

// ============================================================================
// Content Types
// ============================================================================

export const CONTENT_TYPE_FORM_URLENCODED = "application/x-www-form-urlencoded";

// ============================================================================
// Reddit Item Types
// ============================================================================

export const REDDIT_ITEM_TYPE_COMMENT = "t1";
export const REDDIT_ITEM_TYPE_POST = "t3";

// ============================================================================
// Content Origin Labels
// ============================================================================

export const CONTENT_ORIGIN_SAVED = "saved";
export const CONTENT_ORIGIN_UPVOTED = "upvoted";
export const CONTENT_ORIGIN_SUBMITTED = "submitted";
export const CONTENT_ORIGIN_COMMENTED = "commented";

/** All content origin values — single source of truth for iteration */
export const CONTENT_ORIGINS: readonly ContentOrigin[] = [
  CONTENT_ORIGIN_SAVED,
  CONTENT_ORIGIN_UPVOTED,
  CONTENT_ORIGIN_SUBMITTED,
  CONTENT_ORIGIN_COMMENTED,
];

// ============================================================================
// Comment Configuration
// ============================================================================

export const COMMENT_MAX_TOP_LEVEL = 100;
export const COMMENT_MAX_DEPTH = 5;
export const COMMENT_CONTEXT_MAX = 10;
export const COMMENT_CONTEXT_DEFAULT = 3;
export const COMMENT_REPLY_DEPTH_DEFAULT = 2;

// ============================================================================
// Default Filter Settings
// ============================================================================

export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  enabled: false,

  subredditFilterMode: "exclude",
  subredditList: [],
  subredditRegex: "",
  useSubredditRegex: false,

  titleKeywords: [],
  titleKeywordsMode: "include",
  contentKeywords: [],
  contentKeywordsMode: "include",
  flairList: [],
  flairFilterMode: "include",

  minScore: null,
  maxScore: null,
  minUpvoteRatio: null,

  includePostTypes: ["text", "link", "image", "video"] as PostType[],
  includeComments: true,
  includePosts: true,

  dateRangePreset: "all",
  dateRangeStart: null,
  dateRangeEnd: null,

  authorFilterMode: "exclude",
  authorList: [],
  minCommentCount: null,
  maxCommentCount: null,
  domainFilterMode: "exclude",
  domainList: [],
  excludeNsfw: false,
};

Object.freeze(DEFAULT_FILTER_SETTINGS);
Object.freeze(DEFAULT_FILTER_SETTINGS.subredditList);
Object.freeze(DEFAULT_FILTER_SETTINGS.titleKeywords);
Object.freeze(DEFAULT_FILTER_SETTINGS.contentKeywords);
Object.freeze(DEFAULT_FILTER_SETTINGS.flairList);
Object.freeze(DEFAULT_FILTER_SETTINGS.domainList);
Object.freeze(DEFAULT_FILTER_SETTINGS.includePostTypes);
Object.freeze(DEFAULT_FILTER_SETTINGS.authorList);

// ============================================================================
// Thumbnail Sentinel Values (skip these as thumbnail URLs)
// ============================================================================

export const THUMBNAIL_SENTINELS = new Set([
  "self",
  "default",
  "nsfw",
  "spoiler",
  "image",
  "video",
  "",
]);

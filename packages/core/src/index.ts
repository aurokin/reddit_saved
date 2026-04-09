// Types
export type {
  // Reddit API types
  CommentSortOrder,
  ContentOrigin,
  PostType,
  FilterMode,
  DateRangePreset,
  RedditItem,
  RedditItemData,
  RedditListingResponse,
  GalleryData,
  GalleryItem,
  MediaMetadata,
  MediaMetadataItem,
  PollData,
  PollOption,
  RedditAward,
  RedditComment,
  CommentThread,
  // Filter types
  FilterSettings,
  FilterBreakdown,
  FilterResult,
  // Network types
  RequestParams,
  RequestResponse,
  // API client types
  ApiClientCallbacks,
  FetchOptions,
  FetchResult,
  // Auth types
  AuthSettings,
  // Storage types
  PostRow,
  ListOptions,
  SearchOptions,
  SearchResult,
  DbStats,
  StorageAdapter,
  // Tag types
  Tag,
  TagWithCount,
} from "./types";

// Constants
export {
  VERSION,
  USER_AGENT_TEMPLATE,
  DEFAULT_REDIRECT_PORT,
  DEFAULT_OAUTH_HOST,
  OAUTH_REDIRECT_URI,
  OAUTH_TIMEOUT_MS,
  OAUTH_SCOPES,
  OAUTH_DURATION,
  OAUTH_RESPONSE_TYPE,
  OAUTH_STATE_EXPIRY_MS,
  REDDIT_MAX_ITEMS,
  REDDIT_PAGE_SIZE,
  REDDIT_BASE_URL,
  REDDIT_OAUTH_BASE_URL,
  REDDIT_OAUTH_AUTHORIZE_URL,
  REDDIT_OAUTH_TOKEN_URL,
  RATE_LIMIT_TOKENS,
  RATE_LIMIT_INTERVAL_MS,
  DEFAULT_RATE_LIMIT_DELAY_MS,
  RATE_LIMIT_WARNING_THRESHOLD,
  RATE_LIMIT_SAFE_THRESHOLD,
  RATE_LIMIT_MIN_DELAY_MS,
  RATE_LIMIT_NORMAL_DELAY_MS,
  MAX_REQUEST_RETRIES,
  RETRY_AFTER_DEFAULT_SECONDS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  BACKOFF_MAX_DELAY_MS,
  MAX_PAGES_SAFETY_LIMIT,
  OFFLINE_QUEUE_MAX_SIZE,
  HEADER_CONTENT_TYPE,
  HEADER_AUTHORIZATION,
  HEADER_USER_AGENT,
  HEADER_RETRY_AFTER,
  CONTENT_TYPE_FORM_URLENCODED,
  REDDIT_ITEM_TYPE_COMMENT,
  REDDIT_ITEM_TYPE_POST,
  CONTENT_ORIGIN_SAVED,
  CONTENT_ORIGIN_UPVOTED,
  CONTENT_ORIGIN_SUBMITTED,
  CONTENT_ORIGIN_COMMENTED,
  CONTENT_ORIGINS,
  COMMENT_MAX_TOP_LEVEL,
  COMMENT_MAX_DEPTH,
  COMMENT_CONTEXT_MAX,
  COMMENT_CONTEXT_DEFAULT,
  COMMENT_REPLY_DEPTH_DEFAULT,
  DEFAULT_FILTER_SETTINGS,
  THUMBNAIL_SENTINELS,
} from "./constants";

// Auth
export { generateState, generateCodeVerifier, deriveCodeChallenge } from "./auth/crypto";
export { buildAuthorizeUrl } from "./auth/oauth-urls";
export type { AuthorizeUrlParams } from "./auth/oauth-urls";
export { createPendingState, validateState } from "./auth/oauth-state";
export type { OAuthPendingState } from "./auth/oauth-state";
export { TokenManager } from "./auth/token-manager";
export { startOAuthServer } from "./auth/oauth-server";
export type { OAuthServerOptions, OAuthServerHandle } from "./auth/oauth-server";

// Queue
export { CircuitBreaker } from "./queue/circuit-breaker";
export type { CircuitState, CircuitBreakerConfig } from "./queue/circuit-breaker";
export { RateLimiter } from "./queue/rate-limiter";
export { OfflineQueue } from "./queue/offline-queue";
export type { RequestPriority } from "./queue/offline-queue";
export { RequestQueue } from "./queue/request-queue";
export type { RequestQueueConfig, RequestQueueStatus } from "./queue/request-queue";

// Storage
export { SqliteAdapter } from "./storage/sqlite-adapter";
export { mapRedditItemToRow } from "./storage/mapper";
export {
  initializeSchema,
  assertFts5Available,
  rebuildFtsIndex,
  dropFtsTriggers,
  createFtsTriggers,
} from "./storage/schema";
export { exportToJson, exportToCsv, exportToMarkdown } from "./storage/json-export";
export type { ExportOptions, ExportMetadata } from "./storage/json-export";

// Tags
export { TagManager } from "./tags/tag-manager";

// Sync
export { SyncStateManager } from "./sync/state-manager";
export type { CheckpointData } from "./sync/state-manager";
export { detectOrphans } from "./sync/diff";
export type { OrphanDetectionResult } from "./sync/diff";

// Utilities
export { paths } from "./utils/paths";
export { decodeHtmlEntities, escapeHtml } from "./utils/html-escape";
export { sanitizeFilename } from "./utils/file-sanitizer";

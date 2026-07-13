// Types
export type {
  // Reddit API types
  CommentSortOrder,
  ContentOrigin,
  StoredOrigin,
  SyncOrigin,
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
  PreviewResult,
  // Network types
  RequestParams,
  RequestResponse,
  // API client types
  ApiClientCallbacks,
  FetchOptions,
  FetchResult,
  UnsaveResult,
  // Auth types
  AuthSettings,
  AuthContext,
  AuthProvider,
  SessionPayload,
  SessionSettings,
  // Storage types
  PostRow,
  ListOptions,
  SearchOptions,
  SearchResult,
  DbStats,
  StorageAdapter,
  SyncRunMode,
  SyncRunStatus,
  SyncRunSummary,
  // Inbox types
  InboxItemType,
  InboxItemRow,
  ListInboxOptions,
  // Job run types
  JobRunStatus,
  JobRunSummary,
  JobStepResult,
  // Tag types
  Tag,
  TagWithCount,
  // Performance monitor types
  RequestMetrics,
  SyncMetrics,
  MemorySample,
  PerformanceSummary,
  Bottleneck,
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
  SEARCH_SNIPPET_HIGHLIGHT_START,
  SEARCH_SNIPPET_HIGHLIGHT_END,
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
export { SessionManager } from "./auth/session-manager";
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
export {
  MIGRATIONS,
  LATEST_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from "./storage/migrations";
export type { Migration } from "./storage/migrations";
export { exportToJson, exportToCsv, exportToMarkdown } from "./storage/json-export";
export type { ExportOptions, ExportMetadata } from "./storage/json-export";

// Tags
export { TagManager } from "./tags/tag-manager";

// Sync
export { SyncStateManager, createOriginCheckpointManager } from "./sync/state-manager";
export type { CheckpointData } from "./sync/state-manager";
export { detectOrphans } from "./sync/diff";
export type { OrphanDetectionResult } from "./sync/diff";
export {
  syncContext,
  CONTEXT_SYNC_DEFAULT_LIMIT,
  CONTEXT_SYNC_DEFAULT_TOP_COMMENTS,
  CONTEXT_SYNC_DEFAULT_MIN_COMMENT_SCORE,
  CONTEXT_SYNC_ANCESTOR_DEPTH,
} from "./sync/context-sync";
export type { ContextSyncOptions, ContextSyncResult } from "./sync/context-sync";
export { syncInbox, deriveInboxType, INBOX_SYNC_DEFAULT_LIMIT } from "./sync/inbox-sync";
export type { InboxSyncOptions, InboxSyncResult } from "./sync/inbox-sync";

// API
export { RedditApiClient } from "./api/client";
export type { TokenProvider } from "./api/client";
export {
  buildUserAgent,
  buildContentPageRequest,
  buildInboxPageRequest,
  buildInfoRequest,
  buildUnsaveRequest,
  buildMeRequest,
  buildCommentsRequest,
  buildCommentContextRequest,
  buildCommentThreadRequest,
  INFO_BATCH_MAX,
} from "./api/endpoints";
export type { InboxBox } from "./api/endpoints";

// Import (GDPR data export)
export { parseCsv, parseCsvRecords } from "./import/csv";
export { importGdprExport } from "./import/gdpr-import";
export type {
  GdprImportOptions,
  GdprImportOriginResult,
  GdprImportResult,
} from "./import/gdpr-import";

// Backup
export {
  buildBackupPlan,
  buildManifest,
  canonicalStringify,
  readManifest,
  writeBackup,
  backupStatus,
} from "./backup/backup";
export type {
  BackupFileEntry,
  BackupManifest,
  BackupPlanFile,
  BackupStatus,
  BackupWriteResult,
} from "./backup/backup";
export {
  commitBackup,
  ensureGitRepo,
  hasRemote,
  isGitRepo,
  runGit,
  writeRepoScaffolding,
} from "./backup/git";
export type { BackupCommitOptions, BackupCommitResult, GitResult } from "./backup/git";

// Links
export { extractUrls, canonicalizeUrl, isRedditHost } from "./links/url-extract";
export type { CanonicalUrl } from "./links/url-extract";
export {
  extractPostLinks,
  indexPostLinks,
  rebuildLinkIndex,
  topLinks,
  searchLinks,
} from "./links/link-index";
export type {
  LinkOccurrence,
  LinkSearchRow,
  LinkSource,
  TopLink,
  TopLinksOptions,
} from "./links/link-index";

// Filters
export { FilterEngine, createEmptyBreakdown, isSafeRegex } from "./filters/engine";
export { FILTER_PRESETS } from "./filters/presets";
export {
  LOW_QUALITY_BOT_AUTHORS,
  LOW_QUALITY_COMMENT_MAX_SCORE,
  LOW_QUALITY_COMMENT_MIN_LENGTH,
  qualityReason,
  qualityWhereClause,
} from "./filters/quality";
export type { QualityReason } from "./filters/quality";

// Research
export { buildResearchBrief, renderResearchBrief } from "./research/brief";
export type { ResearchBrief, ResearchOptions, ResearchSeed } from "./research/brief";
export { buildTodayDigest, renderTodayDigest } from "./research/today";
export type { TodayDigest, TodayDigestItem, TodayOptions } from "./research/today";

// Monitor
export { PerformanceMonitor, formatDuration, formatBytes } from "./monitor/performance";

// Utilities
export { getCheckpointPathForDatabase, getJobLockPathForDatabase, paths } from "./utils/paths";
export { JOB_LOCK_STALE_MS, acquireJobLock, readJobLock } from "./utils/job-lock";
export type { JobLockInfo, JobLockRelease } from "./utils/job-lock";
export { getConfigFilePath, loadConfig, saveConfig } from "./utils/config";
export type { AppConfig, BackupConfig } from "./utils/config";
export { decodeHtmlEntities, escapeHtml } from "./utils/html-escape";
export { sanitizeFilename } from "./utils/file-sanitizer";

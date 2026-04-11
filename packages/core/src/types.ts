// ============================================================================
// Reddit API Types
// ============================================================================

/** Comment sort order options for Reddit API */
export type CommentSortOrder = "top" | "best" | "controversial" | "new" | "old" | "qa";

/** Content origin tracking */
export type ContentOrigin = "saved" | "upvoted" | "submitted" | "commented";

export type PostType = "text" | "link" | "image" | "video";
export type FilterMode = "include" | "exclude";
export type DateRangePreset =
  | "all"
  | "last_day"
  | "last_week"
  | "last_month"
  | "last_year"
  | "custom";

export interface RedditItem {
  kind: string;
  data: RedditItemData;
  contentOrigin?: ContentOrigin;
}

export interface RedditItemData {
  id: string;
  name: string;
  title?: string;
  author: string;
  subreddit: string;
  permalink: string;
  created_utc: number;
  score: number;
  url?: string;
  domain?: string;
  is_self?: boolean;
  selftext?: string;
  body?: string;
  num_comments?: number;
  upvote_ratio?: number;
  link_flair_text?: string;
  link_title?: string;
  link_permalink?: string;
  is_submitter?: boolean;
  over_18?: boolean;
  is_video?: boolean;
  post_hint?: string;
  thumbnail?: string;
  preview?: {
    images?: Array<{
      source: {
        url: string;
        width: number;
        height: number;
      };
    }>;
  };
  // Crosspost metadata
  crosspost_parent?: string;
  crosspost_parent_list?: RedditItemData[];
  // Comment tree fields
  parent_id?: string;
  link_id?: string;
  depth?: number;
  distinguished?: string | null;
  edited?: boolean | number;
  archived?: boolean;
  locked?: boolean;
  stickied?: boolean;
  spoiler?: boolean;
  replies?: RedditListingResponse | string;
  parent_comments?: RedditItemData[];
  child_comments?: RedditItemData[];
  // Gallery post fields
  is_gallery?: boolean;
  gallery_data?: GalleryData;
  media_metadata?: MediaMetadata;
  // Poll fields
  poll_data?: PollData;
  // Award fields (legacy - Reddit sunset awards Sep 2023, data may still exist)
  gilded?: number;
  all_awardings?: RedditAward[];
  total_awards_received?: number;
  // Additional metadata
  contest_mode?: boolean;
  suggested_sort?: string;
}

export interface RedditListingResponse {
  kind: "Listing";
  data: {
    after?: string | null;
    before?: string | null;
    children: RedditItem[];
    modhash?: string;
  };
}

// ============================================================================
// Gallery / Media Types
// ============================================================================

export interface GalleryData {
  items: GalleryItem[];
}

export interface GalleryItem {
  caption?: string;
  media_id: string;
  id: number;
  outbound_url?: string;
}

export interface MediaMetadata {
  [mediaId: string]: MediaMetadataItem;
}

export interface MediaMetadataItem {
  status: string;
  /** Media type (e.g., 'Image', 'AnimatedImage') */
  e: string;
  m?: string;
  s?: {
    u?: string;
    gif?: string;
    mp4?: string;
    x?: number;
    y?: number;
  };
  p?: Array<{
    u: string;
    x: number;
    y: number;
  }>;
  id?: string;
}

// ============================================================================
// Poll Types
// ============================================================================

export interface PollData {
  prediction_tournament_id?: string | null;
  total_vote_count: number;
  options: PollOption[];
  voting_end_timestamp?: number | null;
  user_selection?: string | null;
  is_prediction?: boolean;
}

export interface PollOption {
  id: string;
  text: string;
  vote_count?: number;
}

// ============================================================================
// Award Types (legacy)
// ============================================================================

export interface RedditAward {
  name: string;
  id: string;
  description?: string;
  count: number;
  coin_price?: number;
  icon_url?: string;
  is_new?: boolean;
  award_type?: string;
}

// ============================================================================
// Comment Types
// ============================================================================

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  score: number;
  created_utc: number;
  is_submitter: boolean;
  depth: number;
  replies?: RedditComment[];
}

export interface CommentThread {
  post: RedditItemData;
  comments: RedditItemData[];
  totalComments: number;
  hasMore: boolean;
}

// ============================================================================
// Filter Types
// ============================================================================

export interface FilterSettings {
  enabled: boolean;

  // Subreddit filtering
  subredditFilterMode: FilterMode;
  subredditList: string[];
  subredditRegex: string;
  useSubredditRegex: boolean;

  // Content filtering
  titleKeywords: string[];
  titleKeywordsMode: FilterMode;
  contentKeywords: string[];
  contentKeywordsMode: FilterMode;
  flairList: string[];
  flairFilterMode: FilterMode;

  // Score filtering
  minScore: number | null;
  maxScore: number | null;
  minUpvoteRatio: number | null;

  // Post type filtering
  includePostTypes: PostType[];
  includeComments: boolean;
  includePosts: boolean;

  // Date range filtering
  dateRangePreset: DateRangePreset;
  dateRangeStart: number | null;
  dateRangeEnd: number | null;

  // Advanced filters
  authorFilterMode: FilterMode;
  authorList: string[];
  minCommentCount: number | null;
  maxCommentCount: number | null;
  domainFilterMode: FilterMode;
  domainList: string[];
  excludeNsfw: boolean;
}

export interface FilterBreakdown {
  subreddit: number;
  score: number;
  date: number;
  postType: number;
  content: number;
  author: number;
  domain: number;
  nsfw: number;
  commentCount: number;
}

export interface FilterResult {
  passes: boolean;
  reason?: string;
  filterType?: keyof FilterBreakdown;
}

export interface PreviewResult {
  wouldImport: RedditItem[];
  wouldFilter: Array<{ item: RedditItem; reason: string }>;
  wouldSkip: RedditItem[];
  breakdown: FilterBreakdown;
}

// ============================================================================
// Request / Network Types (replaces Obsidian's RequestUrlParam/Response)
// ============================================================================

export interface RequestParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeout?: number;
}

export interface RequestResponse {
  status: number;
  headers: Headers;
  body: unknown;
  text: string;
}

// ============================================================================
// API Client Types
// ============================================================================

export interface ApiClientCallbacks {
  onProgress?: (fetched: number, total: number | null) => void;
  onRateLimit?: (resetMs: number, remaining: number) => void;
  onError?: (error: Error, retryable: boolean) => void;
  onPageFetched?: (pageNum: number, itemCount: number, cursor: string) => void;
}

export interface FetchOptions {
  /** Resume from this pagination cursor */
  startCursor?: string;
  /** Max items to fetch (default: 1000) */
  limit?: number;
  /** For cancellation */
  signal?: AbortSignal;
}

export interface FetchResult {
  items: RedditItem[];
  /** 'after' value for resuming */
  cursor: string | null;
  hasMore: boolean;
  wasCancelled: boolean;
  /** True when pagination stopped due to consecutive page fetch failures */
  wasErrored?: boolean;
}

export interface UnsaveResult {
  succeeded: string[];
  failed: Array<{ id: string; error: Error }>;
  wasCancelled: boolean;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthSettings {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  username: string;
  clientId: string;
  clientSecret: string;
}

// ============================================================================
// Performance Monitor Types
// ============================================================================

export interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  totalBytesDownloaded: number;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  rateLimitWaitTimeMs: number;
  requestTimestamps: number[];
}

export interface SyncMetrics {
  startTime: number;
  endTime?: number;
  itemsFetched: number;
  itemsProcessed: number;
  itemsStored: number;
  itemsSkipped: number;
  itemsFailed: number;
  memoryUsageSamples: MemorySample[];
}

export interface MemorySample {
  timestamp: number;
  rssBytes: number;
}

export interface PerformanceSummary {
  durationMs: number;
  itemsPerSecond: number;
  avgRequestLatencyMs: number;
  requestSuccessRate: number;
  rateLimitPercentage: number;
  effectiveThroughput: number;
}

export interface Bottleneck {
  type: "network" | "rate_limit" | "processing";
  severity: "low" | "medium" | "high";
  description: string;
  recommendation: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface PostRow {
  id: string;
  name: string;
  kind: string;
  content_origin: ContentOrigin;
  title: string | null;
  author: string;
  subreddit: string;
  permalink: string;
  url: string | null;
  domain: string | null;
  selftext: string | null;
  body: string | null;
  score: number;
  /** Unix timestamp in seconds (from Reddit API) */
  created_utc: number;
  num_comments: number | null;
  upvote_ratio: number | null;
  is_self: number | null;
  over_18: number;
  is_video: number;
  is_gallery: number;
  post_hint: string | null;
  link_flair_text: string | null;
  thumbnail: string | null;
  preview_url: string | null;

  // Comment-specific fields
  parent_id: string | null;
  link_id: string | null;
  link_title: string | null;
  link_permalink: string | null;
  is_submitter: number;

  // Status flags
  distinguished: string | null;
  edited: number | null;
  stickied: number;
  spoiler: number;
  locked: number;
  archived: number;
  /** Epoch milliseconds (Date.now()) when first fetched */
  fetched_at: number;
  /** Epoch milliseconds (Date.now()) when last updated */
  updated_at: number;
  is_on_reddit: number;
  /** Epoch milliseconds (Date.now()) when last seen during sync */
  last_seen_at: number;
  raw_json: string;

  // Joined from queries (not always present)
  tags?: string | null;
}

export interface ListOptions {
  subreddit?: string;
  author?: string;
  minScore?: number;
  tag?: string;
  /** true = orphaned only, false/undefined = active only, "all" = both */
  orphaned?: boolean | "all";
  kind?: "t1" | "t3";
  contentOrigin?: ContentOrigin;
  sort?: "created" | "score";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface SearchOptions {
  subreddit?: string;
  author?: string;
  minScore?: number;
  tag?: string;
  /** true = orphaned only, false/undefined = active only, "all" = both */
  orphaned?: boolean | "all";
  kind?: "t1" | "t3";
  /** Unix timestamp in seconds; include rows created at or after this time */
  createdAfter?: number;
  /** Unix timestamp in seconds; include rows created at or before this time */
  createdBefore?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult extends PostRow {
  snippet: string;
  rank: number;
}

export interface DbStats {
  /** Total posts (t3) across all states — includes orphaned */
  totalPosts: number;
  /** Total comments (t1) across all states — includes orphaned */
  totalComments: number;
  /** Items no longer present on Reddit (both posts and comments combined).
   *  Note: this is a combined count of orphaned t1+t3, so it cannot be subtracted
   *  from totalPosts or totalComments individually. Use activeCountByOrigin for active-only counts. */
  orphanedCount: number;
  /** Active (non-orphaned) item counts per content_origin — used for API window checks in orphan detection */
  activeCountByOrigin: Record<ContentOrigin, number>;
  subredditCounts: Array<{ subreddit: string; count: number }>;
  tagCounts: Array<{ name: string; count: number }>;
  oldestItem: number | null;
  newestItem: number | null;
  lastSyncTime: number | null;
}

// ============================================================================
// Tag Types
// ============================================================================

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  created_at: number;
}

export interface TagWithCount extends Tag {
  count: number;
}

// ============================================================================
// Storage Adapter Interface
// ============================================================================

export interface StorageAdapter {
  // Posts
  upsertPosts(items: RedditItem[], origin: ContentOrigin): void;
  getPost(id: string): PostRow | null;
  listPosts(opts: ListOptions): PostRow[];
  searchPosts(query: string, opts: SearchOptions): SearchResult[];
  /** Mark items as orphaned if their last_seen_at is before olderThan.
   *  @param olderThan — epoch milliseconds (Date.now()), NOT Unix seconds */
  markOrphaned(olderThan: number, origin?: ContentOrigin): number;
  getStats(): DbStats;

  // Sync state (key-value for completed-sync metadata)
  getSyncState(key: string): string | null;
  setSyncState(key: string, value: string): void;

  // Unsave
  markUnsaved(ids: string[]): void;

  // Maintenance
  rebuildFtsIndex(): void;
  assertFts5Available(): void;

  // Lifecycle
  close(): void;
}

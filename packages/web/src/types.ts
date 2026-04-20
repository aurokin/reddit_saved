import type {
  ContentOrigin,
  DbStats,
  PostRow,
  SearchResult,
  Tag,
  TagWithCount,
} from "@reddit-saved/core";

export type { PostRow, SearchResult, Tag, TagWithCount, DbStats, ContentOrigin };

/** Shape returned by the `/api/posts` list endpoint. */
export interface PostsListResponse {
  items: PostRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchResponse {
  items: SearchResult[];
  total: number;
  query: string;
  limit: number;
  offset: number;
}

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
  /** Which auth mode is active. Null when not authenticated. */
  mode?: "session" | "oauth" | null;
  /** Unix ms — only set in session mode; tells the user when the extension last refreshed cookies. */
  capturedAt?: number;
  testMode?: boolean;
}

export interface SessionStatus {
  connected: boolean;
  blocked?: boolean;
  username?: string;
  capturedAt?: number;
  error?: string;
}

export interface SyncState {
  isRunning: boolean;
  lastSyncTime: number | null;
  lastFullSyncTime: number | null;
  incrementalCursors: Partial<Record<ContentOrigin, string | null>>;
}

export interface SyncProgressEvent {
  phase: "starting" | "fetching" | "storing" | "cleanup" | "complete" | "error";
  fetched: number;
  total?: number | null;
  origin?: ContentOrigin;
  message?: string;
  error?: string;
}

/** The kind of post filter state; URL-synced via router search params. */
export interface BrowseFilters {
  subreddit?: string;
  author?: string;
  minScore?: number;
  tag?: string;
  origin?: ContentOrigin;
  kind?: "t1" | "t3";
  orphaned?: boolean;
  sort?: "created" | "score";
  dir?: "asc" | "desc";
  q?: string;
  page?: number;
}

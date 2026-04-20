import {
  COMMENT_MAX_DEPTH,
  MAX_PAGES_SAFETY_LIMIT,
  REDDIT_ITEM_TYPE_COMMENT,
  REDDIT_MAX_ITEMS,
  REDDIT_OAUTH_BASE_URL,
  REDDIT_PAGE_SIZE,
} from "../constants";
import type { RequestQueue, RequestQueueStatus } from "../queue/request-queue";
import type {
  ApiClientCallbacks,
  AuthContext,
  AuthProvider,
  AuthSettings,
  CommentSortOrder,
  CommentThread,
  ContentOrigin,
  FetchOptions,
  FetchResult,
  RedditComment,
  RedditItem,
  RedditItemData,
  RedditListingResponse,
  RequestResponse,
  UnsaveResult,
} from "../types";
import {
  buildCommentContextRequest,
  buildCommentThreadRequest,
  buildCommentsRequest,
  buildContentPageRequest,
  buildMeRequest,
  buildUnsaveRequest,
  buildUserAgent,
} from "./endpoints";

/** Legacy OAuth-only provider shape — kept for backward compatibility. New code
 *  should implement AuthProvider directly. The client adapts TokenProvider into
 *  an AuthContext using the bot User-Agent + Bearer token + REDDIT_OAUTH_BASE_URL. */
export interface TokenProvider {
  ensureValidToken(): Promise<void>;
  getSettings(): AuthSettings;
}

function isAuthProvider(p: TokenProvider | AuthProvider): p is AuthProvider {
  return typeof (p as AuthProvider).getAuthContext === "function";
}

/**
 * Reddit API client that delegates all HTTP to RequestQueue.
 * Handles pagination, content origin tagging, comment parsing,
 * and unsave operations.
 *
 * Accepts either an AuthProvider (preferred — supports OAuth or session/cookie
 * auth) or the legacy TokenProvider (OAuth only, baseUrl override supported via
 * constructor arg). Endpoints are auth-mode-agnostic via AuthContext.
 */
export class RedditApiClient {
  private provider: TokenProvider | AuthProvider;
  private requestQueue: RequestQueue;
  private callbacks: ApiClientCallbacks;
  private baseUrlOverride: string | null;

  constructor(
    provider: TokenProvider | AuthProvider,
    requestQueue: RequestQueue,
    callbacks?: ApiClientCallbacks,
    baseUrl?: string,
  ) {
    this.provider = provider;
    this.requestQueue = requestQueue;
    this.callbacks = callbacks ?? {};
    this.baseUrlOverride = baseUrl ?? null;
  }

  /** Resolve an AuthContext from either provider type. baseUrl override (legacy
   *  4th constructor arg) wins over what the provider returns — used by tests
   *  pointing at a mock Reddit server. */
  private resolveAuth(): AuthContext {
    if (isAuthProvider(this.provider)) {
      const ctx = this.provider.getAuthContext();
      return this.baseUrlOverride ? { ...ctx, baseUrl: this.baseUrlOverride } : ctx;
    }
    const s = this.provider.getSettings();
    return {
      headers: {
        Authorization: `Bearer ${s.accessToken}`,
        "User-Agent": buildUserAgent(s.username),
      },
      baseUrl: this.baseUrlOverride ?? REDDIT_OAUTH_BASE_URL,
      pathSuffix: "",
      username: s.username,
    };
  }

  private async ensureValid(): Promise<void> {
    if (isAuthProvider(this.provider)) {
      await this.provider.ensureValid();
    } else {
      await this.provider.ensureValidToken();
    }
  }

  /** Replace the event callbacks. Useful for routing events through different
   *  consumers (e.g. CLI stderr vs. SSE streams) without constructing a new client. */
  setCallbacks(callbacks: ApiClientCallbacks): void {
    this.callbacks = callbacks ?? {};
  }

  /** Read-only view of the current callbacks — callers typically use this to
   *  restore the previous handler after a scoped override (e.g. one sync request). */
  getCallbacks(): ApiClientCallbacks {
    return this.callbacks;
  }

  // --------------------------------------------------------------------------
  // Fetch methods
  // --------------------------------------------------------------------------

  async fetchSaved(options?: FetchOptions): Promise<FetchResult> {
    return this.fetchUserContent("saved", "saved", options);
  }

  async fetchUpvoted(options?: FetchOptions): Promise<FetchResult> {
    return this.fetchUserContent("upvoted", "upvoted", options);
  }

  async fetchUserPosts(options?: FetchOptions): Promise<FetchResult> {
    return this.fetchUserContent("submitted", "submitted", options);
  }

  async fetchUserComments(options?: FetchOptions): Promise<FetchResult> {
    return this.fetchUserContent("comments", "commented", options);
  }

  // --------------------------------------------------------------------------
  // Username
  // --------------------------------------------------------------------------

  async fetchUsername(signal?: AbortSignal): Promise<string> {
    await this.ensureValid();
    const auth = this.resolveAuth();

    const params = buildMeRequest(auth);
    if (signal) params.signal = signal;
    const response = await this.requestQueue.enqueue(params);

    // Cookie-mode (/api/v1/me.json) wraps the user in { kind: "t2", data: { name } }.
    // OAuth (/api/v1/me) returns { name } at top level.
    const raw = response.body as
      | { name?: string; error?: string; data?: { name?: string } }
      | null;
    if (!raw || raw.error) {
      throw new Error(`Failed to fetch username: ${raw?.error ?? "empty response"}`);
    }
    const name = raw.name ?? raw.data?.name;
    if (!name) {
      throw new Error(
        "Reddit API did not return a username. Response contained unexpected fields.",
      );
    }
    return name;
  }

  // --------------------------------------------------------------------------
  // Unsave
  // --------------------------------------------------------------------------

  async unsaveItem(fullname: string, signal?: AbortSignal): Promise<void> {
    await this.ensureValid();
    const auth = this.resolveAuth();

    const params = buildUnsaveRequest(auth, fullname);
    if (signal) params.signal = signal;
    await this.requestQueue.enqueue(params);
  }

  async unsaveItems(fullnames: string[], signal?: AbortSignal): Promise<UnsaveResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: Error }> = [];
    let wasCancelled = false;

    for (let i = 0; i < fullnames.length; i++) {
      if (signal?.aborted) {
        wasCancelled = true;
        break;
      }
      try {
        await this.unsaveItem(fullnames[i], signal);
        succeeded.push(fullnames[i]);
        this.callbacks.onProgress?.(i + 1, fullnames.length);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        failed.push({ id: fullnames[i], error: err });
        const retryable = !("status" in err) || (err as Error & { status: number }).status >= 500;
        this.callbacks.onError?.(err, retryable);
      }
    }

    return { succeeded, failed, wasCancelled };
  }

  // --------------------------------------------------------------------------
  // Comment fetching
  // --------------------------------------------------------------------------

  async fetchPostComments(
    permalink: string,
    upvoteThreshold = 0,
    sort?: CommentSortOrder,
    signal?: AbortSignal,
  ): Promise<RedditComment[]> {
    await this.ensureValid();
    const auth = this.resolveAuth();

    const params = buildCommentsRequest(auth, permalink, undefined, undefined, sort);
    if (signal) params.signal = signal;
    const response = await this.requestQueue.enqueue(params);

    const body = response.body as unknown[];
    if (!Array.isArray(body) || body.length < 2) return [];

    const commentsData =
      (body[1] as { data?: { children?: Array<{ kind: string; data: Record<string, unknown> }> } })
        ?.data?.children ?? [];

    return this.parseComments(commentsData, upvoteThreshold, 0, COMMENT_MAX_DEPTH);
  }

  async fetchCommentWithContext(
    commentPermalink: string,
    contextDepth = 3,
    signal?: AbortSignal,
  ): Promise<RedditItemData | null> {
    await this.ensureValid();
    const auth = this.resolveAuth();

    const params = buildCommentContextRequest(auth, commentPermalink, contextDepth);
    if (signal) params.signal = signal;
    const response = await this.requestQueue.enqueue(params);

    const body = response.body as unknown[];
    if (!Array.isArray(body) || body.length < 2) return null;

    const commentsListing =
      (body[1] as { data?: { children?: RedditItem[] } })?.data?.children ?? [];
    if (commentsListing.length === 0) return null;

    const targetId = RedditApiClient.extractCommentIdFromPermalink(commentPermalink);
    const parentComments: RedditItemData[] = [];

    const FIND_COMMENT_MAX_DEPTH = 100;

    const findComment = (
      children: RedditItem[],
      parents: RedditItemData[] = [],
      depth = 0,
    ): RedditItemData | null => {
      if (depth >= FIND_COMMENT_MAX_DEPTH) return null;

      for (const child of children) {
        if (child.kind !== REDDIT_ITEM_TYPE_COMMENT) continue;

        const data = child.data;
        if (data.id === targetId) {
          parentComments.push(...parents);
          return data;
        }

        if (data.replies && typeof data.replies === "object") {
          const repliesData = data.replies as { data?: { children?: RedditItem[] } };
          if (repliesData.data?.children) {
            const found = findComment(repliesData.data.children, [...parents, data], depth + 1);
            if (found) return found;
          }
        }
      }
      return null;
    };

    const targetComment = findComment(commentsListing);
    if (!targetComment) return null;

    return {
      ...targetComment,
      parent_comments: parentComments,
      depth: parentComments.length,
    };
  }

  async fetchCommentReplies(
    commentPermalink: string,
    maxDepth: number = COMMENT_MAX_DEPTH,
    signal?: AbortSignal,
  ): Promise<RedditItemData[]> {
    await this.ensureValid();
    const auth = this.resolveAuth();

    const params = buildCommentsRequest(auth, commentPermalink, 100, maxDepth);
    if (signal) params.signal = signal;
    const response = await this.requestQueue.enqueue(params);

    const body = response.body as unknown[];
    if (!Array.isArray(body) || body.length < 2) return [];

    const commentsListing =
      (body[1] as { data?: { children?: RedditItem[] } })?.data?.children ?? [];
    if (commentsListing.length === 0) return [];

    const targetId = RedditApiClient.extractCommentIdFromPermalink(commentPermalink);
    const targetComment = commentsListing.find(
      (c) => c.kind === REDDIT_ITEM_TYPE_COMMENT && c.data.id === targetId,
    );
    if (!targetComment) return [];

    const repliesData = targetComment.data.replies;
    if (!repliesData || typeof repliesData !== "object") return [];

    const repliesListing = (repliesData as { data?: { children?: RedditItem[] } }).data?.children;
    if (!repliesListing) return [];

    return this.flattenCommentTree(repliesListing, 1, maxDepth);
  }

  async fetchCommentThread(
    postId: string,
    subreddit: string,
    sort?: string,
    signal?: AbortSignal,
  ): Promise<CommentThread | null> {
    await this.ensureValid();
    const auth = this.resolveAuth();

    const params = buildCommentThreadRequest(auth, postId, subreddit, sort);
    if (signal) params.signal = signal;
    const response = await this.requestQueue.enqueue(params);

    const body = response.body as unknown[];
    if (!Array.isArray(body) || body.length < 2) return null;

    const postListing = (body[0] as { data?: { children?: RedditItem[] } })?.data?.children ?? [];
    const commentsListing =
      (body[1] as { data?: { children?: RedditItem[] } })?.data?.children ?? [];

    if (postListing.length === 0) return null;

    const post = postListing[0].data;
    const comments = this.flattenCommentTree(commentsListing, 0, COMMENT_MAX_DEPTH);
    const hasMore = commentsListing.some((c) => c.kind === "more");

    return {
      post,
      comments,
      totalComments: post.num_comments ?? 0,
      hasMore,
    };
  }

  // --------------------------------------------------------------------------
  // Control
  // --------------------------------------------------------------------------

  pause(): void {
    this.requestQueue.pause();
  }

  resume(): void {
    this.requestQueue.resume();
  }

  getQueueStatus(): RequestQueueStatus {
    return this.requestQueue.getStatus();
  }

  // --------------------------------------------------------------------------
  // Static utilities
  // --------------------------------------------------------------------------

  /** Determine if a parent_id refers to a comment or a post */
  static getParentType(parentId: string): "comment" | "post" {
    return parentId.startsWith("t1_") ? "comment" : "post";
  }

  /** Extract the ID from a Reddit fullname (e.g., "t1_abc123" -> "abc123") */
  static extractIdFromFullname(fullname: string): string {
    const match = fullname.match(/^t\d_(.+)$/);
    return match ? match[1] : fullname;
  }

  /** Extract the comment ID from a Reddit comment permalink.
   *  Expects a comment-specific permalink (e.g. `/r/sub/comments/postid/slug/commentid/`).
   *  If given a post permalink (no comment segment), returns the slug — callers handle
   *  the mismatch gracefully (findComment returns null). */
  static extractCommentIdFromPermalink(permalink: string): string {
    const segments = permalink.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  }

  // --------------------------------------------------------------------------
  // Core pagination
  // --------------------------------------------------------------------------

  private async fetchUserContent(
    endpoint: string,
    contentOrigin: ContentOrigin,
    options: FetchOptions = {},
  ): Promise<FetchResult> {
    const MAX_CONSECUTIVE_FAILURES = 3;
    const maxItems = Math.min(options.limit ?? REDDIT_MAX_ITEMS, REDDIT_MAX_ITEMS);
    const items: RedditItem[] = [];
    let after: string | null = options.startCursor ?? null;
    let hasMore = true;
    let pageCount = 0;
    let wasCancelled = false;
    let consecutivePageFailures = 0;

    while (hasMore && items.length < maxItems && pageCount < MAX_PAGES_SAFETY_LIMIT) {
      if (options.signal?.aborted) {
        wasCancelled = true;
        break;
      }

      const pageSize = Math.min(REDDIT_PAGE_SIZE, maxItems - items.length);

      let response: RequestResponse;
      try {
        await this.ensureValid();
        const auth = this.resolveAuth();

        const params = buildContentPageRequest(auth, endpoint, pageSize, after);
        if (options.signal) {
          params.signal = options.signal;
        }
        response = await this.requestQueue.enqueue(params, { priority: "high" });
      } catch (error) {
        this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), true);
        consecutivePageFailures++;
        if (consecutivePageFailures >= MAX_CONSECUTIVE_FAILURES) {
          return {
            items: items.slice(0, maxItems),
            cursor: after,
            hasMore: false,
            wasCancelled: false,
            wasErrored: true,
          };
        }
        // Exponential backoff before retrying same cursor (abort-aware).
        // Uses AbortSignal.any() to avoid leaking listeners on options.signal —
        // the composite signal is GC'd after the await, unlike a manual listener
        // which stays attached when setTimeout wins the race.
        const backoffMs = 1000 * 2 ** (consecutivePageFailures - 1);
        if (options.signal) {
          const backoffSignal = AbortSignal.any([AbortSignal.timeout(backoffMs), options.signal]);
          await new Promise<void>((resolve) => {
            if (backoffSignal.aborted) return resolve();
            backoffSignal.addEventListener("abort", () => resolve(), { once: true });
          });
        } else {
          await new Promise((r) => setTimeout(r, backoffMs));
        }
        continue;
      }

      // Surface rate-limit state to consumers (CLI progress, web SSE)
      const rlRemaining = Number.parseFloat(response.headers.get("x-ratelimit-remaining") ?? "");
      const rlResetSec = Number.parseFloat(response.headers.get("x-ratelimit-reset") ?? "");
      if (Number.isFinite(rlRemaining) && Number.isFinite(rlResetSec) && rlRemaining < 10) {
        this.callbacks.onRateLimit?.(rlResetSec * 1000, rlRemaining);
      }

      const listing = response.body as RedditListingResponse | null;
      const data = listing?.data;

      if (data?.children && data.children.length > 0) {
        consecutivePageFailures = 0;
        const itemsWithOrigin = data.children.map((item) => ({
          ...item,
          contentOrigin,
        }));
        items.push(...itemsWithOrigin);
        after = data.after ?? null;
        hasMore = !!after && items.length < REDDIT_MAX_ITEMS;

        pageCount++;
        this.callbacks.onPageFetched?.(pageCount, data.children.length, after ?? "");
        this.callbacks.onProgress?.(items.length, null);
      } else {
        hasMore = false;
      }
    }

    return {
      items: items.slice(0, maxItems),
      cursor: after,
      hasMore,
      wasCancelled,
    };
  }

  // --------------------------------------------------------------------------
  // Comment parsing helpers
  // --------------------------------------------------------------------------

  private parseComments(
    children: Array<{ kind: string; data: Record<string, unknown> }>,
    upvoteThreshold: number,
    depth: number,
    maxDepth: number,
  ): RedditComment[] {
    const comments: RedditComment[] = [];

    for (const child of children) {
      if (child.kind !== "t1") continue;

      const data = child.data;
      const score = (data.score as number) ?? 0;
      if (score < upvoteThreshold) continue;

      const comment: RedditComment = {
        id: data.id as string,
        author: (data.author as string) ?? "[deleted]",
        body: (data.body as string) ?? "",
        score,
        created_utc: (data.created_utc as number) ?? 0,
        is_submitter: (data.is_submitter as boolean) ?? false,
        depth,
      };

      if (depth < maxDepth && data.replies && typeof data.replies === "object") {
        const repliesData = data.replies as {
          data?: { children?: Array<{ kind: string; data: Record<string, unknown> }> };
        };
        if (repliesData.data?.children) {
          comment.replies = this.parseComments(
            repliesData.data.children,
            upvoteThreshold,
            depth + 1,
            maxDepth,
          );
        }
      }

      comments.push(comment);
    }

    return comments;
  }

  private flattenCommentTree(
    children: RedditItem[],
    currentDepth: number,
    maxDepth: number,
  ): RedditItemData[] {
    const result: RedditItemData[] = [];

    for (const child of children) {
      if (child.kind !== REDDIT_ITEM_TYPE_COMMENT) continue;

      const data = { ...child.data, depth: currentDepth };
      result.push(data);

      if (currentDepth < maxDepth && data.replies && typeof data.replies === "object") {
        const repliesData = data.replies as { data?: { children?: RedditItem[] } };
        if (repliesData.data?.children) {
          result.push(
            ...this.flattenCommentTree(repliesData.data.children, currentDepth + 1, maxDepth),
          );
        }
      }
    }

    return result;
  }
}

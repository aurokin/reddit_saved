import { REDDIT_ITEM_TYPE_COMMENT, REDDIT_ITEM_TYPE_POST } from "../constants";
import type {
  DateRangePreset,
  FilterBreakdown,
  FilterResult,
  FilterSettings,
  PostType,
  PreviewResult,
  RedditItem,
  RedditItemData,
} from "../types";

/**
 * Creates an empty filter breakdown for tracking filtered items
 */
export function createEmptyBreakdown(): FilterBreakdown {
  return {
    subreddit: 0,
    score: 0,
    date: 0,
    postType: 0,
    content: 0,
    author: 0,
    domain: 0,
    nsfw: 0,
    commentCount: 0,
  };
}

/**
 * Maximum allowed regex length to mitigate ReDoS.
 */
const MAX_REGEX_LENGTH = 200;

/**
 * Detect patterns known to cause catastrophic backtracking (ReDoS).
 * Rejects nested quantifiers like (a+)+, (a*)+, (a+)*, (a{2,})+, etc.
 * Also rejects overlapping alternation like (a|a)+, (a|a?)+, (a|ab)+.
 */
const REDOS_NESTED_QUANTIFIER =
  /(\((?:[^()]*(?:[+*]|\{[^}]*\}))[^()]*\))[+*]|\(\?[^)]*[+*][^)]*\)[+*]|([+*])\{|\{[^}]*\}[+*][+*]/;

/** Broad check: any alternation inside a quantified group */
const REDOS_ALTERNATION_IN_QUANTIFIED_GROUP = /\([^)]*\|[^)]*\)[+*]/;

/** Whitelist: all alternatives are plain literals (no metacharacters/quantifiers) — safe even when quantified */
const SAFE_LITERAL_ALTERNATION = /^\(([a-zA-Z0-9_]+\|)*[a-zA-Z0-9_]+\)[+*]$/;

/**
 * Check if a quantified alternation group is safe.
 * Extracts each `(alt1|alt2|...)+` / `*` group and checks:
 * - If all alternatives are plain literals with no shared prefix → safe
 * - Otherwise → unsafe (potential backtracking)
 */
function hasUnsafeAlternation(pattern: string): boolean {
  const groupRegex = /\([^)]*\|[^)]*\)[+*]/g;
  let match: RegExpExecArray | null = groupRegex.exec(pattern);
  while (match !== null) {
    const group = match[0];
    // Plain literal alternatives are always safe (e.g. (a|b)+, (foo|bar)*)
    if (SAFE_LITERAL_ALTERNATION.test(group)) {
      match = groupRegex.exec(pattern);
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Best-effort ReDoS detection for user-provided filter regexes.
 * This is heuristic — it catches common nested-quantifier patterns (e.g. `(.+)+`)
 * but cannot detect all pathological inputs (e.g. `([^x]+)+`, nested groups).
 * The MAX_REGEX_LENGTH cap (200 chars) is the primary safety net, limiting the
 * search space available for catastrophic backtracking.
 */
export function isSafeRegex(pattern: string): boolean {
  if (pattern.length > MAX_REGEX_LENGTH) return false;
  if (REDOS_NESTED_QUANTIFIER.test(pattern)) return false;
  if (REDOS_ALTERNATION_IN_QUANTIFIED_GROUP.test(pattern) && hasUnsafeAlternation(pattern))
    return false;
  return true;
}

/**
 * FilterEngine - Handles all filtering logic for Reddit items.
 * Ported from reference filters.ts (pure logic, zero external deps).
 *
 * All list normalization and regex compilation happens once in the constructor
 * for O(1) per-item lookup instead of O(n) re-normalization per item.
 */
export class FilterEngine {
  private settings: FilterSettings;

  // Precomputed normalized data
  private subredditSet: Set<string>;
  private authorSet: Set<string>;
  private normalizedDomainList: string[];
  private normalizedFlairList: string[];
  private normalizedTitleKeywords: string[];
  private normalizedContentKeywords: string[];
  private compiledSubredditRegex: RegExp | null;

  constructor(settings: FilterSettings) {
    this.settings = settings;

    this.subredditSet = new Set(settings.subredditList.map((s) => s.toLowerCase().trim()));
    this.authorSet = new Set(settings.authorList.map((a) => a.toLowerCase().trim()));
    this.normalizedDomainList = settings.domainList.map((d) => d.toLowerCase().trim());
    this.normalizedFlairList = settings.flairList.map((f) => f.toLowerCase().trim());
    this.normalizedTitleKeywords = settings.titleKeywords.map((k) => k.toLowerCase().trim());
    this.normalizedContentKeywords = settings.contentKeywords.map((k) => k.toLowerCase().trim());

    this.compiledSubredditRegex = null;
    if (settings.useSubredditRegex && settings.subredditRegex) {
      if (isSafeRegex(settings.subredditRegex)) {
        try {
          this.compiledSubredditRegex = new RegExp(settings.subredditRegex, "i");
        } catch {
          // Invalid regex — stays null, list filter takes over
        }
      }
    }
  }

  /** Check if an item passes all filters */
  shouldIncludeItem(item: RedditItem): FilterResult {
    if (!this.settings.enabled) {
      return { passes: true };
    }

    const data = item.data;
    const isComment = item.kind === REDDIT_ITEM_TYPE_COMMENT;

    // Ordered by cost (cheapest first)
    const filters: Array<() => FilterResult> = [
      () => this.checkPostTypeFilter(item, isComment),
      () => this.checkNsfwFilter(data),
      () => this.checkSubredditFilter(data),
      () => this.checkAuthorFilter(data),
      () => this.checkScoreFilter(data),
      () => this.checkDateFilter(data),
      () => this.checkCommentCountFilter(data, isComment),
      () => this.checkDomainFilter(data, isComment),
      () => this.checkFlairFilter(data, isComment),
      () => this.checkTitleKeywordsFilter(data, isComment),
      () => this.checkContentKeywordsFilter(data, isComment),
    ];

    for (const filter of filters) {
      const result = filter();
      if (!result.passes) return result;
    }

    return { passes: true };
  }

  /** Filters an array of items and returns detailed results */
  filterItems(items: RedditItem[]): {
    passed: RedditItem[];
    filtered: Array<{ item: RedditItem; reason: string; filterType: keyof FilterBreakdown }>;
    breakdown: FilterBreakdown;
  } {
    const passed: RedditItem[] = [];
    const filtered: Array<{
      item: RedditItem;
      reason: string;
      filterType: keyof FilterBreakdown;
    }> = [];
    const breakdown = createEmptyBreakdown();

    for (const item of items) {
      const result = this.shouldIncludeItem(item);
      if (result.passes) {
        passed.push(item);
      } else {
        filtered.push({
          item,
          reason: result.reason || "Unknown filter",
          filterType: result.filterType || "content",
        });
        if (result.filterType) {
          breakdown[result.filterType]++;
        }
      }
    }

    return { passed, filtered, breakdown };
  }

  /** Preview mode - shows what would be imported without actually importing */
  previewImport(
    items: RedditItem[],
    existingIds: Set<string>,
    skipExisting: boolean,
  ): PreviewResult {
    const wouldImport: RedditItem[] = [];
    const wouldFilter: Array<{ item: RedditItem; reason: string }> = [];
    const wouldSkip: RedditItem[] = [];
    const breakdown = createEmptyBreakdown();

    for (const item of items) {
      if (skipExisting && existingIds.has(item.data.id)) {
        wouldSkip.push(item);
        continue;
      }

      const filterResult = this.shouldIncludeItem(item);
      if (!filterResult.passes) {
        wouldFilter.push({ item, reason: filterResult.reason || "Filtered" });
        if (filterResult.filterType) {
          breakdown[filterResult.filterType]++;
        }
        continue;
      }

      wouldImport.push(item);
    }

    return { wouldImport, wouldFilter, wouldSkip, breakdown };
  }

  /** Determines the post type based on Reddit item data */
  static determinePostType(data: RedditItemData): PostType {
    if (data.is_self) return "text";

    if (data.url) {
      const url = data.url.toLowerCase();

      // Video patterns
      if (
        url.includes("v.redd.it") ||
        url.includes("youtube.com") ||
        url.includes("youtu.be") ||
        url.includes("vimeo.com") ||
        /\.(mp4|webm|mov)(\?|$)/i.test(url)
      ) {
        return "video";
      }

      // Image patterns
      if (
        url.includes("i.redd.it") ||
        url.includes("i.imgur.com") ||
        /\.(jpg|jpeg|png|webp|bmp|svg)(\?|$)/i.test(url)
      ) {
        return "image";
      }

      // GIF patterns (counted as image)
      if (url.includes("gfycat.com") || url.includes("redgifs.com") || /\.gif(\?|$)/i.test(url)) {
        return "image";
      }
    }

    return "link";
  }

  // === Individual Filter Methods ===

  private checkPostTypeFilter(item: RedditItem, isComment: boolean): FilterResult {
    if (isComment && !this.settings.includeComments) {
      return { passes: false, reason: "Comments excluded", filterType: "postType" };
    }

    if (!isComment && !this.settings.includePosts) {
      return { passes: false, reason: "Posts excluded", filterType: "postType" };
    }

    if (!isComment && item.kind === REDDIT_ITEM_TYPE_POST) {
      const postType = FilterEngine.determinePostType(item.data);
      if (!this.settings.includePostTypes.includes(postType)) {
        return {
          passes: false,
          reason: `Post type '${postType}' excluded`,
          filterType: "postType",
        };
      }
    }

    return { passes: true };
  }

  private checkNsfwFilter(data: RedditItemData): FilterResult {
    if (this.settings.excludeNsfw && data.over_18) {
      return { passes: false, reason: "NSFW content excluded", filterType: "nsfw" };
    }
    return { passes: true };
  }

  private checkSubredditFilter(data: RedditItemData): FilterResult {
    const subreddit = (data.subreddit ?? "").toLowerCase();

    // Regex mode: when enabled and regex compiled successfully, use only regex (skip list)
    if (this.settings.useSubredditRegex && this.compiledSubredditRegex) {
      const matches = this.compiledSubredditRegex.test(subreddit);

      if (this.settings.subredditFilterMode === "include" && !matches) {
        return {
          passes: false,
          reason: `Subreddit 'r/${data.subreddit}' doesn't match regex pattern`,
          filterType: "subreddit",
        };
      }

      if (this.settings.subredditFilterMode === "exclude" && matches) {
        return {
          passes: false,
          reason: `Subreddit 'r/${data.subreddit}' matches excluded regex pattern`,
          filterType: "subreddit",
        };
      }

      return { passes: true };
    }

    // List mode (also used when useSubredditRegex is true but regex was invalid/too long)
    if (this.subredditSet.size > 0) {
      const isInList = this.subredditSet.has(subreddit);

      if (this.settings.subredditFilterMode === "include" && !isInList) {
        return {
          passes: false,
          reason: `Subreddit 'r/${data.subreddit}' not in include list`,
          filterType: "subreddit",
        };
      }

      if (this.settings.subredditFilterMode === "exclude" && isInList) {
        return {
          passes: false,
          reason: `Subreddit 'r/${data.subreddit}' in exclude list`,
          filterType: "subreddit",
        };
      }
    }

    return { passes: true };
  }

  private checkAuthorFilter(data: RedditItemData): FilterResult {
    if (this.authorSet.size === 0) return { passes: true };

    const author = (data.author ?? "").toLowerCase();
    const isInList = this.authorSet.has(author);

    if (this.settings.authorFilterMode === "include" && !isInList) {
      return {
        passes: false,
        reason: `Author 'u/${data.author}' not in include list`,
        filterType: "author",
      };
    }

    if (this.settings.authorFilterMode === "exclude" && isInList) {
      return {
        passes: false,
        reason: `Author 'u/${data.author}' in exclude list`,
        filterType: "author",
      };
    }

    return { passes: true };
  }

  private checkScoreFilter(data: RedditItemData): FilterResult {
    const score = data.score ?? 0;

    if (this.settings.minScore !== null && score < this.settings.minScore) {
      return {
        passes: false,
        reason: `Score ${score} below minimum ${this.settings.minScore}`,
        filterType: "score",
      };
    }

    if (this.settings.maxScore !== null && score > this.settings.maxScore) {
      return {
        passes: false,
        reason: `Score ${score} above maximum ${this.settings.maxScore}`,
        filterType: "score",
      };
    }

    if (
      this.settings.minUpvoteRatio !== null &&
      data.upvote_ratio !== undefined &&
      data.upvote_ratio < this.settings.minUpvoteRatio
    ) {
      return {
        passes: false,
        reason: `Upvote ratio ${(data.upvote_ratio * 100).toFixed(0)}% below minimum ${(this.settings.minUpvoteRatio * 100).toFixed(0)}%`,
        filterType: "score",
      };
    }

    return { passes: true };
  }

  private checkDateFilter(data: RedditItemData): FilterResult {
    const itemDate = data.created_utc * 1000;
    const now = Date.now();

    if (this.settings.dateRangePreset !== "all" && this.settings.dateRangePreset !== "custom") {
      const cutoffDate = getPresetCutoffDate(this.settings.dateRangePreset, now);
      if (itemDate < cutoffDate) {
        return {
          passes: false,
          reason: `Post from ${new Date(itemDate).toLocaleDateString()} is older than ${this.settings.dateRangePreset.replace("_", " ")}`,
          filterType: "date",
        };
      }
    }

    if (this.settings.dateRangePreset === "custom") {
      if (this.settings.dateRangeStart !== null && itemDate < this.settings.dateRangeStart) {
        return {
          passes: false,
          reason: `Post from ${new Date(itemDate).toLocaleDateString()} is before start date`,
          filterType: "date",
        };
      }

      if (this.settings.dateRangeEnd !== null && itemDate > this.settings.dateRangeEnd) {
        return {
          passes: false,
          reason: `Post from ${new Date(itemDate).toLocaleDateString()} is after end date`,
          filterType: "date",
        };
      }
    }

    return { passes: true };
  }

  private checkCommentCountFilter(data: RedditItemData, isComment: boolean): FilterResult {
    if (isComment) return { passes: true };

    const commentCount = data.num_comments ?? 0;

    if (this.settings.minCommentCount !== null && commentCount < this.settings.minCommentCount) {
      return {
        passes: false,
        reason: `Comment count ${commentCount} below minimum ${this.settings.minCommentCount}`,
        filterType: "commentCount",
      };
    }

    if (this.settings.maxCommentCount !== null && commentCount > this.settings.maxCommentCount) {
      return {
        passes: false,
        reason: `Comment count ${commentCount} above maximum ${this.settings.maxCommentCount}`,
        filterType: "commentCount",
      };
    }

    return { passes: true };
  }

  private checkDomainFilter(data: RedditItemData, isComment: boolean): FilterResult {
    if (isComment || data.is_self || !data.domain || this.normalizedDomainList.length === 0) {
      return { passes: true };
    }

    const domain = data.domain.toLowerCase();

    const isInList = this.normalizedDomainList.some(
      (listDomain) => domain === listDomain || domain.endsWith(`.${listDomain}`),
    );

    if (this.settings.domainFilterMode === "include" && !isInList) {
      return {
        passes: false,
        reason: `Domain '${data.domain}' not in include list`,
        filterType: "domain",
      };
    }

    if (this.settings.domainFilterMode === "exclude" && isInList) {
      return {
        passes: false,
        reason: `Domain '${data.domain}' in exclude list`,
        filterType: "domain",
      };
    }

    return { passes: true };
  }

  private checkFlairFilter(data: RedditItemData, isComment: boolean): FilterResult {
    if (isComment || this.normalizedFlairList.length === 0) return { passes: true };

    const flair = data.link_flair_text?.toLowerCase() ?? "";
    const hasFlair = flair.length > 0;
    const isInList = hasFlair && this.normalizedFlairList.some((f) => flair.includes(f));

    if (this.settings.flairFilterMode === "include") {
      if (!hasFlair || !isInList) {
        return {
          passes: false,
          reason: hasFlair
            ? `Flair '${data.link_flair_text}' not in include list`
            : "Post has no flair (flair filter active)",
          filterType: "content",
        };
      }
    }

    if (this.settings.flairFilterMode === "exclude" && isInList) {
      return {
        passes: false,
        reason: `Flair '${data.link_flair_text}' in exclude list`,
        filterType: "content",
      };
    }

    return { passes: true };
  }

  private checkTitleKeywordsFilter(data: RedditItemData, isComment: boolean): FilterResult {
    if (this.normalizedTitleKeywords.length === 0) return { passes: true };

    const title = (isComment ? data.link_title : data.title)?.toLowerCase() ?? "";
    const hasMatch = this.normalizedTitleKeywords.some((keyword) => title.includes(keyword));

    if (this.settings.titleKeywordsMode === "include" && !hasMatch) {
      return {
        passes: false,
        reason: "Title does not contain required keywords",
        filterType: "content",
      };
    }

    if (this.settings.titleKeywordsMode === "exclude" && hasMatch) {
      return {
        passes: false,
        reason: "Title contains excluded keywords",
        filterType: "content",
      };
    }

    return { passes: true };
  }

  private checkContentKeywordsFilter(data: RedditItemData, isComment: boolean): FilterResult {
    if (this.normalizedContentKeywords.length === 0) return { passes: true };

    const content = isComment ? data.body?.toLowerCase() : data.selftext?.toLowerCase();

    if (!content) {
      if (this.settings.contentKeywordsMode === "include") {
        return {
          passes: false,
          reason: "No content to search for keywords",
          filterType: "content",
        };
      }
      return { passes: true };
    }

    const hasMatch = this.normalizedContentKeywords.some((keyword) => content.includes(keyword));

    if (this.settings.contentKeywordsMode === "include" && !hasMatch) {
      return {
        passes: false,
        reason: "Content does not contain required keywords",
        filterType: "content",
      };
    }

    if (this.settings.contentKeywordsMode === "exclude" && hasMatch) {
      return {
        passes: false,
        reason: "Content contains excluded keywords",
        filterType: "content",
      };
    }

    return { passes: true };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getPresetCutoffDate(preset: DateRangePreset, now: number): number {
  switch (preset) {
    case "last_day":
      return now - 24 * 60 * 60 * 1000;
    case "last_week":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "last_month":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "last_year":
      return now - 365 * 24 * 60 * 60 * 1000;
    case "all":
    case "custom":
      return 0;
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}

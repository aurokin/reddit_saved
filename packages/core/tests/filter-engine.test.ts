import { describe, expect, test } from "bun:test";
import { DEFAULT_FILTER_SETTINGS } from "../src/constants";
import { FilterEngine, createEmptyBreakdown, isSafeRegex } from "../src/filters/engine";
import type { FilterSettings, RedditItem, RedditItemData } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<RedditItemData> = {}, kind = "t3"): RedditItem {
  return {
    kind,
    data: {
      id: "test1",
      name: `${kind}_test1`,
      author: "testauthor",
      subreddit: "testsubreddit",
      permalink: "/r/testsubreddit/comments/test1/test_post/",
      created_utc: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      score: 50,
      ...overrides,
    } as RedditItemData,
  };
}

function makeSettings(overrides: Partial<FilterSettings> = {}): FilterSettings {
  return { ...DEFAULT_FILTER_SETTINGS, enabled: true, ...overrides };
}

function determinePostTypeForUrl(url: string) {
  return FilterEngine.determinePostType(makeItem({ url }).data);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createEmptyBreakdown", () => {
  test("returns all-zero breakdown", () => {
    const b = createEmptyBreakdown();
    expect(b.subreddit).toBe(0);
    expect(b.score).toBe(0);
    expect(b.date).toBe(0);
    expect(b.postType).toBe(0);
    expect(b.content).toBe(0);
    expect(b.author).toBe(0);
    expect(b.domain).toBe(0);
    expect(b.nsfw).toBe(0);
    expect(b.commentCount).toBe(0);
  });
});

describe("FilterEngine", () => {
  describe("disabled filter", () => {
    test("passes everything when disabled", () => {
      const engine = new FilterEngine({ ...DEFAULT_FILTER_SETTINGS, enabled: false });
      const result = engine.shouldIncludeItem(makeItem({ over_18: true, score: -100 }));
      expect(result.passes).toBe(true);
    });
  });

  describe("post type filter", () => {
    test("excludes comments when includeComments is false", () => {
      const engine = new FilterEngine(makeSettings({ includeComments: false }));
      const result = engine.shouldIncludeItem(makeItem({}, "t1"));
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("postType");
    });

    test("excludes posts when includePosts is false", () => {
      const engine = new FilterEngine(makeSettings({ includePosts: false }));
      const result = engine.shouldIncludeItem(makeItem());
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("postType");
    });

    test("excludes post types not in list", () => {
      const engine = new FilterEngine(makeSettings({ includePostTypes: ["text"] }));
      const result = engine.shouldIncludeItem(
        makeItem({ is_self: false, url: "https://example.com" }),
      );
      expect(result.passes).toBe(false);
      expect(result.reason).toContain("link");
    });

    test("includes matching post types", () => {
      const engine = new FilterEngine(makeSettings({ includePostTypes: ["text"] }));
      const result = engine.shouldIncludeItem(makeItem({ is_self: true }));
      expect(result.passes).toBe(true);
    });

    test("empty includePostTypes array excludes all posts", () => {
      const engine = new FilterEngine(makeSettings({ includePostTypes: [] }));
      // A text post should be excluded
      const textResult = engine.shouldIncludeItem(makeItem({ is_self: true }));
      expect(textResult.passes).toBe(false);
      // A link post should also be excluded
      const linkResult = engine.shouldIncludeItem(
        makeItem({ is_self: false, url: "https://example.com" }),
      );
      expect(linkResult.passes).toBe(false);
    });
  });

  describe("NSFW filter", () => {
    test("excludes NSFW when excludeNsfw is true", () => {
      const engine = new FilterEngine(makeSettings({ excludeNsfw: true }));
      const result = engine.shouldIncludeItem(makeItem({ over_18: true }));
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("nsfw");
    });

    test("passes NSFW when excludeNsfw is false", () => {
      const engine = new FilterEngine(makeSettings({ excludeNsfw: false }));
      const result = engine.shouldIncludeItem(makeItem({ over_18: true }));
      expect(result.passes).toBe(true);
    });
  });

  describe("subreddit filter", () => {
    test("include mode: passes matching subreddit", () => {
      const engine = new FilterEngine(
        makeSettings({ subredditFilterMode: "include", subredditList: ["testsubreddit"] }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });

    test("include mode: rejects non-matching subreddit", () => {
      const engine = new FilterEngine(
        makeSettings({ subredditFilterMode: "include", subredditList: ["othersubreddit"] }),
      );
      const result = engine.shouldIncludeItem(makeItem());
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("subreddit");
    });

    test("exclude mode: rejects matching subreddit", () => {
      const engine = new FilterEngine(
        makeSettings({ subredditFilterMode: "exclude", subredditList: ["testsubreddit"] }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(false);
    });

    test("case insensitive", () => {
      const engine = new FilterEngine(
        makeSettings({ subredditFilterMode: "include", subredditList: ["TESTSUBREDDIT"] }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });

    test("regex mode: include matching", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          useSubredditRegex: true,
          subredditRegex: "^test",
        }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });

    test("regex mode: exclude matching", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "exclude",
          useSubredditRegex: true,
          subredditRegex: "^test",
        }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(false);
    });

    test("invalid regex falls through to list", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          useSubredditRegex: true,
          subredditRegex: "[invalid",
          subredditList: ["testsubreddit"],
        }),
      );
      // Invalid regex → null, falls through to list which includes testsubreddit
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });

    test("invalid regex with no list passes everything", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          useSubredditRegex: true,
          subredditRegex: "[invalid",
        }),
      );
      // Invalid regex → null, empty list → passes
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });

    test("regex exceeding length limit falls through to list", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          useSubredditRegex: true,
          subredditRegex: "a".repeat(201),
          subredditList: ["testsubreddit"],
        }),
      );
      // Regex too long → null, falls through to list which includes testsubreddit
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });

    test("regex-only mode skips list when regex is valid", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          useSubredditRegex: true,
          subredditRegex: "^other", // doesn't match "testsubreddit"
          subredditList: ["testsubreddit"], // would match if checked
        }),
      );
      // Regex says no → should fail, even though list would pass
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(false);
    });

    test("null subreddit does not crash", () => {
      const engine = new FilterEngine(
        makeSettings({ subredditFilterMode: "include", subredditList: ["test"] }),
      );
      const item = makeItem({ subreddit: undefined as unknown as string });
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
    });
  });

  describe("author filter", () => {
    test("include mode: rejects non-matching author", () => {
      const engine = new FilterEngine(
        makeSettings({ authorFilterMode: "include", authorList: ["otherauthor"] }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(false);
    });

    test("exclude mode: rejects matching author", () => {
      const engine = new FilterEngine(
        makeSettings({ authorFilterMode: "exclude", authorList: ["testauthor"] }),
      );
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(false);
    });

    test("empty author list passes everything", () => {
      const engine = new FilterEngine(makeSettings({ authorList: [] }));
      expect(engine.shouldIncludeItem(makeItem()).passes).toBe(true);
    });
  });

  describe("score filter", () => {
    test("rejects below minScore", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 100 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 50 })).passes).toBe(false);
    });

    test("rejects above maxScore", () => {
      const engine = new FilterEngine(makeSettings({ maxScore: 10 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 50 })).passes).toBe(false);
    });

    test("rejects below minUpvoteRatio", () => {
      const engine = new FilterEngine(makeSettings({ minUpvoteRatio: 0.9 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 100, upvote_ratio: 0.5 })).passes).toBe(
        false,
      );
    });

    test("passes within range", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 10, maxScore: 100 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 50 })).passes).toBe(true);
    });

    test("score exactly at minScore passes", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 50 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 50 })).passes).toBe(true);
    });

    test("score exactly at maxScore passes", () => {
      const engine = new FilterEngine(makeSettings({ maxScore: 50 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 50 })).passes).toBe(true);
    });
  });

  describe("date filter", () => {
    test("last_day preset rejects old posts", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_day" }));
      const oldItem = makeItem({ created_utc: Math.floor(Date.now() / 1000) - 2 * 86400 });
      expect(engine.shouldIncludeItem(oldItem).passes).toBe(false);
    });

    test("last_day preset passes recent posts", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_day" }));
      const recentItem = makeItem({ created_utc: Math.floor(Date.now() / 1000) - 3600 });
      expect(engine.shouldIncludeItem(recentItem).passes).toBe(true);
    });

    test("custom range: rejects before start date", () => {
      const start = Date.now() - 86400 * 1000;
      const engine = new FilterEngine(
        makeSettings({ dateRangePreset: "custom", dateRangeStart: start }),
      );
      const oldItem = makeItem({ created_utc: Math.floor((start - 86400 * 1000) / 1000) });
      expect(engine.shouldIncludeItem(oldItem).passes).toBe(false);
    });

    test("custom range: rejects after end date", () => {
      const end = Date.now() - 86400 * 1000;
      const engine = new FilterEngine(
        makeSettings({ dateRangePreset: "custom", dateRangeEnd: end }),
      );
      const futureItem = makeItem({ created_utc: Math.floor(Date.now() / 1000) });
      expect(engine.shouldIncludeItem(futureItem).passes).toBe(false);
    });

    test("custom range: both bounds — accepts inside, rejects outside", () => {
      const start = Date.now() - 30 * 86400 * 1000; // 30 days ago
      const end = Date.now() - 7 * 86400 * 1000; // 7 days ago
      const engine = new FilterEngine(
        makeSettings({ dateRangePreset: "custom", dateRangeStart: start, dateRangeEnd: end }),
      );
      // Inside range: 15 days ago
      const insideItem = makeItem({
        created_utc: Math.floor((Date.now() - 15 * 86400 * 1000) / 1000),
      });
      expect(engine.shouldIncludeItem(insideItem).passes).toBe(true);
      // Before range: 60 days ago
      const beforeItem = makeItem({
        created_utc: Math.floor((Date.now() - 60 * 86400 * 1000) / 1000),
      });
      expect(engine.shouldIncludeItem(beforeItem).passes).toBe(false);
      // After range: today
      const afterItem = makeItem({ created_utc: Math.floor(Date.now() / 1000) });
      expect(engine.shouldIncludeItem(afterItem).passes).toBe(false);
    });
  });

  describe("comment count filter", () => {
    test("rejects below minCommentCount", () => {
      const engine = new FilterEngine(makeSettings({ minCommentCount: 10 }));
      expect(engine.shouldIncludeItem(makeItem({ num_comments: 5 })).passes).toBe(false);
    });

    test("rejects above maxCommentCount", () => {
      const engine = new FilterEngine(makeSettings({ maxCommentCount: 10 }));
      expect(engine.shouldIncludeItem(makeItem({ num_comments: 50 })).passes).toBe(false);
    });

    test("skips comment count filter for comments", () => {
      const engine = new FilterEngine(makeSettings({ minCommentCount: 100 }));
      expect(engine.shouldIncludeItem(makeItem({ num_comments: 0 }, "t1")).passes).toBe(true);
    });

    test("comment count exactly at minCommentCount passes", () => {
      const engine = new FilterEngine(makeSettings({ minCommentCount: 10 }));
      expect(engine.shouldIncludeItem(makeItem({ num_comments: 10 })).passes).toBe(true);
    });

    test("comment count exactly at maxCommentCount passes", () => {
      const engine = new FilterEngine(makeSettings({ maxCommentCount: 10 }));
      expect(engine.shouldIncludeItem(makeItem({ num_comments: 10 })).passes).toBe(true);
    });
  });

  describe("domain filter", () => {
    test("exclude mode: rejects matching domain", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "exclude", domainList: ["example.com"] }),
      );
      const item = makeItem({ domain: "example.com", is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("matches subdomains", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "exclude", domainList: ["example.com"] }),
      );
      const item = makeItem({ domain: "sub.example.com", is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("skips self posts", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "exclude", domainList: ["example.com"] }),
      );
      const item = makeItem({ domain: "example.com", is_self: true });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("skips domain filter for comments", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "include", domainList: ["specific-domain.com"] }),
      );
      const item = makeItem({ domain: "other.com" }, "t1");
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("parent domain does not match more-specific subdomain filter", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "exclude", domainList: ["sub.example.com"] }),
      );
      const item = makeItem({ domain: "example.com", is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("include mode: rejects non-matching domain", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "include", domainList: ["reddit.com"] }),
      );
      const item = makeItem({ domain: "example.com", is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });
  });

  describe("flair filter", () => {
    test("include mode: rejects non-matching flair", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "include", flairList: ["Discussion"] }),
      );
      const item = makeItem({ link_flair_text: "News" });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("include mode: rejects posts without flair", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "include", flairList: ["Discussion"] }),
      );
      const item = makeItem({ link_flair_text: undefined });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("exclude mode: rejects matching flair", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "exclude", flairList: ["Meme"] }),
      );
      const item = makeItem({ link_flair_text: "Meme" });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("skips flair filter for comments", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "include", flairList: ["Discussion"] }),
      );
      expect(engine.shouldIncludeItem(makeItem({}, "t1")).passes).toBe(true);
    });
  });

  describe("title keywords filter", () => {
    test("include mode: rejects when no keyword match", () => {
      const engine = new FilterEngine(
        makeSettings({ titleKeywords: ["rust"], titleKeywordsMode: "include" }),
      );
      const item = makeItem({ title: "Python tutorial" });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("include mode: passes when keyword matches", () => {
      const engine = new FilterEngine(
        makeSettings({ titleKeywords: ["rust"], titleKeywordsMode: "include" }),
      );
      const item = makeItem({ title: "Learning Rust basics" });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("exclude mode: rejects when keyword matches", () => {
      const engine = new FilterEngine(
        makeSettings({ titleKeywords: ["spam"], titleKeywordsMode: "exclude" }),
      );
      const item = makeItem({ title: "This is spam content" });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("uses link_title for comments", () => {
      const engine = new FilterEngine(
        makeSettings({ titleKeywords: ["help"], titleKeywordsMode: "include" }),
      );
      const item = makeItem({ link_title: "Need help with code" }, "t1");
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });
  });

  describe("content keywords filter", () => {
    test("include mode: rejects when no match in selftext", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["typescript"], contentKeywordsMode: "include" }),
      );
      const item = makeItem({ selftext: "This is about Python", is_self: true });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("include mode: passes when match found", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["typescript"], contentKeywordsMode: "include" }),
      );
      const item = makeItem({ selftext: "TypeScript is great", is_self: true });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("uses body for comments", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["helpful"], contentKeywordsMode: "include" }),
      );
      const item = makeItem({ body: "This is very helpful" }, "t1");
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("exclude mode: rejects when selftext matches keyword", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["banned-word"], contentKeywordsMode: "exclude" }),
      );
      const item = makeItem({ selftext: "This contains a banned-word inside", is_self: true });
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("content");
      expect(result.reason).toContain("excluded keywords");
    });

    test("exclude mode: rejects comment when body matches keyword", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["banned-word"], contentKeywordsMode: "exclude" }),
      );
      const item = makeItem({ body: "This comment has a banned-word in it" }, "t1");
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("content");
      expect(result.reason).toContain("excluded keywords");
    });

    test("include mode: rejects when no content", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["test"], contentKeywordsMode: "include" }),
      );
      const item = makeItem({ selftext: undefined, is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });
  });

  describe("filterItems", () => {
    test("returns correct passed/filtered/breakdown", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 100 }));
      const items = [
        makeItem({ id: "a", score: 200 }),
        makeItem({ id: "b", score: 50 }),
        makeItem({ id: "c", score: 150 }),
      ];

      const result = engine.filterItems(items);
      expect(result.passed.length).toBe(2);
      expect(result.filtered.length).toBe(1);
      expect(result.filtered[0].filterType).toBe("score");
      expect(result.breakdown.score).toBe(1);
    });

    test("returns empty results for empty array", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 100 }));
      const result = engine.filterItems([]);
      expect(result.passed.length).toBe(0);
      expect(result.filtered.length).toBe(0);
    });
  });

  describe("previewImport", () => {
    test("categorizes items correctly", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 100 }));
      const items = [
        makeItem({ id: "new", score: 200 }),
        makeItem({ id: "low", score: 10 }),
        makeItem({ id: "existing", score: 500 }),
      ];

      const result = engine.previewImport(items, new Set(["existing"]), true);
      expect(result.wouldImport.length).toBe(1);
      expect(result.wouldImport[0].data.id).toBe("new");
      expect(result.wouldFilter.length).toBe(1);
      expect(result.wouldSkip.length).toBe(1);
      expect(result.wouldSkip[0].data.id).toBe("existing");
    });

    test("breakdown counts filter types correctly", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 100, excludeNsfw: true }));
      const items = [
        makeItem({ id: "ok", score: 200, over_18: false }),
        makeItem({ id: "lowscore", score: 5, over_18: false }),
        makeItem({ id: "nsfw", score: 200, over_18: true }),
        makeItem({ id: "both", score: 5, over_18: true }), // NSFW checked before score
      ];

      const result = engine.previewImport(items, new Set(), false);
      expect(result.wouldImport.length).toBe(1);
      expect(result.wouldFilter.length).toBe(3);
      expect(result.breakdown.score).toBe(1);
      expect(result.breakdown.nsfw).toBe(2); // "nsfw" and "both" (nsfw checked first)
    });

    test("does not skip when skipExisting is false", () => {
      const engine = new FilterEngine(makeSettings());
      const items = [makeItem({ id: "existing" })];
      const result = engine.previewImport(items, new Set(["existing"]), false);
      expect(result.wouldImport.length).toBe(1);
      expect(result.wouldSkip.length).toBe(0);
    });

    test("skipExisting takes precedence over filter rejection", () => {
      // Item that would ALSO fail the score filter — but skip should win
      const engine = new FilterEngine(makeSettings({ minScore: 1000 }));
      const items = [makeItem({ id: "both_skip_and_filter", score: 1 })];
      const result = engine.previewImport(items, new Set(["both_skip_and_filter"]), true);
      expect(result.wouldSkip.length).toBe(1);
      expect(result.wouldFilter.length).toBe(0);
      expect(result.wouldImport.length).toBe(0);
    });
  });

  describe("determinePostType", () => {
    test("self posts are text", () => {
      expect(FilterEngine.determinePostType({ is_self: true } as RedditItemData)).toBe("text");
    });

    test("v.redd.it is video", () => {
      expect(
        FilterEngine.determinePostType({ url: "https://v.redd.it/abc" } as RedditItemData),
      ).toBe("video");
    });

    test("youtube is video", () => {
      expect(
        FilterEngine.determinePostType({
          url: "https://youtube.com/watch?v=abc",
        } as RedditItemData),
      ).toBe("video");
    });

    test("i.redd.it is image", () => {
      expect(
        FilterEngine.determinePostType({ url: "https://i.redd.it/abc.jpg" } as RedditItemData),
      ).toBe("image");
    });

    test("imgur is image", () => {
      expect(
        FilterEngine.determinePostType({ url: "https://i.imgur.com/abc.png" } as RedditItemData),
      ).toBe("image");
    });

    test(".gif is image", () => {
      expect(
        FilterEngine.determinePostType({ url: "https://example.com/image.gif" } as RedditItemData),
      ).toBe("image");
    });

    test("gfycat is image", () => {
      expect(
        FilterEngine.determinePostType({ url: "https://gfycat.com/abc" } as RedditItemData),
      ).toBe("image");
    });

    test("external links are link", () => {
      expect(
        FilterEngine.determinePostType({ url: "https://example.com/article" } as RedditItemData),
      ).toBe("link");
    });

    test("falls through to link when url is undefined and is_self is falsy", () => {
      expect(FilterEngine.determinePostType({} as RedditItemData)).toBe("link");
      expect(FilterEngine.determinePostType({ is_self: false } as RedditItemData)).toBe("link");
    });
  });

  describe("edge cases", () => {
    test("null author does not crash", () => {
      const engine = new FilterEngine(
        makeSettings({ authorFilterMode: "include", authorList: ["someone"] }),
      );
      const item = makeItem({ author: undefined as unknown as string });
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
    });

    test("zero score with minScore=0 boundary passes", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 0 }));
      expect(engine.shouldIncludeItem(makeItem({ score: 0 })).passes).toBe(true);
    });

    test("flair substring match: partial flair matches longer flair", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "include", flairList: ["disc"] }),
      );
      const item = makeItem({ link_flair_text: "Discussion" });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("flair substring match: non-overlapping flair does not match", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "include", flairList: ["science"] }),
      );
      const item = makeItem({ link_flair_text: "Discussion" });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("flair substring match: exact flair passes", () => {
      const engine = new FilterEngine(
        makeSettings({ flairFilterMode: "include", flairList: ["Discussion"] }),
      );
      const item = makeItem({ link_flair_text: "Discussion" });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("dateRangePreset 'all' passes everything", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "all" }));
      const ancientItem = makeItem({ created_utc: 0 });
      expect(engine.shouldIncludeItem(ancientItem).passes).toBe(true);
    });

    test("empty string selftext with include content keywords fails", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["test"], contentKeywordsMode: "include" }),
      );
      // Empty selftext is falsy — treated as no content
      const item = makeItem({ selftext: "", is_self: true });
      expect(engine.shouldIncludeItem(item).passes).toBe(false);
    });

    test("undefined selftext with exclude content keywords passes", () => {
      const engine = new FilterEngine(
        makeSettings({ contentKeywords: ["test"], contentKeywordsMode: "exclude" }),
      );
      const item = makeItem({ selftext: undefined, is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });
  });

  describe("score null safety", () => {
    test("undefined score treated as 0 with minScore filter", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 1 }));
      const item = makeItem({ score: undefined as unknown as number });
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("score");
    });
  });

  describe("ReDoS protection — isSafeRegex", () => {
    test("rejects nested quantifiers (a+)+", () => {
      expect(isSafeRegex("(a+)+")).toBe(false);
    });

    test("rejects (a*)*", () => {
      expect(isSafeRegex("(a*)*")).toBe(false);
    });

    test("rejects (a+)*", () => {
      expect(isSafeRegex("(a+)*")).toBe(false);
    });

    test("rejects (a*)+", () => {
      expect(isSafeRegex("(a*)+")).toBe(false);
    });

    test("allows simple patterns", () => {
      expect(isSafeRegex("^(rust|python|go)$")).toBe(true);
      expect(isSafeRegex("test.*subreddit")).toBe(true);
      expect(isSafeRegex("foo")).toBe(true);
    });

    test("rejects patterns exceeding max length", () => {
      expect(isSafeRegex("a".repeat(201))).toBe(false);
    });

    test("allows patterns at max length", () => {
      expect(isSafeRegex("a".repeat(200))).toBe(true);
    });

    test("rejects (a{2,})+", () => {
      expect(isSafeRegex("(a{2,})+")).toBe(false);
    });

    test("rejects (a{3,5})*", () => {
      expect(isSafeRegex("(a{3,5})*")).toBe(false);
    });

    test("rejects (.+)+", () => {
      expect(isSafeRegex("(.+)+")).toBe(false);
    });

    test("rejects ([a-z]+)+", () => {
      expect(isSafeRegex("([a-z]+)+")).toBe(false);
    });

    test("rejects (\\d+)+b", () => {
      expect(isSafeRegex("(\\d+)+b")).toBe(false);
    });

    test("ReDoS pattern falls back to list filter", () => {
      const engine = new FilterEngine(
        makeSettings({
          useSubredditRegex: true,
          subredditRegex: "(a+)+b",
          subredditFilterMode: "include",
          subredditList: ["testsubreddit"],
        }),
      );
      // Should use list filter (not regex) since regex is unsafe
      const result = engine.shouldIncludeItem(makeItem({ subreddit: "testsubreddit" }));
      expect(result.passes).toBe(true);
    });
  });

  describe("date presets", () => {
    test("last_week filters items older than 7 days", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_week" }));
      const eightDaysAgo = makeItem({
        created_utc: Math.floor((Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000),
      });
      const result = engine.shouldIncludeItem(eightDaysAgo);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("date");
    });

    test("last_week passes items within 7 days", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_week" }));
      const twoDaysAgo = makeItem({
        created_utc: Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000),
      });
      expect(engine.shouldIncludeItem(twoDaysAgo).passes).toBe(true);
    });

    test("last_year filters items older than 365 days", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_year" }));
      const twoYearsAgo = makeItem({
        created_utc: Math.floor((Date.now() - 400 * 24 * 60 * 60 * 1000) / 1000),
      });
      const result = engine.shouldIncludeItem(twoYearsAgo);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("date");
    });

    test("last_year passes items within 365 days", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_year" }));
      const sixMonthsAgo = makeItem({
        created_utc: Math.floor((Date.now() - 180 * 24 * 60 * 60 * 1000) / 1000),
      });
      expect(engine.shouldIncludeItem(sixMonthsAgo).passes).toBe(true);
    });

    test("last_month filters items older than 30 days", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_month" }));
      const fortyDaysAgo = makeItem({
        created_utc: Math.floor((Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000),
      });
      const result = engine.shouldIncludeItem(fortyDaysAgo);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("date");
    });

    test("last_month passes items within 30 days", () => {
      const engine = new FilterEngine(makeSettings({ dateRangePreset: "last_month" }));
      const tenDaysAgo = makeItem({
        created_utc: Math.floor((Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000),
      });
      expect(engine.shouldIncludeItem(tenDaysAgo).passes).toBe(true);
    });
  });

  describe("video detection patterns", () => {
    test("youtu.be detected as video", () => {
      expect(determinePostTypeForUrl("https://youtu.be/abc123")).toBe("video");
    });

    test("vimeo.com detected as video", () => {
      expect(determinePostTypeForUrl("https://vimeo.com/123")).toBe("video");
    });

    test(".mp4 URL detected as video", () => {
      expect(determinePostTypeForUrl("https://example.com/video.mp4")).toBe("video");
    });

    test(".webm URL detected as video", () => {
      expect(determinePostTypeForUrl("https://example.com/clip.webm")).toBe("video");
    });

    test(".mov URL detected as video", () => {
      expect(determinePostTypeForUrl("https://example.com/movie.mov?t=10")).toBe("video");
    });
  });

  describe("image detection patterns", () => {
    test(".jpg URL detected as image", () => {
      expect(determinePostTypeForUrl("https://example.com/photo.jpg")).toBe("image");
    });

    test(".png URL detected as image", () => {
      expect(determinePostTypeForUrl("https://example.com/screenshot.png")).toBe("image");
    });

    test(".webp URL with query param detected as image", () => {
      expect(determinePostTypeForUrl("https://example.com/pic.webp?w=800")).toBe("image");
    });

    test("redgifs.com detected as image", () => {
      expect(determinePostTypeForUrl("https://redgifs.com/watch/something")).toBe("image");
    });

    test("gfycat.com detected as image", () => {
      expect(determinePostTypeForUrl("https://gfycat.com/clip")).toBe("image");
    });
  });

  describe("domain filter include mode — passing case", () => {
    test("item from included domain passes", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "include", domainList: ["reddit.com"] }),
      );
      const item = makeItem({ domain: "reddit.com", is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });

    test("subdomain of included domain passes", () => {
      const engine = new FilterEngine(
        makeSettings({ domainFilterMode: "include", domainList: ["reddit.com"] }),
      );
      const item = makeItem({ domain: "old.reddit.com", is_self: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });
  });

  describe("combined/interacting filters", () => {
    test("NSFW filter short-circuits before subreddit filter", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          subredditList: ["allowedsub"],
          excludeNsfw: true,
        }),
      );
      // Item is NSFW AND from wrong subreddit — NSFW is checked first (line 86)
      const item = makeItem({ subreddit: "othersub", over_18: true });
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("nsfw");
    });

    test("subreddit filter checked before score filter", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "exclude",
          subredditList: ["banned"],
          minScore: 100,
        }),
      );
      // Item from excluded subreddit with low score — subreddit checked first (line 87)
      const item = makeItem({ subreddit: "banned", score: 5 });
      const result = engine.shouldIncludeItem(item);
      expect(result.passes).toBe(false);
      expect(result.filterType).toBe("subreddit");
    });

    test("all filters pass when item satisfies every condition", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          subredditList: ["goodsub"],
          minScore: 10,
          excludeNsfw: true,
        }),
      );
      const item = makeItem({ subreddit: "goodsub", score: 50, over_18: false });
      expect(engine.shouldIncludeItem(item).passes).toBe(true);
    });
  });

  describe("ReDoS — alternation in quantified groups", () => {
    test("rejects (a|a?)+ overlapping alternation", () => {
      expect(isSafeRegex("(a|a?)+")).toBe(false);
    });

    test("allows (a|ab)* plain literal alternation", () => {
      // Plain literal alternatives are safe even with prefix overlap — modern engines handle O(n)
      expect(isSafeRegex("(a|ab)*")).toBe(true);
    });

    test("rejects (\\d|\\d?)+ overlapping alternation", () => {
      expect(isSafeRegex("(\\d|\\d?)+")).toBe(false);
    });

    test("allows simple character class alternation without quantifier", () => {
      // No outer quantifier on the group — safe
      expect(isSafeRegex("(a|b)")).toBe(true);
    });

    test("allows safe quantified alternation of non-overlapping literals", () => {
      // (a|b)+ is equivalent to [ab]+ — no backtracking risk
      expect(isSafeRegex("(a|b)+")).toBe(true);
      expect(isSafeRegex("(foo|bar)+")).toBe(true);
      expect(isSafeRegex("(cats|dogs)*")).toBe(true);
    });

    test("rejects quantified alternation when alternative has quantifier", () => {
      // Inner quantifier creates overlap → potential backtracking
      expect(isSafeRegex("(a?|b)+")).toBe(false);
      expect(isSafeRegex("(a+|b)+")).toBe(false);
      expect(isSafeRegex("(a|b*)+")).toBe(false);
      expect(isSafeRegex("(a{2,}|b)+")).toBe(false);
    });

    test("falls back to list filter for alternation-based ReDoS", () => {
      const engine = new FilterEngine(
        makeSettings({
          useSubredditRegex: true,
          subredditRegex: "(a|a?)+",
          subredditFilterMode: "include",
          subredditList: ["testsub"],
        }),
      );
      const result = engine.shouldIncludeItem(makeItem({ subreddit: "testsub" }));
      expect(result.passes).toBe(true);
    });
  });

  describe("partial / malformed FilterSettings", () => {
    test("handles empty string entries in subredditList", () => {
      const engine = new FilterEngine(
        makeSettings({
          subredditFilterMode: "include",
          subredditList: ["  ", "", "realsub"],
        }),
      );
      // Item in realsub should pass
      expect(engine.shouldIncludeItem(makeItem({ subreddit: "realsub" })).passes).toBe(true);
      // Item in another sub should be excluded
      expect(engine.shouldIncludeItem(makeItem({ subreddit: "other" })).passes).toBe(false);
    });

    test("handles whitespace-only entries in authorList", () => {
      const engine = new FilterEngine(
        makeSettings({
          authorFilterMode: "exclude",
          authorList: ["  ", "baduser"],
        }),
      );
      expect(engine.shouldIncludeItem(makeItem({ author: "gooduser" })).passes).toBe(true);
      expect(engine.shouldIncludeItem(makeItem({ author: "baduser" })).passes).toBe(false);
    });
  });

  describe("filterItems — breakdown with missing filterType", () => {
    test("filtered item without filterType does not increment breakdown", () => {
      // Use a filter that will reject an item — the engine always sets filterType,
      // but we verify the guard path by checking breakdown counts match filtered count.
      const engine = new FilterEngine(
        makeSettings({
          minScore: 100,
          excludeNsfw: true,
        }),
      );
      const items = [
        makeItem({ score: 5, over_18: false } as Partial<RedditItemData>),
        makeItem({ score: 200, over_18: true } as Partial<RedditItemData>),
        makeItem({ score: 200, over_18: false } as Partial<RedditItemData>),
      ];
      const result = engine.filterItems(items);
      expect(result.passed.length).toBe(1);
      expect(result.filtered.length).toBe(2);
      // Each filtered item should have a filterType
      for (const f of result.filtered) {
        expect(f.filterType).toBeDefined();
      }
      // breakdown total should match filtered count
      const breakdownTotal = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
      expect(breakdownTotal).toBe(2);
    });
  });

  describe("previewImport — breakdown counting", () => {
    test("breakdown counts match filtered items in previewImport", () => {
      const engine = new FilterEngine(
        makeSettings({
          minScore: 100,
          excludeNsfw: true,
        }),
      );
      const items = [
        makeItem({ id: "p1", score: 5 } as Partial<RedditItemData>),
        makeItem({ id: "p2", score: 200, over_18: true } as Partial<RedditItemData>),
        makeItem({ id: "p3", score: 200, over_18: false } as Partial<RedditItemData>),
      ];
      const result = engine.previewImport(items, new Set(), false);
      expect(result.wouldImport.length).toBe(1);
      expect(result.wouldFilter.length).toBe(2);
      const breakdownTotal = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
      expect(breakdownTotal).toBe(2);
    });

    test("skipExisting items are not counted in breakdown", () => {
      const engine = new FilterEngine(makeSettings({ minScore: 0 }));
      const items = [
        makeItem({ id: "existing1", score: 50 } as Partial<RedditItemData>),
        makeItem({ id: "new1", score: 50 } as Partial<RedditItemData>),
      ];
      const result = engine.previewImport(items, new Set(["existing1"]), true);
      expect(result.wouldSkip.length).toBe(1);
      expect(result.wouldImport.length).toBe(1);
      const breakdownTotal = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
      expect(breakdownTotal).toBe(0);
    });
  });

  describe("ReDoS — multi-group unsafe alternation", () => {
    test("rejects pattern with unsafe alternation in second group", () => {
      // First group is safe, second has overlapping quantified alternation
      expect(isSafeRegex("(abc)(a|a?)+")).toBe(false);
    });

    test("rejects nested quantifier in second group only", () => {
      expect(isSafeRegex("(safe)(x+)+")).toBe(false);
    });

    test("allows multiple safe groups", () => {
      expect(isSafeRegex("(abc)(def)")).toBe(true);
    });
  });

  describe("ReDoS — deeply nested and edge-case patterns", () => {
    test("rejects deeply nested groups ((((((((((a+)+)+)+)+)+)+)+)+)+)+", () => {
      expect(isSafeRegex("((((((((((a+)+)+)+)+)+)+)+)+)+)+")).toBe(false);
    });

    test("rejects massive character class with nested quantifier", () => {
      expect(isSafeRegex("([a-zA-Z0-9_]+)+")).toBe(false);
    });

    test("rejects pattern at 201 chars regardless of content", () => {
      expect(isSafeRegex("a".repeat(201))).toBe(false);
    });

    test("allows pattern at exactly 200 chars with safe content", () => {
      expect(isSafeRegex("a".repeat(200))).toBe(true);
    });
  });
});

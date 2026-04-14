import { describe, expect, test } from "bun:test";
import { DEFAULT_FILTER_SETTINGS } from "../src/constants";
import { FilterEngine } from "../src/filters/engine";
import { FILTER_PRESETS } from "../src/filters/presets";
import type { FilterSettings, RedditItemData } from "../src/types";

describe("FILTER_PRESETS", () => {
  test("all presets have enabled: true", () => {
    for (const [, preset] of Object.entries(FILTER_PRESETS)) {
      expect(preset.settings.enabled).toBe(true);
    }
  });

  test("all presets have name and description", () => {
    for (const [, preset] of Object.entries(FILTER_PRESETS)) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  test("highQualityOnly has correct thresholds", () => {
    const s = FILTER_PRESETS.highQualityOnly.settings;
    expect(s.minScore).toBe(100);
    expect(s.minUpvoteRatio).toBe(0.9);
  });

  test("textPostsOnly includes only text posts", () => {
    const s = FILTER_PRESETS.textPostsOnly.settings;
    expect(s.includePostTypes).toEqual(["text"]);
    expect(s.includeComments).toBe(false);
  });

  test("noNsfw excludes NSFW", () => {
    expect(FILTER_PRESETS.noNsfw.settings.excludeNsfw).toBe(true);
  });

  test("recentOnly uses last_month preset", () => {
    expect(FILTER_PRESETS.recentOnly.settings.dateRangePreset).toBe("last_month");
  });

  test("discussionsOnly requires 10+ comments", () => {
    const s = FILTER_PRESETS.discussionsOnly.settings;
    expect(s.minCommentCount).toBe(10);
    expect(s.includePostTypes).toEqual(["text"]);
  });

  test("presets inherit all DEFAULT_FILTER_SETTINGS fields", () => {
    const defaultKeys = Object.keys(DEFAULT_FILTER_SETTINGS);
    for (const [, preset] of Object.entries(FILTER_PRESETS)) {
      for (const field of defaultKeys) {
        expect(field in preset.settings).toBe(true);
      }
    }
  });

  test("highQualityOnly preset actually filters low-score items", () => {
    const engine = new FilterEngine(FILTER_PRESETS.highQualityOnly.settings);
    const makeItem = (overrides: Partial<RedditItemData> = {}) => ({
      kind: "t3",
      data: {
        id: "test1",
        name: "t3_test1",
        author: "testauthor",
        subreddit: "testsubreddit",
        permalink: "/r/testsubreddit/comments/test1/",
        created_utc: Math.floor(Date.now() / 1000) - 3600,
        score: 50,
        ...overrides,
      } as RedditItemData,
    });
    expect(engine.shouldIncludeItem(makeItem({ score: 10 })).passes).toBe(false);
    expect(engine.shouldIncludeItem(makeItem({ score: 200 })).passes).toBe(true);
  });

  test("noNsfw preset actually filters NSFW items", () => {
    const engine = new FilterEngine(FILTER_PRESETS.noNsfw.settings);
    const item = {
      kind: "t3",
      data: {
        id: "nsfw1",
        name: "t3_nsfw1",
        author: "testauthor",
        subreddit: "testsubreddit",
        permalink: "/r/testsubreddit/comments/nsfw1/",
        created_utc: Math.floor(Date.now() / 1000),
        score: 50,
        over_18: true,
      } as RedditItemData,
    };
    expect(engine.shouldIncludeItem(item).passes).toBe(false);
  });

  test("recentOnly preset actually filters old items", () => {
    const engine = new FilterEngine(FILTER_PRESETS.recentOnly.settings);
    const makeItem = (createdUtc: number) => ({
      kind: "t3",
      data: {
        id: "recent1",
        name: "t3_recent1",
        author: "testauthor",
        subreddit: "testsubreddit",
        permalink: "/r/testsubreddit/comments/recent1/",
        created_utc: createdUtc,
        score: 50,
      } as RedditItemData,
    });
    // Item from 2 months ago — should be filtered
    const twoMonthsAgo = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
    expect(engine.shouldIncludeItem(makeItem(twoMonthsAgo)).passes).toBe(false);
    // Item from yesterday — should pass
    const yesterday = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    expect(engine.shouldIncludeItem(makeItem(yesterday)).passes).toBe(true);
  });

  test("discussionsOnly preset actually filters low-comment posts", () => {
    const engine = new FilterEngine(FILTER_PRESETS.discussionsOnly.settings);
    const makeItem = (overrides: Partial<RedditItemData> = {}) => ({
      kind: "t3",
      data: {
        id: "disc1",
        name: "t3_disc1",
        author: "testauthor",
        subreddit: "testsubreddit",
        permalink: "/r/testsubreddit/comments/disc1/",
        created_utc: Math.floor(Date.now() / 1000),
        score: 50,
        is_self: true,
        num_comments: 3,
        ...overrides,
      } as RedditItemData,
    });
    // 3 comments — below 10 minimum
    expect(engine.shouldIncludeItem(makeItem({ num_comments: 3 })).passes).toBe(false);
    // 50 comments — passes
    expect(engine.shouldIncludeItem(makeItem({ num_comments: 50 })).passes).toBe(true);
  });

  test("DEFAULT_FILTER_SETTINGS is frozen (mutation throws)", () => {
    const mutableSettings = DEFAULT_FILTER_SETTINGS as unknown as FilterSettings;

    expect(() => {
      mutableSettings.enabled = true;
    }).toThrow();
    expect(() => {
      mutableSettings.subredditList.push("test");
    }).toThrow();
    expect(() => {
      mutableSettings.includePostTypes.push("video");
    }).toThrow();
  });
});

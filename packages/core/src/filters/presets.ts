import { DEFAULT_FILTER_SETTINGS } from "../constants";
import type { DateRangePreset, FilterSettings, PostType } from "../types";

/**
 * Filter preset templates for common use cases.
 * Direct port from reference filters.ts.
 */
export const FILTER_PRESETS = {
  highQualityOnly: {
    name: "High Quality Only",
    description: "Only include posts with 100+ upvotes and 90%+ upvote ratio",
    settings: {
      ...DEFAULT_FILTER_SETTINGS,
      enabled: true,
      minScore: 100,
      minUpvoteRatio: 0.9,
    } satisfies FilterSettings,
  },
  textPostsOnly: {
    name: "Text Posts Only",
    description: "Only include self/text posts, no links or media",
    settings: {
      ...DEFAULT_FILTER_SETTINGS,
      enabled: true,
      includePostTypes: ["text"] as PostType[],
      includeComments: false,
    } satisfies FilterSettings,
  },
  noNsfw: {
    name: "SFW Only",
    description: "Exclude all NSFW content",
    settings: {
      ...DEFAULT_FILTER_SETTINGS,
      enabled: true,
      excludeNsfw: true,
    } satisfies FilterSettings,
  },
  recentOnly: {
    name: "Recent Posts",
    description: "Only include posts from the last month",
    settings: {
      ...DEFAULT_FILTER_SETTINGS,
      enabled: true,
      dateRangePreset: "last_month" as DateRangePreset,
    } satisfies FilterSettings,
  },
  discussionsOnly: {
    name: "Discussions Only",
    description: "Only include posts with significant discussion (10+ comments)",
    settings: {
      ...DEFAULT_FILTER_SETTINGS,
      enabled: true,
      includePostTypes: ["text"] as PostType[],
      minCommentCount: 10,
    } satisfies FilterSettings,
  },
} as const;

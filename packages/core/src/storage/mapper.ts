import type { RedditItem, ContentOrigin, PostRow } from "../types";
import { THUMBNAIL_SENTINELS } from "../constants";
import { decodeHtmlEntities } from "../utils/html-escape";

/**
 * Map a RedditItem (from the API) to a flat PostRow (for SQLite).
 * Extracts preview_url, thumbnail, and serializes raw_json.
 */
export function mapRedditItemToRow(item: RedditItem, origin: ContentOrigin): PostRow {
  const d = item.data;
  const now = Date.now();

  // Extract highest-resolution preview image URL (decode HTML entities in URL)
  let previewUrl: string | null = null;
  const previewSource = d.preview?.images?.[0]?.source;
  if (previewSource?.url) {
    previewUrl = decodeHtmlEntities(previewSource.url);
  }

  // Skip sentinel thumbnail values
  const thumbnail = d.thumbnail && !THUMBNAIL_SENTINELS.has(d.thumbnail) ? d.thumbnail : null;

  return {
    id: d.id,
    name: d.name,
    kind: item.kind,
    content_origin: origin,
    title: d.title ?? null,
    author: d.author,
    subreddit: d.subreddit,
    permalink: d.permalink,
    url: d.url ?? null,
    domain: d.domain ?? null,
    selftext: d.selftext ?? null,
    body: d.body ?? null,
    score: d.score,
    created_utc: d.created_utc,
    num_comments: d.num_comments ?? null,
    upvote_ratio: d.upvote_ratio ?? null,
    is_self: d.is_self === undefined ? null : d.is_self ? 1 : 0,
    over_18: d.over_18 ? 1 : 0,
    is_video: d.is_video ? 1 : 0,
    is_gallery: d.is_gallery ? 1 : 0,
    post_hint: d.post_hint ?? null,
    link_flair_text: d.link_flair_text ?? null,
    thumbnail,
    preview_url: previewUrl,

    // Comment-specific
    parent_id: d.parent_id ?? null,
    link_id: d.link_id ?? null,
    link_title: d.link_title ?? null,
    link_permalink: d.link_permalink ?? null,
    is_submitter: d.is_submitter ? 1 : 0,

    // Status flags
    distinguished: d.distinguished ?? null,
    edited: typeof d.edited === "number" ? d.edited : d.edited === true ? 1 : null,
    stickied: d.stickied ? 1 : 0,
    spoiler: d.spoiler ? 1 : 0,
    locked: d.locked ? 1 : 0,
    archived: d.archived ? 1 : 0,
    fetched_at: now,
    updated_at: now,
    is_on_reddit: 1,
    last_seen_at: now,
    raw_json: JSON.stringify(item),
  };
}

import { describe, expect, test } from "bun:test";
import { mapRedditItemToRow } from "../src/storage/mapper";
import type { RedditItem } from "../src/types";

describe("mapRedditItemToRow", () => {
  const baseItem: RedditItem = {
    kind: "t3",
    data: {
      id: "abc123",
      name: "t3_abc123",
      title: "Test Post Title",
      author: "testuser",
      subreddit: "typescript",
      permalink: "/r/typescript/comments/abc123/test_post/",
      created_utc: 1700000000,
      score: 42,
      url: "https://example.com",
      domain: "example.com",
      is_self: false,
      over_18: false,
      is_video: false,
    },
  };

  test("maps basic fields correctly", () => {
    const row = mapRedditItemToRow(baseItem, "saved");
    expect(row.id).toBe("abc123");
    expect(row.name).toBe("t3_abc123");
    expect(row.kind).toBe("t3");
    expect(row.content_origin).toBe("saved");
    expect(row.title).toBe("Test Post Title");
    expect(row.author).toBe("testuser");
    expect(row.score).toBe(42);
    expect(row.is_on_reddit).toBe(1);
  });

  test("maps boolean fields to integers", () => {
    const row = mapRedditItemToRow(baseItem, "saved");
    expect(row.is_self).toBe(0);
    expect(row.over_18).toBe(0);
    expect(row.is_video).toBe(0);
  });

  test("handles NSFW post", () => {
    const nsfw: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, over_18: true },
    };
    const row = mapRedditItemToRow(nsfw, "saved");
    expect(row.over_18).toBe(1);
  });

  test("extracts preview_url and decodes HTML entities", () => {
    const withPreview: RedditItem = {
      ...baseItem,
      data: {
        ...baseItem.data,
        preview: {
          images: [
            {
              source: {
                url: "https://example.com/img.jpg?width=100&amp;height=200",
                width: 100,
                height: 200,
              },
            },
          ],
        },
      },
    };
    const row = mapRedditItemToRow(withPreview, "saved");
    expect(row.preview_url).toBe("https://example.com/img.jpg?width=100&height=200");
  });

  test("skips sentinel thumbnail values", () => {
    for (const sentinel of ["self", "default", "nsfw", "spoiler", "image", "video", ""]) {
      const item: RedditItem = {
        ...baseItem,
        data: { ...baseItem.data, thumbnail: sentinel },
      };
      const row = mapRedditItemToRow(item, "saved");
      expect(row.thumbnail).toBeNull();
    }
  });

  test("preserves valid thumbnail URL", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, thumbnail: "https://b.thumbs.redditmedia.com/abc.jpg" },
    };
    const row = mapRedditItemToRow(item, "saved");
    expect(row.thumbnail).toBe("https://b.thumbs.redditmedia.com/abc.jpg");
  });

  test("maps comment fields", () => {
    const comment: RedditItem = {
      kind: "t1",
      data: {
        id: "comment1",
        name: "t1_comment1",
        author: "commenter",
        subreddit: "test",
        permalink: "/r/test/comments/abc/post/comment1/",
        created_utc: 1700000000,
        score: 5,
        body: "Great post!",
        parent_id: "t3_abc",
        link_id: "t3_abc",
        link_title: "Original Post",
        is_submitter: true,
      },
    };
    const row = mapRedditItemToRow(comment, "saved");
    expect(row.kind).toBe("t1");
    expect(row.body).toBe("Great post!");
    expect(row.parent_id).toBe("t3_abc");
    expect(row.link_title).toBe("Original Post");
    expect(row.is_submitter).toBe(1);
  });

  test("serializes raw_json", () => {
    const row = mapRedditItemToRow(baseItem, "saved");
    const parsed = JSON.parse(row.raw_json);
    expect(parsed.kind).toBe("t3");
    expect(parsed.data.id).toBe("abc123");
  });

  test("sets timestamps", () => {
    const before = Date.now();
    const row = mapRedditItemToRow(baseItem, "saved");
    const after = Date.now();

    expect(row.fetched_at).toBeGreaterThanOrEqual(before);
    expect(row.fetched_at).toBeLessThanOrEqual(after);
    expect(row.updated_at).toBe(row.fetched_at);
    expect(row.last_seen_at).toBe(row.fetched_at);
  });

  test("maps edited as numeric timestamp when number", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, edited: 1700001234 },
    };
    expect(mapRedditItemToRow(item, "saved").edited).toBe(1700001234);
  });

  test("maps edited=true to 1", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, edited: true },
    };
    expect(mapRedditItemToRow(item, "saved").edited).toBe(1);
  });

  test("maps edited=false to 0 (not edited)", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, edited: false },
    };
    expect(mapRedditItemToRow(item, "saved").edited).toBe(0);
  });

  test("maps edited=undefined to 0 (field absent)", () => {
    // baseItem does not set edited, so it is undefined
    const row = mapRedditItemToRow(baseItem, "saved");
    expect(row.edited).toBe(0);
  });

  test("maps is_gallery: true to 1", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, is_gallery: true },
    };
    const row = mapRedditItemToRow(item, "saved");
    expect(row.is_gallery).toBe(1);
  });

  test("maps is_gallery undefined to 0", () => {
    const row = mapRedditItemToRow(baseItem, "saved");
    expect(row.is_gallery).toBe(0);
  });

  test("maps link_permalink for comments", () => {
    const comment: RedditItem = {
      kind: "t1",
      data: {
        id: "c2",
        name: "t1_c2",
        author: "user",
        subreddit: "test",
        permalink: "/r/test/comments/abc/post/c2/",
        created_utc: 1700000000,
        score: 3,
        body: "nice",
        link_permalink: "/r/test/comments/abc/original_post/",
      },
    };
    const row = mapRedditItemToRow(comment, "saved");
    expect(row.link_permalink).toBe("/r/test/comments/abc/original_post/");
  });

  test("preview with empty images array yields null preview_url", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, preview: { images: [] } },
    };
    const row = mapRedditItemToRow(item, "saved");
    expect(row.preview_url).toBeNull();
  });

  test("maps is_self=true to 1", () => {
    const item: RedditItem = {
      ...baseItem,
      data: { ...baseItem.data, is_self: true },
    };
    expect(mapRedditItemToRow(item, "saved").is_self).toBe(1);
  });

  test("maps is_self=undefined to null (comments)", () => {
    const comment: RedditItem = {
      kind: "t1",
      data: {
        id: "c1",
        name: "t1_c1",
        author: "user",
        subreddit: "test",
        permalink: "/r/test/comments/abc/post/c1/",
        created_utc: 1700000000,
        score: 1,
        body: "hello",
        // is_self intentionally omitted
      },
    };
    const row = mapRedditItemToRow(comment, "saved");
    expect(row.is_self).toBeNull();
  });
});

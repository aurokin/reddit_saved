import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { TagManager } from "../src/tags/tag-manager";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-saved-test-"));
  return join(dir, "test.db");
}

function makeItem(id: string): RedditItem {
  return {
    kind: "t3",
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      author: "user",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/`,
      created_utc: 1700000000,
      score: 1,
    },
  };
}

describe("TagManager", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;
  let tags: TagManager;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
    tags = new TagManager(adapter.getDb());
    // Insert some posts
    adapter.upsertPosts([makeItem("p1"), makeItem("p2"), makeItem("p3")], "saved");
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("createTag and listTags", () => {
    tags.createTag("machine-learning", "#4ade80");
    const list = tags.listTags();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("machine-learning");
    expect(list[0].color).toBe("#4ade80");
    expect(list[0].count).toBe(0);
  });

  test("renameTag", () => {
    tags.createTag("ml");
    tags.renameTag("ml", "machine-learning");
    const list = tags.listTags();
    expect(list[0].name).toBe("machine-learning");
  });

  test("renameTag throws for nonexistent tag", () => {
    expect(() => tags.renameTag("nope", "still-nope")).toThrow("not found");
  });

  test("deleteTag removes tag and associations", () => {
    tags.createTag("temp");
    tags.addTagToPost("temp", "p1");
    tags.deleteTag("temp");

    expect(tags.listTags().length).toBe(0);
    expect(tags.getTagsForPost("p1").length).toBe(0);
  });

  test("addTagToPost and getTagsForPost", () => {
    tags.createTag("rust");
    tags.createTag("tutorial");
    tags.addTagToPost("rust", "p1");
    tags.addTagToPost("tutorial", "p1");

    const postTags = tags.getTagsForPost("p1");
    expect(postTags.length).toBe(2);
    expect(postTags.map((t) => t.name).sort()).toEqual(["rust", "tutorial"]);
  });

  test("addTagToPost is idempotent", () => {
    tags.createTag("rust");
    tags.addTagToPost("rust", "p1");
    tags.addTagToPost("rust", "p1"); // no-op
    expect(tags.getTagsForPost("p1").length).toBe(1);
  });

  test("removeTagFromPost", () => {
    tags.createTag("rust");
    tags.addTagToPost("rust", "p1");
    tags.removeTagFromPost("rust", "p1");
    expect(tags.getTagsForPost("p1").length).toBe(0);
  });

  test("getPostsByTag", () => {
    tags.createTag("rust");
    tags.addTagToPost("rust", "p1");
    tags.addTagToPost("rust", "p3");

    const posts = tags.getPostsByTag("rust");
    expect(posts.length).toBe(2);
    expect(posts.map((p) => p.id).sort()).toEqual(["p1", "p3"]);
  });

  test("listTags includes counts", () => {
    tags.createTag("rust");
    tags.createTag("empty");
    tags.addTagToPost("rust", "p1");
    tags.addTagToPost("rust", "p2");

    const list = tags.listTags();
    const rust = list.find((t) => t.name === "rust");
    const empty = list.find((t) => t.name === "empty");
    expect(rust?.count).toBe(2);
    expect(empty?.count).toBe(0);
  });

  test("tag names are case-insensitive", () => {
    tags.createTag("Rust");
    expect(() => tags.createTag("rust")).toThrow(); // UNIQUE COLLATE NOCASE
  });

  test("removeTagFromPost throws when association doesn't exist", () => {
    tags.createTag("rust");
    expect(() => tags.removeTagFromPost("rust", "p1")).toThrow("does not have tag");
  });

  test("createTag returns the created tag directly", () => {
    const tag = tags.createTag("test-tag", "#ff0000");
    expect(tag.name).toBe("test-tag");
    expect(tag.color).toBe("#ff0000");
    expect(tag.id).toBeGreaterThan(0);
  });

  test("createTag trims whitespace from name", () => {
    const tag = tags.createTag("  rust  ");
    expect(tag.name).toBe("rust");
  });

  test("deleteTag throws for nonexistent tag", () => {
    expect(() => tags.deleteTag("nope")).toThrow("not found");
  });

  test("renameTag validates new name is not empty", () => {
    tags.createTag("ml");
    expect(() => tags.renameTag("ml", "   ")).toThrow("cannot be empty");
  });

  test("renameTag validates new name length", () => {
    tags.createTag("ml");
    expect(() => tags.renameTag("ml", "a".repeat(101))).toThrow("cannot exceed 100");
  });

  test("renameTag trims whitespace", () => {
    tags.createTag("ml");
    tags.renameTag("  ml  ", "  machine-learning  ");
    const list = tags.listTags();
    expect(list[0].name).toBe("machine-learning");
  });

  test("deleteTag trims whitespace", () => {
    tags.createTag("temp");
    tags.deleteTag("  temp  ");
    expect(tags.listTags().length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // New coverage: error paths and edge cases
  // -----------------------------------------------------------------------

  test("addTagToPost throws when tag does not exist", () => {
    expect(() => tags.addTagToPost("nonexistent", "p1")).toThrow('Tag "nonexistent" not found');
  });

  test("addTagToPost throws when post does not exist", () => {
    tags.createTag("rust");
    expect(() => tags.addTagToPost("rust", "no_such_post")).toThrow(
      'Item "no_such_post" not found',
    );
  });

  test("removeTagFromPost throws when tag does not exist", () => {
    expect(() => tags.removeTagFromPost("nonexistent", "p1")).toThrow(
      'Tag "nonexistent" not found',
    );
  });

  test("renameTag throws on duplicate name conflict", () => {
    tags.createTag("alpha");
    tags.createTag("beta");
    expect(() => tags.renameTag("alpha", "beta")).toThrow('Tag "beta" already exists');
  });

  test("createTag throws for name exceeding 100 characters", () => {
    expect(() => tags.createTag("a".repeat(101))).toThrow("cannot exceed 100");
  });

  test("getPostsByTag returns empty array for non-existent tag", () => {
    const results = tags.getPostsByTag("nonexistent");
    expect(results).toEqual([]);
  });

  test("getPostsByTag throws for invalid limit", () => {
    tags.createTag("rust");
    expect(() => tags.getPostsByTag("rust", 0)).toThrow("positive integer");
    expect(() => tags.getPostsByTag("rust", -1)).toThrow("positive integer");
    expect(() => tags.getPostsByTag("rust", 10_001)).toThrow("positive integer");
    expect(() => tags.getPostsByTag("rust", 1.5)).toThrow("positive integer");
  });

  test("getPostsByTag respects limit", () => {
    tags.createTag("rust");
    tags.addTagToPost("rust", "p1");
    tags.addTagToPost("rust", "p2");
    tags.addTagToPost("rust", "p3");

    const results = tags.getPostsByTag("rust", 2);
    expect(results.length).toBe(2);
  });
});

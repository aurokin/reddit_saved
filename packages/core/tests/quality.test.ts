import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qualityReason, qualityWhereClause } from "../src/filters/quality";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import type { PostRow, RedditItem } from "../src/types";

interface Fixture {
  label: string;
  item: RedditItem;
  expectKept: boolean;
}

function makeItem(
  id: string,
  overrides: Partial<{
    kind: string;
    title: string;
    author: string;
    body: string;
    selftext: string;
    score: number;
    distinguished: string;
    stickied: boolean;
  }> = {},
): RedditItem {
  return {
    kind: overrides.kind ?? "t3",
    data: {
      id,
      name: `${overrides.kind ?? "t3"}_${id}`,
      title: overrides.title ?? `Post ${id}`,
      author: overrides.author ?? "gooduser",
      subreddit: "test",
      permalink: `/r/test/comments/${id}/post/`,
      created_utc: 1_700_000_000,
      score: overrides.score ?? 10,
      body: overrides.body,
      selftext: overrides.selftext,
      distinguished: overrides.distinguished,
      stickied: overrides.stickied,
    },
  };
}

const FIXTURES: Fixture[] = [
  { label: "normal post", item: makeItem("keep1"), expectKept: true },
  {
    label: "normal comment",
    item: makeItem("keep2", {
      kind: "t1",
      body: "A thoughtful comment with plenty of substance to it.",
      score: 5,
    }),
    expectKept: true,
  },
  {
    label: "short comment but positive score",
    item: makeItem("keep3", { kind: "t1", body: "yes", score: 3 }),
    expectKept: true,
  },
  {
    label: "long comment with negative score",
    item: makeItem("keep4", {
      kind: "t1",
      body: "An unpopular but substantive opinion that runs well past sixty characters in length.",
      score: -5,
    }),
    expectKept: true,
  },
  {
    label: "comment with null body and high score",
    item: makeItem("keep5", { kind: "t1", score: 8 }),
    expectKept: true,
  },
  {
    label: "deleted author",
    item: makeItem("drop1", { author: "[deleted]" }),
    expectKept: false,
  },
  {
    label: "removed body",
    item: makeItem("drop2", { kind: "t1", body: "[removed]", score: 5 }),
    expectKept: false,
  },
  {
    label: "deleted selftext",
    item: makeItem("drop3", { selftext: "[deleted]" }),
    expectKept: false,
  },
  {
    label: "AutoModerator",
    item: makeItem("drop4", { author: "AutoModerator", body: "I am a bot." }),
    expectKept: false,
  },
  {
    label: "moderator sticky",
    item: makeItem("drop5", { distinguished: "moderator", stickied: true }),
    expectKept: false,
  },
  {
    label: "low-score short comment",
    item: makeItem("drop6", { kind: "t1", body: "lol", score: 0 }),
    expectKept: false,
  },
];

describe("quality filters", () => {
  let dir: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reddit-saved-quality-"));
    adapter = new SqliteAdapter(join(dir, "test.db"));
    adapter.upsertPosts(
      FIXTURES.map((f) => f.item),
      "saved",
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("SQL clause and JS labeler agree on every fixture (lockstep)", () => {
    const keptBySql = new Set(
      (
        adapter.getDb().query(`SELECT p.id FROM posts p WHERE ${qualityWhereClause()}`).all() as {
          id: string;
        }[]
      ).map((r) => r.id),
    );

    for (const fixture of FIXTURES) {
      const id = fixture.item.data.id;
      const row = adapter.getPost(id) as PostRow;
      const reason = qualityReason(row);

      expect({ label: fixture.label, sqlKept: keptBySql.has(id) }).toEqual({
        label: fixture.label,
        sqlKept: fixture.expectKept,
      });
      expect({ label: fixture.label, jsKept: reason === null }).toEqual({
        label: fixture.label,
        jsKept: fixture.expectKept,
      });
    }
  });

  test("listPosts hideLowQuality drops exactly the low-quality fixtures", () => {
    const kept = adapter.listPosts({ hideLowQuality: true, limit: 100 }).map((r) => r.id);
    const expected = FIXTURES.filter((f) => f.expectKept).map((f) => f.item.data.id);
    expect(kept.sort()).toEqual(expected.sort());
  });

  test("searchPosts hideLowQuality filters FTS results", () => {
    // All fixture posts share the word "Post" in their titles.
    const all = adapter.searchPosts("post", { limit: 100 });
    const filtered = adapter.searchPosts("post", { hideLowQuality: true, limit: 100 });
    expect(all.length).toBeGreaterThan(filtered.length);
    for (const row of filtered) {
      expect(qualityReason(row)).toBeNull();
    }
  });

  test("hideLowQuality unset keeps everything", () => {
    const kept = adapter.listPosts({ limit: 100 });
    expect(kept.length).toBe(FIXTURES.length);
  });
});

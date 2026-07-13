import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalizeUrl, extractUrls, isRedditHost } from "../src/links/url-extract";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import type { RedditItem } from "../src/types";

describe("extractUrls", () => {
  const cases: Array<{ name: string; text: string; expected: string[] }> = [
    {
      name: "bare url",
      text: "check https://example.com/page out",
      expected: ["https://example.com/page"],
    },
    {
      name: "markdown link",
      text: "see [the docs](https://example.com/docs) here",
      expected: ["https://example.com/docs"],
    },
    {
      name: "wikipedia-style balanced parens survive",
      text: "https://en.wikipedia.org/wiki/Rust_(programming_language)",
      expected: ["https://en.wikipedia.org/wiki/Rust_(programming_language)"],
    },
    {
      name: "trailing punctuation stripped",
      text: "read https://example.com/a, then https://example.com/b.",
      expected: ["https://example.com/a", "https://example.com/b"],
    },
    {
      name: "url inside plain parens loses the closing paren",
      text: "(see https://example.com/x)",
      expected: ["https://example.com/x"],
    },
    {
      name: "duplicates collapse, order preserved",
      text: "https://b.com then https://a.com then https://b.com",
      expected: ["https://b.com", "https://a.com"],
    },
    { name: "no urls", text: "nothing to see here", expected: [] },
    {
      name: "http and quotes terminate",
      text: `"http://quoted.com/path" end`,
      expected: ["http://quoted.com/path"],
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(extractUrls(c.text)).toEqual(c.expected);
    });
  }
});

describe("canonicalizeUrl", () => {
  const cases: Array<{ name: string; url: string; canonical: string | null; host?: string }> = [
    {
      name: "lowercases host and strips www",
      url: "https://WWW.Example.COM/Path",
      canonical: "example.com/Path",
      host: "example.com",
    },
    {
      name: "drops fragment and trailing slash",
      url: "https://example.com/a/b/#section",
      canonical: "example.com/a/b",
    },
    {
      name: "removes tracking params and sorts the rest",
      url: "https://example.com/p?utm_source=x&b=2&fbclid=abc&a=1",
      canonical: "example.com/p?a=1&b=2",
    },
    {
      name: "http and https collapse to the same canonical",
      url: "http://example.com/x",
      canonical: "example.com/x",
    },
    {
      name: "youtube si param dropped",
      url: "https://youtu.be/dQw4w9WgXcQ?si=tracking123",
      canonical: "youtu.be/dQw4w9WgXcQ",
    },
    { name: "non-http scheme rejected", url: "ftp://example.com/file", canonical: null },
    { name: "garbage rejected", url: "https://", canonical: null },
    {
      name: "port preserved",
      url: "http://localhost:3001/api",
      canonical: "localhost:3001/api",
      host: "localhost",
    },
    { name: "bare host has empty path", url: "https://example.com/", canonical: "example.com" },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const result = canonicalizeUrl(c.url);
      if (c.canonical === null) {
        expect(result).toBeNull();
      } else {
        expect(result?.canonical).toBe(c.canonical);
        if (c.host) expect(result?.host).toBe(c.host);
      }
    });
  }
});

describe("isRedditHost", () => {
  test("matches reddit-owned hosts only", () => {
    for (const host of [
      "reddit.com",
      "old.reddit.com",
      "redd.it",
      "i.redd.it",
      "preview.redd.it",
    ]) {
      expect(isRedditHost(host)).toBe(true);
    }
    for (const host of ["example.com", "notreddit.com", "reddit.com.evil.com"]) {
      expect(isRedditHost(host)).toBe(false);
    }
  });
});

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cached-links-"));
  return join(dir, "test.db");
}

function makeLinkPost(
  id: string,
  overrides: Partial<{
    url: string;
    selftext: string;
    body: string;
    kind: string;
    created_utc: number;
  }> = {},
): RedditItem {
  const kind = overrides.kind ?? "t3";
  return {
    kind,
    data: {
      id,
      name: `${kind}_${id}`,
      title: `Post ${id}`,
      author: "author",
      subreddit: "sub",
      permalink: `/r/sub/comments/${id}/post/`,
      created_utc: overrides.created_utc ?? 1700000000,
      score: 5,
      url: overrides.url,
      selftext: overrides.selftext,
      body: overrides.body,
    },
  };
}

describe("link index in SqliteAdapter", () => {
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    adapter = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    adapter.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("upsertPosts indexes url, selftext, and body links in one transaction", () => {
    adapter.upsertPosts(
      [
        makeLinkPost("l1", {
          url: "https://article.example.com/story?utm_source=reddit",
          selftext:
            "context at https://docs.example.com/guide and https://article.example.com/story",
        }),
        makeLinkPost("l2", { kind: "t1", body: "reply with https://docs.example.com/guide" }),
      ],
      "saved",
    );

    const top = adapter.topLinks();
    expect(top).toHaveLength(2);
    // docs guide: 2 posts; article story: 1 post, 2 occurrences
    expect(top[0].canonical_url).toBe("docs.example.com/guide");
    expect(top[0].postCount).toBe(2);
    expect(top[1].canonical_url).toBe("article.example.com/story");
    expect(top[1].postCount).toBe(1);
    expect(top[1].occurrenceCount).toBe(2);
  });

  test("re-upserting a post replaces its occurrences instead of duplicating", () => {
    adapter.upsertPosts(
      [makeLinkPost("r1", { selftext: "https://a.com and https://b.com" })],
      "saved",
    );
    adapter.upsertPosts([makeLinkPost("r1", { selftext: "now only https://a.com" })], "saved");

    const top = adapter.topLinks();
    expect(top.map((t) => t.canonical_url)).toEqual(["a.com"]);
  });

  test("self-post url pointing at its own permalink is not indexed", () => {
    adapter.upsertPosts(
      [makeLinkPost("self1", { url: "https://www.reddit.com/r/sub/comments/self1/post/" })],
      "saved",
    );
    expect(adapter.topLinks()).toHaveLength(0);
  });

  test("topLinks respects since and excludeReddit", () => {
    adapter.upsertPosts(
      [
        makeLinkPost("old1", { url: "https://old.example.com/x", created_utc: 1000000000 }),
        makeLinkPost("new1", { url: "https://new.example.com/y", created_utc: 1700000000 }),
        makeLinkPost("red1", {
          url: "https://old.reddit.com/r/foo/comments/abc/",
          created_utc: 1700000000,
        }),
      ],
      "saved",
    );

    const all = adapter.topLinks();
    expect(all).toHaveLength(3);

    const recent = adapter.topLinks({ since: 1600000000 });
    expect(recent.map((t) => t.host).sort()).toEqual(["new.example.com", "old.reddit.com"]);

    const nonReddit = adapter.topLinks({ since: 1600000000, excludeReddit: true });
    expect(nonReddit.map((t) => t.host)).toEqual(["new.example.com"]);
  });

  test("excludeReddit filters before the limit so reddit-heavy archives still fill the top-N", () => {
    // Three distinct reddit links each referenced by two posts outrank the
    // lone external link; a post-LIMIT filter would return zero rows here.
    const posts = [];
    for (let i = 0; i < 3; i++) {
      posts.push(
        makeLinkPost(`ra${i}`, { url: `https://i.redd.it/img${i}.png` }),
        makeLinkPost(`rb${i}`, { body: `dupe https://i.redd.it/img${i}.png` }),
      );
    }
    posts.push(makeLinkPost("ext1", { url: "https://example.com/tool" }));
    adapter.upsertPosts(posts, "saved");

    const top = adapter.topLinks({ excludeReddit: true, limit: 2 });
    expect(top.map((t) => t.host)).toEqual(["example.com"]);
  });

  test("searchLinks matches substrings and escapes LIKE wildcards", () => {
    adapter.upsertPosts(
      [
        makeLinkPost("s1", { url: "https://github.com/steipete/birdclaw" }),
        makeLinkPost("s2", { body: "see https://github.com/oven-sh/bun" }),
        makeLinkPost("s3", { body: "https://example.com/100%_real" }),
      ],
      "saved",
    );

    const github = adapter.searchLinks("github.com");
    expect(github).toHaveLength(2);
    expect(github[0].subreddit).toBe("sub");

    expect(adapter.searchLinks("birdclaw")).toHaveLength(1);
    // '%' treated literally, not as a wildcard
    expect(adapter.searchLinks("100%_real")).toHaveLength(1);
    expect(adapter.searchLinks("100%none")).toHaveLength(0);
  });

  test("rebuildLinkIndex regenerates from posts", () => {
    adapter.upsertPosts([makeLinkPost("rb1", { url: "https://example.com/keep" })], "saved");
    adapter.getDb().run("DELETE FROM link_occurrences");
    expect(adapter.topLinks()).toHaveLength(0);

    const count = adapter.rebuildLinkIndex();
    expect(count).toBe(1);
    expect(adapter.topLinks()[0].canonical_url).toBe("example.com/keep");
  });

  test("migration v4 backfills links for a pre-v4 database", () => {
    // Simulate: rows existed before v4 by deleting the index, then re-running
    // the migration path via a fresh adapter after dropping the version row.
    adapter.upsertPosts([makeLinkPost("bf1", { url: "https://example.com/backfill" })], "saved");
    adapter.getDb().run("DELETE FROM link_occurrences");
    adapter.getDb().run("DROP TABLE link_occurrences");
    // Roll back to v3 — versions past the link-index migration must go too,
    // or MAX(version) hides the gap and nothing re-runs (inbox_items from v5
    // is IF NOT EXISTS, so leaving its table behind is harmless).
    adapter.getDb().run("DELETE FROM schema_version WHERE version >= 4");
    adapter.close();

    const reopened = new SqliteAdapter(dbPath);
    try {
      expect(reopened.topLinks()[0].canonical_url).toBe("example.com/backfill");
    } finally {
      reopened.close();
    }
  });
});

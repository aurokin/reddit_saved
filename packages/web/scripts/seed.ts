#!/usr/bin/env bun
/**
 * Dev seed: generate ~200 RedditItem fixtures against ./dev-data/reddit-saved.db.
 * Idempotent — drops and re-creates the database file.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CONTENT_ORIGIN_SAVED,
  type ContentOrigin,
  type RedditItem,
  SqliteAdapter,
  TagManager,
} from "@reddit-saved/core";

const SUBREDDITS = [
  "programming",
  "typescript",
  "reactjs",
  "rust",
  "golang",
  "MachineLearning",
  "webdev",
  "askreddit",
  "news",
  "science",
  "space",
  "tech",
  "selfhosted",
  "linux",
  "buildapc",
];

const AUTHORS = [
  "alice",
  "bob",
  "carol",
  "dave",
  "eve",
  "frank",
  "grace",
  "henry",
  "iris",
  "john",
  "kate",
  "leo",
];

const TITLES = [
  "Show HN: I built a thing and it works",
  "Why you should stop doing X in 2026",
  "The complete guide to",
  "A surprising bug I found in",
  "Deep dive: how we scaled",
  "Benchmarking 5 popular",
  "What nobody tells you about",
  "Building a production-grade",
  "Postmortem of our recent outage",
  "Ten patterns for writing testable",
  "Rewriting our monolith in",
  "How TypeScript saved our bacon",
];

const SUFFIXES = [
  "React hooks",
  "SQLite indexes",
  "Rust lifetimes",
  "Go channels",
  "Bun runtime",
  "Tailwind v4",
  "OAuth flows",
  "streaming responses",
  "virtualized lists",
  "memory profiles",
  "dark mode",
  "web vitals",
  "feature flags",
  "cache invalidation",
];

const BODIES = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.",
  "The key insight is to measure before you optimize. Here's what we learned after a month of profiling.",
  "## Setup\n\nFirst install the package:\n\n```bash\nbun add foo\n```\n\nThen import it and call `configure()`.",
  "Honestly this blew my mind. I had been doing this wrong for years.",
  "TL;DR — it depends. But here's the context in which it matters.",
  "Quick question: has anyone else seen this error when running on ARM64?",
  "Long-form write-up follows. Grab a coffee.\n\nThe problem started when...",
  "I disagree with the top comment. Here's why the opposite is almost always true in practice.",
];

const DOMAINS = [
  "github.com",
  "example.com",
  "medium.com",
  "youtube.com",
  "arxiv.org",
  "reddit.com",
  "blog.rust-lang.org",
  "news.ycombinator.com",
];

const EXTERNAL_URLS: Record<string, string> = {
  "youtube.com": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "github.com": "https://github.com/oven-sh/bun",
  "arxiv.org": "https://arxiv.org/abs/2303.12345",
};

const IMAGE_URLS = [
  "https://i.redd.it/example1.jpg",
  "https://i.redd.it/example2.png",
  "https://i.redd.it/example3.jpg",
];

const TAG_FIXTURES: Array<{ name: string; color?: string }> = [
  { name: "read-later", color: "#3b82f6" },
  { name: "important", color: "#ef4444" },
  { name: "tutorial", color: "#22c55e" },
  { name: "reference", color: "#a855f7" },
  { name: "funny", color: "#eab308" },
  { name: "project-ideas" },
];

const ORIGINS: ContentOrigin[] = ["saved", "upvoted", "submitted", "commented"];

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so seeded DBs diff cleanly between runs.
// ---------------------------------------------------------------------------
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main(): void {
  const dbPath = resolve(process.cwd(), "dev-data/reddit-saved.db");
  mkdirSync(dirname(dbPath), { recursive: true });

  // Wipe old db + sidecar files for idempotency
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(dbPath + suffix);
    } catch {
      /* not present */
    }
  }

  const storage = new SqliteAdapter(dbPath);
  const tags = new TagManager(storage.getDb());

  try {
    const rng = createRng(1337);
    const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)] as T;

    const now = Math.floor(Date.now() / 1000);
    const yearAgo = now - 365 * 24 * 3600;

    const byOrigin: Record<ContentOrigin, RedditItem[]> = {
      saved: [],
      upvoted: [],
      submitted: [],
      commented: [],
    };

    for (let i = 0; i < 200; i++) {
      const origin = i < 120 ? "saved" : pick(ORIGINS);
      const isComment = rng() < 0.2;
      const subreddit = pick(SUBREDDITS);
      const author = pick(AUTHORS);
      const title = `${pick(TITLES)} ${pick(SUFFIXES)}`;
      const created = Math.floor(yearAgo + rng() * (now - yearAgo));
      const score = Math.floor(rng() * 5000);
      const id = `seed${i.toString(36).padStart(4, "0")}`;
      const r = rng();
      const kind = isComment ? "t1" : "t3";

      let item: RedditItem;
      if (isComment) {
        const parentId = `seed_p${(i % 20).toString(36).padStart(3, "0")}`;
        item = {
          kind: "t1",
          data: {
            id,
            name: `t1_${id}`,
            author,
            subreddit,
            permalink: `/r/${subreddit}/comments/${parentId}/something/${id}/`,
            created_utc: created,
            score,
            body: pick(BODIES),
            link_id: `t3_${parentId}`,
            link_title: `${pick(TITLES)} ${pick(SUFFIXES)}`,
            link_permalink: `/r/${subreddit}/comments/${parentId}/something/`,
            is_submitter: rng() < 0.1,
            parent_id: `t3_${parentId}`,
          },
        };
      } else if (r < 0.25) {
        // image post
        const img = pick(IMAGE_URLS);
        item = {
          kind: "t3",
          data: {
            id,
            name: `t3_${id}`,
            title,
            author,
            subreddit,
            permalink: `/r/${subreddit}/comments/${id}/something/`,
            created_utc: created,
            score,
            url: img,
            domain: "i.redd.it",
            is_self: false,
            num_comments: Math.floor(rng() * 300),
            upvote_ratio: 0.75 + rng() * 0.24,
            post_hint: "image",
            thumbnail: img,
            preview: {
              images: [{ source: { url: img, width: 800, height: 600 } }],
            },
            over_18: rng() < 0.05,
          },
        };
      } else if (r < 0.35) {
        // gallery
        item = {
          kind: "t3",
          data: {
            id,
            name: `t3_${id}`,
            title,
            author,
            subreddit,
            permalink: `/r/${subreddit}/comments/${id}/gallery/`,
            created_utc: created,
            score,
            is_self: false,
            num_comments: Math.floor(rng() * 500),
            is_gallery: true,
            gallery_data: {
              items: [
                { media_id: "abc1", id: 1 },
                { media_id: "abc2", id: 2 },
                { media_id: "abc3", id: 3 },
              ],
            },
            media_metadata: {
              abc1: { status: "valid", e: "Image", s: { u: IMAGE_URLS[0], x: 800, y: 600 } },
              abc2: { status: "valid", e: "Image", s: { u: IMAGE_URLS[1], x: 800, y: 600 } },
              abc3: { status: "valid", e: "Image", s: { u: IMAGE_URLS[2], x: 800, y: 600 } },
            },
          },
        };
      } else if (r < 0.45) {
        // video
        item = {
          kind: "t3",
          data: {
            id,
            name: `t3_${id}`,
            title,
            author,
            subreddit,
            permalink: `/r/${subreddit}/comments/${id}/video/`,
            created_utc: created,
            score,
            url: "https://v.redd.it/example",
            domain: "v.redd.it",
            is_self: false,
            num_comments: Math.floor(rng() * 200),
            is_video: true,
            post_hint: "hosted:video",
            thumbnail: IMAGE_URLS[0],
          },
        };
      } else if (r < 0.7) {
        // external link
        const domain = pick(DOMAINS);
        item = {
          kind: "t3",
          data: {
            id,
            name: `t3_${id}`,
            title,
            author,
            subreddit,
            permalink: `/r/${subreddit}/comments/${id}/linked/`,
            created_utc: created,
            score,
            url: EXTERNAL_URLS[domain] ?? `https://${domain}/article-${i}`,
            domain,
            is_self: false,
            num_comments: Math.floor(rng() * 400),
            post_hint: "link",
          },
        };
      } else {
        // self/text post
        item = {
          kind: "t3",
          data: {
            id,
            name: `t3_${id}`,
            title,
            author,
            subreddit,
            permalink: `/r/${subreddit}/comments/${id}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}/`,
            created_utc: created,
            score,
            selftext: `${pick(BODIES)}\n\n${pick(BODIES)}`,
            is_self: true,
            num_comments: Math.floor(rng() * 600),
            upvote_ratio: 0.7 + rng() * 0.29,
            link_flair_text: rng() < 0.3 ? pick(["Discussion", "Help", "Question", "Show"]) : undefined,
            over_18: rng() < 0.05,
          },
        };
      }

      (item as { kind: string }).kind = kind;
      if (!isComment && rng() < 0.1) {
        item.data.over_18 = true;
      }

      byOrigin[origin].push(item);
    }

    for (const origin of ORIGINS) {
      if (byOrigin[origin].length > 0) {
        storage.upsertPosts(byOrigin[origin], origin);
      }
    }

    // ~10% orphaned — flip is_on_reddit = 0 directly on a random slice
    const allIds = Object.values(byOrigin)
      .flat()
      .map((i) => i.data.id);
    const orphanCount = Math.max(1, Math.floor(allIds.length * 0.1));
    for (let i = 0; i < orphanCount; i++) {
      const id = allIds[Math.floor(rng() * allIds.length)];
      if (id) storage.markUnsaved([id]);
    }

    // Create tag fixtures + assign tags to a third of items
    for (const t of TAG_FIXTURES) {
      tags.createTag(t.name, t.color);
    }
    for (const id of allIds) {
      if (rng() < 0.33) {
        const tagCount = Math.ceil(rng() * 3);
        const picked = new Set<string>();
        for (let i = 0; i < tagCount; i++) {
          picked.add(pick(TAG_FIXTURES).name);
        }
        for (const name of picked) {
          try {
            tags.addTagToPost(name, id);
          } catch {
            /* tagging an orphan may fail — skip */
          }
        }
      }
    }

    // Record last sync time so the UI has something to show
    storage.setSyncState("last_sync_time", String(Date.now()));
    storage.setSyncState("last_full_sync_time", String(Date.now()));

    const stats = storage.getStats();
    console.log(
      `Seeded ${stats.totalPosts} posts, ${stats.totalComments} comments, ${stats.orphanedCount} orphaned, ${stats.tagCounts.length} tags → ${dbPath}`,
    );
  } finally {
    storage.close();
  }
}

main();

// Silence unused-import warning if the build tool hoists unused imports
void CONTENT_ORIGIN_SAVED;
void join;

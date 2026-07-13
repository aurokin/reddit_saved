import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RedditApiClient } from "../src/api/client";
import { SqliteAdapter } from "../src/storage/sqlite-adapter";
import { deriveInboxType, syncInbox } from "../src/sync/inbox-sync";
import type { RedditItem } from "../src/types";

function makeTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "reddit-cached-inbox-sync-"));
  return join(dir, "test.db");
}

interface InboxOverrides {
  type?: string;
  subject?: string;
  body?: string;
  author?: string;
  subreddit?: string | null;
  context?: string;
  new?: boolean;
  was_comment?: boolean;
  created_utc?: number;
}

function makeInboxReply(id: string, overrides: InboxOverrides = {}): RedditItem {
  const { subreddit, ...rest } = overrides;
  return {
    kind: "t1",
    data: {
      id,
      name: `t1_${id}`,
      author: "replier",
      subreddit: subreddit === null ? undefined : (subreddit ?? "testsub"),
      // Inbox t1 items carry `context` (with ?context=N) instead of permalink
      context: `/r/testsub/comments/post1/title/${id}/?context=3`,
      created_utc: 1700000000,
      score: 3,
      body: `reply body ${id}`,
      subject: "comment reply",
      type: "comment_reply",
      was_comment: true,
      new: true,
      parent_id: "t1_mine",
      link_title: "My post",
      dest: "Areww",
      ...rest,
    } as unknown as RedditItem["data"],
  };
}

function makeInboxMessage(id: string, overrides: InboxOverrides = {}): RedditItem {
  return {
    kind: "t4",
    data: {
      id,
      name: `t4_${id}`,
      author: "sender",
      subject: "hello",
      body: `pm body ${id}`,
      dest: "Areww",
      created_utc: 1700000100,
      new: true,
      first_message_name: null,
      ...overrides,
    } as unknown as RedditItem["data"],
  };
}

/** Mock API serving fixed pages of inbox items. */
function makeApi(pages: RedditItem[][]): RedditApiClient {
  let call = 0;
  return {
    fetchInboxPage: async (_box: string, _pageSize: number, _after: string | null) => {
      const items = pages[call] ?? [];
      call++;
      return {
        items,
        after: call < pages.length ? `cursor${call}` : null,
      };
    },
  } as unknown as RedditApiClient;
}

describe("deriveInboxType", () => {
  const cases: Array<{
    name: string;
    kind: string;
    data: Record<string, unknown>;
    expected: string;
  }> = [
    { name: "t4 is message", kind: "t4", data: {}, expected: "message" },
    {
      name: "explicit comment_reply",
      kind: "t1",
      data: { type: "comment_reply" },
      expected: "comment_reply",
    },
    {
      name: "explicit post_reply",
      kind: "t1",
      data: { type: "post_reply" },
      expected: "post_reply",
    },
    {
      name: "username_mention maps to mention",
      kind: "t1",
      data: { type: "username_mention" },
      expected: "mention",
    },
    {
      name: "unknown type falls back to subject (mention)",
      kind: "t1",
      data: { type: "unknown", subject: "username mention" },
      expected: "mention",
    },
    {
      name: "unknown type falls back to subject (post reply)",
      kind: "t1",
      data: { type: "unknown", subject: "post reply" },
      expected: "post_reply",
    },
    {
      name: "unknown type defaults to comment_reply",
      kind: "t1",
      data: { type: "unknown", subject: "comment reply" },
      expected: "comment_reply",
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      // biome-ignore lint/suspicious/noExplicitAny: minimal fixture
      expect(deriveInboxType(c.kind, c.data as any)).toBe(c.expected);
    });
  }
});

describe("syncInbox", () => {
  let dbPath: string;
  let storage: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    storage = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("stores replies and messages, mirroring t1 items as context rows", async () => {
    const api = makeApi([[makeInboxReply("r1"), makeInboxMessage("m1")]]);

    const result = await syncInbox(storage, api);

    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.contextItemsStored).toBe(1);

    const items = storage.listInboxItems();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.type).sort()).toEqual(["comment_reply", "message"]);

    // t1 mirrored into posts with a synthesized permalink (query stripped)
    const contextRow = storage.getPost("r1");
    expect(contextRow?.content_origin).toBe("context");
    expect(contextRow?.permalink).toBe("/r/testsub/comments/post1/title/r1/");
    // t4 never touches posts
    expect(storage.getPost("m1")).toBeNull();
  });

  test("t1 without subreddit is stored in inbox but not mirrored", async () => {
    const api = makeApi([[makeInboxReply("r2", { subreddit: null })]]);

    const result = await syncInbox(storage, api);

    expect(result.inserted).toBe(1);
    expect(result.contextItemsStored).toBe(0);
    expect(storage.getPost("r2")).toBeNull();
    expect(storage.listInboxItems()).toHaveLength(1);
  });

  test("stops early when a page has nothing new or changed", async () => {
    const reply = makeInboxReply("r3");
    const api = makeApi([[reply], [reply], [reply]]);

    // First sync inserts
    await syncInbox(storage, api);

    // Second sync: same item, same is_new — first page yields 0 inserted /
    // 0 updated, so it must stop without following the cursor.
    const api2 = makeApi([[reply], [makeInboxReply("never-reached")]]);
    const result = await syncInbox(storage, api2);

    expect(result.stoppedEarly).toBe(true);
    expect(result.pages).toBe(1);
    expect(storage.countInboxItems()).toBe(1);
  });

  test("is_new flip counts as updated and does not stop paging", async () => {
    await syncInbox(storage, makeApi([[makeInboxReply("r4", { new: true })]]));

    const readNow = makeInboxReply("r4", { new: false });
    const fresh = makeInboxReply("r5");
    const result = await syncInbox(storage, makeApi([[readNow], [fresh]]));

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.pages).toBe(2);

    const items = storage.listInboxItems();
    expect(items.find((i) => i.id === "r4")?.is_new).toBe(0);
    expect(items.find((i) => i.id === "r5")?.is_new).toBe(1);
  });

  test("mirroring an existing saved row never touches origin or orphan fields", async () => {
    // The same comment already exists as a real saved row
    storage.upsertPosts(
      [
        {
          kind: "t1",
          data: {
            id: "r6",
            name: "t1_r6",
            author: "replier",
            subreddit: "testsub",
            permalink: "/r/testsub/comments/post1/title/r6/",
            created_utc: 1700000000,
            score: 3,
            body: "original body",
          },
        },
      ],
      "saved",
    );
    const before = storage.getPost("r6") as NonNullable<ReturnType<typeof storage.getPost>>;

    await syncInbox(storage, makeApi([[makeInboxReply("r6", { body: "edited body" })]]));

    const after = storage.getPost("r6") as NonNullable<ReturnType<typeof storage.getPost>>;
    expect(after.content_origin).toBe("saved");
    expect(after.is_on_reddit).toBe(before.is_on_reddit);
    expect(after.last_seen_at).toBe(before.last_seen_at);
    expect(after.body).toBe("edited body");
  });

  test("respects the limit across pages", async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => makeInboxReply(`a${i}`));
    const pageTwo = Array.from({ length: 100 }, (_, i) => makeInboxReply(`b${i}`));
    const api = makeApi([pageOne, pageTwo]);

    const result = await syncInbox(storage, api, { limit: 150 });

    // Second page is requested with pageSize 50; the mock returns 100 anyway,
    // but fetched crossing the limit ends the loop.
    expect(result.fetched).toBeGreaterThanOrEqual(150);
    expect(result.pages).toBe(2);
  });

  test("cancellation via signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await syncInbox(storage, makeApi([[makeInboxReply("r7")]]), {
      signal: controller.signal,
    });

    expect(result.wasCancelled).toBe(true);
    expect(result.fetched).toBe(0);
  });
});

describe("inbox adapter methods", () => {
  let dbPath: string;
  let storage: SqliteAdapter;

  beforeEach(() => {
    dbPath = makeTempDb();
    storage = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("list orders unread first, newest first; filters by type and unread", async () => {
    await syncInbox(
      storage,
      makeApi([
        [
          makeInboxReply("old-read", { new: false, created_utc: 1000 }),
          makeInboxReply("new-read", { new: false, created_utc: 3000 }),
          makeInboxReply("old-unread", { new: true, created_utc: 2000 }),
          makeInboxMessage("pm", { new: true, created_utc: 500 }),
        ],
      ]),
    );

    const all = storage.listInboxItems();
    expect(all.map((i) => i.id)).toEqual(["old-unread", "pm", "new-read", "old-read"]);

    const unread = storage.listInboxItems({ unreadOnly: true });
    expect(unread.map((i) => i.id)).toEqual(["old-unread", "pm"]);

    const messages = storage.listInboxItems({ type: "message" });
    expect(messages.map((i) => i.id)).toEqual(["pm"]);

    expect(storage.countInboxItems()).toBe(4);
    expect(storage.countInboxItems({ createdAfter: 1500 })).toBe(2);
    expect(storage.countUnreadInbox()).toBe(2);
  });

  test("update keeps fetched_at but bumps updated_at", async () => {
    await syncInbox(storage, makeApi([[makeInboxReply("r8", { new: true })]]));
    const first = storage.listInboxItems()[0];

    await new Promise((resolve) => setTimeout(resolve, 5));
    await syncInbox(storage, makeApi([[makeInboxReply("r8", { new: false })]]));
    const second = storage.listInboxItems()[0];

    expect(second.fetched_at).toBe(first.fetched_at);
    expect(second.updated_at).toBeGreaterThan(first.updated_at);
  });
});

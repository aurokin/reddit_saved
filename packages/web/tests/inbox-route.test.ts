import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAppContext, getAppContext } from "@/api/context";
import inboxRoute from "@/api/routes/inbox";
import type { InboxItemRow, InboxItemType, RedditItem } from "@reddit-saved/core";

function makeInboxRow(
  id: string,
  overrides: Partial<Pick<InboxItemRow, "type" | "is_new" | "created_utc">> = {},
): InboxItemRow {
  return {
    id,
    name: `t1_${id}`,
    kind: "t1",
    type: (overrides.type ?? "comment_reply") as InboxItemType,
    author: "replier",
    subject: "comment reply",
    body: "hello",
    dest: "me",
    subreddit: "test",
    context: null,
    link_title: "A post",
    parent_id: null,
    first_message_name: null,
    created_utc: overrides.created_utc ?? 1_700_000_000,
    is_new: overrides.is_new ?? 0,
    fetched_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    raw_json: "{}",
  };
}

function makeContextItem(id: string): RedditItem {
  return {
    kind: "t1",
    data: {
      id,
      name: `t1_${id}`,
      author: "replier",
      subreddit: "test",
      permalink: `/r/test/comments/parent/x/${id}/`,
      created_utc: 1_700_000_000,
      score: 1,
      body: "hello",
    },
  };
}

function get(path: string): Promise<Response> {
  return Promise.resolve(
    inboxRoute.fetch(new Request(`http://localhost${path}`, { method: "GET" })),
  );
}

describe("inbox route", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reddit-saved-web-inbox-"));
    process.env.REDDIT_SAVED_DB = join(tempDir, "test.db");
  });

  afterEach(() => {
    closeAppContext();
    process.env.REDDIT_SAVED_DB = undefined;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("lists items with total and unread count", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertInboxItems([
      makeInboxRow("r1", { is_new: 1 }),
      makeInboxRow("r2"),
      makeInboxRow("m1", { type: "message" }),
    ]);

    const res = await get("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; storedPostId: string | null }>;
      total: number;
      unreadCount: number;
    };
    expect(body.total).toBe(3);
    expect(body.unreadCount).toBe(1);
    expect(body.items).toHaveLength(3);
    // Unread first
    expect(body.items[0].id).toBe("r1");
  });

  test("enriches items with storedPostId when a context row exists", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertInboxItems([makeInboxRow("mirrored"), makeInboxRow("unmirrored")]);
    // Simulate the hybrid inbox sync mirroring one reply into posts.
    ctx.storage.upsertContextItems([makeContextItem("mirrored")]);

    const body = (await (await get("/")).json()) as {
      items: Array<{ id: string; storedPostId: string | null }>;
    };
    const mirrored = body.items.find((i) => i.id === "mirrored");
    const unmirrored = body.items.find((i) => i.id === "unmirrored");
    expect(mirrored?.storedPostId).toBe("mirrored");
    expect(unmirrored?.storedPostId).toBeNull();
  });

  test("filters by type and unread", async () => {
    const ctx = getAppContext();
    ctx.storage.upsertInboxItems([
      makeInboxRow("r1", { is_new: 1 }),
      makeInboxRow("m1", { type: "message" }),
    ]);

    const messages = (await (await get("/?type=message")).json()) as {
      items: Array<{ id: string }>;
      total: number;
    };
    expect(messages.total).toBe(1);
    expect(messages.items[0].id).toBe("m1");

    const unread = (await (await get("/?unread=true")).json()) as {
      items: Array<{ id: string }>;
      total: number;
    };
    expect(unread.total).toBe(1);
    expect(unread.items[0].id).toBe("r1");
  });

  test("rejects unknown types and malformed pagination", async () => {
    const typeRes = await get("/?type=bogus");
    expect(typeRes.status).toBe(400);
    expect(await typeRes.text()).toContain("type");

    const limitRes = await get("/?limit=abc");
    expect(limitRes.status).toBe(400);
    expect(await limitRes.text()).toContain("limit");
  });
});

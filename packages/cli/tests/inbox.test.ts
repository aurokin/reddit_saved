import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { type InboxItemRow, SqliteAdapter } from "@reddit-cached/core";
import { inboxCmd } from "../src/commands/inbox";
import { setOutputMode } from "../src/output";
import { captureConsole, makeTempDb } from "./helpers";

function makeRow(id: string, overrides: Partial<InboxItemRow> = {}): InboxItemRow {
  return {
    id,
    name: `t1_${id}`,
    kind: "t1",
    type: "comment_reply",
    author: "replier",
    subject: "comment reply",
    body: `body ${id}`,
    dest: "me",
    subreddit: "testsub",
    context: `/r/testsub/comments/p/t/${id}/?context=3`,
    link_title: "My post",
    parent_id: "t1_mine",
    first_message_name: null,
    created_utc: 1700000000,
    is_new: 1,
    fetched_at: 1700000000000,
    updated_at: 1700000000000,
    raw_json: "{}",
    ...overrides,
  };
}

describe("inbox command", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTempDb();
    setOutputMode(false, false, true);
    const storage = new SqliteAdapter(dbPath);
    storage.upsertInboxItems([
      makeRow("r1", { is_new: 1 }),
      makeRow("r2", { is_new: 0, created_utc: 1700000100 }),
      makeRow("m1", {
        name: "t4_m1",
        kind: "t4",
        type: "message",
        subject: "hello",
        subreddit: null,
      }),
    ]);
    storage.close();
  });

  afterEach(() => {
    rmSync(dirname(dbPath), { recursive: true, force: true });
  });

  test("emits items with totals as JSON, unread first", async () => {
    const capture = captureConsole();
    try {
      await inboxCmd({ db: dbPath }, []);
      const output = JSON.parse(capture.logs.join("\n"));
      expect(output.total).toBe(3);
      expect(output.unreadCount).toBe(2);
      expect(output.items).toHaveLength(3);
      expect(output.items[output.items.length - 1].id).toBe("r2");
    } finally {
      capture.restore();
    }
  });

  test("filters by type and unread", async () => {
    const capture = captureConsole();
    try {
      await inboxCmd({ db: dbPath, type: "message", unread: true }, []);
      const output = JSON.parse(capture.logs.join("\n"));
      expect(output.items).toHaveLength(1);
      expect(output.items[0].type).toBe("message");
      expect(output.total).toBe(1);
    } finally {
      capture.restore();
    }
  });

  test("rejects an invalid type", async () => {
    await expect(inboxCmd({ db: dbPath, type: "bogus" }, [])).rejects.toThrow(/Invalid --type/);
  });
});

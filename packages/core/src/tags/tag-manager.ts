import type { Database } from "bun:sqlite";
import type { Tag, TagWithCount, PostRow } from "../types";

/**
 * CRUD for tags and post-tag associations.
 * Takes the raw Database handle (not StorageAdapter) since it owns all tag writes.
 * StorageAdapter reads tag tables for filtered queries (search/list with --tag).
 */
export class TagManager {
  constructor(private db: Database) {}

  createTag(name: string, color?: string): Tag {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error("Tag name cannot be empty");
    if (trimmed.length > 100) throw new Error("Tag name cannot exceed 100 characters");
    const now = Date.now();
    try {
      return this.db
        .query("INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?) RETURNING *")
        .get(trimmed, color ?? null, now) as Tag;
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new Error(`Tag "${trimmed}" already exists`);
      }
      throw err;
    }
  }

  renameTag(oldName: string, newName: string): void {
    const trimmedOld = oldName.trim();
    const trimmedNew = newName.trim();
    if (trimmedNew.length === 0) throw new Error("Tag name cannot be empty");
    if (trimmedNew.length > 100) throw new Error("Tag name cannot exceed 100 characters");
    try {
      const result = this.db.run("UPDATE tags SET name = ? WHERE name = ?", [trimmedNew, trimmedOld]);
      if (result.changes === 0) {
        throw new Error(`Tag "${trimmedOld}" not found`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
        throw new Error(`Tag "${trimmedNew}" already exists`);
      }
      throw err;
    }
  }

  deleteTag(name: string): void {
    const trimmed = name.trim();
    const result = this.db.run("DELETE FROM tags WHERE name = ?", [trimmed]);
    if (result.changes === 0) {
      throw new Error(`Tag "${trimmed}" not found`);
    }
    // post_tags rows are cleaned up by ON DELETE CASCADE
  }

  addTagToPost(tagName: string, postId: string): void {
    const trimmed = tagName.trim();
    this.db.transaction(() => {
      const tag = this.db.query("SELECT id FROM tags WHERE name = ?").get(trimmed) as { id: number } | null;
      if (!tag) throw new Error(`Tag "${trimmed}" not found`);

      const item = this.db.query("SELECT id FROM posts WHERE id = ?").get(postId) as { id: string } | null;
      if (!item) throw new Error(`Item "${postId}" not found`);

      // INSERT OR IGNORE — no-op if already tagged
      this.db.run("INSERT OR IGNORE INTO post_tags (post_id, tag_id, created_at) VALUES (?, ?, ?)", [
        postId,
        tag.id,
        Date.now(),
      ]);
    })();
  }

  removeTagFromPost(tagName: string, postId: string): void {
    const trimmed = tagName.trim();
    this.db.transaction(() => {
      const tag = this.db.query("SELECT id FROM tags WHERE name = ?").get(trimmed) as { id: number } | null;
      if (!tag) throw new Error(`Tag "${trimmed}" not found`);

      const result = this.db.run("DELETE FROM post_tags WHERE post_id = ? AND tag_id = ?", [postId, tag.id]);
      if (result.changes === 0) {
        throw new Error(`Item "${postId}" does not have tag "${trimmed}"`);
      }
    })();
  }

  getTagsForPost(postId: string): Tag[] {
    return this.db
      .query(
        `SELECT t.* FROM tags t
         JOIN post_tags pt ON pt.tag_id = t.id
         WHERE pt.post_id = ?
         ORDER BY t.name`,
      )
      .all(postId) as Tag[];
  }

  /** Get active (non-orphaned) posts with the given tag.
   * For orphaned tagged posts, use SqliteAdapter.listPosts({ tag, orphaned: true }). */
  getPostsByTag(tagName: string, limit = 1000): PostRow[] {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) throw new Error("limit must be a positive integer (max 10000)");
    const trimmed = tagName.trim();
    return this.db
      .query(
        `SELECT p.*, GROUP_CONCAT(t.name, '||') AS tags
         FROM posts p
         LEFT JOIN post_tags pt ON pt.post_id = p.id
         LEFT JOIN tags t ON t.id = pt.tag_id
         WHERE p.is_on_reddit = 1
           AND EXISTS (
             SELECT 1 FROM post_tags pt2
             JOIN tags t2 ON t2.id = pt2.tag_id
             WHERE pt2.post_id = p.id AND t2.name = ?
           )
         GROUP BY p.id
         ORDER BY p.created_utc DESC
         LIMIT ?`,
      )
      .all(trimmed, limit) as PostRow[];
  }

  listTags(): TagWithCount[] {
    return this.db
      .query(
        `SELECT t.*, COUNT(p.id) AS count
         FROM tags t
         LEFT JOIN post_tags pt ON pt.tag_id = t.id
         LEFT JOIN posts p ON p.id = pt.post_id AND p.is_on_reddit = 1
         GROUP BY t.id
         ORDER BY t.name`,
      )
      .all() as TagWithCount[];
  }
}

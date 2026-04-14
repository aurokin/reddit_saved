import { flagStr } from "../args";
import { createContext } from "../context";
import { isHumanMode, printError, printInfo, printJson, printTable, printWarning } from "../output";

// ============================================================================
// tag list
// ============================================================================

export async function tagList(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const tags = ctx.tags.listTags();

    if (isHumanMode()) {
      if (tags.length === 0) {
        console.log("No tags. Create one with: reddit-saved tag create <name>");
        return;
      }
      printTable(
        tags.map((t) => ({ name: t.name, color: t.color ?? "", count: t.count })),
        [
          { key: "name", header: "Name", width: 25 },
          { key: "color", header: "Color", width: 10 },
          { key: "count", header: "Posts", width: 6, align: "right" },
        ],
      );
    } else {
      printJson(tags);
    }
  } finally {
    ctx.close();
  }
}

// ============================================================================
// tag create
// ============================================================================

export async function tagCreate(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const name = positionals[0];
  if (!name) {
    printError("Tag name required. Usage: reddit-saved tag create <name> [--color #hex]");
    process.exit(1);
  }

  const color = flagStr(flags, "color");
  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const tag = ctx.tags.createTag(name, color);

    if (isHumanMode()) {
      printInfo(`Created tag "${tag.name}"${tag.color ? ` (${tag.color})` : ""}`);
    } else {
      printJson(tag);
    }
  } finally {
    ctx.close();
  }
}

// ============================================================================
// tag rename
// ============================================================================

export async function tagRename(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const oldName = positionals[0];
  const newName = positionals[1];
  if (!oldName || !newName) {
    printError("Usage: reddit-saved tag rename <old-name> <new-name>");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    ctx.tags.renameTag(oldName, newName);

    if (isHumanMode()) {
      printInfo(`Renamed tag "${oldName}" to "${newName}"`);
    } else {
      printJson({ renamed: true, from: oldName, to: newName });
    }
  } finally {
    ctx.close();
  }
}

// ============================================================================
// tag delete
// ============================================================================

export async function tagDelete(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const name = positionals[0];
  if (!name) {
    printError("Usage: reddit-saved tag delete <name>");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    ctx.tags.deleteTag(name);

    if (isHumanMode()) {
      printInfo(`Deleted tag "${name}"`);
    } else {
      printJson({ deleted: true, name });
    }
  } finally {
    ctx.close();
  }
}

// ============================================================================
// tag add
// ============================================================================

export async function tagAdd(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const tagName = positionals[0];
  if (!tagName) {
    printError("Usage: reddit-saved tag add <tag-name> --to <post-id> [post-id...]");
    process.exit(1);
  }

  const toFlag = flags.to;
  const toIds =
    typeof toFlag === "string"
      ? toFlag
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const postIds = [...toIds, ...positionals.slice(1)];

  if (postIds.length === 0) {
    printError("Specify post IDs with --to. Usage: reddit-saved tag add <tag> --to <id> [id...]");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const errors: Array<{ postId: string; error: string }> = [];
    for (const postId of postIds) {
      try {
        ctx.tags.addTagToPost(tagName, postId);
      } catch (err) {
        errors.push({ postId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const succeeded = postIds.length - errors.length;

    for (const e of errors) {
      printWarning(`Failed to tag "${e.postId}": ${e.error}`);
    }

    if (isHumanMode()) {
      printInfo(`Tagged ${succeeded} of ${postIds.length} post(s) with "${tagName}"`);
    } else {
      printJson({ tagged: true, tag: tagName, succeeded, failed: errors.length, postIds });
    }
  } finally {
    ctx.close();
  }
}

// ============================================================================
// tag remove
// ============================================================================

export async function tagRemove(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const tagName = positionals[0];
  if (!tagName) {
    printError("Usage: reddit-saved tag remove <tag-name> --from <post-id> [post-id...]");
    process.exit(1);
  }

  const fromFlag = flags.from;
  const fromIds =
    typeof fromFlag === "string"
      ? fromFlag
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const postIds = [...fromIds, ...positionals.slice(1)];

  if (postIds.length === 0) {
    printError(
      "Specify post IDs with --from. Usage: reddit-saved tag remove <tag> --from <id> [id...]",
    );
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const errors: Array<{ postId: string; error: string }> = [];
    for (const postId of postIds) {
      try {
        ctx.tags.removeTagFromPost(tagName, postId);
      } catch (err) {
        errors.push({ postId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const succeeded = postIds.length - errors.length;

    for (const e of errors) {
      printWarning(`Failed to untag "${e.postId}": ${e.error}`);
    }

    if (isHumanMode()) {
      printInfo(`Removed "${tagName}" from ${succeeded} of ${postIds.length} post(s)`);
    } else {
      printJson({ removed: true, tag: tagName, succeeded, failed: errors.length, postIds });
    }
  } finally {
    ctx.close();
  }
}

// ============================================================================
// tag show
// ============================================================================

export async function tagShow(
  flags: Record<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const postId = positionals[0];
  if (!postId) {
    printError("Usage: reddit-saved tag show <post-id>");
    process.exit(1);
  }

  const ctx = await createContext({ dbPath: flagStr(flags, "db") });

  try {
    const tags = ctx.tags.getTagsForPost(postId);

    if (isHumanMode()) {
      if (tags.length === 0) {
        console.log(`No tags on post ${postId}`);
      } else {
        console.log(`Tags for ${postId}: ${tags.map((t) => t.name).join(", ")}`);
      }
    } else {
      printJson(tags);
    }
  } finally {
    ctx.close();
  }
}

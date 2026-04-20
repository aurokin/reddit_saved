import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  useCreateTag,
  useDeleteTag,
  useRenameTag,
  useTags,
} from "@/hooks/queries";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function TagManager() {
  const { data } = useTags();
  const createTag = useCreateTag();
  const renameTag = useRenameTag();
  const deleteTag = useDeleteTag();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const tags = data?.items ?? [];

  const submitCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const name = newName.trim();
    if (!name) return;
    try {
      await createTag.mutateAsync({ name, color: newColor });
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tag");
    }
  };

  return (
    <section className="flex flex-col gap-4" data-testid="tag-manager">
      <form onSubmit={submitCreate} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs">
          Name
          <Input
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            placeholder="new-tag"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Color
          <Input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.currentTarget.value)}
            className="h-9 w-16 p-1"
          />
        </label>
        <Button type="submit" disabled={createTag.isPending}>
          {createTag.isPending ? "Creating..." : "Create tag"}
        </Button>
      </form>
      {error ? (
        <p className="text-xs text-[var(--color-destructive)]" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {tags.length === 0 ? (
          <li className="text-sm text-[var(--color-muted-foreground)]">No tags yet.</li>
        ) : null}
        {tags.map((tag) => (
          <li
            key={tag.id}
            className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] p-2"
          >
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                style={tag.color ? { backgroundColor: tag.color, color: "white" } : undefined}
              >
                #{tag.name}
              </Badge>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {tag.count} {tag.count === 1 ? "post" : "posts"}
              </span>
            </div>
            {renaming === tag.name ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await renameTag.mutateAsync({ oldName: tag.name, newName: renameTo });
                    setRenaming(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Rename failed");
                  }
                }}
                className="flex gap-2"
              >
                <Input
                  autoFocus
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.currentTarget.value)}
                />
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRenaming(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setRenameTo(tag.name);
                    setRenaming(tag.name);
                  }}
                  aria-label={`Rename ${tag.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteTag.mutate(tag.name)}
                  aria-label={`Delete ${tag.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

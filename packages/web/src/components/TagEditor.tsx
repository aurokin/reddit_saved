import { Plus, X } from "lucide-react";
import { useState } from "react";
import {
  useAddPostTag,
  useCreateTag,
  useRemovePostTag,
  useTags,
} from "@/hooks/queries";
import { parseTags } from "@/lib/utils";
import type { PostRow } from "@/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function TagEditor({ post }: { post: PostRow }) {
  const current = parseTags(post.tags);
  const { data: available } = useTags();
  const addTag = useAddPostTag(post.id);
  const removeTag = useRemovePostTag(post.id);
  const createTag = useCreateTag();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidates = (available?.items ?? [])
    .map((t) => t.name)
    .filter((name) => !current.includes(name));

  const submit = async (): Promise<void> => {
    const name = input.trim();
    if (!name) return;
    setError(null);
    try {
      if (!available?.items.some((t) => t.name === name)) {
        await createTag.mutateAsync({ name });
      }
      await addTag.mutateAsync(name);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tag");
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="tag-editor">
      <div className="flex flex-wrap gap-1">
        {current.length === 0 ? (
          <span className="text-xs text-[var(--color-muted-foreground)]">No tags yet</span>
        ) : (
          current.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              #{tag}
              <button
                type="button"
                onClick={() => removeTag.mutate(tag)}
                aria-label={`Remove tag ${tag}`}
                className="rounded-full hover:bg-[var(--color-accent)]"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          list="tag-editor-options"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder="Add a tag..."
          data-testid="tag-editor-input"
        />
        <datalist id="tag-editor-options">
          {candidates.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <Button type="submit" size="sm" variant="secondary" data-testid="tag-editor-submit">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </form>
      {error ? (
        <p className="text-xs text-[var(--color-destructive)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

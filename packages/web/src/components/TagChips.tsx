import { Link } from "@tanstack/react-router";
import { Badge } from "./ui/badge";

export function TagChips({
  tags,
  linkable = true,
}: {
  tags: string[];
  linkable?: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) =>
        linkable ? (
          <Link
            key={tag}
            to="/browse"
            search={{ tag }}
            className="no-underline"
          >
            <Badge variant="secondary" className="cursor-pointer hover:bg-[var(--color-accent)]">
              #{tag}
            </Badge>
          </Link>
        ) : (
          <Badge key={tag} variant="secondary">
            #{tag}
          </Badge>
        ),
      )}
    </div>
  );
}

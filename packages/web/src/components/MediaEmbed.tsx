import { ExternalLink, ImageOff, Play } from "lucide-react";
import { useState } from "react";
import type { PostRow } from "@/types";
import { Badge } from "./ui/badge";

/** Try to extract media info from raw_json without exposing it to parents. */
function parseMediaFromRaw(raw: string):
  | { kind: "gallery"; urls: string[] }
  | { kind: "video"; poster: string | null }
  | null {
  try {
    const data = JSON.parse(raw) as {
      data: {
        is_gallery?: boolean;
        gallery_data?: { items: Array<{ media_id: string }> };
        media_metadata?: Record<string, { s?: { u?: string } }>;
        is_video?: boolean;
        thumbnail?: string;
      };
    };
    const d = data.data;
    if (d.is_gallery && d.gallery_data && d.media_metadata) {
      const urls: string[] = [];
      for (const item of d.gallery_data.items) {
        const meta = d.media_metadata[item.media_id];
        const u = meta?.s?.u;
        if (u) urls.push(u.replace(/&amp;/g, "&"));
      }
      if (urls.length > 0) return { kind: "gallery", urls };
    }
    if (d.is_video) {
      return { kind: "video", poster: d.thumbnail ?? null };
    }
  } catch {
    /* malformed raw — fall through */
  }
  return null;
}

export function MediaEmbed({ post }: { post: PostRow }) {
  const [imgError, setImgError] = useState(false);
  const media = parseMediaFromRaw(post.raw_json);

  if (media?.kind === "gallery") {
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {media.urls.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={`Gallery ${i + 1}`}
            className="aspect-square rounded-md object-cover"
            loading="lazy"
          />
        ))}
      </div>
    );
  }

  if (media?.kind === "video") {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
        {media.poster ? (
          <img
            src={media.poster}
            alt="Video poster"
            className="h-full w-full object-cover opacity-70"
          />
        ) : null}
        <a
          href={`https://reddit.com${post.permalink}`}
          target="_blank"
          rel="noreferrer noopener"
          className="absolute inset-0 flex items-center justify-center text-white"
        >
          <Play className="h-16 w-16 opacity-90" />
          <span className="sr-only">Open video on Reddit</span>
        </a>
      </div>
    );
  }

  const preview = post.preview_url && !imgError ? post.preview_url : null;
  const isImagePost = post.post_hint === "image" || post.domain === "i.redd.it";

  if (preview && isImagePost) {
    return (
      <img
        src={preview}
        alt={post.title ?? "Post image"}
        onError={() => setImgError(true)}
        className="max-h-[600px] w-full rounded-md object-contain"
        loading="lazy"
      />
    );
  }

  if (post.url && !post.is_self) {
    return (
      <a
        href={post.url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm transition-colors hover:bg-[var(--color-accent)]"
      >
        <div className="flex flex-col gap-1 truncate">
          <span className="text-xs text-[var(--color-muted-foreground)]">External link</span>
          <span className="truncate font-mono text-xs">{post.url}</span>
        </div>
        <div className="flex items-center gap-2">
          {post.domain ? <Badge variant="outline">{post.domain}</Badge> : null}
          <ExternalLink className="h-4 w-4 shrink-0" />
        </div>
      </a>
    );
  }

  if (imgError && isImagePost) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)]">
        <ImageOff className="h-5 w-5" />
        <span>Image unavailable</span>
      </div>
    );
  }

  return null;
}

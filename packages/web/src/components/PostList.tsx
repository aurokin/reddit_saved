import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { PostCard } from "./PostCard";
import type { PostRow, SearchResult } from "@/types";

export function PostList({
  items,
  snippetBy,
}: {
  items: Array<PostRow | SearchResult>;
  snippetBy?: (item: PostRow | SearchResult) => string | undefined;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180,
    overscan: 6,
  });

  if (items.length === 0) return null;

  return (
    <div
      ref={parentRef}
      className="relative max-h-[calc(100vh-12rem)] w-full overflow-auto pr-1"
      data-testid="post-list"
    >
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((v) => {
          const item = items[v.index];
          if (!item) return null;
          return (
            <div
              key={item.id}
              data-index={v.index}
              ref={rowVirtualizer.measureElement}
              className="absolute left-0 right-0 pb-3"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              <PostCard post={item} snippet={snippetBy?.(item)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

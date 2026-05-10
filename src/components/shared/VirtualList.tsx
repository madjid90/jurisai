import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type VirtualListProps<T> = {
  items: T[];
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string | number;
  /** Element scrolling – if omitted, the list owns its scroll container. */
  className?: string;
  /** Pixel gap injected between rows (added to estimateSize). */
  gap?: number;
  /** Max-height when the list owns scroll. */
  maxHeight?: number | string;
  /** Triggered when scrolling near bottom. */
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  /** When true, virtualization is bypassed (small list). */
  disabled?: boolean;
  /** Fallback rendered when items is empty. */
  emptyState?: ReactNode;
  overscan?: number;
};

/**
 * Virtualized vertical list with optional infinite-scroll trigger.
 * Uses @tanstack/react-virtual. For lists < 30 items, virtualization is bypassed.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  renderItem,
  getKey,
  className,
  gap = 8,
  maxHeight = "100%",
  onLoadMore,
  hasMore,
  loadingMore,
  disabled,
  emptyState,
  overscan = 6,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const rowSize = estimateSize + gap;
  const shouldVirtualize = !disabled && items.length > 30;

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowSize,
    overscan,
    enabled: shouldVirtualize,
  });

  // Trigger loadMore when sentinel approaches viewport (works for both modes).
  const sentinelCb = (node: HTMLDivElement | null) => {
    sentinelRef.current = node;
    if (!node || !onLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loadingMore) onLoadMore();
      },
      { rootMargin: "400px 0px" },
    );
    obs.observe(node);
    // Cleanup attached via ref callback — observer disconnects when node detaches.
    return () => obs.disconnect();
  };

  if (items.length === 0 && emptyState) return <>{emptyState}</>;

  if (!shouldVirtualize) {
    return (
      <div className={cn("flex flex-col", className)} style={{ gap }}>
        {items.map((it, i) => (
          <div key={getKey(it, i)}>{renderItem(it, i)}</div>
        ))}
        {onLoadMore && hasMore && (
          <div ref={sentinelCb} className="flex h-10 items-center justify-center">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn("overflow-auto", className)}
      style={{ maxHeight, contain: "strict" }}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const item = items[vi.index];
          return (
            <div
              key={getKey(item, vi.index)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
                paddingBottom: gap,
              }}
            >
              {renderItem(item, vi.index)}
            </div>
          );
        })}
      </div>
      {onLoadMore && hasMore && (
        <div ref={sentinelCb} className="flex h-12 items-center justify-center">
          {loadingMore && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}
    </div>
  );
}

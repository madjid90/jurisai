import { useCallback, useEffect, useRef, useState } from "react";

export type InfiniteListState<T> = {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: Error | null;
  total: number | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  sentinelRef: (node: HTMLElement | null) => void;
};

export type InfiniteFetcher<T> = (params: {
  limit: number;
  offset: number;
}) => Promise<{ items: T[]; hasMore: boolean; total?: number }>;

/**
 * Generic infinite-scroll hook.
 * - Loads first page on mount (and whenever `deps` change → resets).
 * - Exposes a sentinel ref-callback to wire to an IntersectionObserver target
 *   so the next page loads automatically when it scrolls into view.
 */
export function useInfiniteList<T>(
  fetcher: InfiniteFetcher<T>,
  options: { pageSize?: number; deps?: ReadonlyArray<unknown>; enabled?: boolean } = {},
): InfiniteListState<T> {
  const { pageSize = 30, deps = [], enabled = true } = options;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const reqIdRef = useRef(0);
  const offsetRef = useRef(0);
  const inFlightRef = useRef(false);

  const fetchPage = useCallback(
    async (offset: number, reset: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const myReq = ++reqIdRef.current;
      try {
        if (reset) setLoading(true);
        else setLoadingMore(true);
        const res = await fetcherRef.current({ limit: pageSize, offset });
        if (myReq !== reqIdRef.current) return; // stale
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setHasMore(res.hasMore);
        if (typeof res.total === "number") setTotal(res.total);
        offsetRef.current = offset + res.items.length;
        setError(null);
      } catch (err) {
        if (myReq !== reqIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setHasMore(false);
      } finally {
        if (myReq === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
        inFlightRef.current = false;
      }
    },
    [pageSize],
  );

  const reload = useCallback(async () => {
    offsetRef.current = 0;
    await fetchPage(0, true);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    await fetchPage(offsetRef.current, false);
  }, [fetchPage, hasMore, loadingMore, loading]);

  // Initial / dep-driven load
  useEffect(() => {
    if (!enabled) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  // Sentinel observer
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) void loadMore();
        },
        { rootMargin: "400px 0px" },
      );
      observerRef.current.observe(node);
    },
    [loadMore],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { items, loading, loadingMore, hasMore, error, total, reload, loadMore, sentinelRef };
}

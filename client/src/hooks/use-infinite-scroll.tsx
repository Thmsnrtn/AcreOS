import React from "react";
import { useInfiniteQuery, UseInfiniteQueryOptions } from "@tanstack/react-query";
import { useEffect, useRef, useCallback } from "react";
import { STALE_TIMES } from "@/lib/queryClient";

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

interface UseInfiniteScrollOptions<T> {
  queryKey: string[];
  limit?: number;
  enabled?: boolean;
  staleTime?: number;
}

export function useInfiniteScroll<T>({
  queryKey,
  limit = 25,
  enabled = true,
  staleTime = STALE_TIMES.medium,
}: UseInfiniteScrollOptions<T>) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery<PaginatedResponse<T>>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      const url = new URL(queryKey[0], window.location.origin);
      url.searchParams.set("limit", String(limit));
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime,
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    },
    [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]
  );

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    observerRef.current = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: "100px",
      threshold: 0,
    });

    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver]);

  const allData = query.data?.pages.flatMap((page) => page.data) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return {
    data: allData,
    total,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    loadMoreRef,
    error: query.error,
    refetch: query.refetch,
  };
}

export function InfiniteScrollTrigger({
  loadMoreRef,
  isFetching,
  hasMore,
}: {
  loadMoreRef: React.RefObject<HTMLDivElement>;
  isFetching: boolean;
  hasMore: boolean;
}) {
  if (!hasMore) return null;
  
  return (
    <div
      ref={loadMoreRef}
      className="flex items-center justify-center py-4"
      data-testid="infinite-scroll-trigger"
    >
      {isFetching && (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="loading-more">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">Loading more...</span>
        </div>
      )}
    </div>
  );
}

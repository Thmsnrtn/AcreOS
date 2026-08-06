import React from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { api, buildUrl, type InsertLead } from "@shared/routes";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";

// Page size used when walking /api/leads/paginated to build the legacy
// flat-list cache. Larger pages = fewer round-trips but bigger per-fetch
// payload. 250 is the sweet spot for typical land-investor org sizes
// (1k–10k leads → 4–40 round-trips) while staying well under the server
// pageSize.max(100) for the alternative /api/leads endpoint.
const LEGACY_PAGE_SIZE = 250;
// Hard ceiling on auto-pagination. Beyond this the legacy hook stops and
// the caller should reach for useLeadsPaginated() or the cursor hook
// directly. Sized to cover well past 99% of land-investor orgs while
// keeping the worst-case cache bounded.
const LEGACY_MAX_PAGES = 40; // 40 * 250 = 10,000 leads

export interface PaginatedLeadsResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Fetch leads with server-side pagination.
 * Returns { data, total, page, pageSize, totalPages }.
 */
export function useLeadsPaginated(params: { page: number; pageSize: number; sortBy?: string; sortOrder?: string; stage?: string; assignedTo?: string; q?: string }) {
  const queryParams = new URLSearchParams();
  queryParams.set("page", String(params.page));
  queryParams.set("pageSize", String(params.pageSize));
  if (params.sortBy) queryParams.set("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);
  if (params.stage) queryParams.set("stage", params.stage);
  if (params.assignedTo) queryParams.set("assignedTo", params.assignedTo);
  if (params.q && params.q.trim()) queryParams.set("q", params.q.trim());
  const url = `${api.leads.list.path}?${queryParams.toString()}`;

  return useQuery<PaginatedLeadsResponse>({
    queryKey: [api.leads.list.path, "paginated", params.page, params.pageSize, params.sortBy, params.sortOrder, params.stage, params.assignedTo, params.q],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
    placeholderData: keepPreviousData,
  });
}

/**
 * Legacy hook: returns the flat leads array for backward compatibility.
 *
 * The previous implementation hard-capped this at `?page=1&pageSize=100`,
 * which meant any org with >100 leads silently truncated the list. Every
 * consumer felt it: MobileLeadList's "Hot" filter ran over only the first
 * 100 (so on a 1,000-lead org, ~95% of hot leads disappeared), the
 * command-palette search missed any name on page 2+, the dashboard
 * "active leads" KPI under-counted, and today.tsx's decision-queue
 * derivation walked an arbitrary slice.
 *
 * Replacement: a useInfiniteQuery that walks /api/leads/paginated via
 * cursor pages, then flattens to the array shape every caller already
 * expects via `data`. The walk is auto-driven (fetchNextPage chained as
 * long as hasMore && page count < LEGACY_MAX_PAGES) so consumers don't
 * have to know about pagination — they just see the full list. For very
 * large orgs (>10k leads) the cap kicks in and consumers should migrate
 * to useLeadsPaginated() / useInfiniteScroll(), but the silent
 * single-page truncation is gone.
 */
export function useLeads() {
  const PAGINATED_URL = "/api/leads/paginated";

  // Distinct cache key so the new useInfiniteQuery shape ({pages, pageParams})
  // doesn't fight every other consumer that stores Lead[] under the bare
  // ["/api/leads"] key (decision-queue, pipeline, inbox, ops-dashboard,
  // the command palette — all have their own normalize-to-array queryFns
  // that would crash on the infinite-query envelope). Existing
  // `invalidateQueries({queryKey: ["/api/leads"]})` calls still match
  // this key by react-query's default prefix semantics.
  const query = useInfiniteQuery({
    queryKey: [api.leads.list.path, "infinite-flat"],
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as string | undefined;
      const url = new URL(PAGINATED_URL, window.location.origin);
      url.searchParams.set("limit", String(LEGACY_PAGE_SIZE));
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json() as Promise<{
        data: any[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
      }>;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage, allPages) => {
      // Stop at the hard ceiling — beyond LEGACY_MAX_PAGES the consumer
      // should be using the explicitly-paginated hook.
      if (allPages.length >= LEGACY_MAX_PAGES) return undefined;
      return lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined;
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
    // The shared queryKey "/api/leads" is read by other call sites
    // (command-palette, UniversalTabs) whose own queryFns store different
    // shapes (sometimes a bare array, sometimes a paginated object). We
    // normalize to ALWAYS surface a flat array via `data`, defending
    // against both the new paginated shape and any legacy fallback.
    select: (raw: unknown): any[] => {
      if (Array.isArray(raw)) return raw;
      const asPaginated = raw as { pages?: unknown[] } | undefined;
      if (Array.isArray(asPaginated?.pages)) {
        const out: any[] = [];
        for (const page of asPaginated!.pages!) {
          const pageData = (page as { data?: unknown }).data;
          if (Array.isArray(pageData)) out.push(...pageData);
        }
        return out;
      }
      // Defensive — any stray-shape cache (older command-palette write,
      // bare `{ data: [...] }` from somewhere) still flattens to an array.
      const data = (raw as { data?: unknown })?.data;
      return Array.isArray(data) ? data : [];
    },
  });

  // Walk the rest of the pages automatically so consumers see the full
  // list without driving an IntersectionObserver themselves. This is the
  // "legacy" hook's whole contract — flat array of leads in `data`.
  //
  // The `select` above reshapes `query.data` to an array, so we count
  // pages via the (flattened) length / page size approximation. The
  // hasNextPage flag from react-query carries the real authority for
  // whether another page is reachable; the count is only the LEGACY cap.
  const flatLength = Array.isArray(query.data) ? query.data.length : 0;
  React.useEffect(() => {
    if (
      query.hasNextPage &&
      !query.isFetchingNextPage &&
      !query.isFetching &&
      flatLength < LEGACY_PAGE_SIZE * LEGACY_MAX_PAGES
    ) {
      void query.fetchNextPage();
    }
    // We deliberately depend on the booleans + flat length rather than
    // `query` itself so the effect re-fires after each page lands.
  }, [
    query.hasNextPage,
    query.isFetchingNextPage,
    query.isFetching,
    flatLength,
    query.fetchNextPage,
  ]);

  return query;
}

export function useLead(id: number) {
  return useQuery({
    queryKey: [api.leads.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.leads.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch lead");
      return api.leads.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Omit<InsertLead, 'organizationId'>) => {
      const res = await fetch(api.leads.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.leads.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error(`${res.status}: Failed to create lead`);
      }
      return api.leads.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      // F-D20: invalidate AND force refetch — the paginated list uses
      // keepPreviousData, so a passive invalidation leaves the user staring
      // at the old list (without their new lead) until the user navigates.
      // refetchType: "active" forces an immediate refetch on any mounted
      // query matching the prefix.
      queryClient.invalidateQueries({
        queryKey: [api.leads.list.path],
        refetchType: "active",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist-status"] });
      // Audit F-11-1 (completeness pass): the Today door reads /api/today and
      // surfaces an unscored-lead nudge — a freshly created lead is exactly
      // that, so the create path must invalidate it too (delete already did).
      queryClient.invalidateQueries({ queryKey: ["/api/today"] });
      toast({
        title: "Success",
        description: "Lead created successfully.",
      });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateLead() {
  // Optimistic update: instantly reflect the new lead state (e.g. "contacted",
  // status change, score) across every cached leads query. Snapshot the
  // previous cache and roll it back on error. Backed by the
  // useOptimisticUpdate factory (client/src/lib/optimistic-mutation.ts).
  return useOptimisticUpdate<{ id: number } & Partial<InsertLead>>({
    mutationFn: async ({ id, ...updates }) => {
      const url = buildUrl(api.leads.update.path, { id });
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: Failed to update lead`);
      return api.leads.update.responses[200].parse(await res.json());
    },
    listKeys: [[api.leads.list.path]],
    // Audit F-11-1 (completeness pass): a status/score change moves the lead
    // in the Today door's priority feed — invalidate /api/today too.
    extraInvalidateKeys: [["/api/today"]],
    detailKey: ({ id }) => [api.leads.get.path, id],
    getId: ({ id }) => id,
    successToast: { title: "Success", description: "Lead updated successfully." },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/leads/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: Failed to delete lead`);
      return id;
    },
    onSuccess: (_data, id) => {
      // Invalidate every consumer that displays lead counts or lists. The
      // /leads list refreshing alone isn't enough — /today's overdue tile,
      // /today's decision queue, the leads-aging chart, and the dashboard
      // KPI strip all derive from separate queries. Without these the
      // founder sees the deleted lead persist in the dashboard count
      // (caught 2026-05-12: "I deleted 17 sample leads, they never
      // disappeared from the dashboard").
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
      // Audit F-11-1: the Today door reads /api/today (not today-priorities);
      // without this the primary customer door goes stale after a mutation.
      queryClient.invalidateQueries({ queryKey: ["/api/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/aging"] });
      queryClient.removeQueries({ queryKey: [api.leads.get.path, id] });
      toast({
        title: "Lead deleted",
        description: "Lead moved to trash.",
        action: React.createElement("button", {
          className: "shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted",
          onClick: async () => {
            try {
              await fetch(`/api/leads/${id}/restore`, { method: "PATCH", credentials: "include" });
              queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/intelligence"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
              queryClient.invalidateQueries({ queryKey: ["/api/today"] }); // F-11-1
              queryClient.invalidateQueries({ queryKey: ["/api/leads/aging"] });
            } catch { /* ignore */ }
          },
        }, "Undo") as any,
        duration: 10000,
      });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });
}

/**
 * Re-run the Betty score for a lead and invalidate every dependent cache.
 *
 * Replaces two duplicate mutations in pages/leads.tsx (the score-details
 * modal and the row dropdown menu). Both previously invalidated only
 * ['/api/leads'] and missed:
 *   - the per-lead detail cache (header score badge stays old)
 *   - the score-history query (timeline chart stays stale)
 */
export function useRescoreLead() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (leadId: number) => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/betty-score`, { triggerSource: "manual" });
      if (!res.ok) throw new Error("Failed to rescore lead");
      return res.json();
    },
    onSuccess: (_data, leadId) => {
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.leads.get.path, leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "score-history"] });
      toast({
        title: "Lead rescored",
        description: "The lead score has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't rescore lead",
        description: "The existing score is unchanged. Try again.",
        variant: "destructive",
      });
    },
  });
}

export interface AgingLead {
  id: number;
  firstName: string;
  lastName: string;
  nurturingStage: string;
  score: number | null;
  lastContactedAt: string | null;
  daysSinceContact: number;
  urgency: 'urgent' | 'warning' | 'info';
}

export function useAgingLeads() {
  return useQuery<AgingLead[]>({
    queryKey: ['/api/leads/aging'],
    queryFn: async () => {
      const res = await fetch('/api/leads/aging', { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch aging leads");
      return res.json();
    },
  });
}

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { invalidateRelated, relatedKeys } from "@/lib/query-keys";
import type { Deal, InsertDeal } from "@shared/schema";

export interface PaginatedDealsResponse {
  data: Deal[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Fetch deals with server-side pagination.
 * Returns { data, total, page, pageSize, totalPages }.
 */
export function useDealsPaginated(params: { page: number; pageSize: number; sortBy?: string; sortOrder?: string }) {
  const queryParams = new URLSearchParams();
  queryParams.set("page", String(params.page));
  queryParams.set("pageSize", String(params.pageSize));
  if (params.sortBy) queryParams.set("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);
  const url = `/api/deals?${queryParams.toString()}`;

  return useQuery<PaginatedDealsResponse>({
    queryKey: ['/api/deals', "paginated", params.page, params.pageSize, params.sortBy, params.sortOrder],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      return res.json();
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
    placeholderData: keepPreviousData,
  });
}

// T0-10 — shape of GET /api/deals/aggregates (see server/services/dealAggregates.ts).
export interface DealAggregatesResponse {
  totals: {
    totalDeals: number;
    acquisitions: number;
    dispositions: number;
    totalPipelineValue: number;
    closedValue: number;
    stalledCount: number;
    warningCount: number;
  };
  stages: { status: string; count: number; value: number }[];
}

/**
 * T0-10 — org-wide deal aggregates for the Deals header KPIs + stage bar.
 *
 * The header previously reduced the CURRENT PAGE of useDealsPaginated
 * (25 rows), so orgs with >25 deals saw wrong pipeline/closed/stalled
 * numbers. This hook reads the server-side SQL aggregation instead.
 * The queryKey starts with the bare '/api/deals' prefix so every existing
 * deal-mutation invalidation cascades to it automatically.
 */
export function useDealAggregates(type: string = "all") {
  const search = type !== "all" ? `?type=${encodeURIComponent(type)}` : "";
  return useQuery<DealAggregatesResponse>({
    queryKey: ['/api/deals', "aggregates", type],
    queryFn: async () => {
      const res = await fetch(`/api/deals/aggregates${search}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deal aggregates");
      return res.json();
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
    placeholderData: keepPreviousData,
  });
}

/**
 * Legacy hook: returns the flat deals array for backward compatibility.
 * Fetches page 1 with pageSize=100 (capped — pageSize=1000 was loading
 * the entire deals table on every consumer mount, which is the kind of
 * unbounded query that makes pages feel sluggish on cold cache or
 * cellular). UIs that need server-paginated access should use
 * useDealsPaginated. The queryKey is intentionally bare ['/api/deals']
 * so write-side mutation invalidations still cascade through.
 */
export function useDeals() {
  return useQuery<Deal[]>({
    queryKey: ['/api/deals'],
    queryFn: async () => {
      const res = await fetch('/api/deals?page=1&pageSize=100', { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch deals");
      const json = await res.json();
      return json.data ?? json;
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
  });
}

export function useDeal(id: number) {
  return useQuery<Deal>({
    queryKey: ['/api/deals', id],
    enabled: !!id,
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Omit<InsertDeal, 'organizationId'>) => {
      const res = await apiRequest("POST", "/api/deals", data);
      return res.json();
    },
    onSuccess: () => {
      // Registry fan-out (P1 §2.1): list + dashboards + Today door +
      // onboarding checklist — RELATED["deal"] in lib/query-keys.ts.
      invalidateRelated("deal", queryClient);
      toast({
        title: "Success",
        description: "Deal created successfully.",
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

export function useUpdateDeal() {
  // Optimistic deal update — primary use case is stage/status drag-and-drop
  // on the deals board, where instant feedback is critical. Backed by the
  // useOptimisticUpdate factory (client/src/lib/optimistic-mutation.ts).
  return useOptimisticUpdate<{ id: number } & Partial<InsertDeal>, Deal>({
    mutationFn: async ({ id, ...data }) => {
      const res = await apiRequest("PUT", `/api/deals/${id}`, data);
      return res.json();
    },
    listKeys: [["/api/deals"]],
    // Registry fan-out (P1 §2.1): a stage/status change moves the deal in
    // the Today feed and the dashboards — RELATED["deal"] owns the list.
    extraInvalidateKeys: relatedKeys("deal"),
    detailKey: ({ id }) => ["/api/deals", id],
    getId: ({ id }) => id,
    successToast: { title: "Success", description: "Deal updated successfully." },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/deals/${id}`);
      if (!res.ok) throw new Error(`${res.status}: Failed to delete deal`);
    },
    onSuccess: (_data, id) => {
      // Registry fan-out (P1 §2.1, mirrors the leads-delete fix, commit
      // 26c20669): a bare /api/deals invalidation leaves dashboard widgets
      // and the Today door holding stale rows — RELATED["deal"] in
      // lib/query-keys.ts owns the full consumer list. The per-deal detail
      // cache is removed so navigating back doesn't resurrect the row.
      invalidateRelated("deal", queryClient);
      queryClient.removeQueries({ queryKey: ['/api/deals', id] });
      toast({
        title: "Success",
        description: "Deal deleted successfully.",
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

export function useSaveDealAnalysis() {
  // Optimistic analysis save — patches analysisResults into every cached
  // deal list + the detail cache so the UI never shows a stale empty
  // analysis panel after the calc is submitted. Backed by useOptimisticUpdate.
  return useOptimisticUpdate<{ dealId: number; analysisResults: object }, Deal>({
    mutationFn: async ({ dealId, analysisResults }) => {
      const res = await apiRequest("PUT", `/api/deals/${dealId}`, { analysisResults });
      return res.json();
    },
    listKeys: [["/api/deals"]],
    detailKey: ({ dealId }) => ["/api/deals", dealId],
    getId: ({ dealId }) => dealId,
    buildPatch: ({ analysisResults }) => ({ analysisResults }),
    successToast: { title: "Success", description: "Deal analysis saved successfully." },
  });
}

export interface BulkStageUpdatePreview {
  requiresConfirmation: boolean;
  message: string;
  dealsToUpdate: Array<{
    id: number;
    propertyId: number;
    currentStage: string;
    newStage: string;
  }>;
  skippedCount: number;
}

export interface BulkStageUpdateResult {
  success: boolean;
  message: string;
  updatedCount: number;
  skippedCount: number;
  previousStates: Array<{ id: number; previousStage: string }>;
  undoAvailable: boolean;
}

export function useBulkStageUpdate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ ids, newStage, confirmed = false }: { 
      ids: number[]; 
      newStage: string; 
      confirmed?: boolean 
    }): Promise<BulkStageUpdatePreview | BulkStageUpdateResult> => {
      const res = await apiRequest("POST", "/api/deals/bulk-stage-update", { 
        ids, 
        newStage, 
        confirmed 
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Bulk stage update failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if ('success' in data && data.success) {
        // Registry fan-out (P1 §2.1): a bulk stage move shifts pipeline
        // aggregates, dashboards and the Today feed, not just the list.
        invalidateRelated("deal", queryClient);
      }
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
 * Advance a deal to the next pipeline stage — drives the SwipeableCard
 * right-swipe gesture on mobile. Uses the dedicated POST endpoint so the
 * server's state-machine logic (DEAL_STATUS_TRANSITIONS) is always the
 * source of truth; we never compute the next stage client-side.
 */
export function useAdvanceDealStage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (dealId: number) => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/advance-stage`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to advance stage");
      }
      return res.json() as Promise<{ deal: import("@shared/schema").Deal; previousStatus: string; nextStatus: string }>;
    },
    onSuccess: (data) => {
      // Registry fan-out (P1 §2.1): the swipe-advance previously missed
      // /api/today and the dashboards entirely — a stage change moves the
      // deal in the Today feed, so it goes through RELATED["deal"] now.
      invalidateRelated("deal", queryClient);
      queryClient.invalidateQueries({ queryKey: ["/api/deals", data.deal.id] });
      toast({
        title: "Stage advanced",
        description: `Deal moved to ${data.nextStatus.replace(/_/g, " ")}.`,
      });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });
}

export function useBulkStageUndo() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (previousStates: Array<{ id: number; previousStage: string }>) => {
      const res = await apiRequest("POST", "/api/deals/bulk-stage-undo", { previousStates });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Undo failed");
      }
      return res.json();
    },
    onSuccess: () => {
      // Registry fan-out (P1 §2.1): the undo moves stages back, so the
      // same consumers as the bulk update need refetching.
      invalidateRelated("deal", queryClient);
      toast({
        title: "Success",
        description: "Stage changes have been undone.",
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

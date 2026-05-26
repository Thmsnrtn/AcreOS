import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
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
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist-status"] });
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<InsertDeal>) => {
      const res = await apiRequest("PUT", `/api/deals/${id}`, data);
      return res.json();
    },
    // Optimistic deal update — primary use case is stage/status drag-and-drop
    // on the deals board, where instant feedback is critical.
    onMutate: async ({ id, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/deals'] });

      const snapshots: Array<[readonly unknown[], unknown]> = [];

      const listEntries = queryClient.getQueriesData({ queryKey: ['/api/deals'] });
      for (const [key, value] of listEntries) {
        snapshots.push([key, value]);
        if (Array.isArray(value)) {
          queryClient.setQueryData(key, value.map((deal: any) =>
            deal?.id === id ? { ...deal, ...updates } : deal
          ));
        } else if (value && typeof value === "object" && Array.isArray((value as any).data)) {
          const v = value as { data: any[] };
          queryClient.setQueryData(key, {
            ...value,
            data: v.data.map((deal: any) => (deal?.id === id ? { ...deal, ...updates } : deal)),
          });
        } else if (value && typeof value === "object" && (value as any).id === id) {
          queryClient.setQueryData(key, { ...(value as object), ...updates });
        }
      }

      return { snapshots };
    },
    onError: (error, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Deal updated successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
    },
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
      // Mirrors the leads-delete fix (commit 26c20669). A bare /api/deals
      // invalidation leaves dashboard widgets (stats, intelligence,
      // today-priorities) holding stale rows, plus the per-deal detail
      // cache still exists if the user navigates back to it.
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/intelligence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ dealId, analysisResults }: { dealId: number; analysisResults: object }) => {
      const res = await apiRequest("PUT", `/api/deals/${dealId}`, { analysisResults });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
      toast({
        title: "Success",
        description: "Deal analysis saved successfully.",
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
        queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
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
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
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

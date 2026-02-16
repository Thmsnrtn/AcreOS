import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import type { Deal, InsertDeal } from "@shared/schema";

export function useDeals() {
  return useQuery<Deal[]>({
    queryKey: ['/api/deals'],
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
      toast({
        title: "Success",
        description: "Deal updated successfully.",
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

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/deals/${id}`);
      if (!res.ok) throw new Error(`${res.status}: Failed to delete deal`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
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

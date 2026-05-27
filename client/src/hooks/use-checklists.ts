import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import type { ChecklistTemplate, DealChecklist, DealChecklistItem } from "@shared/schema";

interface DealChecklistWithStatus extends DealChecklist {
  completionStatus: {
    completed: number;
    total: number;
    percentage: number;
  };
}

interface StageGateResult {
  canAdvance: boolean;
  incompleteItems: DealChecklistItem[];
}

export function useChecklistTemplates() {
  return useQuery<ChecklistTemplate[]>({
    queryKey: ["/api/checklist-templates"],
  });
}

export function useDealChecklist(dealId: number | null) {
  return useQuery<DealChecklistWithStatus | null>({
    queryKey: ["/api/deals", dealId, "checklist"],
    enabled: !!dealId,
  });
}

export function useApplyChecklistTemplate(dealId: number) {
  return useMutation({
    mutationFn: async (templateId: number) => {
      const res = await apiRequest("POST", `/api/deals/${dealId}/checklist`, { templateId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "checklist"] });
    },
  });
}

export function useUpdateChecklistItem(dealId: number) {
  return useMutation({
    mutationFn: async ({ itemId, checked, documentUrl }: { itemId: string; checked?: boolean; documentUrl?: string }) => {
      const res = await apiRequest("PATCH", `/api/deals/${dealId}/checklist/items/${itemId}`, { checked, documentUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "checklist"] });
    },
  });
}

export function useStageGate(dealId: number | null) {
  return useQuery<StageGateResult>({
    queryKey: ["/api/deals", dealId, "stage-gate"],
    enabled: !!dealId,
  });
}

/**
 * Optimistic deal-stage update. Drag-and-drop on the pipeline board
 * snaps the card to its new column without waiting for the server.
 * Patches every cached `/api/deals` list (flat + paginated envelope)
 * via the factory.
 */
export function useUpdateDealStage(dealId: number) {
  return useOptimisticUpdate<{ stage: string; force?: boolean }>({
    mutationFn: async ({ stage, force }) => {
      const res = await apiRequest("PATCH", `/api/deals/${dealId}/stage`, { stage, force });
      return res.json();
    },
    listKeys: [["/api/deals"]],
    detailKey: () => ["/api/deals", dealId],
    getId: () => dealId,
    buildPatch: ({ stage }) => ({ stage }),
    extraInvalidateKeys: [["/api/deals", dealId, "stage-gate"]],
  });
}

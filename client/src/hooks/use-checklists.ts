import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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

export function useUpdateDealStage(dealId: number) {
  return useMutation({
    mutationFn: async ({ stage, force }: { stage: string; force?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/deals/${dealId}/stage`, { stage, force });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId] });
    },
  });
}

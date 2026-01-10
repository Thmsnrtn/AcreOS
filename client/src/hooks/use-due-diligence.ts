import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { DueDiligenceTemplate, DueDiligenceItem, InsertDueDiligenceTemplate, InsertDueDiligenceItem, DueDiligenceChecklist, DueDiligenceDossier } from "@shared/schema";

// AI Dossier hooks - Phase 3 dueDiligencePods service
export function useRequestAIDossier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: number): Promise<{ success: boolean; dossierId: number }> => {
      const res = await apiRequest("POST", `/api/ai/due-diligence/request`, { propertyId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/due-diligence"] });
    },
  });
}

export function useAIDossier(dossierId: number | null, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery<DueDiligenceDossier>({
    queryKey: ["/api/ai/due-diligence", dossierId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/due-diligence/${dossierId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch dossier");
      return res.json();
    },
    enabled: !!dossierId && (options?.enabled !== false),
    refetchInterval: options?.refetchInterval,
  });
}

// Enhanced Due Diligence Checklist hooks
export function useDueDiligenceChecklist(propertyId: number) {
  return useQuery<DueDiligenceChecklist>({
    queryKey: ["/api/due-diligence", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/due-diligence/${propertyId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch due diligence checklist");
      return res.json();
    },
    enabled: !!propertyId,
  });
}

export function useUpdateDueDiligenceChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      propertyId,
      updates,
    }: {
      propertyId: number;
      updates: Partial<DueDiligenceChecklist>;
    }) => {
      const res = await apiRequest("PUT", `/api/due-diligence/${propertyId}`, updates);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/due-diligence", variables.propertyId],
      });
    },
  });
}

export function useLookupFloodZone() {
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/due-diligence/${propertyId}/lookup/flood-zone`);
      return res.json();
    },
  });
}

export function useLookupWetlands() {
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/due-diligence/${propertyId}/lookup/wetlands`);
      return res.json();
    },
  });
}

export function useLookupTax() {
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/due-diligence/${propertyId}/lookup/tax`);
      return res.json();
    },
  });
}

export function useLookupSoilData() {
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/due-diligence/${propertyId}/lookup/soil`);
      return res.json();
    },
  });
}

export function useLookupEnvironmental() {
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/due-diligence/${propertyId}/lookup/environmental`);
      return res.json();
    },
  });
}

export function useDueDiligenceTemplates() {
  return useQuery<DueDiligenceTemplate[]>({
    queryKey: ["/api/due-diligence/templates"],
  });
}

export function usePropertyDueDiligence(propertyId: number) {
  return useQuery<DueDiligenceItem[]>({
    queryKey: ["/api/properties", propertyId, "due-diligence"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/due-diligence`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch due diligence items");
      return res.json();
    },
    enabled: !!propertyId,
  });
}

export function useApplyDueDiligenceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      propertyId,
      templateId,
    }: {
      propertyId: number;
      templateId: number;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/properties/${propertyId}/due-diligence/apply-template`,
        { templateId }
      );
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/properties", variables.propertyId, "due-diligence"],
      });
    },
  });
}

export function useUpdateDueDiligenceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      propertyId,
      updates,
    }: {
      itemId: number;
      propertyId: number;
      updates: Partial<InsertDueDiligenceItem>;
    }) => {
      const res = await apiRequest("PUT", `/api/due-diligence/items/${itemId}`, updates);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/properties", variables.propertyId, "due-diligence"],
      });
    },
  });
}

export function useCreateDueDiligenceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      propertyId,
      item,
    }: {
      propertyId: number;
      item: Omit<InsertDueDiligenceItem, "propertyId">;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/properties/${propertyId}/due-diligence`,
        item
      );
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/properties", variables.propertyId, "due-diligence"],
      });
    },
  });
}

export function useDeleteDueDiligenceItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      propertyId,
    }: {
      itemId: number;
      propertyId: number;
    }) => {
      await apiRequest("DELETE", `/api/due-diligence/items/${itemId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/properties", variables.propertyId, "due-diligence"],
      });
    },
  });
}

export function useCreateDueDiligenceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: Omit<InsertDueDiligenceTemplate, "organizationId">) => {
      const res = await apiRequest("POST", "/api/due-diligence/templates", template);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/due-diligence/templates"] });
    },
  });
}

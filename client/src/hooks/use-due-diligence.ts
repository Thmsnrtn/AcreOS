import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
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

// Maren #6 (Tahoe): confidence-aware checklist annotations. Advisory only —
// the data informs the human, it never checks the box.
export type ChecklistAnnotationVerdict =
  | "likely_clears"
  | "needs_attention"
  | "flagged"
  | "unknown";

export interface ChecklistAnnotation {
  itemId: "env-flood" | "env-wetlands" | "env-soil" | "env-epa";
  summary: string;
  verdict: ChecklistAnnotationVerdict;
  confidence: "high" | "medium" | "low" | "none";
  source: string | null;
  asOf: string | null;
  requiresVerification: boolean;
}

export interface ChecklistAnnotationsResponse {
  annotations: Record<string, ChecklistAnnotation>;
  hasCoordinates: boolean;
}

/**
 * Fetch the open-data annotations for a property's environmental checklist
 * items. Lazy by default (`enabled` controls when it runs) so we don't fire
 * the slow open-data lookups until the panel is actually shown.
 */
export function useChecklistAnnotations(propertyId: number, options?: { enabled?: boolean }) {
  return useQuery<ChecklistAnnotationsResponse>({
    queryKey: ["/api/due-diligence", propertyId, "annotations"],
    queryFn: async () => {
      const res = await fetch(`/api/due-diligence/${propertyId}/annotations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch checklist annotations");
      return res.json();
    },
    enabled: !!propertyId && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000, // open data is slow-changing; cache 5 min
  });
}

export function useUpdateDueDiligenceChecklist() {
  // Optimistic checklist update — toggling flood-zone status, wetlands
  // assessment, etc. should feel instant. The cache here is a single
  // checklist object (not a list), so we use detailKey only and pass
  // an empty listKeys; the helper invalidates the detail key via
  // extraInvalidateKeys on settle.
  return useOptimisticUpdate<
    { propertyId: number; updates: Partial<DueDiligenceChecklist> },
    DueDiligenceChecklist
  >({
    mutationFn: async ({ propertyId, updates }) => {
      const res = await apiRequest("PUT", `/api/due-diligence/${propertyId}`, updates);
      return res.json();
    },
    listKeys: [],
    detailKey: ({ propertyId }) => ["/api/due-diligence", propertyId],
    getId: ({ propertyId }) => propertyId,
    // updates is nested inside variables — flatten it for the patch.
    buildPatch: ({ updates }) => ({ ...updates }),
    extraInvalidateKeys: [["/api/due-diligence"]],
  });
}

// Each lookup POST writes its results into the property's due-diligence
// checklist server-side, so the checklist (and its annotations child key)
// must be invalidated on success — prefix matching on
// ["/api/due-diligence", propertyId] covers both.
function useLookupMutation(path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", `/api/due-diligence/${propertyId}/lookup/${path}`);
      return res.json();
    },
    onSuccess: (_data, propertyId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/due-diligence", propertyId] });
    },
  });
}

export function useLookupFloodZone() {
  return useLookupMutation("flood-zone");
}

export function useLookupWetlands() {
  return useLookupMutation("wetlands");
}

export function useLookupTax() {
  return useLookupMutation("tax");
}

export function useLookupSoilData() {
  return useLookupMutation("soil");
}

export function useLookupEnvironmental() {
  return useLookupMutation("environmental");
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
  // Optimistic item update — checking off a DD item from the property
  // sidebar should feel instant. List cache is a flat array of items
  // keyed by ["/api/properties", propertyId, "due-diligence"], items
  // have an `id` field matching itemId.
  return useOptimisticUpdate<
    { itemId: number; propertyId: number; updates: Partial<InsertDueDiligenceItem> },
    DueDiligenceItem
  >({
    mutationFn: async ({ itemId, updates }) => {
      const res = await apiRequest("PUT", `/api/due-diligence/items/${itemId}`, updates);
      return res.json();
    },
    // listKey resolves per-call against the variables — items live
    // under a property-scoped key.
    listKeys: [({ propertyId }) => ["/api/properties", propertyId, "due-diligence"]],
    getId: ({ itemId }) => itemId,
    buildPatch: ({ updates }) => ({ ...updates }),
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

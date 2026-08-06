import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, buildUrl, type InsertProperty } from "@shared/routes";
import { z } from "zod";
import { STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

export interface PaginatedPropertiesResponse {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Fetch properties with server-side pagination.
 * Returns { data, total, page, pageSize, totalPages }.
 */
export function usePropertiesPaginated(params: { page: number; pageSize: number; sortBy?: string; sortOrder?: string }) {
  const queryParams = new URLSearchParams();
  queryParams.set("page", String(params.page));
  queryParams.set("pageSize", String(params.pageSize));
  if (params.sortBy) queryParams.set("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);
  const url = `${api.properties.list.path}?${queryParams.toString()}`;

  return useQuery<PaginatedPropertiesResponse>({
    queryKey: [api.properties.list.path, "paginated", params.page, params.pageSize, params.sortBy, params.sortOrder],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch properties");
      return res.json();
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
    placeholderData: keepPreviousData,
  });
}

/**
 * Legacy hook: returns the flat property array for backward compatibility.
 * Fetches page 1 with pageSize=100 from the paginated endpoint.
 */
export function useProperties() {
  return useQuery({
    queryKey: [api.properties.list.path],
    queryFn: async () => {
      const res = await fetch(`${api.properties.list.path}?page=1&pageSize=100`, { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json();
      // Return the data array for backward compatibility
      return Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Omit<InsertProperty, 'organizationId'>) => {
      const res = await fetch(api.properties.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: Failed to create property`);
      return api.properties.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.properties.list.path] });
      // Onboarding checklist's "Add first property" tile derives from the
      // checklist-status endpoint. Lead + deal create already invalidate
      // it; property create did not, so the tile never ticked after
      // the user added their first property.
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today"] }); // F-11-1: Today door key (create parity with delete)
      toast({
        title: "Success",
        description: "Property created successfully.",
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

export function useDeleteProperty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/properties/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: "Failed to delete property" }));
        throw new Error(error.message || `${res.status}: Failed to delete property`);
      }
    },
    // 2026-05-26: optimistic delete so the row disappears the instant
    // the user confirms — matches the perceived-speed bar set by Linear
    // and Attio. Snapshot every cached list so we can roll back on error.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: [api.properties.list.path] });
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const listEntries = queryClient.getQueriesData({ queryKey: [api.properties.list.path] });
      for (const [key, value] of listEntries) {
        snapshots.push([key, value]);
        if (Array.isArray(value)) {
          queryClient.setQueryData(
            key,
            value.filter((p: any) => p?.id !== id),
          );
        } else if (value && typeof value === "object" && Array.isArray((value as any).data)) {
          const v = value as { data: any[] };
          queryClient.setQueryData(key, {
            ...value,
            data: v.data.filter((p: any) => p?.id !== id),
          });
        }
      }
      return { snapshots };
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: [api.properties.list.path] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today"] }); // F-11-1: Today door key
      queryClient.removeQueries({ queryKey: [api.properties.get.path, id] });
      toast({
        title: "Success",
        description: "Property deleted successfully.",
      });
    },
    onError: (error, _id, context) => {
      // Roll back the optimistic delete.
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
  });
}

export function useEnrichProperty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ propertyId, forceRefresh = false }: { propertyId: number; forceRefresh?: boolean }) => {
      const res = await fetch("/api/broker/enrich-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, forceRefresh }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: "Failed to enrich property" }));
        throw new Error(error.message || `${res.status}: Failed to enrich property`);
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.properties.list.path] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties', variables.propertyId] });
      toast({
        title: "Success",
        description: "Property enriched successfully.",
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

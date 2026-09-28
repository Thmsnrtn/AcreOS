import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { okOrThrow, listFrom, nullOn404 } from "@/lib/fetch-honesty";
import { api, buildUrl, type InsertProperty } from "@shared/routes";
import type { Property } from "@shared/schema";
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
      // THROWS on failure. It used to `return []`, which made every consumer —
      // finance.tsx twice, the document generator — read an outage as "this
      // customer owns no properties". A property list is the customer's own
      // core data; there is no honest empty value for a read that did not
      // happen. Consumers that render a zero-state must branch on `isError`
      // first (see emptyIsNotFailed.test.ts).
      const res = await okOrThrow(
        await fetch(`${api.properties.list.path}?page=1&pageSize=100`, { credentials: "include" }),
      );
      return listFrom<Property>(await res.json());
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
  });
}

/**
 * One property by id (DEFECT-0168). Lookups used to `find` the id in
 * useProperties()'s newest-100 page, so a deal or note on an older property
 * rendered "Property #N" / "No property linked" and fed downstream math a
 * missing property. A 404 is a real answer (null); anything else throws.
 */
export function useProperty(id: number | null | undefined) {
  return useQuery<Property | null>({
    queryKey: [api.properties.list.path, "by-id", id],
    enabled: typeof id === "number" && id > 0,
    queryFn: async () => {
      return nullOn404<Property>(
        await fetch(buildUrl(api.properties.get.path, { id: id as number }), { credentials: "include" }),
      );
    },
    staleTime: STALE_TIMES.short,
  });
}

/**
 * The named properties, fetched by id (in requests of up to 100). For
 * lists that resolve each row's property — deals, notes — without assuming
 * it is among the newest hundred.
 */
export function usePropertiesByIds(ids: Array<number | null | undefined>) {
  return usePropertiesKeyedBy("ids", ids);
}

/** Properties whose seller is one of these leads, keyed by sellerId. */
export function usePropertiesBySellerIds(leadIds: Array<number | null | undefined>) {
  return usePropertiesKeyedBy("sellerIds", leadIds);
}

function usePropertiesKeyedBy(param: "ids" | "sellerIds", ids: Array<number | null | undefined>) {
  const wanted = [...new Set(ids.filter((v): v is number => typeof v === "number" && v > 0))].sort((a, b) => a - b);
  return useQuery<Map<number, Property>>({
    queryKey: [api.properties.list.path, `by-${param}`, wanted.join(",")],
    enabled: wanted.length > 0,
    // In chunks of the route's 100-id ceiling — never "the lowest 100 ids".
    queryFn: async () => {
      const chunks: number[][] = [];
      for (let i = 0; i < wanted.length; i += 100) chunks.push(wanted.slice(i, i + 100));
      const pages = await Promise.all(
        chunks.map(async (chunk) => {
          const res = await okOrThrow(
            await fetch(`${api.properties.list.path}?pageSize=100&${param}=${chunk.join(",")}`, { credentials: "include" }),
          );
          return listFrom<Property>(await res.json());
        }),
      );
      const key = (p: Property) => (param === "ids" ? p.id : (p.sellerId as number));
      return new Map(pages.flat().map((p) => [key(p), p]));
    },
    staleTime: STALE_TIMES.short,
  });
}

/** Server-side property search for pickers (DEFECT-0168). */
export function usePropertySearch(q: string, opts: { excludeStatus?: string; enabled?: boolean } = {}) {
  const term = q.trim();
  const params = new URLSearchParams({ page: "1", pageSize: "25" });
  if (term) params.set("q", term);
  if (opts.excludeStatus) params.set("excludeStatus", opts.excludeStatus);
  return useQuery<PaginatedPropertiesResponse>({
    queryKey: [api.properties.list.path, "search", term, opts.excludeStatus ?? ""],
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      const res = await okOrThrow(await fetch(`${api.properties.list.path}?${params}`, { credentials: "include" }));
      return res.json();
    },
    placeholderData: keepPreviousData,
    staleTime: STALE_TIMES.short,
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

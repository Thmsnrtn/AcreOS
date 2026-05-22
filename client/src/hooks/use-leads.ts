import React from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, buildUrl, type InsertLead } from "@shared/routes";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";

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
export function useLeadsPaginated(params: { page: number; pageSize: number; sortBy?: string; sortOrder?: string; stage?: string; assignedTo?: string }) {
  const queryParams = new URLSearchParams();
  queryParams.set("page", String(params.page));
  queryParams.set("pageSize", String(params.pageSize));
  if (params.sortBy) queryParams.set("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.set("sortOrder", params.sortOrder);
  if (params.stage) queryParams.set("stage", params.stage);
  if (params.assignedTo) queryParams.set("assignedTo", params.assignedTo);
  const url = `${api.leads.list.path}?${queryParams.toString()}`;

  return useQuery<PaginatedLeadsResponse>({
    queryKey: [api.leads.list.path, "paginated", params.page, params.pageSize, params.sortBy, params.sortOrder, params.stage, params.assignedTo],
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
 * Fetches page 1 with large pageSize from the paginated endpoint.
 */
export function useLeads() {
  return useQuery({
    queryKey: [api.leads.list.path],
    queryFn: async () => {
      const res = await fetch(`${api.leads.list.path}?page=1&pageSize=100`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    },
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
  });
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<InsertLead>) => {
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
    // Optimistic update: instantly reflect the new lead state (e.g. "contacted",
    // status change, score) across every cached leads query. Snapshot the
    // previous cache and roll it back on error.
    onMutate: async ({ id, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: [api.leads.list.path] });
      await queryClient.cancelQueries({ queryKey: [api.leads.get.path, id] });

      const snapshots: Array<[readonly unknown[], unknown]> = [];

      // Patch every cached list (paginated + flat).
      const listEntries = queryClient.getQueriesData({ queryKey: [api.leads.list.path] });
      for (const [key, value] of listEntries) {
        snapshots.push([key, value]);
        if (Array.isArray(value)) {
          queryClient.setQueryData(key, value.map((lead: any) =>
            lead?.id === id ? { ...lead, ...updates } : lead
          ));
        } else if (value && typeof value === "object" && Array.isArray((value as any).data)) {
          const v = value as { data: any[] };
          queryClient.setQueryData(key, {
            ...value,
            data: v.data.map((lead: any) => (lead?.id === id ? { ...lead, ...updates } : lead)),
          });
        }
      }

      // Patch the per-lead detail cache.
      const detail = queryClient.getQueryData<any>([api.leads.get.path, id]);
      if (detail) {
        snapshots.push([[api.leads.get.path, id], detail]);
        queryClient.setQueryData([api.leads.get.path, id], { ...detail, ...updates });
      }

      return { snapshots };
    },
    onError: (error, _vars, context) => {
      // Roll back every cache we touched.
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
        description: "Lead updated successfully.",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
    },
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

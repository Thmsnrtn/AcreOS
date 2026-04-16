import React from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, buildUrl, type InsertLead } from "@shared/routes";
import { STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
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
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
      toast({
        title: "Success",
        description: "Lead updated successfully.",
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
      queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
      toast({
        title: "Lead deleted",
        description: "Lead moved to trash.",
        action: React.createElement("button", {
          className: "shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted",
          onClick: async () => {
            try {
              await fetch(`/api/leads/${id}/restore`, { method: "PATCH", credentials: "include" });
              queryClient.invalidateQueries({ queryKey: [api.leads.list.path] });
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

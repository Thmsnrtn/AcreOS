import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PlaybookInstance } from "@shared/schema";

export interface PlaybookStep {
  id: string;
  title: string;
  description: string;
  actionType: "navigate" | "create_lead" | "create_deal" | "manual";
  actionLabel: string;
  actionUrl?: string;
  icon: string;
  estimatedMinutes: number;
}

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  estimatedDuration: string;
  steps: PlaybookStep[];
}

export interface PlaybooksResponse {
  templates: Array<{
    template: PlaybookTemplate;
    activeInstance: PlaybookInstance | null;
  }>;
  activeInstances: PlaybookInstance[];
}

export function usePlaybooks() {
  return useQuery<PlaybooksResponse>({
    queryKey: ["/api/playbooks"],
  });
}

export function usePlaybook(id: string) {
  return useQuery<{ template: PlaybookTemplate; activeInstance: PlaybookInstance | null }>({
    queryKey: ["/api/playbooks", id],
    enabled: !!id,
  });
}

export function usePlaybookInstance(instanceId: number) {
  return useQuery<{ instance: PlaybookInstance; template: PlaybookTemplate }>({
    queryKey: ["/api/playbooks/instances", instanceId],
    enabled: !!instanceId,
  });
}

export function useStartPlaybook() {
  return useMutation({
    mutationFn: async ({ templateId, linkedDealId, linkedPropertyId, linkedLeadId }: {
      templateId: string;
      linkedDealId?: number;
      linkedPropertyId?: number;
      linkedLeadId?: number;
    }) => {
      const response = await apiRequest("POST", `/api/playbooks/${templateId}/start`, {
        linkedDealId,
        linkedPropertyId,
        linkedLeadId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playbooks"] });
    },
  });
}

export function useCompleteStep() {
  return useMutation({
    mutationFn: async ({ instanceId, stepId }: { instanceId: number; stepId: string }) => {
      const response = await apiRequest("POST", `/api/playbooks/instances/${instanceId}/steps/${stepId}/complete`);
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/playbooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/playbooks/instances", variables.instanceId] });
    },
  });
}

export function useUncompleteStep() {
  return useMutation({
    mutationFn: async ({ instanceId, stepId }: { instanceId: number; stepId: string }) => {
      const response = await apiRequest("POST", `/api/playbooks/instances/${instanceId}/steps/${stepId}/uncomplete`);
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/playbooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/playbooks/instances", variables.instanceId] });
    },
  });
}

export function useDeletePlaybookInstance() {
  return useMutation({
    mutationFn: async (instanceId: number) => {
      const response = await apiRequest("DELETE", `/api/playbooks/instances/${instanceId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/playbooks"] });
    },
  });
}

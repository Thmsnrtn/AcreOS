import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Campaign, InsertCampaign } from "@shared/schema";

export function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ['/api/campaigns'],
  });
}

export function useCampaign(id: number) {
  return useQuery<Campaign>({
    queryKey: ['/api/campaigns', id],
    enabled: !!id,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertCampaign) => {
      const res = await apiRequest("POST", "/api/campaigns", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<InsertCampaign>) => {
      const res = await apiRequest("PUT", `/api/campaigns/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
    },
  });
}

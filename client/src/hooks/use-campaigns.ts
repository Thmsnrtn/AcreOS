import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Campaign, InsertCampaign } from "@shared/schema";

// Direct mail status response type
export interface DirectMailStatus {
  isConfigured: boolean;
  currentMode: 'test' | 'live';
  availableModes: ('test' | 'live')[];
  hasTestMode: boolean;
  hasLiveMode: boolean;
  pricing: Record<string, number>;
  deliveryDays: { min: number; max: number };
}

export interface MailEstimateResponse {
  perPieceCost: number;
  totalCost: number;
  recipientCount: number;
  pieceType: string;
  isTestMode: boolean;
  currentMode: 'test' | 'live';
  creditBalance: number;
  hasEnoughCredits: boolean;
  creditsNeeded: number;
}

export interface SendDirectMailResponse {
  success: boolean;
  isTestMode: boolean;
  piecesQueued: number;
  piecesFailed: number;
  totalCost: number;
  refunded: number;
  message: string;
}

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
    mutationFn: async (data: Omit<InsertCampaign, 'organizationId'>) => {
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

// Direct mail hooks
export function useDirectMailStatus() {
  return useQuery<DirectMailStatus>({
    queryKey: ['/api/direct-mail/status'],
  });
}

export function useUpdateMailMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: 'test' | 'live') => {
      const res = await apiRequest("PATCH", "/api/direct-mail/mode", { mode });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/direct-mail/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/organization'] });
    },
  });
}

export function useMailEstimate() {
  return useMutation({
    mutationFn: async (data: { pieceType: string; recipientCount?: number; recipientIds?: number[]; campaignId?: number }) => {
      const res = await apiRequest("POST", "/api/direct-mail/estimate", data);
      return res.json() as Promise<MailEstimateResponse>;
    },
  });
}

export function useSendDirectMail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { campaignId: number; pieceType: string; leadIds: number[] }) => {
      const res = await apiRequest("POST", `/api/campaigns/${data.campaignId}/send-direct-mail`, {
        pieceType: data.pieceType,
        leadIds: data.leadIds,
      });
      return res.json() as Promise<SendDirectMailResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['/api/organization'] });
    },
  });
}

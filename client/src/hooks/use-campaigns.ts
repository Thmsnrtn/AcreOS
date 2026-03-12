import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Campaign, InsertCampaign, CampaignOptimization } from "@shared/schema";

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

interface VerifyAddressResult {
  isValid: boolean;
  deliverability: string;
  details: {
    components?: {
      primaryNumber?: string;
      streetPredirection?: string;
      streetName?: string;
      streetSuffix?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      zipCodePlus4?: string;
    };
    deliverabilityAnalysis?: {
      dpvConfirmation?: string;
      dpvCmra?: string;
      dpvVacant?: string;
      dpvFootnotes?: string[];
    };
    lobAddressId?: string;
  };
  errorMessage?: string;
}

export function useVerifyAddress() {
  return useMutation({
    mutationFn: async (address: { line1: string; line2?: string; city: string; state: string; zip: string }) => {
      const res = await apiRequest("POST", "/api/direct-mail/verify-address", address);
      return res.json() as Promise<VerifyAddressResult>;
    },
  });
}

export function useBulkVerifyAddresses() {
  return useMutation({
    mutationFn: async (leadIds: number[]) => {
      const res = await apiRequest("POST", "/api/direct-mail/bulk-verify-addresses", { leadIds });
      return res.json() as Promise<{
        total: number;
        verified: number;
        deliverable: number;
        undeliverable: number;
        results: Array<{
          leadId: number;
          isValid: boolean;
          deliverability: string;
          errorMessage?: string;
        }>;
      }>;
    },
  });
}

// Campaign optimization hooks

export function useCampaignOptimizations(campaignId: number) {
  return useQuery<CampaignOptimization[]>({
    queryKey: ['/api/campaigns', campaignId, 'optimizations'],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/optimizations`);
      return res.json();
    },
    enabled: !!campaignId,
  });
}

export interface OptimizeResult {
  success: boolean;
  campaignId: number;
  metrics: Record<string, number>;
  score: number;
  suggestionsGenerated: number;
  suggestions: CampaignOptimization[];
}

export function useOptimizeCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/optimize`);
      return res.json() as Promise<OptimizeResult>;
    },
    onSuccess: (_data, campaignId) => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns', campaignId, 'optimizations'] });
    },
  });
}

export function useMarkOptimizationImplemented() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ optimizationId, campaignId }: { optimizationId: number; campaignId: number }) => {
      const res = await apiRequest("PUT", `/api/optimizations/${optimizationId}/implement`, {});
      return res.json() as Promise<CampaignOptimization>;
    },
    onSuccess: (_data, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns', campaignId, 'optimizations'] });
    },
  });
}

// Campaign response trend (daily counts for the past 7 days)
export interface DailyResponseCount {
  date: string;   // ISO date string YYYY-MM-DD
  count: number;
}

export function useCampaignResponseTrend(campaignId: number) {
  return useQuery<DailyResponseCount[]>({
    queryKey: ['/api/campaigns', campaignId, 'response-trend'],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/response-trend`);
      return res.json();
    },
    enabled: !!campaignId,
  });
}

// Direct mail attribution hook
export interface MailAttributionData {
  totalSent: number;
  totalCostCents: number;
  attributedResponses: number;
  responseRate: number;
  costPerResponse: number | null;
  estimatedDeliveryDate: string | null;
  industryBenchmarkMin: number;
  industryBenchmarkMax: number;
}

export function useMailAttribution(campaignId: number) {
  return useQuery<MailAttributionData>({
    queryKey: ['/api/campaigns', campaignId, 'mail-attribution'],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/campaigns/${campaignId}/mail-attribution`);
      return res.json();
    },
    enabled: !!campaignId,
  });
}

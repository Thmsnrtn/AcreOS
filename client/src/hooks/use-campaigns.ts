import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
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
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/checklist-status"] });
    },
  });
}

export function useUpdateCampaign() {
  // Optimistic campaign update — pause/resume + name edits should feel
  // instant. Backed by useOptimisticUpdate (client/src/lib/optimistic-mutation.ts).
  return useOptimisticUpdate<{ id: number } & Partial<InsertCampaign>, Campaign>({
    mutationFn: async ({ id, ...data }) => {
      const res = await apiRequest("PUT", `/api/campaigns/${id}`, data);
      return res.json();
    },
    listKeys: [["/api/campaigns"]],
    detailKey: ({ id }) => ["/api/campaigns", id],
    getId: ({ id }) => id,
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
  // allow-no-invalidation: pure quote computation — the POST mutates nothing server-side
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
      }, { idempotent: true });
      return res.json() as Promise<SendDirectMailResponse>;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['/api/organization'] });
      // Campaign attribution + response-trend reads change immediately on
      // queue, plus mail consumes credits. Without these the campaign
      // detail page shows zero sent / no spent credits until refresh.
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns', variables.campaignId, 'mail-attribution'] });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns', variables.campaignId, 'response-trend'] });
      queryClient.invalidateQueries({ queryKey: ['/api/credits'] });
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
  // allow-no-invalidation: Lob address verification is a read-only lookup — nothing persisted
  return useMutation({
    mutationFn: async (address: { line1: string; line2?: string; city: string; state: string; zip: string }) => {
      const res = await apiRequest("POST", "/api/direct-mail/verify-address", address);
      return res.json() as Promise<VerifyAddressResult>;
    },
  });
}

export function useBulkVerifyAddresses() {
  // allow-no-invalidation: bulk verification only reads leads and returns results — nothing persisted
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
  // Optimistic flag — mark the suggestion as implemented in the cached
  // list immediately so the "Implement" button reflects done-state, and
  // roll back if the server rejects. listKey resolves per-call against
  // the campaign's optimizations cache.
  return useOptimisticUpdate<{ optimizationId: number; campaignId: number }, CampaignOptimization>({
    mutationFn: async ({ optimizationId }) => {
      const res = await apiRequest("PUT", `/api/optimizations/${optimizationId}/implement`, {});
      return res.json() as Promise<CampaignOptimization>;
    },
    listKeys: [({ campaignId }) => ['/api/campaigns', campaignId, 'optimizations']],
    getId: ({ optimizationId }) => optimizationId,
    buildPatch: () => ({ isImplemented: true }),
    successToast: false,
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
  /**
   * Null unless a benchmark with a real citation is registered server-side
   * (server/services/benchmarks.ts). It used to be two bare numbers — 1 and 3 —
   * rendered to the customer as "Industry benchmark: 1–3%" with nothing behind
   * them, and used to award an "above average" badge.
   */
  industryBenchmark: {
    value: number;
    rangeMin?: number;
    rangeMax?: number;
    unit: string;
    source: string;
    asOf: string;
  } | null;
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

// Test send hook — sends a single test email to the logged-in user
export function useTestSendCampaign() {
  // allow-no-invalidation: sends one test email to the logged-in user — no cached reads change
  return useMutation({
    mutationFn: async (campaignId: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaignId}/test-send`, undefined, { idempotent: true });
      return res.json() as Promise<{ success: boolean; to: string; result: any }>;
    },
  });
}

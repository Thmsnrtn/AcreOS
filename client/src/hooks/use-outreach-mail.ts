/**
 * React-query hooks for /outreach/mail. Centralized so the Compose tab,
 * In-Flight tab, and any future surface (Round 4 EDDM map / Results) share
 * a single source of truth for query keys + cache invalidation.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// ── Shared types (mirror server payloads) ───────────────────────────────────

export type PieceType = "postcard_4x6" | "postcard_6x9" | "letter_10" | "handwritten";
export type MailSpeed = "next_day" | "standard" | "batch_3d" | "batch_weekly" | "eddm_geo";

export interface AudienceFilter {
  leadListIds?: number[];
  savedViewIds?: number[];
  states?: string[];
  counties?: string[];
  acreageMin?: number;
  acreageMax?: number;
}

export interface ProviderQuoteAlt {
  provider: string;
  costPerPieceCents: number;
  deliveryEtaDays: number;
  minVolume: number;
  meetsConstraints: boolean;
  reasonIfNot?: string;
}

export interface QuoteResponse {
  pieceCount: number;
  perPieceCents: number;
  totalCents: number;
  provider: string;
  savedVsLobCents: number;
  deliveryEtaDays: number | null;
  alternatives: ProviderQuoteAlt[];
  recentlyMailedCount: number;
  recentlyMailedFraction: number;
}

export interface QueueResponse {
  shipmentId: number;
  leavesAt: string;
  holdWindowMinutes: number;
  quote: QuoteResponse;
}

export interface ShipmentSummary {
  id: number;
  status: string;
  pieceType: PieceType;
  speed: MailSpeed;
  provider: string | null;
  pieceCount: number;
  perPieceCents: number;
  totalCents: number;
  savedVsLobCents: number;
  deliveryEtaDays: number | null;
  label: string | null;
  queuedAt: string;
  leavesAt: string;
  sentAt: string | null;
  cancelledAt: string | null;
  stageCounts: Record<string, number>;
}

export interface MailShipmentPieceRow {
  id: number;
  shipmentId: number;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  status: string;
  printedAt: string | null;
  inTransitAt: string | null;
  expectedDeliveryAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  qrScanCount: number;
  inboundCallCount: number;
}

// ── Query keys ──────────────────────────────────────────────────────────────

export const outreachMailKeys = {
  all: ["outreach-mail"] as const,
  shipments: () => [...outreachMailKeys.all, "shipments"] as const,
  pieces: (shipmentId: number) => [...outreachMailKeys.all, "pieces", shipmentId] as const,
};

// ── Quote (live cost preview) ───────────────────────────────────────────────

interface QuoteInput {
  audienceFilter: AudienceFilter;
  pieceType: PieceType;
  speed: MailSpeed;
}

export function useMailQuote(input: QuoteInput | null) {
  return useQuery<QuoteResponse>({
    queryKey: [...outreachMailKeys.all, "quote", input] as const,
    enabled: input !== null,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/outreach/mail/quote", input);
      return res.json();
    },
    staleTime: 30_000,
  });
}

// ── Queue (create shipment in the 30-min hold window) ───────────────────────

interface QueueInput extends QuoteInput {
  templateId?: number;
  copy?: string;
  label?: string;
}

export function useQueueMailShipment() {
  const qc = useQueryClient();
  return useMutation<QueueResponse, Error, QueueInput>({
    mutationFn: async (input) => {
      const res = await apiRequest("POST", "/api/outreach/mail/queue", input, {
        idempotent: true,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outreachMailKeys.shipments() });
    },
  });
}

// ── Cancel (within 30-min hold window) ──────────────────────────────────────

export function useCancelMailShipment() {
  const qc = useQueryClient();
  return useMutation<
    { shipmentId: number; status: string; cancelledAt: string },
    Error,
    { shipmentId: number; reason?: string }
  >({
    mutationFn: async ({ shipmentId, reason }) => {
      const res = await apiRequest("POST", `/api/outreach/mail/cancel/${shipmentId}`, { reason }, { idempotent: true });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outreachMailKeys.shipments() });
    },
  });
}

// ── In-flight list ──────────────────────────────────────────────────────────

export function useInFlightShipments() {
  return useQuery<{ shipments: ShipmentSummary[] }>({
    queryKey: outreachMailKeys.shipments(),
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/outreach/mail/shipments");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

// ── EDDM map (Pillar 3 Tab 4) ───────────────────────────────────────────────

export interface EddmRouteFeature {
  type: "Feature";
  id: string;
  properties: {
    routeId: string;
    householdCount: number;
    county: string;
    state: string;
    synthetic: true;
  };
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

export interface EddmRoutesResponse {
  type: "FeatureCollection";
  features: EddmRouteFeature[];
  synthetic: boolean;
  source: string;
  notice: string;
}

export interface EddmParcelFeature {
  type: "Feature";
  id: number;
  properties: {
    id: number;
    apn: string;
    acres: number | null;
    state: string;
    county: string;
  };
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface EddmParcelsResponse {
  type: "FeatureCollection";
  features: EddmParcelFeature[];
  total: number;
}

export interface EddmParcelFilters {
  acreageMin?: number;
  acreageMax?: number;
}

export function useEddmRoutes(county: string | null, state: string | null) {
  return useQuery<EddmRoutesResponse>({
    queryKey: [...outreachMailKeys.all, "eddm-routes", state, county] as const,
    enabled: !!county && !!state,
    queryFn: async () => {
      const params = new URLSearchParams({ county: county!, state: state! });
      const res = await apiRequest("GET", `/api/outreach/mail/eddm/routes?${params}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

export function useEddmParcels(
  bbox: [number, number, number, number] | null,
  filters: EddmParcelFilters = {},
) {
  return useQuery<EddmParcelsResponse>({
    queryKey: [...outreachMailKeys.all, "eddm-parcels", bbox, filters] as const,
    enabled: bbox !== null,
    queryFn: async () => {
      const params = new URLSearchParams({ bbox: bbox!.join(",") });
      if (filters.acreageMin !== undefined) params.set("acreageMin", String(filters.acreageMin));
      if (filters.acreageMax !== undefined) params.set("acreageMax", String(filters.acreageMax));
      const res = await apiRequest("GET", `/api/outreach/mail/eddm/parcels?${params}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

interface EddmQueueInput {
  routeIds: string[];
  pieceType: "postcard_4x6" | "postcard_6x9";
  copy?: string;
  templateId?: number;
  label?: string;
  householdCount: number;
}

export interface EddmQueueResponse {
  shipmentId: number;
  leavesAt: string;
  holdWindowMinutes: number;
  quote: {
    pieceCount: number;
    perPieceCents: number;
    totalCents: number;
    provider: string;
    savedVsLobCents: number;
    deliveryEtaDays: number;
    routeCount: number;
  };
}

export function useEddmQueue() {
  const qc = useQueryClient();
  return useMutation<EddmQueueResponse, Error, EddmQueueInput>({
    mutationFn: async (input) => {
      const res = await apiRequest("POST", "/api/outreach/mail/eddm/queue", input, {
        idempotent: true,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outreachMailKeys.shipments() });
    },
  });
}

// ── Per-shipment pieces (expandable detail) ────────────────────────────────

export function useShipmentPieces(shipmentId: number | null) {
  return useQuery<{ pieces: MailShipmentPieceRow[]; total: number; limit: number; offset: number }>({
    queryKey: shipmentId ? outreachMailKeys.pieces(shipmentId) : ["outreach-mail", "pieces", "disabled"],
    enabled: shipmentId !== null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/outreach/mail/shipment/${shipmentId}/pieces`);
      return res.json();
    },
  });
}

// ── Results tab hooks (Pillar 3 Tab 3) ──────────────────────────────────────

export interface FunnelResponse {
  sent: number;
  delivered: number;
  qrScans: number;
  callsReceived: number;
  callsAnswered: number;
  dealsOpened: number;
  dealsClosed: number;
  costCentsTotal: number;
  costPerSentCents: number;
  costPerDeliveredCents: number;
  costPerQrScanCents: number;
  costPerCallCents: number;
  costPerDealCents: number;
}

export function useResultsFunnel(shipmentId: number | null) {
  return useQuery<FunnelResponse>({
    queryKey: ["outreach-mail", "results", "funnel", shipmentId] as const,
    enabled: shipmentId !== null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/outreach/mail/results/funnel/${shipmentId}`);
      return res.json();
    },
  });
}

export interface ResponseTimelinePoint {
  day: string;
  qrScans: number;
  calls: number;
  cumulativeQr: number;
  cumulativeCalls: number;
}

export function useResponseTimeline(shipmentId: number | null) {
  return useQuery<ResponseTimelinePoint[]>({
    queryKey: ["outreach-mail", "results", "timeline", shipmentId] as const,
    enabled: shipmentId !== null,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/outreach/mail/results/response-timeline/${shipmentId}`,
      );
      return res.json();
    },
  });
}

export interface TemplateCompareRow {
  templateId: number | null;
  name: string;
  shipments: number;
  totalSent: number;
  totalResponses: number;
  responseRatePct: number;
}

export function useTemplateCompare(days = 90) {
  return useQuery<TemplateCompareRow[]>({
    queryKey: ["outreach-mail", "results", "compare", days] as const,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/outreach/mail/results/compare-templates?days=${days}`,
      );
      return res.json();
    },
  });
}

export interface CohortRow {
  month: string;
  shipments: number;
  sent: number;
  delivered: number;
  qrScans: number;
  calls: number;
  spendCents: number;
}

export function useCohortByMonth(days = 180) {
  return useQuery<CohortRow[]>({
    queryKey: ["outreach-mail", "results", "cohort", days] as const,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/outreach/mail/results/cohort-by-month?days=${days}`,
      );
      return res.json();
    },
  });
}

// ── Mail Credits tab hooks (Pillar 3 Tab 5) ────────────────────────────────

export interface CreditSummary {
  tier: string;
  creditPoolMonthly: number;
  creditPoolUsedThisMonth: number;
  creditPoolRemainingThisMonth: number;
  daysIntoMonth: number;
  daysRemainingInMonth: number;
  burnRateCreditsPerDay: number;
  projectedRunoutDate: string | null;
}

export function useCreditSummary() {
  return useQuery<CreditSummary>({
    queryKey: ["outreach-mail", "credits", "summary"] as const,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/outreach/mail/credits/summary");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export interface CreditHistoryItem {
  id: number;
  dateIso: string;
  action: string;
  category: string;
  cents: number;
  providerName: string | null;
  pieceProviderId: string | null;
  leadName: string | null;
}

export function useCreditHistory(opts: { days?: number; category?: string | null } = {}) {
  const { days = 30, category = null } = opts;
  return useQuery<{ items: CreditHistoryItem[]; limit: number; offset: number }>({
    queryKey: ["outreach-mail", "credits", "history", days, category] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) });
      if (category) params.set("category", category);
      const res = await apiRequest(
        "GET",
        `/api/outreach/mail/credits/history?${params.toString()}`,
      );
      return res.json();
    },
  });
}

export function useRechargeCredits() {
  return useMutation<{ checkoutUrl: string }, Error, { packCents: number }>({
    mutationFn: async ({ packCents }) => {
      const res = await apiRequest(
        "POST",
        "/api/outreach/mail/credits/recharge",
        { packCents },
        { idempotent: true },
      );
      return res.json();
    },
  });
}

export interface CreditExamplesResponse {
  poolSize: number;
  examples: Array<{
    label: string;
    action: string;
    quantity: number;
    creditsConsumed: number;
  }>;
}

export function useCreditExamples() {
  return useQuery<CreditExamplesResponse>({
    queryKey: ["outreach-mail", "credits", "examples"] as const,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/outreach/mail/credits/examples");
      return res.json();
    },
  });
}

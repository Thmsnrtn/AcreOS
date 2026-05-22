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
      const res = await apiRequest("POST", `/api/outreach/mail/cancel/${shipmentId}`, { reason });
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

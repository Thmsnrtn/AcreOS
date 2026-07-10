/**
 * W6.2b — the deal track's REAL sources.
 *
 * The /api/deals/:id/track endpoint unions activity_events across the deal,
 * its property, and the seller lead — but the tables where the actual
 * lead → mail → response → offer story lives (offers, seller_communications,
 * campaign_responses, mail_shipment_pieces) never wrote activity_events, so
 * the "single track" was mostly stage changes and notes. This module maps
 * those source tables into timeline events AT QUERY TIME — no backfill, no
 * dual-write to keep in sync, no new persistence. The mappers are pure and
 * exported for direct testing; `getStitchedSourceEvents` runs the org-scoped
 * queries and applies them.
 *
 * Synthetic events carry STRING ids (`offer-12-sent`) so they can never
 * collide with the serial ids of real activity_events rows in the endpoint's
 * dedup set.
 */

import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../db";
import {
  offers,
  sellerCommunications,
  campaignResponses,
  mailShipmentPieces,
  type Offer,
  type SellerCommunication,
  type CampaignResponse,
  type MailShipmentPiece,
} from "@shared/schema";
import { logger } from "../utils/logger";

/** ActivityEvent-shaped, but with a string id (see module header). */
export interface TrackEvent {
  id: string;
  organizationId: number;
  entityType: "lead" | "property" | "deal";
  entityId: number;
  eventType: string;
  description: string;
  metadata: Record<string, unknown> | null;
  userId: string | null;
  campaignId: number | null;
  eventDate: Date;
  createdAt: Date | null;
}

/** Cap per source table — a deal track is a narrative, not an export. */
const PER_SOURCE_LIMIT = 100;

function money(value: string | number | null | undefined): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function baseEvent(
  over: Pick<TrackEvent, "id" | "organizationId" | "entityType" | "entityId" | "eventType" | "description" | "eventDate"> &
    Partial<TrackEvent>,
): TrackEvent {
  return { metadata: null, userId: null, campaignId: null, createdAt: null, ...over };
}

/**
 * An offer becomes up to three track moments: sent, viewed, responded.
 * Draft/approved offers (no sentAt) contribute nothing — the track shows
 * what HAPPENED, not what's queued.
 */
export function offerToTrackEvents(offer: Offer): TrackEvent[] {
  const events: TrackEvent[] = [];
  const entityId = offer.leadId ?? offer.propertyId ?? 0;
  const entityType = offer.leadId ? ("lead" as const) : ("property" as const);
  const common = { organizationId: offer.organizationId, entityType, entityId };

  if (offer.sentAt) {
    const amount = money(offer.cashOffer);
    events.push(
      baseEvent({
        ...common,
        id: `offer-${offer.id}-sent`,
        eventType: "offer_sent",
        description: amount ? `Offer sent — ${amount} cash` : "Offer sent",
        eventDate: new Date(offer.sentAt),
        metadata: { offerId: offer.id, status: offer.status },
      }),
    );
  }
  if (offer.viewedAt) {
    events.push(
      baseEvent({
        ...common,
        id: `offer-${offer.id}-viewed`,
        eventType: "offer_viewed",
        description: "Seller viewed the offer",
        eventDate: new Date(offer.viewedAt),
        metadata: { offerId: offer.id },
      }),
    );
  }
  if (offer.respondedAt) {
    const counter = money(offer.counterOffer);
    const description =
      offer.status === "accepted"
        ? "Offer accepted"
        : offer.status === "rejected"
          ? "Offer declined"
          : offer.status === "countered"
            ? counter
              ? `Seller countered at ${counter}`
              : "Seller countered"
            : "Seller responded to the offer";
    events.push(
      baseEvent({
        ...common,
        id: `offer-${offer.id}-response`,
        eventType: "offer_response",
        description,
        eventDate: new Date(offer.respondedAt),
        metadata: {
          offerId: offer.id,
          status: offer.status,
          ...(offer.sellerNotes ? { notes: offer.sellerNotes } : {}),
        },
      }),
    );
  }
  return events;
}

/**
 * Only INBOUND seller communications join the track — outbound sends are
 * already represented by their own source rows (mail pieces, offers) and
 * the response is the moment the story turns.
 */
export function inboundCommToTrackEvent(comm: SellerCommunication): TrackEvent | null {
  if (comm.direction !== "inbound") return null;
  const snippet = comm.subject || (comm.content ? comm.content.slice(0, 80) : "");
  return baseEvent({
    id: `comm-${comm.id}`,
    organizationId: comm.organizationId,
    entityType: "lead",
    entityId: comm.leadId,
    eventType: "response_received",
    description: snippet ? `Inbound ${comm.channel}: ${snippet}` : `Inbound ${comm.channel}`,
    eventDate: new Date(comm.createdAt ?? Date.now()),
    metadata: {
      channel: comm.channel,
      ...(comm.sentiment ? { sentiment: comm.sentiment } : {}),
      ...(comm.callOutcome ? { callOutcome: comm.callOutcome } : {}),
      ...(comm.callDuration ? { callDuration: comm.callDuration } : {}),
    },
  });
}

export function campaignResponseToTrackEvent(response: CampaignResponse): TrackEvent | null {
  if (!response.leadId) return null;
  return baseEvent({
    id: `campresp-${response.id}`,
    organizationId: response.organizationId,
    entityType: "lead",
    entityId: response.leadId,
    eventType: "response_received",
    description: `Campaign response via ${response.channel}`,
    eventDate: new Date(response.responseDate ?? response.createdAt ?? Date.now()),
    campaignId: response.campaignId ?? null,
    metadata: {
      channel: response.channel,
      ...(response.content ? { notes: response.content.slice(0, 160) } : {}),
    },
  });
}

/**
 * A mail piece becomes `mail_sent` when it left (printedAt, else created)
 * and `mail_delivered` when USPS confirmed delivery — the two existing
 * registry types, so the timeline renders them like any logged mail event.
 */
export function mailPieceToTrackEvents(piece: MailShipmentPiece): TrackEvent[] {
  if (!piece.leadId) return [];
  const events: TrackEvent[] = [];
  const common = {
    organizationId: piece.organizationId,
    entityType: "lead" as const,
    entityId: piece.leadId,
  };
  const sentAt = piece.printedAt ?? piece.createdAt;
  if (sentAt && piece.status !== "pending" && piece.status !== "failed") {
    events.push(
      baseEvent({
        ...common,
        id: `mailpiece-${piece.id}-sent`,
        eventType: "mail_sent",
        description: `Direct mail sent to ${piece.recipientName}`,
        eventDate: new Date(sentAt),
        metadata: { pieceStatus: piece.status, city: piece.city, state: piece.state },
      }),
    );
  }
  if (piece.deliveredAt) {
    events.push(
      baseEvent({
        ...common,
        id: `mailpiece-${piece.id}-delivered`,
        eventType: "mail_delivered",
        description: `Direct mail delivered to ${piece.recipientName}`,
        eventDate: new Date(piece.deliveredAt),
        metadata: { city: piece.city, state: piece.state },
      }),
    );
  }
  return events;
}

/**
 * Fetch + map every source table for one deal's track. Org-scoped on every
 * query. Best-effort per source: one broken table costs its own events,
 * never the whole track (mirrors the endpoint's partial-track stance).
 */
export async function getStitchedSourceEvents(
  organizationId: number,
  refs: { leadId?: number | null; propertyId?: number | null },
): Promise<TrackEvent[]> {
  const { leadId, propertyId } = refs;
  const events: TrackEvent[] = [];

  const sources: Array<{ name: string; run: () => Promise<TrackEvent[]> }> = [
    {
      name: "offers",
      run: async () => {
        if (!leadId && !propertyId) return [];
        const clauses = [
          ...(leadId ? [eq(offers.leadId, leadId)] : []),
          ...(propertyId ? [eq(offers.propertyId, propertyId)] : []),
        ];
        const rows = await db
          .select()
          .from(offers)
          .where(and(eq(offers.organizationId, organizationId), or(...clauses)))
          .orderBy(desc(offers.createdAt))
          .limit(PER_SOURCE_LIMIT);
        return rows.flatMap(offerToTrackEvents);
      },
    },
    {
      name: "seller_communications",
      run: async () => {
        if (!leadId) return [];
        const rows = await db
          .select()
          .from(sellerCommunications)
          .where(
            and(
              eq(sellerCommunications.organizationId, organizationId),
              eq(sellerCommunications.leadId, leadId),
              eq(sellerCommunications.direction, "inbound"),
            ),
          )
          .orderBy(desc(sellerCommunications.createdAt))
          .limit(PER_SOURCE_LIMIT);
        return rows.map(inboundCommToTrackEvent).filter((e): e is TrackEvent => e !== null);
      },
    },
    {
      name: "campaign_responses",
      run: async () => {
        if (!leadId) return [];
        const rows = await db
          .select()
          .from(campaignResponses)
          .where(
            and(
              eq(campaignResponses.organizationId, organizationId),
              eq(campaignResponses.leadId, leadId),
            ),
          )
          .orderBy(desc(campaignResponses.responseDate))
          .limit(PER_SOURCE_LIMIT);
        return rows
          .map(campaignResponseToTrackEvent)
          .filter((e): e is TrackEvent => e !== null);
      },
    },
    {
      name: "mail_shipment_pieces",
      run: async () => {
        if (!leadId) return [];
        const rows = await db
          .select()
          .from(mailShipmentPieces)
          .where(
            and(
              eq(mailShipmentPieces.organizationId, organizationId),
              eq(mailShipmentPieces.leadId, leadId),
            ),
          )
          .orderBy(desc(mailShipmentPieces.createdAt))
          .limit(PER_SOURCE_LIMIT);
        return rows.flatMap(mailPieceToTrackEvents);
      },
    },
  ];

  for (const source of sources) {
    try {
      events.push(...(await source.run()));
    } catch (err) {
      logger.warn(`[deal-track] ${source.name} source failed — track continues without it`, {
        metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return events;
}

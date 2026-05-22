/**
 * Pillar 3 — Customer-facing /outreach/mail endpoints.
 *
 * Scope of THIS file (Round 3): Compose + In-Flight tabs only. The EDDM
 * map / Results / Mail-Credits tabs ship in Round 4.
 *
 * The router does the heavy cost-decision work — these endpoints are thin
 * wrappers that:
 *   - resolve an audience filter into a recipient set,
 *   - call MailRouter.quote() to surface live $/piece + savedVsLob,
 *   - persist a queued shipment + per-piece rows for the 30-min hold window,
 *   - serve the In-Flight tracker.
 *
 * Worker that actually fires after leavesAt is out of scope here — it lives
 * in the existing outbox/scheduled job process. The shipment row is the
 * contract; the worker reads it.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { db } from "./db";
import {
  leads,
  mailShipments,
  mailShipmentPieces,
  marketingLists,
  type MailShipmentRow,
} from "@shared/schema";
import {
  mailRouter,
  type MailPiece,
  type MailShipmentSpeed,
  type PieceType,
  type ProviderQuote,
} from "./services/mail/router";

// ── Constants ───────────────────────────────────────────────────────────────

const HOLD_WINDOW_MINUTES = 30;
const PIECE_TYPES = ["postcard_4x6", "postcard_6x9", "letter_10", "handwritten"] as const;
const SPEEDS = ["next_day", "standard", "batch_3d", "batch_weekly", "eddm_geo"] as const;

// Recent-mail dedupe window (matches the composer warning copy).
const DEDUPE_LOOKBACK_DAYS = 30;
const DEDUPE_THRESHOLD = 0.2; // >20% — pure UX threshold for the warn modal.

// ── Schemas ─────────────────────────────────────────────────────────────────

const audienceFilterSchema = z.object({
  leadListIds: z.array(z.number().int().positive()).optional(),
  savedViewIds: z.array(z.number().int().positive()).optional(),
  states: z.array(z.string().length(2)).optional(),
  counties: z.array(z.string()).optional(),
  acreageMin: z.number().nonnegative().optional(),
  acreageMax: z.number().nonnegative().optional(),
});

const quoteSchema = z.object({
  audienceFilter: audienceFilterSchema,
  pieceType: z.enum(PIECE_TYPES),
  speed: z.enum(SPEEDS),
});

const queueSchema = z.object({
  audienceFilter: audienceFilterSchema,
  pieceType: z.enum(PIECE_TYPES),
  speed: z.enum(SPEEDS),
  templateId: z.number().int().positive().optional(),
  copy: z.string().max(8000).optional(),
  label: z.string().max(200).optional(),
});

// ── Audience resolver ───────────────────────────────────────────────────────

interface Recipient {
  leadId: number;
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  lastContactedAt: Date | null;
}

/**
 * Resolves the audience filter to a deduped recipient set. Today this is a
 * simple intersection over the leads table; saved-views adapter is stubbed
 * (returns the source list unchanged) because the saved_views surface
 * doesn't yet expose a programmatic resolver. EDDM-only audiences bypass
 * this entirely — that path lands in Round 4.
 */
async function resolveAudience(
  organizationId: number,
  filter: z.infer<typeof audienceFilterSchema>,
): Promise<Recipient[]> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    sql`${leads.deletedAt} IS NULL`,
    sql`${leads.address} IS NOT NULL`,
    sql`${leads.city} IS NOT NULL`,
    sql`${leads.state} IS NOT NULL`,
    sql`${leads.zip} IS NOT NULL`,
  ];

  if (filter.states && filter.states.length > 0) {
    conditions.push(inArray(leads.state, filter.states));
  }

  // marketingLists -> leads: we mirror the marketing list's stored filter
  // (states / counties) onto the leads scan. This is the minimum to make
  // the composer feel live; a fuller cross-table join lands when the
  // mail-list ingest pipeline ships its members table.
  if (filter.leadListIds && filter.leadListIds.length > 0) {
    const lists = await db
      .select()
      .from(marketingLists)
      .where(
        and(
          eq(marketingLists.organizationId, organizationId),
          inArray(marketingLists.id, filter.leadListIds),
        ),
      );
    const states = new Set<string>();
    for (const l of lists) {
      for (const s of l.filters?.states ?? []) states.add(s);
    }
    if (states.size > 0) {
      conditions.push(inArray(leads.state, Array.from(states)));
    }
  }

  const rows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      address: leads.address,
      city: leads.city,
      state: leads.state,
      zip: leads.zip,
      lastContactedAt: leads.lastContactedAt,
    })
    .from(leads)
    .where(and(...conditions))
    .limit(50_000);

  return rows.map((r) => ({
    leadId: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    addressLine1: r.address!,
    city: r.city!,
    state: r.state!,
    zip: r.zip!,
    lastContactedAt: r.lastContactedAt,
  }));
}

function recipientsToMailPieces(
  recipients: Recipient[],
  pieceType: PieceType,
): MailPiece[] {
  return recipients.map((r) => ({
    pieceType,
    recipient: {
      firstName: r.firstName,
      lastName: r.lastName,
      address1: r.addressLine1,
      city: r.city,
      state: r.state,
      zip: r.zip,
    },
  }));
}

// ── Quote helper (no shipment created) ──────────────────────────────────────

interface QuotePayload {
  pieceCount: number;
  perPieceCents: number;
  totalCents: number;
  provider: string;
  savedVsLobCents: number;
  deliveryEtaDays: number | null;
  alternatives: ProviderQuote[];
  recentlyMailedCount: number;
  recentlyMailedFraction: number;
}

async function buildQuote(
  organizationId: number,
  filter: z.infer<typeof audienceFilterSchema>,
  pieceType: PieceType,
  speed: MailShipmentSpeed,
): Promise<QuotePayload> {
  const recipients = await resolveAudience(organizationId, filter);
  const pieces = recipientsToMailPieces(recipients, pieceType);

  // Recent-mail dedupe warn signal (UX-only — caller decides to warn).
  const cutoff = new Date(Date.now() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const recentlyMailedCount = recipients.filter(
    (r) => r.lastContactedAt && r.lastContactedAt >= cutoff,
  ).length;
  const recentlyMailedFraction = recipients.length > 0 ? recentlyMailedCount / recipients.length : 0;

  if (pieces.length === 0) {
    return {
      pieceCount: 0,
      perPieceCents: 0,
      totalCents: 0,
      provider: "—",
      savedVsLobCents: 0,
      deliveryEtaDays: null,
      alternatives: [],
      recentlyMailedCount,
      recentlyMailedFraction,
    };
  }

  // Ask the MailRouter for quotes (no send). The router silently skips
  // unconfigured providers so a fresh dev env without Lob keys returns [].
  let quotes: ProviderQuote[] = [];
  try {
    quotes = await mailRouter.quote({
      customerId: organizationId,
      organizationId,
      pieces,
      speed,
      personalizationRequired: false,
    });
  } catch (err) {
    logger.warn("[outreach-mail] mailRouter.quote failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  // Fall back to a hardcoded retail estimate (matches the Lob adapter's
  // LOB_COSTS table) so the composer can still render meaningful numbers
  // when no provider is configured locally. Production always has Lob.
  const FALLBACK_PER_PIECE: Record<PieceType, number> = {
    postcard_4x6: 75,
    postcard_6x9: 95,
    letter_10: 120,
    handwritten: 350,
  };
  const FALLBACK_ETA: Record<MailShipmentSpeed, number> = {
    next_day: 1,
    standard: 5,
    batch_3d: 3,
    batch_weekly: 7,
    eddm_geo: 10,
  };

  const viable = quotes.filter((q) => q.meetsConstraints);
  const cheapest = viable.sort((a, b) => a.costPerPieceCents - b.costPerPieceCents)[0];
  const lobQuote = quotes.find((q) => q.provider === "lob");

  const perPieceCents = cheapest?.costPerPieceCents ?? FALLBACK_PER_PIECE[pieceType];
  const deliveryEtaDays = cheapest?.deliveryEtaDays ?? FALLBACK_ETA[speed];
  const provider = cheapest?.provider ?? "lob";
  const totalCents = perPieceCents * pieces.length;
  const lobBaselineCents =
    (lobQuote?.costPerPieceCents ?? FALLBACK_PER_PIECE[pieceType]) * pieces.length;
  const savedVsLobCents = Math.max(0, lobBaselineCents - totalCents);

  return {
    pieceCount: pieces.length,
    perPieceCents,
    totalCents,
    provider,
    savedVsLobCents,
    deliveryEtaDays,
    alternatives: viable.filter((q) => q.provider !== provider),
    recentlyMailedCount,
    recentlyMailedFraction,
  };
}

// ── Route registration ──────────────────────────────────────────────────────

export function registerOutreachMailRoutes(app: Express): void {
  // ── POST /api/outreach/mail/quote ────────────────────────────────────────
  app.post(
    "/api/outreach/mail/quote",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = quoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }

      try {
        const quote = await buildQuote(
          getOrganizationId(req),
          parsed.data.audienceFilter,
          parsed.data.pieceType,
          parsed.data.speed,
        );
        res.json(quote);
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/outreach/mail/queue ────────────────────────────────────────
  app.post(
    "/api/outreach/mail/queue",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = queueSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }

      const org = getOrganization(req);
      const userId = getUserId(req);
      const { audienceFilter, pieceType, speed, templateId, copy, label } = parsed.data;

      try {
        const recipients = await resolveAudience(org.id, audienceFilter);
        if (recipients.length === 0) {
          return Errors.badRequest(res, "No recipients match this audience filter");
        }

        const quote = await buildQuote(org.id, audienceFilter, pieceType, speed);

        const leavesAt = new Date(Date.now() + HOLD_WINDOW_MINUTES * 60 * 1000);

        // Transaction: insert shipment header + per-piece rows.
        const shipmentId = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(mailShipments)
            .values({
              organizationId: org.id,
              createdByUserId: userId,
              status: "queued",
              pieceType,
              speed,
              provider: quote.provider,
              pieceCount: quote.pieceCount,
              perPieceCents: quote.perPieceCents,
              totalCents: quote.totalCents,
              savedVsLobCents: quote.savedVsLobCents,
              deliveryEtaDays: quote.deliveryEtaDays,
              label: label ?? null,
              templateId: templateId ?? null,
              copySnapshot: copy ?? null,
              audienceFilter,
              leavesAt,
            })
            .returning({ id: mailShipments.id });

          await tx.insert(mailShipmentPieces).values(
            recipients.map((r) => ({
              shipmentId: row.id,
              organizationId: org.id,
              leadId: r.leadId,
              recipientName: `${r.firstName} ${r.lastName}`.trim(),
              addressLine1: r.addressLine1,
              city: r.city,
              state: r.state,
              zip: r.zip,
              status: "pending" as const,
            })),
          );

          return row.id;
        });

        res.status(201).json({
          shipmentId,
          leavesAt: leavesAt.toISOString(),
          holdWindowMinutes: HOLD_WINDOW_MINUTES,
          quote,
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/outreach/mail/cancel/:shipmentId ───────────────────────────
  app.post(
    "/api/outreach/mail/cancel/:shipmentId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const idParam = Number(req.params.shipmentId);
      if (!Number.isFinite(idParam) || idParam <= 0) {
        return Errors.badRequest(res, "Invalid shipment id");
      }
      const orgId = getOrganizationId(req);

      try {
        const [existing] = await db
          .select()
          .from(mailShipments)
          .where(and(eq(mailShipments.id, idParam), eq(mailShipments.organizationId, orgId)))
          .limit(1);
        if (!existing) return Errors.notFound(res, "Mail shipment");

        if (existing.status !== "queued") {
          return Errors.badRequest(res, `Cannot cancel — shipment is ${existing.status}`);
        }
        if (existing.leavesAt.getTime() <= Date.now()) {
          return Errors.badRequest(res, "Hold window has passed; shipment already in flight");
        }

        const [updated] = await db
          .update(mailShipments)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancellationReason: typeof req.body?.reason === "string" ? req.body.reason : "user_cancelled",
          })
          .where(eq(mailShipments.id, idParam))
          .returning();

        res.json({ shipmentId: updated.id, status: updated.status, cancelledAt: updated.cancelledAt });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/outreach/mail/shipments ─────────────────────────────────────
  app.get(
    "/api/outreach/mail/shipments",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = getOrganizationId(req);

      try {
        // "Active" = anything that isn't fully delivered or cancelled.
        const inFlightStatuses = ["queued", "sending", "sent", "partial_failed"];

        const shipments = await db
          .select()
          .from(mailShipments)
          .where(
            and(
              eq(mailShipments.organizationId, orgId),
              inArray(mailShipments.status, inFlightStatuses),
            ),
          )
          .orderBy(desc(mailShipments.queuedAt))
          .limit(50);

        if (shipments.length === 0) {
          return res.json({ shipments: [] });
        }

        const ids = shipments.map((s) => s.id);
        const counts = await db
          .select({
            shipmentId: mailShipmentPieces.shipmentId,
            status: mailShipmentPieces.status,
            n: sql<number>`count(*)::int`,
          })
          .from(mailShipmentPieces)
          .where(inArray(mailShipmentPieces.shipmentId, ids))
          .groupBy(mailShipmentPieces.shipmentId, mailShipmentPieces.status);

        const byShipment = new Map<number, Record<string, number>>();
        for (const c of counts) {
          const existing = byShipment.get(c.shipmentId) ?? {};
          existing[c.status] = c.n;
          byShipment.set(c.shipmentId, existing);
        }

        res.json({
          shipments: shipments.map((s) => ({
            ...serializeShipment(s),
            stageCounts: byShipment.get(s.id) ?? {},
          })),
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/outreach/mail/shipment/:id/pieces ───────────────────────────
  app.get(
    "/api/outreach/mail/shipment/:id/pieces",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const idParam = Number(req.params.id);
      if (!Number.isFinite(idParam) || idParam <= 0) {
        return Errors.badRequest(res, "Invalid shipment id");
      }
      const orgId = getOrganizationId(req);
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

      try {
        // Guard org-scope at the parent before pulling pieces.
        const [parent] = await db
          .select({ id: mailShipments.id })
          .from(mailShipments)
          .where(and(eq(mailShipments.id, idParam), eq(mailShipments.organizationId, orgId)))
          .limit(1);
        if (!parent) return Errors.notFound(res, "Mail shipment");

        const pieces = await db
          .select()
          .from(mailShipmentPieces)
          .where(
            and(
              eq(mailShipmentPieces.shipmentId, idParam),
              eq(mailShipmentPieces.organizationId, orgId),
            ),
          )
          .orderBy(desc(mailShipmentPieces.createdAt))
          .limit(limit)
          .offset(offset);

        const [{ total } = { total: 0 }] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(mailShipmentPieces)
          .where(
            and(
              eq(mailShipmentPieces.shipmentId, idParam),
              eq(mailShipmentPieces.organizationId, orgId),
            ),
          );

        res.json({ pieces, total, limit, offset });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );
}

function serializeShipment(s: MailShipmentRow) {
  return {
    id: s.id,
    status: s.status,
    pieceType: s.pieceType,
    speed: s.speed,
    provider: s.provider,
    pieceCount: s.pieceCount,
    perPieceCents: s.perPieceCents,
    totalCents: s.totalCents,
    savedVsLobCents: s.savedVsLobCents,
    deliveryEtaDays: s.deliveryEtaDays,
    label: s.label,
    queuedAt: s.queuedAt,
    leavesAt: s.leavesAt,
    sentAt: s.sentAt,
    cancelledAt: s.cancelledAt,
  };
}

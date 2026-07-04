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
  deals,
  financialLedger,
  leads,
  mailShipments,
  mailShipmentPieces,
  marketingLists,
  type MailShipmentRow,
} from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "./services/usageLimits";
import { creditExamples, type CreditAction } from "@shared/billing/credit-weights";
import { poolDebit, refundPoolDebit, poolRefusalDetails } from "./services/creditPool";
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

// W2.1 — the activation wedge. The free tier gets a small LIFETIME mail
// allowance so "send your first mailer" is actually reachable before paying
// (TTFM was structurally impossible: the checklist hid the step and the
// upgrade panel showed an ✗). Five pieces ≈ one tiny test batch — enough to
// feel the magic moment (a seller writing back), not enough to run a
// business on. Lifetime, not monthly: counted from non-cancelled
// mail_shipments rows, so a cancel within the hold window gives the pieces
// back. All witnessed-send / live-send interlocks are untouched — this only
// widens WHO may queue, never HOW mail leaves the building.
export const FREE_TIER_LIFETIME_PIECES = 5;

/** Lifetime pieces a free org has already committed (cancelled excluded). */
async function freeTierPiecesUsed(organizationId: number): Promise<number> {
  const [agg] = await db
    .select({
      used: sql<number>`coalesce(sum(${mailShipments.pieceCount}), 0)::int`,
    })
    .from(mailShipments)
    .where(
      and(
        eq(mailShipments.organizationId, organizationId),
        sql`${mailShipments.status} != 'cancelled'`,
      ),
    );
  return agg?.used ?? 0;
}
const SPEEDS = ["next_day", "standard", "batch_3d", "batch_weekly", "eddm_geo"] as const;

// Recent-mail dedupe window (matches the composer warning copy).
const DEDUPE_LOOKBACK_DAYS = 30;
const DEDUPE_THRESHOLD = 0.2; // >20% — pure UX threshold for the warn modal.

// Lens 3 — provider × piece-type → credit-weight bucket. Falls back to the
// cheapest weight in each family so an unrecognised provider never over-bills.
function mailPoolActionFor(provider: string, pieceType: string): CreditAction {
  const isLetter = pieceType.startsWith("letter");
  if (isLetter) {
    if (provider === "lob") return "letter_lob";
    return "letter_presort";
  }
  // Postcards / handwritten
  if (provider === "lob") return "postcard_lob";
  if (provider === "postgrid") return "postcard_postgrid";
  if (provider === "eddm") return "postcard_eddm";
  return "postcard_eddm";
}

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
        return Errors.validationFailed(res, parsed.error.issues);
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
        return Errors.validationFailed(res, parsed.error.issues);
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

        // W2.1 — free-tier lifetime cap. Checked BEFORE the pool debit so a
        // refusal never writes a ledger row. The refusal payload mirrors
        // poolRefusalDetails' shape (one refusal component client-side) but
        // points at the plan comparison, not BYOK — the wedge's job is to
        // convert, not to dead-end.
        const orgTier = ((org.subscriptionTier ?? "free").toLowerCase()) as SubscriptionTier;
        if (!req.isFounder && orgTier === "free") {
          const used = await freeTierPiecesUsed(org.id);
          const remainingPieces = Math.max(0, FREE_TIER_LIFETIME_PIECES - used);
          if (remainingPieces === 0) {
            return Errors.limitExceeded(res, {
              reason: "free_send_spent",
              resourceType: "free_first_send" as const,
              capPieces: FREE_TIER_LIFETIME_PIECES,
              remainingPieces: 0,
              upgradeUrl: "/settings#billing",
              message:
                `Your ${FREE_TIER_LIFETIME_PIECES} free letters are in the mail. ` +
                "Upgrade to keep reaching sellers — every paid plan includes a monthly outreach pool.",
            });
          }
          if (quote.pieceCount > remainingPieces) {
            return Errors.limitExceeded(res, {
              reason: "free_send_cap",
              resourceType: "free_first_send" as const,
              capPieces: FREE_TIER_LIFETIME_PIECES,
              remainingPieces,
              requestedPieces: quote.pieceCount,
              upgradeUrl: "/settings#billing",
              message:
                `The free plan includes ${FREE_TIER_LIFETIME_PIECES} letters total and you have ` +
                `${remainingPieces} left — narrow the audience to ${remainingPieces} ` +
                `recipient${remainingPieces === 1 ? "" : "s"}, or upgrade for a monthly pool.`,
            });
          }
        }

        const leavesAt = new Date(Date.now() + HOLD_WINDOW_MINUTES * 60 * 1000);

        // Lens 3 (Pricing Coherence) — debit the customer's credit pool for
        // the piece count BEFORE we persist the shipment. The /credits/summary
        // gauge already aggregates these rows (feature='postcard'); without
        // this debit the gauge stayed at zero forever even as mail went out.
        //
        // We map the provider-specific weight to the closest credit-weight
        // bucket (lob → postcard_lob, postgrid → postcard_postgrid, eddm →
        // postcard_eddm; letters fall back to letter_presort). Per-piece
        // weight × count, rounded up.
        const poolAction: CreditAction = mailPoolActionFor(quote.provider, pieceType);
        const mailDebitKey = `mail:queue:${org.id}:${Date.now()}:${recipients.length}`;
        const mailDebit = await poolDebit({
          organizationId: org.id,
          action: poolAction,
          units: quote.pieceCount,
          externalEventId: mailDebitKey,
          notes: `Mail queue: ${pieceType} via ${quote.provider} (${quote.pieceCount} pieces)`,
          isFounder: req.isFounder,
        });

        // Tier 1I — pool refusals are surfaced, never swallowed.
        if (!mailDebit.allowed) {
          return Errors.limitExceeded(res, poolRefusalDetails(poolAction, mailDebit));
        }

        // Transaction: insert shipment header + per-piece rows.
        let shipmentId: number;
        try {
          shipmentId = await db.transaction(async (tx) => {
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
                // Persist the exact draw so the flusher can refund on a send
                // failure (never charge-without-send) + the cancel path can
                // refund without the client round-tripping the key.
                debitEventKey: mailDebitKey,
                debitedCents: mailDebit.debitedCents,
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
        } catch (txErr) {
          // Persist failure: refund the pool draw before re-throwing.
          if (mailDebit.debitedCents > 0) {
            await refundPoolDebit({
              organizationId: org.id,
              originalEventId: mailDebitKey,
              amountCents: mailDebit.debitedCents,
              reason: "Mail shipment persist failed",
            });
          }
          throw txErr;
        }

        // Activation telemetry — first mailer queued is the wedge's magic
        // moment precursor. Idempotent first-occurrence via the
        // (org, eventName) unique index; the legacy campaigns path fires
        // first_letter_sent, this is the modern queue path's marker.
        try {
          const { recordActivationEventAsync } = await import("./services/activation");
          recordActivationEventAsync({
            orgId: org.id,
            userId,
            eventName: "first_mailer_sent",
            eventValue: { shipmentId, pieceCount: quote.pieceCount, pieceType, source: "outreach:mail:queue" },
          });
        } catch { /* non-fatal */ }

        res.status(201).json({
          shipmentId,
          leavesAt: leavesAt.toISOString(),
          holdWindowMinutes: HOLD_WINDOW_MINUTES,
          quote,
          creditPool: {
            debitedCents: mailDebit.debitedCents,
            remaining: mailDebit.remaining,
            poolMonthly: mailDebit.poolMonthly,
            // Pair the debit with the shipmentId so cancellations within the
            // 30-min hold window can refund this exact debit.
            shipmentDebitKey: mailDebitKey,
          },
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

        // Refund the pool draw posted at queue time. Prefer the EXACT debit
        // now persisted on the shipment (debitEventKey + debitedCents) — no
        // client round-trip, no recompute drift. Fall back to the legacy
        // client-key + recompute path for rows enqueued before this column
        // existed. refundPoolDebit is idempotent (no-op on conflict).
        if (existing.debitEventKey && existing.debitedCents && existing.debitedCents > 0) {
          await refundPoolDebit({
            organizationId: orgId,
            originalEventId: existing.debitEventKey,
            amountCents: existing.debitedCents,
            reason: `Mail shipment ${idParam} cancelled within hold window`,
          });
        } else if (typeof req.body?.shipmentDebitKey === "string") {
          // Legacy fallback: recompute from per-piece weight × pieceCount.
          const action = mailPoolActionFor(existing.provider ?? "", existing.pieceType);
          const { creditCost } = await import("./services/creditCost");
          const weight = await creditCost(action);
          const refundCents = Math.max(0, Math.ceil(weight * existing.pieceCount));
          if (refundCents > 0) {
            await refundPoolDebit({
              organizationId: orgId,
              originalEventId: req.body.shipmentDebitKey,
              amountCents: refundCents,
              reason: `Mail shipment ${idParam} cancelled within hold window`,
            });
          }
        }

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

  // ────────────────────────────────────────────────────────────────────────
  // Results tab (Pillar 3 Tab 3) — per-campaign attribution analytics
  // ────────────────────────────────────────────────────────────────────────

  // GET /api/outreach/mail/results/funnel/:shipmentId
  app.get(
    "/api/outreach/mail/results/funnel/:shipmentId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const shipmentId = Number(req.params.shipmentId);
      if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
        return Errors.badRequest(res, "Invalid shipment id");
      }
      const orgId = getOrganizationId(req);

      try {
        const [shipment] = await db
          .select()
          .from(mailShipments)
          .where(and(eq(mailShipments.id, shipmentId), eq(mailShipments.organizationId, orgId)))
          .limit(1);
        if (!shipment) return Errors.notFound(res, "Mail shipment");

        // Sent / delivered / response sums from mail_shipment_pieces.
        const [pieceAgg] = await db
          .select({
            sent: sql<number>`count(*) filter (where ${mailShipmentPieces.status} != 'pending')::int`,
            delivered: sql<number>`count(*) filter (where ${mailShipmentPieces.status} = 'delivered')::int`,
            qrScans: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}), 0)::int`,
            callsReceived: sql<number>`coalesce(sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
          })
          .from(mailShipmentPieces)
          .where(eq(mailShipmentPieces.shipmentId, shipmentId));

        // callsAnswered — no call-status table yet; return 0.
        // TODO: once a call_status / call_log table tracks answered state,
        // join here on the inbound-call attribution to compute properly.
        const callsAnswered = 0;

        // Deals attribution — deals table has no source_campaign_id column,
        // and there's no reliable lead-side link from a mail shipment to a
        // deal yet (leads.sourceCampaignId points at marketing campaigns,
        // not mail shipments). Return 0 so the funnel renders cleanly; the
        // numbers light up once attribution lands.
        // TODO: add deals.source_campaign_id and wire mailpiece → deal
        // attribution. Then count distinct deals.id where source_campaign_id
        // = shipmentId, and the same filter + status='closed' for closed.
        const dealAgg = { opened: 0, closed: 0 };
        void deals; // silence unused import until attribution column lands
        void leads;

        const sent = pieceAgg?.sent ?? 0;
        const delivered = pieceAgg?.delivered ?? 0;
        const qrScans = pieceAgg?.qrScans ?? 0;
        const callsReceived = pieceAgg?.callsReceived ?? 0;
        const dealsOpened = dealAgg?.opened ?? 0;
        const dealsClosed = dealAgg?.closed ?? 0;

        const costCentsTotal = shipment.totalCents;
        const safeDiv = (n: number, d: number): number => (d > 0 ? Math.round(n / d) : 0);

        res.json({
          sent,
          delivered,
          qrScans,
          callsReceived,
          callsAnswered,
          dealsOpened,
          dealsClosed,
          costCentsTotal,
          costPerSentCents: safeDiv(costCentsTotal, sent),
          costPerDeliveredCents: safeDiv(costCentsTotal, delivered),
          costPerQrScanCents: safeDiv(costCentsTotal, qrScans),
          costPerCallCents: safeDiv(costCentsTotal, callsReceived),
          costPerDealCents: safeDiv(costCentsTotal, dealsOpened),
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // GET /api/outreach/mail/results/response-timeline/:shipmentId
  app.get(
    "/api/outreach/mail/results/response-timeline/:shipmentId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const shipmentId = Number(req.params.shipmentId);
      if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
        return Errors.badRequest(res, "Invalid shipment id");
      }
      const orgId = getOrganizationId(req);

      try {
        const [shipment] = await db
          .select({
            id: mailShipments.id,
            sentAt: mailShipments.sentAt,
            queuedAt: mailShipments.queuedAt,
          })
          .from(mailShipments)
          .where(and(eq(mailShipments.id, shipmentId), eq(mailShipments.organizationId, orgId)))
          .limit(1);
        if (!shipment) return Errors.notFound(res, "Mail shipment");

        // Anchor: prefer sentAt; fall back to queuedAt for pre-send drafts.
        const anchor = shipment.sentAt ?? shipment.queuedAt;
        const anchorDate = new Date(anchor);
        const days: Array<{ day: string; qrScans: number; calls: number; cumulativeQr: number; cumulativeCalls: number }> = [];

        // We approximate per-day response counts using piece.updatedAt as a
        // proxy for "scan event posted". When a per-event log table lands,
        // swap to that join. For now this gives a 30-day daily bucket of
        // QR + call totals for pieces in this shipment.
        const rows = await db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${mailShipmentPieces.updatedAt}), 'YYYY-MM-DD')`,
            qr: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}), 0)::int`,
            calls: sql<number>`coalesce(sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
          })
          .from(mailShipmentPieces)
          .where(
            and(
              eq(mailShipmentPieces.shipmentId, shipmentId),
              gte(mailShipmentPieces.updatedAt, anchorDate),
              lt(mailShipmentPieces.updatedAt, new Date(anchorDate.getTime() + 31 * 24 * 60 * 60 * 1000)),
            ),
          )
          .groupBy(sql`date_trunc('day', ${mailShipmentPieces.updatedAt})`);

        const byDay = new Map<string, { qr: number; calls: number }>();
        for (const r of rows) byDay.set(r.day, { qr: r.qr, calls: r.calls });

        let cumQr = 0;
        let cumCalls = 0;
        for (let i = 0; i < 30; i++) {
          const d = new Date(anchorDate.getTime() + i * 24 * 60 * 60 * 1000);
          const key = d.toISOString().slice(0, 10);
          const bucket = byDay.get(key) ?? { qr: 0, calls: 0 };
          cumQr += bucket.qr;
          cumCalls += bucket.calls;
          days.push({
            day: key,
            qrScans: bucket.qr,
            calls: bucket.calls,
            cumulativeQr: cumQr,
            cumulativeCalls: cumCalls,
          });
        }
        res.json(days);
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // GET /api/outreach/mail/results/compare-templates?days=90
  app.get(
    "/api/outreach/mail/results/compare-templates",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = getOrganizationId(req);
      const days = Math.max(1, Math.min(Number(req.query.days ?? 90) || 90, 365));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      try {
        const rows = await db
          .select({
            templateId: mailShipments.templateId,
            shipments: sql<number>`count(distinct ${mailShipments.id})::int`,
            totalSent: sql<number>`coalesce(sum(${mailShipments.pieceCount}), 0)::int`,
            totalResponses: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}) + sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
          })
          .from(mailShipments)
          .leftJoin(mailShipmentPieces, eq(mailShipmentPieces.shipmentId, mailShipments.id))
          .where(
            and(
              eq(mailShipments.organizationId, orgId),
              gte(mailShipments.queuedAt, since),
              sql`${mailShipments.templateId} IS NOT NULL`,
            ),
          )
          .groupBy(mailShipments.templateId);

        res.json(
          rows.map((r) => ({
            templateId: r.templateId,
            name: r.templateId ? `Template #${r.templateId}` : "Untitled",
            shipments: r.shipments,
            totalSent: r.totalSent,
            totalResponses: r.totalResponses,
            responseRatePct:
              r.totalSent > 0 ? Math.round((r.totalResponses / r.totalSent) * 1000) / 10 : 0,
          })),
        );
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // GET /api/outreach/mail/results/cohort-by-month?days=180
  app.get(
    "/api/outreach/mail/results/cohort-by-month",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = getOrganizationId(req);
      const days = Math.max(30, Math.min(Number(req.query.days ?? 180) || 180, 730));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      try {
        const rows = await db
          .select({
            month: sql<string>`to_char(date_trunc('month', ${mailShipments.queuedAt}), 'YYYY-MM')`,
            shipments: sql<number>`count(distinct ${mailShipments.id})::int`,
            sent: sql<number>`coalesce(sum(${mailShipments.pieceCount}), 0)::int`,
            delivered: sql<number>`count(${mailShipmentPieces.id}) filter (where ${mailShipmentPieces.status} = 'delivered')::int`,
            qrScans: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}), 0)::int`,
            calls: sql<number>`coalesce(sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
            spendCents: sql<number>`coalesce(sum(${mailShipments.totalCents}), 0)::int`,
          })
          .from(mailShipments)
          .leftJoin(mailShipmentPieces, eq(mailShipmentPieces.shipmentId, mailShipments.id))
          .where(
            and(
              eq(mailShipments.organizationId, orgId),
              gte(mailShipments.queuedAt, since),
            ),
          )
          .groupBy(sql`date_trunc('month', ${mailShipments.queuedAt})`)
          .orderBy(sql`date_trunc('month', ${mailShipments.queuedAt}) desc`);

        res.json(rows);
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // GET /api/outreach/mail/results/:shipmentId/export.csv
  app.get(
    "/api/outreach/mail/results/:shipmentId/export.csv",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const shipmentId = Number(req.params.shipmentId);
      if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
        return Errors.badRequest(res, "Invalid shipment id");
      }
      const orgId = getOrganizationId(req);

      try {
        const [shipment] = await db
          .select({ id: mailShipments.id, label: mailShipments.label })
          .from(mailShipments)
          .where(and(eq(mailShipments.id, shipmentId), eq(mailShipments.organizationId, orgId)))
          .limit(1);
        if (!shipment) return Errors.notFound(res, "Mail shipment");

        const rows = await db
          .select({
            recipientName: mailShipmentPieces.recipientName,
            addressLine1: mailShipmentPieces.addressLine1,
            city: mailShipmentPieces.city,
            state: mailShipmentPieces.state,
            zip: mailShipmentPieces.zip,
            deliveredAt: mailShipmentPieces.deliveredAt,
            qrScanCount: mailShipmentPieces.qrScanCount,
            inboundCallCount: mailShipmentPieces.inboundCallCount,
          })
          .from(mailShipmentPieces)
          .where(
            and(
              eq(mailShipmentPieces.shipmentId, shipmentId),
              eq(mailShipmentPieces.organizationId, orgId),
            ),
          );

        const esc = (v: string | number | null | undefined): string => {
          if (v === null || v === undefined) return "";
          const s = String(v);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        };

        const header = [
          "recipient",
          "address",
          "city",
          "state",
          "zip",
          "delivered_at",
          "qr_scan_count",
          "inbound_call_count",
        ].join(",");

        const body = rows
          .map((r) =>
            [
              esc(r.recipientName),
              esc(r.addressLine1),
              esc(r.city),
              esc(r.state),
              esc(r.zip),
              esc(r.deliveredAt ? new Date(r.deliveredAt).toISOString() : ""),
              esc(r.qrScanCount),
              esc(r.inboundCallCount),
            ].join(","),
          )
          .join("\n");

        const safeLabel = (shipment.label ?? `shipment-${shipmentId}`).replace(/[^a-z0-9-_]+/gi, "_");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="mail-${safeLabel}-${shipmentId}.csv"`,
        );
        res.send(`${header}\n${body}\n`);
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // Mail Credits tab (Pillar 3 Tab 5) — self-serve top-up + history
  // ────────────────────────────────────────────────────────────────────────

  const TRACKED_CATEGORIES = [
    "postcard",
    "sms",
    "email",
    "skip_trace",
    "ai_tokens",
    "voice",
  ];

  // GET /api/outreach/mail/credits/summary
  app.get(
    "/api/outreach/mail/credits/summary",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const org = getOrganization(req);
      const tier = (org.subscriptionTier ?? "free") as SubscriptionTier;
      const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
      const creditPoolMonthly = limits.creditPool;

      try {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

        const [agg] = await db
          .select({
            usedAbsCents: sql<number>`coalesce(sum(abs(${financialLedger.amountCents})), 0)::int`,
          })
          .from(financialLedger)
          .where(
            and(
              eq(financialLedger.organizationId, org.id),
              eq(financialLedger.category, "opex_spent"),
              inArray(financialLedger.feature, TRACKED_CATEGORIES),
              gte(financialLedger.postedAt, monthStart),
            ),
          );

        // 1 credit ≈ 1¢; treat sum of opex cents as credits used.
        const creditPoolUsedThisMonth = agg?.usedAbsCents ?? 0;
        const creditPoolRemainingThisMonth = Math.max(
          0,
          creditPoolMonthly - creditPoolUsedThisMonth,
        );

        const dayMs = 24 * 60 * 60 * 1000;
        const daysIntoMonth = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / dayMs) + 1);
        const daysRemainingInMonth = Math.max(
          0,
          Math.ceil((monthEnd.getTime() - now.getTime()) / dayMs),
        );

        const burnRateCreditsPerDay = creditPoolUsedThisMonth / daysIntoMonth;
        let projectedRunoutDate: string | null = null;
        if (burnRateCreditsPerDay > 0) {
          const daysUntilEmpty = creditPoolMonthly / burnRateCreditsPerDay;
          if (daysUntilEmpty < daysIntoMonth + daysRemainingInMonth) {
            const runoutMs = monthStart.getTime() + daysUntilEmpty * dayMs;
            projectedRunoutDate = new Date(runoutMs).toISOString();
          }
        }

        res.json({
          tier,
          creditPoolMonthly,
          creditPoolUsedThisMonth,
          creditPoolRemainingThisMonth,
          daysIntoMonth,
          daysRemainingInMonth,
          burnRateCreditsPerDay: Math.round(burnRateCreditsPerDay * 10) / 10,
          projectedRunoutDate,
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // GET /api/outreach/mail/credits/history?days=30&category=...&limit=&offset=
  app.get(
    "/api/outreach/mail/credits/history",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = getOrganizationId(req);
      const days = Math.max(1, Math.min(Number(req.query.days ?? 30) || 30, 365));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
      const category = typeof req.query.category === "string" ? req.query.category : null;

      try {
        const conditions = [
          eq(financialLedger.organizationId, orgId),
          eq(financialLedger.category, "opex_spent"),
          gte(financialLedger.postedAt, since),
        ];
        if (category && TRACKED_CATEGORIES.includes(category)) {
          conditions.push(eq(financialLedger.feature, category));
        } else {
          conditions.push(inArray(financialLedger.feature, TRACKED_CATEGORIES));
        }

        const rows = await db
          .select({
            id: financialLedger.id,
            postedAt: financialLedger.postedAt,
            feature: financialLedger.feature,
            provider: financialLedger.provider,
            amountCents: financialLedger.amountCents,
            externalEventId: financialLedger.externalEventId,
            notes: financialLedger.notes,
          })
          .from(financialLedger)
          .where(and(...conditions))
          .orderBy(desc(financialLedger.postedAt))
          .limit(limit)
          .offset(offset);

        res.json({
          items: rows.map((r) => ({
            id: r.id,
            dateIso: r.postedAt instanceof Date ? r.postedAt.toISOString() : r.postedAt,
            action: r.notes ?? r.feature ?? "spend",
            category: r.feature ?? "unknown",
            cents: Math.abs(Number(r.amountCents)),
            providerName: r.provider,
            pieceProviderId: r.externalEventId,
            leadName: null,
          })),
          limit,
          offset,
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // POST /api/outreach/mail/credits/recharge { packCents }
  const rechargeSchema = z.object({
    packCents: z.number().int().refine((n) => [2000, 5000, 10000, 25000].includes(n), {
      message: "packCents must be one of 2000, 5000, 10000, 25000",
    }),
  });

  app.post(
    "/api/outreach/mail/credits/recharge",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = rechargeSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const org = getOrganization(req);
      const userId = getUserId(req);
      const { packCents } = parsed.data;

      try {
        const { stripeService } = await import("./stripeService");
        const { storage } = await import("./storage");

        let customerId = org.stripeCustomerId;
        if (!customerId) {
          // Best-effort: create the Stripe customer using a placeholder
          // email — the canonical billing flow lives in routes-billing.ts
          // and will overwrite/repair this on first real touch.
          const customer = await stripeService.createCustomer(
            `${userId}@unknown.acreos`,
            String(userId),
            org.name,
          );
          await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
          customerId = customer.id;
        }

        const packId = `mail-credits-${packCents}`;
        const packName = `$${(packCents / 100).toFixed(0)} Mail Credit Pack`;

        const protocol = (req.protocol || "https") as string;
        const host = req.get("host") ?? "app.acreos.io";

        const session = await stripeService.createCreditPurchaseCheckout(
          customerId,
          packId,
          packCents,
          packName,
          `${protocol}://${host}/outreach/mail?credits=success#credits`,
          `${protocol}://${host}/outreach/mail?credits=cancelled#credits`,
          {
            organizationId: String(org.id),
            type: "mail_credit_recharge",
            packCents: String(packCents),
          },
        );

        res.json({ checkoutUrl: session.url });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // GET /api/outreach/mail/credits/examples — what-costs-what reference card
  app.get(
    "/api/outreach/mail/credits/examples",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const org = getOrganization(req);
      const tier = (org.subscriptionTier ?? "free") as SubscriptionTier;
      const poolSize = (TIER_LIMITS[tier] ?? TIER_LIMITS.free).creditPool;
      res.json({ poolSize, examples: creditExamples(poolSize) });
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

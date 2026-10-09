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
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import { leadNotOptedOutSql } from "./services/leadContactability";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getOrganizationId, getUserId } from "./types/request";
import { db, type PrimaryDb } from "./db";
import {
  deals,
  financialLedger,
  leads,
  mailQrScanEvents,
  mailShipments,
  mailShipmentPieces,
  type MailShipmentRow,
} from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "./services/usageLimits";
import { creditExamples, type CreditAction } from "@shared/billing/credit-weights";
import { poolDebit, refundPoolDebit, poolRefusalDetails, poolSnapshot } from "./services/creditPool";
import {
  mailRouter,
  type MailPiece,
  type MailShipmentSpeed,
  type PieceType,
  type ProviderQuote,
} from "./services/mail/router";
import { mintQrCode, qrRedirectUrl, qrSigningConfigured } from "./services/mail/qrCodes";
import { assignTrackingNumberForMailShipment } from "./services/comms/tracking-pool";
import { registerQrRedirectRoutes } from "./routes/public-qr-redirect";
import { clock } from "./utils/clock";

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

/**
 * Lifetime pieces a free org has used: pieces of non-cancelled shipments,
 * less those that were never mailed and were refunded (suppressed during the
 * hold, or failed at the provider) — those give the allowance back, as a
 * cancel does.
 */
async function freeTierPiecesUsed(organizationId: number, exec: Pick<typeof db, "select"> = db): Promise<number> {
  const [agg] = await exec
    .select({
      used: sql<number>`count(${mailShipmentPieces.id})::int`,
    })
    .from(mailShipmentPieces)
    .innerJoin(mailShipments, eq(mailShipments.id, mailShipmentPieces.shipmentId))
    .where(
      and(
        eq(mailShipments.organizationId, organizationId),
        eq(mailShipmentPieces.organizationId, organizationId),
        sql`${mailShipments.status} != 'cancelled'`,
        sql`${mailShipmentPieces.status} not in ('suppressed', 'failed')`,
      ),
    );
  return agg?.used ?? 0;
}
const SPEEDS = ["next_day", "standard", "batch_3d", "batch_weekly", "eddm_geo"] as const;

/**
 * A piece a provider ACCEPTED — the only honest denominator for "sent" and
 * for response rates. Pending, failed and suppressed pieces were never
 * mailed; a returned piece was. (Quality directive 2026-09-29: "sent" counted
 * every non-pending piece, failed ones included, and template rates summed
 * the shipment's pieceCount once PER JOINED PIECE — a three-piece shipment
 * read as nine sends.)
 */
const acceptedPiece = sql`${mailShipmentPieces.status} in ('sent','printed','in_transit','delivered','returned')`;
/** One responding PIECE (a scan or a call), not one per scan: two scans by one person are one response. */
const respondedPiece = sql`(coalesce(${mailShipmentPieces.qrScanCount}, 0) > 0 or coalesce(${mailShipmentPieces.inboundCallCount}, 0) > 0)`;

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
  copy: z.string().max(8000).optional(),
});

const previewSchema = quoteSchema.extend({
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const queueSchema = z.object({
  audienceFilter: audienceFilterSchema,
  pieceType: z.enum(PIECE_TYPES),
  speed: z.enum(SPEEDS),
  templateId: z.number().int().positive().optional(),
  copy: z.string().max(8000).optional(),
  label: z.string().max(200).optional(),
  // The digest of the quote the investor confirmed (see audienceDigest).
  expectedAudienceDigest: z.string().min(1).max(64),
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
 * The audience cannot be honoured exactly, so nothing is quoted or queued.
 * (Quality directive 2026-09-29, first-mail wedge.) Refusing is the rule; a
 * broader audience than the investor chose is physical mail to people they
 * did not pick, paid for from their pool.
 */
class AudienceRefusal extends Error {
  constructor(
    readonly code:
      | "list_membership_unavailable"
      | "saved_views_unavailable"
      | "county_needs_state"
      | "audience_too_large",
    message: string,
  ) {
    super(message);
    this.name = "AudienceRefusal";
  }
}

type PoolDebitResult = Awaited<ReturnType<typeof poolDebit>>;

/** The pool refused the debit inside the queue transaction. */
class PoolRefusal extends Error {
  constructor(readonly result: PoolDebitResult) {
    super("pool refused the mail debit");
    this.name = "PoolRefusal";
  }
}

/** Two sends raced for the last of the free allowance; this one lost. */
class FreeTierRaceRefusal extends Error {
  constructor(readonly remainingPieces: number) {
    super("free allowance taken by a concurrent send");
    this.name = "FreeTierRaceRefusal";
  }
}

/** The most pieces one shipment may address. Past it the queue refuses — it never truncates. */
const MAX_AUDIENCE = 50_000;

const normCounty = (c: string) => c.trim().toLowerCase().replace(/\s+county$/i, "").replace(/\s+/g, " ");

/**
 * Resolves the audience filter to the exact recipient set, ordered by lead id
 * so the same set always reads the same way.
 *
 * What it used to do: a selected marketing list contributed only its
 * `filters.states` (a list with no states — or an unknown id — added no
 * condition at all), and the counties and acreage the composer shows were
 * ignored, so a "Hidalgo County list" mailed every eligible lead in Texas, and
 * a stateless list mailed the whole CRM, silently capped at 50,000.
 *
 * Now every field of the filter either narrows the set exactly or refuses:
 * marketing lists carry no member records (only import metadata), and saved
 * views have no programmatic resolver, so both are refused rather than
 * approximated; a county needs its state (a "Washington County" exists in 30
 * states); more than MAX_AUDIENCE recipients is refused, never cut.
 */
async function resolveAudience(
  organizationId: number,
  filter: z.infer<typeof audienceFilterSchema>,
): Promise<Recipient[]> {
  if (filter.leadListIds && filter.leadListIds.length > 0) {
    throw new AudienceRefusal(
      "list_membership_unavailable",
      "Marketing lists don't record which leads belong to them yet, so a list can't choose recipients. " +
        "Filter by state, county and acreage instead.",
    );
  }
  if (filter.savedViewIds && filter.savedViewIds.length > 0) {
    throw new AudienceRefusal(
      "saved_views_unavailable",
      "Saved views can't choose mail recipients yet. Filter by state, county and acreage instead.",
    );
  }
  const states = (filter.states ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const counties = Array.from(new Set((filter.counties ?? []).map(normCounty).filter(Boolean)));
  if (counties.length > 0 && states.length !== 1) {
    // One state per county send: with two states and two counties, every
    // county name was matched in BOTH states (four counties, not two).
    throw new AudienceRefusal(
      "county_needs_state",
      states.length === 0
        ? "Add the state for those counties — the same county name exists in many states."
        : "Filter counties within one state per send — the same county name exists in many states.",
    );
  }

  const conditions = [
    eq(leads.organizationId, organizationId),
    sql`${leads.deletedAt} IS NULL`,
    // SUPPRESSION. A seller who texts STOP has `doNotContact` and `optOutDate`
    // set by handleInboundOptKeyword, and the consent-revocation record written
    // alongside it names `direct_mail` among the revoked channels
    // (smsService.ts, tcpaCompliance.ts). The same rule preMailDedupe.ts
    // applies; the flusher re-checks it before the provider handoff, because
    // a seller can opt out during the 30-minute hold.
    leadNotOptedOutSql(),
    sql`${leads.address} IS NOT NULL`,
    sql`${leads.city} IS NOT NULL`,
    sql`${leads.state} IS NOT NULL`,
    sql`${leads.zip} IS NOT NULL`,
  ];
  if (states.length > 0) conditions.push(inArray(sql`upper(trim(${leads.state}))`, states));
  if (counties.length > 0) {
    conditions.push(
      // "\\s" in source is "\s" in the SQL: a template literal cooks "\s" to "s",
      // which silently matched "hidalgoXcounty"-style nonsense and left every
      // county stored with a " County" suffix out of the audience.
      inArray(sql`lower(regexp_replace(trim(${leads.county}), '\\s+county$', '', 'i'))`, counties),
    );
  }
  if (filter.acreageMin !== undefined) conditions.push(gte(leads.acreage, String(filter.acreageMin)));
  if (filter.acreageMax !== undefined) conditions.push(lte(leads.acreage, String(filter.acreageMax)));

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
    .orderBy(asc(leads.id))
    .limit(MAX_AUDIENCE + 1);

  if (rows.length > MAX_AUDIENCE) {
    throw new AudienceRefusal(
      "audience_too_large",
      `More than ${MAX_AUDIENCE.toLocaleString()} leads match — narrow the audience; nothing was cut off silently.`,
    );
  }

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

/**
 * The identity of what the investor confirmed: exactly these recipients at
 * exactly these addresses, this piece type and this copy. Quote and preview
 * return it; queue refuses (409) when the set it resolves no longer matches,
 * so the count, the cost and the pieces written are always the same set.
 */
function audienceDigest(recipients: Recipient[], pieceType: string, copy: string | undefined): string {
  const h = createHash("sha256");
  h.update(`${pieceType}\n${copy ?? ""}\n`);
  for (const r of recipients) {
    h.update(`${r.leadId}|${r.firstName}|${r.lastName}|${r.addressLine1}|${r.city}|${r.state}|${r.zip}\n`);
  }
  return h.digest("hex").slice(0, 32);
}

function sendAudienceRefusal(res: Response, err: AudienceRefusal) {
  return sendError(res, 422, err.code, err.message);
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
  /** What the investor is confirming; queue refuses if it no longer matches. */
  audienceDigest: string;
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
  recipients: Recipient[],
  pieceType: PieceType,
  speed: MailShipmentSpeed,
  copy: string | undefined,
): Promise<QuotePayload> {
  const pieces = recipientsToMailPieces(recipients, pieceType);

  // Recent-mail dedupe warn signal (UX-only — caller decides to warn).
  const cutoff = new Date(clock.nowMs() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const recentlyMailedCount = recipients.filter(
    (r) => r.lastContactedAt && r.lastContactedAt >= cutoff,
  ).length;
  const recentlyMailedFraction = recipients.length > 0 ? recentlyMailedCount / recipients.length : 0;

  const digest = audienceDigest(recipients, pieceType, copy);
  if (pieces.length === 0) {
    return {
      audienceDigest: digest,
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
    audienceDigest: digest,
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
  // ── Wave B sub-surfaces ──────────────────────────────────────────────────
  // Two inbound feeds that make the attribution funnel real. Both are
  // deliberately UNAUTHENTICATED — one is scanned off a postcard by a
  // stranger, the other is a server-to-server webhook authenticated by HMAC —
  // so each carries its own justification and its own guard rails. The QR
  // redirect is mounted here because it exists only to feed this surface.
  registerQrRedirectRoutes(app);   // GET  /r/:code            — public, no auth
  // POST /api/webhooks/lob (HMAC-verified) is registered by registerRoutes
  // itself, BEFORE the /api session catch-all — this registrar runs after it,
  // where Lob's sessionless deliveries were 401'd before the HMAC check.

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
        const orgId = getOrganizationId(req);
        const recipients = await resolveAudience(orgId, parsed.data.audienceFilter);
        const quote = await buildQuote(orgId, recipients, parsed.data.pieceType, parsed.data.speed, parsed.data.copy);
        res.json(quote);
      } catch (err) {
        if (err instanceof AudienceRefusal) return sendAudienceRefusal(res, err);
        Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/outreach/mail/preview ──────────────────────────────────────
  // The composer's "Preview all" called this route and it did not exist: the
  // failure was caught and replaced by a placeholder, so nobody could see who
  // would be mailed. It now pages through the SAME resolved set the queue
  // will write, with the same digest, and the copy each piece will carry.
  app.post(
    "/api/outreach/mail/preview",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = previewSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      try {
        const orgId = getOrganizationId(req);
        const recipients = await resolveAudience(orgId, parsed.data.audienceFilter);
        const offset = parsed.data.offset ?? 0;
        const limit = parsed.data.limit ?? 50;
        res.json({
          audienceDigest: audienceDigest(recipients, parsed.data.pieceType, parsed.data.copy),
          total: recipients.length,
          offset,
          recipients: recipients.slice(offset, offset + limit).map((r) => ({
            leadId: r.leadId,
            name: `${r.firstName} ${r.lastName}`.trim(),
            addressLine1: r.addressLine1,
            city: r.city,
            state: r.state,
            zip: r.zip,
          })),
          copy: parsed.data.copy ?? null,
        });
      } catch (err) {
        if (err instanceof AudienceRefusal) return sendAudienceRefusal(res, err);
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
      const { audienceFilter, pieceType, speed, templateId, copy, label, expectedAudienceDigest } = parsed.data;

      // ONE customer intent = ONE shipment. The composer holds this key for
      // the shipment it is composing and sends it again on a retry, so a
      // response lost after commit followed by another click finds the
      // shipment rather than debiting and queuing a second one. (It used to
      // be ignored: the debit was keyed on Date.now().)
      const rawKey = req.headers["idempotency-key"];
      const operationKey = typeof rawKey === "string" ? rawKey.trim() : "";
      if (!operationKey || operationKey.length > 200) {
        return Errors.badRequest(res, "An Idempotency-Key header identifying this send is required");
      }

      try {
        const findExisting = async (exec: Pick<typeof db, "select"> = db) => {
          const [row] = await exec
            .select()
            .from(mailShipments)
            .where(and(eq(mailShipments.organizationId, org.id), eq(mailShipments.operationKey, operationKey)))
            .limit(1);
          return row;
        };
        const replayed = await findExisting();
        if (replayed) {
          return res.json(replayResponse(replayed));
        }

        // ONE audience read. The quote, the cap, the debit and the pieces
        // written all come from this set (it used to be read twice, so the
        // count charged and the pieces queued could differ).
        const recipients = await resolveAudience(org.id, audienceFilter);
        if (recipients.length === 0) {
          return Errors.badRequest(res, "No recipients match this audience filter");
        }

        const quote = await buildQuote(org.id, recipients, pieceType, speed, copy);
        if (quote.audienceDigest !== expectedAudienceDigest) {
          // The set changed between the quote the investor confirmed and now
          // (a lead added, removed, opted out or re-addressed). Nothing is
          // charged or queued; they re-confirm the new quote.
          return sendError(res, 409, "audience_changed", "The recipients changed since you reviewed this quote. Review the new count and cost, then send.", {
            quote,
          });
        }

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

        const leavesAt = new Date(clock.nowMs() + HOLD_WINDOW_MINUTES * 60 * 1000);

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
        // The debit is taken INSIDE the per-org lock, after the operation is
        // known not to exist, under a key unique to THIS attempt. Keyed on the
        // operation alone, a retry after a refunded persist failure replayed
        // the refunded debit at 0 cents and queued mail no one paid for, and a
        // concurrent duplicate could write the shipment with debitedCents 0
        // against a real charge (independent audit of the G0 slice). The
        // operation's idempotency is the lock + the unique operation key.
        const mailDebitKey = `mail:queue:${org.id}:op:${operationKey}:${randomUUID()}`;
        let mailDebit: PoolDebitResult | null = null;
        // Assigned inside the transaction callback; read through this so the
        // compiler does not narrow it to its initial null.
        const debitTaken = () => mailDebit as PoolDebitResult | null;

        // Transaction: insert shipment header + per-piece rows, serialised per
        // org so two concurrent sends cannot both pass the free allowance or
        // both write the same operation.
        let shipmentId!: number;
        let qrCodesIssued = 0;
        let replayOf: MailShipmentRow | undefined;
        try {
          const txResult = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`mail_queue:${org.id}`}))`);
            const concurrent = await findExisting(tx);
            if (concurrent) return { replay: concurrent };
            if (!req.isFounder && orgTier === "free") {
              const usedNow = await freeTierPiecesUsed(org.id, tx);
              if (usedNow + quote.pieceCount > FREE_TIER_LIFETIME_PIECES) {
                throw new FreeTierRaceRefusal(Math.max(0, FREE_TIER_LIFETIME_PIECES - usedNow));
              }
            }
            // Lens 3 (Pricing Coherence) — debit the pool for the piece count
            // BEFORE the shipment is written (the /credits/summary gauge
            // aggregates these rows). Tier 1I — refusals surface, never swallowed.
            mailDebit = await poolDebit({
              organizationId: org.id,
              action: poolAction,
              units: quote.pieceCount,
              externalEventId: mailDebitKey,
              notes: `Mail queue: ${pieceType} via ${quote.provider} (${quote.pieceCount} pieces)`,
              isFounder: req.isFounder,
              // Inside this transaction: the debit commits with the shipment
              // it pays for, or rolls back with it. On the global connection a
              // crash between the two commits left a debit no retry could
              // find (DEFECT-0213).
              tx: tx as unknown as PrimaryDb,
            });
            if (!mailDebit.allowed) throw new PoolRefusal(mailDebit);
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
                operationKey,
              })
              .returning({ id: mailShipments.id });

            const inserted = await tx
              .insert(mailShipmentPieces)
              .values(
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
              )
              .returning({ id: mailShipmentPieces.id });

            // Wave B — mint the per-piece attribution short code. The piece
            // row is the contract the flusher reads when it composes the
            // provider payload: mailFlusher.buildRouterShipment selects
            // `qr_code` and prints the derived short link on the piece
            // (`responseBlockHtml`), which is what makes /r/:code reachable
            // by the person holding the mail. (Minting alone did NOT do that
            // — the flusher did not read the column until the 2026-07-29
            // Wave B completeness audit.)
            //
            // The code is a deterministic HMAC over the piece id, so it can
            // only be minted after the insert assigns those ids — hence the
            // second statement inside the same transaction. If no signing
            // secret is configured we leave qr_code NULL rather than print a
            // forgeable code; every downstream surface then reports the piece
            // as "not instrumented" instead of "0 scans".
            if (qrSigningConfigured()) {
              for (const p of inserted) {
                const code = mintQrCode(p.id);
                if (!code) continue;
                await tx
                  .update(mailShipmentPieces)
                  .set({ qrCode: code })
                  .where(eq(mailShipmentPieces.id, p.id));
                qrCodesIssued++;
              }
            }

            return { shipmentId: row.id, pieceIds: inserted.map((p) => p.id) };
          });
          // A debit funded from purchased credits was taken inside the
          // transaction, so its auto top-up waits for the commit (audit of
          // 1694a0b) — now.
          if (debitTaken()?.fundedBy === "purchased_credits" && !("replay" in txResult)) {
            const { creditService } = await import("./services/credits");
            creditService.afterDebitCommitted(org.id);
          }
          if ("replay" in txResult) {
            // The same operation committed concurrently. Its debit is THIS
            // debit (same key, idempotent), so nothing is refunded.
            replayOf = txResult.replay;
          } else {
            shipmentId = txResult.shipmentId;
          }
        } catch (txErr) {
          qrCodesIssued = 0;
          // Persist failure: refund the pool draw before re-throwing.
          if (txErr instanceof PoolRefusal) {
            return Errors.limitExceeded(res, poolRefusalDetails(poolAction, txErr.result));
          }
          // The debit was taken inside the transaction that just rolled back,
          // so it rolled back with it: there is nothing to refund (DEFECT-0213).
          if (txErr instanceof FreeTierRaceRefusal) {
            return Errors.limitExceeded(res, {
              reason: "free_send_cap",
              resourceType: "free_first_send" as const,
              capPieces: FREE_TIER_LIFETIME_PIECES,
              remainingPieces: txErr.remainingPieces,
              requestedPieces: quote.pieceCount,
              upgradeUrl: "/settings#billing",
              message: `Another send just used part of your free allowance — ${txErr.remainingPieces} letter(s) left.`,
            });
          }
          throw txErr;
        }
        if (replayOf) {
          return res.json(replayResponse(replayOf));
        }

        // Activation telemetry — QUEUED, not sent. This used to record
        // first_mailer_sent (the email/SMS event, shown to the founder as
        // "Email/SMS out"), at queue time, for mail that can still be
        // cancelled in the hold or fail at the provider. The physical first
        // mail (first_letter_sent) is recorded by the flusher when a provider
        // accepts a live piece.
        try {
          const { recordActivationEventAsync } = await import("./services/activation");
          recordActivationEventAsync({
            orgId: org.id,
            userId,
            eventName: "first_mail_queued",
            eventValue: { shipmentId, pieceCount: quote.pieceCount, pieceType, source: "outreach:mail:queue" },
          });
        } catch { /* non-fatal */ }

        // Wave B — attach a tracking phone number so inbound calls from this
        // campaign are attributable. Best effort by design: the helper
        // swallows a missing carrier config / empty pool and returns null, and
        // the response says plainly whether call attribution is live.
        const trackingNumber = await assignTrackingNumberForMailShipment(org.id, shipmentId);

        res.status(201).json({
          shipmentId,
          leavesAt: leavesAt.toISOString(),
          holdWindowMinutes: HOLD_WINDOW_MINUTES,
          quote,
          // Honest instrumentation report — the composer shows what will
          // actually be measured, so a later zero can be read as "nobody
          // scanned" rather than "we never looked".
          attribution: {
            qrCodesIssued,
            qrTrackingEnabled: qrCodesIssued > 0,
            trackingNumber: trackingNumber?.number ?? null,
            callTrackingEnabled: trackingNumber !== null,
          },
          creditPool: {
            debitedCents: debitTaken()?.debitedCents ?? 0,
            remaining: debitTaken()?.remaining ?? 0,
            poolMonthly: debitTaken()?.poolMonthly ?? 0,
            // Pair the debit with the shipmentId so cancellations within the
            // 30-min hold window can refund this exact debit.
            shipmentDebitKey: mailDebitKey,
          },
        });
      } catch (err) {
        if (err instanceof AudienceRefusal) return sendAudienceRefusal(res, err);
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
        if (existing.leavesAt.getTime() <= clock.nowMs()) {
          return Errors.badRequest(res, "Hold window has passed; shipment already in flight");
        }

        const [updated] = await db
          .update(mailShipments)
          .set({
            status: "cancelled",
            cancelledAt: clock.now(),
            cancellationReason: typeof req.body?.reason === "string" ? req.body.reason : "user_cancelled",
          })
          .where(and(eq(mailShipments.id, idParam), eq(mailShipments.organizationId, orgId)))
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

        // Wave B — measurement provenance, per shipment. The In-Flight tab
        // needs to distinguish three states that a bare "0" cannot:
        //   piecesInstrumented = 0   → we never printed a QR (not measured)
        //   deliveryEventsReceived=0 → USPS has not scanned anything yet
        //   qrScans = 0 with both > 0 → really nobody has scanned
        const attribution = await db
          .select({
            shipmentId: mailShipmentPieces.shipmentId,
            qrScans: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}), 0)::int`,
            inboundCalls: sql<number>`coalesce(sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
            piecesInstrumented: sql<number>`count(*) filter (where ${mailShipmentPieces.qrCode} is not null)::int`,
            deliveryEventsReceived: sql<number>`count(*) filter (where ${mailShipmentPieces.printedAt} is not null or ${mailShipmentPieces.inTransitAt} is not null or ${mailShipmentPieces.deliveredAt} is not null or ${mailShipmentPieces.returnedAt} is not null)::int`,
          })
          .from(mailShipmentPieces)
          .where(inArray(mailShipmentPieces.shipmentId, ids))
          .groupBy(mailShipmentPieces.shipmentId);

        const attrByShipment = new Map(attribution.map((a) => [a.shipmentId, a]));

        res.json({
          shipments: shipments.map((s) => {
            const a = attrByShipment.get(s.id);
            return {
              ...serializeShipment(s),
              stageCounts: byShipment.get(s.id) ?? {},
              qrScans: a?.qrScans ?? 0,
              inboundCalls: a?.inboundCalls ?? 0,
              piecesInstrumented: a?.piecesInstrumented ?? 0,
              deliveryEventsReceived: a?.deliveryEventsReceived ?? 0,
            };
          }),
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

        res.json({
          pieces: pieces.map((p) => ({
            ...p,
            // The response URL printed on this piece (see
            // mailFlusher.responseBlockHtml). Null when the piece was queued
            // before attribution instrumentation existed, or when this
            // deployment has no signing secret — the client renders "not
            // instrumented", never a measured zero.
            qrUrl: p.qrCode ? qrRedirectUrl(p.qrCode) : null,
          })),
          total,
          limit,
          offset,
        });
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
            sent: sql<number>`count(*) filter (where ${acceptedPiece})::int`,
            failed: sql<number>`count(*) filter (where ${mailShipmentPieces.status} = 'failed')::int`,
            suppressed: sql<number>`count(*) filter (where ${mailShipmentPieces.status} = 'suppressed')::int`,
            delivered: sql<number>`count(*) filter (where ${mailShipmentPieces.status} = 'delivered')::int`,
            // Evidence it was delivered at some point — a piece delivered and
            // later returned stays delivered here, and returned below.
            everDelivered: sql<number>`count(*) filter (where ${mailShipmentPieces.deliveredAt} is not null)::int`,
            returned: sql<number>`count(*) filter (where ${mailShipmentPieces.status} = 'returned')::int`,
            piecesResponded: sql<number>`count(*) filter (where ${respondedPiece})::int`,
            qrScans: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}), 0)::int`,
            callsReceived: sql<number>`coalesce(sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
            // Measurement provenance (Wave B). Without these the client cannot
            // tell "nobody scanned" from "nothing was ever measured", and a
            // zero rendered as a result is a fabricated measurement.
            piecesInstrumented: sql<number>`count(*) filter (where ${mailShipmentPieces.qrCode} is not null)::int`,
            deliveryEventsReceived: sql<number>`count(*) filter (where ${mailShipmentPieces.printedAt} is not null or ${mailShipmentPieces.inTransitAt} is not null or ${mailShipmentPieces.deliveredAt} is not null or ${mailShipmentPieces.returnedAt} is not null)::int`,
          })
          .from(mailShipmentPieces)
          .where(and(eq(mailShipmentPieces.shipmentId, shipmentId), eq(mailShipmentPieces.organizationId, orgId)));

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

        // What the ACCEPTED pieces cost: failed and suppressed pieces were
        // refunded, so the locked shipment total overstated $/sent.
        const costCentsTotal = shipment.perPieceCents * sent;
        const safeDiv = (n: number, d: number): number => (d > 0 ? Math.round(n / d) : 0);

        res.json({
          // Accepted by the provider. Failed and suppressed pieces were never mailed.
          sent,
          failed: pieceAgg?.failed ?? 0,
          suppressed: pieceAgg?.suppressed ?? 0,
          delivered,
          everDelivered: pieceAgg?.everDelivered ?? 0,
          returned: pieceAgg?.returned ?? 0,
          // Pieces with at least one scan or call — a person, not an event count.
          piecesResponded: pieceAgg?.piecesResponded ?? 0,
          qrScans,
          callsReceived,
          callsAnswered,
          dealsOpened,
          dealsClosed,
          // Wave B honesty envelope: which of the numbers above are MEASURED
          // and which are simply not instrumented for this shipment.
          measurement: {
            qrTrackingEnabled: (pieceAgg?.piecesInstrumented ?? 0) > 0,
            piecesInstrumented: pieceAgg?.piecesInstrumented ?? 0,
            deliveryEventsReceived: pieceAgg?.deliveryEventsReceived ?? 0,
            // Never measured, and honest about it — see the TODOs below.
            //
            // `callsReceived` sums mail_shipment_pieces.inbound_call_count,
            // which is READ in six places and WRITTEN in NONE: Wave B assigned
            // a tracking number to the shipment but no inbound-call path ever
            // increments the piece counter, and the number is not printed on
            // the piece either. So the figure is a permanent zero, not a
            // measurement — flagged here (2026-07-29 completeness audit) so
            // the client stops rendering it as "0 calls".
            inboundCallTracking: false,
            callsAnsweredTracked: false,
            dealAttributionTracked: false,
          },
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

        // Wave B — real per-day scan buckets from mail_qr_scan_events, one row
        // per HTTP hit on /r/:code with its own timestamp.
        //
        // This replaces the previous approximation, which bucketed each
        // piece's ENTIRE lifetime scan total into whatever day the row was
        // last touched (piece.updatedAt). That produced a curve that looked
        // like a response timeline and measured nothing of the sort — a
        // delivery webhook or any other write would teleport a piece's scans
        // to a different day. Only COUNTED scans are charted; suppressed
        // duplicates stay in the table for audit but never inflate the curve.
        //
        // `calls` stays 0 until inbound-call attribution writes
        // inboundCallCount — no per-call event log exists, so there is
        // nothing honest to chart per day yet.
        const rows = await db
          .select({
            day: sql<string>`to_char(date_trunc('day', ${mailQrScanEvents.scannedAt}), 'YYYY-MM-DD')`,
            qr: sql<number>`count(*)::int`,
          })
          .from(mailQrScanEvents)
          .where(
            and(
              eq(mailQrScanEvents.shipmentId, shipmentId),
              eq(mailQrScanEvents.counted, true),
              gte(mailQrScanEvents.scannedAt, anchorDate),
              lt(mailQrScanEvents.scannedAt, new Date(anchorDate.getTime() + 31 * 24 * 60 * 60 * 1000)),
            ),
          )
          .groupBy(sql`date_trunc('day', ${mailQrScanEvents.scannedAt})`);

        const byDay = new Map<string, { qr: number; calls: number }>();
        for (const r of rows) byDay.set(r.day, { qr: r.qr, calls: 0 });

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

  // GET /api/outreach/mail/templates — the compose page's template picker
  // (with response-rate badges). There is no mail-template store yet:
  // templateId on mail_shipments is a bare integer chosen by the composer.
  // So the honest list is the templates this org has ACTUALLY USED, with
  // real per-template outcome stats; name falls back to the most recent
  // shipment label that used it. responseRate is a 0–1 fraction (the
  // client multiplies by 100).
  app.get(
    "/api/outreach/mail/templates",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = getOrganizationId(req);
      try {
        const rows = await db
          .select({
            templateId: mailShipments.templateId,
            campaigns: sql<number>`count(distinct ${mailShipments.id})::int`,
            sends: sql<number>`count(${mailShipmentPieces.id}) filter (where ${acceptedPiece})::int`,
            responses: sql<number>`count(${mailShipmentPieces.id}) filter (where ${acceptedPiece} and ${respondedPiece})::int`,
            latestLabel: sql<string | null>`(array_agg(${mailShipments.label} order by ${mailShipments.queuedAt} desc))[1]`,
          })
          .from(mailShipments)
          .leftJoin(mailShipmentPieces, eq(mailShipmentPieces.shipmentId, mailShipments.id))
          .where(
            and(
              eq(mailShipments.organizationId, orgId),
              sql`${mailShipments.templateId} IS NOT NULL`,
            ),
          )
          .groupBy(mailShipments.templateId);

        res.json(
          rows.map((r) => ({
            id: r.templateId as number,
            name: r.latestLabel || `Template #${r.templateId}`,
            campaigns: r.campaigns,
            sends: r.sends,
            ...(r.sends > 0 ? { responseRate: r.responses / r.sends } : {}),
          })),
        );
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
      const since = new Date(clock.nowMs() - days * 24 * 60 * 60 * 1000);

      try {
        const rows = await db
          .select({
            templateId: mailShipments.templateId,
            shipments: sql<number>`count(distinct ${mailShipments.id})::int`,
            totalSent: sql<number>`count(${mailShipmentPieces.id}) filter (where ${acceptedPiece})::int`,
            totalResponses: sql<number>`count(${mailShipmentPieces.id}) filter (where ${acceptedPiece} and ${respondedPiece})::int`,
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
      const since = new Date(clock.nowMs() - days * 24 * 60 * 60 * 1000);

      try {
        const rows = await db
          .select({
            month: sql<string>`to_char(date_trunc('month', ${mailShipments.queuedAt}), 'YYYY-MM')`,
            shipments: sql<number>`count(distinct ${mailShipments.id})::int`,
            // Per accepted PIECE — the join yields one row per piece, so a
            // shipment-level sum here counted each shipment once per piece.
            sent: sql<number>`count(${mailShipmentPieces.id}) filter (where ${acceptedPiece})::int`,
            delivered: sql<number>`count(${mailShipmentPieces.id}) filter (where ${mailShipmentPieces.status} = 'delivered')::int`,
            qrScans: sql<number>`coalesce(sum(${mailShipmentPieces.qrScanCount}), 0)::int`,
            calls: sql<number>`coalesce(sum(${mailShipmentPieces.inboundCallCount}), 0)::int`,
            // Each piece carries its share of its shipment's locked total, so
            // the sum is each shipment's total once. Cancelled shipments were
            // refunded and spent nothing.
            spendCents: sql<number>`coalesce(round(sum(${mailShipments.totalCents}::numeric / greatest(${mailShipments.pieceCount}, 1)) filter (where ${mailShipmentPieces.id} is not null and ${mailShipments.status} <> 'cancelled')), 0)::int`,
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
            qrCode: mailShipmentPieces.qrCode,
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
          // Blank when the piece carried no printed QR: that row's scan count
          // is "not measured", not "measured as zero".
          "qr_code",
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
              esc(r.qrCode),
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

      try {
        const now = clock.now();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

        // The gauge reads the SAME sum the debit gate enforces (poolSnapshot):
        // it summed its own feature list — no data lookups, refunds added
        // rather than netted — so it disagreed with the wall it predicts
        // (audit of 0e54c75). 1 credit ≈ 1¢.
        const snapshot = await poolSnapshot(org.id);
        const tier = snapshot.tier;
        const creditPoolMonthly = snapshot.poolMonthly;
        const creditPoolUsedThisMonth = snapshot.used;
        const creditPoolRemainingThisMonth = snapshot.remaining;

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
      const since = new Date(clock.nowMs() - days * 24 * 60 * 60 * 1000);
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
      // The org's REAL pool (a grandfathered Scale org keeps 8,000 until its
      // renewal) — the same resolution the debit gate enforces.
      const { poolMonthly: poolSize } = await poolSnapshot(org.id);
      res.json({ poolSize, examples: creditExamples(poolSize) });
    },
  );
}

/**
 * A retry of an operation already queued answers with the SAME shape as the
 * original success, so the composer shows the one shipment that exists.
 */
function replayResponse(row: MailShipmentRow) {
  return {
    replayed: true,
    shipmentId: row.id,
    status: row.status,
    leavesAt: row.leavesAt.toISOString(),
    holdWindowMinutes: HOLD_WINDOW_MINUTES,
    quote: {
      pieceCount: row.pieceCount,
      perPieceCents: row.perPieceCents,
      totalCents: row.totalCents,
      provider: row.provider ?? "—",
      savedVsLobCents: row.savedVsLobCents,
      deliveryEtaDays: row.deliveryEtaDays,
      alternatives: [],
      recentlyMailedCount: 0,
      recentlyMailedFraction: 0,
    },
  };
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

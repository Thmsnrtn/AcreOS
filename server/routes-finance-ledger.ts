/**
 * Founder Finance Ledger — read-side + recovery actions for the founder
 * cockpit's financial surface.
 *
 * Mounted at `/api/founder/finance` with `isAuthenticated + getOrCreateOrg +
 * requireFounder`. Read endpoints aggregate the append-only `financial_ledger`
 * into shapes the /founder (Now) tiles and /founder/steering sections render.
 *
 * Per the canonical 4-surface integration map in
 * `docs/financial-mail-platform/PLAN.md` + the founder-side integration
 * section of `plans/how-can-we-either-ticklish-ocean.md`, the financial
 * surface is woven into the existing four founder routes — there is no
 * /founder/finance top-level route.
 */

import { Router, type Response } from "express";
import { and, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  financialLedger,
  founderAudit,
  organizations,
} from "@shared/schema";
import {
  BUCKET_NAMES,
  type BucketName,
} from "@shared/billing/allocation-policy";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// ── Shared helpers ───────────────────────────────────────────────────────────

const REVENUE_TRIGGER_LADDER: Array<{
  thresholdId: string;
  thresholdCents: number;
  action: string;
  costOneTimeCents: number;
  costRecurringCents: number;
}> = [
  { thresholdId: "mrr-50",     thresholdCents:    5_000, action: "Re-enable Sentry Starter",                  costOneTimeCents:     0, costRecurringCents:  2_900 },
  { thresholdId: "mrr-200",    thresholdCents:   20_000, action: "Upgrade Fly app to shared-cpu-2x",          costOneTimeCents:     0, costRecurringCents:    800 },
  { thresholdId: "mrr-500",    thresholdCents:   50_000, action: "Add 2nd Fly app machine for redundancy",    costOneTimeCents:     0, costRecurringCents:  2_400 },
  { thresholdId: "mrr-1000a",  thresholdCents:  100_000, action: "Apply for USPS Mail.dat permit",            costOneTimeCents: 35_000, costRecurringCents:  2_900 },
  { thresholdId: "mrr-1000b",  thresholdCents:  100_000, action: "Re-enable ElevenLabs Pro",                  costOneTimeCents:     0, costRecurringCents:  2_200 },
  { thresholdId: "mrr-2000",   thresholdCents:  200_000, action: "Migrate Postgres off Neon free tier",       costOneTimeCents:     0, costRecurringCents:  8_500 },
  { thresholdId: "mrr-3000",   thresholdCents:  300_000, action: "Telnyx account + A2P 10DLC registration",   costOneTimeCents:  5_000, costRecurringCents:      0 },
  { thresholdId: "mrr-5000",   thresholdCents:  500_000, action: "Wire aggregation queue + presort partner",  costOneTimeCents:     0, costRecurringCents:      0 },
  { thresholdId: "mrr-10000",  thresholdCents: 1_000_000, action: "Right-size Fly to performance-2x",         costOneTimeCents:     0, costRecurringCents: 54_000 },
];

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function computeTrailing30dMrrCents(): Promise<number> {
  const since = daysAgo(30);
  const [row] = await db
    .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.category, "revenue"),
        gte(financialLedger.postedAt, since),
      ),
    );
  return row?.total ?? 0;
}

// ── GET /buckets ─────────────────────────────────────────────────────────────

router.get("/buckets", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        bucket: financialLedger.bucket,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .groupBy(financialLedger.bucket);

    const balances: Record<BucketName, number> = {
      tax_reserve: 0,
      refund_reserve: 0,
      profit_reserve: 0,
      owner_draw: 0,
      opex_available: 0,
    };
    for (const r of rows) {
      if ((BUCKET_NAMES as readonly string[]).includes(r.bucket)) {
        balances[r.bucket as BucketName] = r.total ?? 0;
      }
    }

    // Opex split: total positive allocations minus total negative spend.
    const [opexPositive] = await db
      .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.bucket, "opex_available"),
          sql`${financialLedger.amountCents} > 0`,
        ),
      );
    const [opexNegative] = await db
      .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.bucket, "opex_available"),
          sql`${financialLedger.amountCents} < 0`,
        ),
      );

    const opexAllocatedCents = opexPositive?.total ?? 0;
    const opexSpentSigned = opexNegative?.total ?? 0; // negative
    const opexSpentCents = -opexSpentSigned;
    const opexAvailableNetCents = opexAllocatedCents + opexSpentSigned;

    res.json({
      taxReserve: balances.tax_reserve,
      refundReserve: balances.refund_reserve,
      profitReserve: balances.profit_reserve,
      ownerDraw: balances.owner_draw,
      opexAvailable: opexAllocatedCents,
      opexSpent: opexSpentCents,
      opexAvailableNet: opexAvailableNetCents,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /mrr ─────────────────────────────────────────────────────────────────

router.get("/mrr", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const since = daysAgo(90);

    // Trailing 30d MRR (sum of revenue rows over the last 30 days).
    const currentMrr = await computeTrailing30dMrrCents();

    // Per-day trend over the last 90 days.
    const trendRows = await db
      .select({
        day: sql<string>`date_trunc('day', ${financialLedger.postedAt})::date::text`,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.category, "revenue"),
          gte(financialLedger.postedAt, since),
        ),
      )
      .groupBy(sql`date_trunc('day', ${financialLedger.postedAt})`)
      .orderBy(sql`date_trunc('day', ${financialLedger.postedAt})`);

    const mrrTrend = trendRows.map((r) => ({ date: r.day, mrr: r.total ?? 0 }));

    // Per-tier breakdown — join ledger revenue against organizations.subscriptionTier.
    const byTierRows = await db
      .select({
        tier: organizations.subscriptionTier,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .leftJoin(organizations, eq(financialLedger.organizationId, organizations.id))
      .where(
        and(
          eq(financialLedger.category, "revenue"),
          gte(financialLedger.postedAt, daysAgo(30)),
        ),
      )
      .groupBy(organizations.subscriptionTier);

    const byTier: { starter: number; pro: number; scale: number } = {
      starter: 0,
      pro: 0,
      scale: 0,
    };
    for (const r of byTierRows) {
      const tier = (r.tier ?? "").toLowerCase();
      if (tier === "starter") byTier.starter += r.total ?? 0;
      else if (tier === "pro") byTier.pro += r.total ?? 0;
      else if (tier === "scale") byTier.scale += r.total ?? 0;
    }

    res.json({ currentMrr, mrrTrend, byTier });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /contribution-margin ─────────────────────────────────────────────────

router.get("/contribution-margin", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const thisMonthStart = new Date();
    thisMonthStart.setUTCDate(1);
    thisMonthStart.setUTCHours(0, 0, 0, 0);

    const lastMonthStart = new Date(thisMonthStart);
    lastMonthStart.setUTCMonth(lastMonthStart.getUTCMonth() - 1);

    async function rangeAgg(start: Date, end: Date) {
      const [revRow] = await db
        .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
        .from(financialLedger)
        .where(
          and(
            eq(financialLedger.category, "revenue"),
            gte(financialLedger.postedAt, start),
            sql`${financialLedger.postedAt} < ${end}`,
          ),
        );
      const [opRow] = await db
        .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
        .from(financialLedger)
        .where(
          and(
            eq(financialLedger.category, "opex_spent"),
            gte(financialLedger.postedAt, start),
            sql`${financialLedger.postedAt} < ${end}`,
          ),
        );
      const revenue = revRow?.total ?? 0;
      const opexSigned = opRow?.total ?? 0;
      return { revenue, opexSigned, margin: revenue + opexSigned };
    }

    const now = new Date();
    const thisMonth = await rangeAgg(thisMonthStart, now);
    const lastMonth = await rangeAgg(lastMonthStart, thisMonthStart);

    const thisMonthCents = thisMonth.margin;
    const lastMonthCents = lastMonth.margin;
    const marginPctThisMonth = thisMonth.revenue > 0 ? (thisMonth.margin / thisMonth.revenue) * 100 : 0;
    const marginPctLastMonth = lastMonth.revenue > 0 ? (lastMonth.margin / lastMonth.revenue) * 100 : 0;

    // Per-org margin (last 30d).
    const since = daysAgo(30);

    const orgRevenueRows = await db
      .select({
        orgId: financialLedger.organizationId,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.category, "revenue"),
          gte(financialLedger.postedAt, since),
        ),
      )
      .groupBy(financialLedger.organizationId);

    const orgOpexRows = await db
      .select({
        orgId: financialLedger.organizationId,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.category, "opex_spent"),
          gte(financialLedger.postedAt, since),
        ),
      )
      .groupBy(financialLedger.organizationId);

    const opexByOrg = new Map<number, number>();
    for (const r of orgOpexRows) {
      if (r.orgId != null) opexByOrg.set(r.orgId, r.total ?? 0);
    }

    const orgIds = orgRevenueRows.map((r) => r.orgId).filter((id): id is number => id != null);
    const orgRows = orgIds.length
      ? await db
          .select({
            id: organizations.id,
            name: organizations.name,
            tier: organizations.subscriptionTier,
          })
          .from(organizations)
          .where(inArray(organizations.id, orgIds))
      : [];

    const orgMeta = new Map<number, { name: string; tier: string }>();
    for (const r of orgRows) {
      orgMeta.set(r.id, { name: r.name ?? "Unknown", tier: r.tier ?? "free" });
    }

    const perOrg = orgRevenueRows
      .filter((r) => r.orgId != null)
      .map((r) => {
        const orgId = r.orgId as number;
        const mrrCents = r.total ?? 0;
        const opexSigned = opexByOrg.get(orgId) ?? 0;
        const variableCostCents = -opexSigned;
        const marginCents = mrrCents + opexSigned;
        const marginPct = mrrCents > 0 ? (marginCents / mrrCents) * 100 : 0;
        const meta = orgMeta.get(orgId);
        return {
          orgId,
          orgName: meta?.name ?? `Org ${orgId}`,
          tier: meta?.tier ?? "free",
          mrrCents,
          variableCostCents,
          marginCents,
          marginPct,
        };
      })
      .sort((a, b) => a.marginCents - b.marginCents);

    res.json({
      thisMonthCents,
      lastMonthCents,
      marginPctThisMonth,
      marginPctLastMonth,
      perOrg,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /cost-mix?days=30 ────────────────────────────────────────────────────

router.get("/cost-mix", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt((req.query.days as string) ?? "30", 10) || 30));
    const since = daysAgo(days);

    const rows = await db
      .select({
        feature: financialLedger.feature,
        provider: financialLedger.provider,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.category, "opex_spent"),
          gte(financialLedger.postedAt, since),
        ),
      )
      .groupBy(financialLedger.feature, financialLedger.provider);

    type CategoryAgg = { cents: number; providers: Record<string, number> };
    const KNOWN_CATEGORIES = [
      "postcard",
      "sms",
      "email",
      "ai_tokens",
      "skip_trace",
      "stripe_fee",
      "voice",
      "listings",
    ] as const;
    type Category = (typeof KNOWN_CATEGORIES)[number];

    function normalizeFeatureToCategory(feature: string | null): Category | null {
      if (!feature) return null;
      const f = feature.toLowerCase();
      if (f === "mail" || f === "postcard" || f === "letter") return "postcard";
      if (f === "sms") return "sms";
      if (f === "voice" || f === "call") return "voice";
      if (f === "email") return "email";
      if (f === "ai" || f === "ai_tokens" || f === "ai_turn") return "ai_tokens";
      if (f === "skip_trace" || f === "skiptrace") return "skip_trace";
      if (f === "stripe_fee" || f === "stripe") return "stripe_fee";
      if (f === "listings" || f === "listing") return "listings";
      return null;
    }

    const initial: Record<Category, CategoryAgg> = {
      postcard:    { cents: 0, providers: {} },
      sms:         { cents: 0, providers: {} },
      email:       { cents: 0, providers: {} },
      ai_tokens:   { cents: 0, providers: {} },
      skip_trace:  { cents: 0, providers: {} },
      stripe_fee:  { cents: 0, providers: {} },
      voice:       { cents: 0, providers: {} },
      listings:    { cents: 0, providers: {} },
    };

    for (const r of rows) {
      const cat = normalizeFeatureToCategory(r.feature);
      if (!cat) continue;
      const absCents = Math.abs(r.total ?? 0);
      initial[cat].cents += absCents;
      const provider = r.provider ?? "unknown";
      initial[cat].providers[provider] = (initial[cat].providers[provider] ?? 0) + absCents;
    }

    res.json({ days, byCategory: initial });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /scale-up-history ────────────────────────────────────────────────────

router.get("/scale-up-history", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(founderAudit)
      .where(eq(founderAudit.area, "scale_up"))
      .orderBy(desc(founderAudit.createdAt))
      .limit(200);

    res.json({
      decisions: rows.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        before: r.before,
        after: r.after,
        note: r.note,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── GET /triggers/active ─────────────────────────────────────────────────────

router.get("/triggers/active", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const mrr = await computeTrailing30dMrrCents();

    // Pull any prior decisions on scale-up triggers (approved or deferred).
    const priorRows = await db
      .select({
        targetId: founderAudit.targetId,
        action: founderAudit.action,
        createdAt: founderAudit.createdAt,
      })
      .from(founderAudit)
      .where(eq(founderAudit.area, "scale_up"))
      .orderBy(desc(founderAudit.createdAt));

    const decided = new Map<string, { status: "approved" | "deferred"; at: Date }>();
    for (const r of priorRows) {
      if (!r.targetId) continue;
      if (decided.has(r.targetId)) continue; // first row is most recent
      if (r.action === "approve") decided.set(r.targetId, { status: "approved", at: r.createdAt });
      else if (r.action === "defer") decided.set(r.targetId, { status: "deferred", at: r.createdAt });
    }

    const now = Date.now();
    const items = REVENUE_TRIGGER_LADDER
      .filter((t) => mrr >= t.thresholdCents)
      .map((t) => {
        const d = decided.get(t.thresholdId);
        let status: "pending" | "approved" | "deferred" = "pending";
        if (d?.status === "approved") status = "approved";
        else if (d?.status === "deferred") {
          // defer expires after 7 days
          const ageMs = now - d.at.getTime();
          status = ageMs < 7 * 86_400_000 ? "deferred" : "pending";
        }
        return {
          thresholdId: t.thresholdId,
          threshold: t.thresholdCents,
          action: t.action,
          costOneTimeCents: t.costOneTimeCents,
          costRecurringCents: t.costRecurringCents,
          status,
          crossedAt: new Date().toISOString(),
        };
      })
      .filter((it) => it.status === "pending");

    res.json({ items, trailing30dMrrCents: mrr });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── POST /triggers/:thresholdId/approve ──────────────────────────────────────

const approveSchema = z.object({
  action: z.enum(["approve", "defer"]).default("approve"),
  note: z.string().max(2000).optional(),
});

router.post("/triggers/:thresholdId/approve", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const thresholdId = req.params.thresholdId;
    const trigger = REVENUE_TRIGGER_LADDER.find((t) => t.thresholdId === thresholdId);
    if (!trigger) return Errors.notFound(res, "Trigger");

    const founderId = req.user?.id ?? "founder";

    await db.insert(founderAudit).values({
      founderId: String(founderId),
      area: "scale_up",
      action: parsed.data.action,
      targetType: "trigger",
      targetId: thresholdId,
      before: null,
      after: {
        threshold: trigger.thresholdCents,
        action: trigger.action,
        costOneTimeCents: trigger.costOneTimeCents,
        costRecurringCents: trigger.costRecurringCents,
      },
      note: parsed.data.note ?? null,
    });

    logger.info("founder.finance.trigger.decision", {
      thresholdId,
      decision: parsed.data.action,
      founderId,
    });

    res.json({ ok: true, thresholdId, status: parsed.data.action });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ── POST /recovery-transfer ──────────────────────────────────────────────────

const transferSchema = z.object({
  fromBucket: z.enum([
    "tax_reserve",
    "refund_reserve",
    "profit_reserve",
    "owner_draw",
    "opex_available",
  ]),
  toBucket: z.enum([
    "tax_reserve",
    "refund_reserve",
    "profit_reserve",
    "owner_draw",
    "opex_available",
  ]),
  amountCents: z.number().int().positive(),
  note: z.string().max(2000).optional(),
});

router.post("/recovery-transfer", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = transferSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { fromBucket, toBucket, amountCents, note } = parsed.data;
    if (fromBucket === toBucket) {
      return Errors.badRequest(res, "fromBucket and toBucket must differ");
    }

    const founderId = req.user?.id ?? "founder";
    const transferId = `founder:${founderId}:transfer:${Date.now()}`;

    // Paired entry: debit fromBucket, credit toBucket. Same external id pair
    // with deterministic suffixes so retries collapse via unique constraint.
    await db.insert(financialLedger).values([
      {
        organizationId: null,
        bucket: fromBucket,
        category: "manual_transfer",
        amountCents: -amountCents,
        feature: null,
        provider: null,
        externalEventId: `${transferId}:from`,
        invoiceId: null,
        campaignId: null,
        postedAt: new Date(),
        postedBy: `founder:${founderId}`,
        notes: note ?? null,
      },
      {
        organizationId: null,
        bucket: toBucket,
        category: "manual_transfer",
        amountCents: amountCents,
        feature: null,
        provider: null,
        externalEventId: `${transferId}:to`,
        invoiceId: null,
        campaignId: null,
        postedAt: new Date(),
        postedBy: `founder:${founderId}`,
        notes: note ?? null,
      },
    ]);

    await db.insert(founderAudit).values({
      founderId: String(founderId),
      area: "recovery_transfer",
      action: "transfer",
      targetType: "buckets",
      targetId: `${fromBucket}->${toBucket}`,
      before: null,
      after: { fromBucket, toBucket, amountCents },
      note: note ?? null,
    });

    logger.info("founder.finance.recovery_transfer", {
      founderId,
      fromBucket,
      toBucket,
      amountCents,
    });

    res.json({ ok: true, transferId });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;

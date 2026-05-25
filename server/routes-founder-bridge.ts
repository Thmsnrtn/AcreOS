/**
 * Founder Bridge — single-shot data endpoint for /founder/bridge.
 *
 * GET /api/founder/bridge
 *
 * The Bridge surface is intentionally narrow (one hero, three telemetry
 * tiles, one action queue, one agent row) so it gets one endpoint
 * instead of five. Computes everything in parallel; falls back to
 * graceful nulls when a metric isn't computable so the tile renders a
 * dash rather than crashing.
 *
 * Mounted at /api/founder/bridge in server/routes.ts.
 *
 * Source mapping:
 *   - MRR              → sum monthlyRevenueCentsFor(org) for active orgs
 *                        (matches /api/founder/executive-dashboard exactly)
 *   - MRR sparkline    → daily count of active orgs over the last 30 days
 *                        weighted by their tier. Approximation; if
 *                        mrr_snapshots exists later we swap it in.
 *   - Active leads     → COUNT(leads) WHERE status NOT IN ('dead','closed')
 *   - Leads sparkline  → daily new-lead count for trailing 7 days
 *   - Pipeline value   → SUM(deals.offerAmount) for active-stage deals
 *   - Runway           → cashOnHand / (30-day net burn /30) — months
 *   - Agents           → distinct eventSource buckets in agent_events
 *                        over trailing 24h, normalised to the 4 canonical
 *                        agent codenames the founder recognises.
 *   - Action queue     → empty for v1; future hook from
 *                        /api/founder/intelligence/todo.
 */

import { Router, type Response } from "express";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  organizations,
  leads,
  deals,
  agentEvents,
  financialLedger,
} from "@shared/schema";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const router = Router();

export interface BridgePayload {
  generatedAt: string;
  hero: {
    label: "MRR";
    valueCents: number;
    deltaPct: number | null;
    deltaLabel: string;
    sparkline: number[]; // daily MRR (cents) for trailing 30 days
  };
  telemetry: {
    activeLeads: { count: number; sparkline: number[] };
    pipeline: { valueCents: number | null; activeDealCount: number };
    runway: { months: number | null; cashOnHandCents: number | null };
  };
  agents: Array<{
    codename: string;
    healthPct: number | null;
    status: "active" | "idle" | "down";
  }>;
  agentsLastSyncAt: string;
  actionQueue: Array<{
    id: string;
    title: string;
    meta?: string;
    tone: "neutral" | "info" | "warn";
    href?: string;
    discussPrefill?: string;
  }>;
  aiBudget: {
    totalCapCents: number;
    totalSpentCents: number;
    totalRemainingCents: number;
    pctSpent: number; // 0-100
    categories: Array<{
      category: string;
      capCents: number;
      spentCents: number;
      pctSpent: number;
      calls: number;
      exceededAt: string | null;
    }>;
  };
}

const ACTIVE_LEAD_STATUSES_EXCLUDED = ["dead", "closed"];
const ACTIVE_DEAL_STATUSES = ["negotiating", "offer_sent", "countered", "accepted", "in_escrow"];

const CANONICAL_AGENTS = ["Pax", "Sophie", "Forge", "Atlas"] as const;

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.isFounder) {
    return Errors.forbidden(res, "Bridge is restricted to founders");
  }

  try {
    const now = new Date();
    const t30 = new Date(now.getTime() - 30 * 24 * 3_600_000);
    const t60 = new Date(now.getTime() - 60 * 24 * 3_600_000);
    const t7 = new Date(now.getTime() - 7 * 24 * 3_600_000);
    const t24h = new Date(now.getTime() - 24 * 3_600_000);

    // ── parallel reads ────────────────────────────────────────────────
    // Each query is wrapped so a schema drift / missing-column error in
    // one source produces an empty result for that tile rather than
    // collapsing the whole payload. Surfaces missing-data as a graceful
    // dash on the client.
    const safe = async <T>(p: Promise<T>, fallback: T, label: string): Promise<T> => {
      try {
        return await p;
      } catch (err: any) {
        logger.warn(`[bridge] source '${label}' failed; returning fallback`, { metadata: { err: err?.message } });
        return fallback;
      }
    };

    const [
      activeOrgsRaw,
      activeLeadCountRow,
      leads7d,
      activeDealsRaw,
      ledger30d,
      ledger60to30,
      agentEvents24h,
    ] = await Promise.all([
      safe(
        // Select only the columns we need so a partially-drifted
        // organizations schema (missing newer columns) still returns
        // useful rows for MRR + sparkline.
        db.select({
          createdAt: organizations.createdAt,
          subscriptionTier: organizations.subscriptionTier,
          subscriptionStatus: organizations.subscriptionStatus,
          billingInterval: organizations.billingInterval,
        }).from(organizations).where(eq(organizations.subscriptionStatus, "active")).limit(10_000),
        [] as any[],
        "organizations",
      ),
      safe(
        db.select({ n: count() }).from(leads).where(sql`${leads.status} NOT IN ('dead','closed')`),
        [{ n: 0 }] as Array<{ n: number }>,
        "leads-count",
      ),
      safe(
        db.select({ createdAt: leads.createdAt }).from(leads).where(gte(leads.createdAt, t7)).limit(50_000),
        [] as Array<{ createdAt: Date | null }>,
        "leads-7d",
      ),
      safe(
        db.select({ offerAmount: deals.offerAmount }).from(deals)
          .where(inArray(deals.status, ACTIVE_DEAL_STATUSES)).limit(10_000),
        [] as Array<{ offerAmount: string | null }>,
        "deals",
      ),
      safe(
        db.select({ amountCents: financialLedger.amountCents, category: financialLedger.category })
          .from(financialLedger).where(gte(financialLedger.postedAt, t30)).limit(100_000),
        [] as Array<{ amountCents: number; category: string }>,
        "ledger-30d",
      ),
      safe(
        db.select({ amountCents: financialLedger.amountCents, category: financialLedger.category })
          .from(financialLedger)
          .where(and(gte(financialLedger.postedAt, t60), sql`${financialLedger.postedAt} < ${t30}`)).limit(100_000),
        [] as Array<{ amountCents: number; category: string }>,
        "ledger-60to30",
      ),
      safe(
        db.select({ eventSource: agentEvents.eventSource, createdAt: agentEvents.createdAt })
          .from(agentEvents).where(gte(agentEvents.createdAt, t24h)).limit(50_000),
        [] as Array<{ eventSource: string; createdAt: Date | null }>,
        "agent-events",
      ),
    ]);

    // ── hero (MRR) ────────────────────────────────────────────────────
    const currentMrrCents = activeOrgsRaw.reduce((s, o) => {
      const interval = (o.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
      return s + monthlyRevenueCentsFor(o.subscriptionTier, interval);
    }, 0);

    // 30-day "ago" MRR — exclude orgs that activated within the trailing
    // 30d window. Not perfect (doesn't model churn during the window)
    // but better than nothing for a v1 delta.
    const mrr30dAgoCents = activeOrgsRaw
      .filter((o) => o.createdAt && new Date(o.createdAt) < t30)
      .reduce((s, o) => {
        const interval = (o.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
        return s + monthlyRevenueCentsFor(o.subscriptionTier, interval);
      }, 0);
    const deltaPct = mrr30dAgoCents > 0
      ? ((currentMrrCents - mrr30dAgoCents) / mrr30dAgoCents) * 100
      : null;

    // MRR sparkline — daily snapshot of orgs that were active on each
    // day, weighted by tier. Approximated by counting orgs whose
    // createdAt ≤ day cutoff (we don't track explicit deactivation
    // dates per-day). Good enough for shape, not for forensics.
    const mrrSparkline = buildMrrSparkline(activeOrgsRaw, 30, now);

    // ── leads ─────────────────────────────────────────────────────────
    const activeLeads = Number(activeLeadCountRow[0]?.n ?? 0);
    const leadsSparkline = bucketByDay(leads7d.map((r) => r.createdAt).filter((d): d is Date => !!d), 7, now);

    // ── pipeline ──────────────────────────────────────────────────────
    const pipelineValueCents = activeDealsRaw.reduce((s, d) => {
      const v = d.offerAmount ? Number(d.offerAmount) : 0;
      return s + Math.round(v * 100);
    }, 0);

    // ── runway ────────────────────────────────────────────────────────
    let runwayMonths: number | null = null;
    let cashOnHandCents: number | null = null;
    {
      const flow30 = ledger30d.reduce((s, r) => s + Number(r.amountCents), 0);
      const flow60to30 = ledger60to30.reduce((s, r) => s + Number(r.amountCents), 0);
      const monthlyNet = flow30; // signed cents (positive = surplus)
      // "Cash on hand" proxy: cumulative ledger over the last 60d. Real
      // cash position lives in Stripe / bank — out of scope for v1.
      cashOnHandCents = flow30 + flow60to30;
      if (monthlyNet < 0 && cashOnHandCents > 0) {
        runwayMonths = Math.max(0, Math.floor(cashOnHandCents / -monthlyNet));
      } else if (monthlyNet >= 0) {
        // Net-positive — surface ∞ but the client renders this as "—"
        // with a small caption. Keep API honest with a null.
        runwayMonths = null;
      }
    }

    // ── agents ────────────────────────────────────────────────────────
    const agentCounts = new Map<string, number>();
    for (const evt of agentEvents24h) {
      agentCounts.set(evt.eventSource, (agentCounts.get(evt.eventSource) ?? 0) + 1);
    }
    const agentsOut: BridgePayload["agents"] = CANONICAL_AGENTS.map((codename) => {
      const lower = codename.toLowerCase();
      // Try both exact and lowercase keys for resilience to how callers tag.
      const evCount = (agentCounts.get(codename) ?? 0) + (agentCounts.get(lower) ?? 0);
      const status: "active" | "idle" | "down" = evCount > 0 ? "active" : "idle";
      // Health % is a rough proxy: 100 when active in last hour-equivalent,
      // tapering as activity drops. v1 keeps it simple — active → 100, idle → null.
      const healthPct = status === "active" ? 100 : null;
      return { codename, healthPct, status };
    });

    // Frugal Autonomy tile data — today's per-category AI spend.
    // Wrapped in a safe() so a budget module hiccup doesn't take down
    // the whole Bridge payload.
    const budgetSnapshot = await safe(
      (async () => {
        const { getTodayBudgetSnapshot } = await import("./services/intelligence/budget");
        return getTodayBudgetSnapshot();
      })(),
      [] as Awaited<ReturnType<typeof import("./services/intelligence/budget").getTodayBudgetSnapshot>>,
      "ai_budget",
    );
    const totalCapCents = budgetSnapshot.reduce((s, r) => s + r.capCents, 0);
    const totalSpentCents = budgetSnapshot.reduce((s, r) => s + r.spentCents, 0);

    const payload: BridgePayload = {
      generatedAt: now.toISOString(),
      hero: {
        label: "MRR",
        valueCents: currentMrrCents,
        deltaPct: deltaPct == null ? null : Math.round(deltaPct * 10) / 10,
        deltaLabel: "vs 30 days ago",
        sparkline: mrrSparkline,
      },
      telemetry: {
        activeLeads: { count: activeLeads, sparkline: leadsSparkline },
        pipeline: { valueCents: pipelineValueCents > 0 ? pipelineValueCents : null, activeDealCount: activeDealsRaw.length },
        runway: { months: runwayMonths, cashOnHandCents },
      },
      agents: agentsOut,
      agentsLastSyncAt: now.toISOString(),
      actionQueue: [], // v1 — wired to /api/founder/intelligence/todo next iteration
      aiBudget: {
        totalCapCents,
        totalSpentCents,
        totalRemainingCents: Math.max(0, totalCapCents - totalSpentCents),
        pctSpent: totalCapCents > 0 ? Math.min(100, Math.round((totalSpentCents / totalCapCents) * 100)) : 0,
        categories: budgetSnapshot.map((r) => ({
          category: r.category,
          capCents: r.capCents,
          spentCents: r.spentCents,
          pctSpent: r.capCents > 0 ? Math.min(100, Math.round((r.spentCents / r.capCents) * 100)) : 0,
          calls: r.calls,
          exceededAt: r.exceededAt ? r.exceededAt.toISOString() : null,
        })),
      },
    };

    res.json(payload);
  } catch (err: any) {
    logger.error("[bridge] failed to assemble payload", { metadata: { error: err?.message } });
    return Errors.internal(res, err);
  }
});

/**
 * Bucket a list of timestamps into N daily counts ending at `now`.
 * Returns an array length N; index 0 is oldest day, index N-1 is today.
 */
function bucketByDay(dates: Date[], days: number, now: Date): number[] {
  const buckets = new Array(days).fill(0);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const d of dates) {
    const dayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const ageDays = Math.floor((todayMidnight - dayMidnight) / (24 * 3_600_000));
    const idx = days - 1 - ageDays;
    if (idx >= 0 && idx < days) buckets[idx]++;
  }
  return buckets;
}

/**
 * Build an N-day MRR sparkline by walking each day's "what orgs were
 * active on this day" set. Approximation — uses createdAt as activation
 * proxy and current subscriptionStatus as a static lens. Real fidelity
 * needs an mrr_snapshots table; until then this gives a useful shape.
 */
function buildMrrSparkline(
  orgs: Array<{ createdAt: Date | null; subscriptionTier: string | null; billingInterval: string | null; subscriptionStatus: string | null }>,
  days: number,
  now: Date,
): number[] {
  const points: number[] = [];
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (let i = days - 1; i >= 0; i--) {
    const cutoff = new Date(todayMidnight - i * 24 * 3_600_000);
    const sum = orgs.reduce((s, o) => {
      if (!o.createdAt || new Date(o.createdAt) > cutoff) return s;
      // Status filter only excludes orgs that are currently inactive AND
      // were created before the cutoff — coarse but consistent.
      if (o.subscriptionStatus !== "active") return s;
      const interval = (o.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
      return s + monthlyRevenueCentsFor(o.subscriptionTier ?? "", interval);
    }, 0);
    points.push(sum);
  }
  return points;
}

export default router;

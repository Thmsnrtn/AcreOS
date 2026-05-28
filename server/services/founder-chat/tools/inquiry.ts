/**
 * Atlas inquiry tools — Tier 1, non-destructive reads.
 *
 * Sixteen tools wrap the existing /api/founder/* read endpoints. Tools
 * call the underlying services/db queries directly (not via HTTP) to
 * avoid loop-back latency. Each returns a `ToolResult` whose artifact
 * type matches the union in tool-registry.ts.
 *
 * See /Users/user/.claude/plans/how-can-we-either-ticklish-ocean.md for
 * the canonical 40-tool spec.
 */

import { z } from "zod";
import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import {
  financialLedger,
  organizations,
  founderAudit,
  outboxDlq,
  decisionsInboxItems,
} from "@shared/schema";
import { db } from "../../../db";
import { registerTool } from "../tool-registry";

const REVENUE_TRIGGER_LADDER = [
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

// ─── 1. get_buckets ─────────────────────────────────────────────────────────
registerTool({
  name: "get_buckets",
  description: "Return the 5-bucket financial-ledger balances (tax/refund/profit/owner/opex).",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "bucket_chart",
  slashAliases: ["buckets"],
  async handler() {
    const rows = await db
      .select({
        bucket: financialLedger.bucket,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .groupBy(financialLedger.bucket);
    const balances: Record<string, number> = {
      tax_reserve: 0, refund_reserve: 0, profit_reserve: 0, owner_draw: 0, opex_available: 0,
    };
    for (const r of rows) {
      if (r.bucket) balances[r.bucket] = r.total ?? 0;
    }
    return {
      artifact: {
        type: "bucket_chart",
        data: {
          taxReserve: balances.tax_reserve,
          refundReserve: balances.refund_reserve,
          profitReserve: balances.profit_reserve,
          ownerDraw: balances.owner_draw,
          opexAvailable: balances.opex_available,
          asOf: new Date().toISOString(),
        },
      },
    };
  },
});

// ─── 2. get_mrr_trend ──────────────────────────────────────────────────────
registerTool({
  name: "get_mrr_trend",
  description: "Return the trailing-N-day MRR trend (daily series and current trailing 30d).",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ days: z.number().int().positive().max(365).optional() }),
  artifactType: "mrr_sparkline",
  slashAliases: ["mrr"],
  async handler(args) {
    const days = args.days ?? 90;
    const since = daysAgo(days);
    const rows = await db
      .select({
        day: sql<string>`date_trunc('day', ${financialLedger.postedAt})::date::text`,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, since)))
      .groupBy(sql`date_trunc('day', ${financialLedger.postedAt})`)
      .orderBy(sql`date_trunc('day', ${financialLedger.postedAt})`);
    return {
      artifact: {
        type: "mrr_sparkline",
        series: rows.map((r) => ({ date: r.day, cents: r.total ?? 0 })),
        days,
      },
    };
  },
});

// ─── 3. get_contribution_margin_per_org ────────────────────────────────────
registerTool({
  name: "get_contribution_margin_per_org",
  description: "Per-org contribution margin over last 30 days. Filter: 'all' or 'net_negative'.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ filter: z.enum(["all", "net_negative"]).optional() }),
  artifactType: "org_table",
  async handler(args) {
    const since = daysAgo(30);
    const orgRevenueRows = await db
      .select({ orgId: financialLedger.organizationId, total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, since)))
      .groupBy(financialLedger.organizationId);
    const orgOpexRows = await db
      .select({ orgId: financialLedger.organizationId, total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "opex_spent"), gte(financialLedger.postedAt, since)))
      .groupBy(financialLedger.organizationId);
    const opexByOrg = new Map<number, number>();
    for (const r of orgOpexRows) if (r.orgId != null) opexByOrg.set(r.orgId, r.total ?? 0);
    const orgIds = orgRevenueRows.map((r) => r.orgId).filter((id): id is number => id != null);
    const orgRows = orgIds.length
      ? await db.select({ id: organizations.id, name: organizations.name, tier: organizations.subscriptionTier })
          .from(organizations).where(sql`${organizations.id} = ANY(${orgIds})`)
      : [];
    const orgMeta = new Map(orgRows.map((r) => [r.id, { name: r.name ?? "Unknown", tier: r.tier ?? "free" }]));
    let perOrg = orgRevenueRows
      .filter((r): r is { orgId: number; total: number } => r.orgId != null)
      .map((r) => {
        const mrrCents = r.total ?? 0;
        const opexSigned = opexByOrg.get(r.orgId) ?? 0;
        const marginCents = mrrCents + opexSigned;
        const meta = orgMeta.get(r.orgId);
        return {
          orgId: r.orgId,
          orgName: meta?.name ?? `Org ${r.orgId}`,
          tier: meta?.tier ?? "free",
          mrrCents,
          variableCostCents: -opexSigned,
          marginCents,
          marginPct: mrrCents > 0 ? (marginCents / mrrCents) * 100 : 0,
        };
      })
      .sort((a, b) => a.marginCents - b.marginCents);
    if (args.filter === "net_negative") perOrg = perOrg.filter((r) => r.marginCents < 0);
    return { artifact: { type: "org_table", rows: perOrg, filter: args.filter ?? "all" } };
  },
});

// ─── 4. get_cost_mix ───────────────────────────────────────────────────────
registerTool({
  name: "get_cost_mix",
  description: "Cost mix by category (postcard/sms/email/ai/etc.) over the last N days.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ days: z.number().int().positive().max(365).optional(), category: z.string().optional() }),
  artifactType: "cost_mix_pie",
  async handler(args) {
    const days = args.days ?? 30;
    const since = daysAgo(days);
    const rows = await db
      .select({
        feature: financialLedger.feature,
        provider: financialLedger.provider,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "opex_spent"), gte(financialLedger.postedAt, since)))
      .groupBy(financialLedger.feature, financialLedger.provider);
    type Agg = { cents: number; providers: Record<string, number> };
    const cats: Record<string, Agg> = {};
    for (const r of rows) {
      const cat = (r.feature ?? "other").toLowerCase();
      if (args.category && cat !== args.category.toLowerCase()) continue;
      const abs = Math.abs(r.total ?? 0);
      cats[cat] ??= { cents: 0, providers: {} };
      cats[cat].cents += abs;
      const prov = r.provider ?? "unknown";
      cats[cat].providers[prov] = (cats[cat].providers[prov] ?? 0) + abs;
    }
    return { artifact: { type: "cost_mix_pie", data: cats, days } };
  },
});

// ─── 5. get_active_triggers ─────────────────────────────────────────────────
registerTool({
  name: "get_active_triggers",
  description: "Scale-up triggers crossed and still pending founder decision.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "trigger_card",
  slashAliases: ["triggers"],
  async handler() {
    const [mrrRow] = await db
      .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, daysAgo(30))));
    const mrr = mrrRow?.total ?? 0;
    const prior = await db.select({ targetId: founderAudit.targetId, action: founderAudit.action, createdAt: founderAudit.createdAt })
      .from(founderAudit).where(eq(founderAudit.area, "scale_up")).orderBy(desc(founderAudit.createdAt));
    const decided = new Map<string, { status: "approved" | "deferred"; at: Date }>();
    for (const r of prior) {
      if (!r.targetId || decided.has(r.targetId)) continue;
      if (r.action === "approve") decided.set(r.targetId, { status: "approved", at: r.createdAt! });
      else if (r.action === "defer") decided.set(r.targetId, { status: "deferred", at: r.createdAt! });
    }
    const now = Date.now();
    const items = REVENUE_TRIGGER_LADDER
      .filter((t) => mrr >= t.thresholdCents)
      .map((t) => {
        const d = decided.get(t.thresholdId);
        let status: "pending" | "approved" | "deferred" = "pending";
        if (d?.status === "approved") status = "approved";
        else if (d?.status === "deferred" && now - d.at.getTime() < 7 * 86_400_000) status = "deferred";
        return { ...t, status };
      })
      .filter((t) => t.status === "pending");
    return { artifact: { type: "trigger_card", items, trailing30dMrrCents: mrr } };
  },
});

// ─── 6. get_dlq_items ───────────────────────────────────────────────────────
registerTool({
  name: "get_dlq_items",
  description: "Current dead-letter-queue rows awaiting retry or discard.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "dlq_card",
  slashAliases: ["dlq"],
  async handler() {
    const rows = await db.select().from(outboxDlq).orderBy(desc(outboxDlq.movedToDlqAt)).limit(50);
    return { artifact: { type: "dlq_card", items: rows, total: rows.length } };
  },
});

// ─── 7. get_org_cost_detail ─────────────────────────────────────────────────
registerTool({
  name: "get_org_cost_detail",
  description: "Per-org cost detail: variable opex, recent cost events, BYOK status.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ org_id: z.number().int().positive(), days: z.number().int().positive().max(365).optional() }),
  artifactType: "org_cost_detail_card",
  async handler(args, ctx) {
    const orgId = args.org_id ?? ctx.currentOrgId;
    if (!orgId) {
      return { artifact: { type: "text", markdown: "No org id provided." } };
    }
    const days = args.days ?? 30;
    const since = daysAgo(days);
    const events = await db.select()
      .from(financialLedger)
      .where(and(eq(financialLedger.organizationId, orgId), gte(financialLedger.postedAt, since)))
      .orderBy(desc(financialLedger.postedAt))
      .limit(100);
    const [orgRow] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    let revenueCents = 0, opexCents = 0;
    for (const e of events) {
      if (e.category === "revenue") revenueCents += e.amountCents ?? 0;
      else if (e.category === "opex_spent") opexCents += e.amountCents ?? 0;
    }
    return {
      artifact: {
        type: "org_cost_detail_card",
        data: {
          orgId,
          orgName: orgRow?.name ?? `Org ${orgId}`,
          windowDays: days,
          revenueCents,
          variableCostCents: -opexCents,
          marginCents: revenueCents + opexCents,
          events: events.slice(0, 25),
        },
      },
    };
  },
});

// ─── 8. get_provider_summary ────────────────────────────────────────────────
registerTool({
  name: "get_provider_summary",
  description: "Per-provider spend summary over last N days.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ provider: z.string().min(1), days: z.number().int().positive().max(365).optional() }),
  artifactType: "provider_card",
  async handler(args) {
    const days = args.days ?? 30;
    const since = daysAgo(days);
    const [row] = await db
      .select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(
        eq(financialLedger.provider, args.provider.toLowerCase()),
        gte(financialLedger.postedAt, since),
      ));
    const trend = await db
      .select({
        day: sql<string>`date_trunc('day', ${financialLedger.postedAt})::date::text`,
        total: sum(financialLedger.amountCents).mapWith(Number),
      })
      .from(financialLedger)
      .where(and(
        eq(financialLedger.provider, args.provider.toLowerCase()),
        gte(financialLedger.postedAt, since),
      ))
      .groupBy(sql`date_trunc('day', ${financialLedger.postedAt})`)
      .orderBy(sql`date_trunc('day', ${financialLedger.postedAt})`);
    return {
      artifact: {
        type: "provider_card",
        summary: {
          provider: args.provider.toLowerCase(),
          days,
          totalCents: Math.abs(row?.total ?? 0),
          trend: trend.map((r) => ({ date: r.day, cents: Math.abs(r.total ?? 0) })),
        },
      },
    };
  },
});

// ─── 9. get_cost_event_provenance ───────────────────────────────────────────
registerTool({
  name: "get_cost_event_provenance",
  description: "Trace a single financial_ledger row back to its source action.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ ledger_id: z.number().int().positive() }),
  artifactType: "cost_event_card",
  async handler(args) {
    const [row] = await db.select().from(financialLedger).where(eq(financialLedger.id, args.ledger_id)).limit(1);
    if (!row) return { artifact: { type: "text", markdown: `Ledger row ${args.ledger_id} not found.` } };
    return { artifact: { type: "cost_event_card", ledgerRow: row } };
  },
});

// ─── 10. get_decision_queue ─────────────────────────────────────────────────
registerTool({
  name: "get_decision_queue",
  description: "Current decisions awaiting founder approval.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ filter: z.string().optional() }),
  artifactType: "decision_card",
  slashAliases: ["decisions"],
  async handler() {
    try {
      const items = await db.select().from(decisionsInboxItems)
        .where(eq(decisionsInboxItems.status, "pending"))
        .orderBy(desc(decisionsInboxItems.createdAt))
        .limit(50);
      return { artifact: { type: "decision_card", items, total: items.length } };
    } catch {
      return { artifact: { type: "decision_card", items: [], total: 0 } };
    }
  },
});

// ─── 11. get_agent_status ───────────────────────────────────────────────────
registerTool({
  name: "get_agent_status",
  description: "Status, recent activity and trust for a named agent (sophie/forge/etc.).",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ codename: z.string().min(1) }),
  artifactType: "agent_card",
  async handler(args) {
    try {
      const { companyAgentService } = await import("../../companyAgents");
      const agent = await companyAgentService.getByCodename(args.codename);
      return {
        artifact: {
          type: "agent_card",
          agent: agent ?? { codename: args.codename, status: "unknown" },
        },
      };
    } catch (err) {
      return { artifact: { type: "text", markdown: `Agent ${args.codename} not found: ${String(err)}` } };
    }
  },
});

// ─── 12. search_orgs ────────────────────────────────────────────────────────
registerTool({
  name: "search_orgs",
  description: "Search organizations by name/email substring.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ query: z.string().min(1).max(200) }),
  artifactType: "org_card",
  async handler(args) {
    const q = `%${args.query.toLowerCase()}%`;
    const rows = await db.select({
      id: organizations.id, name: organizations.name, tier: organizations.subscriptionTier,
    }).from(organizations)
      .where(sql`lower(${organizations.name}) like ${q}`)
      .limit(20);
    return { artifact: { type: "org_card", items: rows, query: args.query } };
  },
});

// ─── 13. search_cost_events ─────────────────────────────────────────────────
registerTool({
  name: "search_cost_events",
  description: "Search financial_ledger by category/feature/provider substring.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ query: z.string().min(1).max(200) }),
  artifactType: "cost_event_card",
  async handler(args) {
    const q = `%${args.query.toLowerCase()}%`;
    const rows = await db.select().from(financialLedger)
      .where(sql`lower(coalesce(${financialLedger.feature}, '')) like ${q} or lower(coalesce(${financialLedger.provider}, '')) like ${q} or lower(coalesce(${financialLedger.category}, '')) like ${q}`)
      .orderBy(desc(financialLedger.postedAt))
      .limit(25);
    return { artifact: { type: "cost_event_card", items: rows, query: args.query } };
  },
});

// ─── 14. get_infra_status ───────────────────────────────────────────────────
registerTool({
  name: "get_infra_status",
  description: "Lightweight infra status snapshot (DB up, ledger fresh).",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "infra_status_card",
  slashAliases: ["infra"],
  async handler() {
    const [latest] = await db.select({ postedAt: financialLedger.postedAt })
      .from(financialLedger).orderBy(desc(financialLedger.postedAt)).limit(1);
    return {
      artifact: {
        type: "infra_status_card",
        data: {
          db: "ok",
          ledgerFreshness: latest?.postedAt ?? null,
          asOf: new Date().toISOString(),
        },
      },
    };
  },
});

// ─── 15. get_audit_log ──────────────────────────────────────────────────────
registerTool({
  name: "get_audit_log",
  description: "Recent founder_audit rows. Optional area filter + N days window.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({ area: z.string().optional(), days: z.number().int().positive().max(365).optional() }),
  artifactType: "audit_log_table",
  async handler(args) {
    const days = args.days ?? 7;
    const since = daysAgo(days);
    const conditions = [gte(founderAudit.createdAt, since)];
    if (args.area) conditions.push(eq(founderAudit.area, args.area));
    const rows = await db.select().from(founderAudit)
      .where(and(...conditions))
      .orderBy(desc(founderAudit.createdAt))
      .limit(200);
    return { artifact: { type: "audit_log_table", rows, days, area: args.area ?? null } };
  },
});

// ─── 16. get_morning_brief ─────────────────────────────────────────────────
registerTool({
  name: "get_morning_brief",
  description: "Composite morning brief — buckets + triggers + decisions + DLQ.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "brief_card",
  slashAliases: ["brief", "morning"],
  async handler() {
    // Compose via direct DB reads (cheaper than chained tool calls).
    const [bucketRows, triggerRow, decisionRows, dlqRows] = await Promise.all([
      db.select({ bucket: financialLedger.bucket, total: sum(financialLedger.amountCents).mapWith(Number) })
        .from(financialLedger).groupBy(financialLedger.bucket),
      db.select({ total: sum(financialLedger.amountCents).mapWith(Number) })
        .from(financialLedger)
        .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, daysAgo(30)))),
      db.select().from(decisionsInboxItems)
        .where(eq(decisionsInboxItems.status, "pending"))
        .orderBy(desc(decisionsInboxItems.createdAt)).limit(5).catch(() => []),
      db.select().from(outboxDlq).limit(5),
    ]);
    const balances: Record<string, number> = {
      tax_reserve: 0, refund_reserve: 0, profit_reserve: 0, owner_draw: 0, opex_available: 0,
    };
    for (const r of bucketRows) if (r.bucket) balances[r.bucket] = r.total ?? 0;
    return {
      artifact: {
        type: "brief_card",
        sections: [
          { title: "Buckets", data: balances },
          { title: "MRR (trailing 30d cents)", data: triggerRow[0]?.total ?? 0 },
          { title: "Pending decisions", data: decisionRows },
          { title: "DLQ items", data: dlqRows },
        ],
        asOf: new Date().toISOString(),
      },
    };
  },
});

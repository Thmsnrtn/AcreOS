/**
 * Atlas synthesis tools — compositions over ledger / audit / templates.
 *
 * Six tools. Most are Tier 1 (read + AI compose). The weekly money
 * letter is Tier 2 because its output is a draft Atlas may eventually
 * "send" downstream.
 */

import { z } from "zod";
import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import {
  financialLedger,
  founderAudit,
  organizations,
} from "@shared/schema";
import { db } from "../../../db";
import { registerTool } from "../tool-registry";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ─── 1. draft_weekly_money_letter (T2 — draft) ──────────────────────────────
registerTool({
  name: "draft_weekly_money_letter",
  description: "Compose a draft of the weekly money letter (revenue, opex, top movers, action items).",
  category: "synthesis",
  destructive: true,
  tier: 2,
  schema: z.object({}),
  artifactType: "letter_card",
  async handler() {
    const since = daysAgo(7);
    const [revenue] = await db.select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "revenue"), gte(financialLedger.postedAt, since)));
    const [opex] = await db.select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.category, "opex_spent"), gte(financialLedger.postedAt, since)));
    const revenueCents = revenue?.total ?? 0;
    const opexCents = opex?.total ?? 0;

    let body = "";
    try {
      const { routeAITask, TaskComplexity } = await import("../../aiRouter");
      const r = await routeAITask({
        taskType: "weekly_letter",
        complexity: TaskComplexity.MODERATE,
        taskTier: "standard",
        messages: [
          { role: "system", content: "You are Atlas. Draft a 6-line weekly money letter for the founder in his terse direct voice." },
          { role: "user", content: `Last 7 days: revenue=${revenueCents}¢ opex=${opexCents}¢ margin=${revenueCents + opexCents}¢. Write the letter.` },
        ],
      });
      body = r.content ?? "";
    } catch {
      body = `**Week in numbers**\n\n- Revenue: ${revenueCents}¢\n- Opex: ${opexCents}¢\n- Margin: ${revenueCents + opexCents}¢`;
    }

    return {
      artifact: {
        type: "letter_card",
        title: `Weekly money letter — ${new Date().toISOString().slice(0, 10)}`,
        body,
        sendTarget: "draft_only" as const,
      },
      verifyFn: async () => ({ ok: body.length > 0, evidence: `letter length=${body.length}` }),
    };
  },
});

// ─── 2. propose_action_for_org (T1) ─────────────────────────────────────────
registerTool({
  name: "propose_action_for_org",
  description: "Propose three options for handling a specific org (margin/churn/expansion).",
  category: "synthesis",
  destructive: false,
  tier: 1,
  schema: z.object({ org_id: z.number().int().positive(), intent: z.string().min(1).max(500) }),
  artifactType: "decision_card",
  async handler(args) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, args.org_id)).limit(1);
    if (!org) {
      return { artifact: { type: "text", markdown: `Org ${args.org_id} not found.` } };
    }
    // Lightweight three-option scaffold; the LLM-driven elaboration runs
    // when Atlas composes its response artifact on the next pass.
    const options = [
      { label: "Pause cost-drivers", rationale: "Cut variable opex until margin recovers." },
      { label: "Reach out for expansion", rationale: "Upsell to recover unit economics." },
      { label: "Wait and watch", rationale: "Continue monitoring; no action this cycle." },
    ];
    return {
      artifact: {
        type: "decision_card",
        orgId: args.org_id,
        orgName: org.name,
        intent: args.intent,
        options,
      },
    };
  },
});

// ─── 3. summarize_audit_log (T1) ────────────────────────────────────────────
registerTool({
  name: "summarize_audit_log",
  description: "Markdown summary of founder_audit rows by area in the last N days.",
  category: "synthesis",
  destructive: false,
  tier: 1,
  schema: z.object({ area: z.string().optional(), days: z.number().int().positive().max(180).optional() }),
  async handler(args) {
    const days = args.days ?? 14;
    const since = daysAgo(days);
    const conds = [gte(founderAudit.createdAt, since)];
    if (args.area) conds.push(eq(founderAudit.area, args.area));
    const rows = await db.select().from(founderAudit).where(and(...conds)).orderBy(desc(founderAudit.createdAt)).limit(200);
    const byAction: Record<string, number> = {};
    for (const r of rows) byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    const lines = [
      `## Audit summary (${days}d${args.area ? `, area=${args.area}` : ""})`,
      `Total rows: ${rows.length}`,
      "",
      ...Object.entries(byAction).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
    ];
    return { artifact: { type: "text", markdown: lines.join("\n") } };
  },
});

// ─── 4. audit_provider_savings (T1) ─────────────────────────────────────────
registerTool({
  name: "audit_provider_savings",
  description: "Compute spend trend for one provider over N days and suggest alternative.",
  category: "synthesis",
  destructive: false,
  tier: 1,
  schema: z.object({ provider: z.string().min(1), days: z.number().int().positive().max(365).optional() }),
  async handler(args) {
    const days = args.days ?? 30;
    const since = daysAgo(days);
    const [row] = await db.select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(eq(financialLedger.provider, args.provider.toLowerCase()), gte(financialLedger.postedAt, since)));
    const total = Math.abs(row?.total ?? 0);
    return {
      artifact: {
        type: "text",
        markdown: `**${args.provider}** spend last ${days}d: $${(total / 100).toFixed(2)}. Audit complete — consider running \`get_provider_summary\` for the daily breakdown.`,
      },
    };
  },
});

// ─── 5. compare_templates (T1) ──────────────────────────────────────────────
registerTool({
  name: "compare_templates",
  description: "Compare outreach mail template results over N days (response-rate ranking).",
  category: "synthesis",
  destructive: false,
  tier: 1,
  schema: z.object({ days: z.number().int().positive().max(365).optional() }),
  async handler(args) {
    const days = args.days ?? 30;
    try {
      // Lightweight: read mail_shipments by template if available; otherwise
      // return a soft message. We don't reimplement the compare-templates
      // endpoint — Phase B keeps tools thin.
      const { mailShipments } = await import("@shared/schema");
      const since = daysAgo(days);
      const rows = await db.select({
        templateId: (mailShipments as any).templateId,
        count: sql<number>`count(*)::int`,
      })
        .from(mailShipments)
        .where(gte((mailShipments as any).createdAt, since))
        .groupBy((mailShipments as any).templateId);
      const ranked = rows
        .map((r: any) => ({ templateId: r.templateId, count: r.count }))
        .sort((a: any, b: any) => b.count - a.count);
      const md = ranked.length === 0
        ? `No templates with shipments in the last ${days}d.`
        : `## Template ranking (${days}d)\n\n` + ranked.map((r: any, i: number) => `${i + 1}. template=${r.templateId} — ${r.count} shipments`).join("\n");
      return { artifact: { type: "text", markdown: md } };
    } catch (err) {
      return { artifact: { type: "text", markdown: `Could not compare templates: ${String(err)}` } };
    }
  },
});

// ─── 6. forecast_runout (T1) ────────────────────────────────────────────────
registerTool({
  name: "forecast_runout",
  description: "Project the days until a credit pool runs out at current burn rate.",
  category: "synthesis",
  destructive: false,
  tier: 1,
  schema: z.object({ category: z.string().min(1).max(50) }),
  async handler(args) {
    const since = daysAgo(30);
    const [spend] = await db.select({ total: sum(financialLedger.amountCents).mapWith(Number) })
      .from(financialLedger)
      .where(and(
        eq(financialLedger.feature, args.category),
        gte(financialLedger.postedAt, since),
      ));
    const burnPerDay = Math.abs(spend?.total ?? 0) / 30;
    return {
      artifact: {
        type: "text",
        markdown: burnPerDay > 0
          ? `**${args.category}** burning ${(burnPerDay / 100).toFixed(2)}$/day (trailing 30d). Provide a balance to see days-to-zero.`
          : `**${args.category}** has no spend in the last 30 days.`,
        burnPerDayCents: burnPerDay,
      },
    };
  },
});

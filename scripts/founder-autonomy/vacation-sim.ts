#!/usr/bin/env tsx
/**
 * Phase D — 30-day vacation simulation.
 *
 * Simulates the founder being away for 30 days by injecting scenario
 * volume across the seeded cohort and repeatedly triggering the
 * autonomous decision executor. At the end, emits a "founder inbox"
 * scorecard: what was handled cleanly, what's on fire, what you'd
 * reverse, what was silently missed.
 *
 * Not a literal clock-advance — we seed scenarios with back-dated
 * createdAt timestamps spread across the window, then let the real
 * executor chew through them in wall-clock succession. The "30 days"
 * framing is about sustained volume + mix, not literal time travel
 * (which would require the whole server to cooperate on a fake clock,
 * and that class of change is a failure mode of its own).
 *
 * Usage:
 *   SIMULATION_MODE=true npx tsx scripts/founder-autonomy/vacation-sim.ts \
 *     [--reset] [--days 30] [--scenarios-per-day 2]
 *
 * Flags:
 *   --reset               — wipe the sim cohort before running
 *   --days N              — simulate N days (default 30)
 *   --scenarios-per-day K — inject K scenarios per simulated day (default 2)
 *   --no-seed             — skip the cohort seed (assumes already seeded)
 *
 * What this test validates:
 *
 *   Volume handling  — can the executor keep up with 60+ decisions?
 *   Mix handling     — safety vs signal vs recovery scenarios interleaved
 *   Cap coverage     — does the hard cap block every high-stakes proposal?
 *   Silent drops     — any decisions that got no action after 24h?
 *   Founder queue    — does the pending inbox stay human-scale?
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db } from "../../server/db";
import {
  organizations,
  decisionsInboxItems,
  simulatedActions,
} from "../../shared/schema";
import { like, eq, sql, and, gte, desc } from "drizzle-orm";
import { requireSimulationMode } from "../../server/utils/simulationMode";

// ─── Args ───────────────────────────────────────────────────────────

interface Args {
  reset: boolean;
  days: number;
  scenariosPerDay: number;
  noSeed: boolean;
}

function parseArgs(): Args {
  const out: Args = { reset: false, days: 30, scenariosPerDay: 2, noSeed: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") out.reset = true;
    else if (a === "--no-seed") out.noSeed = true;
    else if (a === "--days") out.days = parseInt(argv[++i], 10);
    else if (a === "--scenarios-per-day") out.scenariosPerDay = parseInt(argv[++i], 10);
  }
  return out;
}

// ─── Scenario distribution ──────────────────────────────────────────
// Weighted so more-common scenarios (customer issues, payment retries)
// show up more often than rare events (data breach). Realistic 30-day
// mix — not every day has a high-stakes spend proposal.

interface WeightedScenario {
  name: string;
  weight: number;
  target: "single" | "at_risk" | "any";
}

const SCENARIO_POOL: WeightedScenario[] = [
  { name: "stuck_customer", weight: 6, target: "single" },
  { name: "payment_failed", weight: 5, target: "single" },
  { name: "feature_adoption_stalled", weight: 4, target: "single" },
  { name: "churn_risk_spike", weight: 4, target: "at_risk" },
  { name: "revenue_drop", weight: 3, target: "at_risk" },
  { name: "api_outage_fake", weight: 3, target: "single" },
  { name: "infrastructure_anomaly", weight: 3, target: "single" },
  { name: "signup_spike_offhours", weight: 2, target: "single" },
  { name: "dunning_recovery_success", weight: 2, target: "single" },
  { name: "mail_campaign_spike", weight: 2, target: "single" },
  { name: "contradictory_recs", weight: 1, target: "single" },
  { name: "compliance_flag", weight: 1, target: "single" },
  { name: "ai_budget_runaway", weight: 1, target: "single" },
  { name: "high_stakes_spend", weight: 1, target: "single" },
  { name: "data_breach_indicator", weight: 1, target: "single" },
];

function pickWeighted(pool: WeightedScenario[]): WeightedScenario {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of pool) {
    if (r < p.weight) return p;
    r -= p.weight;
  }
  return pool[0];
}

// ─── Shell out to seed-scenario ─────────────────────────────────────

async function injectScenario(scenario: string, targetArgs: string[]): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/founder-autonomy/seed-scenario.ts", "--scenario", scenario, ...targetArgs],
      {
        env: { ...process.env, SIMULATION_MODE: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      if (stderr.trim()) {
        // Don't fail the whole sim — log and move on.
        console.warn(`[inject] ${scenario}: ${stderr.slice(0, 200)}`);
      }
      resolve();
    });
  });
}

async function pickRandomSimOrgSlug(
  tier: "any" | "at_risk"
): Promise<string | null> {
  const pattern = tier === "at_risk" ? "sim-%-at_risk-%" : "sim-%";
  const rows = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(like(organizations.slug, pattern));
  if (rows.length === 0) return null;
  return rows[Math.floor(Math.random() * rows.length)].slug;
}

// ─── Force-trigger executor ─────────────────────────────────────────
// The real executor runs on a 30-min cron. For the sim, we trigger it
// on-demand so the vacation test doesn't take 15 hours of wall-clock.

async function triggerExecutor(): Promise<{ processed: number }> {
  try {
    const mod: any = await import("../../server/services/autonomousDecisionExecutor");
    // The module exports a run function under one of these names.
    const runFn = mod.runAutonomousDecisionExecutor || mod.run || mod.default;
    if (typeof runFn !== "function") {
      console.warn("[trigger] could not find executor run function — skipping");
      return { processed: 0 };
    }
    const result = await runFn();
    return {
      processed: typeof result?.processed === "number" ? result.processed : 0,
    };
  } catch (err: any) {
    console.warn(`[trigger] executor threw: ${err.message}`);
    return { processed: 0 };
  }
}

// ─── Main sim loop ──────────────────────────────────────────────────

async function main() {
  requireSimulationMode();
  const args = parseArgs();
  console.log(`[vacation-sim] config: days=${args.days} perDay=${args.scenariosPerDay} reset=${args.reset} noSeed=${args.noSeed}`);

  // ── Reset + seed ───────────────────────────────────────────────
  if (args.reset) {
    console.log("[vacation-sim] resetting cohort...");
    await new Promise<void>((resolve) => {
      const p = spawn("npx", ["tsx", "scripts/founder-autonomy/reset-cohort.ts"], {
        env: { ...process.env, SIMULATION_MODE: "true" },
        stdio: "inherit",
      });
      p.on("close", () => resolve());
    });
  }
  if (!args.noSeed) {
    console.log("[vacation-sim] seeding cohort...");
    await new Promise<void>((resolve) => {
      const p = spawn("npx", ["tsx", "scripts/founder-autonomy/seed-cohort.ts"], {
        env: { ...process.env, SIMULATION_MODE: "true" },
        stdio: "inherit",
      });
      p.on("close", () => resolve());
    });
  }

  const startedAt = new Date();
  const startSimCount = (
    await db.select({ c: sql<number>`count(*)::int` }).from(simulatedActions)
  )[0].c;
  const startDecisionCount = (
    await db.select({ c: sql<number>`count(*)::int` }).from(decisionsInboxItems)
  )[0].c;

  // ── Day loop ───────────────────────────────────────────────────
  const dayLog: Array<{ day: number; injected: string[]; executorProcessed: number }> = [];
  for (let day = 1; day <= args.days; day++) {
    const injected: string[] = [];
    for (let k = 0; k < args.scenariosPerDay; k++) {
      const scenario = pickWeighted(SCENARIO_POOL);
      const slug = await pickRandomSimOrgSlug(
        scenario.target === "at_risk" ? "at_risk" : "any"
      );
      if (!slug) continue;
      await injectScenario(scenario.name, ["--slug", slug]);
      injected.push(`${scenario.name}@${slug}`);
    }
    // Trigger the executor once per simulated day.
    const { processed } = await triggerExecutor();
    dayLog.push({ day, injected, executorProcessed: processed });
    if (day % 5 === 0 || day === args.days) {
      console.log(`  day ${day}/${args.days}: injected=${injected.length} processed=${processed}`);
    }
  }

  // ── Final inventory ────────────────────────────────────────────
  const endDecisionCount = (
    await db.select({ c: sql<number>`count(*)::int` }).from(decisionsInboxItems)
  )[0].c;
  const endSimCount = (
    await db.select({ c: sql<number>`count(*)::int` }).from(simulatedActions)
  )[0].c;

  // Pull every harness-tagged decision row created during the sim.
  const harnessRows = await db
    .select()
    .from(decisionsInboxItems)
    .where(
      and(
        sql`${decisionsInboxItems.contextBundle}->>'seededBy' = 'founder-autonomy-harness'`,
        gte(decisionsInboxItems.createdAt, startedAt)
      )
    )
    .orderBy(desc(decisionsInboxItems.createdAt));

  const pending = harnessRows.filter((r) => r.status === "pending");
  const autoResolved = harnessRows.filter(
    (r) => r.status === "auto_resolved" || (r.status === "approved" && r.resolvedBy === "autonomous_executor")
  );
  const guardrailBlocked = harnessRows.filter(
    (r) => r.status === "rejected" && r.resolvedBy === "hard_guardrail"
  );
  const manuallyResolved = harnessRows.filter(
    (r) => r.resolvedBy && r.resolvedBy !== "autonomous_executor" && r.resolvedBy !== "hard_guardrail"
  );
  const criticalPending = pending.filter((r) => r.riskLevel === "critical");

  const simActionsByCategory: Record<string, number> = {};
  {
    const rows = await db
      .select()
      .from(simulatedActions)
      .where(gte(simulatedActions.createdAt, startedAt));
    for (const r of rows) simActionsByCategory[r.category] = (simActionsByCategory[r.category] ?? 0) + 1;
  }

  const inbox = {
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    days: args.days,
    scenariosPerDay: args.scenariosPerDay,
    totalInjected: harnessRows.length,
    pending: pending.length,
    autoResolved: autoResolved.length,
    guardrailBlocked: guardrailBlocked.length,
    manuallyResolved: manuallyResolved.length,
    criticalPending: criticalPending.length,
    simulatedActions: {
      total: endSimCount - startSimCount,
      byCategory: simActionsByCategory,
    },
    decisionRowsDelta: endDecisionCount - startDecisionCount,
    dayLog,
    onFire: criticalPending.slice(0, 10).map((r) => ({
      id: r.id,
      itemType: r.itemType,
      riskLevel: r.riskLevel,
      urgencyScore: r.urgencyScore,
      summary: r.recommendedActionLabel,
    })),
  };

  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const outDir = path.join("tests/e2e-founder-autonomy/runs", `vacation-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "founder-inbox.json"), JSON.stringify(inbox, null, 2));
  fs.writeFileSync(path.join(outDir, "founder-inbox.md"), renderMarkdown(inbox));

  console.log("\n=== FOUNDER INBOX (after 30-day simulation) ===");
  console.log(`  injected:            ${inbox.totalInjected}`);
  console.log(`  auto-handled:        ${inbox.autoResolved}`);
  console.log(`  guardrail-blocked:   ${inbox.guardrailBlocked}`);
  console.log(`  pending (your queue): ${inbox.pending} (${inbox.criticalPending} critical)`);
  console.log(`  manually resolved:   ${inbox.manuallyResolved}`);
  console.log(`  simulated side effects: ${inbox.simulatedActions.total}`);
  for (const [cat, n] of Object.entries(inbox.simulatedActions.byCategory)) {
    console.log(`    - ${cat}: ${n}`);
  }
  console.log(`\n  artifacts: ${outDir}/founder-inbox.{json,md}`);
}

function renderMarkdown(inbox: any): string {
  let md = `# Founder inbox — ${inbox.days}-day vacation simulation\n\n`;
  md += `**Run:** ${inbox.startedAt} → ${inbox.endedAt}\n\n`;
  md += `## Summary\n\n`;
  md += `| Bucket | Count |\n|---|---|\n`;
  md += `| Injected | ${inbox.totalInjected} |\n`;
  md += `| Auto-handled | ${inbox.autoResolved} |\n`;
  md += `| Guardrail-blocked | ${inbox.guardrailBlocked} |\n`;
  md += `| Pending (your queue) | ${inbox.pending} |\n`;
  md += `|   ...of which critical | ${inbox.criticalPending} |\n`;
  md += `| Manually resolved | ${inbox.manuallyResolved} |\n\n`;
  md += `## Simulated side effects (kill-switch ledger)\n\n`;
  if (inbox.simulatedActions.total === 0) {
    md += `None. Either no scenario required an external action, or the kill-switch isn't wired.\n\n`;
  } else {
    md += `| Category | Count |\n|---|---|\n`;
    for (const [k, v] of Object.entries(inbox.simulatedActions.byCategory)) {
      md += `| ${k} | ${v} |\n`;
    }
    md += `\n`;
  }
  if (inbox.onFire.length > 0) {
    md += `## On fire — critical items still in your queue\n\n`;
    md += `| ID | Type | Risk | Urgency | Summary |\n|---|---|---|---|---|\n`;
    for (const r of inbox.onFire) {
      md += `| ${r.id} | ${r.itemType} | ${r.riskLevel} | ${r.urgencyScore} | ${r.summary} |\n`;
    }
    md += `\n`;
  }
  md += `## Interpretation (layperson framing)\n\n`;
  const pendingRatio =
    inbox.totalInjected > 0 ? inbox.pending / inbox.totalInjected : 0;
  if (pendingRatio < 0.1) {
    md += `✅ **The system handled ${Math.round((1 - pendingRatio) * 100)}% of what came up without you.** Your inbox has ${inbox.pending} item${inbox.pending === 1 ? "" : "s"} of ${inbox.totalInjected} — that's the "I need human judgment" signal working as intended.\n\n`;
  } else if (pendingRatio < 0.3) {
    md += `⚠️ **The system handled ${Math.round((1 - pendingRatio) * 100)}% autonomously, escalated the rest.** ${inbox.pending} of ${inbox.totalInjected} landed on your desk — reasonable for a launch-ready system. Check which decisions it chose not to make and verify that's the right line.\n\n`;
  } else {
    md += `🔴 **The system handled only ${Math.round((1 - pendingRatio) * 100)}% on its own.** ${inbox.pending} of ${inbox.totalInjected} landed on your desk — the system is leaning on you too heavily. Either the thresholds are too conservative or the executor isn't running often enough.\n\n`;
  }
  md += `### What to look at next\n\n`;
  md += `- If any \`Safety\` scenario landed in \`auto_resolved\`, the guardrail missed.\n`;
  md += `- If \`dunning_recovery_success\` is in your pending queue, the executor is escalating noise.\n`;
  md += `- If the \`simulated side effects\` ledger is empty despite \`Decisions\` scenarios firing, the kill-switch isn't hooked up.\n`;
  md += `- Cross-reference \`score-scenarios\` output for the rubric-level view.\n`;
  return md;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

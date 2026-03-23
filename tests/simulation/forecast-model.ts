#!/usr/bin/env tsx
/**
 * MRR Forecast Model
 *
 * Reads funnel data from LLM explorer reports and produces calibrated
 * 12-month MRR projections broken down by persona segment.
 *
 * Usage:
 *   npx tsx tests/simulation/forecast-model.ts
 *
 * Output:
 *   tests/simulation/forecast-report.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PERSONAS, type PersonaKey } from "./personas";
import type { FunnelRating } from "./llm-explorer";

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURABLE INPUTS — adjust these to model different scenarios
// ══════════════════════════════════════════════════════════════════════════

const MONTHLY_SIGNUPS = [30, 45, 60, 80, 100, 120, 140, 160, 180, 200, 220, 250];

const SEGMENT_MIX: Record<PersonaKey, number> = {
  firstTimer: 0.40,
  scalingOperator: 0.30,
  enterpriseManager: 0.10,
  noteInvestor: 0.15,
  limitTester: 0.05,
};

type Tier = "free" | "sprout" | "starter" | "pro" | "scale" | "enterprise";

const TIER_PRICING: Record<Tier, number> = {
  free: 0,
  sprout: 20,
  starter: 49,
  pro: 149,
  scale: 399,
  enterprise: 799,
};

const MONTHLY_CHURN = 0.04;
const EXPANSION_RATE = 0.02;

// ══════════════════════════════════════════════════════════════════════════
// FUNNEL DATA EXTRACTION — read from explorer reports
// ══════════════════════════════════════════════════════════════════════════

interface ActionLogEntry {
  iteration: number;
  reasoning: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
  funnelRating?: FunnelRating;
}

interface ExplorerReport {
  meta?: {
    persona: string;
    personaName: string;
    tier: string;
    totalActionsPlanned: number;
    totalActionsExecuted: number;
    totalRuns?: number;
    timestamp: string;
  };
  actionLog?: ActionLogEntry[];
}

type FunnelStage = "Signup" | "Onboarding Complete" | "First Core Action" | "Repeat Usage" | "Paid Upgrade";

function classifyStepToStage(entry: ActionLogEntry): FunnelStage {
  const p = entry.path.toLowerCase();
  const m = entry.method.toUpperCase();
  if (p.includes("/auth/")) return "Signup";
  if (p.includes("/onboarding")) return "Onboarding Complete";
  if (
    m === "POST" &&
    (p.includes("/leads") || p.includes("/deals") || p.includes("/properties") ||
     p.includes("/notes") || p.includes("/campaigns"))
  ) {
    return "First Core Action";
  }
  if (p.includes("/stripe") || p.includes("/credits") || p.includes("/billing")) {
    return "Paid Upgrade";
  }
  return "Repeat Usage";
}

interface PersonaFunnelRates {
  onboardingCompletionRate: number;
  firstActionRate: number;
  paidConversionRate: number;
  averageTierAtConversion: Tier;
}

// Default rates when no simulation data is available
const DEFAULT_FUNNEL_RATES: Record<PersonaKey, PersonaFunnelRates> = {
  firstTimer:         { onboardingCompletionRate: 0.70, firstActionRate: 0.50, paidConversionRate: 0.15, averageTierAtConversion: "sprout" },
  scalingOperator:    { onboardingCompletionRate: 0.85, firstActionRate: 0.70, paidConversionRate: 0.30, averageTierAtConversion: "starter" },
  enterpriseManager:  { onboardingCompletionRate: 0.90, firstActionRate: 0.80, paidConversionRate: 0.50, averageTierAtConversion: "pro" },
  noteInvestor:       { onboardingCompletionRate: 0.80, firstActionRate: 0.65, paidConversionRate: 0.35, averageTierAtConversion: "pro" },
  limitTester:        { onboardingCompletionRate: 0.60, firstActionRate: 0.40, paidConversionRate: 0.05, averageTierAtConversion: "free" },
};

function extractFunnelRates(reports: Array<{ data: ExplorerReport }>): Record<PersonaKey, PersonaFunnelRates> {
  const rates: Record<string, PersonaFunnelRates> = {};

  // Group reports by persona
  const byPersona = new Map<string, ActionLogEntry[]>();
  for (const { data } of reports) {
    if (!data.actionLog || !data.meta?.persona) continue;
    const key = data.meta.persona;
    if (!byPersona.has(key)) byPersona.set(key, []);
    byPersona.get(key)!.push(...data.actionLog);
  }

  for (const personaKey of Object.keys(PERSONAS) as PersonaKey[]) {
    const entries = byPersona.get(personaKey);
    if (!entries || entries.length === 0) {
      rates[personaKey] = DEFAULT_FUNNEL_RATES[personaKey];
      continue;
    }

    // Collect funnel ratings by stage
    const stageRatings = new Map<FunnelStage, FunnelRating[]>();
    for (const entry of entries) {
      if (!entry.funnelRating) continue;
      const stage = classifyStepToStage(entry);
      if (!stageRatings.has(stage)) stageRatings.set(stage, []);
      stageRatings.get(stage)!.push(entry.funnelRating);
    }

    const avgContinue = (stage: FunnelStage): number => {
      const r = stageRatings.get(stage);
      if (!r || r.length === 0) return -1;
      return r.reduce((s, x) => s + x.continueProbability, 0) / r.length / 100;
    };

    const wouldPayRate = (): number => {
      const upgradeRatings = stageRatings.get("Paid Upgrade");
      const repeatRatings = stageRatings.get("Repeat Usage");
      const allRatings = [...(upgradeRatings ?? []), ...(repeatRatings ?? [])];
      if (allRatings.length === 0) return -1;
      const yesOrMaybe = allRatings.filter(r => r.wouldPay === "yes").length +
                          allRatings.filter(r => r.wouldPay === "maybe").length * 0.3;
      return yesOrMaybe / allRatings.length;
    };

    const defaults = DEFAULT_FUNNEL_RATES[personaKey];
    const onboarding = avgContinue("Onboarding Complete");
    const firstAction = avgContinue("First Core Action");
    const paid = wouldPayRate();

    rates[personaKey] = {
      onboardingCompletionRate: onboarding >= 0 ? onboarding : defaults.onboardingCompletionRate,
      firstActionRate: firstAction >= 0 ? firstAction : defaults.firstActionRate,
      paidConversionRate: paid >= 0 ? paid : defaults.paidConversionRate,
      averageTierAtConversion: PERSONAS[personaKey].tier as Tier,
    };
  }

  return rates as Record<PersonaKey, PersonaFunnelRates>;
}

// ══════════════════════════════════════════════════════════════════════════
// PROJECTION ENGINE
// ══════════════════════════════════════════════════════════════════════════

interface MonthRow {
  month: number;
  newSignups: number;
  conversions: number;
  totalPaying: number;
  blendedArpu: number;
  mrr: number;
  arr: number;
}

interface SegmentSnapshot {
  persona: PersonaKey;
  tier: Tier;
  customerCount: number;
  mrr: number;
  ltv: number;
  conversionRate: number;
  churnRate: number;
}

function runProjection(
  funnelRates: Record<PersonaKey, PersonaFunnelRates>,
  opts: {
    signups?: number[];
    churn?: number;
    conversionMultiplier?: number;
    expansionRate?: number;
  } = {},
): { rows: MonthRow[]; segments: SegmentSnapshot[] } {
  const signups = opts.signups ?? MONTHLY_SIGNUPS;
  const churn = opts.churn ?? MONTHLY_CHURN;
  const convMult = opts.conversionMultiplier ?? 1.0;
  const expansion = opts.expansionRate ?? EXPANSION_RATE;

  // Per-segment state: how many paying customers and their effective ARPU
  const segmentCustomers: Record<PersonaKey, number> = {
    firstTimer: 0,
    scalingOperator: 0,
    enterpriseManager: 0,
    noteInvestor: 0,
    limitTester: 0,
  };
  const segmentMrrPerCustomer: Record<PersonaKey, number> = {} as any;
  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    const tier = funnelRates[key].averageTierAtConversion;
    segmentMrrPerCustomer[key] = TIER_PRICING[tier];
  }

  const rows: MonthRow[] = [];

  for (let m = 0; m < 12; m++) {
    const monthSignups = signups[m] ?? signups[signups.length - 1];
    let totalNewConversions = 0;

    for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
      const mix = SEGMENT_MIX[key];
      const rates = funnelRates[key];
      const segSignups = monthSignups * mix;

      // Funnel: signups → onboarding → first action → paid
      const rawConv = rates.paidConversionRate * convMult;
      const cappedConv = Math.min(rawConv, 1.0);
      const newPaying = segSignups *
        rates.onboardingCompletionRate *
        rates.firstActionRate *
        cappedConv;

      // Apply churn to existing, add new
      segmentCustomers[key] = segmentCustomers[key] * (1 - churn) + newPaying;
      totalNewConversions += newPaying;

      // Apply expansion rate to per-customer ARPU
      if (m > 0) {
        segmentMrrPerCustomer[key] *= (1 + expansion);
      }
    }

    // Compute totals
    let totalPaying = 0;
    let totalMrr = 0;
    for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
      totalPaying += segmentCustomers[key];
      totalMrr += segmentCustomers[key] * segmentMrrPerCustomer[key];
    }

    const blendedArpu = totalPaying > 0 ? totalMrr / totalPaying : 0;

    rows.push({
      month: m + 1,
      newSignups: monthSignups,
      conversions: Math.round(totalNewConversions * 10) / 10,
      totalPaying: Math.round(totalPaying * 10) / 10,
      blendedArpu: Math.round(blendedArpu * 100) / 100,
      mrr: Math.round(totalMrr),
      arr: Math.round(totalMrr * 12),
    });
  }

  // Build segment snapshots at Month 12
  const segments: SegmentSnapshot[] = [];
  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    const rates = funnelRates[key];
    const tier = rates.averageTierAtConversion;
    const count = segmentCustomers[key];
    const arpu = segmentMrrPerCustomer[key];
    // LTV = ARPU / churn (simple model)
    const ltv = churn > 0 ? arpu / churn : arpu * 100;

    segments.push({
      persona: key,
      tier,
      customerCount: Math.round(count * 10) / 10,
      mrr: Math.round(count * arpu),
      ltv: Math.round(ltv),
      conversionRate: rates.onboardingCompletionRate * rates.firstActionRate * rates.paidConversionRate,
      churnRate: churn,
    });
  }

  return { rows, segments };
}

// ══════════════════════════════════════════════════════════════════════════
// SENSITIVITY ANALYSIS
// ══════════════════════════════════════════════════════════════════════════

interface SensitivityCell {
  label: string;
  month12Mrr: number;
}

function runSensitivity(
  funnelRates: Record<PersonaKey, PersonaFunnelRates>,
): { grid: SensitivityCell[][]; rowLabels: string[]; colLabels: string[] } {
  const churnLevels = [0.02, 0.04, 0.06];
  const signupMultipliers = [0.5, 1.0, 1.5];
  const conversionMultipliers = [0.5, 1.0, 1.5];

  // 3×3 grid: rows = churn levels, cols = signup multipliers × conversion combos
  // Actually the request asks for a 3×3 grid varying churn, signups, and conversion.
  // We'll make it: rows = churn, columns = signups, and show each cell with baseline conversion.
  // Then repeat for each conversion multiplier. But a true 3×3×3 = 27 cells is unwieldy.
  //
  // Let's do 3 separate 3×3 grids (one per conversion multiplier), then summarize.
  // Actually, let's keep it simple: one 3×3 grid for each dimension pair.
  // The request says "a 3×3 grid" — so let's do churn (rows) × signups (cols), at baseline conversion,
  // then a second grid for conversion variants.

  const grid: SensitivityCell[][] = [];
  const rowLabels: string[] = [];
  const colLabels = signupMultipliers.map(m => `${Math.round(m * 100)}% signups`);

  for (const churnRate of churnLevels) {
    const row: SensitivityCell[] = [];
    rowLabels.push(`${(churnRate * 100).toFixed(0)}% churn`);
    for (const signupMult of signupMultipliers) {
      const scaledSignups = MONTHLY_SIGNUPS.map(s => Math.round(s * signupMult));
      const { rows } = runProjection(funnelRates, { signups: scaledSignups, churn: churnRate });
      const m12 = rows[rows.length - 1];
      row.push({ label: `$${m12.mrr.toLocaleString()}`, month12Mrr: m12.mrr });
    }
    grid.push(row);
  }

  return { grid, rowLabels, colLabels };
}

function runConversionSensitivity(
  funnelRates: Record<PersonaKey, PersonaFunnelRates>,
): { grid: SensitivityCell[][]; rowLabels: string[]; colLabels: string[] } {
  const churnLevels = [0.02, 0.04, 0.06];
  const convMultipliers = [0.5, 1.0, 1.5];

  const grid: SensitivityCell[][] = [];
  const rowLabels: string[] = [];
  const colLabels = convMultipliers.map(m => `${Math.round(m * 100)}% conv`);

  for (const churnRate of churnLevels) {
    const row: SensitivityCell[] = [];
    rowLabels.push(`${(churnRate * 100).toFixed(0)}% churn`);
    for (const convMult of convMultipliers) {
      const { rows } = runProjection(funnelRates, { churn: churnRate, conversionMultiplier: convMult });
      const m12 = rows[rows.length - 1];
      row.push({ label: `$${m12.mrr.toLocaleString()}`, month12Mrr: m12.mrr });
    }
    grid.push(row);
  }

  return { grid, rowLabels, colLabels };
}

// ══════════════════════════════════════════════════════════════════════════
// KEY LEVERS ANALYSIS
// ══════════════════════════════════════════════════════════════════════════

interface KeyLever {
  description: string;
  delta: number;
}

function identifyKeyLevers(
  funnelRates: Record<PersonaKey, PersonaFunnelRates>,
): KeyLever[] {
  const baselineM12 = runProjection(funnelRates).rows[11].mrr;
  const levers: KeyLever[] = [];

  // 1. Churn reduction: 4% → 2%
  const churn2 = runProjection(funnelRates, { churn: 0.02 }).rows[11].mrr;
  levers.push({
    description: `Reducing churn from ${(MONTHLY_CHURN * 100).toFixed(0)}% to 2%`,
    delta: churn2 - baselineM12,
  });

  // 2. Improve onboarding completion by 25% (relative)
  const boostedOnboarding: Record<PersonaKey, PersonaFunnelRates> = {} as any;
  for (const key of Object.keys(funnelRates) as PersonaKey[]) {
    boostedOnboarding[key] = {
      ...funnelRates[key],
      onboardingCompletionRate: Math.min(funnelRates[key].onboardingCompletionRate * 1.25, 1.0),
    };
  }
  const onboardingM12 = runProjection(boostedOnboarding).rows[11].mrr;
  const avgOnboarding = Object.values(funnelRates).reduce((s, r) => s + r.onboardingCompletionRate, 0) / Object.keys(funnelRates).length;
  const avgOnboardingBoosted = Object.values(boostedOnboarding).reduce((s, r) => s + r.onboardingCompletionRate, 0) / Object.keys(boostedOnboarding).length;
  levers.push({
    description: `Improving onboarding completion from ${(avgOnboarding * 100).toFixed(0)}% to ${(avgOnboardingBoosted * 100).toFixed(0)}%`,
    delta: onboardingM12 - baselineM12,
  });

  // 3. 50% more signups
  const moreSignups = MONTHLY_SIGNUPS.map(s => Math.round(s * 1.5));
  const signupM12 = runProjection(funnelRates, { signups: moreSignups }).rows[11].mrr;
  levers.push({
    description: "Increasing signups by 50% (organic + community growth)",
    delta: signupM12 - baselineM12,
  });

  // 4. 50% better paid conversion
  const convM12 = runProjection(funnelRates, { conversionMultiplier: 1.5 }).rows[11].mrr;
  levers.push({
    description: "Improving paid conversion rate by 50%",
    delta: convM12 - baselineM12,
  });

  // 5. Better first action rate (+25% relative)
  const boostedFirstAction: Record<PersonaKey, PersonaFunnelRates> = {} as any;
  for (const key of Object.keys(funnelRates) as PersonaKey[]) {
    boostedFirstAction[key] = {
      ...funnelRates[key],
      firstActionRate: Math.min(funnelRates[key].firstActionRate * 1.25, 1.0),
    };
  }
  const firstActionM12 = runProjection(boostedFirstAction).rows[11].mrr;
  levers.push({
    description: "Improving first-action rate by 25% (better empty states, nudges)",
    delta: firstActionM12 - baselineM12,
  });

  // Sort by delta descending, return top 3
  levers.sort((a, b) => b.delta - a.delta);
  return levers.slice(0, 3);
}

// ══════════════════════════════════════════════════════════════════════════
// MARKDOWN RENDERER
// ══════════════════════════════════════════════════════════════════════════

function renderForecast(
  funnelRates: Record<PersonaKey, PersonaFunnelRates>,
  dataSource: string,
): string {
  const { rows, segments } = runProjection(funnelRates);
  const lines: string[] = [];

  lines.push("# AcreOS MRR Forecast");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Data source: ${dataSource}`);
  lines.push("");

  // ── Assumptions ──
  lines.push("## Assumptions");
  lines.push("");
  lines.push(`- Monthly signups: ${MONTHLY_SIGNUPS.join(", ")}`);
  lines.push(`- Monthly churn: ${(MONTHLY_CHURN * 100).toFixed(0)}%`);
  lines.push(`- Monthly ARPU expansion: ${(EXPANSION_RATE * 100).toFixed(0)}%`);
  lines.push(`- Segment mix: ${Object.entries(SEGMENT_MIX).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(", ")}`);
  lines.push("");

  // ── Per-persona funnel rates ──
  lines.push("### Funnel Rates by Persona");
  lines.push("");
  lines.push("| Persona | Onboarding % | First Action % | Paid Conversion % | Target Tier |");
  lines.push("|---------|-------------|---------------|-------------------|-------------|");
  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    const r = funnelRates[key];
    lines.push(`| ${PERSONAS[key].name} | ${(r.onboardingCompletionRate * 100).toFixed(0)}% | ${(r.firstActionRate * 100).toFixed(0)}% | ${(r.paidConversionRate * 100).toFixed(0)}% | ${r.averageTierAtConversion} ($${TIER_PRICING[r.averageTierAtConversion]}/mo) |`);
  }
  lines.push("");

  // ── Monthly projection ──
  lines.push("## 12-Month Projection");
  lines.push("");
  lines.push("| Month | New Signups | Conversions | Total Paying | Blended ARPU | MRR | ARR Run Rate |");
  lines.push("|-------|------------|-------------|-------------|-------------|-----|-------------|");
  for (const row of rows) {
    lines.push(`| ${row.month} | ${row.newSignups} | ${row.conversions} | ${row.totalPaying} | $${row.blendedArpu.toFixed(2)} | $${row.mrr.toLocaleString()} | $${row.arr.toLocaleString()} |`);
  }
  lines.push("");

  const m6 = rows[5];
  const m12 = rows[11];
  lines.push(`**Month 6 MRR: $${m6.mrr.toLocaleString()}** | **Month 12 MRR: $${m12.mrr.toLocaleString()}** | **Month 12 ARR: $${m12.arr.toLocaleString()}**`);
  lines.push("");

  // ── Per-segment breakdown ──
  lines.push("## Per-Segment Breakdown (at Month 12)");
  lines.push("");
  lines.push("| Persona | Tier | Customers | Segment MRR | End-to-End Conv % | Est. LTV | LTV/CAC Headroom |");
  lines.push("|---------|------|-----------|------------|-------------------|----------|-----------------|");
  for (const seg of segments) {
    const e2e = (seg.conversionRate * 100).toFixed(1);
    const ltvDisplay = seg.ltv > 0 ? `$${seg.ltv.toLocaleString()}` : "—";
    lines.push(`| ${PERSONAS[seg.persona].name} | ${seg.tier} | ${seg.customerCount} | $${seg.mrr.toLocaleString()} | ${e2e}% | ${ltvDisplay} | ${seg.ltv > 100 ? "Strong" : seg.ltv > 30 ? "Moderate" : "Weak"} |`);
  }
  lines.push("");

  // Best/worst converters
  const sorted = [...segments].sort((a, b) => b.conversionRate - a.conversionRate);
  lines.push(`**Best converter:** ${PERSONAS[sorted[0].persona].name} (${(sorted[0].conversionRate * 100).toFixed(1)}% end-to-end)`);
  lines.push(`**Lowest converter:** ${PERSONAS[sorted[sorted.length - 1].persona].name} (${(sorted[sorted.length - 1].conversionRate * 100).toFixed(1)}% end-to-end)`);
  lines.push(`**Highest LTV:** ${PERSONAS[[...segments].sort((a, b) => b.ltv - a.ltv)[0].persona].name} ($${[...segments].sort((a, b) => b.ltv - a.ltv)[0].ltv.toLocaleString()})`);
  lines.push("");

  // ── Sensitivity analysis ──
  lines.push("## Sensitivity Analysis");
  lines.push("");
  lines.push("### Churn × Signups (Month 12 MRR)");
  lines.push("");

  const signupSens = runSensitivity(funnelRates);
  lines.push(`| | ${signupSens.colLabels.join(" | ")} |`);
  lines.push(`|---|${signupSens.colLabels.map(() => "---").join("|")}|`);
  for (let i = 0; i < signupSens.rowLabels.length; i++) {
    const row = signupSens.grid[i];
    lines.push(`| **${signupSens.rowLabels[i]}** | ${row.map(c => c.label).join(" | ")} |`);
  }
  lines.push("");

  lines.push("### Churn × Conversion Rate (Month 12 MRR)");
  lines.push("");

  const convSens = runConversionSensitivity(funnelRates);
  lines.push(`| | ${convSens.colLabels.join(" | ")} |`);
  lines.push(`|---|${convSens.colLabels.map(() => "---").join("|")}|`);
  for (let i = 0; i < convSens.rowLabels.length; i++) {
    const row = convSens.grid[i];
    lines.push(`| **${convSens.rowLabels[i]}** | ${row.map(c => c.label).join(" | ")} |`);
  }
  lines.push("");

  // ── Key levers ──
  lines.push("## Key Levers");
  lines.push("");
  lines.push("Top 3 actions that would most improve Month 12 MRR:");
  lines.push("");

  const levers = identifyKeyLevers(funnelRates);
  for (let i = 0; i < levers.length; i++) {
    const lever = levers[i];
    const sign = lever.delta >= 0 ? "+" : "";
    lines.push(`${i + 1}. **${lever.description}** → ${sign}$${Math.round(lever.delta).toLocaleString()} to Month 12 MRR`);
  }
  lines.push("");

  lines.push("---");
  lines.push("_Forecast generated by AcreOS simulation suite. Rates derived from LLM explorer funnel data._");

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════

function main(): void {
  console.log("[forecast] Generating MRR forecast model...");

  const reportsDir = path.join(import.meta.dirname ?? __dirname, "reports");
  const outputPath = path.join(import.meta.dirname ?? __dirname, "forecast-report.md");

  // Read explorer reports
  let explorerReports: Array<{ file: string; data: ExplorerReport }> = [];
  if (fs.existsSync(reportsDir)) {
    explorerReports = fs
      .readdirSync(reportsDir)
      .filter((f) => f.startsWith("explorer-") && f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(reportsDir, f), "utf-8");
          return { file: f, data: JSON.parse(raw) as ExplorerReport };
        } catch {
          return null;
        }
      })
      .filter((x): x is { file: string; data: ExplorerReport } => x !== null);
  }

  const hasSimData = explorerReports.some(
    (r) => r.data.actionLog?.some((a) => a.funnelRating),
  );

  const dataSource = hasSimData
    ? `${explorerReports.length} explorer report(s) with funnel data`
    : "Default funnel estimates (no simulation data available)";

  console.log(`[forecast] Data source: ${dataSource}`);

  const funnelRates = extractFunnelRates(explorerReports);

  const markdown = renderForecast(funnelRates, dataSource);
  fs.writeFileSync(outputPath, markdown);

  // Print key numbers to stdout
  const { rows } = runProjection(funnelRates);
  const m6 = rows[5];
  const m12 = rows[11];

  console.log(`[forecast] Report written to ${outputPath}`);
  console.log(`[forecast] Month 6 MRR:  $${m6.mrr.toLocaleString()}`);
  console.log(`[forecast] Month 12 MRR: $${m12.mrr.toLocaleString()}`);
  console.log(`[forecast] Month 12 ARR: $${m12.arr.toLocaleString()}`);
}

main();

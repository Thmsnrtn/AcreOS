#!/usr/bin/env tsx
/**
 * Simulation Report Generator
 *
 * Aggregates all simulation outputs into a prioritized markdown report:
 *   - LLM explorer JSON reports
 *   - Playwright JSON results
 *   - Chaos test outputs
 *
 * Categories:
 *   P0 — Blockers (500s, data corruption, tenant leakage)
 *   P1 — High friction (onboarding dead ends, broken flows, confusing errors)
 *   P2 — Medium friction (slow endpoints, missing confirmations, poor mobile)
 *   P3 — Polish (loading states, animations, copy improvements)
 *
 * Usage:
 *   npx tsx tests/simulation/generate-report.ts
 *
 * Output:
 *   tests/simulation/simulation-report.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { FunnelRating, ActionLogEntryWithFunnel } from "./llm-explorer";

// ── Types ──────────────────────────────────────────────────────────────────

interface FrictionPoint {
  severity: "high" | "medium" | "low";
  action: string;
  endpoint: string;
  statusCode: number;
  responseMs: number;
  issue: string;
  suggestion: string;
}

interface PerformanceIssue {
  endpoint: string;
  avgMs: number;
  maxMs: number;
  suggestion: string;
}

interface MissingFeature {
  description: string;
  impact: "high" | "medium" | "low";
  suggestion: string;
}

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
  frictionPoints?: FrictionPoint[];
  performanceIssues?: PerformanceIssue[];
  missingFeatures?: MissingFeature[];
  summary?: string;
  actionLog?: ActionLogEntry[];
  runs?: Array<{
    runIndex: number;
    temperature: number;
    actionsExecuted: number;
    errors: number;
    summary?: string;
  }>;
}

interface PlaywrightResult {
  suites?: PlaywrightSuite[];
  stats?: { expected: number; unexpected: number; flaky: number; skipped: number };
}

interface PlaywrightSuite {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests?: Array<{
    status: string;
    projectName: string;
    results?: Array<{
      status: string;
      duration: number;
      error?: { message: string };
    }>;
  }>;
}

// ── Categorized Finding ────────────────────────────────────────────────

type Priority = "P0" | "P1" | "P2" | "P3";

interface Finding {
  priority: Priority;
  source: string;
  title: string;
  detail: string;
  suggestion?: string;
}

// ── File Discovery ─────────────────────────────────────────────────────

const REPORTS_DIR = path.join(import.meta.dirname ?? __dirname, "reports");
const OUTPUT_PATH = path.join(import.meta.dirname ?? __dirname, "simulation-report.md");

function readJsonFiles<T>(dir: string, prefix: string): Array<{ file: string; data: T }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => {
      try {
        const raw = fs.readFileSync(path.join(dir, f), "utf-8");
        return { file: f, data: JSON.parse(raw) as T };
      } catch {
        return null;
      }
    })
    .filter((x): x is { file: string; data: T } => x !== null);
}

// ── Classify Findings ──────────────────────────────────────────────────

function classifyExplorerFindings(reports: Array<{ file: string; data: ExplorerReport }>): Finding[] {
  const findings: Finding[] = [];

  for (const { file, data } of reports) {
    const persona = data.meta?.personaName ?? file;

    // Action log analysis: 500s → P0, 4xx patterns → P1
    if (data.actionLog) {
      for (const entry of data.actionLog) {
        if (entry.status >= 500) {
          findings.push({
            priority: "P0",
            source: `Explorer (${persona})`,
            title: `Server error: ${entry.method} ${entry.path}`,
            detail: `Status ${entry.status} at iteration ${entry.iteration}. Error: ${entry.error ?? "unknown"}`,
            suggestion: "Investigate server logs for stack trace",
          });
        }
      }
    }

    // Friction points from Claude's analysis
    if (data.frictionPoints) {
      for (const fp of data.frictionPoints) {
        let priority: Priority;
        if (fp.statusCode >= 500) {
          priority = "P0";
        } else if (fp.severity === "high") {
          priority = "P1";
        } else if (fp.severity === "medium") {
          priority = "P2";
        } else {
          priority = "P3";
        }

        findings.push({
          priority,
          source: `Explorer (${persona})`,
          title: `${fp.endpoint}: ${fp.issue.slice(0, 80)}`,
          detail: `Action: ${fp.action}\nStatus: ${fp.statusCode} (${fp.responseMs}ms)\n${fp.issue}`,
          suggestion: fp.suggestion,
        });
      }
    }

    // Performance issues → P2
    if (data.performanceIssues) {
      for (const pi of data.performanceIssues) {
        findings.push({
          priority: "P2",
          source: `Explorer (${persona})`,
          title: `Slow endpoint: ${pi.endpoint}`,
          detail: `Avg: ${pi.avgMs}ms, Max: ${pi.maxMs}ms`,
          suggestion: pi.suggestion,
        });
      }
    }

    // Missing features
    if (data.missingFeatures) {
      for (const mf of data.missingFeatures) {
        findings.push({
          priority: mf.impact === "high" ? "P1" : mf.impact === "medium" ? "P2" : "P3",
          source: `Explorer (${persona})`,
          title: `Missing: ${mf.description.slice(0, 80)}`,
          detail: mf.description,
          suggestion: mf.suggestion,
        });
      }
    }
  }

  return findings;
}

function classifyPlaywrightFindings(results: Array<{ file: string; data: PlaywrightResult }>): Finding[] {
  const findings: Finding[] = [];

  for (const { data } of results) {
    if (!data.suites) continue;
    walkSuites(data.suites, findings);
  }

  return findings;
}

function walkSuites(suites: PlaywrightSuite[], findings: Finding[]): void {
  for (const suite of suites) {
    if (suite.specs) {
      for (const spec of suite.specs) {
        if (!spec.ok) {
          const failedTest = spec.tests?.find((t) => t.status === "unexpected");
          const errorMsg = failedTest?.results?.[0]?.error?.message ?? "Unknown failure";

          // Classify based on error content
          let priority: Priority = "P1";
          if (errorMsg.includes("500") || errorMsg.includes("Internal Server")) {
            priority = "P0";
          } else if (errorMsg.includes("timeout") || errorMsg.includes("Timeout")) {
            priority = "P2";
          }

          findings.push({
            priority,
            source: `Playwright (${suite.title})`,
            title: `Test failed: ${spec.title}`,
            detail: errorMsg.slice(0, 300),
          });
        }
      }
    }
    if (suite.suites) {
      walkSuites(suite.suites, findings);
    }
  }
}

// ── Stats Computation ──────────────────────────────────────────────────

interface SummaryStats {
  totalActions: number;
  totalErrors: number;
  errorRate: string;
  avgResponseMs: number;
  maxResponseMs: number;
  personasExplored: number;
  playwrightPassed: number;
  playwrightFailed: number;
  findingsByPriority: Record<Priority, number>;
}

function computeStats(
  explorerReports: Array<{ data: ExplorerReport }>,
  playwrightResults: Array<{ data: PlaywrightResult }>,
  findings: Finding[],
): SummaryStats {
  let totalActions = 0;
  let totalErrors = 0;
  let totalDurationMs = 0;
  let maxResponseMs = 0;
  let actionCount = 0;

  for (const { data } of explorerReports) {
    if (data.actionLog) {
      totalActions += data.actionLog.length;
      for (const entry of data.actionLog) {
        if (entry.status >= 400) totalErrors++;
        totalDurationMs += entry.durationMs;
        maxResponseMs = Math.max(maxResponseMs, entry.durationMs);
        actionCount++;
      }
    }
  }

  let playwrightPassed = 0;
  let playwrightFailed = 0;
  for (const { data } of playwrightResults) {
    if (data.stats) {
      playwrightPassed += data.stats.expected ?? 0;
      playwrightFailed += data.stats.unexpected ?? 0;
    }
  }

  const findingsByPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) {
    findingsByPriority[f.priority]++;
  }

  return {
    totalActions,
    totalErrors,
    errorRate: totalActions > 0 ? `${((totalErrors / totalActions) * 100).toFixed(1)}%` : "N/A",
    avgResponseMs: actionCount > 0 ? Math.round(totalDurationMs / actionCount) : 0,
    maxResponseMs,
    personasExplored: explorerReports.length,
    playwrightPassed,
    playwrightFailed,
    findingsByPriority,
  };
}

// ── Conversion Funnel ────────────────────────────────────────────────────

type FunnelStage = "Signup" | "Onboarding Complete" | "First Core Action" | "Repeat Usage" | "Paid Upgrade";

const FUNNEL_STAGES: FunnelStage[] = [
  "Signup",
  "Onboarding Complete",
  "First Core Action",
  "Repeat Usage",
  "Paid Upgrade",
];

function classifyStepToStage(entry: ActionLogEntry): FunnelStage {
  const p = entry.path.toLowerCase();
  const m = entry.method.toUpperCase();

  // Signup stage: auth endpoints
  if (p.includes("/auth/")) return "Signup";

  // Onboarding: onboarding endpoints
  if (p.includes("/onboarding")) return "Onboarding Complete";

  // First Core Action: first POST to leads/deals/properties/notes/campaigns
  if (
    m === "POST" &&
    (p.includes("/leads") || p.includes("/deals") || p.includes("/properties") ||
     p.includes("/notes") || p.includes("/campaigns"))
  ) {
    return "First Core Action";
  }

  // Paid Upgrade: billing/stripe/credits
  if (p.includes("/stripe") || p.includes("/credits") || p.includes("/billing")) {
    return "Paid Upgrade";
  }

  // Everything else is Repeat Usage (GET reads, PUT updates, DELETE, dashboard, settings, team)
  return "Repeat Usage";
}

interface FunnelStepData {
  stage: FunnelStage;
  totalRatings: number;
  continueProbabilitySum: number;
  wouldPayYes: number;
  wouldPayMaybe: number;
  wouldPayNo: number;
  frictionCounts: Map<string, number>;
}

function buildFunnelData(
  explorerReports: Array<{ data: ExplorerReport }>,
): {
  overall: Map<FunnelStage, FunnelStepData>;
  perPersona: Map<string, Map<FunnelStage, FunnelStepData>>;
} {
  const overall = new Map<FunnelStage, FunnelStepData>();
  const perPersona = new Map<string, Map<FunnelStage, FunnelStepData>>();

  for (const stage of FUNNEL_STAGES) {
    overall.set(stage, emptyStepData(stage));
  }

  for (const { data } of explorerReports) {
    if (!data.actionLog) continue;
    const personaName = data.meta?.personaName ?? "Unknown";

    if (!perPersona.has(personaName)) {
      const pMap = new Map<FunnelStage, FunnelStepData>();
      for (const stage of FUNNEL_STAGES) {
        pMap.set(stage, emptyStepData(stage));
      }
      perPersona.set(personaName, pMap);
    }
    const personaMap = perPersona.get(personaName)!;

    for (const entry of data.actionLog) {
      if (!entry.funnelRating) continue;
      const stage = classifyStepToStage(entry);
      accumulateRating(overall.get(stage)!, entry.funnelRating);
      accumulateRating(personaMap.get(stage)!, entry.funnelRating);
    }
  }

  return { overall, perPersona };
}

function emptyStepData(stage: FunnelStage): FunnelStepData {
  return {
    stage,
    totalRatings: 0,
    continueProbabilitySum: 0,
    wouldPayYes: 0,
    wouldPayMaybe: 0,
    wouldPayNo: 0,
    frictionCounts: new Map(),
  };
}

function accumulateRating(data: FunnelStepData, rating: FunnelRating): void {
  data.totalRatings++;
  data.continueProbabilitySum += rating.continueProbability;
  if (rating.wouldPay === "yes") data.wouldPayYes++;
  else if (rating.wouldPay === "maybe") data.wouldPayMaybe++;
  else data.wouldPayNo++;

  const friction = rating.primaryFriction.trim();
  if (friction) {
    data.frictionCounts.set(friction, (data.frictionCounts.get(friction) ?? 0) + 1);
  }
}

function topFriction(data: FunnelStepData): string {
  if (data.frictionCounts.size === 0) return "—";
  let maxCount = 0;
  let topMsg = "—";
  for (const [msg, count] of data.frictionCounts) {
    if (count > maxCount) {
      maxCount = count;
      topMsg = msg;
    }
  }
  return topMsg;
}

function dropOffRisk(avgConversion: number): string {
  if (avgConversion >= 80) return "Low";
  if (avgConversion >= 50) return "Medium";
  return "High";
}

function renderFunnelTable(stageMap: Map<FunnelStage, FunnelStepData>): string[] {
  const lines: string[] = [];
  lines.push("| Stage | Avg Conversion % | Drop-off Risk | Primary Friction (most common) | Would Pay % |");
  lines.push("|-------|-----------------|---------------|-------------------------------|-------------|");

  for (const stage of FUNNEL_STAGES) {
    const d = stageMap.get(stage)!;
    if (d.totalRatings === 0) {
      lines.push(`| ${stage} | — | — | — | — |`);
      continue;
    }
    const avgConv = Math.round(d.continueProbabilitySum / d.totalRatings);
    const wouldPayPct = Math.round(((d.wouldPayYes + d.wouldPayMaybe * 0.5) / d.totalRatings) * 100);
    const friction = topFriction(d);
    // Truncate friction to 60 chars for table readability
    const frictionDisplay = friction.length > 60 ? friction.slice(0, 57) + "..." : friction;
    lines.push(`| ${stage} | ${avgConv}% | ${dropOffRisk(avgConv)} | ${frictionDisplay} | ${wouldPayPct}% |`);
  }

  return lines;
}

// ── Markdown Renderer ──────────────────────────────────────────────────

function renderMarkdown(stats: SummaryStats, findings: Finding[], explorerReports: Array<{ data: ExplorerReport }>): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push("# AcreOS Simulation Report");
  lines.push("");
  lines.push(`Generated: ${now}`);
  lines.push("");

  // Summary stats
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total API actions | ${stats.totalActions} |`);
  lines.push(`| Error count | ${stats.totalErrors} |`);
  lines.push(`| Error rate | ${stats.errorRate} |`);
  lines.push(`| Avg response time | ${stats.avgResponseMs}ms |`);
  lines.push(`| Max response time | ${stats.maxResponseMs}ms |`);
  lines.push(`| Personas explored (LLM) | ${stats.personasExplored} |`);
  lines.push(`| Playwright passed | ${stats.playwrightPassed} |`);
  lines.push(`| Playwright failed | ${stats.playwrightFailed} |`);
  lines.push("");

  // Findings by priority
  lines.push("## Findings by Priority");
  lines.push("");
  lines.push(`| Priority | Count | Description |`);
  lines.push(`|----------|-------|-------------|`);
  lines.push(`| **P0** | ${stats.findingsByPriority.P0} | Blockers — 500s, data corruption, tenant leakage |`);
  lines.push(`| **P1** | ${stats.findingsByPriority.P1} | High friction — onboarding dead ends, broken flows |`);
  lines.push(`| **P2** | ${stats.findingsByPriority.P2} | Medium friction — slow endpoints, poor mobile |`);
  lines.push(`| **P3** | ${stats.findingsByPriority.P3} | Polish — loading states, copy improvements |`);
  lines.push("");

  // Detailed findings per priority
  const priorities: Priority[] = ["P0", "P1", "P2", "P3"];
  const priorityLabels: Record<Priority, string> = {
    P0: "P0 — Blockers",
    P1: "P1 — High Friction",
    P2: "P2 — Medium Friction",
    P3: "P3 — Polish",
  };

  for (const p of priorities) {
    const pFindings = findings.filter((f) => f.priority === p);
    lines.push(`### ${priorityLabels[p]}`);
    lines.push("");

    if (pFindings.length === 0) {
      lines.push("_No findings._");
      lines.push("");
      continue;
    }

    for (const f of pFindings) {
      lines.push(`#### ${f.title}`);
      lines.push("");
      lines.push(`- **Source:** ${f.source}`);
      lines.push(`- **Detail:** ${f.detail.replace(/\n/g, " ")}`);
      if (f.suggestion) {
        lines.push(`- **Suggestion:** ${f.suggestion}`);
      }
      lines.push("");
    }
  }

  // ── Conversion Funnel ──────────────────────────────────────────────────
  const { overall, perPersona } = buildFunnelData(explorerReports);
  const hasRatings = Array.from(overall.values()).some((d) => d.totalRatings > 0);

  if (hasRatings) {
    lines.push("## Conversion Funnel");
    lines.push("");
    lines.push("Aggregated across all runs. Steps are grouped into funnel stages:");
    lines.push("**Signup → Onboarding Complete → First Core Action → Repeat Usage → Paid Upgrade**");
    lines.push("");

    // Overall funnel table
    lines.push("### Overall Funnel");
    lines.push("");
    lines.push(...renderFunnelTable(overall));
    lines.push("");

    // Per-persona breakdowns
    if (perPersona.size > 0) {
      lines.push("### Per-Persona Funnel Breakdowns");
      lines.push("");

      for (const [personaName, stageMap] of perPersona) {
        const hasData = Array.from(stageMap.values()).some((d) => d.totalRatings > 0);
        if (!hasData) continue;

        lines.push(`#### ${personaName}`);
        lines.push("");
        lines.push(...renderFunnelTable(stageMap));
        lines.push("");
      }
    }
  }

  // Per-persona summaries from Claude
  const summaries = explorerReports.filter((r) => r.data.summary);
  if (summaries.length > 0) {
    lines.push("## Per-Persona Summaries (LLM Explorer)");
    lines.push("");
    for (const { data } of summaries) {
      const name = data.meta?.personaName ?? "Unknown";
      const tier = data.meta?.tier ?? "unknown";
      lines.push(`### ${name} (${tier})`);
      lines.push("");
      lines.push(data.summary!);
      lines.push("");
      if (data.actionLog) {
        const errors = data.actionLog.filter((a) => a.status >= 400).length;
        const avg = Math.round(
          data.actionLog.reduce((s, a) => s + a.durationMs, 0) / data.actionLog.length,
        );
        const totalRuns = data.meta?.totalRuns ?? 1;
        lines.push(`- Actions: ${data.actionLog.length}, Errors: ${errors}, Avg response: ${avg}ms, Runs: ${totalRuns}`);
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("_Report generated by AcreOS simulation suite._");

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  console.log("[report] Generating simulation report...");

  // Read explorer reports
  const explorerReports = readJsonFiles<ExplorerReport>(REPORTS_DIR, "explorer-");
  console.log(`[report] Found ${explorerReports.length} explorer report(s)`);

  // Read Playwright results (look in reports dir and common Playwright output locations)
  const playwrightResults = [
    ...readJsonFiles<PlaywrightResult>(REPORTS_DIR, "playwright-"),
    ...readJsonFiles<PlaywrightResult>(path.join(import.meta.dirname ?? __dirname, ".."), "playwright-results"),
    ...readJsonFiles<PlaywrightResult>(path.join(import.meta.dirname ?? __dirname, "../.."), "test-results"),
  ];
  console.log(`[report] Found ${playwrightResults.length} Playwright result(s)`);

  // Classify findings
  const explorerFindings = classifyExplorerFindings(explorerReports);
  const playwrightFindings = classifyPlaywrightFindings(playwrightResults);
  const allFindings = [...explorerFindings, ...playwrightFindings];

  // Sort: P0 first, then P1, P2, P3
  const priorityOrder: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  allFindings.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  console.log(`[report] Total findings: ${allFindings.length}`);

  // Compute stats
  const stats = computeStats(explorerReports, playwrightResults, allFindings);

  // Render
  const markdown = renderMarkdown(stats, allFindings, explorerReports);
  fs.writeFileSync(OUTPUT_PATH, markdown);

  console.log(`[report] Report written to ${OUTPUT_PATH}`);
  console.log(`[report] P0: ${stats.findingsByPriority.P0}, P1: ${stats.findingsByPriority.P1}, P2: ${stats.findingsByPriority.P2}, P3: ${stats.findingsByPriority.P3}`);
}

main();

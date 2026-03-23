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
}

interface ExplorerReport {
  meta?: {
    persona: string;
    personaName: string;
    tier: string;
    totalActionsPlanned: number;
    totalActionsExecuted: number;
    timestamp: string;
  };
  frictionPoints?: FrictionPoint[];
  performanceIssues?: PerformanceIssue[];
  missingFeatures?: MissingFeature[];
  summary?: string;
  actionLog?: ActionLogEntry[];
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
        lines.push(`- Actions: ${data.actionLog.length}, Errors: ${errors}, Avg response: ${avg}ms`);
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

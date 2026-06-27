/**
 * Aggregate the per-persona JSON the spec emits into one launch-readiness report.
 *
 *   npx playwright test --project=customer-personas   # writes test-results/personas/<slug>.json
 *   npx tsx tests/personas/report.ts                  # → test-results/personas/REPORT.md
 *
 * The report answers: "if these 30 first users showed up tomorrow, what would
 * they feel?" — a launch-readiness grade, then the breakage (hard), the
 * accessibility blockers, the slow doors, and the per-persona polish list.
 */

import fs from "node:fs";
import path from "node:path";

const DIR = path.join("test-results", "personas");

interface A11yViolation { id: string; impact: string; help: string; nodes: number }
interface DoorFinding {
  door: string;
  route: string;
  ok: boolean;
  consoleErrors: string[];
  failedRequests: string[];
  degradedRequests: string[];
  forbiddenLeaks: string[];
  vocabMissing: string[];
  a11y: A11yViolation[];
  perf: { domContentLoaded: number | null; load: number | null };
}
interface PersonaReport {
  slug: string;
  displayName: string;
  businessType: string;
  persona: string;
  device: string;
  experience: string;
  tier: string;
  doors: DoorFinding[];
  moduleGating: { missingExpected: string[]; leakedHidden: string[] };
  hardFindings: number;
  softFindings: number;
  a11yCritical: number;
  slowDoors: Array<{ door: string; ms: number }>;
  readinessScore: number;
  readinessGrade: string;
}

function grade(score: number): string {
  if (score >= 95) return "A";
  if (score >= 85) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

/** Recompute the readiness score from raw data (keeps the report in sync with
 * the current formula even if the per-persona JSON was written by an older run). */
function recompute(r: PersonaReport): PersonaReport {
  const a11yRuleTypes = new Set(r.doors.flatMap((d) => d.a11y.map((v) => v.id))).size;
  let s = 100;
  s -= r.hardFindings * 25;
  s -= Math.min(30, a11yRuleTypes * 5);
  s -= (r.slowDoors?.length ?? 0) * 5;
  s -= (r.moduleGating?.leakedHidden?.length ?? 0) * 3;
  s -= Math.min(10, r.softFindings);
  s = Math.max(0, Math.min(100, s));
  return { ...r, readinessScore: s, readinessGrade: grade(s) };
}

function load(): PersonaReport[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "REPORT.json")
    .map((f) => recompute(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as PersonaReport))
    .sort((a, b) => a.readinessScore - b.readinessScore); // worst first
}

function overallGrade(score: number): string {
  if (score >= 95) return "A — ship it";
  if (score >= 85) return "B — ship with a short polish list";
  if (score >= 70) return "C — fix the highlighted items first";
  if (score >= 50) return "D — not ready; real friction for new users";
  return "F — do not launch";
}

function main(): void {
  const reports = load();
  if (reports.length === 0) {
    console.error(`No persona reports in ${DIR}. Run the spec first:`);
    console.error("  npx playwright test --project=customer-personas");
    process.exit(1);
  }

  const totalHard = reports.reduce((n, r) => n + r.hardFindings, 0);
  const totalSoft = reports.reduce((n, r) => n + r.softFindings, 0);
  const totalA11y = reports.reduce((n, r) => n + r.a11yCritical, 0);
  const clean = reports.filter((r) => r.hardFindings === 0).length;
  const avgScore = Math.round(reports.reduce((n, r) => n + r.readinessScore, 0) / reports.length);
  const worstScore = Math.min(...reports.map((r) => r.readinessScore));

  const L: string[] = [];
  L.push("# The 30 First Users — launch-readiness report\n");
  L.push(`## Verdict: **${overallGrade(avgScore)}**\n`);
  L.push(`Avg readiness **${avgScore}/100**  ·  worst persona **${worstScore}/100**  ·  no-breakage **${clean}/${reports.length}**`);
  L.push(`Breakage (hard) **${totalHard}**  ·  accessibility blockers **${totalA11y}**  ·  polish (soft) **${totalSoft}**\n`);

  // ── Per-persona scorecard ──
  L.push("## Per-persona scorecard (worst first)\n");
  L.push("| Grade | Score | Persona | Frame | Device | Hard | A11y | Slow doors | Soft |");
  L.push("|:--:|--:|---|---|---|--:|--:|--:|--:|");
  for (const r of reports) {
    L.push(
      `| ${r.readinessGrade} | ${r.readinessScore} | ${r.displayName} | ${r.persona} | ${r.device} | ${r.hardFindings} | ${r.a11yCritical} | ${r.slowDoors.length} | ${r.softFindings} |`,
    );
  }
  L.push("");

  // ── Hard findings ──
  L.push("## 1. Breakage — these broke for a real user\n");
  if (totalHard === 0) {
    L.push("_None. Every persona walked all seven doors with no console errors, 5xx, or founder-codename leakage._\n");
  } else {
    for (const r of reports.filter((x) => x.hardFindings > 0)) {
      L.push(`### ${r.displayName} (${r.slug})`);
      for (const d of r.doors) {
        for (const i of [...d.consoleErrors.map((e) => `console: ${e}`), ...d.failedRequests.map((e) => `request: ${e}`), ...d.forbiddenLeaks.map((e) => `founder-leak: ${e}`)]) {
          L.push(`- \`${d.door}\` (${d.route}) — ${i}`);
        }
      }
      L.push("");
    }
  }

  // ── Accessibility (distinct violations, by frequency) ──
  L.push("## 2. Accessibility — critical + serious (axe-core)\n");
  if (totalA11y === 0) {
    L.push("_No critical/serious violations detected (or axe could not be injected — check one persona's JSON)._\n");
  } else {
    const agg = new Map<string, { count: number; help: string; impact: string }>();
    for (const r of reports) for (const d of r.doors) for (const v of d.a11y) {
      const cur = agg.get(v.id) ?? { count: 0, help: v.help, impact: v.impact };
      cur.count += v.nodes;
      agg.set(v.id, cur);
    }
    L.push("| Rule | Impact | Occurrences | What it means |");
    L.push("|---|---|--:|---|");
    for (const [id, v] of [...agg.entries()].sort((a, b) => b[1].count - a[1].count)) {
      L.push(`| \`${id}\` | ${v.impact} | ${v.count} | ${v.help} |`);
    }
    L.push("");
  }

  // ── Performance ──
  L.push("## 3. Performance — slow doors (DOMContentLoaded > 4s)\n");
  const slow: Array<{ persona: string; door: string; ms: number }> = [];
  for (const r of reports) for (const s of r.slowDoors) slow.push({ persona: r.displayName, door: s.door, ms: s.ms });
  if (slow.length === 0) {
    L.push("_No door exceeded the 4s threshold._\n");
  } else {
    L.push("| Persona | Door | DOMContentLoaded |");
    L.push("|---|---|--:|");
    for (const s of slow.sort((a, b) => b.ms - a.ms).slice(0, 25)) L.push(`| ${s.persona} | ${s.door} | ${(s.ms / 1000).toFixed(1)}s |`);
    L.push("");
  }

  // ── Soft / polish ──
  L.push("## 4. Polish — persona-frame & config-gated (review, not blocking)\n");
  L.push("_A roadmap vertical degrading to a base persona is honest; config-gated 5xx should ideally degrade to 200/empty._\n");
  for (const r of reports.filter((x) => x.softFindings > 0)) {
    const bits: string[] = [];
    for (const d of r.doors) {
      if (d.vocabMissing.length) bits.push(`\`${d.door}\` missing vocab: ${d.vocabMissing.join(", ")}`);
      if (d.degradedRequests?.length) bits.push(`\`${d.door}\` config-gated: ${d.degradedRequests.slice(0, 4).join("; ")}`);
    }
    if (r.moduleGating.missingExpected.length) bits.push(`nav missing expected: ${r.moduleGating.missingExpected.join(", ")}`);
    if (r.moduleGating.leakedHidden.length) bits.push(`nav LEAKED hidden: ${r.moduleGating.leakedHidden.join(", ")}`);
    if (bits.length) L.push(`- **${r.displayName}** — ${bits.join("; ")}`);
  }
  L.push("");

  const out = path.join(DIR, "REPORT.md");
  fs.writeFileSync(out, L.join("\n"));
  console.log(`Wrote ${out}`);
  console.log(`  verdict ${avgScore}/100 · ${reports.length} personas · ${totalHard} hard · ${totalA11y} a11y · ${totalSoft} soft · ${clean} clean`);
}

main();

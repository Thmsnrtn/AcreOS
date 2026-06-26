/**
 * Aggregate the per-persona JSON the spec emits into one findings report.
 *
 *   npx playwright test --project=customer-personas   # writes test-results/personas/<slug>.json
 *   npx tsx tests/personas/report.ts                  # → test-results/personas/REPORT.md
 *
 * The report is the deliverable: a per-persona ledger of what broke (hard) and
 * what diverged from the expected persona frame (soft), grouped so the founder
 * can read "which of my first 30 users had a bad time, and exactly where."
 */

import fs from "node:fs";
import path from "node:path";

const DIR = path.join("test-results", "personas");

interface DoorFinding {
  door: string;
  route: string;
  ok: boolean;
  consoleErrors: string[];
  failedRequests: string[];
  degradedRequests: string[];
  forbiddenLeaks: string[];
  vocabMissing: string[];
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
}

function load(): PersonaReport[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && f !== "REPORT.json")
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as PersonaReport)
    .sort((a, b) => b.hardFindings - a.hardFindings || b.softFindings - a.softFindings);
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
  const clean = reports.filter((r) => r.hardFindings === 0).length;

  const L: string[] = [];
  L.push("# The 30 First Users — persona findings report\n");
  L.push(`Personas walked: **${reports.length}**  ·  Clean (no hard findings): **${clean}/${reports.length}**`);
  L.push(`Hard findings (UI broke): **${totalHard}**  ·  Soft findings (persona-frame divergence): **${totalSoft}**\n`);

  L.push("## Per-persona summary\n");
  L.push("| Persona | Business type | Persona frame | Device | Hard | Soft |");
  L.push("|---|---|---|---|---:|---:|");
  for (const r of reports) {
    L.push(
      `| ${r.displayName} | ${r.businessType} | ${r.persona} | ${r.device} | ${r.hardFindings} | ${r.softFindings} |`,
    );
  }
  L.push("");

  // Hard findings, grouped.
  L.push("## Hard findings (these broke for a real user)\n");
  const anyHard = reports.some((r) => r.hardFindings > 0);
  if (!anyHard) {
    L.push("_None — every persona walked all seven doors with no console errors, 5xx, or founder-codename leakage._\n");
  } else {
    for (const r of reports.filter((x) => x.hardFindings > 0)) {
      L.push(`### ${r.displayName} (${r.slug})`);
      for (const d of r.doors) {
        const issues = [...d.consoleErrors.map((e) => `console: ${e}`), ...d.failedRequests.map((e) => `request: ${e}`), ...d.forbiddenLeaks.map((e) => `founder-leak: ${e}`)];
        for (const i of issues) L.push(`- \`${d.door}\` (${d.route}) — ${i}`);
      }
      L.push("");
    }
  }

  // Soft findings.
  L.push("## Soft findings (persona frame diverged from expectation)\n");
  L.push("_Not necessarily bugs — a roadmap vertical that degrades to a base persona is honest. Review for polish._\n");
  for (const r of reports.filter((x) => x.softFindings > 0)) {
    const bits: string[] = [];
    for (const d of r.doors) {
      if (d.vocabMissing.length) bits.push(`\`${d.door}\` missing vocab: ${d.vocabMissing.join(", ")}`);
      if (d.degradedRequests?.length) bits.push(`\`${d.door}\` config-gated 5xx/beacon: ${d.degradedRequests.join("; ")}`);
    }
    if (r.moduleGating.missingExpected.length) bits.push(`nav missing expected modules: ${r.moduleGating.missingExpected.join(", ")}`);
    if (r.moduleGating.leakedHidden.length) bits.push(`nav LEAKED hidden modules: ${r.moduleGating.leakedHidden.join(", ")}`);
    if (bits.length) L.push(`- **${r.displayName}** — ${bits.join("; ")}`);
  }
  L.push("");

  const out = path.join(DIR, "REPORT.md");
  fs.writeFileSync(out, L.join("\n"));
  console.log(`Wrote ${out}`);
  console.log(`  ${reports.length} personas · ${totalHard} hard · ${totalSoft} soft · ${clean} clean`);
}

main();

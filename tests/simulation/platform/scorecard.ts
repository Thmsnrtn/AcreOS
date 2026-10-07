/**
 * The scorecard: every run writes scorecard.json and a one-page, plain-English
 * scorecard.md.
 *
 *   npx tsx tests/simulation/platform/scorecard.ts --out <dir> --year <seed dirs…> \
 *     [--redteam <seed dir>] [--evals <evals.json>] [--walks <walks.json>] \
 *     [--mutation <invariant-mutation.json>] [--record <runs dir>]
 *
 * Distributions are p10 / p50 / p90 across seeds (founder minutes also across
 * every seed-week). The sensitivity analysis varies each driver of founder
 * minutes by ±50% around its measured volume (a linear surrogate fitted to the
 * runs, labelled as such) and ranks the swing. With --record it writes the run
 * records the Evidence Ladder points at (tests/simulation/evidence/runs/).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { p10p50p90 } from "../twin/rng";
import { assumptions, PARAMS } from "../twin/parameters";
import { CAPABILITIES, EVIDENCE_LEVEL_MEANING, evidenceSummary } from "../../../shared/governance/evidenceLadder";

const argv = process.argv.slice(2);
const list = (name: string): string[] => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) out.push(argv[j]);
  return out;
};
const one = (name: string) => list(name)[0];
const OUT = one("out") ?? "scorecard-out";
mkdirSync(OUT, { recursive: true });
const readJson = (p?: string) => (p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

const seeds = list("year").map((d) => readJson(join(d, "metrics.json"))).filter(Boolean);
const redteam = readJson(one("redteam") ? join(one("redteam")!, "metrics.json") : undefined);
const redteamAttacks = readJson(one("redteam") ? join(one("redteam")!, "redteam.json") : undefined);
const evals = readJson(one("evals"));
const walks = readJson(one("walks"));
const mutation = readJson(one("mutation"));
const dist = (xs: number[]) => (xs.length ? p10p50p90(xs) : null);
const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "n/a" : Math.round(x * 10) / 10);

// ── distributions ──
const weekTotals = seeds.flatMap((s: any) => s.founderMinutesPerWeek.weeks.map((w: any) => w.total));
const year = seeds.length ? {
  seeds: seeds.map((s: any) => s.seed),
  days: seeds[0].days,
  founderMinutesPerWeek: { perSeedMean: dist(seeds.map((s: any) => s.founderMinutesPerWeek.mean)), perSeedWeek: dist(weekTotals), lastQuarterPerSeedMean: dist(seeds.map((s: any) => { const w = s.founderMinutesPerWeek.weeks.slice(-13); return w.reduce((a: number, x: any) => a + x.total, 0) / Math.max(1, w.length); })) },
  support: {
    tickets: dist(seeds.map((s: any) => s.support.tickets)),
    handled: dist(seeds.map((s: any) => s.support.handled)),
    escalated: dist(seeds.map((s: any) => s.support.escalated)),
    dropped: dist(seeds.map((s: any) => s.support.dropped)),
  },
  complianceIncidents: dist(seeds.map((s: any) => s.complianceIncidents)),
  invariantViolations: dist(seeds.map((s: any) => s.invariants.violations)),
  violationsByInvariant: seeds.reduce((a: Record<string, number>, s: any) => { for (const [k, v] of Object.entries(s.invariants.byInvariant)) a[k] = (a[k] ?? 0) + Number(v); return a; }, {}),
  customers: {
    signedUp: dist(seeds.map((s: any) => s.customers.signedUp)),
    activationRate: dist(seeds.map((s: any) => s.customers.activated / Math.max(1, s.customers.signedUp))),
    churned: dist(seeds.map((s: any) => s.customers.churned)),
    churnRate: dist(seeds.map((s: any) => s.customers.churned / Math.max(1, s.customers.signedUp))),
  },
  aiCostCentsPerCustomerMonth: {
    customer: dist(seeds.map((s: any) => s.aiCost.customerCentsPerCustomerMonth)),
    platform: dist(seeds.map((s: any) => s.aiCost.platformCentsPerCustomerMonth)),
  },
  wallSeconds: dist(seeds.map((s: any) => s.wallSeconds)),
} : null;

// ── sensitivity: which drivers move founder minutes ──
function sensitivity() {
  if (!seeds.length) return null;
  const weeks = seeds[0].days / 7;
  const drivers: Record<string, number> = {};
  for (const s of seeds) {
    for (const [d, v] of Object.entries<any>(s.founderMinutesPerWeek.askMinutesByDriver ?? {})) drivers[`asks: ${d}`] = (drivers[`asks: ${d}`] ?? 0) + v.minutes / weeks / seeds.length;
    const w = s.founderMinutesPerWeek.weeks;
    drivers["dropped tickets (cover)"] = (drivers["dropped tickets (cover)"] ?? 0) + w.reduce((a: number, x: any) => a + x.dropMinutes, 0) / weeks / seeds.length;
    drivers["pages"] = (drivers["pages"] ?? 0) + w.reduce((a: number, x: any) => a + x.pageMinutes, 0) / weeks / seeds.length;
    drivers["setup + grant renewals"] = (drivers["setup + grant renewals"] ?? 0) + w.reduce((a: number, x: any) => a + x.setupMinutes, 0) / weeks / seeds.length;
  }
  const base = Object.values(drivers).reduce((a, b) => a + b, 0);
  const rows = Object.entries(drivers).map(([d, m]) => ({ driver: d, minutesPerWeek: m, low: base - 0.5 * m, high: base + 0.5 * m, swing: m })).sort((a, b) => b.swing - a.swing);
  // Scale: minutes per week vs active customers (least squares over every seed-week).
  const pts = seeds.flatMap((s: any) => s.founderMinutesPerWeek.weeks.map((w: any) => [w.customers, w.total] as [number, number]));
  const n = pts.length, sx = pts.reduce((a: number, p: number[]) => a + p[0], 0), sy = pts.reduce((a: number, p: number[]) => a + p[1], 0);
  const sxx = pts.reduce((a: number, p: number[]) => a + p[0] * p[0], 0), sxy = pts.reduce((a: number, p: number[]) => a + p[0] * p[1], 0);
  const slope = n > 1 && n * sxx - sx * sx !== 0 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : null;
  return { method: "linear surrogate: each driver's measured minutes/week varied ±50% with all else fixed (not a re-run of the app)", baseMinutesPerWeek: base, drivers: rows, minutesPerWeekPerActiveCustomer: slope, intercept: slope == null ? null : (sy - slope * sx) / n };
}
const sens = sensitivity();

const ladder = evidenceSummary();
const scorecard = {
  generatedAt: new Date().toISOString(),
  year, sensitivity: sens,
  redteam: redteam ? { days: redteam.days, violations: redteam.invariants.violations, byInvariant: redteam.invariants.byInvariant, attacks: redteamAttacks } : null,
  evals, walks,
  invariants: { mutation },
  evidence: { summary: ladder, capabilities: CAPABILITIES.map((c) => ({ id: c.id, level: c.level, meaning: EVIDENCE_LEVEL_MEANING[c.level], caveat: c.caveat ?? null })) },
  twin: { parameters: Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, { value: p.value, source: p.source }])), assumptions: assumptions() },
};
writeFileSync(join(OUT, "scorecard.json"), JSON.stringify(scorecard, null, 1));

// ── the one-page, plain-English version ──
const d3 = (x: any, unit = "") => (x ? `${r1(x.p10)}${unit} / ${r1(x.p50)}${unit} / ${r1(x.p90)}${unit}` : "not run");
const md: string[] = [];
md.push(`# AcreOS simulation scorecard`, "", `Generated ${scorecard.generatedAt}. Ranges are **low / typical / high** (10th / 50th / 90th percentile).`, "");
if (year) {
  md.push(`## A simulated year (${year.seeds.length} runs × ${year.days} days, real app, scripted capable brain)`, "");
  md.push(`- **Your time, minutes per week:** ${d3(year.founderMinutesPerWeek.perSeedWeek)} across every simulated week; average per run ${d3(year.founderMinutesPerWeek.perSeedMean)}; last quarter ${d3(year.founderMinutesPerWeek.lastQuarterPerSeedMean)} (target: under 24).`);
  md.push(`- **Support tickets per run:** ${d3(year.support.tickets)} opened — handled by Solene ${d3(year.support.handled)}, sent to you ${d3(year.support.escalated)}, dropped ${d3(year.support.dropped)}.`);
  md.push(`- **Compliance incidents:** ${d3(year.complianceIncidents)} (must be 0). **Business-rule violations:** ${d3(year.invariantViolations)} (must be 0).`);
  md.push(`- **Customers:** signed up ${d3(year.customers.signedUp)}; activated within 30 days ${d3(year.customers.activationRate ? { p10: year.customers.activationRate.p10 * 100, p50: year.customers.activationRate.p50 * 100, p90: year.customers.activationRate.p90 * 100 } : null, "%")}; churned ${d3(year.customers.churnRate ? { p10: year.customers.churnRate.p10 * 100, p50: year.customers.churnRate.p50 * 100, p90: year.customers.churnRate.p90 * 100 } : null, "%")}.`);
  md.push(`- **AI cost per customer per month (cents, the app's own metering of stand-in token counts):** customer-side ${d3(year.aiCostCentsPerCustomerMonth.customer)}; Solene's platform work ${d3(year.aiCostCentsPerCustomerMonth.platform)}.`);
  const vio = Object.entries(year.violationsByInvariant).filter(([, n]) => Number(n) > 0);
  if (vio.length) md.push(`- **Which rules broke:** ${vio.map(([k, n]) => `${k} ×${n}`).join(", ")}.`);
  md.push("");
}
if (sens) {
  md.push(`## What drives your minutes`, "", `Base ${r1(sens.baseMinutesPerWeek)} min/week. Each driver varied ±50% (${sens.method}). About ${r1(sens.minutesPerWeekPerActiveCustomer)} extra minutes per week per active customer.`, "");
  for (const r of sens.drivers.slice(0, 6)) md.push(`- ${r.driver}: ${r1(r.minutesPerWeek)} min/week → ${r1(r.low)}–${r1(r.high)} total`);
  md.push("");
}
if (scorecard.redteam) {
  const a = scorecard.redteam.attacks;
  md.push(`## Red team (${scorecard.redteam.days} days of an adversarial brain on the real app)`, "");
  md.push(`- Business-rule breaches: **${scorecard.redteam.violations}** (must be 0).`);
  if (a) md.push(`- Generated attack wordings: ${a.generated} (${a.heldOut} held out). Guards blocked ${a.inProcess?.heldOutBlocked}/${a.inProcess?.heldOut} held-out and ${a.inProcess?.workingBlocked}/${a.inProcess?.working} working wordings in-process (round-1 held-out shares cores with the tuned working set, so it is optimistic); **blind round-2 held-out: ${a.blindRound2?.blocked}/${a.blindRound2?.n} blocked**; ${a.world?.attempted ?? 0} attempts in the running app, ${a.world?.reachedTheWorld ?? 0} reached the world. Refused or failed work the founder reads in Story: ${a.world?.readableRefusals ?? "n/a"} of ${a.world?.refusals ?? "n/a"} readable; refusals the attacking model received: ${a.world?.readableToolRefusals ?? "n/a"} of ${a.world?.toolRefusals ?? "n/a"} in plain words.`);
  md.push("");
}
if (evals) {
  md.push(`## Question banks`, "", `- Pax: ${evals.pax?.total} generated questions (${evals.pax?.heldOut} held out); scripted judges agree on ${r1((evals.pax?.agreement ?? 0) * 100)}% of answers; ${evals.pax?.disagreements} disagreements surfaced. Held-out pass rate ${r1((evals.pax?.heldOutPassRate ?? 0) * 100)}%.`);
  md.push(`- Solene: ${evals.solene?.total} questions and commands; agreement ${r1((evals.solene?.agreement ?? 0) * 100)}%; held-out pass rate ${r1((evals.solene?.heldOutPassRate ?? 0) * 100)}%.`, `- Real-model judging was not run (no paid model calls in this run).`, "");
}
if (walks) {
  md.push(`## Using the real screens`, "", `- ${walks.pages} pages walked on phone and desktop by ${walks.personas?.length ?? 0} people; ${walks.axeViolations} accessibility problems (axe), ${walks.deadEnds} dead ends, ${walks.unlabelled} unlabelled controls.`);
  for (const t of (walks.timeToAnswer ?? []).slice(0, 8)) md.push(`- ${t.who}: "${t.question}" — ${t.answered ? `${r1(t.seconds)} s` : "not found"} (${t.viewport})`);
  md.push("");
}
md.push(`## How proven each claim is`, "", `${ladder.provenInSimulation} of ${ladder.total} claims are proven in simulation on the real app; ${ladder.provenBeyondSimulation} with a real model or real customers.`, "");
md.push(`## What the simulation cannot tell you`, "",
  "- How real sellers word things beyond the generated phrasings, and how real customers behave: every customer and seller behaviour is the twin's model, and these parameters are assumptions: " + assumptions().map((a) => a.key).join(", ") + ".",
  "- Whether a real model behaves like the scripted brains. Everything here is E2 at most.",
  "- Anything that depends on Redis TTLs, in-process timers or SQL CURRENT_TIMESTAMP/CURRENT_DATE (8 sites) — those do not follow the simulated clock.",
  "- Real provider behaviour beyond the failure codes the stand-ins reproduce, and real Stripe billing (plans and credits were set by SQL).",
  "- Scale: job cadence is compressed to a few passes per simulated day.", "");
writeFileSync(join(OUT, "scorecard.md"), md.join("\n"));

/**
 * A capability is proven by the year only when EVERY seed held its invariant
 * at zero AND every seed actually exercised it (vacuity): a rule nobody tested
 * proves nothing.
 */
function provenByYear(): string[] {
  const zero = (inv: string) => seeds.every((s: any) => Number(s.invariants.byInvariant[inv] ?? 0) === 0 && Number(s.invariants.coverage?.[inv]?.checked ?? 0) > 0);
  const all = (f: (s: any) => boolean) => seeds.length > 0 && seeds.every(f);
  const out: string[] = [];
  if (all((s) => s.support.handled > 0) && zero("refunds-within-rules")) out.push("support.tickets");
  if (all((s) => (s.published ?? 0) > 0)) out.push("writer.publishes");
  if (zero("one-page-per-incident") && all((s) => (s.outages ?? []).length > 0)) out.push("ops.one-page-per-incident");
  if (zero("no-send-without-consent") && all((s) => s.counts.revocations > 0 && s.coverage.sends > 0)) out.push("tcpa.revocation");
  if (zero("no-cross-tenant") && all((s) => s.coverage.queriesWithOrgColumn > 0)) out.push("tenancy.isolation");
  if (zero("every-number-has-a-source") && all((s) => s.coverage.screens > 0)) out.push("letter.sourced-numbers");
  if (zero("approval-is-version-bound") && all((s) => s.counts.founderAnswers > 0)) out.push("approvals.version-bound");
  if (zero("no-hard-stop-without-founder")) out.push("hardstops.founder-only");
  return out;
}

// ── run records for the Evidence Ladder ──
const recordDir = one("record");
if (recordDir) {
  mkdirSync(recordDir, { recursive: true });
  if (year && year.days >= 365) {
    writeFileSync(join(recordDir, "simplat-year-2026-10.json"), JSON.stringify({
      id: "simplat-year-2026-10", kind: "deterministic-sim", at: scorecard.generatedAt.slice(0, 10),
      proves: provenByYear(),
      summary: { seeds: year.seeds, days: year.days, founderMinutesPerWeek: year.founderMinutesPerWeek.perSeedWeek, violations: year.invariantViolations, compliance: year.complianceIncidents, support: year.support },
    }, null, 1));
  }
  if (scorecard.redteam) {
    writeFileSync(join(recordDir, "simplat-redteam-2026-10.json"), JSON.stringify({
      id: "simplat-redteam-2026-10", kind: "deterministic-sim", at: scorecard.generatedAt.slice(0, 10),
      proves: scorecard.redteam.violations === 0 ? ["tenancy.isolation", "hardstops.founder-only"] : [],
      summary: { days: scorecard.redteam.days, violations: scorecard.redteam.violations, attacks: scorecard.redteam.attacks?.world ?? null },
    }, null, 1));
  }
}
console.log(md.join("\n"));

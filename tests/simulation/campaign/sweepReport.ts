/**
 * Every output of the by-id isolation sweep (idor-sweep.ts) goes through here.
 *
 * The sweep runs in CI on a public repository, so its console is a public
 * record. The rule this module enforces:
 *
 *   PUBLIC (stdout/stderr): per-verdict COUNTS, breach count, population /
 *   probed / skipped counts, and why the run stopped. Nothing per route.
 *
 *   LEDGER ONLY (CAMPAIGN_OUT, the runner's temp dir in CI): every per-route
 *   verdict line, every finding title and body, every skip and its reason.
 *
 * idor-sweep.ts writes no console line of its own and does not import the
 * echoing ledger functions; tests/unit/isolationSweepRunsInCi.test.ts holds
 * both by parsing that file, and drives this module with a planted breach to
 * prove none of it reaches the streams.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { outDir, recordFinding, recordSkip, type Finding, type SkipRecord } from "./ledger";

/** One probed route's outcome. Ledger only. */
export interface RouteVerdict {
  verb: string;
  path: string;
  table: string | null;
  control?: number;
  attack?: number;
  survived?: boolean;
  verdict: string;
}

export function routeVerdict(v: RouteVerdict): void {
  const file = join(outDir(), "idor-routes.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ...v, at: new Date().toISOString() }) + "\n");
}

/** A finding, written to the ledger and never echoed. */
export function ledgerFinding(f: Finding): void {
  recordFinding(f, { echo: false });
}

/** A skip, written to the ledger and never echoed. */
export function ledgerSkip(s: SkipRecord): void {
  recordSkip(s, { echo: false });
}

export interface SweepCounts {
  population: number;
  byVerb: Record<string, number>;
  probed: number;
  skipped: number;
  forged: number;
  cleaned: number;
  breaches: number;
  verdicts: Record<string, number>;
  controlFailed: number;
  controlHadCanary: number;
  getProbed: number;
}

/** Collapse a per-route verdict to its class, so counts carry no route. */
export function verdictClass(verdict: string): string {
  if (verdict.includes("BREACH")) return "breach";
  if (verdict.startsWith("isolated")) return "isolated";
  if (verdict.startsWith("unverified")) return "unverified";
  if (verdict.startsWith("sloppy-reject")) return "5xx-reject";
  if (verdict === "2xx-weak-authz") return "2xx-without-data";
  if (verdict === "write-accepted-no-change") return "write-2xx-unchanged";
  if (verdict.startsWith("skip")) return "skipped";
  return "other";
}

/** The whole public summary: counts only. */
export function publicSummaryLines(c: SweepCounts): string[] {
  return [
    "── IDOR sweep summary (per-route detail: idor-routes.jsonl / findings.jsonl in CAMPAIGN_OUT) ──",
    `population (by-id routes):   ${c.population}  ${JSON.stringify(c.byVerb)}`,
    `probed (org-scoped table):   ${c.probed}`,
    `skipped (coverage gap):      ${c.skipped}`,
    `forged rows / cleaned:       ${c.forged} / ${c.cleaned}`,
    `verdicts:                    ${JSON.stringify(c.verdicts)}`,
    `control non-2xx:             ${c.controlFailed}`,
    `GET detector live-ness:      ${c.controlHadCanary}/${c.getProbed} own reads echoed the canary`,
    `breaches:                    ${c.breaches}`,
  ];
}

/** A public line. Callers pass counts and fixed text only. */
export function say(line: string): void {
  console.log(line);
}

/** A public reason the run is stopping (fixed text and counts only). */
export function stop(line: string): void {
  console.error(line);
}

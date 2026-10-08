/**
 * Campaign findings ledger — one JSON line per finding, appended by every sim.
 *
 * A finding is a CLAIM WITH EVIDENCE: what was driven, what came back, why it
 * matters. Sims never fabricate a finding from a skipped step — a step that
 * could not run is recorded as `skipped` with the reason, never as green.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Severity = "P0" | "P1" | "P2" | "P3" | "UX";

export interface Finding {
  id: string;
  product: "AcreOS" | "Foundry";
  sev: Severity;
  area: string;
  title: string;
  evidence: string;
  impact?: string;
  repro?: string;
  sim: string;
}

export interface SkipRecord {
  sim: string;
  step: string;
  reason: string;
}

const OUT_DIR =
  process.env.CAMPAIGN_OUT ?? join(process.cwd(), "tests/simulation/reports/campaign-2026-10-05");

function ensure(file: string) {
  mkdirSync(dirname(file), { recursive: true });
}

export function recordFinding(f: Finding): void {
  const file = join(OUT_DIR, "findings.jsonl");
  ensure(file);
  appendFileSync(file, JSON.stringify({ ...f, at: new Date().toISOString() }) + "\n");
  console.log(`  [${f.sev}] ${f.id}: ${f.title}`);
}

export function recordSkip(s: SkipRecord): void {
  const file = join(OUT_DIR, "skips.jsonl");
  ensure(file);
  appendFileSync(file, JSON.stringify({ ...s, at: new Date().toISOString() }) + "\n");
  console.log(`  [skip] ${s.sim}/${s.step}: ${s.reason}`);
}

export function recordMetric(sim: string, name: string, value: unknown): void {
  const file = join(OUT_DIR, "metrics.jsonl");
  ensure(file);
  appendFileSync(file, JSON.stringify({ sim, name, value, at: new Date().toISOString() }) + "\n");
}

export function outDir(): string {
  return OUT_DIR;
}

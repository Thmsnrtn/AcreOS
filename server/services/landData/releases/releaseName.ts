/**
 * Release names (D2b) — `acreos-parcels vYYYY.MM.N`.
 *
 * A release's IDENTITY is its content id (releaseManifest.ts). Its NAME is a
 * human handle assigned once, at the release's first promotion, and never
 * changed or reused:
 *
 *   - YYYY.MM is the UTC month of that first promotion;
 *   - N counts promotions-of-new-releases within that month: 1, 2, 3 … with
 *     no gaps and no reuse — a name that was ever assigned is never assigned
 *     again, even if its release is rolled away from;
 *   - names are monotone: a name is never minted for a month earlier than the
 *     latest name already minted (a clock that went backwards is refused, not
 *     papered over with an out-of-order name).
 *
 * Pure: the caller passes the names already assigned and the instant.
 */

import { DATASET } from "./releaseManifest";

export interface ReleaseVersion {
  year: number;
  month: number;
  seq: number;
}

const NAME = /^acreos-parcels v(\d{4})\.(\d{2})\.([1-9]\d*)$/;

export function formatReleaseName(v: ReleaseVersion): string {
  if (!Number.isInteger(v.year) || v.year < 2000 || v.year > 9999) throw new Error(`release year out of range: ${v.year}`);
  if (!Number.isInteger(v.month) || v.month < 1 || v.month > 12) throw new Error(`release month out of range: ${v.month}`);
  if (!Number.isInteger(v.seq) || v.seq < 1) throw new Error(`release sequence must be a positive integer: ${v.seq}`);
  return `${DATASET} v${v.year}.${String(v.month).padStart(2, "0")}.${v.seq}`;
}

/** Strict parse; null for anything that is not exactly a release name (no leading zeros in N, month 01–12). */
export function parseReleaseName(name: string): ReleaseVersion | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const v = { year: Number(m[1]), month: Number(m[2]), seq: Number(m[3]) };
  if (v.month < 1 || v.month > 12 || v.year < 2000) return null;
  return v;
}

const monthIndex = (v: { year: number; month: number }) => v.year * 12 + (v.month - 1);

/**
 * Check a set of assigned names is a valid history: every name parses, none
 * repeats, and each month's sequence is exactly 1..k. Returns the problems.
 */
export function auditReleaseNames(names: readonly string[]): string[] {
  const problems: string[] = [];
  const perMonth = new Map<number, number[]>();
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) problems.push(`release name reused: ${n}`);
    seen.add(n);
    const v = parseReleaseName(n);
    if (!v) {
      problems.push(`not a release name: ${JSON.stringify(n)}`);
      continue;
    }
    const list = perMonth.get(monthIndex(v)) ?? [];
    list.push(v.seq);
    perMonth.set(monthIndex(v), list);
  }
  for (const [mi, seqs] of Array.from(perMonth.entries())) {
    const sorted = Array.from(new Set(seqs)).sort((a, b) => a - b);
    sorted.forEach((s, i) => {
      if (s !== i + 1) {
        const y = Math.floor(mi / 12);
        const mo = (mi % 12) + 1;
        problems.push(`gap in ${y}.${String(mo).padStart(2, "0")}: expected .${i + 1}, found .${s}`);
      }
    });
  }
  return problems;
}

/**
 * The name the next first-promotion at `at` receives. Throws if the existing
 * names are not a valid history, or if `at` falls in a month earlier than the
 * latest name minted.
 */
export function nextReleaseName(existing: readonly string[], at: Date): string {
  if (Number.isNaN(at.getTime())) throw new Error("nextReleaseName: invalid instant");
  const problems = auditReleaseNames(existing);
  if (problems.length > 0) throw new Error(`refused: release name history is not valid (${problems.join("; ")})`);
  const now = { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
  let latest = -Infinity;
  let seqInMonth = 0;
  for (const n of existing) {
    const v = parseReleaseName(n)!;
    latest = Math.max(latest, monthIndex(v));
    if (monthIndex(v) === monthIndex(now)) seqInMonth = Math.max(seqInMonth, v.seq);
  }
  if (monthIndex(now) < latest) {
    throw new Error(`refused: ${now.year}.${String(now.month).padStart(2, "0")} is earlier than the latest release name already minted — the clock went backwards`);
  }
  return formatReleaseName({ ...now, seq: seqInMonth + 1 });
}

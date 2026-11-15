/**
 * PKG-6a — price-claim scanner for PROSE surfaces (markdown).
 *
 * A "claim" is a dollar figure adjacent to a plan name (Free / Starter / Pro /
 * Scale). Every figure it is checked against is DERIVED from
 * shared/billing/tier-pricing.ts — there is no second price list in here.
 * (Free is $0 by definition: tier-pricing.ts has no Free entry.)
 *
 * ROUNDING TOLERANCE (derived from how figures are presented). The annual
 * cadence on the rendered surfaces shows `Math.round(yearly / 12)` — a whole
 * dollar (publicPricingMatchesCanonical.test.tsx `annualMonthly`). Starter is
 * $490/12 = $40.83, Pro $82.50, Scale $165.83. So a whole-dollar figure is
 * accepted when it is within $0.50 of the exact per-month equivalent (so Pro
 * "$82", "$83" and "$82.50" pass, "$41" does not), and a figure written with
 * decimals must be within $0.01. Monthly and yearly figures are exact.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { TIER_PRICES_CENTS, type Tier } from "../../shared/billing/tier-pricing";

export type PlanName = "Free" | "Starter" | "Pro" | "Scale";
export const PLAN_NAMES: readonly PlanName[] = ["Free", "Starter", "Pro", "Scale"];

export interface PriceClaim {
  file: string; // repo-relative, posix
  line: number; // 1-based
  plan: PlanName;
  figure: number; // dollars as written
  unit: "month" | "year" | "seat" | null;
  annualFraming: boolean;
  text: string; // the trimmed line
}

/** A per-period dollar figure with no plan name adjacent. */
export interface OrphanFigure {
  file: string;
  line: number;
  figure: number;
  unit: "month" | "year" | "seat";
  text: string;
}

export interface Derived {
  monthly: number;
  yearly: number;
  annualPerMonth: number;
  seat: number | null;
}

/** Everything derived from the canonical registry. */
export function derivedFor(plan: PlanName): Derived {
  if (plan === "Free") return { monthly: 0, yearly: 0, annualPerMonth: 0, seat: null };
  const t = TIER_PRICES_CENTS[plan.toLowerCase() as Tier];
  return {
    monthly: t.priceMonthlyCents / 100,
    yearly: t.priceYearlyCents / 100,
    annualPerMonth: t.priceYearlyCents / 100 / 12,
    seat: t.priceMonthlyPerSeatCents === null ? null : t.priceMonthlyPerSeatCents / 100,
  };
}

const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Does this written figure match the annual-equivalent per-month price? */
export function matchesAnnualPerMonth(figure: number, exact: number): boolean {
  const whole = Number.isInteger(figure);
  return Math.abs(figure - exact) <= (whole ? 0.5 : 0.01) + 1e-9;
}

/** True when the claim is a correct statement of its plan's price. */
export function claimIsTrue(c: Pick<PriceClaim, "plan" | "figure" | "unit" | "annualFraming">): boolean {
  const d = derivedFor(c.plan);
  if (c.unit === "seat") return d.seat !== null && eq(c.figure, d.seat);
  if (c.unit === "year") return eq(c.figure, d.yearly);
  if (c.unit === "month") {
    if (c.annualFraming) return matchesAnnualPerMonth(c.figure, d.annualPerMonth);
    return eq(c.figure, d.monthly);
  }
  // no unit: any of the plan's true figures
  return eq(c.figure, d.monthly) || eq(c.figure, d.yearly) || matchesAnnualPerMonth(c.figure, d.annualPerMonth);
}

const FIGURE = /\$(\d[\d,]*(?:\.\d+)?)(?:\s*(?:\/|per\s+)\s*(mo(?:nth)?|yr|year|seat)\b)?/gi;
const PLAN = /\b(Free|Starter|Pro|Scale|FREE|STARTER|PRO|SCALE)\b/g;
const ANNUAL = /annual|yearly|\/\s*yr|per year/i;

const canon = (w: string): PlanName => (w[0] + w.slice(1).toLowerCase()) as PlanName;

function unitOf(raw: string | undefined): PriceClaim["unit"] {
  if (!raw) return null;
  const r = raw.toLowerCase();
  return r.startsWith("mo") ? "month" : r === "seat" ? "seat" : "year";
}

/** Extract claims from one markdown string. Pure — the canary feeds it directly. */
export function extractClaims(file: string, source: string, orphans: OrphanFigure[] = []): PriceClaim[] {
  const claims: PriceClaim[] = [];
  const lines = source.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.replace(/\*\*|`/g, "");
    for (const m of line.matchAll(FIGURE)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      // Nearest plan name BEFORE the figure (≤48 chars, no other figure between),
      // else the nearest AFTER (≤24 chars, no other figure between).
      let plan: PlanName | null = null;
      const before = line.slice(Math.max(0, start - 48), start);
      const lastDollar = before.lastIndexOf("$");
      const beforeScope = lastDollar >= 0 ? before.slice(lastDollar) : before;
      const pb = [...beforeScope.matchAll(PLAN)];
      if (pb.length) plan = canon(pb[pb.length - 1][1]);
      else {
        const after = line.slice(end, end + 24);
        const nextDollar = after.indexOf("$");
        const afterScope = nextDollar >= 0 ? after.slice(0, nextDollar) : after;
        const pa = [...afterScope.matchAll(PLAN)];
        if (pa.length) plan = canon(pa[0][1]);
      }
      const ctx = line.slice(Math.max(0, start - 24), end + 32);
      const unit = unitOf(m[2]);
      if (!plan) {
        // A per-period figure with no plan named next to it ("Pricing claim
        // ($41/mo annual)"): cannot be checked, so it is surfaced, not skipped.
        if (unit) orphans.push({ file, line: i + 1, figure: Number(m[1].replace(/,/g, "")), unit, text: raw.trim().slice(0, 200) });
        continue;
      }
      claims.push({
        file,
        line: i + 1,
        plan,
        figure: Number(m[1].replace(/,/g, "")),
        unit,
        annualFraming: ANNUAL.test(ctx),
        text: raw.trim().slice(0, 200),
      });
    }
  });
  return claims;
}

export function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries.sort()) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkMarkdown(p));
    else if (/\.mdx?$/.test(e)) out.push(p);
  }
  return out;
}

export function scanDir(
  root: string,
  dir: string,
  exclude: ReadonlySet<string> = new Set(),
  orphans: OrphanFigure[] = [],
): PriceClaim[] {
  const claims: PriceClaim[] = [];
  for (const abs of walkMarkdown(path.join(root, dir))) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (exclude.has(rel)) continue;
    claims.push(...extractClaims(rel, readFileSync(abs, "utf8"), orphans));
  }
  return claims;
}

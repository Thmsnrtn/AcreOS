/**
 * PKG-6a — price-figure truth for PROSE surfaces (detection only).
 *
 * publicPricingMatchesCanonical.test.tsx renders the landing pricing section,
 * /pricing and the JSON-LD and proves the RENDERED prices equal the decided
 * tiers. It cannot read prose: the marketing drafts, the outreach emails, the
 * investor/listing briefs. Those carried "Pro is $41/mo billed annually" —
 * $41 is STARTER's annual-equivalent (490/12 = 40.83); Pro's is 82.50 — and
 * the older "$20 / $49" era figures, and nothing noticed.
 *
 * This gate scans the prose population, extracts every dollar figure adjacent
 * to a plan name (tests/helpers/priceClaimScanner.ts) and diffs it against
 * figures DERIVED from shared/billing/tier-pricing.ts (no second price list;
 * rounding tolerance documented in the scanner header).
 *
 * THE REGISTER. Today's verified mismatches are named below, each a follow-up
 * fix item — NOT fixed here (docs/marketing and content/ are byte-identical).
 * The gate is green today and goes red on:
 *   - any mismatch not in the register (new drift),
 *   - a registered file gaining or losing occurrences,
 *   - a registered figure changing (the group key includes the figure),
 *   - a register entry the scanner no longer finds (stale entry — remove it
 *     when the copy is fixed; the register may only shrink).
 *
 * POPULATION (declared, not implied):
 *   docs/marketing/**                      — the founder-facing marketing drafts
 *   content/{marketing,emails,outreach,business,blog}/**
 *   client/src/pages/compare/*.tsx, landing/FAQ.tsx — comparison/FAQ prose
 * NOT scanned, on purpose:
 *   content/business/competitive-teardown.md — competitor price lists reuse the
 *     words Starter/Pro/Scale, so plan-name adjacency cannot attribute a figure
 *     to AcreOS. (Its AcreOS line "At $49/mo for full Pro access" is stale; it
 *     is named in WHAT_THIS_CANNOT_SEE below.)
 *   content/strategy/**, docs/*.md — internal planning, not published copy.
 *   Code comments — see COMMENT_DEBT (checked by exact snippet, not scanned).
 */
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TIER_PRICES_CENTS } from "../../shared/billing/tier-pricing";
import { LANDING_COPY } from "../../client/src/pages/landing/copy";
import { PRICING_TIER_COPY } from "../../client/src/lib/pricing-copy";
import {
  claimIsTrue,
  derivedFor,
  extractClaims,
  scanDir,
  type OrphanFigure,
  type PlanName,
  type PriceClaim,
} from "../helpers/priceClaimScanner";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");

// ─── population ──────────────────────────────────────────────────────────────

const MARKETING_DIR = "docs/marketing";
const CONTENT_DIRS = ["content/marketing", "content/emails", "content/outreach", "content/business", "content/blog"];
const TSX_PROSE = [
  "client/src/pages/compare/ComparisonPage.tsx",
  "client/src/pages/compare/acreos-vs-dealmachine.tsx",
  "client/src/pages/compare/acreos-vs-propstream.tsx",
  "client/src/pages/landing/FAQ.tsx",
];
const EXCLUDED = new Set(["content/business/competitive-teardown.md"]);

interface Population {
  claims: PriceClaim[];
  /** Orphans are only registered for docs/marketing (see ORPHAN_REGISTER). */
  marketingOrphans: OrphanFigure[];
}

function readPopulation(): Population {
  const marketingOrphans: OrphanFigure[] = [];
  const claims = scanDir(ROOT, MARKETING_DIR, EXCLUDED, marketingOrphans);
  for (const d of CONTENT_DIRS) claims.push(...scanDir(ROOT, d, EXCLUDED));
  for (const f of TSX_PROSE) claims.push(...extractClaims(f, readFileSync(path.join(ROOT, f), "utf8")));
  return { claims, marketingOrphans };
}

// ─── the register ────────────────────────────────────────────────────────────

interface PriceFinding {
  file: string;
  plan: PlanName;
  /** The figure as written, dollars. */
  figure: number;
  unit: "month" | "year" | "seat" | null;
  /** Exact number of occurrences today. */
  count: number;
  /** What is wrong, against tier-pricing.ts. */
  why: string;
}

const PRO_41 =
  "Pro annual-equivalent is $82.50/mo ($990/yr); $41 is Starter's ($490/12 = $40.83). The figure is wrong for the plan it names.";
const OLD_ERA = "Pre-repricing figure ($20 Starter / $49 Pro / $79 Scale era); today Starter $49, Pro $99.";

/** Each entry is a follow-up fix item. Remove the entry in the PR that fixes the copy. */
const PRICE_FINDINGS: PriceFinding[] = [
  { file: "docs/marketing/blog/the-buy-box-defined-six-filters.md", plan: "Pro", figure: 41, unit: "month", count: 4, why: PRO_41 },
  { file: "docs/marketing/blog/what-an-ai-assistant-should-do-for-a-land-investor.md", plan: "Pro", figure: 41, unit: "month", count: 3, why: PRO_41 },
  { file: "docs/marketing/linkedin-org-page-setup.md", plan: "Pro", figure: 41, unit: "month", count: 1, why: PRO_41 },
  { file: "docs/marketing/phase-zero-two-content-runway.md", plan: "Pro", figure: 41, unit: "month", count: 1, why: PRO_41 },
  { file: "docs/marketing/outreach/day-1-buy-box-overnight.md", plan: "Pro", figure: 41, unit: "month", count: 1, why: PRO_41 },
  { file: "docs/marketing/outreach/day-13-trial-ending-tomorrow.md", plan: "Pro", figure: 41, unit: "month", count: 4, why: PRO_41 },
  { file: "docs/marketing/outreach/day-30-trial-ended-no-conversion.md", plan: "Pro", figure: 41, unit: "month", count: 3, why: PRO_41 },
  // Found by this scanner beyond the Step-0 list (content/ prose, $20/$49 era):
  { file: "content/business/acquire-listing.md", plan: "Starter", figure: 20, unit: "month", count: 1, why: OLD_ERA },
  { file: "content/business/acquire-listing.md", plan: "Pro", figure: 49, unit: "month", count: 1, why: OLD_ERA },
  { file: "content/business/investor-brief.md", plan: "Starter", figure: 20, unit: "month", count: 1, why: OLD_ERA },
  { file: "content/business/investor-brief.md", plan: "Pro", figure: 49, unit: "month", count: 1, why: OLD_ERA },
  { file: "content/emails/onboarding-sequence.md", plan: "Starter", figure: 20, unit: "month", count: 1, why: OLD_ERA + " Customer-facing email." },
  { file: "content/emails/onboarding-sequence.md", plan: "Pro", figure: 49, unit: "month", count: 1, why: OLD_ERA + " Customer-facing email." },
];

/** Per-period figures with NO plan name beside them (uncheckable by adjacency — named, not skipped). */
const ORPHAN_REGISTER: { file: string; figure: number; unit: "month"; count: number; why: string }[] = [
  {
    file: "docs/marketing/linkedin-org-page-setup.md",
    figure: 41,
    unit: "month",
    count: 1,
    why: '"Pricing claim ($41/mo annual) matches …" — the same wrong Pro figure, in a checklist line that does not name the plan.',
  },
];

/**
 * Stale price figures in code COMMENTS. Not rendered, so not scanned: each is
 * pinned by exact snippet (present in the raw file AND absent once comments
 * are stripped, i.e. it really is only a comment). Fix = reword the comment
 * and delete the entry.
 */
const COMMENT_DEBT: { file: string; snippet: string; why: string }[] = [
  { file: "shared/billing/tier-pricing.ts", snippet: "starter ($20 / mo, $200 / yr)", why: "header lists $20/$49/$79 (+$200/$490/$790); canonical is $49/$99/$199" },
  { file: "shared/billing/tier-pricing.ts", snippet: "pro     ($49 / mo, $490 / yr)", why: "Pro is $99/$990" },
  { file: "shared/billing/tier-pricing.ts", snippet: "scale   ($79 / mo, $790 / yr)", why: "Scale is $199/$1,990" },
  { file: "client/src/pages/landing/Pricing.tsx", snippet: "canonical $20 / $49 / $79", why: "historical-record wording; names a stale trio as 'canonical'" },
  { file: "client/src/components/billing/seat-billing-summary.tsx", snippet: "Operator @ $49/mo + 2 extra seats × $20 = $89/mo", why: "Pro is $99/mo" },
  { file: "client/src/components/usage-limit-banner.tsx", snippet: "at $49/mo\" — so a", why: "Pro is $99/mo" },
  { file: "server/services/companyStageDetector.ts", snippet: "starter=$20, pro=$49", why: "Starter $49, Pro $99" },
  { file: "server/services/paxModelChoice.ts", snippet: "exceeded its $79 price", why: "Scale is $199" },
  { file: "server/services/paxModelChoice.ts", snippet: "$54 on a $79 plan", why: "Scale is $199" },
  { file: "server/seed-products.ts", snippet: "// $20/seat/month", why: "Starter is $49/mo, not a per-seat price" },
];

/** The register may only shrink: lower these when entries are fixed. */
const PRICE_MISMATCH_CEILING = 23;
const COMMENT_DEBT_CEILING = 10;

/**
 * NON-PRICE finding (plan CONTENT, not a figure): which plan unlocks the full
 * Pax assistant. The register asserts BOTH sides still say what they say, so
 * fixing either side turns this red and forces the entry out.
 */
const PLAN_CONTENT_FINDINGS = [
  {
    id: "pax-full-assistant-plan",
    landing: { file: "client/src/pages/landing/copy.ts", claim: "Pro unlocks the full Pax assistant" },
    pricingCopy: { plan: "starter", feature: /^Full Pax assistant/ },
    why: "Landing pricing sub says Pro unlocks the full Pax assistant; lib/pricing-copy.ts gives Starter 'Full Pax assistant'. Same claim appears in docs/marketing (what-an-ai-assistant…:104, the-buy-box…:131, linkedin, day-30) as a Pro-only feature.",
  },
] as const;

// ─── helpers ─────────────────────────────────────────────────────────────────

const keyOf = (f: { file: string; plan?: string; figure: number; unit: string | null }) =>
  `${f.file} | ${f.plan ?? "(no plan)"} | $${f.figure} | ${f.unit}`;

function tally<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
}

function diffTallies(actual: Map<string, number>, expected: Map<string, number>): string[] {
  const out: string[] = [];
  for (const k of new Set([...actual.keys(), ...expected.keys()])) {
    const a = actual.get(k) ?? 0;
    const e = expected.get(k) ?? 0;
    if (a !== e) out.push(`${k}: found ${a}, registered ${e}`);
  }
  return out;
}

/** A scanner that read nothing must read RED, never green. */
export function assertPopulationRead(claims: PriceClaim[], what: string, floor: number): void {
  if (claims.length < floor) {
    throw new Error(`vacuous scan: ${what} yielded ${claims.length} claims (floor ${floor}) — the scanner stopped reading`);
  }
}

const mismatches = (claims: PriceClaim[]) => claims.filter((c) => !claimIsTrue(c));

// ─── the gate ────────────────────────────────────────────────────────────────

describe("PKG-6a — prose price figures match tier-pricing.ts", () => {
  const pop = readPopulation();
  const bad = mismatches(pop.claims);

  it("every mismatch is registered, exactly (no new drift, no gained/lost occurrences, no changed figure)", () => {
    const expected = tally(
      PRICE_FINDINGS.flatMap((f) => Array.from({ length: f.count }, () => f)),
      keyOf,
    );
    const drift = diffTallies(tally(bad, keyOf), expected);
    expect(drift, `Prose price drift vs the register:\n${drift.join("\n")}`).toEqual([]);
  });

  it("registered per-period figures with no plan name are exact", () => {
    const expected = tally(
      ORPHAN_REGISTER.flatMap((f) => Array.from({ length: f.count }, () => f)),
      (f) => `${f.file} | $${f.figure} | ${f.unit}`,
    );
    const drift = diffTallies(
      tally(pop.marketingOrphans, (o) => `${o.file} | $${o.figure} | ${o.unit}`),
      expected,
    );
    expect(drift, drift.join("\n")).toEqual([]);
  });

  it("the register may only shrink", () => {
    const total = PRICE_FINDINGS.reduce((n, f) => n + f.count, 0);
    expect(total).toBeLessThanOrEqual(PRICE_MISMATCH_CEILING);
    expect(total).toBe(bad.length);
    expect(COMMENT_DEBT.length).toBeLessThanOrEqual(COMMENT_DEBT_CEILING);
  });

  it("every register entry names a real, current mismatch (none silent, none stale)", () => {
    const seen = new Set(bad.map(keyOf));
    for (const f of PRICE_FINDINGS) {
      expect(f.why.length, `${f.file}: finding without a reason`).toBeGreaterThan(20);
      expect(seen.has(keyOf(f)), `stale register entry: ${keyOf(f)}`).toBe(true);
      // the registered figure really is wrong for the plan it names
      expect(claimIsTrue({ plan: f.plan, figure: f.figure, unit: f.unit, annualFraming: f.why === PRO_41 })).toBe(false);
    }
  });

  // ── vacuity ──
  it("reads real populations: per-directory and per-registered-file floors", () => {
    assertPopulationRead(pop.claims.filter((c) => c.file.startsWith("docs/marketing/")), "docs/marketing", 19);
    assertPopulationRead(pop.claims.filter((c) => c.file.startsWith("content/emails/")), "content/emails", 2);
    assertPopulationRead(pop.claims.filter((c) => c.file.startsWith("content/business/")), "content/business", 6);
    for (const f of PRICE_FINDINGS) {
      const n = pop.claims.filter((c) => c.file === f.file && c.plan === f.plan && c.figure === f.figure).length;
      expect(n, `${f.file}: scanner read fewer claims than the register holds`).toBeGreaterThanOrEqual(f.count);
    }
    // the declared exclusion is a real file (a dead exclusion could hide a rename)
    for (const e of EXCLUDED) expect(() => readFileSync(path.join(ROOT, e), "utf8")).not.toThrow();
    // TSX comparison/FAQ prose: read, and currently carries no plan prices at all
    for (const f of TSX_PROSE) {
      expect(readFileSync(path.join(ROOT, f), "utf8").length, f).toBeGreaterThan(500);
      expect(
        pop.claims.filter((c) => c.file === f),
        `${f} gained a plan price figure — verify it and extend the register or fix it`,
      ).toEqual([]);
    }
  });

  it("a scanner that reads zero figures from an (empty or unreadable) docs/marketing reads RED", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "pkg6a-"));
    try {
      mkdirSync(path.join(tmp, "docs/marketing"), { recursive: true });
      writeFileSync(path.join(tmp, "docs/marketing/a.md"), "no prices here\n");
      const empty = scanDir(tmp, "docs/marketing");
      expect(() => assertPopulationRead(empty, "docs/marketing", 19)).toThrow(/vacuous scan/);
      expect(scanDir(tmp, "docs/does-not-exist")).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ── canary: the matcher flags seeded stale figures (synthetic surface, no real file edited) ──
  describe("canary — the matcher flags a seeded wrong figure", () => {
    const flagged = (text: string) => mismatches(extractClaims("synthetic.md", text));
    const p = (plan: "starter" | "pro" | "scale") => TIER_PRICES_CENTS[plan];
    const dollars = (cents: number) => cents / 100;

    it("flags the real defect shape: 'Pro is $41/mo billed annually'", () => {
      const hits = flagged("Pro is $41/mo billed annually — full Pax.");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ plan: "Pro", figure: 41, unit: "month", annualFraming: true });
    });

    it("flags variants: bold, upper-case, 'per month', plan-after-figure, wrong yearly, wrong seat", () => {
      expect(flagged("> **Upgrade to Pro — $41/month billed annually.**")).toHaveLength(1);
      expect(flagged("UPGRADE TO PRO — $41/month billed annually.")).toHaveLength(1);
      expect(flagged("ships with the Pro plan at $41 per month billed annually")).toHaveLength(1);
      expect(flagged("Starter ($20/mo) / Pro ($49/mo)")).toHaveLength(2);
      expect(flagged(`Scale is $${dollars(p("scale").priceYearlyCents) + 1}/yr`)).toHaveLength(1);
      expect(flagged("Pro seats are $19/seat")).toHaveLength(1);
      // "billed annually" at the MONTHLY price is itself wrong
      expect(flagged(`Pro is $${dollars(p("pro").priceMonthlyCents)}/mo billed annually`)).toHaveLength(1);
    });

    it("passes every true figure, derived from tier-pricing.ts (monthly, yearly, annual-equivalent)", () => {
      for (const plan of ["starter", "pro", "scale"] as const) {
        const name = plan[0].toUpperCase() + plan.slice(1);
        const t = p(plan);
        const annualPerMonth = Math.round(t.priceYearlyCents / 12 / 100);
        expect(flagged(`${name} is $${dollars(t.priceMonthlyCents)}/mo`), `${name} monthly`).toEqual([]);
        expect(flagged(`${name} is $${dollars(t.priceYearlyCents).toLocaleString("en-US")}/yr`), `${name} yearly`).toEqual([]);
        expect(flagged(`${name} is $${annualPerMonth}/mo billed annually`), `${name} annual-equivalent`).toEqual([]);
        if (t.priceMonthlyPerSeatCents !== null) {
          expect(flagged(`${name}: $${dollars(t.priceMonthlyPerSeatCents)}/seat`), `${name} seat`).toEqual([]);
        }
      }
      expect(flagged("Downgrade to Free — $0/month.")).toEqual([]);
    });

    it("rounding tolerance: whole-dollar within $0.50 of the exact per-month figure, decimals within $0.01", () => {
      const exact = derivedFor("Pro").annualPerMonth; // 82.50
      expect(exact).toBeCloseTo(82.5, 5);
      for (const ok of ["$82", "$83", "$82.50"]) expect(flagged(`Pro ${ok}/mo billed annually`), ok).toEqual([]);
      for (const no of ["$81", "$84", "$82.40"]) expect(flagged(`Pro ${no}/mo billed annually`), no).toHaveLength(1);
      // the wrong-plan figure: Starter's annual-equivalent ($41) is not Pro's, but IS Starter's
      expect(flagged("Starter is $41/mo billed annually")).toEqual([]);
      expect(flagged("Pro is $41/mo billed annually")).toHaveLength(1);
    });

    it("the scanner reads a synthetic file through the same path as the real population", () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "pkg6a-"));
      try {
        mkdirSync(path.join(tmp, "docs/marketing"), { recursive: true });
        writeFileSync(path.join(tmp, "docs/marketing/seeded.md"), "Intro.\n\nPro is $41/mo billed annually.\n");
        const claims = scanDir(tmp, "docs/marketing");
        expect(claims).toHaveLength(1);
        expect(mismatches(claims)).toHaveLength(1);
        // and the register diff would catch it: it is not in PRICE_FINDINGS
        expect(PRICE_FINDINGS.some((f) => f.file === claims[0].file)).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  // ── comment debt (not scanned; pinned by snippet) ──
  it("COMMENT_DEBT: every stale figure is still present, and is only a comment (not live code)", () => {
    for (const d of COMMENT_DEBT) {
      const raw = readFileSync(path.join(ROOT, d.file), "utf8");
      expect(raw.includes(d.snippet), `${d.file}: snippet gone — fixed? delete the entry and lower COMMENT_DEBT_CEILING`).toBe(true);
      expect(stripComments(raw).includes(d.snippet), `${d.file}: snippet is in live code, not a comment`).toBe(false);
    }
  });

  // ── non-price finding ──
  it("PLAN_CONTENT_FINDINGS: both sides of the Pax-assistant plan contradiction still stand", () => {
    for (const f of PLAN_CONTENT_FINDINGS) {
      const landing = JSON.stringify(LANDING_COPY);
      expect(landing.includes(f.landing.claim), `landing no longer says "${f.landing.claim}"`).toBe(true);
      const tier = PRICING_TIER_COPY.find((t) => t.id === f.pricingCopy.plan);
      expect(tier?.features.some((x) => f.pricingCopy.feature.test(x)), `${f.id}: pricing-copy no longer contradicts — fixed? remove the finding`).toBe(true);
      expect(f.why.length).toBeGreaterThan(20);
    }
  });
});

/**
 * No grant path may hand an org more credits than its plan's creditPool.
 *
 * WHAT HAPPENED. `server/services/credits.ts` carried TWO monthly-allowance
 * grants (CreditService.applyMonthlyAllowance and
 * UsageMeteringService.applyMonthlyAllowance + processMonthlyAllowances). Each
 * credited `SUBSCRIPTION_TIERS[tier].limits.monthlyCredits` to the purchased
 * credit wallet: $250/month on the $79 Scale plan — about three times Scale's
 * whole 8,000-credit pool (tier-limits.ts), paid for by the platform. Both had
 * ZERO production callers: dormant, and one cron registration away from live.
 * They were removed (2026-10 cost efficiency).
 *
 * WHY THIS IS NOT A NAME CHECK (law 1). Forbidding `applyMonthlyAllowance`
 * proves nothing: the same grant comes back as `grantPlanCredits`, or as a
 * direct `creditBalance + 25000` write. So the gate governs BEHAVIOUR, over the
 * whole server population (law 3), with three rules:
 *
 *   A. No server code READS the catalogue's `monthlyCredits` (property access,
 *      element access, or destructuring). That number is the one that exceeds
 *      creditPool; a grant cannot be sized from it if nothing reads it.
 *   B. Every write that INCREASES organizations.creditBalance is in the
 *      register below, keyed by (file, enclosing function). A new increment
 *      site — under any name — is red until someone registers it and says why
 *      it is bounded.
 *   C. Every `addCredits(...)` call passes a string-literal transaction type
 *      from the bounded set (refund / paid top-up / capped support credit). A
 *      monthly or bonus grant routed through the generic funnel is red.
 *
 * Canaries below hide each defect shape in a fixture and confirm the analyzer
 * sees it; the population floor confirms the walker read the tree.
 */
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { listServerSources, parseSource, rel, ownerFunctionName, unwrap } from "../helpers/serverPopulation";
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { TIER_LIMITS } from "@shared/billing/tier-limits";

// Walks every server source file; the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

interface Findings {
  monthlyCreditsReads: string[];
  balanceIncrements: string[]; // "file::fn"
  addCreditsCalls: Array<{ site: string; type: string | null }>;
}

function analyze(fileName: string, text: string, f: Findings): void {
  const sf = parseSource(fileName, text);
  const visit = (node: ts.Node) => {
    // Rule A — reads of monthlyCredits.
    if (ts.isPropertyAccessExpression(node) && node.name.text === "monthlyCredits") {
      f.monthlyCreditsReads.push(`${fileName}::${ownerFunctionName(node)}`);
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "monthlyCredits"
    ) {
      f.monthlyCreditsReads.push(`${fileName}::${ownerFunctionName(node)}`);
    }
    if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === "monthlyCredits") {
        f.monthlyCreditsReads.push(`${fileName}::${ownerFunctionName(node)}`);
      }
    }

    // Rule B — creditBalance writes whose value increases the balance.
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      (node.name.text === "creditBalance" || node.name.text === "credit_balance")
    ) {
      const init = unwrap(node.initializer);
      if (ts.isTaggedTemplateExpression(init)) {
        const tpl = init.template;
        const literalText = ts.isNoSubstitutionTemplateLiteral(tpl)
          ? tpl.text
          : [tpl.head.text, ...tpl.templateSpans.map((s) => s.literal.text)].join("${}");
        if (/\+/.test(literalText)) {
          f.balanceIncrements.push(`${fileName}::${ownerFunctionName(node)}`);
        }
      } else if (isInsideWriteCall(node)) {
        // An absolute assignment inside a write (`.set({ creditBalance: n })`)
        // can raise the balance to anything — treated as an increment site.
        f.balanceIncrements.push(`${fileName}::${ownerFunctionName(node)}`);
      }
    }

    // Rule C — addCredits callers and their transaction type.
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null;
      if (name === "addCredits") {
        const t = node.arguments[2];
        f.addCreditsCalls.push({
          site: `${fileName}::${ownerFunctionName(node)}`,
          type: t && ts.isStringLiteralLike(t) ? t.text : null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function isInsideWriteCall(node: ts.Node): boolean {
  let n: ts.Node | undefined = node.parent;
  while (n && !ts.isCallExpression(n)) {
    if (ts.isFunctionLike(n)) return false;
    n = n.parent;
  }
  if (!n || !ts.isCallExpression(n)) return false;
  const callee = unwrap(n.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
  return /^(set|values|update\w*|insert\w*|upsert\w*)$/i.test(name);
}

const empty = (): Findings => ({ monthlyCreditsReads: [], balanceIncrements: [], addCreditsCalls: [] });

/**
 * Rule B register — every balance-INCREASING write, with why it is bounded.
 * Keyed "file::function". Counts, so a second increment in a registered
 * function is also red.
 */
const BALANCE_INCREMENT_REGISTER: Record<string, { count: number; why: string }> = {
  "server/services/credits.ts::addCredits": {
    count: 1,
    why: "the generic funnel; every caller is pinned by rule C",
  },
  "server/services/credits.ts::applyCreditPackPurchase": {
    count: 1,
    why: "a Stripe-paid credit pack — the customer paid for every credit",
  },
  "server/services/autopilot/hands/apply-refund.ts::releaseClaim": {
    count: 1,
    why: "re-credits a clawback the same hand debited when its refund claim is released",
  },
};

/** Rule C — the bounded addCredits transaction types. */
const ALLOWED_ADD_CREDITS_TYPES: Record<string, string> = {
  refund: "returns credits the org spent on a send that failed",
  topup: "auto top-up charged to the org's card on file",
  support_credit: "courtesy credit, capped at 200¢ in supportBrain",
};

const FILES = listServerSources();
const REAL = empty();
for (const p of FILES) analyze(rel(p), fs.readFileSync(p, "utf8"), REAL);

describe("population — the walker read the server tree", () => {
  it("reads every server source file (floor)", () => {
    expect(FILES.length).toBeGreaterThan(1000);
  });
  it("finds the known increment and addCredits sites (per-member vacuity)", () => {
    for (const site of Object.keys(BALANCE_INCREMENT_REGISTER)) {
      expect(REAL.balanceIncrements, `register member ${site} not found — the parser stopped reading it`).toContain(site);
    }
    expect(REAL.addCreditsCalls.length).toBeGreaterThanOrEqual(7);
  });
});

describe("rule A — nothing in server/ reads SUBSCRIPTION_TIERS.monthlyCredits", () => {
  it("has zero reads", () => {
    expect(REAL.monthlyCreditsReads).toEqual([]);
  });
  it("why it matters: the catalogue number exceeds the plan's creditPool", () => {
    // Pinned as a fact, so a reader sees the hazard rule A defends against.
    expect(SUBSCRIPTION_TIERS.scale.limits.monthlyCredits).toBeGreaterThan(TIER_LIMITS.scale.creditPool);
  });
});

describe("rule B — every balance-increasing write is registered", () => {
  it("matches the register exactly", () => {
    const counts: Record<string, number> = {};
    for (const s of REAL.balanceIncrements) counts[s] = (counts[s] ?? 0) + 1;
    const expected = Object.fromEntries(Object.entries(BALANCE_INCREMENT_REGISTER).map(([k, v]) => [k, v.count]));
    expect(counts).toEqual(expected);
  });
});

describe("rule C — addCredits only for bounded purposes", () => {
  it("every call passes a literal, allowed transaction type", () => {
    const bad = REAL.addCreditsCalls.filter((c) => c.type === null || !(c.type in ALLOWED_ADD_CREDITS_TYPES));
    expect(bad).toEqual([]);
  });
});

describe("canaries — each defect shape is seen by the analyzer", () => {
  const run = (src: string) => {
    const f = empty();
    analyze("fixture.ts", src, f);
    return f;
  };
  it("A: property access", () => {
    expect(run(`function g(t){ return SUBSCRIPTION_TIERS[t].limits.monthlyCredits; }`).monthlyCreditsReads).toHaveLength(1);
  });
  it("A: element access", () => {
    expect(run(`const x = tiers.scale.limits["monthlyCredits"];`).monthlyCreditsReads).toHaveLength(1);
  });
  it("A: destructuring, renamed", () => {
    expect(run(`const { monthlyCredits: grant } = SUBSCRIPTION_TIERS.scale.limits;`).monthlyCreditsReads).toHaveLength(1);
  });
  it("A: a comment or string naming it is not a read", () => {
    expect(run(`// limits.monthlyCredits was removed\nconst s = "limits.monthlyCredits";`).monthlyCreditsReads).toHaveLength(0);
  });
  it("B: a renamed grant writing creditBalance + n through sql``", () => {
    const f = run(`class S { async grantPlanCredits(id){ await tx.update(organizations).set({ creditBalance: sql\`COALESCE(\${organizations.creditBalance}, '0')::numeric + \${25000}\` }); } }`);
    expect(f.balanceIncrements).toEqual(["fixture.ts::grantPlanCredits"]);
  });
  it("B: a cast-wrapped increment", () => {
    const f = run(`async function g(){ await db.update(o).set({ creditBalance: sql\`credit_balance + 1\` as any }); }`);
    expect(f.balanceIncrements).toEqual(["fixture.ts::g"]);
  });
  it("B: an absolute assignment inside .set()", () => {
    const f = run(`const bump = async () => db.update(o).set({ creditBalance: "25000" });`);
    expect(f.balanceIncrements).toEqual(["fixture.ts::bump"]);
  });
  it("B: a debit (minus) is not an increment", () => {
    expect(run(`async function d(){ await tx.update(o).set({ creditBalance: sql\`credit_balance - \${n}\` }); }`).balanceIncrements).toEqual([]);
  });
  it("B: a response object that merely reports the balance is not a write", () => {
    expect(run(`function r(org){ return { creditBalance: org.creditBalance }; }`).balanceIncrements).toEqual([]);
  });
  it("C: a monthly grant routed through addCredits", () => {
    const f = run(`async function m(){ await creditService.addCredits(id, SUBSCRIPTION_TIERS[t].limits.monthlyCredits, "monthly_allowance", "x"); }`);
    expect(f.addCreditsCalls).toEqual([{ site: "fixture.ts::m", type: "monthly_allowance" }]);
    expect(f.monthlyCreditsReads).toHaveLength(1);
  });
  it("C: a non-literal type is caught (cannot be reviewed)", () => {
    expect(run(`async function m(k){ await this.addCredits!(id, 5, k); }`).addCreditsCalls).toEqual([{ site: "fixture.ts::m", type: null }]);
  });
});

/**
 * Referral copy may only promise what the referral machine implements
 * (P1-2 / CR-047 — the fix for the "three programs" defect).
 *
 * The one real program lives in server/services/referralReward.ts:
 *   referee  — REFERRAL_REWARD_CENTS at their first paid invoice
 *   referrer — the same credit after REFERRAL_RETENTION_HOLD_DAYS of
 *              retention (+REFERRAL_ANNUAL_BONUS_CENTS when the referee
 *              bills annually), plus REFERRAL_MILESTONES bonuses.
 *
 * Three surfaces promised other programs instead:
 *   1. server/jobs/growthAutomation.ts — the ARMED 6-hourly power-user
 *      invite: "1 month free for every paying referral" + "20% off their
 *      first 3 months", linking to a /referrals route that does not exist.
 *   2. client/src/pages/today.tsx — the referral nudge: "you both earn a
 *      free month when they close their first deal" (deal_won has not
 *      rewarded since the 2026-09-01 terms moved the trigger to payment).
 *   3. content/marketing/referral-copy.md — both-sides free month of Pro
 *      on first deal close, "applied automatically".
 *
 * The expected terms below are DERIVED from referralReward.ts's constants
 * (parsed, not imported — importing the service would drag in the DB
 * chain), so changing the machine's economics without re-aligning the
 * copy fails this suite. String/template literals are read with the
 * TypeScript parser (the winBackCopyIsHonest idiom), so comments — which
 * legitimately record the false copy's history — are never in the
 * population. today.tsx's nudge is JSX text, not a literal, so that one
 * block is read as raw text, scoped to the nudge card.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
}

function literalsOf(rel: string, kind: ts.ScriptKind): string[] {
  const file = path.resolve(__dirname, "../..", rel);
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** The machine's terms, parsed out of referralReward.ts itself. */
function machineTerms() {
  const file = path.resolve(__dirname, "../../server/services/referralReward.ts");
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const nums = new Map<string, number>();
  const milestones = new Map<number, number>();
  const num = (init: ts.Expression | undefined): number =>
    init && ts.isNumericLiteral(init) ? Number(init.text.replace(/_/g, "")) : NaN;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      const name = n.name.text;
      if (name === "REFERRAL_MILESTONES" && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const prop of n.initializer.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isNumericLiteral(prop.name)) {
            milestones.set(Number(prop.name.text), num(prop.initializer));
          }
        }
      } else if (name.startsWith("REFERRAL_")) {
        nums.set(name, num(n.initializer));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  const rewardCents = nums.get("REFERRAL_REWARD_CENTS") ?? NaN;
  const annualBonusCents = nums.get("REFERRAL_ANNUAL_BONUS_CENTS") ?? NaN;
  const holdDays = nums.get("REFERRAL_RETENTION_HOLD_DAYS") ?? NaN;
  const usd = (cents: number) => `$${Math.round(cents / 100)}`;
  return {
    rewardCents,
    holdDays,
    rewardUsd: usd(rewardCents),
    annualTotalUsd: usd(rewardCents + annualBonusCents),
    milestones: [...milestones.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, cents]) => ({ n, usd: usd(cents) })),
  };
}

const terms = machineTerms();

describe("the machine's constants are the known program (vacuity floor)", () => {
  it("parses real values out of referralReward.ts", () => {
    expect(terms.rewardCents).toBeGreaterThan(0);
    expect(terms.holdDays).toBeGreaterThan(0);
    expect(terms.milestones.length).toBeGreaterThan(0);
    for (const m of terms.milestones) expect(m.usd).toMatch(/^\$\d+$/);
  });
});

describe("growthAutomation referral invite", () => {
  const source = read("server/jobs/growthAutomation.ts");
  const literals = literalsOf("server/jobs/growthAutomation.ts", ts.ScriptKind.TS);
  const joined = literals.join("\n");

  it("reads the email bodies (vacuity floor)", () => {
    expect(literals.length).toBeGreaterThan(50);
    expect(joined).toContain("Refer a Land Investor, earn rewards:");
  });

  it("is DISARMED by default — re-arming is an explicit env opt-in", () => {
    expect(source).toContain('process.env.GROWTH_REFERRAL_INVITES_ENABLED === "true"');
    expect(source).toContain("if (!CONFIG.REFERRAL_INVITES_ENABLED)");
  });

  it("derives its amounts from the machine's constants, never literals", () => {
    expect(source).toContain("REFERRAL_REWARD_CENTS");
    expect(source).toContain("REFERRAL_ANNUAL_BONUS_CENTS");
    expect(source).toContain("REFERRAL_RETENTION_HOLD_DAYS");
    expect(source).toContain("REFERRAL_MILESTONES");
  });

  it("promises no discount program that does not exist", () => {
    const hits = literals.filter((l) => /20%\s*off/i.test(l) || /month free|free month/i.test(l));
    expect(hits).toEqual([]);
  });

  it("states the real triggers: first paid invoice, then the retention hold", () => {
    expect(joined).toContain("first paid invoice lands");
    expect(joined).toContain("stayed a subscriber for");
    expect(joined).toContain("account credit");
    expect(joined).toContain("Credits apply to AcreOS invoices only");
  });

  it("links to the live referral surface, not the dead /referrals route", () => {
    const hits = literals.filter((l) => l.includes("/referrals"));
    expect(hits).toEqual([]);
    expect(joined).toContain("/settings?tab=account");
  });
});

describe("today.tsx referral nudge", () => {
  const source = read("client/src/pages/today.tsx");
  const start = source.indexOf("Refer another Land Investor");
  const block = start >= 0 ? source.slice(start, start + 260).replace(/\s+/g, " ") : "";

  it("finds the nudge copy (vacuity floor)", () => {
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("Refer another Land Investor");
  });

  it("states the machine's terms, not the deal-close free month", () => {
    expect(block).toContain(terms.rewardUsd);
    expect(block).toContain("first paid invoice");
    expect(block).toContain(`${terms.holdDays} days`);
    expect(block).not.toMatch(/free month|first deal/i);
  });
});

describe("content/marketing/referral-copy.md", () => {
  const copy = read("content/marketing/referral-copy.md");

  it("states every term of the one real program", () => {
    expect(copy).toContain(terms.rewardUsd);
    expect(copy).toContain(terms.annualTotalUsd);
    expect(copy).toContain("first paid invoice");
    expect(copy).toContain(`${terms.holdDays} days`);
    for (const m of terms.milestones) expect(copy).toContain(m.usd);
    expect(copy).toContain("AcreOS invoices only");
  });

  it("promises neither of the two phantom programs", () => {
    expect(copy).not.toMatch(/free month/i);
    expect(copy).not.toMatch(/close (their|his|her) first deal|first closed deal/i);
    expect(copy).not.toContain("20%");
  });
});

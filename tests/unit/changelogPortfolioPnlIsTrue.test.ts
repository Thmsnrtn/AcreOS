/**
 * P1 false-claims sweep — the customer changelog describes the real P&L.
 *
 * The v5.7 entry said /portfolio-pnl "rolls up realized and unrealized gains
 * … broken out by county, vintage, and acquisition channel". None of those
 * exist in the P&L service, its route, or its page.
 *
 * Coupled to the code: every changelog entry that names /portfolio-pnl may use
 * a breakdown term only if the P&L code (service + route + page, comments
 * stripped) actually carries it; and the capabilities it does claim must be
 * there.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { CUSTOMER_CHANGELOG } from "../../client/src/data/customer-changelog";

const ROOT = path.resolve(__dirname, "../..");
const PNL_FILES = ["server/services/portfolioPnl.ts", "server/routes-portfolio-pnl.ts", "client/src/pages/portfolio-pnl.tsx"];
const pnlCode = PNL_FILES.map((f) => stripComments(readFileSync(path.join(ROOT, f), "utf8"))).join("\n");

/** Claim term in the changelog → evidence that must exist in the P&L code. */
const TERMS: { claim: RegExp; evidence: RegExp }[] = [
  { claim: /\bunrealized\b/i, evidence: /unrealized/i },
  { claim: /\brealized\b/i, evidence: /\brealized/i },
  { claim: /\bby county\b|\bcounty\b/i, evidence: /county/i },
  { claim: /\bvintage\b/i, evidence: /vintage/i },
  { claim: /acquisition channel|\bchannel\b/i, evidence: /channel/i },
  { claim: /\bIRR\b/, evidence: /\birr\b/i },
  { claim: /cash-on-cash/i, evidence: /cocReturn|Cash-on-cash/ },
  { claim: /quarterly/i, evidence: /Quarterly/ },
  { claim: /interest income/i, evidence: /interestIncome/ },
];

describe("changelog entries about /portfolio-pnl claim only what the P&L computes", () => {
  const entries = CUSTOMER_CHANGELOG.flatMap((r) => r.changes).filter((c) => /portfolio-pnl|Portfolio P&L/i.test(`${c.title} ${c.body}`));

  it("finds the entries (vacuity)", () => {
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(pnlCode).toMatch(/getPortfolioPnl/);
  });

  it("every breakdown term in an entry exists in the P&L code", () => {
    const unbacked: string[] = [];
    for (const e of entries) {
      for (const t of TERMS) {
        if (t.claim.test(e.body) && !t.evidence.test(pnlCode)) unbacked.push(`${e.title}: ${e.body.match(t.claim)?.[0]}`);
      }
    }
    expect(unbacked).toEqual([]);
  });
});

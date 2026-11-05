/**
 * The growth_automation emails may not advertise frozen or killed surfaces.
 *
 * The win-back touch-2 email told churned customers about "Marketplace — buy
 * and sell land notes peer-to-peer" (FREEZE, ~25-customer ladder),
 * "Satellite imagery — automated property condition analysis" (Vision AI,
 * KILL 2026-08-01) and "Voice AI — call transcription + sentiment analysis"
 * (KILL 2026-08-01). A churned customer who came back for any of them would
 * find a "not available" page or nothing at all. That is fabrication in a
 * customer-facing message (CLAUDE.md DO-NOT-DO: "Fabrication is never
 * acceptable").
 *
 * PARSED, NOT SCANNED. Every string and template literal in the job is read
 * with the TypeScript parser, so the comment above — and any comment in the
 * job recording why a claim was removed — is never part of the population.
 * The population is the whole job file, not only touch 2: every engine in it
 * sends customer email.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const JOB = path.resolve(__dirname, "../../server/jobs/growthAutomation.ts");

function literalsOf(file: string): string[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
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

/** Surfaces with a FREEZE/KILL verdict, by the ways copy names them. */
const NOT_SHIPPING: Array<{ verdict: string; claim: RegExp }> = [
  { verdict: "Marketplace — FREEZE (ladder: ~25 customers)", claim: /\bmarketplace\b/i },
  { verdict: "Marketplace — FREEZE (ladder: ~25 customers)", claim: /peer[- ]to[- ]peer/i },
  { verdict: "Investor network — FREEZE (a marketplace, 2026-10-20)", claim: /investor network/i },
  { verdict: "Capital markets — FREEZE (H4)", claim: /capital markets/i },
  { verdict: "Vision AI — KILL 2026-08-01", claim: /satellite imagery|vision ai|property condition analysis/i },
  { verdict: "Voice AI — KILL 2026-08-01", claim: /voice ai|call transcription|sentiment analysis/i },
];

describe("growth_automation email copy advertises only what ships", () => {
  const literals = literalsOf(JOB);

  it("reads the email bodies (vacuity floor)", () => {
    // If the parser stopped visiting template literals, every claim below would
    // pass over nothing. The win-back subject lines are known members.
    expect(literals.length).toBeGreaterThan(50);
    expect(literals.some((l) => l.includes("AcreOS product update"))).toBe(true);
    expect(literals.some((l) => l.includes("<li>"))).toBe(true);
  });

  for (const { verdict, claim } of NOT_SHIPPING) {
    it(`no ${claim} (${verdict})`, () => {
      const hits = literals.filter((l) => claim.test(l));
      expect(hits, `${verdict} is advertised in customer email`).toEqual([]);
    });
  }
});

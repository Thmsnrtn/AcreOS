/**
 * A cap rate whose expenses were invented, and no way to tell.
 *
 * `routes-rent-roll-import.ts` computed an NOI snapshot for a rent roll and
 * returned it from both `/rent-roll/preview` and `/rent-roll/import`:
 *
 *     const opex = parsed.monthlyOpExpenseEstimateCents ?? Math.round(collected * 0.40);
 *
 * When the uploader supplied a figure that is THEIR number. When they did not,
 * the server used 40% of collected rent — a real underwriting convention, and
 * still a number this product invented. **The response shape could not tell the
 * two apart**, and `noiMonthlyCents`, `noiAnnualCents` and `capRateAtAskingPct`
 * are all derived from it. Someone reading "cap rate 7.2%" could not know whether
 * the expenses behind it were counted or assumed.
 *
 * The constitution's rule is that no invented number may be presented as real,
 * and the neighbouring modules already show the shape of the answer:
 * `camReconciliation` refuses a fabricated pro-rata share and says why,
 * `computeDepositDeadline` returns `{ known: false, unknownReason }`, and
 * `nextPaymentVerdict` returns the REASON for every blank. This one gets
 * DISCLOSURE rather than refusal — the rule of thumb genuinely is how a first
 * pass at a park is underwritten — but disclosure has to reach the caller, and
 * a comment on the line (`// Imelda: ~40% rule of thumb`) reaches nobody.
 *
 * **STATED PLAINLY: no surface renders this today.** The rent-roll import dialog
 * previews rows and never displays the NOI block, so nothing on screen is
 * currently lying. Two reasons to fix it anyway. The API is a product surface in
 * its own right — an operator or an agent can read the response. And unit 90's
 * lesson runs the other way here: fixing the server first is what makes the
 * renderer, whenever it arrives, unable to present the assumed number as counted.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "server/routes-rent-roll-import.ts");

/** Comments stripped: a note describing this defect must not trip the check. */
const raw = fs.readFileSync(SRC, "utf8");
const code = stripComments(raw);

describe("an assumed operating expense is labelled as assumed", () => {
  it("the snapshot carries a basis", () => {
    expect(code, "NoiSnapshot no longer reports where opex came from").toContain(
      "opExpenseBasis",
    );
    expect(code).toMatch(/"operator_supplied"/);
    expect(code).toMatch(/"rule_of_thumb"/);
  });

  it("the basis is DERIVED from whether the operator supplied one", () => {
    // Not a constant, and not defaulted — the whole defect was that the two
    // cases were indistinguishable downstream.
    expect(code).toMatch(
      /opExpenseBasis:\s*operatorOpex !== undefined \? "operator_supplied" : "rule_of_thumb"/,
    );
  });

  it("the assumed percentage is reported, and only when it was assumed", () => {
    // A caller checking the arithmetic needs the fraction, and a caller whose
    // operator DID supply a figure must not be handed one — that would imply an
    // assumption where none was made.
    expect(code).toContain("opExpenseAssumedPctOfCollected");
    expect(code).toMatch(
      /opExpenseAssumedPctOfCollected:\s*\n?\s*operatorOpex !== undefined \? null : OPEX_RULE_OF_THUMB_PCT/,
    );
  });

  it("the convention is named once, so the number and the disclosure cannot drift", () => {
    // It was a bare `0.40` inline. If the disclosure quoted a literal and the
    // arithmetic used another, the response would misreport its own assumption —
    // which is this session's recurring defect in miniature.
    expect(code).toContain("const OPEX_RULE_OF_THUMB_PCT = 0.4;");
    expect(
      code,
      "the rule-of-thumb fraction is inlined again instead of using the constant",
    ).not.toMatch(/collected \* 0\.4/);
  });

  it("and NOI is still derived from the same figure it discloses", () => {
    // Vacuity guard: a basis field is worthless if the number it describes is
    // not the one the maths used.
    expect(code).toMatch(/const opex = operatorOpex \?\? Math\.round\(collected \* OPEX_RULE_OF_THUMB_PCT\)/);
    expect(code).toContain("const noiMonthly = collected - vacancyAdj - opex;");
  });

  it("the reasoning survives in the source, not only here", () => {
    // Read RAW — the explanation is a comment, and the next person to touch this
    // line should meet the argument before the code.
    expect(raw).toMatch(/derived from it/i);
    expect(raw).toMatch(/counted or assumed/i);
  });
});

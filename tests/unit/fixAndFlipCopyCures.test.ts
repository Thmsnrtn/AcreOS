/**
 * Fix-and-flip bar-(f) copy cures (F-1, F-2, F-3, F-7) — source pins.
 *
 * The paper pass (hidden_files/paper-pass-fix-and-flip-2026-11.md) found the
 * contractor / 1099-NEC surfaces presenting the UNCONFIRMED $600 NEC
 * threshold as settled fact while the server gate withholds generation over
 * that figure, the draws surface carrying no records-only line, and
 * rehab-detail carrying no disclaimer. The cures record
 * (paper-cures-fix-and-flip-2026-11.md, Items 1, 2, 3, 5) drafted the exact
 * replacement copy; these pins hold the landed copy to that draft and keep
 * the old settled-fact presentations from returning.
 *
 * Source-read pins (the pattern of nec1099QualifiedOutputGate.test.ts):
 * copy is a compliance surface here, so the strings themselves are the
 * behaviour under test. Whitespace is collapsed before matching because
 * JSX wraps copy across lines.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8").replace(/\s+/g, " ");
}

const contractors = src("client/src/pages/contractors.tsx");
const necPage = src("client/src/pages/contractor-1099-nec.tsx");
const draws = src("client/src/components/rehabs/draws-section.tsx");
const rehabDetail = src("client/src/pages/rehab-detail.tsx");
const payer = src("server/services/form1099NecPayer.ts");

const REVIEW_NOTE =
  "The $600 reporting threshold has not been confirmed for this tax year — confirm it with your tax professional.";

describe("F-1 — contractors page threshold copy", () => {
  it("carries the server's NEC_THRESHOLD_REVIEW_NOTE verbatim", () => {
    // The note lives in the server constant…
    expect(payer).toContain(REVIEW_NOTE);
    // …and the cured client copy renders exactly that sentence.
    expect(contractors).toContain(REVIEW_NOTE);
  });

  it("uses the cured header copy, not the settled-fact original", () => {
    expect(contractors).toContain(
      "Auto-flags contractors over the 1099-NEC reporting threshold AcreOS currently applies ($600) so you're not chasing W-9s in December.",
    );
    expect(contractors).toContain(
      "AcreOS flags against the unconfirmed figure so no one is missed while it is confirmed; the flag is a reminder, not a determination that a form is owed.",
    );
    expect(contractors).not.toContain("$600 1099-NEC threshold so you're not chasing");
  });

  it("badges make no eligibility determination", () => {
    expect(contractors).toContain("over threshold — W-9 on file");
    expect(contractors).toContain("below current threshold");
    expect(contractors).toContain("need W-9");
    expect(contractors).not.toContain(">1099 eligible<");
    expect(contractors).not.toContain(">below threshold<");
  });
});

describe("F-1/F-2 — 1099-NEC page copy and refusal surfacing", () => {
  it("header states generation is withheld until the threshold is confirmed", () => {
    expect(necPage).toContain(
      "Prepares Copy B (recipient copy) PDFs for contractors over the reporting threshold for the selected tax year.",
    );
    expect(necPage).toContain(
      "1099-NEC generation is currently withheld: the reporting threshold this generator applies ($600) has not been confirmed by a qualified tax reviewer for this tax year, and the figure for payments made after 2025 may differ. No forms are generated until the threshold is confirmed.",
    );
    expect(necPage).toContain(
      "When generation is available: paper IRS filing requires the red-ink Copy A form — use the IRS FIRE / IRIS system for electronic filing.",
    );
    expect(necPage).not.toContain("Generates Copy B (recipient copy) PDFs for every contractor over $600");
  });

  it("preview surfaces the gate's structured refusal as a refusal card", () => {
    expect(necPage).toContain('res.status === 422 && json?.error === "not_qualified_filing_output"');
    expect(necPage).toContain('data-testid="nec-filing-refusal-card"');
    expect(necPage).toContain("1099-NEC generation is withheld.");
    // The card renders the server's message from the response body, never a
    // client-side copy of the refusal text.
    expect(necPage).toContain("{refusal.message}");
    expect(necPage).not.toContain("No forms were generated. It is not a qualified filing output");
  });

  it("generate refusal also lands on the refusal card", () => {
    expect(necPage).toContain('detail?.error === "not_qualified_filing_output"');
    expect(necPage).toContain("setGenerateRefusal");
  });
});

describe("F-3 — draws records-only line", () => {
  it("states draws are the operator's records and AcreOS moves no draw money", () => {
    expect(draws).toContain(
      "This schedule is your record of the draws under your loan — requests, inspections, and funding as you enter them. AcreOS does not fund, hold, release, or verify draw money; funding happens between you and your lender.",
    );
  });
});

describe("F-7 — rehab-detail worksheet disclaimer", () => {
  it("renders the existing worksheet RequiredDisclaimer above the holding sections", () => {
    expect(rehabDetail).toContain('import { RequiredDisclaimer } from "@/components/required-disclaimer";');
    const disclaimerAt = rehabDetail.indexOf('<RequiredDisclaimer type="worksheet"');
    const holdingAt = rehabDetail.indexOf('data-testid="rehab-timeline"');
    expect(disclaimerAt).toBeGreaterThan(-1);
    expect(holdingAt).toBeGreaterThan(-1);
    expect(disclaimerAt).toBeLessThan(holdingAt);
  });
});

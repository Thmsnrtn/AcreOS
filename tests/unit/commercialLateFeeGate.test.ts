/**
 * Wave 2 pass B — the residential late-fee surface is gated OUT for commercial
 * orgs, front AND back. This is the FABRICATION FIX: the `late_fee_rules` table
 * encodes RESIDENTIAL statutory caps + citations, which do not bind a
 * commercial lease (a commercial late fee is contractual, set by the lease, not
 * by statute). Showing those caps to a commercial org — or letting it hit the
 * proposal/apply endpoints — presents wrong-domain data as the binding rule.
 *
 * These are source-shape contracts (the same pattern as tailVerticalGates /
 * landlordFamilyGates): they run in the node env with no DOM and no DB, and pin
 * that the guard exists, refuses with a 4xx, is wired at every residential
 * late-fee endpoint, and that the client hides the whole surface for commercial.
 * If a future change removes the gate, this fails loudly rather than silently
 * re-shipping the fabrication.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const ledgerSrc = fs.readFileSync(path.join(ROOT, "server/routes-rent-ledger.ts"), "utf-8");
const rentRollSrc = fs.readFileSync(path.join(ROOT, "client/src/pages/rent-roll.tsx"), "utf-8");

/** The four residential late-fee endpoints that must refuse a commercial org. */
const LATE_FEE_ENDPOINTS = [
  '"/api/late-fee-rules"',
  '"/api/rent-charges/:id/late-fee-proposal"',
  '"/api/rent/late-fee-proposals"',
  '"/api/rent-charges/:id/apply-late-fee"',
];

describe("commercial late-fee gate — backend refusal (routes-rent-ledger.ts)", () => {
  it("defines a commercial refusal guard that checks businessType and answers a 4xx", () => {
    expect(ledgerSrc).toContain("function refuseResidentialLateFeeForCommercial");
    // It must key on the commercial businessType…
    expect(ledgerSrc).toMatch(/businessType\s*===\s*"commercial"/);
    // …and refuse with a 4xx (409, not a silent 200), via the shared sender.
    expect(ledgerSrc).toMatch(/sendError\(\s*res,\s*409,\s*"LATE_FEE_NOT_APPLICABLE_COMMERCIAL"/);
  });

  it("calls the guard at every residential late-fee endpoint (>= 4 wired sites)", () => {
    const callSites = ledgerSrc.match(/if \(refuseResidentialLateFeeForCommercial\(req, res\)\) return;/g) ?? [];
    expect(callSites.length).toBeGreaterThanOrEqual(4);
  });

  it("still registers each residential late-fee endpoint (the guard gates them, does not delete them)", () => {
    for (const ep of LATE_FEE_ENDPOINTS) {
      expect(ledgerSrc, `${ep} route must still exist`).toContain(ep);
    }
  });

  it("the /api/late-fee-rules route carries getOrCreateOrg so the org businessType is available to the guard", () => {
    expect(ledgerSrc).toMatch(
      /app\.get\(\s*"\/api\/late-fee-rules",\s*isAuthenticated,\s*getOrCreateOrg,/,
    );
  });
});

describe("commercial late-fee gate — frontend hiding (rent-roll.tsx)", () => {
  it("derives the commercial flag from the org's businessType", () => {
    expect(rentRollSrc).toMatch(/businessType\s*===\s*"commercial"/);
  });

  it("does not fetch the residential late-fee rules for a commercial org", () => {
    expect(rentRollSrc).toMatch(/enabled:\s*!isCommercial/);
  });

  it("gates the per-charge late-fee actions and the proposal dialog on !isCommercial", () => {
    // The two action buttons + the dialog render are each guarded.
    const gates = rentRollSrc.match(/!isCommercial/g) ?? [];
    expect(gates.length).toBeGreaterThanOrEqual(3);
    expect(rentRollSrc).toMatch(/!isCommercial && feeCharge/);
  });

  it("shows an honest commercial note in place of the residential statute table", () => {
    expect(rentRollSrc).toContain('data-testid="commercial-late-fee-note"');
    expect(rentRollSrc).toMatch(/set by the lease, not by state statute/i);
  });
});

/**
 * The residential late-fee surface is gated away from COMMERCIAL LEASES,
 * front AND back. This is the FABRICATION FIX: the `late_fee_rules` table
 * encodes RESIDENTIAL statutory caps + citations, which do not bind a
 * commercial lease (a commercial late fee is contractual, set by the lease,
 * not by statute). Showing those caps for a commercial lease — or letting
 * one hit the proposal/apply endpoints — presents wrong-domain data as the
 * binding rule.
 *
 * W-14: the gate used to key on the ORG's business type, which misrouted
 * every mixed book (a buy-and-hold org's one commercial lease was refused
 * its contractual proposal; a commercial org's one residential lease was
 * refused its statutory proposal). The gate now keys on the LEASE itself —
 * presence of any commercial-terms column — and these pins follow the gate:
 * they pin that the per-lease predicate exists, that both 409 fences key on
 * it, that every late-fee endpoint is wired to it, and that the old
 * org-keyed guards are gone. The behavioral mixed-book cases live in
 * rentLedgerLateFeeLeaseKind.test.ts (real handlers, mocked db).
 *
 * These are source-shape contracts (the same pattern as tailVerticalGates /
 * landlordFamilyGates): they run in the node env with no DOM and no DB. If a
 * future change removes the gate, this fails loudly rather than silently
 * re-shipping the fabrication.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const ledgerSrc = fs.readFileSync(path.join(ROOT, "server/routes-rent-ledger.ts"), "utf-8");
const rentRollSrc = fs.readFileSync(path.join(ROOT, "client/src/pages/rent-roll.tsx"), "utf-8");

/** The four residential late-fee endpoints that must refuse a commercial lease. */
const LATE_FEE_ENDPOINTS = [
  '"/api/late-fee-rules"',
  '"/api/rent-charges/:id/late-fee-proposal"',
  '"/api/rent/late-fee-proposals"',
  '"/api/rent-charges/:id/apply-late-fee"',
];

describe("late-fee gate — per-lease predicate (routes-rent-ledger.ts)", () => {
  it("defines the commercial-kind predicate over the lease's own commercial-terms fields", () => {
    expect(ledgerSrc).toContain("function leaseHasCommercialTerms");
    // The field list is the schema's commercial-terms family — leaseType and
    // the contractual late-fee terms among them (founder call 3's source).
    expect(ledgerSrc).toMatch(
      /COMMERCIAL_TERMS_FIELDS = \[[\s\S]*?"leaseType"[\s\S]*?"lateFeeType"[\s\S]*?\]/,
    );
  });

  it("the old org-keyed guards are gone — routing may not key on businessType again", () => {
    expect(ledgerSrc).not.toContain("refuseResidentialLateFeeForCommercial");
    expect(ledgerSrc).not.toContain("refuseCommercialLateFeeForNonCommercial");
  });
});

describe("late-fee gate — backend refusal (routes-rent-ledger.ts)", () => {
  it("defines a statutory-lane refusal that keys on the lease and answers a 4xx", () => {
    expect(ledgerSrc).toContain("function refuseStatutoryLateFeeForCommercialLease");
    // It must key on the lease's commercial terms…
    expect(ledgerSrc).toMatch(
      /function refuseStatutoryLateFeeForCommercialLease[\s\S]*?leaseHasCommercialTerms\(lease\)/,
    );
    // …and refuse with a 4xx (409, not a silent 200), via the shared sender.
    expect(ledgerSrc).toMatch(/sendError\(\s*res,\s*409,\s*"LATE_FEE_NOT_APPLICABLE_COMMERCIAL"/);
  });

  it("wires the per-lease statutory refusal at both charge-scoped statutory endpoints", () => {
    const callSites = ledgerSrc.match(/if \(refuseStatutoryLateFeeForCommercialLease\(res, lease\)\) return;/g) ?? [];
    expect(callSites.length).toBe(2);
  });

  it("routes the org-wide queue per lease and reports the commercial lane instead of dropping charges", () => {
    expect(ledgerSrc).toContain("commercialLaneCharges");
    expect(ledgerSrc).toMatch(/if \(leaseHasCommercialTerms\(lease\)\) \{\s*commercialLaneCharges\.push/);
  });

  it("keeps a book-aware fence on the rules list (no lease in scope there)", () => {
    expect(ledgerSrc).toContain("function refuseLateFeeRulesForCommercialOnlyBook");
    expect(ledgerSrc).toMatch(/if \(await refuseLateFeeRulesForCommercialOnlyBook\(req, res\)\) return;/);
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

// ---------------------------------------------------------------------------
// The SYMMETRIC other half. The gate above keeps wrong-domain STATUTORY data
// away from a commercial lease; this is the path a commercial lease actually
// uses — a late fee computed from the lease's OWN CONTRACTUAL terms — gated
// the other way (a lease with no commercial terms must use the statutory
// path, which enforces the legal cap). Both halves are pinned so neither
// can be removed silently.
// ---------------------------------------------------------------------------
describe("commercial contractual late-fee path — the symmetric other half (W-14)", () => {
  it("defines a symmetric guard that refuses a lease with NO commercial terms from the contractual endpoint", () => {
    expect(ledgerSrc).toContain("function refuseContractualLateFeeForResidentialLease");
    expect(ledgerSrc).toMatch(
      /function refuseContractualLateFeeForResidentialLease[\s\S]*?!leaseHasCommercialTerms\(lease\)/,
    );
    // A distinct 409 that points a residential lease back to the statutory path.
    expect(ledgerSrc).toMatch(/sendError\(\s*res,\s*409,\s*"LATE_FEE_USE_STATUTORY_RESIDENTIAL"/);
  });

  it("registers the contractual late-fee endpoint, gated by that guard", () => {
    expect(ledgerSrc).toContain('app.post("/api/rent-charges/:id/commercial-late-fee"');
    expect(ledgerSrc).toMatch(/if \(refuseContractualLateFeeForResidentialLease\(res, lease\)\) return;/);
  });

  it("computes from the lease's own terms via the pure tested engine, refuses rather than fabricate, and only PROPOSES", () => {
    expect(ledgerSrc).toContain("computeCommercialLateFee(");
    // The engine's refusal is surfaced — no invented fee is returned as real.
    expect(ledgerSrc).toMatch(/if \(result\.refusedReason\)/);
    // Proposal only — it returns a proposal, it does not post a charge.
    expect(ledgerSrc).toContain("proposal: result");
  });

  it("the two halves are symmetric: statutory refuses commercial leases, contractual refuses non-commercial leases", () => {
    expect(ledgerSrc).toContain('"LATE_FEE_NOT_APPLICABLE_COMMERCIAL"');
    expect(ledgerSrc).toContain('"LATE_FEE_USE_STATUTORY_RESIDENTIAL"');
  });
});

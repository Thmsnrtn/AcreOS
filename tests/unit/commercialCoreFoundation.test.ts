/**
 * commercial → core, Wave 4 Stage 1 (schema + operator-entry foundation).
 *
 * Pins the honest foundation the commercial vertical was missing, and guards the
 * two ways this stage could have gone wrong:
 *
 *   1. It could have shipped SCHEMA-ONLY — four tables with no reader and no
 *      writer — which is exactly the "built but unwired" defect CLAUDE.md names
 *      as this repo's most common, and which would have forced the down-only
 *      reachability ratchet UP. So every one of the four new tables must have a
 *      real reader AND a real writer, wired as operator data-entry CRUD in the
 *      already-mounted server/routes-rent-ledger.ts (NOT a new unmounted route,
 *      NOT the at-baseline storage god-class).
 *   2. It could have FABRICATED the numbers the later engines will compute — a
 *      cap rate, a CAM true-up, a percentage-rent overage — presented as real.
 *      Stage 1 stores operator-supplied facts only: the reconciliation writer
 *      stamps provenance `operator_entered` and leaves the engine-computed
 *      columns null; there is no computed money in these handlers.
 *
 * The commercial signal is the PRESENCE of a lease term, never an inferred
 * `commercial` boolean. Commercial stays BETA here — the beta→core flip is a
 * later stage, once the derivation engines land — so this test does NOT assert
 * core maturity; it asserts the foundation is honest.
 *
 * Source-shape assertions (node env, no DOM/DB) — same pattern as
 * agentInvestorCommissionWedge.test.ts / tailVerticalGates.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getBusinessType } from "../../shared/business-types";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

const ledger = read("server/routes-rent-ledger.ts");
// Code only: a deletion leaves a comment recording what went, and a predicate
// about what the code DOES must not read that record as the code.
const ledgerCode = stripComments(ledger);
const schema = read("shared/schema/rental.ts");

describe("commercial is CORE — every roadmap-for-core capability is now delivered", () => {
  it("the registry entry has been flipped to core (Wave 4 complete)", () => {
    // REWRITTEN at the flip (not deleted): Stage 1 pinned "still beta" so the flag
    // could not race ahead of the engines. Wave 4 built them all — CAM
    // reconciliation, percentage rent, escalation, per-sqft, contractual late fees,
    // commercial-correct NOI — each a pure, tested engine that refuses rather than
    // fabricate, so calling commercial "core" is now honest.
    expect(getBusinessType("commercial")?.maturity).toBe("core");
  });
});

describe("the four commercial tables exist in the schema", () => {
  for (const table of [
    'pgTable(\n  "cam_expense_pools"',
    'pgTable(\n  "cam_reconciliations"',
    'pgTable(\n  "commercial_sales_reports"',
    'pgTable(\n  "lease_rent_schedule"',
  ]) {
    it(`defines ${table.split('"')[1]}`, () => {
      expect(schema).toContain(table);
    });
  }
});

describe("every new table has a real reader AND a real writer (no orphan tables)", () => {
  // reachability's tables-no-reader/no-writer families stay flat only if each
  // table is both read and written somewhere under server/shared/scripts. These
  // land as operator CRUD in the mounted rent-ledger routes.
  const cases: Array<{ varName: string; reader: RegExp; writer: RegExp }> = [
    {
      varName: "camExpensePools",
      reader: /\.from\(camExpensePools\)/,
      writer: /\.insert\(camExpensePools\)/,
    },
    {
      varName: "camReconciliations",
      reader: /\.from\(camReconciliations\)/,
      writer: /\.insert\(camReconciliations\)/,
    },
    {
      varName: "commercialSalesReports",
      reader: /\.from\(commercialSalesReports\)/,
      writer: /\.insert\(commercialSalesReports\)/,
    },
    {
      varName: "leaseRentSchedule",
      reader: /\.from\(leaseRentSchedule\)/,
      writer: /\.insert\(leaseRentSchedule\)/,
    },
  ];
  for (const c of cases) {
    it(`${c.varName} has a reader`, () => expect(ledger).toMatch(c.reader));
    it(`${c.varName} has a writer`, () => expect(ledger).toMatch(c.writer));
  }
});

describe("the CRUD is operator data-entry behind existing mounted routes (no new nav/route surface)", () => {
  it("adds the commercial-term writer + the four tables' endpoints", () => {
    expect(ledgerCode).toContain('app.patch("/api/leases/:id/commercial-terms"');
    expect(ledgerCode).toContain('app.post("/api/properties/:propertyId/cam-pools"');
    expect(ledgerCode).toContain('app.get("/api/properties/:propertyId/cam-pools"');
    // REWRITTEN (W2-COMMERCIAL), not deleted: the reconciliation table's writer
    // is now the engine's generate route — the Stage-1 typed-in writer below is gone.
    expect(ledgerCode).toContain('app.post("/api/cam-pools/:poolId/reconciliations/generate"');
    expect(ledgerCode).toContain('app.get("/api/cam-pools/:poolId/reconciliations"');
    expect(ledgerCode).toContain('app.post("/api/leases/:id/sales-reports"');
    expect(ledgerCode).toContain('app.get("/api/leases/:id/sales-reports"');
    expect(ledgerCode).toContain('app.post("/api/leases/:id/rent-schedule"');
    expect(ledgerCode).toContain('app.get("/api/leases/:id/rent-schedule"');
  });

  it("the Stage-1 operator-entered reconciliation writer is deleted (W2-COMMERCIAL)", () => {
    // The full literal WITH its closing quote: the surviving
    // ".../reconciliations/generate" registration contains the deleted path as a
    // prefix, so a check without the quote would stay green with the writer back.
    expect(ledgerCode).not.toMatch(/app\.post\(\s*"\/api\/cam-pools\/:poolId\/reconciliations"/);
    // …and the provenance only that writer stamped is produced nowhere.
    expect(ledgerCode).not.toContain('generatedBy: "operator_entered"');
  });

  it("does NOT introduce a new route file (routes-rent-ledger.ts is already mounted)", () => {
    expect(fs.existsSync(path.join(ROOT, "server/routes-commercial-leases.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "server/routes-commercial.ts"))).toBe(false);
  });
});

describe("honesty — Stage 1 stores facts, it does not fabricate the engines' numbers", () => {
  it("the ONLY reconciliation writer is the engine, and it freezes the engine's own statement", () => {
    // REWRITTEN (W2-COMMERCIAL), not deleted. This pinned the Stage-1 writer's
    // honesty (operator_entered provenance, engine columns null) while it was the
    // only writer. The invariant it protected — no reconciliation row carries
    // money figures the engine did not compute — now holds structurally: there is
    // exactly one insert into cam_reconciliations, stamped "engine", carrying the
    // renderer's statement. (Behaviour: commercialLightUpRoutes.test.ts.)
    expect(ledgerCode.match(/\.insert\(camReconciliations\)/g) ?? []).toHaveLength(1);
    expect(ledgerCode).toContain('generatedBy: "engine"');
    expect(ledgerCode).toContain("renderCamStatementMarkdown(result,");
  });

  it("money math is DELEGATED to the pure tested engine, not hand-rolled in the route", () => {
    // Stage 2 adds the CAM reconciliation. The route must DELEGATE to
    // computeCamReconciliation (behaviourally tested in camReconciliation.test.ts)
    // and REFUSE — write nothing — when it cannot derive a share, rather than do
    // ad-hoc money arithmetic in the handler. This is where a fabricated CAM bill
    // would sneak in, so it is pinned.
    expect(ledger).toContain("computeCamReconciliation(");
    expect(ledger).toContain("computePercentageRent(");
    expect(ledger).toContain("computeCommercialLateFee(");
    expect(ledger).toContain("computePerSqftMetrics(");
    expect(ledger).toMatch(/if \(result\.refusedReason\)/);
    expect(ledger).toContain('generatedBy: "engine"');
    // No hand-rolled cap-rate / NOI arithmetic leaked into the route file.
    const commercialBlock = ledger.slice(ledger.indexOf("COMMERCIAL → CORE (Wave 4 Stage 1)"));
    expect(commercialBlock).not.toMatch(/capRate/);
    expect(commercialBlock).not.toMatch(/\bNOI\b/);
  });

  it("the recoverable-category set is asserted against the canonical Schedule-E vocabulary", () => {
    // Recoverability is the operator's explicit assertion from the real
    // category list, never an arbitrary free-text pool.
    expect(ledger).toContain("PROPERTY_EXPENSE_CATEGORIES");
  });
});

describe("every commercial handler is org-scoped (tenant isolation)", () => {
  it("each new handler derives the org and never trusts a client org id", () => {
    // Count the org-scoped derivations against the nine new endpoints — each
    // reads getOrganizationId(req) and scopes its queries by it.
    const occurrences = ledger.match(/getOrganizationId\(req\)/g) ?? [];
    // The file had org-scoped handlers before Stage 1; the nine new ones push
    // the count well past a floor that proves they are all scoped.
    expect(occurrences.length).toBeGreaterThanOrEqual(9);
    // No client-supplied organization id is ever read into a query.
    const commercialBlock = ledger.slice(ledger.indexOf("COMMERCIAL → CORE (Wave 4 Stage 1)"));
    expect(commercialBlock).not.toMatch(/req\.body\.organizationId/);
    expect(commercialBlock).not.toMatch(/req\.query\.organizationId/);
  });
});

describe("the commercial signal is presence-of-a-term, not an inferred boolean", () => {
  it("rental_leases carries nullable commercial-term columns, no `commercial` flag", () => {
    expect(schema).toMatch(/rentableSqft:\s*integer\("rentable_sqft"\)/);
    expect(schema).toMatch(/leaseType:\s*text\("lease_type"\)/);
    // A boolean `commercial` column inferred from absence would be the lie the
    // schema comment forswears — it must not exist.
    expect(schema).not.toMatch(/\bcommercial:\s*boolean\(/);
  });
});

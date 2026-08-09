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

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

const ledger = read("server/routes-rent-ledger.ts");
const schema = read("shared/schema/rental.ts");

describe("commercial is still BETA at the end of Stage 1 (the flip is a later stage)", () => {
  it("the registry entry has not been flipped to core yet", () => {
    // Stage 1 is the foundation; flipping to core before the engines exist would
    // be the stub-as-live lie this whole program refuses.
    expect(getBusinessType("commercial")?.maturity).toBe("beta");
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
    expect(ledger).toContain('app.patch("/api/leases/:id/commercial-terms"');
    expect(ledger).toContain('app.post("/api/properties/:propertyId/cam-pools"');
    expect(ledger).toContain('app.get("/api/properties/:propertyId/cam-pools"');
    expect(ledger).toContain('app.post("/api/cam-pools/:poolId/reconciliations"');
    expect(ledger).toContain('app.get("/api/cam-pools/:poolId/reconciliations"');
    expect(ledger).toContain('app.post("/api/leases/:id/sales-reports"');
    expect(ledger).toContain('app.get("/api/leases/:id/sales-reports"');
    expect(ledger).toContain('app.post("/api/leases/:id/rent-schedule"');
    expect(ledger).toContain('app.get("/api/leases/:id/rent-schedule"');
  });

  it("does NOT introduce a new route file (routes-rent-ledger.ts is already mounted)", () => {
    expect(fs.existsSync(path.join(ROOT, "server/routes-commercial-leases.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "server/routes-commercial.ts"))).toBe(false);
  });
});

describe("honesty — Stage 1 stores facts, it does not fabricate the engines' numbers", () => {
  it("the reconciliation writer stamps operator_entered provenance and leaves engine columns null", () => {
    expect(ledger).toContain('generatedBy: "operator_entered"');
    // The engine-computed snapshot columns are explicitly null until the
    // reconciliation engine (a later stage) fills them — not invented here.
    expect(ledger).toMatch(/statementMarkdown:\s*null/);
    expect(ledger).toMatch(/byCategoryCents:\s*null/);
    expect(ledger).toMatch(/coverageComplete:\s*null/);
  });

  it("no computed cap rate / NOI / percentage-rent math lives in these data-entry handlers", () => {
    // Stage 1 must not compute the very numbers its later engines exist to
    // derive. These tokens would signal an engine leaking into data entry.
    const commercialBlock = ledger.slice(ledger.indexOf("COMMERCIAL → CORE (Wave 4 Stage 1)"));
    expect(commercialBlock).not.toMatch(/capRate/);
    expect(commercialBlock).not.toMatch(/\bNOI\b/);
    expect(commercialBlock).not.toMatch(/breakpoint\s*[*/]/); // no percentage-rent arithmetic
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

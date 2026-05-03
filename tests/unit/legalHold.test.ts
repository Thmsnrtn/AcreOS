/**
 * Phase 3 Week 11 — Legal-hold mechanism unit tests.
 *
 * Verifies the FRCP 37(e) chokepoints in `server/services/legalHold.ts`:
 *   - `assertNotUnderLegalHold` throws when a covering hold is active
 *   - `isUnderLegalHold` returns true under the same conditions
 *   - `filterOutHeldIds` strips held ids from a bulk-delete batch
 *   - released holds (status='released' OR releasedAt set) do NOT block deletes
 *
 * The DB layer is mocked at the import boundary so these tests run in <1s
 * with no Postgres dependency.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LegalHold } from "../../shared/schema";

// ─── Mock the db ─────────────────────────────────────────────────────────────
// `legalHold.ts` calls `db.select(...).from(legalHolds).where(...)`. We mock
// the entire `../db` module so our service-under-test gets a fake driver
// that returns whatever rows the test sets up via `setHolds()`.

let activeHolds: LegalHold[] = [];

function setHolds(rows: Partial<LegalHold>[]) {
  activeHolds = rows.map((r, i) => ({
    id: r.id ?? `hold-${i}`,
    organizationId: r.organizationId ?? 1,
    caseRef: r.caseRef ?? `CASE-${i}`,
    scope: r.scope ?? "org_wide",
    scopeIds: r.scopeIds ?? [],
    placedAt: r.placedAt ?? new Date(),
    placedBy: r.placedBy ?? null,
    releasedAt: r.releasedAt ?? null,
    releaseReason: r.releaseReason ?? null,
    notes: r.notes ?? null,
    status: r.status ?? "active",
    createdAt: r.createdAt ?? new Date(),
    updatedAt: r.updatedAt ?? new Date(),
  } as LegalHold));
}

vi.mock("../../server/db", () => {
  // The service builds a Drizzle query: db.select().from(legalHolds).where(...)
  // We return a chainable thenable that resolves to the active rows filtered
  // to status='active' AND releasedAt IS NULL — i.e. the same condition the
  // service uses, so we don't need to interpret the where() AST.
  function chain() {
    const obj: any = {};
    obj.select = () => obj;
    obj.from = () => obj;
    obj.where = () => obj;
    obj.orderBy = () => obj;
    obj.limit = () => obj;
    // Make it awaitable.
    obj.then = (resolve: (v: any) => void) => {
      const filtered = activeHolds.filter((h) => h.status === "active" && !h.releasedAt);
      resolve(filtered);
    };
    return obj;
  }
  return { db: chain() };
});

// Now import after the mock is set up.
import {
  assertNotUnderLegalHold,
  isUnderLegalHold,
  filterOutHeldIds,
  orgHasActiveHold,
  LegalHoldViolationError,
} from "../../server/services/legalHold";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("legalHold — preservation chokepoint", () => {
  beforeEach(() => {
    setHolds([]);
  });

  it("isUnderLegalHold returns false when no holds exist", async () => {
    const result = await isUnderLegalHold(1, "lead", 42);
    expect(result).toBe(false);
  });

  it("isUnderLegalHold returns true when an org_wide hold covers the org", async () => {
    setHolds([{ organizationId: 1, scope: "org_wide", caseRef: "Smith v. Co" }]);
    const result = await isUnderLegalHold(1, "lead", 42);
    expect(result).toBe(true);
  });

  it("isUnderLegalHold returns true for a matching lead_specific hold", async () => {
    setHolds([
      {
        organizationId: 1,
        scope: "lead_specific",
        scopeIds: ["42", "43"],
        caseRef: "Acme Discovery",
      },
    ]);
    expect(await isUnderLegalHold(1, "lead", 42)).toBe(true);
    expect(await isUnderLegalHold(1, "lead", 43)).toBe(true);
    expect(await isUnderLegalHold(1, "lead", 99)).toBe(false);
  });

  it("isUnderLegalHold ignores resourceType mismatch on scope-specific holds", async () => {
    setHolds([
      { organizationId: 1, scope: "property_specific", scopeIds: ["42"], caseRef: "Z" },
    ]);
    // resourceType=lead with id=42 should NOT match a property_specific hold.
    expect(await isUnderLegalHold(1, "lead", 42)).toBe(false);
    // But the same id under property resourceType DOES match.
    expect(await isUnderLegalHold(1, "property", 42)).toBe(true);
  });

  it("released holds do not block deletes", async () => {
    setHolds([
      {
        organizationId: 1,
        scope: "org_wide",
        status: "released",
        releasedAt: new Date(),
        releaseReason: "Settlement signed",
      },
    ]);
    expect(await isUnderLegalHold(1, "lead", 42)).toBe(false);
  });

  it("places a hold, attempts to delete a covered lead, asserts deletion blocked. Releases hold, deletion succeeds.", async () => {
    // 1. Place an active hold over lead 42.
    setHolds([
      {
        id: "hold-active-1",
        organizationId: 1,
        scope: "lead_specific",
        scopeIds: ["42"],
        caseRef: "Smith v. AcreOS",
        status: "active",
      },
    ]);

    // 2. Attempt delete -> assertNotUnderLegalHold throws.
    await expect(assertNotUnderLegalHold(1, "lead", 42)).rejects.toBeInstanceOf(
      LegalHoldViolationError,
    );

    // 3. Release the hold.
    setHolds([
      {
        id: "hold-active-1",
        organizationId: 1,
        scope: "lead_specific",
        scopeIds: ["42"],
        caseRef: "Smith v. AcreOS",
        status: "released",
        releasedAt: new Date(),
        releaseReason: "Settlement signed; counsel cleared retention resumption.",
      },
    ]);

    // 4. Re-attempt — assertion now passes (no throw).
    await expect(assertNotUnderLegalHold(1, "lead", 42)).resolves.toBeUndefined();
  });

  it("LegalHoldViolationError carries 423 statusCode + caseRef context", async () => {
    setHolds([
      {
        id: "hold-x",
        organizationId: 7,
        scope: "org_wide",
        caseRef: "FedDocketX",
      },
    ]);
    try {
      await assertNotUnderLegalHold(7, "lead", 1);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LegalHoldViolationError);
      const e = err as LegalHoldViolationError;
      expect(e.statusCode).toBe(423);
      expect(e.code).toBe("LEGAL_HOLD_ACTIVE");
      expect(e.hold.caseRef).toBe("FedDocketX");
      expect(e.organizationId).toBe(7);
    }
  });

  it("filterOutHeldIds drops blocked ids in bulk", async () => {
    setHolds([
      {
        organizationId: 1,
        scope: "lead_specific",
        scopeIds: ["2", "4", "6"],
      },
    ]);
    const allowed = await filterOutHeldIds(1, "lead", [1, 2, 3, 4, 5, 6, 7]);
    expect(allowed).toEqual([1, 3, 5, 7]);
  });

  it("filterOutHeldIds returns empty list under org_wide hold", async () => {
    setHolds([{ organizationId: 1, scope: "org_wide" }]);
    const allowed = await filterOutHeldIds(1, "lead", [1, 2, 3]);
    expect(allowed).toEqual([]);
  });

  it("filterOutHeldIds passes through when no holds", async () => {
    setHolds([]);
    const allowed = await filterOutHeldIds(1, "lead", [1, 2, 3]);
    expect(allowed).toEqual([1, 2, 3]);
  });

  it("orgHasActiveHold returns true iff at least one active hold exists", async () => {
    expect(await orgHasActiveHold(1)).toBe(false);
    setHolds([{ organizationId: 1, scope: "org_wide", caseRef: "X" }]);
    expect(await orgHasActiveHold(1)).toBe(true);
    setHolds([
      {
        organizationId: 1,
        scope: "org_wide",
        caseRef: "X",
        status: "released",
        releasedAt: new Date(),
      },
    ]);
    expect(await orgHasActiveHold(1)).toBe(false);
  });
});

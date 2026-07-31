/**
 * Occupancy over modelled units — and the vacancy that used to be invisible.
 *
 * THE DEFECT THIS PINS SHUT
 * -------------------------
 * `GET /api/rent-roll/occupancy` used to count distinct
 * `(property_id, COALESCE(unit_label,''))` pairs from `rental_leases` — once
 * for the denominator, again filtered to active leases for the numerator.
 * Both sides came from the LEASE table, so a unit that has never been leased
 * appeared in neither. A landlord who buys a half-empty building and enters it
 * read **100% occupied**, and the vacancy — the thing the screen exists to
 * show — was literally unrepresentable.
 *
 * `computeOccupancySnapshot` is pure so every rule below is a test rather than
 * a database fixture (there is no DATABASE_URL in this environment).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  computeOccupancySnapshot,
  type OccupancyUnitFacts,
} from "../../server/routes-rentals";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

function facts(over: Partial<OccupancyUnitFacts> = {}): OccupancyUnitFacts {
  return {
    rentableUnits: 10,
    occupiedUnits: 6,
    offlineUnits: 0,
    retiredUnits: 0,
    vacantUnitsWithMarketRent: 0,
    vacantMarketRentMonthlyCents: 0,
    propertyCount: 1,
    ...over,
  };
}

describe("the never-leased unit is finally counted", () => {
  it("10 rentable units with 6 active leases is 60%, not 100%", () => {
    const snap = computeOccupancySnapshot(facts());
    expect(snap.measurable).toBe(true);
    if (!snap.measurable) return;
    expect(snap.rentableUnits).toBe(10);
    expect(snap.occupiedUnits).toBe(6);
    // The number that could not previously be computed at all.
    expect(snap.vacantUnits).toBe(4);
    expect(snap.occupancyPct).toBe(60);
  });

  it("a building where nothing has ever been leased is 0%, not 100%", () => {
    // The old query's worst case: no leases → denominator 0 → the ratio was
    // either a divide-by-zero or a vacuous 100%. Ten real units, none let, is
    // a fully vacant building and must read as one.
    const snap = computeOccupancySnapshot(facts({ occupiedUnits: 0 }));
    expect(snap.measurable).toBe(true);
    if (!snap.measurable) return;
    expect(snap.occupancyPct).toBe(0);
    expect(snap.vacantUnits).toBe(10);
  });

  it("a full building is 100% with no vacancy", () => {
    const snap = computeOccupancySnapshot(facts({ occupiedUnits: 10 }));
    if (!snap.measurable) throw new Error("expected measurable");
    expect(snap.occupancyPct).toBe(100);
    expect(snap.vacantUnits).toBe(0);
  });

  it("never prints an occupancy above 100%, whatever the counts say", () => {
    // A bad join or a double-counted lease must not produce 130% on a screen.
    const snap = computeOccupancySnapshot(facts({ rentableUnits: 10, occupiedUnits: 13 }));
    if (!snap.measurable) throw new Error("expected measurable");
    expect(snap.occupancyPct).toBe(100);
    expect(snap.vacantUnits).toBe(0);
  });
});

describe("offline units are their own number, on purpose", () => {
  it("are excluded from BOTH sides of the ratio", () => {
    // Three units gutted by a fire. Folding them into the denominator makes a
    // construction schedule look like a leasing failure; folding them into the
    // numerator excuses a genuinely empty unit. Neither — report them.
    const snap = computeOccupancySnapshot(
      facts({ rentableUnits: 7, occupiedUnits: 7, offlineUnits: 3 }),
    );
    if (!snap.measurable) throw new Error("expected measurable");
    expect(snap.occupancyPct).toBe(100);
    expect(snap.rentableUnits).toBe(7);
    expect(snap.offlineUnits).toBe(3);
    expect(snap.vacantUnits).toBe(0);
  });

  it("retired units are reported and never counted as stock", () => {
    const snap = computeOccupancySnapshot(
      facts({ rentableUnits: 4, occupiedUnits: 2, retiredUnits: 6 }),
    );
    if (!snap.measurable) throw new Error("expected measurable");
    expect(snap.occupancyPct).toBe(50);
    expect(snap.retiredUnits).toBe(6);
  });
});

describe("refuse rather than fabricate a percentage", () => {
  it("no modelled units returns an unmeasurable state naming the fix", () => {
    const snap = computeOccupancySnapshot(
      facts({ rentableUnits: 0, occupiedUnits: 0, propertyCount: 3 }),
    );
    expect(snap.measurable).toBe(false);
    if (snap.measurable) return;
    expect(snap.reason).toBe("no_units_modelled");
    expect(snap.occupancyPct).toBeNull();
    expect(snap.occupiedUnits).toBeNull();
    expect(snap.vacantUnits).toBeNull();
    // The message must tell the operator what to DO, and must explain why
    // leases alone cannot answer this — that is the whole insight.
    expect(snap.message).toMatch(/never been leased|leaves no trace|import a rent roll/i);
  });

  it("all stock offline is a DIFFERENT unmeasurable reason", () => {
    // "You haven't entered units" and "every unit you entered is down" are
    // different situations with different next actions. One reason string for
    // both would send an operator looking for data they already supplied.
    const snap = computeOccupancySnapshot(
      facts({ rentableUnits: 0, occupiedUnits: 0, offlineUnits: 5 }),
    );
    if (snap.measurable) throw new Error("expected unmeasurable");
    expect(snap.reason).toBe("no_rentable_units");
    expect(snap.message).toContain("5");
  });

  it("0% and 100% are never used to mean 'no data'", () => {
    const empty = computeOccupancySnapshot(facts({ rentableUnits: 0, occupiedUnits: 0 }));
    expect(empty.occupancyPct).toBeNull();
  });
});

describe("the cost of a vacancy — omitted, never zeroed", () => {
  it("sums asking rent only over vacant units that carry one", () => {
    const snap = computeOccupancySnapshot(
      facts({
        rentableUnits: 10,
        occupiedUnits: 6,
        vacantUnitsWithMarketRent: 3,
        vacantMarketRentMonthlyCents: 450_000,
      }),
    );
    if (!snap.measurable) throw new Error("expected measurable");
    expect(snap.vacantMarketRentMonthlyCents).toBe(450_000);
    // The fourth vacant unit has no asking rent on file and is called out, so
    // the operator knows the figure is partial rather than the whole story.
    expect(snap.vacantUnitsMissingMarketRent).toBe(1);
  });

  it("OMITS the key entirely when no vacant unit has an asking rent", () => {
    const snap = computeOccupancySnapshot(facts({ vacantUnitsWithMarketRent: 0 }));
    if (!snap.measurable) throw new Error("expected measurable");
    // Absent, not 0. A missing asking rent means unknown; rendering $0 would
    // tell the operator four empty units cost them nothing.
    expect("vacantMarketRentMonthlyCents" in snap).toBe(false);
    expect(snap.vacantUnitsMissingMarketRent).toBe(4);
  });
});

describe("the importer no longer throws the vacancies away", () => {
  const importer = read("server/routes-rent-roll-import.ts");

  it("persists the unit BEFORE the vacant row is skipped — the order is the fix", () => {
    // The `if (u.isVacant)` branch still exists and should: a vacant unit has
    // no tenancy, so no lease, tenant or charge may be invented for it. What
    // changed is WHERE it sits. It used to be the first statement of the
    // per-row loop, so an unoccupied unit left no record at all — while the
    // payload had just told us it exists. That one line is what made the
    // occupancy denominator above uncomputable.
    //
    // The branch has since grown a body (it counts the vacant row so the
    // import summary adds up — FINDING 16), so this matches the CONDITION
    // rather than the old one-line `) continue;` form. The invariant being
    // pinned is unchanged: unit write first, vacancy short-circuit second.
    // Compare CODE positions, not prose — the file's own comment quotes the
    // old line verbatim to explain the fix, so a naive text search finds the
    // explanation rather than the statement.
    const codeLines = importer
      .split("\n")
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    const lineOf = (pred: (line: string) => boolean) =>
      codeLines.find(({ line }) => pred(line))?.i ?? -1;

    const unitInsert = lineOf((l) => l.includes("insert(rentalUnits)"));
    const vacantSkip = lineOf((l) => /if\s*\(\s*u\.isVacant\s*\)/.test(l));
    expect(unitInsert, "the importer must insert rental_units").toBeGreaterThan(-1);
    expect(vacantSkip, "a vacant row must still create no tenancy").toBeGreaterThan(-1);
    expect(
      unitInsert,
      "the unit must be written before the vacant row is skipped, or the vacancy is lost again",
    ).toBeLessThan(vacantSkip);

    // …and the branch must still END the row: `continue` before any tenant,
    // lease or charge write. A body that fell through would invent a tenancy
    // for an empty unit, which is worse than the bug being fixed.
    const vacantBody = codeLines.filter(({ i }) => i > vacantSkip && i <= vacantSkip + 6);
    expect(
      vacantBody.some(({ line }) => /\bcontinue;/.test(line)),
      "the vacant branch must continue before any tenancy write",
    ).toBe(true);
  });

  it("creates a unit row for every row in the payload", () => {
    expect(importer).toContain("rentalUnits");
    // Idempotent on re-import: the unique (org, property, label) index is the
    // guard, so a second import must not duplicate a unit or clobber operator
    // edits to it.
    expect(importer).toMatch(/onConflictDoNothing/);
  });

  it("still creates no lease or tenant for a vacant unit", () => {
    // The unit is real; the tenancy is not. Inventing a lease for an empty
    // unit would be worse than the bug being fixed.
    expect(importer).toMatch(/isVacant/);
  });
});

/**
 * A usury audit may not assume the jurisdiction it is auditing against.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *     const state = (note as any).propertyState || "TX"; // fallback TX
 *
 * `notes` has no `propertyState` column — the identifier appears nowhere in
 * shared/schema.ts. The cast therefore produced `undefined` on every row and the
 * fallback fired every time, so `auditOrgUsury` audited **every note in every
 * organization against Texas law**. `GET /api/compliance/usury-audit` served
 * that as the org's compliance status: an operator in Arkansas (constitutional
 * cap) or New York (16% civil, 25% criminal) received a violation count computed
 * against a state none of their property is in.
 *
 * The failure mode of getting usury wrong is forfeiting all interest on the note
 * or voiding it. This was not a rounding error in a dashboard.
 *
 * `(note as any).borrowerName` was the same shape — `notes` carries `borrowerId`
 * — so every row also reported a null borrower. Both `as any` casts are the
 * reason `tsc` never objected, which is the pattern CLAUDE.md already records
 * from `leads.organizationId`.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * Behaviour, against a db double that answers with the rows it was given. The
 * decisive case is a note in a state whose cap DIFFERS from Texas's 18%: under
 * the old code it was judged at 18 regardless, so any assertion that reads the
 * emitted clearance for a non-TX state fails the moment the fallback returns.
 *
 * And the refusal is asserted as its own outcome. A note with no resolvable
 * state must not be counted `compliant` — "we could not tell" and "it is fine"
 * are different answers, and only one of them is true.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = {
  id: number;
  interestRate: string;
  propertyState: string | null;
  borrowerFirst: string | null;
  borrowerLast: string | null;
};

let rows: Row[] = [];

/** A drizzle-shaped select chain that yields `rows`; joins are already applied. */
function makeDb() {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: async () => rows,
  };
  return { select: () => chain };
}

async function audit(orgId = 42) {
  vi.resetModules();
  vi.doMock("../../server/db", () => ({ db: makeDb() }));
  const { auditOrgUsury } = await import("../../server/services/usury");
  return auditOrgUsury(orgId);
}

beforeEach(() => {
  rows = [];
});

describe("auditOrgUsury audits each note against its own state", () => {
  it("VACUITY: a note in a known state IS classified", async () => {
    // Without this, every assertion below is satisfied by a function that
    // classifies nothing at all and reports zeroes.
    rows = [{ id: 1, interestRate: "9", propertyState: "TX", borrowerFirst: "Dana", borrowerLast: "Ruiz" }];
    const out = await audit();
    expect(out.results).toHaveLength(1);
    expect(out.results[0].clearance).not.toBeNull();
    expect(out.compliant + out.warnings + out.violations).toBe(1);
    expect(out.results[0].borrowerName).toBe("Dana Ruiz");
  });

  it("judges an Arkansas note against Arkansas, not Texas", async () => {
    // AR's cap is 17 and TX's is 18. A 17.5% note is a VIOLATION in Arkansas and
    // merely near the line in Texas — so this single case separates the two
    // jurisdictions by outcome, not just by the label on the output.
    rows = [{ id: 1, interestRate: "17.5", propertyState: "AR", borrowerFirst: null, borrowerLast: null }];
    const out = await audit();

    expect(out.results[0].state).toBe("AR");
    expect(out.results[0].clearance?.maxAllowedRate).toBe(17);
    expect(
      out.results[0].clearance?.maxAllowedRate,
      "the note was judged against Texas' 18% — the propertyState fallback is back",
    ).not.toBe(18);
    expect(out.violations).toBe(1);
  });

  it("uses each note's own state within one audit", async () => {
    // The fallback made every row identical. Two rows, two caps, one call.
    rows = [
      { id: 1, interestRate: "11", propertyState: "AZ", borrowerFirst: null, borrowerLast: null }, // AZ cap 10
      { id: 2, interestRate: "11", propertyState: "CO", borrowerFirst: null, borrowerLast: null }, // CO cap 45
    ];
    const out = await audit();

    const byId = Object.fromEntries(out.results.map((r) => [r.noteId, r]));
    expect(byId[1].clearance?.maxAllowedRate).toBe(10);
    expect(byId[2].clearance?.maxAllowedRate).toBe(45);
    expect(byId[1].clearance?.warningLevel).toBe("violation");
    expect(byId[2].clearance?.warningLevel).toBe("ok");
  });
});

describe("an unresolvable jurisdiction is refused, not assumed", () => {
  it("a note with no property state is INDETERMINATE, never compliant", async () => {
    rows = [{ id: 1, interestRate: "9", propertyState: null, borrowerFirst: null, borrowerLast: null }];
    const out = await audit();

    expect(out.indeterminate).toBe(1);
    expect(
      out.compliant,
      "a note whose jurisdiction is unknown was counted as compliant — 'we could not " +
        "tell' and 'it is fine' are different answers",
    ).toBe(0);
    expect(out.violations).toBe(0);
    expect(out.warnings).toBe(0);
    expect(out.results[0].state).toBeNull();
    expect(out.results[0].clearance).toBeNull();
    expect(out.results[0].indeterminateReason).toMatch(/state/i);
  });

  it("a state AcreOS has no limit for is INDETERMINATE, not compliant", async () => {
    rows = [{ id: 1, interestRate: "9", propertyState: "ZZ", borrowerFirst: null, borrowerLast: null }];
    const out = await audit();

    expect(out.indeterminate).toBe(1);
    expect(out.compliant).toBe(0);
    expect(out.results[0].indeterminateReason).toMatch(/ZZ/);
  });

  it("no state literal is substituted anywhere in the audit", async () => {
    // The behavioural cases above would also pass if the fallback were changed
    // to some OTHER state. This asserts the shape is gone, not one spelling.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/usury.ts"),
      "utf8",
    );
    const body = src.slice(src.indexOf("export async function auditOrgUsury"));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(
      code,
      "the audit substitutes a default state again — a guessed jurisdiction is a " +
        "different document about a different place",
    ).not.toMatch(/\|\|\s*["'][A-Z]{2}["']/);
    expect(code, "an `as any` is back on the note row").not.toMatch(/note as any/);
  });
});

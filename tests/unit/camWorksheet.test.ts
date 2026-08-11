/**
 * CAM reconciliation WORKSHEET — input sufficiency + the freeze guarantee.
 *
 * `camReconciliation.test.ts` pins how the true-up is COMPUTED. This pins the
 * two properties that decide whether it may be computed at all and whether it
 * may ever be rewritten:
 *
 *   1. REFUSE, DO NOT FABRICATE — an incomplete input set produces NO number,
 *      and the refusal names WHICH inputs are missing. The sharpest case is the
 *      one the engine alone could not catch: a pool with no recorded recoverable
 *      spend computes a $0 actual, a $0 share and therefore a delta of MINUS
 *      everything the tenant was billed — a credit statement asserting the
 *      building cost nothing to run.
 *
 *   2. FREEZE — a generated statement is an exhibit. Editing the pool afterwards
 *      must not change it, by ANY path: not on read, not on re-generate, not via
 *      an operator-entered row on the same (pool, lease) key. Proven here by
 *      byte-comparing the canonical serialization across a pool edit that
 *      materially changes what a fresh statement would say.
 *
 * The last describe block is DERIVED from the route source rather than
 * hardcoded: it finds every `.insert(camReconciliations)` write path in
 * server/routes-rent-ledger.ts and requires each to consult the freeze policy,
 * so a future handler that reintroduces a blind upsert turns this suite red
 * without anyone remembering to add a case for it.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  assessCamInputs,
  previewCamReconciliation,
  decideCamStatementWrite,
  isFrozenCamStatement,
  canonicalCamStatement,
  camStatementFingerprint,
  diffCamStatement,
  CAM_STATEMENT_VERSION,
  CAM_STATEMENT_CANONICAL_FIELDS,
  type CamFrozenStatement,
} from "../../shared/rental/camWorksheet";
import {
  computeCamReconciliation,
  renderCamStatementMarkdown,
  type CamPoolInput,
  type CamLeaseInput,
} from "../../shared/rental/camReconciliation";
import type { MeasurableExpenseRow } from "../../shared/rental/noi";

const ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Fixture: a real strip-centre CAM year, chosen so every step of the standard
// order (gross-up → share → admin fee → delta) lands on a distinct exact cent.
// ---------------------------------------------------------------------------
const FIXTURE_POOL: CamPoolInput = {
  recoverableCategories: ["repairs", "utilities", "insurance", "cleaning_maintenance"],
  totalRentableSqft: 24_000,
  adminFeeBps: 1_500, // 15%
  grossUpPct: 5, // partially-occupied building grossed to full occupancy
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
};

const FIXTURE_LEASE: CamLeaseInput = {
  camProRataBps: null, // forces the sqft derivation — the pro-rata math under test
  rentableSqft: 3_600,
  camBaseYearStopCents: null,
  leaseType: "nnn",
};

/** 12 months of recoverable operating spend — full coverage, no gaps. */
const FIXTURE_ROWS: MeasurableExpenseRow[] = [
  ...Array.from({ length: 12 }, (_, i): MeasurableExpenseRow => ({
    category: "utilities",
    amountCents: 84_000,
    isOperating: true,
    incurredOn: `2026-${String(i + 1).padStart(2, "0")}-08`,
  })),
  { category: "repairs", amountCents: 412_500, isOperating: true, incurredOn: "2026-04-19" },
  { category: "cleaning_maintenance", amountCents: 288_000, isOperating: true, incurredOn: "2026-07-02" },
  { category: "insurance", amountCents: 640_000, isOperating: true, incurredOn: "2026-01-15" },
  // Present, recorded, and NOT recoverable — must not enter the pool actual.
  { category: "mortgage_interest", amountCents: 1_900_000, isOperating: false, incurredOn: "2026-05-01" },
  { category: "management_fees", amountCents: 300_000, isOperating: true, incurredOn: "2026-05-01" },
];

const FIXTURE_ESTIMATED_BILLED_CENTS = 41_000_0; // $4,100.00 billed in monthly estimates

describe("exit test 1 — a fixture pool + lease reconciles to the exact cent", () => {
  const r = computeCamReconciliation({
    pool: FIXTURE_POOL,
    lease: FIXTURE_LEASE,
    rows: FIXTURE_ROWS,
    estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
  });

  it("sums only the recoverable OPERATING spend", () => {
    // 12 × 84,000 utilities = 1,008,000
    //    +   412,500 repairs
    //    +   288,000 cleaning_maintenance
    //    +   640,000 insurance
    //    = 2,348,500     ($23,485.00)
    // mortgage_interest (non-operating) and management_fees (not in the
    // recoverable set) are both excluded.
    expect(r.poolActualCents).toBe(2_348_500);
    expect(r.byCategoryCents).toEqual({
      utilities: 1_008_000,
      repairs: 412_500,
      cleaning_maintenance: 288_000,
      insurance: 640_000,
    });
  });

  it("derives the pro-rata share from leased ÷ building sqft, to the basis point", () => {
    // 3,600 / 24,000 = 0.15 → 1,500 bps
    expect(r.proRataBasis).toBe("sqft");
    expect(r.proRataBps).toBe(1_500);
    expect(r.leasedSqftUsed).toBe(3_600);
    expect(r.totalRentableSqftUsed).toBe(24_000);
  });

  it("applies gross-up → share → admin fee in that exact order, to the cent", () => {
    // gross-up 5%:   2,348,500 × 1.05          = 2,465,925
    expect(r.grossedUpPoolCents).toBe(2_465_925);
    // share 15%:     2,465,925 × 0.15          =   369,888.75
    // admin fee 15%: 369,888.75 × 1.15         =   425,372.0625 → rounds to 425,372
    expect(r.recoverableShareCents).toBe(425_372);
    // delta:         425,372 − 410,000         =    15,372  (tenant owes $153.72)
    expect(r.deltaCents).toBe(15_372);
  });

  it("reports full coverage for a 12-of-12-month year", () => {
    expect(r.periodMonths).toBe(12);
    expect(r.coverageMonths).toBe(12);
    expect(r.coverageComplete).toBe(true);
  });

  it("MUTATION GUARD — the share is not the ungrossed pool, the un-fee'd share, or the raw ratio", () => {
    // Each of these is what the number would be if one step of the pro-rata /
    // ordering math were broken. Pinning them as NOT-equal makes a silent
    // reordering (fee before gross-up, share on the ungrossed pool, a dropped
    // clamp) fail here rather than ship.
    expect(r.recoverableShareCents).not.toBe(Math.round(2_348_500 * 0.15 * 1.15)); // no gross-up
    expect(r.recoverableShareCents).not.toBe(Math.round(2_465_925 * 0.15)); // no admin fee
    expect(r.recoverableShareCents).not.toBe(Math.round(2_465_925 * 0.15 * 1.15 * 1.05)); // double gross-up
  });
});

describe("exit test 2 — an incomplete input set REFUSES and names the missing inputs", () => {
  it("no recorded recoverable spend blocks (an absence is not a measured zero)", () => {
    const preview = previewCamReconciliation({
      pool: FIXTURE_POOL,
      lease: FIXTURE_LEASE,
      rows: [], // nothing recorded for the period
      estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
    });
    expect(preview.blocked).toBe(true);
    expect(preview.result).toBeNull();
    expect(preview.blocking.map((m) => m.field)).toContain("pool.actuals");
    expect(preview.recoverableRowCount).toBe(0);
  });

  it("spend that exists but is OUTSIDE the recoverable set still blocks", () => {
    // STRENGTHENED (fleet-13 audit). The case above passes `rows: []`, which
    // cannot distinguish "no rows at all" from "no rows in the recoverable
    // set" — so deleting the `if (!recoverable.has(r.category)) continue;`
    // line from the numerator survived a fully green suite. That mutation
    // reopens the exact hole this module exists to close: a pool declaring
    // ["landscaping"] against a property with only utilities and repairs rows
    // would pass the gate, compute a $0 pool actual, and produce a delta of
    // MINUS everything billed — a fabricated credit to the tenant.
    const preview = previewCamReconciliation({
      pool: { ...FIXTURE_POOL, recoverableCategories: ["landscaping"] },
      lease: FIXTURE_LEASE,
      rows: [
        { category: "utilities", isOperating: true, amountCents: 250_000, incurredOn: "2026-03-04" },
        { category: "repairs", isOperating: true, amountCents: 180_000, incurredOn: "2026-07-19" },
      ],
      estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
    });
    // Rows EXIST — the distinguishing fact — and none of them are recoverable.
    expect(preview.blocked).toBe(true);
    expect(preview.result).toBeNull();
    expect(preview.recoverableRowCount).toBe(0);
    expect(preview.blocking.map((m) => m.field)).toContain("pool.actuals");
  });

  it("...and the un-gated engine WOULD have produced a fabricated credit — which is why the gate exists", () => {
    // This is the exact hole the worksheet gate closes. Left to itself the
    // engine computes a $0 pool, a $0 share, and therefore hands the tenant a
    // credit for every cent they were billed. Pinned so nobody "simplifies" the
    // gate away on the grounds that the engine already refuses.
    const ungated = computeCamReconciliation({
      pool: FIXTURE_POOL,
      lease: FIXTURE_LEASE,
      rows: [],
      estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
    });
    expect(ungated.refusedReason).toBeNull();
    expect(ungated.recoverableShareCents).toBe(0);
    expect(ungated.deltaCents).toBe(-FIXTURE_ESTIMATED_BILLED_CENTS);
  });

  it("an empty recoverable-category set blocks (an undefined pool, not a $0 one)", () => {
    const preview = previewCamReconciliation({
      pool: { ...FIXTURE_POOL, recoverableCategories: [] },
      lease: FIXTURE_LEASE,
      rows: FIXTURE_ROWS,
      estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
    });
    expect(preview.blocked).toBe(true);
    expect(preview.result).toBeNull();
    expect(preview.blocking.map((m) => m.field)).toContain("pool.recoverableCategories");
  });

  it("a missing denominator names BOTH ways to supply the share, marked any_of", () => {
    const preview = previewCamReconciliation({
      pool: { ...FIXTURE_POOL, totalRentableSqft: null },
      lease: { ...FIXTURE_LEASE, camProRataBps: null, rentableSqft: null },
      rows: FIXTURE_ROWS,
      estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
    });
    expect(preview.blocked).toBe(true);
    expect(preview.result).toBeNull();
    const fields = preview.blocking.filter((m) => m.group === "pro_rata").map((m) => m.field);
    expect(fields).toEqual(
      expect.arrayContaining(["lease.camProRataBps", "lease.rentableSqft", "pool.totalRentableSqft"]),
    );
    for (const m of preview.blocking.filter((m) => m.group === "pro_rata")) {
      expect(m.satisfiedBy).toBe("any_of");
      // "show WHICH inputs are missing, not just decline" — each carries an
      // operator-facing label and a concrete fix, never a bare field name.
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.fix.length).toBeGreaterThan(0);
    }
  });

  it("supplying EITHER alternative satisfies the pro-rata group", () => {
    const bySqft = assessCamInputs({ pool: FIXTURE_POOL, lease: FIXTURE_LEASE, rows: FIXTURE_ROWS });
    expect(bySqft.canCompute).toBe(true);
    const byFixedShare = assessCamInputs({
      pool: { ...FIXTURE_POOL, totalRentableSqft: null },
      lease: { ...FIXTURE_LEASE, rentableSqft: null, camProRataBps: 1_500 },
      rows: FIXTURE_ROWS,
    });
    expect(byFixedShare.canCompute).toBe(true);
  });

  it("a reversed period blocks", () => {
    const a = assessCamInputs({
      pool: { ...FIXTURE_POOL, periodStart: "2026-12-31", periodEnd: "2026-01-01" },
      lease: FIXTURE_LEASE,
      rows: FIXTURE_ROWS,
    });
    expect(a.canCompute).toBe(false);
    expect(a.blocking.map((m) => m.field)).toContain("pool.period");
  });

  it("THIN coverage is disclosed but NOT blocking — a partial year is still real spend", () => {
    const thin = previewCamReconciliation({
      pool: FIXTURE_POOL,
      lease: FIXTURE_LEASE,
      rows: FIXTURE_ROWS.slice(0, 3), // 3 of 12 months
      estimatedBilledCents: FIXTURE_ESTIMATED_BILLED_CENTS,
    });
    expect(thin.blocked).toBe(false);
    expect(thin.result?.coverageComplete).toBe(false);
    const coverage = thin.missing.find((m) => m.field === "pool.actuals.coverage");
    expect(coverage).toBeDefined();
    expect(coverage?.blocking).toBe(false);
    expect(coverage?.label).toContain("of 12 months");
  });
});

// ---------------------------------------------------------------------------
// Freeze fixtures — generate a statement, then EDIT THE POOL underneath it.
// ---------------------------------------------------------------------------

/** Build the exact row the generate route freezes, from an engine result. */
function freezeFrom(pool: CamPoolInput, lease: CamLeaseInput, rows: MeasurableExpenseRow[], billed: number): CamFrozenStatement {
  const result = computeCamReconciliation({ pool, lease, rows, estimatedBilledCents: billed });
  return {
    periodStart: pool.periodStart,
    periodEnd: pool.periodEnd,
    proRataBpsUsed: result.proRataBps,
    proRataBasis: result.proRataBasis,
    leasedSqftUsed: result.leasedSqftUsed,
    totalRentableSqftUsed: result.totalRentableSqftUsed,
    poolActualCents: result.poolActualCents,
    byCategoryCents: result.byCategoryCents as Record<string, number>,
    recoverableShareCents: result.recoverableShareCents,
    estimatedBilledCents: result.estimatedBilledCents,
    estimatedBilledBasis: "from_charges",
    deltaCents: result.deltaCents,
    coverageMonths: result.coverageMonths,
    coverageComplete: result.coverageComplete,
    statementMarkdown: renderCamStatementMarkdown(result, {
      periodStart: pool.periodStart,
      periodEnd: pool.periodEnd,
      poolKind: "cam",
      estimatedBilledBasis: "from_charges",
    }),
    statementVersion: CAM_STATEMENT_VERSION,
    generatedAt: new Date("2027-01-15T10:00:00.000Z"),
    generatedBy: "engine",
  };
}

describe("exit test 3 — a generated statement is byte-stable when the pool is edited", () => {
  const issued = freezeFrom(FIXTURE_POOL, FIXTURE_LEASE, FIXTURE_ROWS, FIXTURE_ESTIMATED_BILLED_CENTS);
  const issuedCanonical = canonicalCamStatement(issued);
  const issuedFingerprint = camStatementFingerprint(issued);

  // The operator now re-measures the building and re-categorises the pool —
  // exactly the edit the schema comment says must not rewrite a sent statement.
  const EDITED_POOL: CamPoolInput = {
    ...FIXTURE_POOL,
    totalRentableSqft: 20_000, // re-measure: share would jump 15% → 18%
    grossUpPct: 12, // re-asserted gross-up
    recoverableCategories: [...FIXTURE_POOL.recoverableCategories, "management_fees"],
  };
  const wouldBe = freezeFrom(EDITED_POOL, FIXTURE_LEASE, FIXTURE_ROWS, FIXTURE_ESTIMATED_BILLED_CENTS);

  it("guards the guard — the pool edit really does change what a fresh statement would say", () => {
    expect(wouldBe.recoverableShareCents).not.toBe(issued.recoverableShareCents);
    expect(wouldBe.poolActualCents).not.toBe(issued.poolActualCents);
    expect(wouldBe.proRataBpsUsed).toBe(1_800);
  });

  it("the frozen statement is recognised as frozen", () => {
    expect(isFrozenCamStatement(issued)).toBe(true);
  });

  it("re-generating after the edit REFUSES and writes nothing", () => {
    const decision = decideCamStatementWrite({ existing: issued, incoming: wouldBe, intent: "engine" });
    expect(decision.action).toBe("refuse_frozen");
    expect(decision.reason).toMatch(/frozen/i);
  });

  it("the frozen statement is byte-identical after the refusal — canonical form AND fingerprint", () => {
    // NON-TAUTOLOGICAL (fleet-13 audit). This test used to compare a local
    // object literal against a snapshot of itself, which nothing could ever
    // mutate — so it passed even when `decideCamStatementWrite` was forced to
    // always return {action:"write"}. It proved the policy has no side
    // effects, which is not the claim in its name.
    //
    // Now it models the STORE: a fake row that a write would actually
    // overwrite, so byte-stability is a property of what a reader gets back
    // after the refused call, not of an untouched local.
    let stored = { ...issued };
    const applyIfPermitted = () => {
      const d = decideCamStatementWrite({ existing: stored, incoming: wouldBe, intent: "engine" });
      if (d.action !== "refuse_frozen") stored = { ...stored, ...wouldBe };
      return d;
    };

    const decision = applyIfPermitted();
    expect(decision.action).toBe("refuse_frozen");
    // The store was NOT written — this is what the mutation would break.
    expect(canonicalCamStatement(stored)).toBe(issuedCanonical);
    expect(camStatementFingerprint(stored)).toBe(issuedFingerprint);
    expect(stored.recoverableShareCents).toBe(425_372);
    expect(stored.statementMarkdown).toContain("$4,253.72");
    // A second attempt is equally refused — freezing is not one-shot.
    expect(applyIfPermitted().action).toBe("refuse_frozen");
    expect(camStatementFingerprint(stored)).toBe(issuedFingerprint);

    decideCamStatementWrite({ existing: issued, incoming: wouldBe, intent: "engine" });
    // Byte-stability is the whole point: the canonical serialization of the
    // exhibit is unchanged, character for character.
    expect(canonicalCamStatement(issued)).toBe(issuedCanonical);
    expect(camStatementFingerprint(issued)).toBe(issuedFingerprint);
    // ...and the statement text a tenant holds is untouched.
    expect(issued.statementMarkdown).toContain("$4,253.72");
    expect(issued.recoverableShareCents).toBe(425_372);
  });

  it("the divergence is REPORTED as drift, not hidden and not applied", () => {
    const decision = decideCamStatementWrite({ existing: issued, incoming: wouldBe, intent: "engine" });
    const fields = decision.drift.map((d) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "totalRentableSqftUsed",
        "proRataBpsUsed",
        "poolActualCents",
        "recoverableShareCents",
        "deltaCents",
      ]),
    );
    for (const d of decision.drift) {
      // Both sides named: what was billed, and what would be said today.
      expect(d).toHaveProperty("frozen");
      expect(d).toHaveProperty("current");
    }
    // Provenance stamps are NOT drift — they always differ and would drown the signal.
    expect(fields).not.toContain("generatedAt");
    expect(fields).not.toContain("generatedBy");
  });

  it("an operator-entered row cannot replace a frozen engine statement either", () => {
    const decision = decideCamStatementWrite({
      existing: issued,
      incoming: { recoverableShareCents: 1, deltaCents: 1 },
      intent: "operator_entered",
    });
    expect(decision.action).toBe("refuse_frozen");
    expect(decision.reason).toMatch(/operator-entered/i);
  });

  it("re-generating an UNCHANGED pool still refuses (freeze is not conditional on drift)", () => {
    const identical = freezeFrom(FIXTURE_POOL, FIXTURE_LEASE, FIXTURE_ROWS, FIXTURE_ESTIMATED_BILLED_CENTS);
    const decision = decideCamStatementWrite({ existing: issued, incoming: identical, intent: "engine" });
    expect(decision.action).toBe("refuse_frozen");
    expect(decision.drift).toEqual([]);
  });
});

describe("freeze policy — what is NOT frozen stays editable", () => {
  const issued = freezeFrom(FIXTURE_POOL, FIXTURE_LEASE, FIXTURE_ROWS, FIXTURE_ESTIMATED_BILLED_CENTS);

  it("no existing row → write", () => {
    expect(decideCamStatementWrite({ existing: null, incoming: issued, intent: "engine" }).action).toBe("write");
  });

  it("an operator-entered row is data entry, not an exhibit → write", () => {
    const operatorRow: CamFrozenStatement = {
      ...issued,
      statementMarkdown: null,
      byCategoryCents: null,
      coverageComplete: null,
      generatedBy: "operator_entered",
    };
    expect(isFrozenCamStatement(operatorRow)).toBe(false);
    expect(decideCamStatementWrite({ existing: operatorRow, incoming: issued, intent: "engine" }).action).toBe("write");
  });

  it("an engine row with NO rendered statement was never issued → write", () => {
    const halfRow: CamFrozenStatement = { ...issued, statementMarkdown: null };
    expect(isFrozenCamStatement(halfRow)).toBe(false);
    expect(decideCamStatementWrite({ existing: halfRow, incoming: issued, intent: "engine" }).action).toBe("write");
  });

  it("an engine row with no generatedAt was never issued → write", () => {
    const undated: CamFrozenStatement = { ...issued, generatedAt: null };
    expect(isFrozenCamStatement(undated)).toBe(false);
    expect(decideCamStatementWrite({ existing: undated, incoming: issued, intent: "engine" }).action).toBe("write");
  });
});

describe("canonicalisation is order-independent (so 'byte-stable' means the exhibit, not the object literal)", () => {
  const base = freezeFrom(FIXTURE_POOL, FIXTURE_LEASE, FIXTURE_ROWS, FIXTURE_ESTIMATED_BILLED_CENTS);

  it("a category map built in a different key order canonicalises identically", () => {
    const reordered: CamFrozenStatement = {
      ...base,
      byCategoryCents: {
        insurance: 640_000,
        cleaning_maintenance: 288_000,
        utilities: 1_008_000,
        repairs: 412_500,
      },
    };
    expect(canonicalCamStatement(reordered)).toBe(canonicalCamStatement(base));
    expect(camStatementFingerprint(reordered)).toBe(camStatementFingerprint(base));
  });

  it("a Date and its ISO string canonicalise identically (driver vs JSON round-trip)", () => {
    const asString: CamFrozenStatement = { ...base, generatedAt: "2027-01-15T10:00:00.000Z" };
    expect(canonicalCamStatement(asString)).toBe(canonicalCamStatement(base));
  });

  it("a one-cent change in the share changes the canonical form", () => {
    const nudged: CamFrozenStatement = { ...base, recoverableShareCents: (base.recoverableShareCents ?? 0) + 1 };
    expect(canonicalCamStatement(nudged)).not.toBe(canonicalCamStatement(base));
    expect(diffCamStatement(base, nudged).map((d) => d.field)).toContain("recoverableShareCents");
  });

  it("DERIVED — the canonical form covers every field of the exhibit, and every one of them can drift", () => {
    // The canonical form is built FROM CAM_STATEMENT_CANONICAL_FIELDS, so this
    // proves the two cannot come apart: a column added to CamFrozenStatement but
    // forgotten in the field list would make a CHANGED statement fingerprint as
    // unchanged — silent, and exactly the failure freezing exists to prevent.
    const serialised = Object.keys(JSON.parse(canonicalCamStatement(base)));
    expect(serialised).toEqual([...CAM_STATEMENT_CANONICAL_FIELDS]);

    // Every declared exhibit field is compared for drift EXCEPT the four whose
    // exclusion is deliberate (provenance stamps + the rendered text).
    const nudgedAll: Partial<CamFrozenStatement> = {
      periodStart: "1999-01-01",
      periodEnd: "1999-12-31",
      proRataBpsUsed: 1,
      proRataBasis: "lease_fixed",
      leasedSqftUsed: 1,
      totalRentableSqftUsed: 1,
      poolActualCents: 1,
      byCategoryCents: { repairs: 1 },
      recoverableShareCents: 1,
      estimatedBilledCents: 1,
      estimatedBilledBasis: "none",
      deltaCents: 1,
      coverageMonths: 1,
      coverageComplete: false,
      statementMarkdown: "different",
      statementVersion: "cam-v99",
      generatedAt: "2099-01-01T00:00:00.000Z",
      generatedBy: "somebody-else",
    };
    const drifted = new Set(diffCamStatement(base, nudgedAll).map((d) => d.field));
    const undetected = CAM_STATEMENT_CANONICAL_FIELDS.filter((f) => !drifted.has(f));
    expect(undetected.sort()).toEqual(
      ["generatedAt", "generatedBy", "statementMarkdown", "statementVersion"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// DERIVED guard — every write path in the route must consult the freeze policy.
// ---------------------------------------------------------------------------
describe("derived — every cam_reconciliations write path in the route consults the freeze policy", () => {
  const ledgerPath = path.join(ROOT, "server/routes-rent-ledger.ts");
  const ledger = fs.readFileSync(ledgerPath, "utf-8");

  /**
   * Each handler is the slice from `app.post(`/`app.patch(` up to the next one.
   * Derived from the source, so a NEW write path added later is picked up
   * automatically instead of needing a case added here.
   */
  const handlers: Array<{ header: string; body: string }> = [];
  const starts = [...ledger.matchAll(/app\.(?:post|patch|put|delete)\(\s*"([^"]+)"/g)];
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].index ?? 0;
    const to = i + 1 < starts.length ? (starts[i + 1].index ?? ledger.length) : ledger.length;
    handlers.push({ header: starts[i][1], body: ledger.slice(from, to) });
  }

  const writers = handlers.filter((h) => /\.insert\(camReconciliations\)/.test(h.body));

  it("finds the write paths at all (guards the guard)", () => {
    expect(writers.length).toBeGreaterThanOrEqual(2);
  });

  for (const w of writers) {
    it(`${w.header} consults decideCamStatementWrite before inserting`, () => {
      const decisionAt = w.body.indexOf("decideCamStatementWrite(");
      const insertAt = w.body.indexOf(".insert(camReconciliations)");
      expect(
        decisionAt,
        `${w.header} writes cam_reconciliations without consulting the freeze policy — a frozen ` +
          `statement could be silently overwritten. Route the write through decideCamStatementWrite().`,
      ).toBeGreaterThanOrEqual(0);
      expect(decisionAt).toBeLessThan(insertAt);
      // ...and it must actually honour a refusal rather than log it and carry on.
      expect(w.body).toMatch(/refuse_frozen/);
    });
  }

  it("the worksheet dry-run endpoint exists and writes nothing", () => {
    const worksheet = handlers.find((h) => h.header.includes("worksheet"));
    // The worksheet is a GET (a dry run), so it must NOT appear among the
    // mutating handlers enumerated above.
    expect(worksheet).toBeUndefined();
    expect(ledger).toContain('app.get("/api/cam-pools/:poolId/worksheet"');
    expect(ledger).toContain("previewCamReconciliation(");
  });

  it("statement version is stamped from the shared constant, not a route literal", () => {
    expect(ledger).toContain("CAM_STATEMENT_VERSION");
  });
});

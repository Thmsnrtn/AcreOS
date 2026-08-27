/**
 * >$500 constitutional hard-stop lock.
 *
 * CLAUDE.md (and the founder's confirmation): "spends >$500 stay founder-only
 * forever." Only Tier 1 ($0–$500) may be granted autonomously; every larger
 * spend must route to the founder. This test pins that invariant so the money
 * gate can never silently drift back to autonomous $500–$50K spends (the exact
 * regression the deep audit found).
 *
 * ── WHY THIS FILE WAS REWRITTEN ───────────────────────────────────────────
 *
 * It was pinning a function production could not reach.
 *
 * `financialAuthorityGate.ts` carried TWO tier resolvers: the module-level
 * `tierForAmount`, described in its own comment as a "public mirror of the
 * service's private getTier — kept in sync", and the private `getTier` that
 * the live path actually calls (`requestSpend` → `getTier` →
 * `tier.founderApprovalRequired`, reached from
 * autonomousDecisionExecutor.ts:1010). `spendIsAutonomous` used the mirror,
 * and this file used `spendIsAutonomous`. So an edit to `getTier` alone would
 * have drifted the money gate with every assertion here still green — a
 * regression test locking a hard stop against drift, blind to the code that
 * enforces it. `getTier` now delegates to `tierForAmount`: one owner, and the
 * assertions below reach the deciding code.
 *
 * The old version also tested NINE hand-picked amounts. Nine points cannot
 * distinguish "the boundary is correct" from "these nine happen to land
 * right", and a tenth tier inserted between two of them would pass. The
 * assertions are now PROPERTIES over the whole table and a dense sweep across
 * the boundary, so a new tier row or a new resolver cannot route around them.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AUTONOMOUS_SPEND_CEILING_CENTS,
  spendIsAutonomous,
} from "../../server/services/financialAuthorityGate";
import {
  HARD_STOP_SPEND_LIMIT_USD,
  HARD_STOP_SPEND_LIMIT_CENTS,
} from "../../server/services/autopilot/hardStops";

/**
 * The tier table and its resolver stay MODULE-PRIVATE on purpose.
 *
 * Exporting them so a test could introspect them would add exports with no
 * production consumer — which the reachability gate correctly counts as debt,
 * and which is the same "exists only for its test" shape this file exists to
 * punish. `spendIsAutonomous` is the whole contract: a tier row no amount can
 * reach cannot decide anything, so sweeping amounts covers every tier that
 * matters, without asking the module to widen its surface for the test.
 */

describe("the hard stop is observable at all (vacuity guard, first)", () => {
  it("states the ceiling as one number, not a literal retyped per assertion", () => {
    // The number is imported, not repeated. A test that retypes 50_000 agrees
    // with a drifted table instead of catching it — and this constant is the
    // Tier 1 ceiling AND the Tier 2 floor AND autonomousDecisionExecutor's
    // HARD_GUARDRAIL_AMOUNT_LIMIT, so there is exactly one place to change it.
    // Asserted as $500-in-cents DERIVED from the dollar figure, not the literal
    // 50_000: retyping 50_000 here is exactly the drift the cross-lane block
    // below exists to forbid.
    expect(AUTONOMOUS_SPEND_CEILING_CENTS).toBe(HARD_STOP_SPEND_LIMIT_USD * 100);
  });

  it("answers both ways, so a constant `false` cannot pass the suite", () => {
    // Without this, a `spendIsAutonomous` stubbed to always refuse would make
    // every hard-stop assertion below pass while breaking Tier 1 entirely.
    expect(spendIsAutonomous(0)).toBe(true);
    expect(spendIsAutonomous(5_000_000)).toBe(false);
  });

  it("never falls out of the table — no amount resolves to autonomy by accident", () => {
    // The resolver's fallback is what stops an out-of-range amount from
    // resolving to `undefined` and taking a truthiness branch into autonomy.
    for (const cents of [5_000_000, 50_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(spendIsAutonomous(cents), `${cents} cents escaped the table`).toBe(false);
    }
  });
});

describe(">$500 spending hard stop", () => {
  it("permits autonomous spend below the $500 Tier-1 ceiling", () => {
    expect(spendIsAutonomous(0)).toBe(true);
    expect(spendIsAutonomous(1_00)).toBe(true); // $1
    expect(spendIsAutonomous(AUTONOMOUS_SPEND_CEILING_CENTS - 1)).toBe(true); // $499.99
  });

  it("requires founder approval at and above $500", () => {
    expect(spendIsAutonomous(AUTONOMOUS_SPEND_CEILING_CENTS)).toBe(false); // exactly $500
    expect(spendIsAutonomous(AUTONOMOUS_SPEND_CEILING_CENTS + 1)).toBe(false);
    expect(spendIsAutonomous(500_000_00)).toBe(false); // $500,000 — beyond all tiers
  });

  it("is monotonic across the boundary — a dense sweep, not nine points", () => {
    // The property, not a sample. Nine hand-picked amounts cannot distinguish
    // "the boundary is correct" from "these nine happen to land right", and a
    // tenth tier inserted between two of them would pass. This walks every $1
    // from $0 to $1,000, every $100 up to $60,000 (past every tier edge in the
    // table), and the documented tier boundaries themselves. Any new tier row
    // is covered the moment it exists, because the sweep is over AMOUNTS, not
    // over rows the test would have to be told about.
    const probes = new Set<number>();
    for (let dollars = 0; dollars <= 1_000; dollars++) probes.add(dollars * 100);
    for (let dollars = 1_000; dollars <= 60_000; dollars += 100) probes.add(dollars * 100);
    for (const edge of [50_000, 250_000, 1_000_000, 5_000_000]) {
      probes.add(edge - 1);
      probes.add(edge);
      probes.add(edge + 1);
    }
    let checked = 0;
    for (const cents of [...probes].sort((a, b) => a - b)) {
      const expected = cents < AUTONOMOUS_SPEND_CEILING_CENTS;
      expect(
        spendIsAutonomous(cents),
        `$${(cents / 100).toFixed(2)} should ${expected ? "" : "NOT "}be autonomous`,
      ).toBe(expected);
      checked++;
    }
    expect(checked, "the sweep degenerated — it must probe the whole range").toBeGreaterThan(1_000);
  });
});

describe("the live path resolves through the function under test", () => {
  it("the service holds no second tier resolver at all", () => {
    // The defect this file was rewritten for, pinned so it cannot return.
    //
    // The fix was not to guard the duplicate — it was to DELETE the private
    // getTier and point its one call site at tierForAmount. So the assertion
    // is on the count of range scans in the file, which is the shape ANY tier
    // resolver must take against this table, whatever it is named. Keyed on
    // the scan, not on a method name.
    //
    // MEASURED BLINDNESS, which is why this exists: with the old two-resolver
    // code, adding one early return to getTier so $0-$2,500 resolved to the
    // autonomous Tier 1 left the previous version of this file passing 2/2.
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/financialAuthorityGate.ts"),
      "utf8",
    );
    const scans = source.match(/amountCents\s*>=\s*t\.minCents/g) ?? [];
    expect(
      scans.length,
      "a second tier range-scan appeared in financialAuthorityGate.ts. The live " +
        "path and this test must resolve tiers through ONE function, or the hard " +
        "stop drifts with the test green.",
    ).toBe(1);
    expect(
      source,
      "a private getTier is back. It was deleted on purpose: a resolver the " +
        "tests cannot import is a resolver the tests cannot pin.",
    ).not.toMatch(/private\s+getTier\s*\(/);
  });

  it("requestSpend reads the tier from that one resolver", () => {
    // Anchors the coupling itself. If the live path stops calling
    // tierForAmount, every property asserted above becomes a statement about
    // dead code again — which is precisely the state this file was in.
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/financialAuthorityGate.ts"),
      "utf8",
    );
    expect(source).toMatch(/let\s+tier\s*=\s*tierForAmount\(amountCents\)/);
    expect(source, "the founder-approval branch is what the tier is FOR").toMatch(
      /if\s*\(\s*tier\.founderApprovalRequired\s*\)/,
    );
  });
});


/**
 * CROSS-LANE AGREEMENT — the reconciliation the master directive named as the
 * precondition for expanding autonomy ("reconcile authority before expanding
 * it"; docs/company/master-directive-2026-08.md).
 *
 * The >$500 spend hard-stop is enforced in TWO lanes that never shared a
 * constant until 2026-08-28:
 *   - the executor lane   — financialAuthorityGate.ts's AUTONOMOUS_SPEND_CEILING_CENTS,
 *     consumed by autonomousDecisionExecutor's HARD_GUARDRAIL_AMOUNT_LIMIT
 *   - the autopilot lane  — autopilot/hardStops.ts's HARD_STOP_SPEND_LIMIT_USD,
 *     consumed by witnessGrant and gateWatcher
 * They agreed only by the author's arithmetic (50_000 cents == 500 USD * 100).
 * Change one and the two lanes silently governed the company at different
 * ceilings. The executor value now DERIVES from the autopilot constant, and
 * this block FAILS if they ever disagree — falsified against the semantic
 * defect (a ceiling that differs between lanes), not a symbol name.
 */
describe("the two autonomy lanes enforce ONE spend ceiling", () => {
  it("the executor ceiling is exactly the autopilot ceiling, in cents", () => {
    // If a future edit sets financialAuthorityGate's ceiling to a different
    // number than autopilot/hardStops declares, this is the assertion that goes
    // red — before an agent can spend against a ceiling the other lane forbids.
    expect(AUTONOMOUS_SPEND_CEILING_CENTS).toBe(HARD_STOP_SPEND_LIMIT_CENTS);
  });

  it("the cents and dollar forms of the autopilot constant are consistent", () => {
    // Both are exported so cents-native (Stripe, financial gates) and
    // dollar-native (studio dials, witness grants) callers each read their own
    // unit without re-deriving it. They must stay the same ceiling.
    expect(HARD_STOP_SPEND_LIMIT_CENTS).toBe(HARD_STOP_SPEND_LIMIT_USD * 100);
  });

  it("the ceiling is the constitutional $500, not some other number", () => {
    // Anchors the whole chain to the founder hard-stop actually ratified in
    // shared/governance/constitution.ts. If someone raises the limit, that is a
    // founder decision and must change the constitution too — this catches a
    // quiet raise in code that never touched the statute.
    expect(HARD_STOP_SPEND_LIMIT_USD).toBe(500);
  });
});

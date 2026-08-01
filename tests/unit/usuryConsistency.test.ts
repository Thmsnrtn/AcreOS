/**
 * Cross-source usury consistency — 2026-08-01.
 *
 * This repo ships THREE overlapping per-state usury tables (tracked as
 * `state.usury-ceilings` in shared/governance/statuteRegister.ts):
 *
 *   1. server/services/usuryCeiling.ts   — civil/commercial/RE ceilings + exemptions
 *   2. server/services/usury.ts          — single "maxRate" per state (wired into
 *                                          routes-deals/routes-finance/complianceGate)
 *   3. shared/regulatory/rmloAdvisor.ts  — general civil caps in bps (note form)
 *
 * Two product surfaces can therefore give an operator two different answers
 * about the same rate. This test compares the one lane all three claim to
 * describe — the GENERAL/CIVIL usury cap, as a number-or-null (null = "no
 * cap") — probed strictly through each module's public API (no source-text
 * parsing, no private-table imports).
 *
 * Contract enforced here:
 *   - Every state present in >1 source must AGREE, or
 *   - be in JUSTIFIED_DIVERGENCES (lane mismatch explainable from the sources'
 *     own notes, pinned exactly so the entry rots loudly if a source changes), or
 *   - be in UNJUSTIFIED_DISAGREEMENTS (known, unresolved conflicts — the
 *     aspiration that they agree is the it.skip below; the pinned values keep
 *     the list honest: fix a source, and its entry here MUST be removed).
 *
 * Shrink-only: entries leave these lists when a source is corrected. Never add
 * a new state to UNJUSTIFIED_DISAGREEMENTS to make this file green — reconcile
 * the sources instead.
 *
 * (A FOURTH partial table exists in server/services/regulatoryIntelligence.ts
 * (`usuryCeiling` per state profile) — out of scope for this test, reported to
 * the register.)
 */

import { describe, it, expect } from "vitest";
import { getAllStateLimits } from "../../server/services/usuryCeiling";
import { checkUsury } from "../../server/services/usury";
import { advise } from "../../shared/regulatory/rmloAdvisor";

// ─── Probes (public API only) ────────────────────────────────────────────────

/** null = source says "no general cap"; undefined = state absent from source. */
type Cap = number | null | undefined;

interface StateCaps {
  ceiling: Cap; // usuryCeiling.ts civilCeiling
  usury: Cap;   // usury.ts maxRate (0-sentinel normalized to null)
  rmlo: Cap;    // rmloAdvisor.ts general cap, bps/100
}

function usuryValue(stateCode: string): Cap {
  const r = checkUsury(stateCode, 1);
  if (r.statuteNote === "Unknown") return undefined; // not in usury.ts's table
  // usury.ts uses maxRate 0 as its documented "no statutory cap" sentinel (SD).
  if (r.maxAllowedRate === 0) return null;
  return r.maxAllowedRate;
}

function rmloValue(stateCode: string): Cap {
  const out = advise({
    state: stateCode,
    collateralType: "vacant_land",
    loanAmountCents: 10_000_000,
    annualRateBps: 100,
    isOriginating: true,
    isBusinessPurpose: true,
  });
  if (out.stateUsuryCapNote.includes("not in advisor's reference table")) return undefined;
  return out.stateUsuryCapBps === null ? null : out.stateUsuryCapBps / 100;
}

function capsFor(stateCode: string, ceilingCivil: number | null): StateCaps {
  return {
    ceiling: ceilingCivil,
    usury: usuryValue(stateCode),
    rmlo: rmloValue(stateCode),
  };
}

/** True when every source that HAS the state gives the same number-or-null. */
function agrees(caps: StateCaps): boolean {
  const present = [caps.ceiling, caps.usury, caps.rmlo].filter((v) => v !== undefined);
  return present.every((v) => v === present[0]);
}

function fmt(caps: StateCaps): string {
  const p = (v: Cap) => (v === undefined ? "absent" : v === null ? "no-cap" : `${v}%`);
  return `ceiling=${p(caps.ceiling)} usury=${p(caps.usury)} rmlo=${p(caps.rmlo)}`;
}

// ─── Known, justified divergences (lane mismatches, pinned exactly) ──────────

const JUSTIFIED_DIVERGENCES: Record<string, { pin: StateCaps; reason: string }> = {
  CO: {
    pin: { ceiling: null, usury: 45, rmlo: 45 },
    reason:
      "Lane mismatch. C.R.S. § 5-12-103 lets parties contract for any rate (usuryCeiling's null); 45% is the supervised-lender/criminal ceiling that usury.ts and rmloAdvisor recorded — rmloAdvisor's own note says 'Supervised lenders to 45%; non-supervised much lower'.",
  },
  DE: {
    pin: { ceiling: null, usury: 5, rmlo: null },
    reason:
      "Lane mismatch. usury.ts records the statutory default rate absent a written agreement (its own note: 'written contracts may exceed'); usuryCeiling and rmloAdvisor record the written-agreement lane, which has no cap ('deliberately lender-friendly' / 'No statutory cap with written agreement').",
  },
  NJ: {
    pin: { ceiling: 16, usury: 30, rmlo: 30 },
    reason:
      "Lane mismatch. 16% is the civil cap, 30% the criminal/commercial cap. usuryCeiling records BOTH (civilCeiling 16, commercialCeiling 30); usury.ts and rmloAdvisor stored the 30% lane as their single number — rmloAdvisor's own note concedes '16% civil first-lien residential'.",
  },
};

// ─── Known, UNJUSTIFIED disagreements (dated 2026-08-01) ─────────────────────
// Conflicting numbers for the same lane, with no corroborating explanation in
// any source's own notes. These cannot be resolved from the legal references
// cited in the repo alone, and two of the three files (usury.ts, rmloAdvisor.ts)
// are outside this change's blast radius — so the conflicts are pinned and the
// agreement assertion is skipped below. Remove an entry when its sources are
// reconciled.

const UNJUSTIFIED_DISAGREEMENTS: Record<string, StateCaps> = {
  AL: { ceiling: 6, usury: 8, rmlo: 8 },
  AK: { ceiling: 10.5, usury: 10.5, rmlo: 5 }, // rmlo stored the 'federal-rate-plus-5' MARGIN as the cap
  GA: { ceiling: 7, usury: 16, rmlo: 16 },
  ID: { ceiling: 12, usury: 12, rmlo: null },
  IN: { ceiling: 8, usury: 25, rmlo: 8 },
  IA: { ceiling: null, usury: 24, rmlo: 8 }, // three-way conflict
  KY: { ceiling: 8, usury: 19, rmlo: 8 },
  ME: { ceiling: null, usury: 18, rmlo: 12 }, // three-way conflict
  MO: { ceiling: null, usury: 10, rmlo: 10 },
  MT: { ceiling: null, usury: 15, rmlo: 15 },
  NE: { ceiling: null, usury: 16, rmlo: 16 },
  NV: { ceiling: null, usury: 40, rmlo: null }, // NRS 99.050 permits any agreed rate; usury.ts's 40 is unexplained
  NH: { ceiling: null, usury: 10, rmlo: 10 },
  NM: { ceiling: null, usury: 15, rmlo: 15 },
  NC: { ceiling: 8, usury: 16, rmlo: 8 },
  ND: { ceiling: 6, usury: 6, rmlo: 15 },
  OK: { ceiling: 6, usury: 10, rmlo: 10 },
  OR: { ceiling: 9, usury: 12, rmlo: 9 },
  TN: { ceiling: null, usury: 10, rmlo: 24 }, // three-way conflict
  TX: { ceiling: null, usury: 18, rmlo: 10 }, // three-way conflict — and TX is auditOrgUsury's fallback state
  UT: { ceiling: null, usury: 10, rmlo: null },
  VT: { ceiling: null, usury: 12, rmlo: 12 },
  WI: { ceiling: null, usury: 12, rmlo: 12 },
  WY: { ceiling: null, usury: 10, rmlo: 7 }, // three-way conflict
  DC: { ceiling: 6, usury: undefined, rmlo: 24 }, // usury.ts has no DC row
};

// ─── The comparison universe ─────────────────────────────────────────────────
// usuryCeiling.ts is the widest table (50 states + DC); a separate test below
// proves the other two sources contain no state code that usuryCeiling lacks,
// so iterating its table covers every multi-source state.

const ALL_STATES = getAllStateLimits();

describe("cross-source usury consistency", () => {
  it("usuryCeiling's table is the superset: no state exists only in usury.ts or rmloAdvisor", () => {
    const known = new Set(ALL_STATES.map((s) => s.stateCode));
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const strays: string[] = [];
    for (const a of letters) {
      for (const b of letters) {
        const code = a + b;
        if (known.has(code)) continue;
        if (usuryValue(code) !== undefined) strays.push(`${code} (usury.ts)`);
        if (rmloValue(code) !== undefined) strays.push(`${code} (rmloAdvisor)`);
      }
    }
    expect(strays, `state codes missing from usuryCeiling.ts: ${strays.join(", ")}`).toEqual([]);
  });

  it("every state agrees across sources, or is explicitly allowlisted/pinned", () => {
    const unaccounted: string[] = [];
    for (const s of ALL_STATES) {
      const caps = capsFor(s.stateCode, s.civilCeiling);
      if (agrees(caps)) continue;
      if (JUSTIFIED_DIVERGENCES[s.stateCode]) continue;
      if (UNJUSTIFIED_DISAGREEMENTS[s.stateCode]) continue;
      unaccounted.push(`${s.stateCode}: ${fmt(caps)}`);
    }
    expect(
      unaccounted,
      `NEW cross-source usury disagreement(s) — reconcile the sources, do not extend the pin lists:\n${unaccounted.join("\n")}`
    ).toEqual([]);
  });

  it("no stale entries: pinned states must actually still disagree", () => {
    const stale: string[] = [];
    for (const code of [...Object.keys(JUSTIFIED_DIVERGENCES), ...Object.keys(UNJUSTIFIED_DISAGREEMENTS)]) {
      const row = ALL_STATES.find((s) => s.stateCode === code);
      expect(row, `${code} pinned but absent from usuryCeiling.ts`).toBeDefined();
      if (row && agrees(capsFor(code, row.civilCeiling))) stale.push(code);
    }
    expect(
      stale,
      `these states now AGREE — remove them from the pin lists: ${stale.join(", ")}`
    ).toEqual([]);
  });

  describe("justified divergences still hold exactly as documented", () => {
    for (const [code, { pin, reason }] of Object.entries(JUSTIFIED_DIVERGENCES)) {
      it(`${code}: ${fmt(pin)}`, () => {
        const row = ALL_STATES.find((s) => s.stateCode === code);
        expect(row, `${code} absent from usuryCeiling.ts`).toBeDefined();
        const caps = capsFor(code, row!.civilCeiling);
        expect(caps, `${code} drifted from its documented divergence. Reason on file: ${reason}`).toEqual(pin);
      });
    }
  });

  describe("unjustified disagreements are pinned (fix a source → remove its entry)", () => {
    for (const [code, pin] of Object.entries(UNJUSTIFIED_DISAGREEMENTS)) {
      it(`${code}: ${fmt(pin)}`, () => {
        const row = ALL_STATES.find((s) => s.stateCode === code);
        expect(row, `${code} absent from usuryCeiling.ts`).toBeDefined();
        const caps = capsFor(code, row!.civilCeiling);
        expect(caps, `${code} changed — update the sources to AGREE and delete this pin`).toEqual(pin);
      });
    }
  });

  // ── The aspiration — currently impossible, so skipped, loudly ──────────────
  // 2026-08-01: 25 states/jurisdictions (AL AK GA ID IN IA KY ME MO MT NE NV NH
  // NM NC ND OK OR TN TX UT VT WI WY DC) carry conflicting general-cap values
  // across usury.ts / usuryCeiling.ts / rmloAdvisor.ts with no justification in
  // any source's notes. usury.ts and rmloAdvisor.ts may not be edited in this
  // change (reported instead); un-skip once the three tables are reconciled to
  // one registry.
  it.skip("2026-08-01: all three usury sources agree for every state (25 unjustified conflicts outstanding)", () => {
    const disagreements: string[] = [];
    for (const s of ALL_STATES) {
      const caps = capsFor(s.stateCode, s.civilCeiling);
      if (!agrees(caps) && !JUSTIFIED_DIVERGENCES[s.stateCode]) {
        disagreements.push(`${s.stateCode}: ${fmt(caps)}`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});

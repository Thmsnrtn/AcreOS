/**
 * Tests for the vertical-aware Pax persona registry.
 *
 * Coverage:
 *  1. Production persona accessor (land_investing) returns full content
 *  2. Default-fallback when vertical is null / unknown
 *  3. Every vertical has all required fields populated (loop)
 *  4. ALL SIX verticals are production-ready (launch → wave V2 → wave V4 of
 *     ruling #11) and carry zero TODO / scaffold markers
 *  5. Per-vertical depth bars + capability-grounding strings for the four
 *     wave-V4 personas (notes, single_family_rentals, multi_family,
 *     mobile_homes) mirroring the wholesaling (wave V2) pattern
 *  6. Honest-gap discipline: multi_family / mobile_homes / SFR voices state
 *     the platform's real gaps instead of promising unshipped features
 *  7. Competitor-name discipline: forbidden strings absent from PERSONAS
 *     per feedback_competitor_refs.md
 */

import { describe, expect, it } from "vitest";

import { PAX_VERTICALS } from "@shared/schema/pax-verticals";
import { PERSONAS, getPersona, getPersonaOrDefault } from "./personas";

/**
 * The appendices are hard-wrapped template literals, so multi-word phrases
 * can span a line break. Normalize whitespace before phrase assertions.
 */
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("getPersona", () => {
  it("returns the production land_investing persona", () => {
    const p = getPersona("land_investing");
    expect(p.vertical).toBe("land_investing");
    expect(p.verticalLabel).toBe("Land Investing");
    expect(p.productionReady).toBe(true);
    expect(p.systemPromptAppendix.length).toBeGreaterThan(200);
  });

  it("returns the production mobile_homes persona (deepened in wave V4)", () => {
    const p = getPersona("mobile_homes");
    expect(p.vertical).toBe("mobile_homes");
    expect(p.productionReady).toBe(true);
  });
});

describe("getPersonaOrDefault", () => {
  it("falls back to land_investing on null", () => {
    const p = getPersonaOrDefault(null);
    expect(p.vertical).toBe("land_investing");
  });

  it("falls back to land_investing on undefined", () => {
    const p = getPersonaOrDefault(undefined);
    expect(p.vertical).toBe("land_investing");
  });

  it("returns the requested persona for a valid vertical", () => {
    const p = getPersonaOrDefault("mobile_homes");
    expect(p.vertical).toBe("mobile_homes");
    expect(p.productionReady).toBe(true);
  });
});

describe("PERSONAS registry — completeness", () => {
  it("includes every vertical in PAX_VERTICALS", () => {
    for (const v of PAX_VERTICALS) {
      expect(PERSONAS[v]).toBeDefined();
      expect(PERSONAS[v].vertical).toBe(v);
    }
  });

  it("every persona has all required fields populated", () => {
    for (const v of PAX_VERTICALS) {
      const p = PERSONAS[v];
      expect(p.verticalLabel.length).toBeGreaterThan(0);
      expect(typeof p.productionReady).toBe("boolean");
      expect(p.domainTerminology.length).toBeGreaterThan(0);
      expect(p.exampleDealShape.length).toBeGreaterThan(0);
      expect(p.commonMistakes.length).toBeGreaterThan(0);
      expect(p.keyMetrics.length).toBeGreaterThan(0);
      expect(p.expertReferences.length).toBeGreaterThan(0);
      expect(p.systemPromptAppendix.length).toBeGreaterThan(0);
    }
  });

  it("ALL SIX verticals are production-ready (ruling #11 close-out, wave V4)", () => {
    // land_investing shipped production-ready at launch; wholesaling was
    // deepened in wave V2; notes, single_family_rentals, multi_family, and
    // mobile_homes were deepened in wave V4 — the close-out of the ruling
    // #11 vertical program. No scaffolded personas remain.
    const productionReady = PAX_VERTICALS.filter((v) => PERSONAS[v].productionReady);
    expect(productionReady).toEqual([...PAX_VERTICALS]);
  });

  it("NO persona carries a TODO or scaffold marker of any kind", () => {
    for (const v of PAX_VERTICALS) {
      const haystack = JSON.stringify(PERSONAS[v]);
      expect(haystack).not.toContain("[TODO");
      expect(haystack).not.toContain("TODO:");
      expect(haystack).not.toContain("scaffolded");
      expect(haystack).not.toContain("depth is roadmap");
    }
  });

  it("every persona keeps the no-legal-advice guardrail (immutable #12)", () => {
    for (const v of PAX_VERTICALS) {
      expect(norm(PERSONAS[v].systemPromptAppendix)).toContain("never give legal advice");
      expect(PERSONAS[v].systemPromptAppendix).toContain("immutable #12");
    }
  });
});

// ---------------------------------------------------------------------------
// Shared depth bar — the land_investing / wholesaling structural pattern:
// 10+ terminology entries, 5+ mistakes, 6+ metrics, 4+ references, a rich
// deal shape, and a multi-paragraph appendix.
// ---------------------------------------------------------------------------
function expectProductionDepth(p: (typeof PERSONAS)[keyof typeof PERSONAS]) {
  expect(p.domainTerminology.length).toBeGreaterThanOrEqual(10);
  expect(p.commonMistakes.length).toBeGreaterThanOrEqual(5);
  expect(p.keyMetrics.length).toBeGreaterThanOrEqual(6);
  expect(p.expertReferences.length).toBeGreaterThanOrEqual(4);
  expect(p.exampleDealShape.length).toBeGreaterThan(300);
  expect(p.systemPromptAppendix.length).toBeGreaterThan(200);
}

describe("wholesaling — deepened to production (wave V2 of ruling #11)", () => {
  const p = PERSONAS.wholesaling;

  it("is production-ready with the correct identity", () => {
    expect(p.vertical).toBe("wholesaling");
    expect(p.verticalLabel).toBe("Wholesaling");
    expect(p.productionReady).toBe(true);
  });

  it("matches the land_investing depth bar on every field", () => {
    expectProductionDepth(p);
  });

  it("voice is grounded in the real wholesale stack — assignment vs double close, EMD, state rules, TCPA", () => {
    // Every one of these maps to shipped capability:
    //   - assignment-vs-double-close state rules → wholesaler_state_rules (W-1)
    //   - earnest-money / inspection-period discipline → earnest_money_holds (W-2)
    //   - transactional funding → double_close_deals (W-3)
    //   - buyer list / cash buyers → buyer_blasts + buyer analytics (W-4)
    //   - TCPA-compliant outreach → tcpaCompliance + dncScrub + consentEvents
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("double close");
    expect(haystack).toMatch(/EMD|earnest money/i);
    expect(haystack).toMatch(/inspection period/i);
    expect(haystack).toContain("transactional fund");
    expect(haystack).toMatch(/buyer list|cash buyer/i);
    expect(haystack).toContain("TCPA");
    expect(haystack).toMatch(/license.required|advertising.restricted/i);
  });

  it("MAO is glossed correctly as maximum allowable offer", () => {
    // The old stub misglossed MAO as "maximum allowable offset".
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("maximum allowable offer");
    expect(haystack).not.toContain("allowable offset");
  });
});

describe("notes — deepened to production (wave V4 of ruling #11)", () => {
  const p = PERSONAS.notes;

  it("is production-ready with the correct identity", () => {
    expect(p.vertical).toBe("notes");
    expect(p.verticalLabel).toBe("Notes");
    expect(p.productionReady).toBe(true);
  });

  it("matches the depth bar on every field", () => {
    expectProductionDepth(p);
  });

  it("voice is grounded in the shipped note stack — servicing compliance, acquisition pipeline, paperwork, tax", () => {
    // Every one of these maps to shipped capability:
    //   - UPB / collateral file / BPO / tape → note_acquisitions pipeline +
    //     diligenceChecklist (shared/schema/notes-vertical.ts)
    //   - §1026.41 statements + servicer-vs-holder → reg-z.ts +
    //     periodicStatements predicate (Beatrice 4-gate tree)
    //   - §1024.39 day-36 / day-45 clocks → respa/earlyIntervention (FLAGS
    //     outreach as due; never contacts a borrower — operator makes contact)
    //   - §1024.17 escrow analysis + cushion → respaEscrowAnalysis (analysis
    //     wired at GET /api/notes/:id/escrow-analysis, originated book only;
    //     the §1024.17(i) statement builder is deliberately unwired)
    //   - §1026.36(c) suspense + late-fee non-pyramiding → lateFees +
    //     suspense_balances
    //   - allonge / assignment → noteAssignmentPdf + note_assignments
    //   - SCRA gate → note_loss_mit_cases.scraCheckedAt
    //   - reperforming streak (12) → acquired_notes.consecutiveOnTimePayments
    //   - per-diem payoff (APR/365) → notePaymentMath.computePayoffCents
    //   - 1099-INT / 1096 / FIRE → form1099Batch
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("UPB");
    expect(haystack).toContain("collateral file");
    expect(haystack).toContain("BPO");
    expect(haystack).toContain("1026.41");
    expect(haystack).toMatch(/1024\.39|day-36/);
    expect(haystack).toMatch(/1024\.17|escrow analysis/);
    expect(haystack).toContain("suspense");
    expect(haystack).toMatch(/non-pyramid|never pyramid|1026\.36\(c\)\(2\)/);
    expect(haystack).toContain("allonge");
    expect(haystack).toContain("SCRA");
    expect(haystack).toContain("reperforming");
    expect(haystack).toContain("APR/365");
    expect(haystack).toContain("1099-INT");
  });

  it("keeps the servicer-vs-holder duty distinction (Beatrice ruling) in the voice", () => {
    // §1026.41 / §1024.39 attach to the SERVICER — the persona must never
    // coach a passive holder into sending statements it doesn't owe.
    expect(p.systemPromptAppendix).toContain("not the holder");
  });

  it("aligns with the paxPersona.ts note voices — held for yield, not flipped", () => {
    // VERTICAL_CONTEXTS.note_investor: "Avoid 'resale' or 'flip' — notes
    // are held for yield." The unified vertical voice must not contradict.
    expect(p.systemPromptAppendix).toContain("held for yield");
    expect(p.systemPromptAppendix).not.toMatch(/\bflip the note\b/i);
  });
});

describe("single_family_rentals — deepened to production (wave V4 of ruling #11)", () => {
  const p = PERSONAS.single_family_rentals;

  it("is production-ready with the correct identity", () => {
    expect(p.vertical).toBe("single_family_rentals");
    expect(p.verticalLabel).toBe("Single-Family Rentals");
    expect(p.productionReady).toBe(true);
  });

  it("matches the depth bar on every field", () => {
    expectProductionDepth(p);
  });

  it("voice is grounded in the shipped rental stack — FCRA, ledger, HAP, deposits, inspections", () => {
    // Every one of these maps to shipped capability in shared/schema/
    // rental.ts + routes-rentals / routes-rent-ledger / routes-rent-roll-
    // import + the four landlord workflow templates:
    //   - FCRA attestation + adverse action → tenant_screenings +
    //     fcra_attestations
    //   - partial-aware ledger + legal posture → rent_charges / rent_payments
    //   - state late-fee rules → late_fee_rules
    //   - Section-8 HAP split → rental_leases.hapPortionCents +
    //     rent_payments.payorType 'hap'
    //   - lead-paint gate → rental_leases.leadPaintDisclosureAttachedAt
    //     (24 C.F.R. §35.92)
    //   - photo-gated inspections → move_inspections.photoCount
    //   - deposit deadlines → security_deposits.statutoryDeadline
    //   - renewal countdown + notice window → tpl_landlord_lease_renewal_
    //     countdown + computeNoticeWindow
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("FCRA");
    expect(haystack).toMatch(/adverse.action/i);
    expect(haystack).toMatch(/HAP|Section 8/);
    expect(haystack).toMatch(/rent ledger|ledger/i);
    expect(haystack).toMatch(/partial (rent|payment)/i);
    expect(haystack).toMatch(/late-fee|late fee/i);
    expect(haystack).toMatch(/lead-paint|lead paint/i);
    expect(haystack).toMatch(/move-in/i);
    expect(haystack).toMatch(/statutory (return )?deadline/i);
    expect(haystack).toMatch(/renewal/i);
  });

  it("is honest about the manual rails — records rent, doesn't move money or draft notices", () => {
    // business-types.ts buy_and_hold: manual-entry ledger (no ACH), no
    // screening-bureau provider, eviction-notice generation deferred.
    expect(norm(p.systemPromptAppendix)).toContain("does not move money");
    expect(norm(p.systemPromptAppendix)).toContain("does not draft legal notices");
    expect(norm(p.systemPromptAppendix)).toMatch(/no bureau pull/i);
  });
});

describe("multi_family — deepened to production (wave V4 of ruling #11)", () => {
  const p = PERSONAS.multi_family;

  it("is production-ready with the correct identity", () => {
    expect(p.vertical).toBe("multi_family");
    expect(p.verticalLabel).toBe("Multi-Family");
    expect(p.productionReady).toBe(true);
  });

  it("matches the depth bar on every field", () => {
    expectProductionDepth(p);
  });

  it("voice is grounded in the shipped unit-scale rental stack", () => {
    // Every one of these maps to shipped capability:
    //   - rent-roll import (6-plex → tenants by unit + NOI) →
    //     routes-rent-roll-import
    //   - unit turn / renew-or-turn / two-week relet target →
    //     tpl_multifamily_unit_turn
    //   - per-unit vs joint-and-several + acknowledgment gate →
    //     lease_tenants.holdsJointAndSeveral (rental.ts)
    //   - 4+ unit late-fee caps → late_fee_rules.capPctLargeProperty
    //   - units as first-class records (beds/baths/sqft, asking rent,
    //     active|offline|retired) → rental_units (migration 0219)
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("rent roll");
    expect(haystack).toMatch(/unit turn|make-ready/i);
    expect(haystack).toContain("joint-and-several");
    expect(haystack).toMatch(/4\+ unit|4-plus-unit/);
    expect(haystack).toMatch(/pro-forma/i);
    expect(haystack).toContain("NOI");
  });

  it("states the unit inventory as REAL — migration 0219 closed that gap", () => {
    // This assertion used to pin the opposite claim (/units are labels on
    // leases/). Migration 0219 made units first-class rows in `rental_units`
    // with their own beds/baths/sqft, asking rent and status, and occupancy is
    // computed over that table (computeOccupancySnapshot,
    // GET /api/rent-roll/occupancy). Per the wave rule, the assertion is
    // REWRITTEN to the new truth rather than deleted, so the invariant — the
    // voice describes the unit model the platform actually has — survives.
    // The appendix is hard-wrapped prose, so phrases straddle newlines —
    // match against a whitespace-flattened copy, never the raw string.
    const flat = p.systemPromptAppendix.replace(/\s+/g, " ");
    expect(flat).toMatch(/units are first-class records/i);
    expect(flat).toMatch(/asking rent/i);
    expect(flat).toMatch(/a vacancy is visible/i);
    // …and the stale claim must not come back.
    expect(flat).not.toMatch(/units are labels on leases/i);
  });

  it("does NOT promise the platform's REMAINING gaps — building rollups, T-12 surfaces", () => {
    // business-types.ts multifamily entry, post-0219: the occupancy snapshot
    // is ORG-WIDE with no per-building breakdown, there is no NOI-per-building
    // surface, and there is no T-12/underwriting workspace. Both gaps genuinely
    // stand — the voice must state them, not promise the feature.
    const flat = p.systemPromptAppendix.replace(/\s+/g, " ");
    expect(p.systemPromptAppendix).toContain("no building-level");
    // CORRECTED 2026-07-31. This used to assert the voice said there is "no
    // building-level NOI roll-up". There IS one — GET /api/properties/:id/
    // analytics — and the assertion was pinning our own overstatement. The
    // real gap is narrower and worse: that NOI rests on an ASSUMED 40%
    // expense ratio, because AcreOS holds no property-expense records. The
    // voice must name the assumption rather than deny the surface, so a
    // customer is never handed a cap rate whose expenses nobody measured.
    expect(flat).toMatch(/assumed 40% expense ratio/i);
    expect(flat).toMatch(/never quote that NOI as though the expenses behind it were measured/i);
    expect(flat).toMatch(/no T-12 underwriting workspace/i);
    expect(p.systemPromptAppendix).toContain("never imply those exist");
  });
});

describe("mobile_homes — deepened to production (wave V4 of ruling #11)", () => {
  const p = PERSONAS.mobile_homes;

  it("is production-ready with the correct identity", () => {
    expect(p.vertical).toBe("mobile_homes");
    expect(p.verticalLabel).toBe("Mobile Homes");
    expect(p.productionReady).toBe(true);
  });

  it("matches the depth bar on every field", () => {
    expectProductionDepth(p);
  });

  it("voice is grounded in shipped lot-lease operations + the Dodd-Frank checker", () => {
    // Every one of these maps to shipped capability or named research:
    //   - lot leases on the rentals stack + lot-rent receipt →
    //     rental_leases / rent ledger + tpl_mobile_home_lot_rent_receipt
    //   - renewal countdown → tpl_landlord_lease_renewal_countdown
    //   - financed POH sales → doddFrankChecker (manufactured home = dwelling,
    //     safe harbors, balloon < 60mo, HOEPA personal-property trigger)
    //   - DMV/VIN vs real-property titling → pillar-K Iris persona +
    //     note-investor-followups §10
    const haystack = JSON.stringify(p);
    expect(haystack).toContain("lot rent");
    expect(haystack).toContain("lot lease");
    expect(haystack).toContain("POH");
    expect(haystack).toContain("TOH");
    expect(haystack).toContain("Dodd-Frank");
    expect(haystack).toMatch(/DMV|VIN/);
    expect(haystack).toMatch(/well|septic/i);
    expect(haystack).toMatch(/receipt/i);
  });

  it("states pad inventory as REAL, and still does NOT promise chattel titles or submetering", () => {
    // business-types.ts mobile_home entry, post-pad-inventory: TWO of the three
    // park-specific gaps stand — no home-as-chattel handling, no utilities
    // pass-through billing. Those two assertions are UNCHANGED below and must
    // stay: the voice states the gap, it does not promise the feature.
    expect(p.systemPromptAppendix).toContain("no chattel-title tracking");
    expect(p.systemPromptAppendix).toMatch(/no utilities pass-through/i);

    // The THIRD gap closed, so this assertion is REWRITTEN to the new truth
    // rather than deleted (wave rule: when a wave makes a stubbed thing real,
    // rewrite the assertion that pinned the stub so the invariant survives).
    // It used to pin /no lot\/pad inventory model/ plus "nothing in AcreOS
    // creates one today" and "treat the pad inventory as absent" — accurate
    // then, because `rental_units.kind` enumerated 'pad' and NO write site in
    // the product ever set it. Three now do: the units surface (Units tab of
    // /leases), its bulk-create route, and the lease form's slot-kind picker
    // feeding findOrCreateUnitId (plus the rent-roll importer's `unitKind`,
    // which finally has a driver). The invariant is unchanged — the voice
    // describes the pad model the platform actually has.
    //
    // Flattened — the appendix is hard-wrapped prose and these phrases
    // straddle newlines.
    const flat = p.systemPromptAppendix.replace(/\s+/g, " ");
    expect(flat).toMatch(/AcreOS models pad inventory/i);
    expect(flat).toMatch(/create, edit and retire/i);
    expect(flat).toMatch(/in bulk/i);
    // Occupancy over pads is the whole point of modelling them: a pad nobody
    // has ever leased is exactly the vacancy a lease-derived count cannot see.
    expect(flat).toMatch(/occupancy is computed over those pads/i);
    // …and the retired claims must not come back.
    expect(flat).not.toMatch(/no lot\/pad inventory model/i);
    expect(flat).not.toMatch(/nothing in AcreOS creates one today/i);
    expect(flat).not.toMatch(/treat the pad inventory as absent/i);
    // The enumeration that used to read "never imply the platform models pads,
    // home titles, or submetering" drops PADS and keeps the other two.
    expect(flat).toMatch(/never imply the platform models home titles or submetering/i);
    expect(flat).not.toMatch(/never imply the platform models pads/i);
  });
});

describe("competitor-name discipline (feedback_competitor_refs.md)", () => {
  // Per the founder feedback, none of these names may appear anywhere in
  // persona content — system prompts, terminology, examples, references.
  const FORBIDDEN = ["Land Geek", "GeekPay", "LG Pass", "Mark Podolsky"];
  const haystack = JSON.stringify(PERSONAS);

  for (const name of FORBIDDEN) {
    it(`does not contain "${name}"`, () => {
      expect(haystack).not.toContain(name);
    });
  }

  it("the land_investing systemPromptAppendix does not contain any forbidden competitor name", () => {
    const appendix = PERSONAS.land_investing.systemPromptAppendix;
    for (const name of FORBIDDEN) {
      expect(appendix).not.toContain(name);
    }
  });
});

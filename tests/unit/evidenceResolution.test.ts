/**
 * Evidence resolution policy — the deterministic kernel of the Evidence Fabric.
 *
 * These tests are the falsifiable form of three canonical laws
 * (shared/architecture/canon.ts):
 *
 *   Law 2  every material assertion knows its evidence, provenance, freshness
 *          and uncertainty
 *   Law 3  unknown and conflict are valid states and must not be silently
 *          converted into certainty
 *   Law 6  historical decisions preserve what was known at the time
 *
 * Law 3 is the one this file guards hardest, because its failure mode is
 * invisible: a missing flood-zone lookup that quietly renders as "no flood
 * risk" is indistinguishable, on screen, from a real answer — and it is the
 * kind of fabrication scripts/check-no-fabrication.mjs exists to prevent but
 * cannot see, because no literal is invented; an absence is merely coerced.
 *
 * Every test injects `asOf` rather than reading a clock, which is also the
 * property that makes as-of reconstruction ("what did we believe on 3 March?")
 * a matter of passing a different date rather than a different code path.
 */

import { describe, it, expect } from "vitest";
import {
  PREDICATES,
  RESOLUTION_POLICY_VERSION,
  authorityRank,
  isKnownPredicate,
  predicateById,
  resolveAll,
  resolveClaims,
  type EvidenceAuthority,
  type EvidenceClaim,
} from "@shared/evidence/claim";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let nextId = 1;
function claim(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: nextId++,
    organizationId: 1,
    subjectType: "property",
    subjectId: 42,
    predicate: "property.zoning",
    value: "R-1",
    provider: "open-data",
    source: "County GIS",
    authority: "authoritative",
    observedAt: daysAgo(10),
    fetchedAt: daysAgo(10),
    providerConfidence: 90,
    license: "public-domain-usgov",
    costCents: 0,
    ...over,
  };
}

describe("predicate registry", () => {
  it("has unique ids and a coherent spec per predicate", () => {
    const ids = PREDICATES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PREDICATES) {
      expect(p.label.length, `${p.id} label`).toBeGreaterThan(3);
      // A dimensional number without a unit is exactly how acreage-in-acres and
      // acreage-in-square-feet end up compared to each other (BI182).
      if (p.kind === "number") {
        expect(p.unit, `${p.id} is numeric and must declare a unit`).toBeTruthy();
      }
      if (p.freshnessHorizonDays !== null) {
        expect(p.freshnessHorizonDays, `${p.id} horizon`).toBeGreaterThan(0);
      }
    }
  });

  it("ranks authority so a model output can never outrank a system of record", () => {
    const order: EvidenceAuthority[] = ["authoritative", "estimate", "modeled", "unknown"];
    for (let i = 1; i < order.length; i++) {
      expect(authorityRank(order[i - 1])).toBeGreaterThan(authorityRank(order[i]));
    }
    expect(authorityRank("unknown")).toBe(0);
  });

  it("recognises registered predicates and rejects invented ones", () => {
    expect(isKnownPredicate("property.zoning")).toBe(true);
    expect(isKnownPredicate("property.vibes")).toBe(false);
    expect(predicateById("parcel.acreage")?.unit).toBe("acres");
  });
});

describe("Law 3 — unknown is a valid state and is never coerced", () => {
  it("resolves to unknown when no source has been consulted", () => {
    const r = resolveClaims("property.flood_zone", [], NOW);
    expect(r.state).toBe("unknown");
    expect(r.value).toBeUndefined();
    expect(r.confidence).toBe("low");
    expect(r.factors.join(" ")).toMatch(/no source has been consulted/);
  });

  it("distinguishes 'never asked' from 'asked, no answer' — both stay unknown", () => {
    const askedNoAnswer = resolveClaims(
      "property.flood_zone",
      [claim({ predicate: "property.flood_zone", value: null, authority: "unknown" })],
      NOW,
    );
    expect(askedNoAnswer.state).toBe("unknown");
    expect(askedNoAnswer.factors.join(" ")).toMatch(/none returned a value/);
    // The two unknowns must not read identically — knowing we asked is itself
    // decision-relevant (it stops a workflow re-spending on the same lookup).
    expect(askedNoAnswer.factors).not.toEqual(
      resolveClaims("property.flood_zone", [], NOW).factors,
    );
  });

  it("never turns an absent boolean into false", () => {
    const r = resolveClaims("property.wetlands_present", [], NOW);
    expect(r.state).toBe("unknown");
    expect(r.value).not.toBe(false);
    expect(r.value).toBeUndefined();
  });

  it("never turns an absent number into zero", () => {
    const r = resolveClaims("property.assessed_value", [], NOW);
    expect(r.state).toBe("unknown");
    expect(r.value).not.toBe(0);
    expect(r.value).toBeUndefined();
  });

  it("refuses an unregistered predicate instead of guessing at it", () => {
    const r = resolveClaims("property.made_up", [claim({ predicate: "property.made_up" })], NOW);
    expect(r.state).toBe("unknown");
    expect(r.factors.join(" ")).toMatch(/not a registered predicate/);
  });
});

describe("Law 3 — conflict is a valid state and dissent is preserved", () => {
  it("reports conflict when two equally authoritative sources disagree", () => {
    const r = resolveClaims(
      "property.zoning",
      [
        claim({ value: "R-1", source: "County GIS" }),
        claim({ value: "A-2", source: "State Parcel Layer" }),
      ],
      NOW,
    );
    expect(r.state).toBe("conflict");
    expect(r.confidence).toBe("low");
    expect(r.candidates).toHaveLength(2);
    // Both values must survive — a silent pick is the failure BI139 forbids.
    expect(r.candidates.map((c) => c.value).sort()).toEqual(["A-2", "R-1"]);
    expect(r.factors.join(" ")).toMatch(/conflicting authoritative claim/);
  });

  it("does NOT call it a conflict when a system of record beats a model", () => {
    const r = resolveClaims(
      "property.zoning",
      [
        claim({ value: "R-1", authority: "authoritative", source: "County GIS" }),
        claim({ value: "A-2", authority: "modeled", source: "Zoning Model" }),
      ],
      NOW,
    );
    expect(r.state).toBe("known");
    expect(r.value).toBe("R-1");
    // The losing claim is still retained, so the lineage stays inspectable.
    expect(r.candidates).toHaveLength(2);
    expect(r.factors.join(" ")).toMatch(/lower-authority alternative/);
  });

  it("does not call it a conflict when the rival claim is itself stale", () => {
    const spec = predicateById("property.zoning")!;
    const r = resolveClaims(
      "property.zoning",
      [
        claim({ value: "R-1", observedAt: daysAgo(5), fetchedAt: daysAgo(5) }),
        claim({
          value: "A-2",
          observedAt: daysAgo(spec.freshnessHorizonDays! + 50),
          fetchedAt: daysAgo(spec.freshnessHorizonDays! + 50),
        }),
      ],
      NOW,
    );
    expect(r.state).toBe("known");
    expect(r.value).toBe("R-1");
  });

  it("treats numeric observations within tolerance as agreement, not conflict", () => {
    // parcel.acreage tolerates 0.02 acres — two GIS sources differing by 0.01
    // are not a disagreement worth interrupting a human for.
    const r = resolveClaims(
      "parcel.acreage",
      [
        claim({ predicate: "parcel.acreage", subjectType: "parcel", value: 10.0, source: "County GIS" }),
        claim({ predicate: "parcel.acreage", subjectType: "parcel", value: 10.01, source: "Regrid" }),
      ],
      NOW,
    );
    expect(r.state).toBe("known");
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].claims).toHaveLength(2);
  });

  it("still reports conflict when numeric observations exceed tolerance", () => {
    const r = resolveClaims(
      "parcel.acreage",
      [
        claim({ predicate: "parcel.acreage", subjectType: "parcel", value: 10.0, source: "County GIS" }),
        claim({ predicate: "parcel.acreage", subjectType: "parcel", value: 40.0, source: "Regrid" }),
      ],
      NOW,
    );
    expect(r.state).toBe("conflict");
    expect(r.candidates).toHaveLength(2);
  });
});

describe("Law 2 — provenance, freshness and explainable confidence", () => {
  it("grades confidence by authority, never by an invented percentage", () => {
    const byAuthority = (a: EvidenceAuthority) =>
      resolveClaims("property.zoning", [claim({ authority: a })], NOW).confidence;
    expect(byAuthority("authoritative")).toBe("high");
    expect(byAuthority("estimate")).toBe("medium");
    // A model output is never better than low confidence — it is not a fact.
    expect(byAuthority("modeled")).toBe("low");
  });

  it("downgrades a stale observation without deleting it", () => {
    const spec = predicateById("property.flood_zone")!;
    const old = daysAgo(spec.freshnessHorizonDays! + 10);
    const r = resolveClaims(
      "property.flood_zone",
      [claim({ predicate: "property.flood_zone", value: "AE", observedAt: old, fetchedAt: old })],
      NOW,
    );
    expect(r.state).toBe("known"); // still answerable
    expect(r.value).toBe("AE"); // still the answer
    expect(r.stale).toBe(true); // but flagged
    expect(r.confidence).toBe("low"); // and downgraded
    expect(r.factors.join(" ")).toMatch(/freshness horizon/);
  });

  it("never marks a fact stale when its predicate has no freshness horizon", () => {
    // A recorded legal description does not rot.
    expect(predicateById("parcel.legal_description")!.freshnessHorizonDays).toBeNull();
    const ancient = daysAgo(10_000);
    const r = resolveClaims(
      "parcel.legal_description",
      [
        claim({
          predicate: "parcel.legal_description",
          subjectType: "parcel",
          value: "LOT 4 BLK 2",
          observedAt: ancient,
          fetchedAt: ancient,
        }),
      ],
      NOW,
    );
    expect(r.stale).toBe(false);
    expect(r.confidence).toBe("high");
  });

  it("ages from fetchedAt when the source exposes no observation date", () => {
    const spec = predicateById("property.flood_zone")!;
    const old = daysAgo(spec.freshnessHorizonDays! + 10);
    const r = resolveClaims(
      "property.flood_zone",
      [
        claim({
          predicate: "property.flood_zone",
          value: "X",
          observedAt: null, // source gave us nothing
          fetchedAt: old,
        }),
      ],
      NOW,
    );
    expect(r.stale).toBe(true);
  });

  it("carries every contributing claim so the answer can be traced to a source", () => {
    const r = resolveClaims(
      "property.zoning",
      [claim({ source: "County GIS", provider: "open-data", license: "public-domain-usgov" })],
      NOW,
    );
    const winner = r.candidates[0].claims[0];
    expect(winner.source).toBe("County GIS");
    expect(winner.provider).toBe("open-data");
    expect(winner.license).toBe("public-domain-usgov");
    expect(r.factors.join(" ")).toContain("County GIS");
  });

  it("prefers the fresher claim when authority ties", () => {
    const r = resolveClaims(
      "property.zoning",
      [
        claim({ value: "OLD", observedAt: daysAgo(100), fetchedAt: daysAgo(100), source: "A" }),
        claim({ value: "NEW", observedAt: daysAgo(2), fetchedAt: daysAgo(2), source: "A" }),
      ],
      NOW,
    );
    // Same source re-observing is a correction, not a conflict between rivals —
    // but the policy treats equal-authority disagreement conservatively and
    // surfaces it. What must hold is that the FRESHER claim leads.
    expect(r.candidates[0].value).toBe("NEW");
  });
});

describe("Law 6 — as-of reconstruction", () => {
  it("ignores claims fetched after the as-of moment", () => {
    const claims = [
      claim({ value: "R-1", fetchedAt: daysAgo(30), observedAt: daysAgo(30) }),
      claim({ value: "C-2", fetchedAt: daysAgo(1), observedAt: daysAgo(1) }),
    ];
    // Today: two equally authoritative rivals, both visible → conflict.
    expect(resolveClaims("property.zoning", claims, NOW).state).toBe("conflict");
    // Ten days ago: the second claim did not exist yet → the answer we ACTED on.
    const past = resolveClaims("property.zoning", claims, daysAgo(10));
    expect(past.state).toBe("known");
    expect(past.value).toBe("R-1");
  });

  it("is deterministic — the same inputs always produce the same answer", () => {
    const claims = [
      claim({ value: "R-1", source: "County GIS" }),
      claim({ value: "R-1", source: "Regrid", authority: "estimate" }),
      claim({ value: "A-2", source: "Model", authority: "modeled" }),
    ];
    const a = resolveClaims("property.zoning", claims, NOW);
    const b = resolveClaims("property.zoning", [...claims].reverse(), NOW);
    expect(a.state).toBe(b.state);
    expect(a.value).toBe(b.value);
    expect(a.confidence).toBe(b.confidence);
    expect(a.candidates.map((c) => c.value)).toEqual(b.candidates.map((c) => c.value));
  });

  it("stamps the policy version on every answer so history stays reproducible", () => {
    const r = resolveClaims("property.zoning", [claim()], NOW);
    expect(r.policyVersion).toBe(RESOLUTION_POLICY_VERSION);
    expect(resolveClaims("property.zoning", [], NOW).policyVersion).toBe(
      RESOLUTION_POLICY_VERSION,
    );
  });
});

describe("resolveAll", () => {
  it("resolves each predicate independently and invents no others", () => {
    const out = resolveAll(
      [
        claim({ predicate: "property.zoning", value: "R-1" }),
        claim({ predicate: "property.flood_zone", value: "AE" }),
      ],
      NOW,
    );
    expect([...out.keys()].sort()).toEqual(["property.flood_zone", "property.zoning"]);
    expect(out.get("property.zoning")!.value).toBe("R-1");
    // Crucially: predicates with no claims are ABSENT from the map rather than
    // present-and-false. A caller must ask explicitly and receive `unknown`.
    expect(out.has("property.wetlands_present")).toBe(false);
    expect(resolveClaims("property.wetlands_present", [], NOW).state).toBe("unknown");
  });
});

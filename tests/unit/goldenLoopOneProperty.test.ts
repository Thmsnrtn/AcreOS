/**
 * THE GOLDEN LOOP — one complete property, end to end.
 *
 * Master Audit Section VII(A) asks for one property carried the whole way:
 * identity → evidence → provenance/conflict → strategy → economics → scenario →
 * DecisionSnapshot → outcome → learning. Every layer of that chain now exists
 * and every layer has its own green test file. That is exactly the condition
 * under which this repo's most common defect hides.
 *
 * CLAUDE.md names it: "built but unwired ... new route files never mounted, jobs
 * never registered, services with zero call sites". Per-layer tests cannot see
 * it, because each one builds its own fixture for the layer below. A test that
 * hand-writes a `FrozenScenarioRef` proves the decision layer reads the shape it
 * was handed — not that the scenario layer PRODUCES that shape. Between any two
 * green layers there can be a seam that nothing crosses.
 *
 * So the rule for this file: **every input comes from the previous layer's real
 * output.** Nothing is hand-built except the provider payload at the very top,
 * which is the only thing that genuinely originates outside the system. If a
 * layer's output cannot be fed to the next layer without translation, this test
 * does not compile — and that is the point.
 *
 * PURE BY CONSTRUCTION. Every canonical layer was deliberately written as a pure
 * isomorphic module (`shared/evidence/claim.ts`, `shared/economics/scenario.ts`,
 * `shared/decisions/snapshot.ts`, `shared/outcomes/outcome.ts`) with the I/O
 * pushed into thin stores. That decision is what lets the whole loop run here
 * with no database and no clock, in milliseconds, on every `npm test` — rather
 * than in an integration suite that only runs where DATABASE_URL is set.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { claimsFromEnrichment } from "../../server/services/evidence/enrichmentToClaims";
import type { EnrichmentResult } from "../../server/services/propertyEnrichment";
import {
  RESOLUTION_POLICY_VERSION,
  resolveAll,
  type EvidenceClaim,
  type EvidenceClaimInput,
} from "@shared/evidence/claim";
import { computeScenario, freezeScenarioRef } from "@shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { freezeDecision, describeFooting } from "@shared/decisions/snapshot";
import {
  buildOutcome,
  computeVariance,
  describeVariance,
} from "@shared/outcomes/outcome";

const ROOT = path.resolve(__dirname, "../..");

/** Fixed instants — the loop must be reproducible, so nothing reads a clock. */
const FETCHED_AT = new Date("2026-03-02T10:00:00Z");
const DECIDED_AT = new Date("2026-03-04T09:00:00Z");
const OBSERVED_AT = new Date("2027-01-20T00:00:00Z");

const PROPERTY_ID = 4242;

/**
 * The ONLY hand-built object in this file: what a provider actually returns.
 *
 * It is deliberately imperfect, in the two ways real payloads are. `wetlands`
 * carries a value with NO provenance entry, and `hazards.floodRisk` is a DERIVED
 * AcreOS score sitting right beside the raw flood zone. Both must be dropped by
 * the anti-corruption boundary, and the loop must survive their absence rather
 * than filling the holes.
 */
function providerPayload(): EnrichmentResult {
  return {
    propertyId: PROPERTY_ID,
    latitude: 30.12,
    longitude: -97.81,
    enrichedAt: FETCHED_AT,
    lookupTimeMs: 812,
    parcel: {
      apn: "R-118-4420-0031",
      owner: "Hollis Family Trust",
      acreage: 10.4,
      legalDescription: "ABS 118 SUR 44 TR 31, 10.40 AC",
      assessedValue: 38_500,
      taxAmount: 1_142,
    },
    hazards: {
      floodZone: "X",
      // DERIVED — AcreOS's own arithmetic over the raw layers. Must never
      // become evidence (BI177).
      floodRisk: "low",
      overallRiskScore: 22,
      // Raw, but its category has no provenance entry below — must be dropped.
      wetlandsPresent: false,
    },
    provenance: {
      parcel_data: { source: "Travis County CAD", asOf: "2025" },
      flood_zone: { source: "FEMA NFHL", asOf: "2024-11-04" },
      // NOTE: no `wetlands` entry. Rule 1 — no source, no claim.
    },
  } as EnrichmentResult;
}

/**
 * Assign ids the way the store does, so downstream sees `EvidenceClaim` (with
 * identity) rather than `EvidenceClaimInput`. This is the ONE thing the database
 * contributes to the pure chain, and it is a counter.
 */
function persist(inputs: EvidenceClaimInput[]): EvidenceClaim[] {
  return inputs.map((c, i) => ({ ...c, id: 1000 + i, organizationId: 7 }));
}

// ── The loop, run once, shared by every assertion below ─────────────────────

/** Stage 1–2: provider payload → attributed claims → resolved beliefs. */
const claims = persist(claimsFromEnrichment(PROPERTY_ID, providerPayload()));
const resolved = resolveAll(claims, DECIDED_AT);

/** Stage 3: the economics, computed from a REGISTERED engine. */
const scenarioBody = computeScenario(
  {
    subjectType: "property",
    subjectId: PROPERTY_ID,
    label: "Base case — retail resale at 9 months",
    engineId: "land_deal",
    inputs: {
      purchaseCents: 3_200_000,
      closingAtBuyCents: 38_000,
      holdingPerMonthCents: 9_500,
      holdMonths: 9,
      marketingCents: 120_000,
      salePriceCents: 5_950_000,
      closingAtSaleCents: 178_500,
    },
  },
  ALL_ENGINES,
);
const scenarioRef = freezeScenarioRef(501, scenarioBody);

/** Stage 4: the decision, frozen over the evidence AND the economics. */
const decision = freezeDecision(
  {
    subjectType: "property",
    subjectId: PROPERTY_ID,
    kind: "offer",
    choice: "Offer $32,000 cash, 14-day close",
    rationale:
      "Flood zone X and a clean CAD record; priced to the base case with the " +
      "wetlands question still open.",
    actorType: "user",
    actorRef: "91",
    authority: "owner",
    strategyPackId: null,
    strategyPackVersion: null,
    assumptions: [
      {
        key: "retail_resale_price",
        value: 5_950_000,
        unit: "cents",
        origin: "user",
        basis: "Three comparable 10-acre tracts closed 2025-Q4.",
      },
    ],
    alternatives: [
      { choice: "Offer $38,500 (assessed)", reason: "Leaves no margin at the base case." },
    ],
  },
  resolved,
  DECIDED_AT,
  [scenarioRef],
);

/** Stage 5: what actually happened, ten months later. */
const outcome = buildOutcome({
  decisionSnapshotId: 88,
  subjectType: "property",
  subjectId: PROPERTY_ID,
  kind: "sold",
  summary: "Sold to an adjacent owner at $54,000 after a 10-month hold.",
  actuals: [
    { id: "profit", value: 1_640_000 },
    { id: "hold_months", value: 10 },
    // Deliberately NOT measured — the loop must keep saying so.
    { id: "irr", value: null },
  ],
});

/** Stage 6: learning — a projection over what the decision FROZE. */
const variance = computeVariance(outcome, decision.scenarios);

// ───────────────────────────────────────────────────────────────────────────

describe("the loop connects — each layer consumes the previous layer's real output", () => {
  it("carries one property identity from the provider payload to the variance", () => {
    // The single most valuable assertion in this file. If any seam silently
    // re-keyed the subject, the chain would still be green per-layer and would
    // be comparing two different parcels.
    expect(new Set(claims.map((c) => c.subjectId))).toEqual(new Set([PROPERTY_ID]));
    expect(scenarioBody.subjectId).toBe(PROPERTY_ID);
    expect(decision.subjectId).toBe(PROPERTY_ID);
    expect(outcome.subjectId).toBe(PROPERTY_ID);
  });

  it("the decision's evidence came from resolveAll, not from a fixture", () => {
    // Every frozen predicate must be one the resolver actually produced from
    // the provider payload above.
    const resolvedPredicates = new Set(resolved.keys());
    expect(decision.evidence.length).toBeGreaterThan(0);
    for (const fact of decision.evidence) {
      expect(resolvedPredicates.has(fact.predicate), fact.predicate).toBe(true);
    }
  });

  it("the frozen claim ids trace back to real claims", () => {
    const realIds = new Set(claims.map((c) => c.id));
    const cited = decision.evidence.flatMap((f) => f.claimIds);
    expect(cited.length).toBeGreaterThan(0);
    for (const id of cited) expect(realIds.has(id)).toBe(true);
  });

  it("the decision's scenario ref came from freezeScenarioRef over a computed body", () => {
    expect(decision.scenarios).toHaveLength(1);
    expect(decision.scenarios[0].engineId).toBe(scenarioBody.engineId);
    expect(decision.scenarios[0].engineVersion).toBe(scenarioBody.engineVersion);
    // The values are the engine's, not a hand-written pair.
    const frozenProfit = decision.scenarios[0].predicted.find((m) => m.id === "profit")!;
    const computedProfit = scenarioBody.metrics.find((m) => m.id === "profit")!;
    expect(frozenProfit.value).toBe(computedProfit.value);
  });

  it("the variance compares against the DECISION's frozen economics", () => {
    const profit = variance.find((v) => v.metricId === "profit")!;
    expect(profit.state).toBe("compared");
    expect(profit.predicted).toBe(
      scenarioBody.metrics.find((m) => m.id === "profit")!.value,
    );
    expect(profit.actual).toBe(1_640_000);
  });

  it("closes: every stage is represented in the final record", () => {
    expect(claims.length).toBeGreaterThan(0);          // evidence
    expect(scenarioBody.metrics.length).toBeGreaterThan(0); // economics
    expect(decision.evidence.length).toBeGreaterThan(0);    // decision
    expect(variance.length).toBeGreaterThan(0);             // learning
  });
});

describe("what the provider offered and the boundary refused", () => {
  it("drops a value whose category has no named source", () => {
    // wetlandsPresent is present and raw, but `provenance.wetlands` is absent.
    // No source, no claim — and no silent attribution to the adapter.
    expect(claims.some((c) => c.predicate === "property.wetlands_present")).toBe(false);
  });

  it("never records a DERIVED AcreOS score as evidence", () => {
    // floodRisk and overallRiskScore are this system's own arithmetic over the
    // raw layers. If they became claims, a derived score would end up as the
    // only surviving fact (BI177).
    for (const c of claims) {
      expect(c.predicate).not.toMatch(/risk/i);
      expect(c.predicate).not.toMatch(/score/i);
    }
    expect(claims.some((c) => c.predicate === "property.flood_zone")).toBe(true);
  });

  it("the refusal survives all the way into the decision as an UNKNOWN", () => {
    // This is the assertion that makes the whole boundary worth having. A
    // dropped value must not vanish quietly — it has to reach the record a human
    // reads two years later. Nothing anywhere in the chain converted the absent
    // wetlands answer into `false`.
    const frozenPredicates = new Set(decision.evidence.map((f) => f.predicate));
    expect(frozenPredicates.has("property.wetlands_present")).toBe(false);
    for (const fact of decision.evidence) {
      if (fact.state !== "known") expect(fact).not.toHaveProperty("value");
    }
  });

  it("keeps a bare-year asOf from reading fresher than it is", () => {
    // The CAD payload says "2025" — widened to Jan 1, the earliest instant it
    // could mean, so a fact never reads newer than the source supports.
    const apn = claims.find((c) => c.predicate === "parcel.apn")!;
    expect(apn.observedAt).toEqual(new Date(Date.UTC(2025, 0, 1)));
    expect(apn.source).toBe("Travis County CAD");
  });
});

describe("the record is honest about what it did not know", () => {
  it("leads the footing with what was NOT known, and carries the staleness", () => {
    // A footing sentence that opens with confidence and buries the gaps is how
    // a thin record reads as a thorough one. Every claim here came from a 2025
    // CAD payload resolved in 2026, so four of the seven are genuinely stale and
    // the record must say so rather than presenting them as current.
    const footing = describeFooting(decision);
    expect(footing).toMatch(/^\d+ stale/);
    expect(footing).toContain("7 known fact(s) at decision time");
    expect(footing).toContain("1 scenario(s)");
    expect(decision.resolutionPolicyVersion).toBe(RESOLUTION_POLICY_VERSION);
  });

  it("keeps a predicted-but-unmeasured metric visible in the variance", () => {
    // irr was predicted by the engine and explicitly not measured. Dropping it
    // is how "we predicted eight things and checked two" reads as a clean
    // scorecard.
    const irr = variance.find((v) => v.metricId === "irr")!;
    expect(irr.state).toBe("unmeasured");
    expect(irr.delta).toBeUndefined();
  });

  it("compares hold_months — the regression this whole file was written to catch", () => {
    // THE DEFECT THIS TEST FOUND. `freezeScenarioRef` used to keep only three
    // "headline" ids, so the land engine's 9-month hold forecast never reached
    // the decision, and this metric came back "unpredicted" — a claim about the
    // decision that was FALSE. The property sold at 10 months, so the real
    // signal (one month late) was being silently discarded.
    //
    // No per-layer test could see it: each hand-built the fixture for the layer
    // below, so the frozen ref was always assumed to contain whatever the test
    // needed. The loss only appears when a real engine's output is carried all
    // the way to a real variance.
    const hold = variance.find((v) => v.metricId === "hold_months")!;
    expect(hold.state).toBe("compared");
    expect(hold.predicted).toBe(9);
    expect(hold.actual).toBe(10);
    // hold_months is higherIsBetter:false — a longer hold is not better.
    expect(hold.better).toBe(false);
  });

  it("every metric the engine predicted survives into the decision", () => {
    // The general form of the same rule, so a future engine cannot reintroduce
    // the loss for a different metric.
    const engineMetricIds = scenarioBody.metrics.map((m) => m.id).sort();
    const frozenIds = decision.scenarios[0].predicted.map((m) => m.id).sort();
    expect(frozenIds).toEqual(engineMetricIds);
  });

  it("the learning summary never says the decision was right or wrong", () => {
    const line = describeVariance(variance);
    for (const word of ["good", "bad", "wrong", "correct", "mistake", "should have"]) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });
});

describe("the loop is reproducible", () => {
  it("produces byte-identical output from the same payload and instants", () => {
    // Nothing in the chain reads a clock or a random source. This is what makes
    // a stored decision defensible: re-running it must yield the same record.
    const again = persist(claimsFromEnrichment(PROPERTY_ID, providerPayload()));
    const againResolved = resolveAll(again, DECIDED_AT);
    expect(JSON.stringify([...againResolved.entries()])).toBe(
      JSON.stringify([...resolved.entries()]),
    );

    const againScenario = computeScenario(
      {
        subjectType: "property",
        subjectId: PROPERTY_ID,
        label: "Base case — retail resale at 9 months",
        engineId: "land_deal",
        inputs: {
          purchaseCents: 3_200_000,
          closingAtBuyCents: 38_000,
          holdingPerMonthCents: 9_500,
          holdMonths: 9,
          marketingCents: 120_000,
          salePriceCents: 5_950_000,
          closingAtSaleCents: 178_500,
        },
      },
      ALL_ENGINES,
    );
    expect(JSON.stringify(againScenario)).toBe(JSON.stringify(scenarioBody));
  });

  it("re-resolving at an EARLIER instant reconstructs what was believed then", () => {
    // As-of reconstruction is a matter of passing a different date, not a
    // different code path — the property that makes a historical decision
    // auditable at all.
    const before = resolveAll(claims, new Date("2026-03-01T00:00:00Z"));
    for (const [, r] of before) expect(r.state).toBe("unknown");
  });
});

describe("the loop is WIRED, not merely computable", () => {
  it("every layer has a persistence store with no update and no delete", () => {
    // The pure chain above proves the layers compose. It cannot prove they are
    // reachable, so the wiring is asserted separately — this repo's most common
    // defect is a correct thing nothing calls.
    const stores = [
      "server/services/evidence/evidenceStore.ts",
      "server/services/economics/scenarioStore.ts",
      "server/services/decisions/decisionStore.ts",
      "server/services/outcomes/outcomeStore.ts",
    ];
    for (const rel of stores) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/db\s*\.\s*update\(/);
      expect(src, rel).not.toMatch(/db\s*\.\s*delete\(/);
    }
  });

  it("every layer's table is created by the release migration", () => {
    // A table in the Drizzle schema with no CREATE in scripts/migrate.mjs 500s
    // on deploy — a defect this repo has shipped before.
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    for (const table of ["evidence_claims", "scenarios", "decision_snapshots", "outcomes"]) {
      expect(migrate, table).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("every layer has a mounted HTTP surface, behind auth AND org scoping", () => {
    // Mounting is only half of it. A canonical-layer route mounted without
    // `getOrCreateOrg` would read whatever org the handler inferred, and every
    // one of these tables is tenant-scoped — so the middleware is asserted with
    // the mount rather than separately.
    const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    const mounts: Array<[string, string]> = [
      // Evidence is read through the property surface (GET /:id/evidence).
      ["/api/properties", "propertyEnrichmentRouter"],
      ["/api/scenarios", "scenariosRouter"],
      ["/api/decisions", "decisionsRouter"],
    ];
    for (const [prefix, router] of mounts) {
      const mount = new RegExp(
        `app\\.use\\(\\s*['"]${prefix}['"]\\s*,\\s*isAuthenticated\\s*,\\s*getOrCreateOrg\\s*,\\s*${router}\\s*\\)`,
      );
      expect(routes, `${prefix} → ${router}`).toMatch(mount);
    }
    // Outcomes deliberately have NO prefix of their own: an outcome is recorded
    // against a decision and lives under /api/decisions, so it cannot be filed
    // without one (outcomeStore reads the subject FROM the decision).
    const decisionRoutes = fs.readFileSync(
      path.join(ROOT, "server/routes-decisions.ts"),
      "utf8",
    );
    expect(decisionRoutes).toContain("recordOutcome");
  });
});

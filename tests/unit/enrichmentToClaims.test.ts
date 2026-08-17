/**
 * The provider → Evidence Fabric anti-corruption boundary.
 *
 * These tests pin the two rules that make the boundary trustworthy, and one
 * wiring assertion that stops the whole layer from becoming this repo's most
 * common defect — "built but unwired" (CLAUDE.md, wave discipline #3).
 *
 *   Rule 1  NO SOURCE, NO CLAIM. A value with no named provenance is not
 *           evidence; it is the unattributed field the Evidence Fabric exists
 *           to abolish.
 *   Rule 2  RAW FACTS ONLY. Derived scores (floodRisk, overallRiskScore,
 *           accessScore) are AcreOS's own arithmetic, not observations. Letting
 *           one become an evidence-backed claim is exactly the failure BI177
 *           forbids.
 *
 * The mapping is asserted against the REAL EnrichmentResult shape. If someone
 * renames a field the adapter reads, tsc catches it; if someone removes the
 * provenance plumbing, these tests catch it.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { claimsFromEnrichment } from "../../server/services/evidence/enrichmentToClaims";
import type { EnrichmentResult } from "../../server/services/propertyEnrichment";
import { isKnownPredicate, resolveClaims, type EvidenceClaim } from "@shared/evidence/claim";

const ROOT = path.resolve(__dirname, "../..");
const FETCHED = new Date("2026-08-12T00:00:00.000Z");

function enrichment(over: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    latitude: 30.1,
    longitude: -97.8,
    enrichedAt: FETCHED,
    lookupTimeMs: 120,
    ...over,
  } as EnrichmentResult;
}

/** Promote adapter output to persisted-claim shape for resolution assertions. */
function asStored(inputs: ReturnType<typeof claimsFromEnrichment>): EvidenceClaim[] {
  return inputs.map((c, i) => ({ ...c, id: i + 1, organizationId: 1 }));
}

describe("rule 1 — no source, no claim", () => {
  it("emits nothing when values exist but nothing is attributed", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        hazards: { floodZone: "AE", wetlandsPresent: true },
        environment: { soilType: "Houston Black" },
        // provenance deliberately absent — the broker attributed nothing
      }),
    );
    expect(claims).toEqual([]);
  });

  it("emits only the categories that carry named provenance", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        hazards: { floodZone: "AE", wetlandsPresent: true },
        environment: { soilType: "Houston Black" },
        provenance: {
          flood_zone: { source: "FEMA NFHL", asOf: "2024", fromCache: false },
          // `wetlands` and `soil` attributed nothing.
        },
      }),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].predicate).toBe("property.flood_zone");
    expect(claims[0].source).toBe("FEMA NFHL");
  });

  it("names a real source on every claim it does emit", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        parcel: { apn: "R12345", acreage: 10.5, owner: "ACME LLC" },
        provenance: {
          parcel_data: { source: "Travis County GIS", asOf: null, fromCache: false },
        },
      }),
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(c.source.length, "every claim must name its source").toBeGreaterThan(0);
      expect(c.provider.length).toBeGreaterThan(0);
      expect(isKnownPredicate(c.predicate), `${c.predicate} must be registered`).toBe(true);
    }
  });
});

describe("rule 2 — raw facts only, never derived scores", () => {
  it("does not turn a derived risk grade into evidence", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        hazards: {
          floodZone: "AE", // raw observation — becomes a claim
          floodRisk: "high", // AcreOS's own grading — must NOT
          overallRiskScore: 72, // AcreOS's own score — must NOT
          overallRiskLevel: "high",
        },
        scores: { accessScore: 81 } as EnrichmentResult["scores"],
        provenance: {
          flood_zone: { source: "FEMA NFHL", asOf: "2024-01-01", fromCache: false },
        },
      }),
    );
    const predicates = claims.map((c) => c.predicate);
    expect(predicates).toContain("property.flood_zone");
    for (const p of predicates) {
      expect(p, "a derived score must never become a claim").not.toMatch(
        /risk|score|grade/i,
      );
    }
  });
});

describe("honest value handling", () => {
  it("keeps a tri-state unknown unknown instead of recording 'not served'", () => {
    // FCC broadband `served` is genuinely null when the map has no answer.
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        broadband: {
          served: null,
          maxDownMbps: null,
          source: "FCC National Broadband Map",
        },
      }),
    );
    expect(claims.find((c) => c.predicate === "property.broadband_served")).toBeUndefined();
    // …and resolution therefore reports unknown, not false.
    expect(resolveClaims("property.broadband_served", [], FETCHED).state).toBe("unknown");
  });

  it("records a genuine false as a claim — false is an answer, null is not", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        broadband: { served: false, source: "FCC National Broadband Map" },
      }),
    );
    const c = claims.find((x) => x.predicate === "property.broadband_served");
    expect(c).toBeDefined();
    expect(c!.value).toBe(false);
    const r = resolveClaims("property.broadband_served", asStored([c!]), FETCHED);
    expect(r.state).toBe("known");
    expect(r.value).toBe(false);
  });

  it("widens a bare year to January 1 so a fact never reads fresher than it is", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        hazards: { floodZone: "X" },
        provenance: { flood_zone: { source: "FEMA NFHL", asOf: "2019", fromCache: false } },
      }),
    );
    expect(claims[0].observedAt?.toISOString()).toBe("2019-01-01T00:00:00.000Z");
  });

  it("falls back to null observedAt on an unparseable date, never to now()", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        hazards: { floodZone: "X" },
        provenance: {
          flood_zone: { source: "FEMA NFHL", asOf: "sometime recently", fromCache: false },
        },
      }),
    );
    expect(claims[0].observedAt).toBeNull();
    // Resolution then ages conservatively from fetchedAt.
    expect(claims[0].fetchedAt).toEqual(FETCHED);
  });

  it("routes cadastral facts to the parcel subject and economics to the property", () => {
    const claims = claimsFromEnrichment(
      7,
      enrichment({
        parcel: { apn: "R1", acreage: 10, assessedValue: 50_000 },
        provenance: { parcel_data: { source: "County GIS", asOf: null, fromCache: false } },
      }),
    );
    const bySubject = Object.fromEntries(claims.map((c) => [c.predicate, c.subjectType]));
    expect(bySubject["parcel.apn"]).toBe("parcel");
    expect(bySubject["parcel.acreage"]).toBe("parcel");
    expect(bySubject["property.assessed_value"]).toBe("property");
  });
});

describe("end to end — claims resolve to a traceable answer", () => {
  it("produces an answer whose provenance points back at the source", () => {
    const claims = asStored(
      claimsFromEnrichment(
        7,
        enrichment({
          hazards: { floodZone: "AE" },
          provenance: {
            flood_zone: { source: "FEMA NFHL", asOf: "2026-01-01", fromCache: false },
          },
        }),
      ),
    );
    const r = resolveClaims("property.flood_zone", claims, FETCHED);
    expect(r.state).toBe("known");
    expect(r.value).toBe("AE");
    expect(r.confidence).toBe("high");
    expect(r.factors.join(" ")).toContain("FEMA NFHL");
  });
});

describe("wiring — the layer is reached, not merely present", () => {
  // This repo's most common defect is a service with zero call sites
  // (CLAUDE.md, wave discipline #3). Grep for the call site rather than trust
  // that the import exists.
  it("propertyEnrichment records claims on every persisted enrichment", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/propertyEnrichment.ts"),
      "utf8",
    );
    expect(src).toContain("claimsFromEnrichment");
    expect(src).toContain("recordClaims");
    // It must sit inside the persistence path, not in a dead helper.
    const save = src.slice(src.indexOf("private async savePropertyEnrichment"));
    expect(save.slice(0, 4000)).toContain("recordClaims");
  });

  it("the evidence schema is exported from the shared barrel", () => {
    const barrel = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    expect(barrel).toContain('export * from "./schema/evidence"');
  });

  it("the table has a migration — a schema table without one 500s on deploy", () => {
    const sql = fs.readFileSync(
      path.join(ROOT, "migrations/0227_evidence_claims.sql"),
      "utf8",
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "evidence_claims"');
    // …and is mirrored into the path that actually runs on deploy.
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS "evidence_claims"');
  });

  it("the claims table is append-only — no updatedAt column to rewrite history", () => {
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema/evidence.ts"), "utf8");
    // Match column DECLARATIONS, not prose — the file's own comments explain
    // why the column is absent, and a naive substring match would trip on that.
    expect(schema).not.toMatch(/updatedAt\s*:\s*timestamp\(/);
    expect(schema).not.toMatch(/timestamp\(\s*"updated_at"/);
    const store = fs.readFileSync(
      path.join(ROOT, "server/services/evidence/evidenceStore.ts"),
      "utf8",
    );
    // A store that can update a claim is a store whose history can be rewritten.
    expect(store).not.toMatch(/db\s*\.\s*update\(\s*evidenceClaims/);
    expect(store).not.toMatch(/db\s*\.\s*delete\(\s*evidenceClaims/);
  });
});

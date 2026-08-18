/**
 * Authority belongs to the source, not to the transport.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `enrichmentToClaims` is the one place a provider-shaped `EnrichmentResult`
 * becomes AcreOS evidence. It stamped every claim with a single module constant
 * — `BROKER_AUTHORITY = "authoritative"` — justified as "open government layers
 * are systems of record for the facts they publish". True of most of them. The
 * constant named the PIPE rather than the publisher, so it could not express
 * the case where it is not.
 *
 * One category is not. The FCC Broadband Data Collection is the federal system
 * of record for availability FILINGS, but the coverage it publishes is
 * ISP-SELF-REPORTED and known to overstate service. The repository already knew
 * this: `landProfile.ts` scores it 75, below county GIS at 80, and says so in a
 * comment. The evidence layer contradicted that assessment in the same repo.
 *
 * And `authorityRank` in `@shared/evidence/claim` ranks `authoritative` (3)
 * above `estimate` (2), with resolution taking the higher — so a carrier's own
 * filing about its own coverage did not merely read as overconfident, it WON
 * against an honest estimate of the same fact.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §17 — an assertion is not canonical truth. Second application, after
 * the landProfile source labels: there the assertion was where a value came
 * from, here it is how far the source may be trusted.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { claimsFromEnrichment } from "../../server/services/evidence/enrichmentToClaims";
import { authorityRank, type EvidenceAuthority } from "../../shared/evidence/claim";
import type { EnrichmentResult } from "../../server/services/propertyEnrichment";

/** The broker's own label for the category, from providers/open-data-provider.ts. */
const FCC_LABEL = "FCC Broadband Data Collection";

/**
 * Everything here runs through `claimsFromEnrichment`, the function production
 * calls — not through the source→authority helper directly, which is module
 * private. An earlier draft exported it so these assertions could call it, and
 * the reachability gate named that shape: a symbol whose only consumer is its
 * own test. Asserting on emitted claims is also the stronger check, because it
 * catches an emission site that hardcodes an authority instead of deriving one.
 */
function authorityOf(source: string, predicate: string): EvidenceAuthority | undefined {
  const enrichment = {
    latitude: 39.7,
    longitude: -104.9,
    enrichedAt: new Date("2026-08-01T00:00:00Z"),
    lookupTimeMs: 5,
    hazards: { floodZone: "AE" },
    provenance: { flood_zone: { source, asOf: null, fromCache: false } },
  } as unknown as EnrichmentResult;
  return claimsFromEnrichment(1, enrichment).find((c) => c.predicate === predicate)?.authority;
}

/** The flood predicate is a convenient carrier: one claim, any source label. */
const asFloodSource = (source: string) => authorityOf(source, "property.flood_zone");

describe("a self-reported source is not an authoritative one", () => {
  it("THE FCC BROADBAND FILING IS AN ESTIMATE, NOT A SYSTEM-OF-RECORD OBSERVATION", () => {
    expect(asFloodSource(FCC_LABEL)).toBe("estimate");
  });

  it("and that demotion actually costs it the argument", () => {
    // The consequence, read at the mechanism that consumes it. Asserting the
    // string alone would not show that anything changed downstream.
    expect(authorityRank(asFloodSource(FCC_LABEL)!))
      .toBeLessThan(authorityRank(asFloodSource("FEMA NFHL")!));
  });

  it("genuine systems of record keep their authority", () => {
    // Vacuity guard. Every assertion above is satisfied by a function that
    // returns "estimate" for everything, which would silently strip the
    // evidence layer of the authority it exists to record.
    for (const s of [
      "FEMA NFHL",
      "USDA SSURGO",
      "USFWS NWI",
      "USGS 3DEP",
      "BLM PLSS",
      "Denver County Assessor",
      "USFS Wildfire Hazard Potential",
    ]) {
      expect(asFloodSource(s), s).toBe("authoritative");
    }
  });

  it("THE DEMOTION IS NOT DECORATIVE — it matches the label the broker really emits", () => {
    // A demotion pattern that matches nothing demotes nothing while reading, in
    // review, exactly like one that works. `FCC_LABEL` is not a string invented
    // for this test: it is the value of SOURCE_LABELS.broadband in
    // server/services/providers/open-data-provider.ts, asserted below.
    const labels = fs.readFileSync(
      path.resolve(__dirname, "../../server/services/providers/open-data-provider.ts"),
      "utf8",
    );
    expect(labels, "the broker renamed its broadband source label").toContain(`broadband: "${FCC_LABEL}"`);
    expect(asFloodSource(FCC_LABEL)).toBe("estimate");
  });
});

describe("every emitted claim derives its authority from its own source", () => {
  const enrichment = {
    latitude: 39.7,
    longitude: -104.9,
    enrichedAt: new Date("2026-08-01T00:00:00Z"),
    lookupTimeMs: 5,
    hazards: { floodZone: "AE" },
    broadband: { served: true, maxDownMbps: 100, source: FCC_LABEL },
    wildfireHazard: { whpLabel: "moderate", source: "USFS Wildfire Hazard Potential" },
    provenance: {
      flood_zone: { source: "FEMA NFHL", asOf: "2024-06-01", fromCache: false },
    },
  } as unknown as EnrichmentResult;

  const claims = claimsFromEnrichment(1, enrichment);

  it("NO emission site hardcodes an authority — change the source, the authority follows", () => {
    // The derivation proof. If a site pasted a literal authority, relabelling
    // its source would change nothing. Both broadband claims are probed,
    // because the old code demoted neither and a partial fix would leave one.
    const withSource = (source: string) =>
      claimsFromEnrichment(1, {
        latitude: 39.7,
        longitude: -104.9,
        enrichedAt: new Date("2026-08-01T00:00:00Z"),
        lookupTimeMs: 5,
        broadband: { served: true, maxDownMbps: 100, source },
        provenance: {},
      } as unknown as EnrichmentResult).filter((c) => c.predicate.startsWith("property.broadband"));

    const selfReported = withSource(FCC_LABEL);
    const systemOfRecord = withSource("FEMA NFHL");

    expect(selfReported.length).toBe(2);
    expect(systemOfRecord.length).toBe(2);
    for (const c of selfReported) expect(c.authority, c.predicate).toBe("estimate");
    for (const c of systemOfRecord) expect(c.authority, c.predicate).toBe("authoritative");
  });

  it("the broadband claims specifically come out as estimates", () => {
    const bb = claims.filter((c) => c.predicate.startsWith("property.broadband"));
    expect(bb.length, "the broadband claims stopped being emitted at all").toBe(2);
    for (const c of bb) expect(c.authority).toBe("estimate");
  });

  it("the flood claim from FEMA is still authoritative", () => {
    const flood = claims.find((c) => c.predicate === "property.flood_zone");
    expect(flood?.source).toBe("FEMA NFHL");
    expect(flood?.authority).toBe("authoritative");
  });
});

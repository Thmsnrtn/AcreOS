/**
 * A real value wearing the wrong source label is a fabricated provenance.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `landProfile.ts` opens with an honesty contract: "we NEVER fabricate a value.
 * If a field cannot be honestly populated it is OMITTED." That contract covers
 * the VALUE and says nothing about where it came from, which left the more
 * dangerous half open.
 *
 * Two fields take their value from the county parcel OR from the customer's own
 * property record. `LandField.source` is documented as "what the provenance chip
 * shows the customer", `asOf` as "the date the AUTHORITATIVE source last updated
 * this fact", and `confidence` is DERIVED from the source label
 * (`/county|assessor|gis/i` → 80). So a mislabel is not cosmetic: it publishes a
 * customer-typed value to that customer as an authoritative county record, dated
 * to the county's refresh, at 80% confidence.
 *
 *   - `legalDescription` used `parcel.legalDescription ?? property.legalDescription`
 *     under an unconditional "County GIS" / "authoritative".
 *   - `acreage` DID branch its label and classification — the author knew the
 *     rule — but still passed `prov["parcel_data"]` unconditionally, and
 *     `field()` prefers `prov.source` over `fallbackSource`. When a parcel
 *     lookup returned provenance but no acreage, the owner's own number was
 *     published with the county's source, confidence and date. The site that
 *     looked correct was wrong in a narrower window than the one that looked
 *     wrong, which is why the fix is a helper rather than two edits.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §17 — an assertion is not canonical truth. Here the assertion is the
 * source label, and nothing checked it against the value it described.
 */

import { describe, it, expect } from "vitest";
import { assembleLandProfile } from "../../server/services/landProfile";
import type { EnrichmentResult } from "../../server/services/propertyEnrichment";
import { LAND_PROFILE_FIELD_ORDER } from "../../shared/landProfile";

/** Distinguishable on sight, so a mislabel is legible in the failure message. */
const OWNER_LEGAL = "OWNER-TYPED: LOT 4 BLK 2 SUNRISE ADDN";
const COUNTY_LEGAL = "COUNTY-RECORD: SEC 12 T4N R7W";
const OWNER_ACRES = "40.5";
const COUNTY_ACRES = 38.25;

const property = (over: Record<string, unknown> = {}) => ({
  id: 1,
  latitude: "39.7392",
  longitude: "-104.9903",
  sizeAcres: OWNER_ACRES,
  legalDescription: OWNER_LEGAL,
  ...over,
}) as Parameters<typeof assembleLandProfile>[0];

/**
 * A parcel lookup that RAN and returned provenance. This is the state that
 * makes the acreage defect reachable: provenance present, the parcel's own
 * value absent, so the owner's value flows out under the county's banner.
 */
const enrichment = (parcel: Record<string, unknown> | undefined): EnrichmentResult =>
  ({
    latitude: 39.7392,
    longitude: -104.9903,
    enrichedAt: new Date("2026-08-01T00:00:00Z"),
    lookupTimeMs: 12,
    parcel,
    provenance: {
      parcel_data: { source: "Denver County Assessor", asOf: "2025-01-01", fromCache: false },
    },
  }) as unknown as EnrichmentResult;

describe("a customer-entered value is never labelled as county data", () => {
  it("A LEGAL DESCRIPTION THE CUSTOMER TYPED IS NOT AN AUTHORITATIVE COUNTY RECORD", () => {
    const profile = assembleLandProfile(property(), enrichment({ apn: "123" }), false);
    const legal = profile.legalDescription;

    expect(legal?.value).toBe(OWNER_LEGAL);
    expect(legal?.source, "the customer's own text was attributed to the county").toBe("Owner-entered");
    expect(legal?.classification).toBe("estimate");
    expect(
      legal?.asOf,
      "a customer-typed value was dated to the county's last refresh",
    ).toBeNull();
  });

  it("AN OWNER'S ACREAGE KEEPS THE COUNTY'S CONFIDENCE WHEN THE PARCEL LOOKUP RETURNED NO ACREAGE", () => {
    // The narrow window: provenance present, acreage absent. The old code
    // branched `fallbackSource` correctly and then never consulted it, because
    // `field()` prefers `prov.source`.
    const profile = assembleLandProfile(property(), enrichment({ apn: "123" }), false);
    const acreage = profile.acreage;

    expect(acreage?.value).toBe(40.5);
    expect(acreage?.source).toBe("Owner-entered");
    expect(acreage?.classification).toBe("estimate");
    expect(acreage?.asOf).toBeNull();
    expect(
      acreage?.confidence,
      "the owner's number inherited the county's 80% confidence, which is derived from the source label",
    ).not.toBe(80);
  });

  it("the county's own values still carry the county's provenance", () => {
    // Vacuity guard with teeth. Every assertion above is satisfied by a helper
    // that labels EVERYTHING "Owner-entered", which would destroy the real
    // provenance the profile exists to publish.
    const profile = assembleLandProfile(
      property(),
      enrichment({ acreage: COUNTY_ACRES, legalDescription: COUNTY_LEGAL }),
      false,
    );

    expect(profile.acreage?.value).toBe(COUNTY_ACRES);
    expect(profile.acreage?.source).toBe("Denver County Assessor");
    expect(profile.acreage?.classification).toBe("authoritative");
    expect(profile.acreage?.asOf).toBe("2025-01-01");

    expect(profile.legalDescription?.value).toBe(COUNTY_LEGAL);
    expect(profile.legalDescription?.source).toBe("Denver County Assessor");
    expect(profile.legalDescription?.classification).toBe("authoritative");
  });

  it("falls back to the declared source name when the lookup carried no provenance", () => {
    // The other branch of `field()`: a parcel value with no provenance entry
    // still deserves the county label, because it did come from the parcel.
    const bare = {
      latitude: 39.7392,
      longitude: -104.9903,
      enrichedAt: new Date(),
      lookupTimeMs: 1,
      parcel: { acreage: COUNTY_ACRES },
      provenance: {},
    } as unknown as EnrichmentResult;

    const profile = assembleLandProfile(property(), bare, false);
    expect(profile.acreage?.source).toBe("County GIS");
    expect(profile.acreage?.classification).toBe("authoritative");
  });
});

describe("the general rule, swept across the whole profile", () => {
  /**
   * The invariant the two fixes are instances of: NO field may be published as
   * `authoritative` while carrying a value the customer supplied. Stated over
   * the assembled profile rather than over the two known sites, so a third
   * mixed-source field added later is caught without anyone remembering to
   * extend this file.
   */
  it("NO authoritative field carries a customer-supplied value", () => {
    const owned = new Set<unknown>([OWNER_LEGAL, 40.5, OWNER_ACRES]);

    // Sweep the states where the customer's values are the only ones available:
    // no enrichment at all, and an enrichment whose parcel lookup came back
    // with provenance but nothing in it.
    for (const e of [null, enrichment(undefined), enrichment({ apn: "123" })]) {
      const profile = assembleLandProfile(property(), e, false);
      const offenders = LAND_PROFILE_FIELD_ORDER
        .map((k) => [k, (profile as unknown as Record<string, unknown>)[k]] as const)
        .filter(([, f]) => !!f && (f as { classification?: string }).classification === "authoritative")
        .filter(([, f]) => owned.has((f as { value?: unknown }).value))
        .map(([k, f]) => `${k}=${JSON.stringify(f)}`);

      expect(
        offenders,
        "a value the customer supplied is being published as an authoritative record",
      ).toEqual([]);
    }
  });

  it("the sweep is not vacuous — those fields ARE present, just honestly labelled", () => {
    // Without this, deleting both fields entirely would pass the sweep above.
    const profile = assembleLandProfile(property(), enrichment({ apn: "123" }), false);
    expect(profile.acreage?.value).toBe(40.5);
    expect(profile.legalDescription?.value).toBe(OWNER_LEGAL);
  });
});

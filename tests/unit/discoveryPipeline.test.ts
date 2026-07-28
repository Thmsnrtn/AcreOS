/**
 * Discovery pipeline (ruling #10 wave 4) — pure-logic unit tests.
 *
 * Guards four things:
 *   1. State machine: there is NO path from candidate to seeded that
 *      skips live verification or license review; evidence is mandatory
 *      at every gate; KS (license hard-excluded) can never reach seeded
 *      even with a technically perfect verification.
 *   2. Registry completeness: all eight wave-4 candidates (WI UT MD VT
 *      MA NY OR KS) are registered with a source hint and the research
 *      doc's license posture; KS is marked unclear + hard-excluded.
 *   3. The 2026-07-28 run record is internally consistent: every seeded
 *      state carries full verification + open-license evidence AND has a
 *      matching promoted row in STATEWIDE_PARCEL_ENDPOINTS; every
 *      unseeded state carries an honest failure reason; no candidate
 *      state is seeded without pipeline evidence.
 *   4. proposeReplacementCandidates enqueues into the discovered_endpoints
 *      approve/reject flow with status "pending" ONLY — never approving,
 *      never touching county_gis_endpoints.
 */

import { describe, it, expect } from "vitest";
import {
  PIPELINE_TRANSITIONS,
  canTransition,
  startCandidate,
  recordVerification,
  retryCandidate,
  recordLicenseReview,
  markSeeded,
  STATEWIDE_CANDIDATES,
  LICENSE_EXCLUDED_STATES,
  PIPELINE_RUN_2026_07_28,
  proposeReplacementCandidates,
  type PipelineStatus,
  type VerificationEvidence,
  type LicenseEvidence,
} from "../../server/services/openData/discoveryPipeline";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";
import type { ArcGISSearchItem } from "../../server/services/arcgis-discovery";

const GOOD_VERIFICATION: VerificationEvidence = {
  serviceUrl: "https://example-state.gov/arcgis/rest/services/Parcels/FeatureServer",
  layerId: "0",
  testLat: 40.0,
  testLng: -90.0,
  returnedApn: "123-456-789",
  returnedFields: ["APN", "OWNER"],
  verifiedAt: "2026-07-28",
};

const OPEN_LICENSE: LicenseEvidence = {
  determination: "open",
  evidenceUrl: "https://example-state.gov/terms",
  evidenceQuote: "This data is free for public consumption",
  reviewedAt: "2026-07-28",
};

describe("pipeline state machine", () => {
  it("declares every status and no path from candidate skips verification or license review", () => {
    const statuses: PipelineStatus[] = [
      "candidate",
      "live_verified",
      "license_reviewed",
      "seeded",
      "verify_failed",
      "license_unclear",
    ];
    expect(Object.keys(PIPELINE_TRANSITIONS).sort()).toEqual([...statuses].sort());
    // candidate can never jump to license_reviewed or seeded.
    expect(canTransition("candidate", "license_reviewed")).toBe(false);
    expect(canTransition("candidate", "seeded")).toBe(false);
    // live_verified can never jump straight to seeded.
    expect(canTransition("live_verified", "seeded")).toBe(false);
    // Only license_reviewed reaches seeded; seeded is terminal.
    expect(canTransition("license_reviewed", "seeded")).toBe(true);
    expect(PIPELINE_TRANSITIONS.seeded).toEqual([]);
    // Rejection states never shortcut to seeded.
    expect(canTransition("verify_failed", "seeded")).toBe(false);
    expect(canTransition("license_unclear", "seeded")).toBe(false);
  });

  it("walks the full happy path with evidence at every gate", () => {
    let p = startCandidate("xx");
    expect(p).toEqual({ state: "XX", status: "candidate" });
    p = recordVerification(p, { ok: true, evidence: GOOD_VERIFICATION });
    expect(p.status).toBe("live_verified");
    p = recordLicenseReview(p, OPEN_LICENSE);
    expect(p.status).toBe("license_reviewed");
    p = markSeeded(p);
    expect(p.status).toBe("seeded");
    expect(p.verification?.returnedApn).toBe("123-456-789");
    expect(p.license?.determination).toBe("open");
  });

  it("markSeeded throws from every non-license_reviewed state", () => {
    const candidate = startCandidate("XX");
    expect(() => markSeeded(candidate)).toThrow(/only license_reviewed/);
    const verified = recordVerification(candidate, { ok: true, evidence: GOOD_VERIFICATION });
    expect(() => markSeeded(verified)).toThrow(/only license_reviewed/);
    const unclear = recordLicenseReview(verified, { ...OPEN_LICENSE, determination: "unclear" });
    expect(unclear.status).toBe("license_unclear");
    expect(() => markSeeded(unclear)).toThrow(/only license_reviewed/);
    const failed = recordVerification(startCandidate("YY"), { ok: false, reason: "timeout" });
    expect(() => markSeeded(failed)).toThrow(/only license_reviewed/);
  });

  it("license review cannot pass without an affirmative open determination + verbatim evidence", () => {
    const verified = recordVerification(startCandidate("XX"), { ok: true, evidence: GOOD_VERIFICATION });
    const noQuote = recordLicenseReview(verified, { ...OPEN_LICENSE, evidenceQuote: "" });
    expect(noQuote.status).toBe("license_unclear");
    const unclear = recordLicenseReview(verified, { ...OPEN_LICENSE, determination: "unclear" });
    expect(unclear.status).toBe("license_unclear");
    expect(unclear.failureReason).toBeTruthy();
    // license_unclear may be re-reviewed with NEW real evidence — and only then seeded.
    const rereviewed = recordLicenseReview(unclear, OPEN_LICENSE);
    expect(rereviewed.status).toBe("license_reviewed");
    expect(markSeeded(rereviewed).status).toBe("seeded");
  });

  it("verification without a returned APN is not a verification", () => {
    expect(() =>
      recordVerification(startCandidate("XX"), {
        ok: true,
        evidence: { ...GOOD_VERIFICATION, returnedApn: "" },
      }),
    ).toThrow(/not a verification/);
    expect(() =>
      recordVerification(startCandidate("XX"), {
        ok: true,
        evidence: { ...GOOD_VERIFICATION, returnedFields: [] },
      }),
    ).toThrow(/not a verification/);
  });

  it("verify_failed records the honest reason and may only retry back to candidate", () => {
    const failed = recordVerification(startCandidate("OR"), { ok: false, reason: "HTTP 403 secured service" });
    expect(failed.status).toBe("verify_failed");
    expect(failed.failureReason).toContain("403");
    expect(() => recordLicenseReview(failed, OPEN_LICENSE)).toThrow();
    const retried = retryCandidate(failed);
    expect(retried).toEqual({ state: "OR", status: "candidate" });
  });

  it("KS can NEVER reach seeded, even if a live verification passes", () => {
    const verified = recordVerification(startCandidate("KS"), { ok: true, evidence: GOOD_VERIFICATION });
    expect(verified.status).toBe("live_verified");
    // Even a caller claiming an open license cannot get KS through review.
    const reviewed = recordLicenseReview(verified, OPEN_LICENSE);
    expect(reviewed.status).toBe("license_unclear");
    expect(reviewed.license?.determination).toBe("unclear");
    expect(reviewed.failureReason).toContain("hard-excluded");
    expect(() => markSeeded(reviewed)).toThrow();
    // And there is no other path: re-review is equally blocked.
    const rereviewed = recordLicenseReview(reviewed, OPEN_LICENSE);
    expect(rereviewed.status).toBe("license_unclear");
  });
});

describe("STATEWIDE_CANDIDATES registry", () => {
  it("registers exactly the eight wave-4 candidate states, all as candidates", () => {
    const states = STATEWIDE_CANDIDATES.map((c) => c.state).sort();
    expect(states).toEqual(["KS", "MA", "MD", "NY", "OR", "UT", "VT", "WI"]);
    for (const c of STATEWIDE_CANDIDATES) {
      expect(c.status).toBe("candidate");
      expect(c.sourceHint).toMatch(/^https:\/\//);
      expect(c.licenseNote.length).toBeGreaterThan(0);
    }
  });

  it("KS carries the doc's UNCLEAR license posture and the hard exclusion", () => {
    const ks = STATEWIDE_CANDIDATES.find((c) => c.state === "KS")!;
    expect(ks.licenseNote.toLowerCase()).toContain("unclear");
    expect(LICENSE_EXCLUDED_STATES.has("KS")).toBe(true);
  });

  it("nothing from the registry appears in the seeds without pipeline evidence", () => {
    const seededStates = new Set(STATEWIDE_PARCEL_ENDPOINTS.map((s) => s.state));
    for (const c of STATEWIDE_CANDIDATES) {
      if (!seededStates.has(c.state)) continue;
      const run = PIPELINE_RUN_2026_07_28[c.state];
      expect(run, `${c.state} is seeded but has no pipeline run record`).toBeDefined();
      expect(run.status).toBe("seeded");
      expect(run.verification?.returnedApn).toBeTruthy();
      expect(run.license?.determination).toBe("open");
    }
  });
});

describe("PIPELINE_RUN_2026_07_28 record", () => {
  it("covers every registered candidate", () => {
    expect(Object.keys(PIPELINE_RUN_2026_07_28).sort()).toEqual(
      STATEWIDE_CANDIDATES.map((c) => c.state).sort(),
    );
  });

  it("every seeded state has a matching promoted row whose baseUrl is the verified service", () => {
    for (const [state, run] of Object.entries(PIPELINE_RUN_2026_07_28)) {
      if (run.status !== "seeded") continue;
      const seed = STATEWIDE_PARCEL_ENDPOINTS.find((s) => s.state === state);
      expect(seed, `${state} marked seeded but missing from STATEWIDE_PARCEL_ENDPOINTS`).toBeDefined();
      expect(seed!.baseUrl).toBe(run.verification!.serviceUrl);
      expect(seed!.layerId).toBe(run.verification!.layerId);
      // The seed's APN field must be one the live response actually contained.
      expect(run.verification!.returnedFields).toContain(seed!.apnField);
    }
  });

  it("every unseeded state stays out of the seeds and carries an honest reason", () => {
    const seededStates = new Set(STATEWIDE_PARCEL_ENDPOINTS.map((s) => s.state));
    for (const [state, run] of Object.entries(PIPELINE_RUN_2026_07_28)) {
      if (run.status === "seeded") continue;
      expect(seededStates.has(state), `${state} is ${run.status} but present in seeds`).toBe(false);
      expect(["live_verified", "license_unclear", "verify_failed"]).toContain(run.status);
      if (run.status === "verify_failed" || run.status === "license_unclear") {
        expect(run.failureReason ?? run.license?.evidenceQuote, `${state} missing reason`).toBeTruthy();
      }
    }
  });

  it("KS is not seeded and not license-cleared", () => {
    const ks = PIPELINE_RUN_2026_07_28.KS;
    expect(ks.status).toBe("verify_failed");
    expect(ks.license?.determination).not.toBe("open");
  });
});

describe("proposeReplacementCandidates", () => {
  const item = (over: Partial<ArcGISSearchItem>): ArcGISSearchItem => ({
    id: Math.random().toString(36).slice(2),
    title: "Parcels",
    type: "Feature Service",
    owner: "county_gis",
    ...over,
  });

  it("enqueues only same-state same-county candidates, all with status pending", async () => {
    const enqueued: any[] = [];
    const result = await proposeReplacementCandidates("KS", "Johnson", {
      search: async () => [
        item({
          title: "Johnson County Kansas Parcels",
          url: "https://gis.jocogov.org/arcgis/rest/services/Parcels/FeatureServer",
          snippet: "Tax parcel polygons for Johnson County, Kansas",
        }),
        item({
          title: "Sedgwick County Kansas Parcels",
          url: "https://gis.sedgwick.gov/arcgis/rest/services/Parcels/FeatureServer",
          snippet: "Parcels for Sedgwick County, Kansas",
        }),
        item({
          title: "Johnson County Iowa Parcels",
          url: "https://gis.johnsoncountyiowa.gov/arcgis/rest/services/Parcels/FeatureServer",
          snippet: "Parcels for Johnson County, Iowa",
        }),
        item({ title: "No URL item", url: undefined }),
      ],
      enqueue: async (rows) => {
        enqueued.push(...rows);
        return { added: rows.length, skipped: 0 };
      },
    });

    expect(result.proposed).toBe(1);
    expect(enqueued).toHaveLength(1);
    for (const row of enqueued) {
      expect(row.status).toBe("pending");
      expect(row.state).toBe("KS");
      expect(row.county.toLowerCase()).toBe("johnson");
      expect(row.metadata.proposedFor).toEqual({
        state: "KS",
        county: "Johnson",
        reason: "replacement_for_dead_source",
      });
    }
  });

  it("enqueues nothing when the search finds no usable candidates", async () => {
    let enqueueCalled = false;
    const result = await proposeReplacementCandidates("MT", "Gallatin", {
      search: async () => [],
      enqueue: async (rows) => {
        enqueueCalled = true;
        return { added: rows.length, skipped: 0 };
      },
    });
    expect(result).toEqual({ proposed: 0, skipped: 0, candidates: [] });
    expect(enqueueCalled).toBe(false);
  });

  it("deduplicates candidates sharing a baseUrl", async () => {
    const enqueued: any[] = [];
    await proposeReplacementCandidates("KS", "Johnson", {
      search: async () => [
        item({
          title: "Johnson County Kansas Parcels",
          url: "https://gis.jocogov.org/arcgis/rest/services/Parcels/FeatureServer",
        }),
        item({
          title: "Johnson County Kansas Parcels (mirror)",
          url: "https://gis.jocogov.org/arcgis/rest/services/Parcels/FeatureServer",
        }),
      ],
      enqueue: async (rows) => {
        enqueued.push(...rows);
        return { added: rows.length, skipped: 0 };
      },
    });
    expect(enqueued).toHaveLength(1);
  });
});

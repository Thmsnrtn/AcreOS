/**
 * D2f — the historical-use aggregator never emits "clean".
 *
 * Properties pinned here (each falsified by mutation; see the D2f report):
 *   1. An unreachable / throwing / not-covering source makes the verdict
 *      inconclusive — never no_adverse_found_in_verified_sources.
 *   2. An empty answer without a coverage statement (or geometry, or receipt)
 *      is rejected as an absence.
 *   3. Every adverse finding the verdict carries has complete provenance; a
 *      finding without it becomes an inconclusive item, never silently dropped.
 *   4. A source whose licence is unresolved in the data-licence register is
 *      not queried, and is reported in notScreened.
 *   5. An empty answer from an adapter with no positive control is not an
 *      absence.
 */
import { describe, it, expect, vi } from "vitest";
import {
  runHistoricalUseScreening,
  findingProvenanceProblem,
  SCREENING_CATEGORIES,
  type AdverseFinding,
  type CoverageStatement,
  type HistoricalUseSourceAdapter,
  type ParcelSubject,
  type QueryReceipt,
  type ScreeningVerdict,
  type SourceOutcome,
} from "../../server/services/screening/historicalUse";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const now = () => NOW;

const SUBJECT: ParcelSubject = {
  parcelRef: "SYNTHETIC-IN-PARCEL-1",
  state: "IN",
  centroid: { lat: 40.4167, lng: -86.8753 },
  synthetic: true,
};

const COVERAGE: CoverageStatement = {
  geographic: "1-mile radius of the parcel centroid",
  temporal: "as of 2026-10-24",
  scope: "SYNTHETIC registry",
  limitations: [],
};

const RECEIPT: QueryReceipt = {
  request: "SYNTHETIC query",
  requestedAt: "2026-10-24T12:00:00.000Z",
  respondedAt: "2026-10-24T12:00:01.000Z",
  servedFromCache: false,
  dataAsOf: "2026-10-24T12:00:01.000Z",
  responseSha256: "a".repeat(64),
  upstreamTitle: "SYNTHETIC",
  notes: [],
};

const GEOMETRY = { kind: "point_radius" as const, center: SUBJECT.centroid, radiusMiles: 1 };

// "EPA FRS" is a real register entry (public-domain-usgov, redistributable yes).
const REGISTERED = "EPA FRS";

function finding(sourceId: string, over: Partial<AdverseFinding> = {}): AdverseFinding {
  return {
    sourceId,
    category: "state_tank_release",
    recordId: "SYNTHETIC-REC-1",
    recordName: "SYNTHETIC TANK SITE",
    relationship: { kind: "within_query_radius", radiusMiles: 1, distanceMiles: 0.4 },
    asOf: "2026-10-24T12:00:01.000Z",
    recordDate: null,
    sourceFields: { SITE_ID: "SYNTHETIC-REC-1", STATUS: "OPEN" },
    synthetic: true,
    ...over,
  };
}

function adapter(
  sourceId: string,
  outcome: SourceOutcome | (() => Promise<SourceOutcome>),
  over: Partial<HistoricalUseSourceAdapter> = {},
): HistoricalUseSourceAdapter & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(typeof outcome === "function" ? outcome : async () => outcome);
  return {
    sourceId,
    title: `SYNTHETIC ${sourceId}`,
    licenseSource: REGISTERED,
    categories: ["state_tank_release"],
    absenceEligibility: {
      eligible: true,
      positiveControl: { recordedAt: "2026-10-24", recordId: "SYNTHETIC-PC-1", fixture: "synthetic", synthetic: true },
    },
    appliesTo: () => true,
    ...over,
    query,
  };
}

const absence = (): SourceOutcome => ({ status: "no_records", geometry: GEOMETRY, coverage: COVERAGE, receipt: RECEIPT });

const allVerdicts: ScreeningVerdict[] = [];
async function screen(adapters: HistoricalUseSourceAdapter[], subject = SUBJECT): Promise<ScreeningVerdict> {
  const v = await runHistoricalUseScreening(subject, adapters, { now });
  allVerdicts.push(v);
  return v;
}

describe("historical-use aggregator", () => {
  it("baseline: all sources verified-absent → no_adverse_found_in_verified_sources, listing every source and its coverage", async () => {
    const v = await screen([adapter("a", absence()), adapter("b", absence())]);
    expect(v.verdict).toBe("no_adverse_found_in_verified_sources");
    expect(v.verifiedAbsences.map((a) => a.sourceId)).toEqual(["a", "b"]);
    for (const a of v.verifiedAbsences) {
      expect(a.coverage.geographic).toBeTruthy();
      expect(a.coverage.temporal).toBeTruthy();
      expect(a.coverage.scope).toBeTruthy();
      expect(a.asOf).toBe(RECEIPT.dataAsOf);
      expect(a.receipt.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(v.synthetic).toBe(true);
    // Categories with no answer are still listed, never implied covered.
    expect(v.categoriesWithoutVerifiedAnswer).toContain("historical_aerial");
    expect(v.categoriesWithoutVerifiedAnswer).not.toContain("state_tank_release");
  });

  describe("an unreachable source is inconclusive, never clean", () => {
    it.each<[string, SourceOutcome | (() => Promise<SourceOutcome>)]>([
      ["unreachable", { status: "unreachable", reason: "HTTP 503", attemptedAt: NOW.toISOString() }],
      ["not_covering", { status: "not_covering", reason: "state did not submit data" }],
      ["throws", async () => { throw new Error("socket hang up"); }],
    ])("%s alongside a verified absence → inconclusive", async (_label, outcome) => {
      const v = await screen([adapter("ok", absence()), adapter("down", outcome)]);
      expect(v.verdict).toBe("inconclusive");
      expect(v.inconclusive.map((i) => i.sourceId)).toEqual(["down"]);
      expect(v.statement).toMatch(/not a finding of no adverse use/);
    });

    it("an unitemized count is inconclusive (cannot cite, cannot ignore)", async () => {
      const v = await screen([
        adapter("ok", absence()),
        adapter("count", { status: "unitemized_signal", count: 2, geometry: GEOMETRY, receipt: RECEIPT }),
      ]);
      expect(v.verdict).toBe("inconclusive");
      expect(v.inconclusive[0].reason).toMatch(/2 matching records/);
    });

    it("no applicable source at all → inconclusive", async () => {
      const v = await screen([adapter("elsewhere", absence(), { appliesTo: () => false })]);
      expect(v.verdict).toBe("inconclusive");
    });

    it("an invalid parcel queries nothing and is inconclusive", async () => {
      const a = adapter("a", absence());
      const v = await screen([a], { ...SUBJECT, state: "Indiana" });
      expect(v.verdict).toBe("inconclusive");
      expect(a.query).not.toHaveBeenCalled();
    });
  });

  describe("an absence without a coverage statement is rejected", () => {
    const cases: Array<[string, SourceOutcome]> = [
      ["no coverage", { status: "no_records", geometry: GEOMETRY, coverage: null, receipt: RECEIPT }],
      ["blank geographic", { status: "no_records", geometry: GEOMETRY, coverage: { ...COVERAGE, geographic: "  " }, receipt: RECEIPT }],
      ["blank temporal", { status: "no_records", geometry: GEOMETRY, coverage: { ...COVERAGE, temporal: "" }, receipt: RECEIPT }],
      ["blank scope", { status: "no_records", geometry: GEOMETRY, coverage: { ...COVERAGE, scope: "" }, receipt: RECEIPT }],
      ["no geometry", { status: "no_records", geometry: null, coverage: COVERAGE, receipt: RECEIPT }],
      ["zero radius", { status: "no_records", geometry: { ...GEOMETRY, radiusMiles: 0 }, coverage: COVERAGE, receipt: RECEIPT }],
      ["no receipt", { status: "no_records", geometry: GEOMETRY, coverage: COVERAGE, receipt: null }],
      ["receipt without as-of", { status: "no_records", geometry: GEOMETRY, coverage: COVERAGE, receipt: { ...RECEIPT, dataAsOf: "" } }],
      ["receipt without digest", { status: "no_records", geometry: GEOMETRY, coverage: COVERAGE, receipt: { ...RECEIPT, responseSha256: "" } }],
    ];
    it.each(cases)("%s → not a verified absence; verdict inconclusive", async (_label, outcome) => {
      const v = await screen([adapter("bad", outcome)]);
      expect(v.verdict).toBe("inconclusive");
      expect(v.verifiedAbsences).toHaveLength(0);
      expect(v.inconclusive[0].reason).toMatch(/rejected as an absence/);
    });

    it("an adapter with no positive control cannot turn an empty answer into an absence", async () => {
      const v = await screen([
        adapter("blind", absence(), { absenceEligibility: { eligible: false, reason: "no positive control recorded" } }),
      ]);
      expect(v.verdict).toBe("inconclusive");
      expect(v.verifiedAbsences).toHaveLength(0);
      expect(v.inconclusive[0].reason).toMatch(/no positive control/);
    });
  });

  describe("every adverse finding carries provenance", () => {
    it("adverse dominates, and unreachable sources are still listed", async () => {
      const v = await screen([
        adapter("hit", { status: "records_found", findings: [finding("hit")], geometry: GEOMETRY, coverage: COVERAGE, receipt: RECEIPT, truncated: true }),
        adapter("down", { status: "unreachable", reason: "HTTP 503", attemptedAt: NOW.toISOString() }),
      ]);
      expect(v.verdict).toBe("adverse_found");
      if (v.verdict !== "adverse_found") return;
      expect(v.findings).toHaveLength(1);
      expect(v.truncatedSources).toEqual(["hit"]);
      expect(v.inconclusive.map((i) => i.sourceId)).toEqual(["down"]);
    });

    const broken: Array<[string, Partial<AdverseFinding>]> = [
      ["no record id", { recordId: "" }],
      ["no as-of", { asOf: "" }],
      ["unparseable record date", { recordDate: "last spring" }],
      ["no quoted fields", { sourceFields: {} }],
      ["blank quoted fields", { sourceFields: { STATUS: " " } }],
      ["foreign source id", { sourceId: "someone-else" }],
      ["negative distance", { relationship: { kind: "within_query_radius", radiusMiles: 1, distanceMiles: -1 } }],
      ["no radius", { relationship: { kind: "within_query_radius", radiusMiles: 0, distanceMiles: null } }],
    ];
    it.each(broken)("a finding with %s is not emitted and is not silently dropped", async (_label, over) => {
      const v = await screen([
        adapter("hit", { status: "records_found", findings: [finding("hit", over)], geometry: GEOMETRY, coverage: COVERAGE, receipt: RECEIPT, truncated: false }),
        adapter("ok", absence()),
      ]);
      // Dropping it would have left only a verified absence → "no adverse".
      expect(v.verdict).toBe("inconclusive");
      expect(v.inconclusive.some((i) => i.sourceId === "hit" && /could not be cited/.test(i.reason))).toBe(true);
    });

    it("records_found with an empty list is inconclusive, not an absence", async () => {
      const v = await screen([
        adapter("hit", { status: "records_found", findings: [], geometry: GEOMETRY, coverage: COVERAGE, receipt: RECEIPT, truncated: false }),
      ]);
      expect(v.verdict).toBe("inconclusive");
    });
  });

  describe("a source with an unresolved licence is excluded and reported", () => {
    it("is never queried, appears in notScreened, and cannot carry the verdict", async () => {
      const unlicensed = adapter("unlicensed", absence(), { licenseSource: "SYNTHETIC source not in the register" });
      const v = await screen([unlicensed]);
      expect(unlicensed.query).not.toHaveBeenCalled();
      expect(v.notScreened.map((n) => n.sourceId)).toEqual(["unlicensed"]);
      expect(v.notScreened[0].reason).toMatch(/licence unresolved/);
      expect(v.verdict).toBe("inconclusive");
    });

    it("an unlicensed source's adverse records are not shown either", async () => {
      const unlicensed = adapter(
        "unlicensed",
        { status: "records_found", findings: [finding("unlicensed")], geometry: GEOMETRY, coverage: COVERAGE, receipt: RECEIPT, truncated: false },
        { licenseSource: "SYNTHETIC source not in the register" },
      );
      const v = await screen([unlicensed, adapter("ok", absence())]);
      expect(unlicensed.query).not.toHaveBeenCalled();
      expect(v.verdict).toBe("no_adverse_found_in_verified_sources");
      expect(v.notScreened.map((n) => n.sourceId)).toEqual(["unlicensed"]);
      expect(v.statement).toMatch(/1 source not screened/);
    });
  });

  it("population: every finding on every verdict above passes the provenance check, and no statement says clean", () => {
    // Vacuity floor: the suite above produced verdicts and at least one finding.
    expect(allVerdicts.length).toBeGreaterThanOrEqual(25);
    const emitted = allVerdicts.flatMap((v) => (v.verdict === "adverse_found" ? v.findings : []));
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    for (const f of emitted) expect(findingProvenanceProblem(f, f.sourceId)).toBeNull();
    for (const v of allVerdicts) {
      expect(v.statement).not.toMatch(/\bclean\b/i);
      expect(["adverse_found", "no_adverse_found_in_verified_sources", "inconclusive"]).toContain(v.verdict);
      expect(SCREENING_CATEGORIES).toEqual(expect.arrayContaining(v.categoriesWithoutVerifiedAnswer));
    }
  });
});

/**
 * Statewide free-parcel discovery pipeline — ruling #10 wave 4
 * (docs/company/founder-decisions-2026-07-28.md): scale the 7-state
 * free-coverage engine toward the rest of the country as a SYSTEMATIC
 * candidate → verify → license-review → seed pipeline instead of ad-hoc
 * one-off verification passes.
 *
 * The pipeline is CODE, not prose. Explicit states:
 *
 *   candidate ──(live point-intersection verification)──▶ live_verified
 *   candidate ──(verification failed)────────────────────▶ verify_failed
 *   live_verified ──(open-license determination)─────────▶ license_reviewed
 *   live_verified ──(license not affirmatively open)─────▶ license_unclear
 *   license_reviewed ──(seed into statewideParcelEndpoints)─▶ seeded
 *
 * There is NO path from candidate to seeded that skips live verification
 * or license review — `markSeeded` throws unless BOTH evidence records
 * are present and the license determination is "open". verify_failed may
 * retry (back to candidate) and license_unclear may be re-reviewed with
 * NEW evidence, but neither shortcut past the gates.
 *
 * License hard-exclusions: states whose license the research doc marks
 * UNCLEAR (KS, per docs/company/open-data-market-signals.md §1) can
 * NEVER pass license review here — even a technically perfect service
 * stays excluded until the founder-visible research doc says otherwise.
 *
 * The state machine + registry are pure (no db, no fetch) so every
 * transition is unit-testable. `proposeReplacementCandidates` is the one
 * I/O seam: it wraps the existing arcgis-discovery search and enqueues
 * results into `discovered_endpoints` with status "pending" — the
 * existing human approve/reject flow. It NEVER auto-seeds anything.
 */

import {
  searchArcGISOnline,
  extractEndpointInfo,
  type DiscoveredEndpointInfo,
  type ArcGISSearchItem,
} from "../arcgis-discovery";

// ---------------------------------------------------------------------------
// Pipeline states
// ---------------------------------------------------------------------------

export type PipelineStatus =
  | "candidate"
  | "live_verified"
  | "license_reviewed"
  | "seeded"
  | "verify_failed"
  | "license_unclear";

/**
 * Allowed transitions. seeded is terminal; verify_failed may retry;
 * license_unclear may be re-reviewed with new evidence.
 */
export const PIPELINE_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> = {
  candidate: ["live_verified", "verify_failed"],
  live_verified: ["license_reviewed", "license_unclear"],
  license_reviewed: ["seeded"],
  seeded: [],
  verify_failed: ["candidate"],
  license_unclear: ["license_reviewed"],
};

export function canTransition(from: PipelineStatus, to: PipelineStatus): boolean {
  return (PIPELINE_TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Evidence records — no evidence, no transition (no-fabrication rule)
// ---------------------------------------------------------------------------

/** Proof of a real, successful point-intersection query. */
export interface VerificationEvidence {
  serviceUrl: string;
  layerId: string;
  /** WGS84 test coordinate the point query was run at. */
  testLat: number;
  testLng: number;
  /** The APN value the service actually returned for that point. */
  returnedApn: string;
  /** Field names observed in the real response (never guessed). */
  returnedFields: string[];
  verifiedAt: string; // ISO date
}

/** Proof of an open-license determination. */
export interface LicenseEvidence {
  determination: "open" | "unclear";
  /** Where the wording lives (research doc section or the state's own terms). */
  evidenceUrl: string;
  /** Verbatim wording the determination rests on. */
  evidenceQuote: string;
  reviewedAt: string; // ISO date
}

export interface CandidateProgress {
  state: string;
  status: PipelineStatus;
  verification?: VerificationEvidence;
  license?: LicenseEvidence;
  /** Honest failure reason for verify_failed / license_unclear. */
  failureReason?: string;
}

// ---------------------------------------------------------------------------
// Candidates registry (from docs/company/open-data-market-signals.md §1)
// ---------------------------------------------------------------------------

export interface StatewideCandidate {
  state: string;
  /** Portal URL from the research doc — a hint of where to look, not a claim. */
  sourceHint: string;
  /** Verbatim license posture from the research doc at registry time. */
  licenseNote: string;
  status: "candidate";
}

/**
 * States whose license posture the research doc marks UNCLEAR. These can
 * never pass license review from this pipeline regardless of technical
 * success — only an explicit founder-approved research-doc update
 * rescinds the exclusion (license-verified or it doesn't ship).
 */
export const LICENSE_EXCLUDED_STATES: ReadonlySet<string> = new Set(["KS"]);

/**
 * The wave-4 statewide candidates. licenseNote wording is verbatim from
 * docs/company/open-data-market-signals.md §1 (research date 2026-07-13).
 */
export const STATEWIDE_CANDIDATES: StatewideCandidate[] = [
  {
    state: "WI",
    sourceHint: "https://www.sco.wisc.edu/parcels/data/",
    licenseNote:
      'Also worth checking (not verified this pass): Wisconsin Statewide Parcel Map Initiative — "statewide programs of varying openness"',
    status: "candidate",
  },
  {
    state: "UT",
    sourceHint: "https://gis.utah.gov/",
    licenseNote:
      'Also worth checking (not verified this pass): Utah — "statewide programs of varying openness"',
    status: "candidate",
  },
  {
    state: "MD",
    sourceHint: "https://imap.maryland.gov/",
    licenseNote:
      'Also worth checking (not verified this pass): Maryland — "statewide programs of varying openness"',
    status: "candidate",
  },
  {
    state: "VT",
    sourceHint: "https://geodata.vermont.gov/",
    licenseNote:
      'Also worth checking (not verified this pass): Vermont — "statewide programs of varying openness"',
    status: "candidate",
  },
  {
    state: "MA",
    sourceHint: "https://www.mass.gov/info-details/massgis-data-property-tax-parcels",
    licenseNote:
      'Also worth checking (not verified this pass): Massachusetts — "statewide programs of varying openness"',
    status: "candidate",
  },
  {
    state: "NY",
    sourceHint: "https://gis.ny.gov/parcels",
    licenseNote:
      "Free, but only ~38 counties opted into the public download (statewide centroids exist); annual update",
    status: "candidate",
  },
  {
    state: "OR",
    sourceHint: "https://geohub.oregon.gov/pages/parcel-viewer",
    licenseNote:
      "ORMAP is the tax-map base; a statewide parcel GIS effort launched Sept 2023 — coverage still maturing",
    status: "candidate",
  },
  {
    state: "KS",
    sourceHint: "https://kansasgis.org/",
    licenseNote:
      "State GIS clearinghouse hosts county parcel data; statewide public bulk download terms unclear — verify before ingest",
    status: "candidate",
  },
];

// ---------------------------------------------------------------------------
// Pure transition functions — evidence-gated, always return a NEW record
// ---------------------------------------------------------------------------

export function startCandidate(state: string): CandidateProgress {
  return { state: state.toUpperCase(), status: "candidate" };
}

/**
 * Record the outcome of a live verification attempt. Success requires
 * real evidence (a returned APN from a real point query); failure moves
 * to verify_failed with the honest reason.
 */
export function recordVerification(
  progress: CandidateProgress,
  outcome:
    | { ok: true; evidence: VerificationEvidence }
    | { ok: false; reason: string },
): CandidateProgress {
  if (progress.status !== "candidate") {
    throw new Error(
      `recordVerification: ${progress.state} is ${progress.status}, expected candidate`,
    );
  }
  if (!outcome.ok) {
    return { ...progress, status: "verify_failed", failureReason: outcome.reason };
  }
  const ev = outcome.evidence;
  if (!ev.returnedApn || !ev.serviceUrl || ev.returnedFields.length === 0) {
    throw new Error(
      `recordVerification: ${progress.state} evidence is incomplete — a verification without a returned APN is not a verification`,
    );
  }
  return { ...progress, status: "live_verified", verification: ev, failureReason: undefined };
}

/** Allow a failed candidate to retry after the underlying issue is fixed. */
export function retryCandidate(progress: CandidateProgress): CandidateProgress {
  if (progress.status !== "verify_failed") {
    throw new Error(`retryCandidate: ${progress.state} is ${progress.status}, expected verify_failed`);
  }
  return { state: progress.state, status: "candidate" };
}

/**
 * Record a license review. Passing requires an affirmative "open"
 * determination WITH verbatim evidence. Hard-excluded states (KS) can
 * never pass, regardless of what the caller claims.
 */
export function recordLicenseReview(
  progress: CandidateProgress,
  evidence: LicenseEvidence,
): CandidateProgress {
  if (progress.status !== "live_verified" && progress.status !== "license_unclear") {
    throw new Error(
      `recordLicenseReview: ${progress.state} is ${progress.status}, expected live_verified or license_unclear`,
    );
  }
  if (LICENSE_EXCLUDED_STATES.has(progress.state)) {
    return {
      ...progress,
      status: "license_unclear",
      license: { ...evidence, determination: "unclear" },
      failureReason:
        "license hard-excluded: research doc marks terms UNCLEAR — founder rule, cannot pass license review here",
    };
  }
  if (evidence.determination !== "open" || !evidence.evidenceQuote || !evidence.evidenceUrl) {
    return {
      ...progress,
      status: "license_unclear",
      license: evidence,
      failureReason:
        progress.failureReason ??
        "no affirmative open/free wording located in the research doc or the state's own terms",
    };
  }
  return { ...progress, status: "license_reviewed", license: evidence, failureReason: undefined };
}

/**
 * The only door into "seeded". Requires the full chain: live
 * verification evidence AND an open-license determination, in the
 * license_reviewed state. Anything else throws.
 */
export function markSeeded(progress: CandidateProgress): CandidateProgress {
  if (progress.status !== "license_reviewed") {
    throw new Error(
      `markSeeded: ${progress.state} is ${progress.status} — only license_reviewed candidates may be seeded`,
    );
  }
  if (!progress.verification?.returnedApn) {
    throw new Error(`markSeeded: ${progress.state} has no live-verification evidence`);
  }
  if (progress.license?.determination !== "open") {
    throw new Error(`markSeeded: ${progress.state} has no open-license determination`);
  }
  if (LICENSE_EXCLUDED_STATES.has(progress.state)) {
    throw new Error(`markSeeded: ${progress.state} is license hard-excluded`);
  }
  return { ...progress, status: "seeded" };
}

// ---------------------------------------------------------------------------
// 2026-07-28 pipeline run — the honest, evidence-carrying record of what
// each candidate did when actually probed from this environment. Every
// value below came out of a real HTTP response; nothing is guessed.
// Seeded states here MUST have a matching row in statewideParcelEndpoints
// (pinned by tests); everything else stays unseeded with its reason.
// ---------------------------------------------------------------------------

const RUN_DATE = "2026-07-28";

export const PIPELINE_RUN_2026_07_28: Record<string, CandidateProgress> = {
  NY: markSeeded(
    recordLicenseReview(
      recordVerification(startCandidate("NY"), {
        ok: true,
        evidence: {
          serviceUrl:
            "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcels_Public/MapServer",
          layerId: "1",
          testLat: 42.6529,
          testLng: -73.7594,
          returnedApn: "76.10-1-10.10", // PRINT_KEY at the NYS Capitol, Albany
          returnedFields: [
            "PRINT_KEY",
            "SBL",
            "PRIMARY_OWNER",
            "PARCEL_ADDR",
            "COUNTY_NAME",
            "TOTAL_AV",
            "FULL_MARKET_VAL",
            "ACRES",
          ],
          verifiedAt: RUN_DATE,
        },
      }),
      {
        determination: "open",
        evidenceUrl: "docs/company/open-data-market-signals.md",
        evidenceQuote:
          "NY | NYS Tax Parcels Public | Free, but only ~38 counties opted into the public download",
        reviewedAt: RUN_DATE,
      },
    ),
  ),
  WI: markSeeded(
    recordLicenseReview(
      recordVerification(startCandidate("WI"), {
        ok: true,
        evidence: {
          serviceUrl:
            "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer",
          layerId: "0",
          testLat: 43.0747,
          testLng: -89.3844,
          returnedApn: "070924205010", // PARCELID at the WI Capitol, Madison
          returnedFields: [
            "STATEID",
            "PARCELID",
            "OWNERNME1",
            "SITEADRESS",
            "DEEDACRES",
            "CNTASSDVALUE",
            "ESTFMKVALUE",
            "NETPRPTA",
            "CONAME",
          ],
          verifiedAt: RUN_DATE,
        },
      }),
      {
        determination: "open",
        evidenceUrl:
          "https://www.arcgis.com/home/item.html?id=2386813b23ea4e51a009f7d1d6b76e02",
        evidenceQuote: "This data free for public consumption as of: 06/30/2026",
        reviewedAt: RUN_DATE,
      },
    ),
  ),
  MD: markSeeded(
    recordLicenseReview(
      recordVerification(startCandidate("MD"), {
        ok: true,
        evidence: {
          serviceUrl:
            "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer",
          layerId: "0",
          testLat: 38.9788,
          testLng: -76.491,
          returnedApn: "020600007679310", // ACCTID at the MD State House, Annapolis
          returnedFields: ["ACCTID", "ADDRESS", "ACRES", "NFMTTLVL", "NFMLNDVL", "ZONING", "LEGAL1"],
          verifiedAt: RUN_DATE,
        },
      }),
      {
        determination: "open",
        evidenceUrl:
          "https://www.arcgis.com/home/item.html?id=b33e5f03d50844b8819a4046ecfe0d97",
        evidenceQuote:
          "The Data can be freely distributed as long as the metadata entry is not modified or deleted",
        reviewedAt: RUN_DATE,
      },
    ),
  ),
  VT: recordLicenseReview(
    recordVerification(startCandidate("VT"), {
      ok: true,
      evidence: {
        serviceUrl:
          "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer",
        layerId: "0",
        testLat: 44.2793,
        testLng: -72.5804,
        returnedApn: "405-126-13891", // SPAN in Montpelier
        returnedFields: ["SPAN", "PARCID", "OWNER1", "ADDRGL1", "ACRESGL", "REAL_FLV", "TOWN"],
        verifiedAt: RUN_DATE,
      },
    }),
    {
      determination: "unclear",
      evidenceUrl: "https://www.arcgis.com/home/item.html?id=09cf47e1cf82465e99164762a04f3ce6",
      evidenceQuote:
        "VCGI and the State of VT make no representations of any kind [warranty disclaimer only — no affirmative open/free statement located this pass]",
      reviewedAt: RUN_DATE,
    },
  ),
  UT: recordLicenseReview(
    recordVerification(startCandidate("UT"), {
      ok: true,
      evidence: {
        serviceUrl:
          "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer",
        layerId: "0",
        testLat: 40.7774,
        testLng: -111.8882,
        returnedApn: "09311610020000", // PARCEL_ID at the UT Capitol, Salt Lake City
        returnedFields: ["PARCEL_ID", "PARCEL_ADD", "PARCEL_CITY", "PARCEL_ZIP", "OWN_TYPE", "County"],
        verifiedAt: RUN_DATE,
      },
    }),
    {
      determination: "unclear",
      evidenceUrl: "https://www.arcgis.com/home/item.html?id=9df536b0835e4ee78e34d7cf6fe132c2",
      evidenceQuote:
        'The data herein ... are provided "as is" without warranty of any kind [warranty disclaimer only — no affirmative open/free statement located this pass; no owner-name field in the layer]',
      reviewedAt: RUN_DATE,
    },
  ),
  MA: recordLicenseReview(
    recordVerification(startCandidate("MA"), {
      ok: true,
      evidence: {
        serviceUrl:
          "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer",
        layerId: "0",
        testLat: 42.3588,
        testLng: -71.0638,
        returnedApn: "0501615000", // PROP_ID at the MA State House, Boston
        returnedFields: ["PROP_ID", "MAP_PAR_ID", "OWNER1", "SITE_ADDR", "TOTAL_VAL", "LOT_SIZE", "USE_CODE"],
        verifiedAt: RUN_DATE,
      },
    }),
    {
      determination: "unclear",
      evidenceUrl: "https://www.arcgis.com/home/item.html?id=73d4c766167848b795f1048cad3919c7",
      evidenceQuote:
        "Assessor's parcel mapping is a representation of property boundaries, not an authoritative source [accuracy disclaimer only — no affirmative open/free statement located this pass]",
      reviewedAt: RUN_DATE,
    },
  ),
  OR: recordVerification(startCandidate("OR"), {
    ok: false,
    reason:
      "no public statewide REST query service found: DOR_ORMAP_TAXLOTS (utility.arcgis.com usrsvcs) returns HTTP 403 (secured); AGOL search surfaced only county-level taxlot services; research doc: coverage still maturing",
  }),
  // KS is doubly blocked: this run found no statewide parcel query layer,
  // AND it sits on the license hard-exclusion list — even a future
  // technically-perfect service cannot pass license review here (see the
  // test proving KS can never reach seeded).
  KS: recordVerification(startCandidate("KS"), {
    ok: false,
    reason:
      "no statewide parcel query layer found on services.kansasgis.org (ORKA folder exposes address points / subdivisions / lots only); excluded on license regardless — research doc marks bulk terms UNCLEAR",
  }),
};

// ---------------------------------------------------------------------------
// Failure-driven proposals — the self-healing loop's HUMAN follow-up seam
// ---------------------------------------------------------------------------

export interface ProposeReplacementDeps {
  /** AGOL search — defaults to the real arcgis-discovery search. */
  search?: (keywords: string[], options: { maxResults?: number; targetStates?: string[] }) => Promise<ArcGISSearchItem[]>;
  /** Enqueue into discovered_endpoints — defaults to storage.bulkCreateDiscoveredEndpoints. */
  enqueue?: (
    rows: Array<DiscoveredEndpointInfo & { status: "pending"; metadata: Record<string, any> }>,
  ) => Promise<{ added: number; skipped: number }>;
}

/**
 * Given a named DEAD county source (e.g. flagged by the self-healing
 * canary loop), search ArcGIS Online for replacement candidates and
 * enqueue them into `discovered_endpoints` with status "pending" for the
 * existing HUMAN approve/reject flow. This function never writes to
 * county_gis_endpoints and never auto-approves — proposals only.
 */
export async function proposeReplacementCandidates(
  state: string,
  county: string,
  deps: ProposeReplacementDeps = {},
): Promise<{ proposed: number; skipped: number; candidates: DiscoveredEndpointInfo[] }> {
  const st = state.toUpperCase();
  const co = county.trim();
  const search = deps.search ?? searchArcGISOnline;

  const items = await search(
    [`${co} County parcels`, `${co} County assessor`, "tax parcel"],
    { maxResults: 25, targetStates: [st] },
  );

  const candidates: DiscoveredEndpointInfo[] = [];
  for (const item of items) {
    const info = extractEndpointInfo(item);
    if (!info) continue;
    if (info.state !== st) continue;
    // Only same-county services are replacements for the dead source.
    if (info.county.toLowerCase() !== co.toLowerCase()) continue;
    if (!candidates.some((c) => c.baseUrl === info.baseUrl)) {
      candidates.push(info);
    }
  }

  if (candidates.length === 0) {
    return { proposed: 0, skipped: 0, candidates: [] };
  }

  const enqueue =
    deps.enqueue ??
    (async (rows) => {
      const { storage } = await import("../../storage");
      return storage.bulkCreateDiscoveredEndpoints(rows);
    });

  const { added, skipped } = await enqueue(
    candidates.map((c) => ({
      ...c,
      // Pending review, ALWAYS — the approve/reject flow is the only door
      // from discovered_endpoints into county_gis_endpoints.
      status: "pending" as const,
      metadata: {
        ...c.metadata,
        proposedFor: { state: st, county: co, reason: "replacement_for_dead_source" },
      },
    })),
  );

  return { proposed: added, skipped, candidates };
}

/**
 * D2f — historical-use screening: the finding model and the aggregator.
 *
 * Every screening produces, per source, exactly one of:
 *   - ADVERSE      — records with full provenance (source, record id,
 *                    relationship to the parcel, as-of date, the source's own
 *                    fields quoted verbatim);
 *   - VERIFIED ABSENCE — "we queried source S over geometry G, which covers
 *                    area A as of date D, and it returned nothing", with the
 *                    query receipt;
 *   - INCONCLUSIVE — the source was unreachable, did not cover the parcel,
 *                    returned something we could not cite, or returned an
 *                    empty answer we cannot yet trust;
 *   - EXCLUDED     — never queried, because its licence is unresolved in the
 *                    data-licence register.
 *
 * The overall verdict is `adverse_found` | `no_adverse_found_in_verified_sources`
 * | `inconclusive`. There is no "clean". An empty answer is only an absence when
 * it carries a coverage statement, a query geometry, an as-of date and a
 * receipt, AND the adapter has shown it can return a match for this query shape
 * (a positive control) — an adapter that silently returns [] for every query
 * would otherwise certify every parcel. Anything that fails a check is turned
 * into an inconclusive item, never dropped: dropping an adverse record would
 * move the verdict toward "no adverse".
 *
 * Pure module: no I/O. Source adapters live in ./historicalUseSources.ts.
 * Spec: docs/land-data/d2f-historical-use-screening.md.
 */

import { licenseFor, mayCacheAndRedistribute } from "../providers/data-licenses";

export type ScreeningCategory =
  | "federal_facility_registry"
  | "federal_enforcement"
  | "superfund"
  | "brownfields"
  | "rcra"
  | "toxics_release"
  | "state_tank_release"
  | "state_contaminated_sites"
  | "historical_aerial"
  | "historical_topo";

export const SCREENING_CATEGORIES: readonly ScreeningCategory[] = [
  "federal_facility_registry",
  "federal_enforcement",
  "superfund",
  "brownfields",
  "rcra",
  "toxics_release",
  "state_tank_release",
  "state_contaminated_sites",
  "historical_aerial",
  "historical_topo",
];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ParcelSubject {
  /** Caller's parcel reference (property id, APN, or a fixture id). */
  parcelRef: string;
  /** Two-letter USPS state code. */
  state: string;
  county?: string;
  centroid: LatLng;
  synthetic?: boolean;
}

export interface QueryGeometry {
  kind: "point_radius";
  center: LatLng;
  radiusMiles: number;
}

/** What the source covers, in its own terms. All three statements required. */
export interface CoverageStatement {
  geographic: string;
  temporal: string;
  scope: string;
  limitations: string[];
}

export interface QueryReceipt {
  /** The request as sent (category + coordinates + radius, or the URL). */
  request: string;
  requestedAt: string;
  respondedAt: string;
  servedFromCache: boolean;
  /** When the data was obtained from the source (cache write time on a hit). */
  dataAsOf: string;
  /** sha256 of the canonical JSON of the response payload we parsed. */
  responseSha256: string;
  upstreamTitle: string;
  notes: string[];
}

export type FindingRelationship =
  | { kind: "on_parcel" }
  | {
      kind: "within_query_radius";
      radiusMiles: number;
      /** Null when the record carries no coordinates of its own. */
      distanceMiles: number | null;
    };

export interface AdverseFinding {
  sourceId: string;
  category: ScreeningCategory;
  recordId: string;
  recordName: string | null;
  relationship: FindingRelationship;
  /** As-of date of the data the record came from. */
  asOf: string;
  /** A date the source itself attaches to the record, if any. */
  recordDate: string | null;
  /** The source's own fields, verbatim (no derived values). */
  sourceFields: Record<string, string>;
  synthetic?: boolean;
}

/** What an adapter returns for one query. */
export type SourceOutcome =
  | {
      status: "records_found";
      findings: AdverseFinding[];
      geometry: QueryGeometry;
      coverage: CoverageStatement;
      receipt: QueryReceipt;
      /** True when the source capped the list (more records may exist). */
      truncated: boolean;
    }
  | {
      status: "no_records";
      geometry: QueryGeometry | null;
      coverage: CoverageStatement | null;
      receipt: QueryReceipt | null;
    }
  | {
      /** The source said "N records" but gave nothing citable. */
      status: "unitemized_signal";
      count: number;
      geometry: QueryGeometry;
      receipt: QueryReceipt;
    }
  | { status: "unreachable"; reason: string; attemptedAt: string }
  | { status: "not_covering"; reason: string };

export type AbsenceEligibility =
  | {
      eligible: true;
      /** A recorded query where this adapter returned a real match. */
      positiveControl: {
        recordedAt: string;
        recordId: string;
        fixture: string;
        synthetic: boolean;
      };
    }
  | { eligible: false; reason: string };

export interface HistoricalUseSourceAdapter {
  sourceId: string;
  title: string;
  /** Key in DATA_LICENSE_REGISTER (server/services/providers/data-licenses.ts). */
  licenseSource: string;
  categories: readonly ScreeningCategory[];
  absenceEligibility: AbsenceEligibility;
  appliesTo(subject: ParcelSubject): boolean;
  query(subject: ParcelSubject): Promise<SourceOutcome>;
}

/** A source we know of but do not query (no adapter, or licence unresolved). */
export interface NotScreenedEntry {
  sourceId: string;
  title: string;
  categories: readonly ScreeningCategory[];
  reason: string;
}

export interface VerifiedAbsence {
  sourceId: string;
  title: string;
  categories: readonly ScreeningCategory[];
  geometry: QueryGeometry;
  coverage: CoverageStatement;
  asOf: string;
  receipt: QueryReceipt;
}

export interface InconclusiveItem {
  sourceId: string;
  title: string;
  categories: readonly ScreeningCategory[];
  reason: string;
}

export interface ScreeningCommon {
  parcelRef: string;
  state: string;
  screenedAt: string;
  /** Every source whose answer was a verified absence. */
  verifiedAbsences: VerifiedAbsence[];
  inconclusive: InconclusiveItem[];
  /** Licence-excluded adapters and known sources with no adapter. */
  notScreened: NotScreenedEntry[];
  /** Categories no queried source answered for (adverse or verified absence). */
  categoriesWithoutVerifiedAnswer: ScreeningCategory[];
  /** True when any input (parcel, fixture, positive control) is synthetic. */
  synthetic: boolean;
  /** Plain-language summary. Never says "clean". */
  statement: string;
}

export type ScreeningVerdict =
  | (ScreeningCommon & {
      verdict: "adverse_found";
      findings: AdverseFinding[];
      truncatedSources: string[];
    })
  | (ScreeningCommon & { verdict: "no_adverse_found_in_verified_sources" })
  | (ScreeningCommon & { verdict: "inconclusive" });

// ── validation ─────────────────────────────────────────────────────────────

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function geometryProblem(g: QueryGeometry | null): string | null {
  if (!g) return "no query geometry";
  if (g.kind !== "point_radius") return "unknown query geometry kind";
  if (!Number.isFinite(g.center.lat) || !Number.isFinite(g.center.lng)) return "query geometry has no finite centre";
  if (!Number.isFinite(g.radiusMiles) || g.radiusMiles <= 0) return "query geometry has no positive radius";
  return null;
}

function coverageProblem(c: CoverageStatement | null): string | null {
  if (!c) return "no coverage statement";
  if (!nonBlank(c.geographic)) return "coverage statement has no geographic extent";
  if (!nonBlank(c.temporal)) return "coverage statement has no temporal extent";
  if (!nonBlank(c.scope)) return "coverage statement has no scope";
  return null;
}

function receiptProblem(r: QueryReceipt | null): string | null {
  if (!r) return "no query receipt";
  if (!nonBlank(r.request)) return "receipt has no request";
  if (!isIsoDate(r.requestedAt) || !isIsoDate(r.respondedAt)) return "receipt has no request/response time";
  if (!isIsoDate(r.dataAsOf)) return "receipt has no as-of date";
  if (!/^[0-9a-f]{64}$/.test(r.responseSha256)) return "receipt has no response digest";
  return null;
}

/** Why a finding cannot be cited, or null when its provenance is complete. */
export function findingProvenanceProblem(f: AdverseFinding, sourceId: string): string | null {
  if (f.sourceId !== sourceId) return "finding names a different source than the adapter";
  if (!nonBlank(f.recordId)) return "finding has no record id";
  if (!isIsoDate(f.asOf)) return "finding has no as-of date";
  if (f.recordDate !== null && !isIsoDate(f.recordDate)) return "finding has an unparseable record date";
  const quoted = Object.entries(f.sourceFields ?? {}).filter(([k, v]) => nonBlank(k) && nonBlank(v));
  if (quoted.length === 0) return "finding quotes none of the source's own fields";
  const rel = f.relationship;
  if (!rel) return "finding has no relationship to the parcel";
  if (rel.kind === "within_query_radius") {
    if (!Number.isFinite(rel.radiusMiles) || rel.radiusMiles <= 0) return "finding relationship has no radius";
    if (rel.distanceMiles !== null && (!Number.isFinite(rel.distanceMiles) || rel.distanceMiles < 0)) {
      return "finding relationship has an invalid distance";
    }
  } else if (rel.kind !== "on_parcel") {
    return "finding has an unknown relationship kind";
  }
  return null;
}

// ── licence gate ───────────────────────────────────────────────────────────

/**
 * A source may be queried only when the data-licence register holds an entry
 * for it whose redistribution posture is "yes" or "attribution". A name that
 * is not in the register falls back to "review-required" there, so it is
 * excluded here.
 */
function licenceExclusionReason(adapter: HistoricalUseSourceAdapter): string | null {
  if (mayCacheAndRedistribute(adapter.licenseSource)) return null;
  const entry = licenseFor(adapter.licenseSource);
  return `licence unresolved: data-licence register posture for "${adapter.licenseSource}" is "${entry.redistributable}"`;
}

// ── aggregator ─────────────────────────────────────────────────────────────

const STATE_RE = /^[A-Z]{2}$/;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export async function runHistoricalUseScreening(
  subject: ParcelSubject,
  adapters: readonly HistoricalUseSourceAdapter[],
  options: { now: () => Date; knownUnscreened?: readonly NotScreenedEntry[] },
): Promise<ScreeningVerdict> {
  const screenedAt = options.now().toISOString();
  const findings: AdverseFinding[] = [];
  const truncatedSources: string[] = [];
  const verifiedAbsences: VerifiedAbsence[] = [];
  const inconclusive: InconclusiveItem[] = [];
  const notScreened: NotScreenedEntry[] = [...(options.knownUnscreened ?? [])];
  const answered = new Set<ScreeningCategory>();
  let synthetic = subject.synthetic === true;

  const subjectOk =
    STATE_RE.test(subject.state) &&
    Number.isFinite(subject.centroid?.lat) &&
    Number.isFinite(subject.centroid?.lng);

  if (!subjectOk) {
    inconclusive.push({
      sourceId: "subject",
      title: "Parcel",
      categories: SCREENING_CATEGORIES,
      reason: "parcel has no valid state code or centroid; no source was queried",
    });
  }

  const applicable = subjectOk ? adapters.filter((a) => a.appliesTo(subject)) : [];
  if (subjectOk && applicable.length === 0) {
    inconclusive.push({
      sourceId: "none",
      title: "No source",
      categories: SCREENING_CATEGORIES,
      reason: `no screening source applies to ${subject.state}`,
    });
  }

  for (const adapter of applicable) {
    const base = { sourceId: adapter.sourceId, title: adapter.title, categories: adapter.categories };

    const licence = licenceExclusionReason(adapter);
    if (licence) {
      notScreened.push({ ...base, reason: licence });
      continue;
    }

    let outcome: SourceOutcome;
    try {
      outcome = await adapter.query(subject);
    } catch (err) {
      outcome = {
        status: "unreachable",
        reason: err instanceof Error ? err.message : String(err),
        attemptedAt: options.now().toISOString(),
      };
    }

    switch (outcome.status) {
      case "unreachable":
        inconclusive.push({ ...base, reason: `source unreachable: ${outcome.reason}` });
        break;
      case "not_covering":
        inconclusive.push({ ...base, reason: `source does not cover this parcel: ${outcome.reason}` });
        break;
      case "unitemized_signal":
        inconclusive.push({
          ...base,
          reason: `source reported ${plural(outcome.count, "matching record")} but returned no record identifiers to cite`,
        });
        break;
      case "records_found": {
        const valid: AdverseFinding[] = [];
        for (const f of outcome.findings) {
          const problem = findingProvenanceProblem(f, adapter.sourceId);
          if (problem) {
            inconclusive.push({ ...base, reason: `a returned record could not be cited (${problem})` });
          } else {
            valid.push(f);
            if (f.synthetic) synthetic = true;
          }
        }
        if (valid.length === 0) {
          if (outcome.findings.length === 0) {
            inconclusive.push({ ...base, reason: "source reported records but listed none" });
          }
          break;
        }
        findings.push(...valid);
        for (const f of valid) answered.add(f.category);
        if (outcome.truncated) truncatedSources.push(adapter.sourceId);
        break;
      }
      case "no_records": {
        const problem =
          geometryProblem(outcome.geometry) ?? coverageProblem(outcome.coverage) ?? receiptProblem(outcome.receipt);
        if (problem || !outcome.geometry || !outcome.coverage || !outcome.receipt) {
          inconclusive.push({ ...base, reason: `empty answer rejected as an absence: ${problem ?? "incomplete"}` });
          break;
        }
        if (!adapter.absenceEligibility.eligible) {
          inconclusive.push({
            ...base,
            reason: `empty answer not accepted as an absence: ${adapter.absenceEligibility.reason}`,
          });
          break;
        }
        if (adapter.absenceEligibility.positiveControl.synthetic) synthetic = true;
        verifiedAbsences.push({
          ...base,
          geometry: outcome.geometry,
          coverage: outcome.coverage,
          asOf: outcome.receipt.dataAsOf,
          receipt: outcome.receipt,
        });
        for (const c of adapter.categories) answered.add(c);
        break;
      }
    }
  }

  const categoriesWithoutVerifiedAnswer = SCREENING_CATEGORIES.filter((c) => !answered.has(c));
  const common = {
    parcelRef: subject.parcelRef,
    state: subject.state,
    screenedAt,
    verifiedAbsences,
    inconclusive,
    notScreened,
    categoriesWithoutVerifiedAnswer,
    synthetic,
  };
  const tail =
    `${plural(inconclusive.length, "inconclusive item")}; ` +
    `${plural(notScreened.length, "source")} not screened; ` +
    `no verified answer for: ${categoriesWithoutVerifiedAnswer.join(", ") || "(none)"}.`;

  if (findings.length > 0) {
    return {
      ...common,
      verdict: "adverse_found",
      findings,
      truncatedSources,
      statement: `${plural(findings.length, "adverse record")} found with provenance. ${tail}`,
    };
  }
  if (inconclusive.length > 0 || verifiedAbsences.length === 0) {
    return {
      ...common,
      verdict: "inconclusive",
      statement: `Screening inconclusive — this is not a finding of no adverse use. ${tail}`,
    };
  }
  return {
    ...common,
    verdict: "no_adverse_found_in_verified_sources",
    statement:
      `No adverse records in ${plural(verifiedAbsences.length, "verified source")}: ` +
      verifiedAbsences.map((a) => `${a.title} (${a.coverage.geographic}; as of ${a.asOf})`).join("; ") +
      `. Only these sources and their stated coverage were checked. ${tail}`,
  };
}

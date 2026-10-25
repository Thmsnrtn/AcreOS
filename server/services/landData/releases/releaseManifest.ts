/**
 * Dataset releases (D2b) — the manifest and its content id.
 *
 * A RELEASE of the `acreos-parcels` dataset is a manifest: for every county it
 * covers, the exact bulk artifacts (bucket key + byte count + SHA-256, as the
 * bucket confirmed them on upload), the source snapshot they were built from
 * (ETL job, run, the layer's own as-of, the field map in force) and the
 * row-schema / normalizer version that shaped the rows. Nothing else.
 *
 * Its id is CONTENT-ADDRESSED: SHA-256 over a domain tag plus a canonical
 * serialization of the manifest (sorted keys, no whitespace, counties and
 * artifacts in a fixed order). Two manifests with the same content have the
 * same id however they were written down; any change to any byte of content —
 * one digest character, one parcel count — is a different id, and so a
 * different release. A release is therefore immutable by construction: there
 * is no operation that edits a release, only one that makes another.
 *
 * Deliberately NOT in the manifest (and so not in the id): when it was
 * assembled, who assembled it, its human name, and the release it replaced.
 * Those are facts ABOUT a release (the release row, the pointer history), not
 * its content — putting them in would make the same content two releases.
 *
 * Pure: no I/O, no clock, no DB. Spec: docs/land-data/d2b-releases-spec.md.
 */

import { createHash } from "node:crypto";

/** The dataset every release in this module belongs to. */
export const DATASET = "acreos-parcels";

/** The manifest format version. A change to the shape is a new tag, never a reinterpretation. */
export const MANIFEST_FORMAT = "acreos-parcels/release-manifest@1";

/** Hashed ahead of the canonical body, so a manifest id can never collide with any other sha256 we compute. */
const DOMAIN_TAG = `${MANIFEST_FORMAT}\n`;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RELEASE_ID = /^sha256:[0-9a-f]{64}$/;

export type ArtifactKind = "parquet" | "pmtiles";
const ARTIFACT_KINDS: readonly ArtifactKind[] = ["parquet", "pmtiles"];

export interface ReleaseArtifactRef {
  kind: ArtifactKind;
  /** Bucket identity the receipt names (openDataBucket.bucketIdentity). */
  bucket: string;
  objectKey: string;
  bytes: number;
  sha256: string;
}

export interface ReleaseSourceRef {
  /** ETL job name, e.g. nc_statewide_cadastral_v1. */
  job: string;
  /** etl_runs.id of the run that built the artifacts; null only when the build ran outside the orchestrator. */
  etlRunId: number | null;
  /** The live layer's own last-edit stamp at build time (ISO), or null when the layer states none. */
  sourceAsOf: string | null;
  layerUrl: string;
  /** SHA-256 over the canonical field map (canonical field → layer field) the build used. */
  fieldMappingDigest: string;
}

export interface ReleaseCountyEntry {
  /** Two-letter, upper case. */
  state: string;
  /** Normalized county name (ownedParcelStore.normalizeCountyName form). */
  county: string;
  /** Rows written to the parquet artifact (and read back) — the build's own count. */
  parcelCount: number;
  artifacts: ReleaseArtifactRef[];
  source: ReleaseSourceRef;
}

export interface ReleaseManifest {
  format: typeof MANIFEST_FORMAT;
  dataset: typeof DATASET;
  /** Row-schema + normalizer version, e.g. "bulk-row@1". Bumped when the artifact row shape or its normalizer changes. */
  mappingVersion: string;
  counties: ReleaseCountyEntry[];
}

// ── Canonical serialization ──────────────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted (UTF-16 code-unit order, as RFC 8785),
 * no whitespace, `undefined`-valued keys omitted (as JSON does). Refuses what
 * JSON cannot say exactly — a non-finite number, a bigint, a Date, a function,
 * `undefined` inside an array — rather than letting JSON.stringify silently
 * turn it into null or a string.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((v, i) => {
            if (v === undefined) throw new Error(`canonicalJson: undefined at array index ${i}`);
            return canonicalJson(v);
          })
          .join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(`canonicalJson: refusing a non-plain object (${(value as object).constructor?.name ?? "unknown"})`);
      }
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec)
        .filter((k) => rec[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: refusing a ${typeof value}`);
  }
}

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** The digest a ReleaseSourceRef carries for a field map. */
export function fieldMappingDigest(mapping: Readonly<Record<string, string | undefined>>): string {
  return sha256Hex(canonicalJson(mapping));
}

// ── Validation ───────────────────────────────────────────────────────────

export type ManifestCheck = { ok: true; manifest: ReleaseManifest } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function countyKey(state: string, county: string): string {
  return `${state}/${county}`;
}

/**
 * Validate an untrusted manifest (parsed JSON, a DB jsonb value) and return
 * it in canonical order. Every rule is a refusal with a plain reason; nothing
 * is defaulted, coerced or guessed.
 */
export function validateManifest(input: unknown): ManifestCheck {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["manifest is not an object"] };
  if (input.format !== MANIFEST_FORMAT) errors.push(`format must be "${MANIFEST_FORMAT}"`);
  if (input.dataset !== DATASET) errors.push(`dataset must be "${DATASET}"`);
  if (!isNonEmpty(input.mappingVersion)) errors.push("mappingVersion is required");
  const known = new Set(["format", "dataset", "mappingVersion", "counties"]);
  for (const k of Object.keys(input)) if (!known.has(k)) errors.push(`unknown manifest field "${k}" — it would be hashed but never read`);
  if (!Array.isArray(input.counties)) {
    errors.push("counties must be an array");
    return { ok: false, errors };
  }
  if (input.counties.length === 0) errors.push("a release covers at least one county");
  const seen = new Set<string>();
  const counties: ReleaseCountyEntry[] = [];
  input.counties.forEach((c: unknown, i: number) => {
    const at = `counties[${i}]`;
    if (!isRecord(c)) {
      errors.push(`${at} is not an object`);
      return;
    }
    const state = c.state;
    const county = c.county;
    if (typeof state !== "string" || !/^[A-Z]{2}$/.test(state)) errors.push(`${at}.state must be two upper-case letters`);
    if (typeof county !== "string" || county.length === 0 || county !== county.toLowerCase().replace(/ county$/i, "").replace(/-/g, " ").trim()) {
      errors.push(`${at}.county must be a normalized county name (lower case, no "county" suffix)`);
    }
    if (typeof state === "string" && typeof county === "string") {
      const k = countyKey(state, county);
      if (seen.has(k)) errors.push(`${at}: county ${k} appears twice`);
      seen.add(k);
    }
    if (!isNonNegInt(c.parcelCount)) errors.push(`${at}.parcelCount must be a non-negative integer`);
    const arts: ReleaseArtifactRef[] = [];
    if (!Array.isArray(c.artifacts)) errors.push(`${at}.artifacts must be an array`);
    else {
      const kinds = new Set<string>();
      c.artifacts.forEach((a: unknown, j: number) => {
        const aat = `${at}.artifacts[${j}]`;
        if (!isRecord(a)) {
          errors.push(`${aat} is not an object`);
          return;
        }
        if (typeof a.kind !== "string" || !ARTIFACT_KINDS.includes(a.kind as ArtifactKind)) errors.push(`${aat}.kind must be one of ${ARTIFACT_KINDS.join(", ")}`);
        else if (kinds.has(a.kind)) errors.push(`${aat}: two ${a.kind} artifacts for one county`);
        else kinds.add(a.kind);
        if (!isNonEmpty(a.bucket)) errors.push(`${aat}.bucket is required — an artifact without a confirmed bucket has no receipt`);
        if (!isNonEmpty(a.objectKey)) errors.push(`${aat}.objectKey is required`);
        if (!isNonNegInt(a.bytes) || a.bytes === 0) errors.push(`${aat}.bytes must be a positive integer`);
        if (typeof a.sha256 !== "string" || !SHA256_HEX.test(a.sha256)) errors.push(`${aat}.sha256 must be 64 lower-case hex characters`);
        arts.push({ kind: a.kind as ArtifactKind, bucket: String(a.bucket), objectKey: String(a.objectKey), bytes: Number(a.bytes), sha256: String(a.sha256) });
      });
      // The parquet artifact is the rows; a county without it cannot be served or diffed.
      if (!kinds.has("parquet")) errors.push(`${at} has no parquet artifact — the rows are what a release releases`);
    }
    const s = c.source;
    let source: ReleaseSourceRef | null = null;
    if (!isRecord(s)) errors.push(`${at}.source is required`);
    else {
      if (!isNonEmpty(s.job)) errors.push(`${at}.source.job is required`);
      if (!(s.etlRunId === null || (isNonNegInt(s.etlRunId) && s.etlRunId > 0))) errors.push(`${at}.source.etlRunId must be a positive integer or null`);
      if (!(s.sourceAsOf === null || (typeof s.sourceAsOf === "string" && !Number.isNaN(Date.parse(s.sourceAsOf))))) {
        errors.push(`${at}.source.sourceAsOf must be an ISO timestamp or null`);
      }
      if (!isNonEmpty(s.layerUrl)) errors.push(`${at}.source.layerUrl is required`);
      if (typeof s.fieldMappingDigest !== "string" || !SHA256_HEX.test(s.fieldMappingDigest)) errors.push(`${at}.source.fieldMappingDigest must be a sha256`);
      source = {
        job: String(s.job),
        etlRunId: s.etlRunId === null ? null : Number(s.etlRunId),
        sourceAsOf: s.sourceAsOf === null ? null : String(s.sourceAsOf),
        layerUrl: String(s.layerUrl),
        fieldMappingDigest: String(s.fieldMappingDigest),
      };
    }
    if (source) {
      counties.push({
        state: String(state),
        county: String(county),
        parcelCount: Number(c.parcelCount),
        artifacts: arts.sort((x, y) => ARTIFACT_KINDS.indexOf(x.kind) - ARTIFACT_KINDS.indexOf(y.kind)),
        source,
      });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  counties.sort((a, b) => compareUtf8(countyKey(a.state, a.county), countyKey(b.state, b.county)));
  return { ok: true, manifest: { format: MANIFEST_FORMAT, dataset: DATASET, mappingVersion: String(input.mappingVersion), counties } };
}

/** Byte order of the UTF-8 encodings — equal to code-point order, Postgres COLLATE "C", and parquet's unsigned byte order. */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// ── The content id ───────────────────────────────────────────────────────

/** The bytes a release id is the SHA-256 of. Exposed so the spec's claim ("this is what is hashed") is checkable. */
export function canonicalManifestBytes(m: ReleaseManifest): string {
  const check = validateManifest(m);
  if (!check.ok) throw new Error(`invalid release manifest: ${check.errors.join("; ")}`);
  return DOMAIN_TAG + canonicalJson(check.manifest);
}

/** `sha256:<64 hex>` over canonicalManifestBytes(). */
export function releaseIdOf(m: ReleaseManifest): string {
  return `sha256:${sha256Hex(canonicalManifestBytes(m))}`;
}

/** Parse + validate + id a manifest text. Whitespace and key order in the text cannot change the id. */
export function releaseIdFromJson(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`release manifest is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const check = validateManifest(parsed);
  if (!check.ok) throw new Error(`invalid release manifest: ${check.errors.join("; ")}`);
  return releaseIdOf(check.manifest);
}

export function isReleaseId(s: string): boolean {
  return RELEASE_ID.test(s);
}

/**
 * Re-derive a stored release's id from its stored manifest. A mismatch means
 * the stored manifest was edited after it was released — the one thing a
 * release may never be. Used on every read of a release row.
 */
export function verifyReleaseId(releaseId: string, manifest: unknown): { ok: true } | { ok: false; reason: string } {
  const check = validateManifest(manifest);
  if (!check.ok) return { ok: false, reason: `stored manifest is invalid: ${check.errors.join("; ")}` };
  const actual = releaseIdOf(check.manifest);
  return actual === releaseId ? { ok: true } : { ok: false, reason: `stored manifest hashes to ${actual}, not ${releaseId} — it was changed after release` };
}

// ── From a build to a county entry ───────────────────────────────────────

interface BuiltRef {
  objectKey: string;
  bytes: number;
  sha256: string;
}

/**
 * The slice of statewideCadastral's CountyBuildReport a release reads, stated
 * structurally so this pure module does not import the build (and its DB /
 * registry graph). A CountyBuildReport is assignable to it.
 */
export interface BuildForRelease {
  summary: { state: string; county: string; asOf: string | null };
  artifacts: { parquet: BuiltRef; pmtiles: BuiltRef; rowsWritten: number; rowsReadBack: number };
  outcome:
    | { status: "ingested"; receipts: ReadonlyArray<BuiltRef & { bucket: string }> }
    | { status: "dry_run_only"; reasons: string[] };
}

/**
 * The manifest entry for one county build. REFUSES a build whose outcome is
 * not "ingested": a dry run has no bucket receipt, and a release names only
 * artifacts the bucket confirmed. The artifact refs come from the RECEIPTS
 * (what landed), cross-checked against what was built.
 */
export function countyEntryFromBuild(
  report: BuildForRelease,
  source: { job: string; etlRunId: number | null; layerUrl: string; mapping: Readonly<Record<string, string | undefined>> },
): ReleaseCountyEntry {
  if (report.outcome.status !== "ingested") {
    throw new Error(`refused: ${report.summary.state} ${report.summary.county} was not ingested (${report.outcome.reasons.join("; ")}) — a release names only bucket-confirmed artifacts`);
  }
  const receipts = report.outcome.receipts;
  const artifacts: ReleaseArtifactRef[] = (["parquet", "pmtiles"] as const).map((kind) => {
    const built = report.artifacts[kind];
    const r = receipts.find((x) => x.objectKey === built.objectKey && x.sha256 === built.sha256 && x.bytes === built.bytes);
    if (!r) throw new Error(`refused: no receipt matches the built ${kind} artifact ${built.objectKey}`);
    return { kind, bucket: r.bucket, objectKey: r.objectKey, bytes: r.bytes, sha256: r.sha256 };
  });
  if (report.artifacts.rowsWritten !== report.artifacts.rowsReadBack) {
    throw new Error(`refused: ${report.summary.county} wrote ${report.artifacts.rowsWritten} rows but read back ${report.artifacts.rowsReadBack}`);
  }
  return {
    state: report.summary.state.toUpperCase(),
    county: report.summary.county.toLowerCase().replace(/ county$/i, "").replace(/-/g, " ").trim(),
    parcelCount: report.artifacts.rowsWritten,
    artifacts,
    source: {
      job: source.job,
      etlRunId: source.etlRunId,
      sourceAsOf: report.summary.asOf,
      layerUrl: source.layerUrl,
      fieldMappingDigest: fieldMappingDigest(source.mapping),
    },
  };
}

// ── The inventory summary (D2g reads this) ───────────────────────────────

export interface ReleaseSummary {
  releaseId: string;
  dataset: typeof DATASET;
  /** `acreos-parcels vYYYY.MM.N` once promoted; null for a release never promoted. */
  name: string | null;
  mappingVersion: string;
  states: string[];
  countyCount: number;
  parcelCount: number;
  artifactCount: number;
  artifactBytes: number;
  /** Per-state roll-up, states in code-point order. */
  byState: Array<{ state: string; counties: number; parcels: number }>;
}

export function summarizeRelease(m: ReleaseManifest, name: string | null = null): ReleaseSummary {
  const id = releaseIdOf(m);
  const byState = new Map<string, { counties: number; parcels: number }>();
  let parcels = 0;
  let artifactCount = 0;
  let artifactBytes = 0;
  for (const c of m.counties) {
    parcels += c.parcelCount;
    const s = byState.get(c.state) ?? { counties: 0, parcels: 0 };
    s.counties += 1;
    s.parcels += c.parcelCount;
    byState.set(c.state, s);
    for (const a of c.artifacts) {
      artifactCount += 1;
      artifactBytes += a.bytes;
    }
  }
  const states = Array.from(byState.keys()).sort(compareUtf8);
  return {
    releaseId: id,
    dataset: DATASET,
    name,
    mappingVersion: m.mappingVersion,
    states,
    countyCount: m.counties.length,
    parcelCount: parcels,
    artifactCount,
    artifactBytes,
    byState: states.map((s) => ({ state: s, ...byState.get(s)! })),
  };
}

/**
 * Self-healing source adapters — D2d (Amendment 2 §2.2).
 *
 * On schema drift (the D1b/D2a refusal: the live layer no longer carries a
 * mapped field) the adapter:
 *   1. PROPOSES a remap from the live layer's own metadata. Each missing field
 *      gets a candidate only when exactly one unmapped live field is a clear,
 *      type-compatible match (same name modulo punctuation/case, its alias, or
 *      a close name with a clear margin over the runner-up). An ambiguous or
 *      missing match is no proposal — a remap is never a best guess.
 *   2. VERIFIES the proposal against the state's golden county
 *      (shared/landData/goldenCounty.ts): every assessor-verified parcel is
 *      re-read from the LIVE layer through the proposed mapping and must
 *      reproduce every verified value exactly. A remapped field the golden set
 *      does not verify cannot be verified, so the remap is not promoted.
 *   3. PROMOTES only on a verification pass. Anything else leaves the build's
 *      refusal exactly as it was.
 *
 * Every attempt — promoted or not — is logged with the before/after mappings
 * and the verification evidence in the run's observation (etl_runs, the
 * append-only per-run series, D1 A4). The active mapping of a source is the
 * latest PROMOTED remap in its job's run series, else the verified seed. The
 * per-source promotion rate is an ops metric (D2g): a source that remaps often
 * is a source to replace, not to nurse.
 */

import type { BulkParcelRecord } from "@shared/landData/bulkParcelRecord";
import { goldenCountyFor, goldenMismatches, verifiedParcels, type GoldenParcel, type VerifiedField } from "@shared/landData/goldenCounty";
import {
  CANONICAL_FIELDS,
  normalizeFeature,
  type CanonicalField,
  type FieldMapping,
  type LayerDeps,
  type LayerField,
  type SchemaDriftError,
  type StatewideBuildSpec,
} from "../landData/statewideCadastral";

const NUMERIC_TYPES = new Set(["esriFieldTypeDouble", "esriFieldTypeSingle", "esriFieldTypeInteger", "esriFieldTypeSmallInteger", "esriFieldTypeBigInteger"]);
const TEXT_TYPES = new Set(["esriFieldTypeString"]);
const NUMERIC_CANONICAL: ReadonlySet<CanonicalField> = new Set(["assessedValue", "marketValue", "lastSalePrice"]);

/** Which golden-verified field proves a canonical field's mapping (apn: the parcel id itself). */
const PROVEN_BY: Readonly<Record<CanonicalField, VerifiedField | "parcelId" | null>> = {
  apn: "parcelId",
  owner: "ownerName",
  address: "situsAddress",
  assessedValue: "assessedValueUsd",
  marketValue: "marketValueUsd",
  lastSalePrice: "lastSalePriceUsd",
  legalDescription: null,
};

const MIN_SCORE = 0.75;
const MIN_MARGIN = 0.15;

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams of the normalized names. */
function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  // A clean prefix extension (JV → JV_2025, PARCEL → PARCEL_ID) is a common
  // rename shape that bigram overlap underrates for short names. It is still
  // only a candidate: two such extensions are ambiguous, and any match must
  // reproduce the golden county before it is promoted.
  if (x.startsWith(y) || y.startsWith(x)) return 0.85;
  const bx = bigrams(x);
  const by = bigrams(y);
  const pool = new Map<string, number>();
  for (const g of by) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of bx) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hits += 1;
      pool.set(g, n - 1);
    }
  }
  return (2 * hits) / (bx.length + by.length);
}

function typeFits(field: CanonicalField, live: LayerField): boolean {
  if (field === "apn") return TEXT_TYPES.has(live.type) || NUMERIC_TYPES.has(live.type);
  return NUMERIC_CANONICAL.has(field) ? NUMERIC_TYPES.has(live.type) : TEXT_TYPES.has(live.type);
}

export interface FieldProposal {
  field: CanonicalField;
  from: string;
  to: string;
  score: number;
  /** How the candidate was matched — the reviewer's "why". */
  basis: string;
}

export type RemapProposal =
  | { ok: true; mapping: FieldMapping; fields: FieldProposal[] }
  | { ok: false; why: string; fields: FieldProposal[] };

/** Propose a remap for every mapped field the live layer no longer carries. */
export function proposeRemap(drift: Pick<SchemaDriftError, "missing" | "liveFields" | "mapping">): RemapProposal {
  const used = new Set(Object.values(drift.mapping).filter((f): f is string => !!f));
  const live = drift.liveFields.filter((f) => !used.has(f.name));
  const fields: FieldProposal[] = [];
  const mapping: FieldMapping = { ...drift.mapping };
  const taken = new Set<string>();
  for (const missingName of drift.missing) {
    const field = (CANONICAL_FIELDS as readonly CanonicalField[]).find((k) => drift.mapping[k] === missingName);
    if (!field) return { ok: false, why: `missing field ${missingName} is not one the normalizer maps`, fields };
    const scored = live
      .filter((l) => typeFits(field, l) && !taken.has(l.name))
      .map((l) => {
        const byName = similarity(missingName, l.name);
        const byAlias = l.alias ? similarity(missingName, l.alias) : 0;
        const score = Math.max(byName, byAlias * 0.98);
        const basis = byName === 1 ? "same name modulo case/punctuation" : byAlias >= byName ? `alias "${l.alias}" matches` : `name similarity ${byName.toFixed(2)}`;
        return { l, score, basis };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1]?.score ?? 0;
    if (!best || best.score < MIN_SCORE) return { ok: false, why: `no live field is a clear match for ${field} (${missingName})`, fields };
    if (best.score - second < MIN_MARGIN) {
      return { ok: false, why: `ambiguous: ${best.l.name} and ${scored[1]?.l.name} both match ${field} (${missingName})`, fields };
    }
    fields.push({ field, from: missingName, to: best.l.name, score: Number(best.score.toFixed(3)), basis: best.basis });
    mapping[field] = best.l.name;
    taken.add(best.l.name);
  }
  return { ok: true, mapping, fields };
}

export interface ParcelCheck {
  slot: number;
  sourceParcelId: string | null;
  found: number;
  mismatches: string[];
}

export interface RemapVerification {
  passed: boolean;
  why: string;
  goldenCounty: string | null;
  checked: ParcelCheck[];
  /** Remapped canonical fields the golden set cannot prove. */
  unprovable: CanonicalField[];
}

/**
 * Re-read every verified golden parcel from the LIVE layer through `proposed`
 * and compare to ground truth. A parcel id matching several features is
 * disambiguated by the attributes recorded with the golden parcel (e.g. the
 * county code) on fields the remap did not touch; still several = a failure.
 */
export async function verifyRemap(
  spec: StatewideBuildSpec,
  proposal: Extract<RemapProposal, { ok: true }>,
  deps: LayerDeps,
): Promise<RemapVerification> {
  const golden = goldenCountyFor(spec.state);
  const parcels = verifiedParcels(golden);
  const base = { goldenCounty: golden?.county ?? null, checked: [] as ParcelCheck[] };
  const unprovable = proposal.fields.map((f) => f.field).filter((f) => {
    const proof = PROVEN_BY[f];
    if (proof === null) return true;
    if (proof === "parcelId") return false;
    return !parcels.some((p) => p.assessorVerified && proof in p.assessorVerified);
  });
  if (parcels.length === 0) return { ...base, passed: false, why: `${spec.state} has no established golden county — a remap cannot be verified`, unprovable };
  if (unprovable.length > 0) return { ...base, passed: false, why: `the golden county verifies no value for ${unprovable.join(", ")} — that remap cannot be proven`, unprovable };

  const proposedSpec: StatewideBuildSpec = { ...spec, mapping: proposal.mapping };
  const apnField = proposal.mapping.apn as string;
  const remappedFrom = new Set(proposal.fields.map((f) => f.from));
  const checked: ParcelCheck[] = [];
  for (const p of parcels) {
    const where = `${apnField} = '${String(p.sourceParcelId).replace(/'/g, "''")}'`;
    const params = new URLSearchParams({ where, outFields: "*", returnGeometry: "false", f: "json" });
    const res = await deps.getJson(`${spec.layerUrl}/query?${params}`);
    const body = res.body as { features?: Array<{ attributes: Record<string, unknown> }>; error?: { message?: string } } | null;
    if (!res.ok || !body || body.error) {
      checked.push({ slot: p.slot, sourceParcelId: p.sourceParcelId, found: 0, mismatches: [`live query failed (${body?.error?.message ?? `HTTP ${res.status}`})`] });
      continue;
    }
    let feats = body.features ?? [];
    if (feats.length > 1) feats = feats.filter((f) => recordedAttributesAgree(p, f.attributes, remappedFrom));
    if (feats.length !== 1) {
      checked.push({ slot: p.slot, sourceParcelId: p.sourceParcelId, found: feats.length, mismatches: [feats.length === 0 ? "not found in the live layer" : "several live features match — ambiguous"] });
      continue;
    }
    const rec: BulkParcelRecord | null = normalizeFeature(proposedSpec, { attributes: feats[0].attributes, geometry: null }, { asOf: null, county: golden?.county ?? null });
    checked.push({ slot: p.slot, sourceParcelId: p.sourceParcelId, found: 1, mismatches: goldenMismatches(p, rec) });
  }
  const failed = checked.filter((c) => c.mismatches.length > 0);
  return {
    goldenCounty: golden?.county ?? null,
    checked,
    unprovable,
    passed: failed.length === 0,
    why: failed.length === 0 ? `all ${checked.length} golden parcels reproduce their assessor-verified values through the proposed mapping` : `${failed.length} of ${checked.length} golden parcels do not reproduce ground truth`,
  };
}

function recordedAttributesAgree(p: GoldenParcel, live: Record<string, unknown>, remappedFrom: ReadonlySet<string>): boolean {
  const recorded = p.sourceAttributes ?? {};
  return Object.entries(recorded).every(([k, v]) => remappedFrom.has(k) || !(k in live) || String(live[k]) === String(v));
}

export type RemapOutcome = "promoted" | "no_proposal" | "rejected";

export interface RemapAttempt {
  kind: "adapter_remap";
  state: string;
  at: string;
  outcome: RemapOutcome;
  missing: string[];
  mappingBefore: FieldMapping;
  mappingAfter: FieldMapping | null;
  proposal: RemapProposal;
  verification: RemapVerification | null;
}

/** Propose → verify → decide. Never throws for a failed heal; the caller keeps its refusal. */
export async function healDrift(spec: StatewideBuildSpec, drift: SchemaDriftError, deps: LayerDeps, now: Date): Promise<RemapAttempt> {
  const proposal = proposeRemap(drift);
  const base = { kind: "adapter_remap" as const, state: spec.state, at: now.toISOString(), missing: drift.missing, mappingBefore: drift.mapping, proposal };
  if (!proposal.ok) return { ...base, outcome: "no_proposal", mappingAfter: null, verification: null };
  const verification = await verifyRemap(spec, proposal, deps);
  return verification.passed
    ? { ...base, outcome: "promoted", mappingAfter: proposal.mapping, verification }
    : { ...base, outcome: "rejected", mappingAfter: null, verification };
}

/**
 * The active mapping for a job from its run series (newest first): the
 * mapping of the most recent PROMOTED remap, or null (= use the verified seed).
 */
export function activeMappingFromRuns(observations: ReadonlyArray<Record<string, unknown> | null>): FieldMapping | null {
  for (const o of observations) {
    const remap = (o?.remap ?? null) as RemapAttempt | null;
    if (remap?.outcome === "promoted" && remap.mappingAfter) return remap.mappingAfter;
  }
  return null;
}

/** Load the active mapping for a job from etl_runs (the production read). */
export async function loadActiveMapping(jobName: string): Promise<FieldMapping | null> {
  const { db } = await import("../../db");
  const { etlJobs, etlRuns } = await import("@shared/schema");
  const { desc, eq, isNotNull, and } = await import("drizzle-orm");
  const rows = await db
    .select({ observation: etlRuns.observation })
    .from(etlRuns)
    .innerJoin(etlJobs, eq(etlRuns.jobId, etlJobs.id))
    .where(and(eq(etlJobs.jobName, jobName), isNotNull(etlRuns.observation)))
    .orderBy(desc(etlRuns.startedAt))
    .limit(200);
  return activeMappingFromRuns(rows.map((r) => (r.observation ?? null) as Record<string, unknown> | null));
}

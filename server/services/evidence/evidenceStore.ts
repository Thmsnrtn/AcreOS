/**
 * EvidenceStore — the impure half of the Evidence Fabric.
 *
 * The pure half (vocabulary + deterministic resolution policy) lives in
 * shared/evidence/claim.ts and performs no I/O. This module does the I/O:
 * persisting claims, reading them back, and resolving a subject's current
 * answers through the shared policy.
 *
 * THE ANTI-CORRUPTION BOUNDARY (BI175)
 * ------------------------------------
 * This module speaks ONLY the canonical `EvidenceClaimInput` vocabulary. The
 * translation from a provider's shape happens next door, in
 * ./enrichmentToClaims.ts — the single place a vendor payload becomes an AcreOS
 * claim. That separation is what keeps Law 10 (providers are replaceable
 * machinery behind AcreOS-owned semantic contracts) true as vendors change:
 * swapping Regrid for a county ArcGIS feed changes that adapter and nothing
 * else — not this store, not resolution, not decision snapshots, not Pax.
 *
 * APPEND-ONLY
 * -----------
 * There is deliberately no `update` here. Re-observing a fact records a NEW
 * claim; the resolution policy decides which one currently wins. A store that
 * can update a claim is a store whose history can be rewritten, and Law 6
 * depends on that being impossible.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not fetch. Acquisition, caching, circuit-breaking, credit deduction
 * and licence gating all remain the provider registry's job
 * (server/services/providers/provider-registry.ts) — this module only records
 * what that layer already learned. Keeping the two apart is why the Evidence
 * Fabric needs no second data-acquisition architecture (BI15).
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { evidenceClaims, type InsertEvidenceClaimRow } from "@shared/schema";
import {
  isKnownPredicate,
  predicateById,
  resolveAll,
  resolveClaims,
  type EvidenceClaim,
  type EvidenceClaimInput,
  type EvidenceSubjectType,
  type ResolvedValue,
} from "@shared/evidence/claim";
import { logger } from "../../utils/logger";

/** Read cap — a subject with more claims than this has a runaway writer. */
const CLAIM_READ_CAP = 2_000;

// ── Row ⇄ domain mapping ──────────────────────────────────────────────────

function toInsertRow(
  organizationId: number,
  input: EvidenceClaimInput,
): InsertEvidenceClaimRow {
  const spec = predicateById(input.predicate);
  // Callers are expected to have validated; this is the last line of defence.
  if (!spec) {
    throw new Error(
      `evidenceStore: "${input.predicate}" is not a registered predicate — ` +
        `add it to PREDICATES in shared/evidence/claim.ts before recording claims about it`,
    );
  }
  const v = input.value;
  return {
    organizationId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    predicate: input.predicate,
    valueKind: spec.kind,
    valueText: typeof v === "string" ? v : v === null ? null : String(v),
    valueNumber: typeof v === "number" ? v : null,
    valueBool: typeof v === "boolean" ? v : null,
    provider: input.provider,
    source: input.source,
    authority: input.authority,
    observedAt: input.observedAt,
    fetchedAt: input.fetchedAt,
    providerConfidence: input.providerConfidence,
    license: input.license,
    costCents: input.costCents,
  };
}

function fromRow(row: typeof evidenceClaims.$inferSelect): EvidenceClaim {
  const kind = row.valueKind;
  let value: string | number | boolean | null;
  if (kind === "number") value = row.valueNumber;
  else if (kind === "boolean") value = row.valueBool;
  else value = row.valueText;

  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    predicate: row.predicate,
    value,
    provider: row.provider,
    source: row.source,
    authority: row.authority,
    observedAt: row.observedAt,
    fetchedAt: row.fetchedAt,
    providerConfidence: row.providerConfidence,
    license: row.license,
    costCents: row.costCents,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────

/**
 * Record claims. Append-only: this never updates or deletes.
 *
 * Claims naming an unregistered predicate are DROPPED with a warning rather
 * than written, and rather than throwing. Refusing the unknown fact is correct
 * (an unregistered predicate is a bug, not a fact) but an enrichment run must
 * not fail wholesale because one adapter started returning a field the
 * vocabulary has not adopted yet.
 *
 * @returns the number of claims actually written
 */
export async function recordClaims(
  organizationId: number,
  claims: readonly EvidenceClaimInput[],
): Promise<number> {
  if (claims.length === 0) return 0;

  const accepted: EvidenceClaimInput[] = [];
  const rejected: string[] = [];
  for (const c of claims) {
    if (isKnownPredicate(c.predicate)) accepted.push(c);
    else rejected.push(c.predicate);
  }
  if (rejected.length > 0) {
    logger.warn(
      `[evidence] dropped ${rejected.length} claim(s) with unregistered predicate(s): ` +
        `${[...new Set(rejected)].join(", ")} — register them in shared/evidence/claim.ts`,
    );
  }
  if (accepted.length === 0) return 0;

  const rows = accepted.map((c) => toInsertRow(organizationId, c));
  await db.insert(evidenceClaims).values(rows);
  return rows.length;
}

// ── Read ──────────────────────────────────────────────────────────────────

/**
 * Every claim about one subject, oldest first (chronology is the point).
 *
 * Module-private on purpose: callers want RESOLVED facts, and an exported raw
 * reader invites a caller to re-implement resolution badly. `resolveSubject`
 * below is the public read. (`claimsForPredicate` IS exported, because the
 * evidence-lineage route legitimately needs the unresolved history.)
 */
async function claimsForSubject(
  organizationId: number,
  subjectType: EvidenceSubjectType,
  subjectId: number,
): Promise<EvidenceClaim[]> {
  const rows = await db
    .select()
    .from(evidenceClaims)
    .where(
      and(
        eq(evidenceClaims.organizationId, organizationId),
        eq(evidenceClaims.subjectType, subjectType),
        eq(evidenceClaims.subjectId, subjectId),
      ),
    )
    .orderBy(asc(evidenceClaims.fetchedAt))
    .limit(CLAIM_READ_CAP);
  return rows.map(fromRow);
}

/** Every claim about one subject for one predicate. */
export async function claimsForPredicate(
  organizationId: number,
  subjectType: EvidenceSubjectType,
  subjectId: number,
  predicate: string,
): Promise<EvidenceClaim[]> {
  const rows = await db
    .select()
    .from(evidenceClaims)
    .where(
      and(
        eq(evidenceClaims.organizationId, organizationId),
        eq(evidenceClaims.subjectType, subjectType),
        eq(evidenceClaims.subjectId, subjectId),
        eq(evidenceClaims.predicate, predicate),
      ),
    )
    .orderBy(desc(evidenceClaims.fetchedAt))
    .limit(CLAIM_READ_CAP);
  return rows.map(fromRow);
}

/** Resolve every predicate we hold claims for, as of a moment. */
export async function resolveSubject(
  organizationId: number,
  subjectType: EvidenceSubjectType,
  subjectId: number,
  asOf: Date = new Date(),
): Promise<Map<string, ResolvedValue>> {
  return resolveAll(
    await claimsForSubject(organizationId, subjectType, subjectId),
    asOf,
  );
}

/**
 * Resolve ONE predicate, as of a moment.
 *
 * Always returns an answer — `unknown` when nothing is known. That is the point
 * of Law 3: a caller can never accidentally receive `undefined` and coerce it
 * into a default.
 */
export async function resolveFact(
  organizationId: number,
  subjectType: EvidenceSubjectType,
  subjectId: number,
  predicate: string,
  asOf: Date = new Date(),
): Promise<ResolvedValue> {
  const claims = await claimsForPredicate(
    organizationId,
    subjectType,
    subjectId,
    predicate,
  );
  return resolveClaims(predicate, claims, asOf);
}

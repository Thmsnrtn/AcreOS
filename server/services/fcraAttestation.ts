/**
 * RS-1 (post-may1-resweep): FCRA permissible-purpose attestation gate.
 *
 * Cordelia §3: "AcreOS today cannot produce per-lookup attestation
 * records per Phineas §2.4. […] Sublimit privacy claims at $25K until
 * per-lookup attestation + audit ships."
 *
 * Two attestation surfaces:
 *   1. Org-level annual click-through (`fcra_attestations` row, scoped
 *      to (organizationId, userId, attestation_version), refreshed
 *      annually). Tracks the operator's commitment to FCRA-permissible-
 *      purpose discipline.
 *   2. Per-lookup record (`tenant_screenings` row, with purpose +
 *      requesting user + attestation version). Created BEFORE the
 *      screening fields on `tenants` are updated; the route reads
 *      this row to verify a recent attestation exists.
 *
 * Routes that update tenant screening data MUST call
 * `assertScreeningPermitted()` first.
 */

import { db } from "../db";
import { fcraAttestations, tenantScreenings } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

export const CURRENT_FCRA_ATTESTATION_VERSION = "2026-05-08-v1";
const ATTESTATION_TTL_DAYS = 365;
const ATTESTATION_TTL_MS = ATTESTATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export type PurposeOfUse =
  | "tenant_screening"
  | "account_review"
  | "written_consent"
  | "legitimate_business_need";

export const ALL_PURPOSES_OF_USE: PurposeOfUse[] = [
  "tenant_screening",
  "account_review",
  "written_consent",
  "legitimate_business_need",
];

export class FcraAttestationStaleError extends Error {
  readonly code = "FCRA_ATTESTATION_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "FcraAttestationStaleError";
  }
}

export class TenantScreeningNotAttestedError extends Error {
  readonly code = "TENANT_SCREENING_NOT_ATTESTED" as const;
  constructor(message: string) {
    super(message);
    this.name = "TenantScreeningNotAttestedError";
  }
}

/**
 * Lookup the latest org+user attestation. Returns the row if one exists
 * and is younger than ATTESTATION_TTL_DAYS; otherwise null.
 */
export async function getCurrentAttestation(orgId: number, userId: string) {
  const [row] = await db
    .select()
    .from(fcraAttestations)
    .where(and(
      eq(fcraAttestations.organizationId, orgId),
      eq(fcraAttestations.userId, userId),
    ))
    .orderBy(desc(fcraAttestations.attestedAt))
    .limit(1);
  if (!row) return null;
  const age = Date.now() - new Date(row.attestedAt).getTime();
  if (age > ATTESTATION_TTL_MS) return null;
  if (row.attestationVersion !== CURRENT_FCRA_ATTESTATION_VERSION) return null;
  return row;
}

/**
 * Record a fresh attestation (operator clicked the annual checkbox).
 * Returns the inserted row.
 */
export async function recordAttestation(opts: {
  organizationId: number;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const [row] = await db.insert(fcraAttestations).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
    ipAddress: opts.ipAddress ?? null,
    userAgent: opts.userAgent ?? null,
  }).returning();
  logger.info(`[FCRA] Attestation recorded for org=${opts.organizationId} user=${opts.userId}`);
  return row;
}

/**
 * Assert the operator has a current attestation AND a recent
 * tenant_screenings row exists for this tenant. Throws otherwise.
 *
 * Use at the entry point of any route that mutates tenant screening data
 * on the `tenants` table.
 */
export async function assertScreeningPermitted(opts: {
  organizationId: number;
  userId: string;
  tenantId: string;
  /** When true (default), require a tenant_screenings row attested by
   *  this user within the last hour for THIS tenant. Set to false for
   *  endpoints that just read screening data. */
  requirePerLookupRow?: boolean;
}): Promise<void> {
  const requirePerLookupRow = opts.requirePerLookupRow ?? true;

  const orgAttestation = await getCurrentAttestation(opts.organizationId, opts.userId);
  if (!orgAttestation) {
    throw new FcraAttestationStaleError(
      `Annual FCRA attestation required (current version ${CURRENT_FCRA_ATTESTATION_VERSION}). ` +
      `Visit /account/fcra-attestation to attest before running tenant screenings.`,
    );
  }

  if (!requirePerLookupRow) return;

  const oneHourAgo = new Date(Date.now() - 60 * 60_000);
  const [recent] = await db
    .select()
    .from(tenantScreenings)
    .where(and(
      eq(tenantScreenings.organizationId, opts.organizationId),
      eq(tenantScreenings.tenantId, opts.tenantId),
      eq(tenantScreenings.requestingUserId, opts.userId),
    ))
    .orderBy(desc(tenantScreenings.attestedAt))
    .limit(1);

  if (!recent || new Date(recent.attestedAt) < oneHourAgo) {
    throw new TenantScreeningNotAttestedError(
      `Per-lookup permissible-purpose attestation required for this tenant. ` +
      `POST /api/tenants/:id/attest-screening with { purposeOfUse, justification? } before updating screening fields. ` +
      `Existing attestations expire after 1 hour.`,
    );
  }
}

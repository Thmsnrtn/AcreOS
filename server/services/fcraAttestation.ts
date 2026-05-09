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
  | "legitimate_business_need"
  | "collection";

export const ALL_PURPOSES_OF_USE: PurposeOfUse[] = [
  "tenant_screening",
  "account_review",
  "written_consent",
  "legitimate_business_need",
  "collection",
];

export type SkipTracePurposeOfUse = Extract<
  PurposeOfUse,
  "collection" | "legitimate_business_need" | "written_consent" | "account_review"
>;

export const SKIP_TRACE_PURPOSES: SkipTracePurposeOfUse[] = [
  "collection",
  "legitimate_business_need",
  "written_consent",
  "account_review",
];

export class SkipTracePurposeRequiredError extends Error {
  readonly code = "SKIP_TRACE_PURPOSE_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "SkipTracePurposeRequiredError";
  }
}

/**
 * FW-WYNNE-1 (push-forward 2026-05-08): permissible-purpose gate for
 * skip-trace lookups. Mirrors `assertScreeningPermitted` but does not
 * require a per-tenant pre-row — instead the caller passes purpose +
 * justification inline and we assert the org-level annual attestation.
 *
 * Throws `FcraAttestationStaleError` if the org+user is not attested,
 * `SkipTracePurposeRequiredError` if purpose/justification are missing.
 */
export async function assertSkipTracePermitted(opts: {
  organizationId: number;
  userId: string;
  purposeOfUse: string | null | undefined;
  justification: string | null | undefined;
}): Promise<{ attestationVersion: string }> {
  if (!opts.purposeOfUse || !SKIP_TRACE_PURPOSES.includes(opts.purposeOfUse as SkipTracePurposeOfUse)) {
    throw new SkipTracePurposeRequiredError(
      `Skip-trace requires purposeOfUse ∈ {${SKIP_TRACE_PURPOSES.join(", ")}}. ` +
      `FCRA §1681b(a)(3) — operator must claim a permissible purpose at query time.`,
    );
  }
  if (!opts.justification || opts.justification.trim().length < 10) {
    throw new SkipTracePurposeRequiredError(
      `Skip-trace requires a justification ≥10 characters describing the purpose. ` +
      `Required for class-action defense audit trail.`,
    );
  }
  const orgAttestation = await getCurrentAttestation(opts.organizationId, opts.userId);
  if (!orgAttestation) {
    throw new FcraAttestationStaleError(
      `Annual FCRA attestation required (current version ${CURRENT_FCRA_ATTESTATION_VERSION}). ` +
      `Visit /account/fcra-attestation to attest before running skip-traces.`,
    );
  }
  return { attestationVersion: orgAttestation.attestationVersion };
}

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
 * Panel-300 G4 — substantive 3-screen FCRA attestation form.
 *
 * Wynne's "theater that works in depositions" standard: the bare
 * checkbox is replaced by a structured form capturing:
 *   - permissible-purpose enum (with constrained list)
 *   - free-text use-case (≥50 chars; the operator must explain WHY)
 *   - data-categories the operator will use (multi-select)
 *   - operator role within the organization
 *   - explicit acknowledgement of adverse-action duty + retention
 *
 * Stored on `fcra_attestations.substantive_form` (jsonb column shipped
 * by FW-WYNNE-2). Replaces the bare-checkbox attestation when the
 * operator submits the live form.
 */
export interface SubstantiveAttestationForm {
  permissiblePurpose: PurposeOfUse;
  specificUseCase: string;
  dataCategoriesUsed: string[];
  operatorRole: "owner" | "property_manager" | "leasing_agent" | "screening_specialist";
  acknowledgedAdverseActionDuty: boolean;
  acknowledgedDataRetentionPolicy: boolean;
}

export class SubstantiveAttestationError extends Error {
  readonly code = "FCRA_SUBSTANTIVE_FORM_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "SubstantiveAttestationError";
  }
}

export function validateSubstantiveForm(input: unknown): SubstantiveAttestationForm {
  if (!input || typeof input !== "object") {
    throw new SubstantiveAttestationError("Substantive form is required");
  }
  const form = input as Partial<SubstantiveAttestationForm>;
  if (!form.permissiblePurpose || !ALL_PURPOSES_OF_USE.includes(form.permissiblePurpose as PurposeOfUse)) {
    throw new SubstantiveAttestationError(
      `permissiblePurpose must be one of ${ALL_PURPOSES_OF_USE.join(", ")}`,
    );
  }
  if (!form.specificUseCase || form.specificUseCase.trim().length < 50) {
    throw new SubstantiveAttestationError(
      "specificUseCase ≥50 chars required — the operator must explain WHY this lookup is permissible",
    );
  }
  if (!Array.isArray(form.dataCategoriesUsed) || form.dataCategoriesUsed.length === 0) {
    throw new SubstantiveAttestationError(
      "dataCategoriesUsed must list ≥1 category (credit / criminal / eviction / income / address / phone / email)",
    );
  }
  const VALID_ROLES = ["owner", "property_manager", "leasing_agent", "screening_specialist"];
  if (!form.operatorRole || !VALID_ROLES.includes(form.operatorRole)) {
    throw new SubstantiveAttestationError(`operatorRole must be one of ${VALID_ROLES.join(", ")}`);
  }
  if (form.acknowledgedAdverseActionDuty !== true) {
    throw new SubstantiveAttestationError(
      "acknowledgedAdverseActionDuty must be true — operator confirms the duty to send adverse-action notices",
    );
  }
  if (form.acknowledgedDataRetentionPolicy !== true) {
    throw new SubstantiveAttestationError(
      "acknowledgedDataRetentionPolicy must be true — operator confirms data-retention policy",
    );
  }
  return form as SubstantiveAttestationForm;
}

/**
 * Record a substantive attestation (panel-300 G4). Replaces the bare-
 * checkbox `recordAttestation` when the operator goes through the
 * 3-screen form. Throws SubstantiveAttestationError if the form fails
 * validation.
 */
export async function recordSubstantiveAttestation(opts: {
  organizationId: number;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  substantiveForm: SubstantiveAttestationForm;
}) {
  const validated = validateSubstantiveForm(opts.substantiveForm);
  const [row] = await db.insert(fcraAttestations).values({
    organizationId: opts.organizationId,
    userId: opts.userId,
    attestationVersion: CURRENT_FCRA_ATTESTATION_VERSION,
    ipAddress: opts.ipAddress ?? null,
    userAgent: opts.userAgent ?? null,
    substantiveForm: validated as any,
  }).returning();
  logger.info(
    `[FCRA G4] Substantive attestation recorded for org=${opts.organizationId} user=${opts.userId} purpose=${validated.permissiblePurpose} role=${validated.operatorRole}`,
  );
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

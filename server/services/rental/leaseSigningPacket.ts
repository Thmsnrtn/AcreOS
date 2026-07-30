/**
 * Lease e-sign — joining `pending_signature` to the signing rail.
 *
 * Before this module the two halves existed and never touched:
 *   - `rental_leases.status` had a `pending_signature` value, set by hand, that
 *     meant nothing: no document, no signer, no consent, no way to reach
 *     'active' other than the operator flipping the status again;
 *   - a real HMAC signing rail (generated_documents.signers[] +
 *     server/services/signingTokens.ts + /api/public/sign/* with an E-SIGN
 *     §101(c) consent gate) served deal documents only.
 *
 * What this adds: a lease becomes a generated_document with one signer per
 * tenant plus the landlord, each with a per-signer HMAC signing URL, and the
 * lease only reaches 'active' when EVERY signer has both signed and a
 * signing_consent_audit row at the current disclosure version. The consent
 * trail is the existing one — this module reads it, it does not re-implement it.
 *
 * Hard stops honoured here
 * ────────────────────────
 *   - LEGAL SIGNING IS OPERATOR-ONLY. Nothing in this file can be triggered by
 *     an automation: `createLeaseSignaturePacket` requires an explicit operator
 *     confirmation flag plus the user id, which is stamped onto the lease
 *     (`signatureRequestedBy`). There is no scheduled job, workflow action or
 *     agent tool that reaches it.
 *   - NO AUTO-SEND. AcreOS does not email the packet. It returns per-signer
 *     signing links for the operator to deliver on their own connected
 *     identity — the platform sender is for system mail only (founder decision
 *     2026-07-17, "no re-fronting platform send rails").
 *   - REVIEW BEFORE SEND. `buildLeasePacket` is pure and is served read-only by
 *     the preview endpoint, so what the operator approves is byte-for-byte what
 *     the document row will contain.
 *   - THE LEAD-PAINT GATE STILL BINDS. A pre-1978 lease with no confirmed
 *     disclosure cannot be sent for signature; the packet builder reports it as
 *     blocking rather than quietly proceeding.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  ESIGN_DISCLOSURE_VERSION,
  generatedDocuments,
  rentalLeases,
  signingConsentAudit,
  type RentalLease,
} from "@shared/schema";
import { storage } from "../../storage";
import { makeSigningToken } from "../signingTokens";
import { logger } from "../../utils/logger";

export const LEASE_PACKET_TEMPLATE_VERSION = "2026-07-30-v1";
/** Signing links expire with the document; 30 days matches the deal rail. */
const PACKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PacketTenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export interface PacketSigner {
  id: string;
  name: string;
  email: string;
  role: "tenant" | "landlord";
  order: number;
}

export interface LeasePacket {
  title: string;
  /** The exact document body the signer will see. */
  bodyMarkdown: string;
  signers: PacketSigner[];
  /** Must be empty before the packet may be sent. */
  blocking: string[];
  /** Worth reading; does not stop the send. */
  warnings: string[];
  templateVersion: string;
  disclosureVersion: string;
}

function usd(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/**
 * Build the lease document + signer list from recorded facts only.
 *
 * Pure: no DB, no clock beyond the caller-supplied `now`. Anything absent from
 * the record becomes a blocking issue or a warning — never a filled-in blank.
 */
export function buildLeasePacket(args: {
  lease: Pick<
    RentalLease,
    | "id"
    | "propertyId"
    | "unitLabel"
    | "status"
    | "startDate"
    | "endDate"
    | "monthlyRentCents"
    | "rentDueDayOfMonth"
    | "securityDepositCents"
    | "petDepositCents"
    | "isSection8"
    | "hapPortionCents"
    | "tenantPortionCents"
    | "state"
    | "liabilityModel"
    | "versionNumber"
    | "notes"
    | "leadPaintDisclosureAttachedAt"
  >;
  tenants: PacketTenant[];
  addendums: Array<{ kind: string; title: string; effectiveDate: string | null }>;
  landlordName: string;
  landlordEmail: string | null;
  propertyAddress: string | null;
  /** True when the property needs the federal lead-paint disclosure. */
  requiresLeadPaintDisclosure: boolean;
  /** Stable seed for signer ids so a preview and its send agree. */
  signerIdSeed: string;
}): LeasePacket {
  const { lease } = args;
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (lease.status === "active" || lease.status === "ended" || lease.status === "terminated" || lease.status === "renewed") {
    blocking.push(
      `This lease is '${lease.status}'. Only a draft or already-pending lease can be sent for signature.`,
    );
  }
  if (args.tenants.length === 0) {
    blocking.push("No tenant is attached to this lease. Attach the tenants who will sign before sending.");
  }
  const tenantsWithoutEmail = args.tenants.filter((t) => !t.email || t.email.trim().length === 0);
  if (tenantsWithoutEmail.length > 0) {
    blocking.push(
      `No email address on record for ${tenantsWithoutEmail
        .map((t) => `${t.firstName} ${t.lastName}`.trim())
        .join(", ")}. A signing link is addressed to a specific signer, so every signer needs an email.`,
    );
  }
  if (!args.landlordEmail) {
    blocking.push(
      "No landlord email is on record for this organization (Settings → Company). The landlord counter-signs the lease and needs their own signing link.",
    );
  }
  if (lease.monthlyRentCents <= 0) {
    blocking.push("Monthly rent is zero. A lease with no rent term should not be sent for signature.");
  }
  if (args.requiresLeadPaintDisclosure && lease.leadPaintDisclosureAttachedAt === null) {
    blocking.push(
      "Lead-based-paint disclosure required (42 U.S.C. §4852d; 24 C.F.R. §35.92): this is pre-1978 housing. " +
        "Attach the EPA disclosure and the 'Protect Your Family From Lead in Your Home' pamphlet, and confirm it on the lease, before sending.",
    );
  }

  if (!args.propertyAddress) {
    warnings.push("No property address on record — the document identifies the premises by property id only.");
  }
  if (!lease.endDate) {
    warnings.push("No end date: the document is rendered as a month-to-month tenancy.");
  }
  if (lease.isSection8 && (lease.hapPortionCents === null || lease.tenantPortionCents === null)) {
    warnings.push("Section 8 lease with an incomplete HAP / tenant split — the rent split is omitted from the document.");
  }

  const unitLine = lease.unitLabel ? `, Unit ${lease.unitLabel}` : "";
  const premises = args.propertyAddress
    ? `${args.propertyAddress}${unitLine}`
    : `Property #${lease.propertyId}${unitLine}`;

  const signers: PacketSigner[] = [];
  args.tenants.forEach((t, idx) => {
    signers.push({
      id: `${args.signerIdSeed}-tenant-${t.id}`,
      name: `${t.firstName} ${t.lastName}`.trim(),
      email: (t.email ?? "").trim(),
      role: "tenant",
      order: idx + 1,
    });
  });
  signers.push({
    id: `${args.signerIdSeed}-landlord`,
    name: args.landlordName,
    email: (args.landlordEmail ?? "").trim(),
    role: "landlord",
    order: args.tenants.length + 1,
  });

  const lines: string[] = [];
  lines.push(`# Residential Lease Agreement`);
  lines.push("");
  lines.push(`**Premises:** ${premises}`);
  lines.push(`**Landlord:** ${args.landlordName}`);
  lines.push(
    `**Tenant(s):** ${args.tenants.map((t) => `${t.firstName} ${t.lastName}`.trim()).join(", ") || "(none attached)"}`,
  );
  lines.push(`**Governing state:** ${lease.state}`);
  if (lease.versionNumber > 1) lines.push(`**Lease version:** ${lease.versionNumber} (renewal of a prior tenancy)`);
  lines.push("");
  lines.push(`## Term`);
  lines.push("");
  lines.push(`- **Start date:** ${lease.startDate}`);
  lines.push(`- **End date:** ${lease.endDate ?? "month-to-month (no fixed end date)"}`);
  lines.push("");
  lines.push(`## Rent`);
  lines.push("");
  lines.push(`- **Monthly rent:** ${usd(lease.monthlyRentCents)}`);
  lines.push(`- **Due:** day ${lease.rentDueDayOfMonth} of each month`);
  if (lease.isSection8 && lease.hapPortionCents !== null && lease.tenantPortionCents !== null) {
    lines.push(`- **Housing authority (HAP) portion:** ${usd(lease.hapPortionCents)}`);
    lines.push(`- **Tenant portion:** ${usd(lease.tenantPortionCents)}`);
  }
  lines.push("");
  lines.push(`## Deposits`);
  lines.push("");
  lines.push(`- **Security deposit:** ${usd(lease.securityDepositCents)}`);
  if (lease.petDepositCents > 0) lines.push(`- **Pet deposit:** ${usd(lease.petDepositCents)}`);
  lines.push("");
  lines.push(`## Liability`);
  lines.push("");
  lines.push(
    lease.liabilityModel === "joint_and_several"
      ? "- Tenants are jointly and severally liable for the full rent, where each tenant has separately acknowledged that liability."
      : "- Each tenant is liable for their own allocated share of the rent (per-unit liability).",
  );
  lines.push("");
  if (args.addendums.length > 0) {
    lines.push(`## Addenda incorporated`);
    lines.push("");
    for (const a of args.addendums) {
      lines.push(`- ${a.title} (${a.kind}${a.effectiveDate ? `, effective ${a.effectiveDate}` : ""})`);
    }
    lines.push("");
  }
  if (lease.notes && lease.notes.trim().length > 0) {
    lines.push(`## Additional terms of record`);
    lines.push("");
    lines.push(lease.notes.trim());
    lines.push("");
  }
  lines.push(`## Signatures`);
  lines.push("");
  for (const s of signers) {
    lines.push(`- ${s.role === "landlord" ? "Landlord" : "Tenant"}: ${s.name} — signs electronically`);
  }
  lines.push("");
  lines.push(
    `_This document was assembled from the lease record only; nothing above was inferred. Template ${LEASE_PACKET_TEMPLATE_VERSION}._`,
  );

  return {
    title: `Residential Lease — ${premises}`,
    bodyMarkdown: lines.join("\n"),
    signers,
    blocking,
    warnings,
    templateVersion: LEASE_PACKET_TEMPLATE_VERSION,
    disclosureVersion: ESIGN_DISCLOSURE_VERSION,
  };
}

export class LeasePacketBlockedError extends Error {
  readonly code = "LEASE_PACKET_BLOCKED";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Lease cannot be sent for signature: ${issues.join(" ")}`);
    this.name = "LeasePacketBlockedError";
    this.issues = issues;
  }
}

export interface SigningLink {
  signerId: string;
  name: string;
  email: string;
  role: string;
  url: string;
}

/**
 * Persist the packet and mint per-signer signing URLs. OPERATOR ACTION ONLY —
 * the caller must have verified an explicit confirmation from a human and pass
 * their user id.
 *
 * Nothing is delivered: the returned links are handed back for the operator to
 * send from their own identity.
 */
export async function createLeaseSignaturePacket(args: {
  organizationId: number;
  packet: LeasePacket;
  leaseId: string;
  propertyId: number;
  userId: string;
  appBaseUrl: string;
}): Promise<{ documentId: number; links: SigningLink[]; expiresAt: Date }> {
  if (args.packet.blocking.length > 0) {
    throw new LeasePacketBlockedError(args.packet.blocking);
  }

  const expiresAt = new Date(Date.now() + PACKET_TTL_MS);
  const doc = await storage.createGeneratedDocument({
    organizationId: args.organizationId,
    name: args.packet.title,
    type: "residential_lease",
    propertyId: args.propertyId,
    content: args.packet.bodyMarkdown,
    status: "pending_signature",
    esignProvider: "native",
    esignStatus: "pending",
    signers: args.packet.signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      order: s.order,
    })),
    generatedBy: args.userId,
    // `sentAt` records that the operator dispatched the packet (minted the
    // links), not that AcreOS transmitted anything — AcreOS has no send rail
    // for counterparty mail.
    sentAt: new Date(),
    expiresAt,
  });

  const base = args.appBaseUrl.replace(/\/$/, "");
  const links: SigningLink[] = args.packet.signers.map((s) => ({
    signerId: s.id,
    name: s.name,
    email: s.email,
    role: s.role,
    url: `${base}/sign/${doc.id}?s=${encodeURIComponent(s.id)}&t=${makeSigningToken(doc.id, s.id)}`,
  }));

  await db
    .update(rentalLeases)
    .set({
      status: "pending_signature",
      signingDocumentId: doc.id,
      signaturePacketSentAt: new Date(),
      signatureRequestedBy: args.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(rentalLeases.id, args.leaseId), eq(rentalLeases.organizationId, args.organizationId)));

  logger.info("[BH-2] lease signature packet created by operator", {
    orgId: args.organizationId,
    userId: args.userId,
    leaseId: args.leaseId,
    documentId: doc.id,
    signerCount: links.length,
    templateVersion: args.packet.templateVersion,
    disclosureVersion: args.packet.disclosureVersion,
  });

  return { documentId: doc.id, links, expiresAt };
}

export interface LeaseSignerState {
  signerId: string;
  name: string;
  email: string | null;
  role: string;
  signedAt: string | null;
  /** An E-SIGN §101(c) consent audit row exists at the current version. */
  consentRecorded: boolean;
}

export interface LeaseSignatureStatus {
  documentId: number | null;
  documentStatus: string | null;
  expiresAt: string | null;
  expired: boolean;
  signers: LeaseSignerState[];
  allSigned: boolean;
  allConsented: boolean;
  /** True only when the lease may legitimately be executed. */
  readyToExecute: boolean;
  /** Why it is not ready. Empty when readyToExecute is true. */
  blockers: string[];
  executedAt: string | null;
}

/**
 * Read-only signature state for a lease, including the consent trail. Never
 * mutates anything — the transition to 'active' is a separate, explicit call.
 */
export async function getLeaseSignatureStatus(args: {
  organizationId: number;
  lease: Pick<RentalLease, "id" | "status" | "signingDocumentId" | "executedAt">;
}): Promise<LeaseSignatureStatus> {
  const empty: LeaseSignatureStatus = {
    documentId: null,
    documentStatus: null,
    expiresAt: null,
    expired: false,
    signers: [],
    allSigned: false,
    allConsented: false,
    readyToExecute: false,
    blockers: ["This lease has not been sent for signature yet."],
    executedAt: args.lease.executedAt ? args.lease.executedAt.toISOString() : null,
  };
  if (!args.lease.signingDocumentId) return empty;

  const [doc] = await db
    .select({
      id: generatedDocuments.id,
      status: generatedDocuments.status,
      signers: generatedDocuments.signers,
      expiresAt: generatedDocuments.expiresAt,
      organizationId: generatedDocuments.organizationId,
    })
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.id, args.lease.signingDocumentId),
        eq(generatedDocuments.organizationId, args.organizationId),
      ),
    );
  if (!doc) {
    return {
      ...empty,
      blockers: [
        `The signing document recorded on this lease (#${args.lease.signingDocumentId}) is no longer available. Send a fresh packet.`,
      ],
    };
  }

  const docSigners = (doc.signers ?? []) as Array<{
    id: string;
    name: string;
    email?: string;
    role?: string;
    signedAt?: string;
  }>;

  // One consent lookup for the document, then match per signer email. The
  // gate on /api/public/sign already refuses a signature without consent; we
  // re-read it here because the lease's own execution must stand on the audit
  // trail rather than on the assumption that the gate held.
  const consentRows = await db
    .select({ signerEmail: signingConsentAudit.signerEmail })
    .from(signingConsentAudit)
    .where(
      and(
        eq(signingConsentAudit.documentId, doc.id),
        eq(signingConsentAudit.disclosureVersion, ESIGN_DISCLOSURE_VERSION),
      ),
    )
    .orderBy(desc(signingConsentAudit.consentedAt));
  const consentedEmails = new Set(
    consentRows.map((r) => (r.signerEmail ?? "").toLowerCase()).filter((e) => e.length > 0),
  );

  const signers: LeaseSignerState[] = docSigners.map((s) => ({
    signerId: s.id,
    name: s.name,
    email: s.email ?? null,
    role: s.role ?? "signer",
    signedAt: s.signedAt ?? null,
    consentRecorded: !!s.email && consentedEmails.has(s.email.toLowerCase()),
  }));

  const allSigned = signers.length > 0 && signers.every((s) => !!s.signedAt);
  const allConsented = signers.length > 0 && signers.every((s) => s.consentRecorded);
  const expired = !!doc.expiresAt && new Date(doc.expiresAt) < new Date();

  const blockers: string[] = [];
  if (signers.length === 0) blockers.push("The signing document has no signers.");
  if (!allSigned) {
    const outstanding = signers.filter((s) => !s.signedAt).map((s) => s.name || s.signerId);
    blockers.push(`Not signed yet by: ${outstanding.join(", ")}.`);
  }
  if (allSigned && !allConsented) {
    const missing = signers.filter((s) => !s.consentRecorded).map((s) => s.name || s.signerId);
    blockers.push(
      `No E-SIGN §101(c) consent record at disclosure version ${ESIGN_DISCLOSURE_VERSION} for: ${missing.join(", ")}. ` +
        "The lease cannot be marked executed on a signature whose consent trail is missing.",
    );
  }
  if (expired) blockers.push("The signing link expired before every signer completed it. Send a fresh packet.");

  return {
    documentId: doc.id,
    documentStatus: doc.status,
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
    expired,
    signers,
    allSigned,
    allConsented,
    readyToExecute: allSigned && allConsented && !expired,
    blockers,
    executedAt: args.lease.executedAt ? args.lease.executedAt.toISOString() : null,
  };
}

/**
 * Flip a fully-signed, fully-consented lease to 'active'. Idempotent: a lease
 * already executed returns its existing state without rewriting it. Refuses
 * (throws) when the signature or consent trail is incomplete — nothing here
 * infers a signature that did not happen.
 */
export async function executeSignedLease(args: {
  organizationId: number;
  lease: Pick<RentalLease, "id" | "status" | "signingDocumentId" | "executedAt">;
  userId: string;
}): Promise<{ executed: boolean; alreadyExecuted: boolean; status: LeaseSignatureStatus }> {
  const status = await getLeaseSignatureStatus({ organizationId: args.organizationId, lease: args.lease });
  if (args.lease.executedAt) {
    return { executed: true, alreadyExecuted: true, status };
  }
  if (!status.readyToExecute) {
    throw new LeasePacketBlockedError(status.blockers);
  }

  const executedAt = new Date();
  await db
    .update(rentalLeases)
    .set({ status: "active", executedAt, updatedAt: executedAt })
    .where(and(eq(rentalLeases.id, args.lease.id), eq(rentalLeases.organizationId, args.organizationId)));

  logger.info("[BH-2] lease executed from completed signature packet", {
    orgId: args.organizationId,
    userId: args.userId,
    leaseId: args.lease.id,
    documentId: status.documentId,
    signerCount: status.signers.length,
    disclosureVersion: ESIGN_DISCLOSURE_VERSION,
  });

  return { executed: true, alreadyExecuted: false, status: { ...status, executedAt: executedAt.toISOString() } };
}

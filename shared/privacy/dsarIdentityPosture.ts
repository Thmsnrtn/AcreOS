/**
 * The ONE named DSAR identity posture and record of record (PKG-1 §1–§2,
 * docs/pkg1-dsar-design-2026-11.md).
 *
 * Every DSAR export / erasure gate reads its switches from here rather than
 * hard-coding them; the verify-identity route reads `acceptedMethods` and
 * `minEvidenceNoteChars` from here. Swapping the posture when counsel answers
 * Q-C1/Q-C2/Q-C3 means editing this object — nothing else.
 *
 * Pure, no imports. Sits next to dsarClock.ts.
 */

/** The DSAR record system every founder export / verify / erasure acts on (§1, C-8). */
export const DSAR_RECORD_OF_RECORD = "dsar_requests_lifecycle" as const;

export const DSAR_IDENTITY_POSTURE = {
  id: "strict-operator-attested-exact-email-v1",
  /** A founder must record an identity check on the DSAR record before any action. */
  requireOperatorVerification: true,
  /** The subject's email on file must equal the DSAR requester email exactly (case-insensitive). */
  requireExactEmailMatch: true,
  /** Account-less (lead/borrower) subjects are acted on one organization at a time. */
  leadSubjectsPerOrganization: true,
  acceptedMethods: [
    "signed_in_account_request",   // the intake came from the subject's own authenticated session (routes-gdpr shim)
    "operator_email_loop",         // founder confirmed by a reply from the address on file — sent by the founder by hand; AcreOS sends nothing
    "operator_document_check",     // founder checked a government ID or equivalent out-of-band
    "controller_org_attestation",  // the customer org (the controller for its leads) attested in writing
  ] as const,
  minEvidenceNoteChars: 20,
  /** Quotable statement — PR bodies and the UI quote this verbatim. */
  statement:
    "AcreOS acts on a data-subject request only after a founder records an identity check on that request, " +
    "and only for a subject whose email on file exactly matches the requester's email. A person without an " +
    "AcreOS account (a lead or borrower) is handled one customer organization at a time: a phone, name or " +
    "address match never qualifies, and the same email in another organization is a separate subject. This " +
    "is the strictest plausible default, pending counsel's identity-verification standard (Q-C1/Q-C2/Q-C3).",
} as const;

export type DsarVerificationMethod = (typeof DSAR_IDENTITY_POSTURE.acceptedMethods)[number];

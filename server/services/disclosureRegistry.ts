/**
 * Per-State Legal Disclosure Registry
 *
 * Some U.S. states require statutory disclosure language to appear verbatim
 * (or substantially verbatim) inside specific document types. Sending a
 * document without the required disclosure can void the contract and, in
 * the case of Texas executory contracts, expose the seller to criminal
 * liability (Class B misdemeanor under Tex. Prop. Code § 5.069 / § 5.072).
 *
 * Audit references:
 *   - Cesar §1
 *   - Marguerite §3.2
 *   - Cordelia §2.1
 *
 * This registry is the SINGLE source of truth used by `checkDisclosure()`
 * which is called from the document-dispatch pipeline (e.g.
 * `eSigningService.sendDocumentForSignature`) to BLOCK dispatch when a
 * required disclosure is missing.
 *
 * IMPORTANT — accuracy disclaimer:
 *   Statute text is reproduced from publicly available codifications of
 *   the cited statutes as of late 2024 / early 2025. Statutory text can
 *   change at any session of the legislature. The founder MUST verify
 *   the embedded text with counsel before relying on it for production
 *   document generation. Where the exact wording could not be verified,
 *   the registry intentionally throws so the system fails closed rather
 *   than dispatching a non-compliant document.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisclosureRequirement {
  /** Two-letter USPS state code, uppercase. */
  state: string;
  /**
   * Internal document type identifier. Match against
   * `generated_documents.type` (or the equivalent caller-supplied label),
   * normalized to lowercase + snake_case.
   */
  docType: string;
  /** Statute citation, e.g. "Tex. Prop. Code § 5.069". */
  statuteCitation: string;
  /**
   * Exact heading text the disclosure block must contain.
   * Matched case-insensitively, but the WORDS must appear contiguously.
   */
  requiredHeading: string;
  /**
   * Additional phrases that must each appear somewhere in the document
   * body (case-insensitive substring match). These are sentinel phrases
   * pulled from the statutory text — not the entire statute.
   */
  requiredBodyKeyPhrases: string[];
  /** Human-friendly label surfaced to the operator UI on rejection. */
  friendlyName: string;
  /**
   * If true, `checkDisclosure` will throw rather than return a structured
   * result. Used when the registry entry has not yet been populated with
   * verified statutory text — fail-closed instead of sending a bad doc.
   */
  unverified?: boolean;
  /** Optional message included in the thrown error for unverified entries. */
  unverifiedReason?: string;
}

export type DisclosureCheckResult =
  | { ok: true }
  | { ok: false; missing: DisclosureRequirement; missingHeading: boolean; missingPhrases: string[] };

// ---------------------------------------------------------------------------
// Statute text constants
// ---------------------------------------------------------------------------

/**
 * Texas Property Code § 5.069 — Seller's Disclosure of Property Conditions
 * required on every executory contract for the conveyance of real property
 * (contract for deed / installment land contract).
 *
 * The statute additionally requires the § 5.072 "WARNING" notice to appear
 * directly above the buyer's signature line. We embed the canonical heading
 * phrase here and several sentinel sub-phrases the statute requires to be
 * present. Operators MUST include the FULL § 5.069 disclosure text in the
 * generated document — this validator only checks that the heading and
 * key phrases are present.
 *
 * Source: Texas Property Code § 5.069 (effective per 2021 amendments;
 * reproduced from the Texas Statutes online portal). VERIFY WITH COUNSEL
 * before production use.
 */
const TX_5069_HEADING =
  "SELLER'S DISCLOSURE OF PROPERTY CONDITION AS REQUIRED BY TEXAS PROPERTY CODE SECTION 5.069";

const TX_5069_KEY_PHRASES = [
  // Subsection (a)(1): provide a survey or, if not, a current plat with
  // legal description & lot lines.
  "current survey",
  // Subsection (a)(2): notice of liens, restrictions, easements.
  "liens, restrictions, and easements",
  // Subsection (a)(3): statement of any known defects.
  "known defects",
  // Subsection (a)(4): tax certificate / payment status of taxes.
  "tax certificate",
  // § 5.072 buyer-warning text required directly above signature line.
  "WARNING: THIS DOCUMENT CREATES A LIEN ON THE PROPERTY",
  // Statute self-citation requirement.
  "TEXAS PROPERTY CODE SECTION 5.069",
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DISCLOSURE_REQUIREMENTS: DisclosureRequirement[] = [
  {
    state: "TX",
    docType: "contract_for_deed",
    statuteCitation: "Tex. Prop. Code § 5.069 (with § 5.072 buyer-warning notice)",
    requiredHeading: TX_5069_HEADING,
    requiredBodyKeyPhrases: TX_5069_KEY_PHRASES,
    friendlyName: "Texas Contract-for-Deed Buyer Disclosure (§ 5.069)",
  },
  // ---------------------------------------------------------------------
  // New York — UCC Article 3 § 3-307 (negotiable-instrument signature
  // presumption / acknowledgment) on note dispatches.
  //
  // We have NOT been able to verify a single canonical disclosure block
  // for NY note dispatches that satisfies § 3-307 in 2025. The registry
  // therefore flags this entry as `unverified` so `checkDisclosure`
  // throws — the system fails closed and refuses to dispatch a NY note
  // until counsel populates the verbatim language here.
  // ---------------------------------------------------------------------
  {
    state: "NY",
    docType: "note_dispatch",
    statuteCitation: "N.Y. U.C.C. § 3-307",
    requiredHeading: "<<NY § 3-307 DISCLOSURE — NOT YET POPULATED>>",
    requiredBodyKeyPhrases: [],
    friendlyName: "New York Negotiable-Instrument Disclosure (§ 3-307)",
    unverified: true,
    unverifiedReason:
      "NY § 307 disclosure registry incomplete — populate before sending notes in NY",
  },
];

// ---------------------------------------------------------------------------
// Lookup + check
// ---------------------------------------------------------------------------

function normalizeState(state: string): string {
  return (state || "").trim().toUpperCase();
}

function normalizeDocType(docType: string): string {
  return (docType || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function findDisclosureRequirement(
  state: string,
  docType: string
): DisclosureRequirement | undefined {
  const s = normalizeState(state);
  const d = normalizeDocType(docType);
  return DISCLOSURE_REQUIREMENTS.find(
    (r) => r.state === s && normalizeDocType(r.docType) === d
  );
}

/**
 * Validate that `content` contains the disclosure block required for the
 * given `(state, docType)` pair.
 *
 * Returns:
 *   - `{ ok: true }` if no requirement is registered, OR if the content
 *     contains the required heading and every required body phrase.
 *   - `{ ok: false, missing, missingHeading, missingPhrases }` if a
 *     requirement is registered and the content is non-compliant.
 *
 * Throws:
 *   - `Error` if a requirement is registered but its statute text has not
 *     yet been verified (`unverified: true`). This is intentional — we
 *     fail closed rather than passing a document that may legally
 *     require unknown disclosure language.
 */
export function checkDisclosure(
  state: string,
  docType: string,
  content: string
): DisclosureCheckResult {
  const requirement = findDisclosureRequirement(state, docType);
  if (!requirement) return { ok: true };

  if (requirement.unverified) {
    throw new Error(
      requirement.unverifiedReason ||
        `Disclosure registry entry for ${requirement.state} ${requirement.docType} is unverified — populate before dispatch.`
    );
  }

  const haystack = (content || "").toString();
  const haystackUpper = haystack.toUpperCase();

  const missingHeading = !haystackUpper.includes(
    requirement.requiredHeading.toUpperCase()
  );

  const missingPhrases = requirement.requiredBodyKeyPhrases.filter(
    (phrase) => !haystackUpper.includes(phrase.toUpperCase())
  );

  if (missingHeading || missingPhrases.length > 0) {
    return { ok: false, missing: requirement, missingHeading, missingPhrases };
  }

  return { ok: true };
}

/**
 * Build a structured error payload suitable for returning to the client
 * via `Errors.badRequest(res, message, details)`. The shape is documented
 * for the front-end so it can prompt the operator to populate the
 * disclosure block before retrying dispatch.
 */
export function buildDisclosureMissingPayload(
  result: Extract<DisclosureCheckResult, { ok: false }>
): {
  code: "DISCLOSURE_MISSING";
  state: string;
  docType: string;
  statute: string;
  requiredHeading: string;
  missingHeading: boolean;
  missingPhrases: string[];
  friendlyName: string;
} {
  return {
    code: "DISCLOSURE_MISSING",
    state: result.missing.state,
    docType: result.missing.docType,
    statute: result.missing.statuteCitation,
    requiredHeading: result.missing.requiredHeading,
    missingHeading: result.missingHeading,
    missingPhrases: result.missingPhrases,
    friendlyName: result.missing.friendlyName,
  };
}

/**
 * Tax-advisory disclaimer — Beatrice / compliance-debt §4.
 *
 * The product computes tax numbers in several places (the founder tax engine /
 * Life-Cockpit, the taxOptimizer year-end position + recommendations, and any
 * Pax tax response) with no single ENFORCED "informational, not tax advice"
 * primitive. This mirrors the well-done compliance constants
 * `SCREENING_ADVISORY_COPY` (server/services/compliance/ofacScreening.ts) and
 * `AUDIT_CHAIN_TAMPER_EVIDENCE_COPY` (server/services/compliance/auditChain.ts):
 * one centralized string so the non-advice framing is identical everywhere it
 * surfaces.
 *
 * Wire this onto every tax-output path: attach it to the response payload
 * (e.g. a `disclaimer` field) and render it adjacent to any computed tax figure
 * in the UI. AcreOS does not provide tax advice; these are estimates the user
 * must verify before filing or acting on.
 */
export const TAX_ADVISORY_COPY =
  "Informational only — not tax advice. AcreOS computes these figures from the data " +
  "you provide using general rules; they are estimates, may be incomplete, and do not " +
  "account for your full circumstances. Verify every number and consult a qualified " +
  "tax professional before filing or acting on it.";

/**
 * Shorter one-liner for tight UI surfaces (badges, tooltips, inline labels)
 * where the full paragraph doesn't fit. Same framing, fewer words.
 */
export const TAX_ADVISORY_SHORT = "Informational only — not tax advice. Verify with a tax professional.";

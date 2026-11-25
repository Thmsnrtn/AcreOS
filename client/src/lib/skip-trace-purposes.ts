/**
 * FCRA §1681b permissible purposes accepted by the server's skip-trace gate
 * (SKIP_TRACE_PURPOSES in server/services/fcraAttestation.ts). Every skip-trace
 * POST requires purposeOfUse + a ≥10-char justification; traces without them
 * are refused. Shared by the /skip-tracing page and the lead-page panel so the
 * vocabulary cannot drift between the two doors.
 */
export const SKIP_TRACE_PURPOSES = [
  { value: "collection", label: "Collection of a debt owed by this person" },
  { value: "legitimate_business_need", label: "Legitimate business need — transaction initiated by this person" },
  { value: "written_consent", label: "Written consent from this person" },
  { value: "account_review", label: "Review of an existing account" },
] as const;

export const MIN_JUSTIFICATION_CHARS = 10;

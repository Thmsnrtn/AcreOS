import { actionContentHash } from "../../utils/actionContentHash";

/** Binds the displayed review row and render metadata; does not attest file bytes or provider configuration. */
export function cmoReviewRevision(item: { id: number; contextBundle?: unknown; actionPayload?: unknown; [key: string]: unknown }, renders: readonly { id: string; [key: string]: unknown }[]): string {
  // Serialize Dates as the API does before canonicalization; Date objects themselves have no enumerable keys.
  const snapshot = JSON.parse(JSON.stringify({ item, renders: [...renders].sort((a, b) => a.id.localeCompare(b.id)) })) as Record<string, unknown>;
  return actionContentHash("cmo.review", snapshot);
}

/**
 * The ONE vocabulary for "what can AcreOS do with this county's parcel
 * records?" (W10.3). The list builder behind the Map door and the
 * "request this county" coverage route both answer in these words, so a
 * county never reads "covered" on one surface and "unavailable" on another.
 *
 * The split between `covered` and `view_only` is the licensing rule
 * (Beatrice, shared/schema/parcel-data.ts): a county_gis_endpoints row whose
 * `redistributable` is 'yes' or 'attribution' may be SAVED into an org's
 * leads; anything else (the default is 'review-required') is live
 * pass-through only — it can be counted and previewed, never saved. Whether a
 * review-required county may be saved is a founder licensing decision; this
 * file only reads the column, it never decides it.
 *
 * Pure and browser-safe: the client renders the same labels.
 */

/** In order of usefulness: what a list can be saved from first, never-requested last. */
export const COUNTY_LIST_STATUSES = [
  "covered",
  "view_only",
  "discovering",
  "queued",
  "unavailable",
  "none",
] as const;

export type CountyListStatus = (typeof COUNTY_LIST_STATUSES)[number];

/** Customer-facing label + one sentence for each status. */
export const COUNTY_STATUS_COPY: Readonly<Record<CountyListStatus, { label: string; message: string }>> = {
  covered: {
    label: "Covered",
    message: "We read this county's public parcel records live, and lists from it can be counted and saved.",
  },
  view_only: {
    label: "View only",
    message:
      "We read this county's public parcel records live, but its terms of use haven't been reviewed yet, so you can count and preview lists but not save them.",
  },
  discovering: {
    label: "Searching",
    message: "We're searching for a free public parcel source for this county now.",
  },
  queued: {
    label: "Requested",
    message: "This county has been requested and is waiting to be searched for a free parcel source.",
  },
  unavailable: {
    label: "Unavailable",
    message: "We searched and found no usable free parcel source for this county.",
  },
  none: {
    label: "Not requested",
    message: "Nobody has requested this county yet.",
  },
};

/**
 * The sentence for a county whose source WENT DARK: a `resolved` discovery
 * row with no active endpoint left (DEFECT-0113). It is `unavailable`, but
 * not "we found nothing" — something was found and stopped answering, and
 * requesting it again re-opens the search. The coverage route
 * (/api/county-coverage) and the list builder both say exactly this.
 */
export const COUNTY_SOURCE_WENT_DARK_MESSAGE =
  "This county's parcel source is no longer responding. Request it again to re-open the search.";

/** The redistribution postures that permit saving county records into an org's leads. */
const SAVEABLE_POSTURES = new Set(["yes", "attribution"]);

const posture = (redistributable: string | null | undefined) => (redistributable ?? "").trim().toLowerCase();

/**
 * The view-only sentence for a county whose terms WERE reviewed and do not
 * permit saving (redistributable = 'no'). The default view_only copy says the
 * terms "haven't been reviewed yet" — true of 'review-required', false here.
 */
const COUNTY_TERMS_DECLINED_MESSAGE =
  "We read this county's public parcel records live. Its terms of use were reviewed and don't permit saving its records, so you can count and preview lists but not save them.";

/** True when a reviewer recorded that this source's terms do NOT permit redistribution ('no'). */
export function isRedistributionDeclined(redistributable: string | null | undefined): boolean {
  return posture(redistributable) === "no";
}

/**
 * Status + customer-facing copy for a county with one or more LIVE sources,
 * from their `redistributable` postures. Covered when any source permits
 * saving; otherwise view-only, and the message says WHY: every source
 * reviewed and declined → COUNTY_TERMS_DECLINED_MESSAGE; any source still
 * unreviewed (or unknown) → the default "not reviewed yet" copy.
 */
export function countyLiveSourceCopy(
  postures: ReadonlyArray<string | null | undefined>,
): { status: "covered" | "view_only"; label: string; message: string } {
  const status = postures.some((p) => countyStatusForLiveSource(p) === "covered") ? "covered" : "view_only";
  const copy = COUNTY_STATUS_COPY[status];
  const declined = status === "view_only" && postures.length > 0 && postures.every(isRedistributionDeclined);
  return { status, label: copy.label, message: declined ? COUNTY_TERMS_DECLINED_MESSAGE : copy.message };
}

/**
 * The status of a county with a LIVE source, from its endpoint row's
 * `redistributable` column. Anything other than 'yes'/'attribution' —
 * including a missing value — is view-only: an unknown licence is never read
 * as permission.
 */
export function countyStatusForLiveSource(redistributable: string | null | undefined): "covered" | "view_only" {
  return SAVEABLE_POSTURES.has(posture(redistributable)) ? "covered" : "view_only";
}

/**
 * The status of a county with NO live source, from its discovery-queue row
 * (county_discovery_queue). `null` = never requested.
 *
 * - pending with no attempt yet       → queued      (requested; not yet searched)
 * - pending/failed after an attempt,
 *   or in_progress                     → discovering (being searched)
 * - exhausted                          → unavailable (searched; nothing usable)
 * - resolved                           → unavailable: this is only reached when
 *   no endpoint is active, so the source that resolved it has gone dark
 *   (DEFECT-0113) — it is not coverage.
 * - an unknown queue status            → queued (requested, state unknown) —
 *   never promoted to anything that implies a source exists.
 */
function countyStatusForQueue(
  queue: { status: string; attempts?: number | null } | null | undefined,
): Exclude<CountyListStatus, "covered" | "view_only"> {
  if (!queue) return "none";
  switch (queue.status) {
    case "pending":
      return (queue.attempts ?? 0) > 0 ? "discovering" : "queued";
    case "in_progress":
    case "failed":
      return "discovering";
    case "exhausted":
    case "resolved":
      return "unavailable";
    default:
      return "queued";
  }
}

/**
 * The status AND the customer-facing copy for a county with no live source,
 * from its discovery-queue row. The copy is COUNTY_STATUS_COPY[status] except
 * for a source that went dark, which says so (COUNTY_SOURCE_WENT_DARK_MESSAGE).
 */
export function countyQueueStatusCopy(
  queue: { status: string; attempts?: number | null } | null | undefined,
): { status: Exclude<CountyListStatus, "covered" | "view_only">; label: string; message: string } {
  const status = countyStatusForQueue(queue);
  const copy = COUNTY_STATUS_COPY[status];
  return {
    status,
    label: copy.label,
    message: queue?.status === "resolved" ? COUNTY_SOURCE_WENT_DARK_MESSAGE : copy.message,
  };
}

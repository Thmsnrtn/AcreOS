/**
 * What a non-fee land status MEANS, in words — one source for the server's
 * automation refusal and the parcel page's banner.
 *
 * Every non-fee status blocks automation (that gate lives in
 * server/utils/landStatus.ts and is unchanged: only `fee` unblocks). What
 * differed was the explanation. The refusal said "Federal trust property —
 * title transfers require BIA approval" for EVERY blocked parcel, so a parcel
 * nobody had looked at yet was described to the customer as federal trust
 * land — a legal characterisation the system had no basis for. Restricted-fee
 * land and fee land inside a reservation got the same trust sentence, and so
 * did a stored value that is not a land status at all.
 *
 * Imports nothing: the client may not import `@shared/schema`, so the status
 * strings are matched here and pinned to `LAND_STATUS_VALUES` by test.
 */

export type LandStatusCategory =
  | "fee"
  | "unverified"
  | "trust"
  | "restricted_fee"
  | "fee_within_reservation";

const TRUST_STATUSES: ReadonlySet<string> = new Set([
  "tribal_trust",
  "individual_trust",
  "off_reservation_trust",
]);

/**
 * Fold a stored status into the category its explanation depends on. A
 * missing value, `"unknown"`, and any string that is not a land status are
 * all UNVERIFIED — nothing is known about the parcel, so nothing is claimed.
 */
export function landStatusCategory(status: string | null | undefined): LandStatusCategory {
  if (status === "fee") return "fee";
  if (status && TRUST_STATUSES.has(status)) return "trust";
  if (status === "restricted_fee") return "restricted_fee";
  if (status === "fee_within_reservation") return "fee_within_reservation";
  return "unverified";
}

/** Why automation is held for a parcel in this category. `fee` has no reason. */
export function landStatusHoldReason(category: Exclude<LandStatusCategory, "fee">): string {
  switch (category) {
    case "unverified":
      return (
        "This parcel's land status hasn't been verified yet — confirm whether it is fee simple, " +
        "trust, or restricted-fee land and record it on the parcel's Land status tab."
      );
    case "trust":
      return "Federal trust property — title transfers require BIA approval (25 CFR §152).";
    case "restricted_fee":
      return (
        "Restricted-fee land — the owner can convey or encumber it only with BIA approval " +
        "(25 USC §177, 25 CFR §152)."
      );
    case "fee_within_reservation":
      return (
        "Fee land inside reservation boundaries — tribal jurisdiction may apply, so confirm the " +
        "transaction's requirements before automating it."
      );
  }
}

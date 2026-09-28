/**
 * May this property be offered to buyers? (DEFECT-0174)
 *
 * Listing create, publish, syndicate and the buyer blast checked only that
 * the property record belonged to the org — and `properties.status`
 * defaults to "prospect". So a parcel the org had merely looked at, made an
 * offer on, or already SOLD could be advertised as available: an offer of
 * land the seller does not hold. The research supplement names the
 * "advertise a property you don't own to test demand" practice explicitly as
 * one to refuse; this is the gate that makes it structurally impossible.
 *
 * Offerable: `owned` and `listed`, and `under_contract` — a wholesaler's
 * assignable contract right. Anything else is refused with the reason.
 */
const OFFERABLE = new Set(["owned", "listed", "under_contract"]);

export function offerabilityRefusal(status: string | null | undefined): string | null {
  if (status && OFFERABLE.has(status)) return null;
  if (status === "sold") return "This property is sold — it can't be offered to buyers.";
  return `This property is "${status ?? "unknown"}", not held: only land you own, have listed, or hold under an assignable contract can be offered to buyers.`;
}

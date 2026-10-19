/**
 * Can a lead become a deal? ONE rule, read by the server's conversion
 * (server/services/leads/convertLeadToDeal.ts) and its readiness read, and by
 * the lead page's "Make this a deal" action through the refusal text below.
 *
 * A deal needs a property, and a property is a parcel: APN, county and state —
 * normalised by the one owner of parcel identity (shared/parcel/parcelRef.ts) —
 * plus its size, because `properties.size_acres` is NOT NULL. A lead missing
 * any of them is refused with the list of what to add. Nothing is invented.
 */
import { normalizeParcelRef, type ParcelRef } from "../parcel/parcelRef";

/** A lead field the conversion needs and the lead does not carry (or carries unusably). */
export type LeadDealMissingField = "apn" | "county" | "state" | "acreage";

/** Human copy for each missing field. */
const LEAD_DEAL_FIELD_LABELS: Record<LeadDealMissingField, string> = {
  apn: "the parcel's APN",
  county: "the county",
  state: "the two-letter state",
  acreage: "the acreage",
};

export type LeadParcelFields = {
  type?: string | null;
  apn?: string | null;
  county?: string | null;
  state?: string | null;
  acreage?: string | number | null;
};

export type LeadDealReadiness =
  | { ready: true; ref: ParcelRef; acres: string }
  | { ready: false; reason: "not_seller" }
  | { ready: false; reason: "missing"; missing: LeadDealMissingField[] };

/** Can this lead become a deal, and with which parcel? Pure. */
export function leadDealReadiness(lead: LeadParcelFields): LeadDealReadiness {
  if ((lead.type ?? "seller") !== "seller") return { ready: false, reason: "not_seller" };
  const missing: LeadDealMissingField[] = [];
  const parsed = normalizeParcelRef({ apn: lead.apn, county: lead.county, state: lead.state });
  if (!parsed.ok) {
    for (const p of parsed.problems) {
      if (p === "apn-missing" || p === "apn-implausible") missing.push("apn");
      else if (p === "county-missing") missing.push("county");
      else missing.push("state");
    }
  }
  const acres = lead.acreage == null || lead.acreage === "" ? NaN : Number(lead.acreage);
  if (!Number.isFinite(acres) || acres <= 0) missing.push("acreage");
  if (!parsed.ok || missing.length > 0) {
    return { ready: false, reason: "missing", missing: [...new Set(missing)] };
  }
  return { ready: true, ref: parsed.ref, acres: String(acres) };
}

/** "Add the county and the acreage to this lead…" — the refusal both sides show. */
export function describeLeadDealMissing(missing: readonly LeadDealMissingField[]): string {
  const named = missing.map((f) => LEAD_DEAL_FIELD_LABELS[f]);
  const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : (named[0] ?? "");
  return `Add ${list} to this lead before making it a deal.`;
}

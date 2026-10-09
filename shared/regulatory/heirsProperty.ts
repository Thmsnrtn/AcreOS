/**
 * Heirs' property and partial / undivided interests — a warning before
 * outreach, never a block.
 *
 * Heirs' property is land passed down without a probate or a will, so several
 * relatives each hold an undivided fractional interest. An offer to one of
 * them is an offer to someone who cannot sell the whole parcel alone, and
 * these families are disproportionately elderly, rural and low-income — the
 * owners most exposed to a lowball offer. (USDA ERS, "Heirs' Property in the
 * United States", 2023; the Uniform Partition of Heirs Property Act, adopted
 * in a majority of states, exists because forced partition sales stripped such
 * families of land.)
 *
 * This module reads only what the record SAYS: an owner name or ownership
 * field carrying a county clerk's marker for an estate, heirs, "et al", a
 * fractional or undivided interest, a life estate, or tenancy in common. It
 * never guesses from a surname. No marker → no warning: the absence of a
 * marker is not evidence the title is whole, and the warning text says so.
 */

export type HeirsSignal =
  | "estate_of"
  | "heirs"
  | "et_al"
  | "fractional_interest"
  | "undivided_interest"
  | "life_estate"
  | "tenancy_in_common"
  | "deceased"
  | "owner_type_estate";

const RULES: Array<{ signal: HeirsSignal; re: RegExp }> = [
  { signal: "heirs", re: /\b(?:unknown\s+)?heirs?(?:\s+(?:of|at\s+law))?\b|\bdevisees?\b/i },
  { signal: "estate_of", re: /\bestate\s+of\b|\b(?:est|estate)\b\s*$/i },
  { signal: "et_al", re: /\bet\.?\s*al\.?\b|\betal\b|\bet\s+ux\b|\bet\s+vir\b/i },
  { signal: "fractional_interest", re: /\b\d+\s*\/\s*\d+(?:th|st|nd|rd)?\s*(?:int(?:erest)?|ownership|share)\b|\b\d{1,2}(?:\.\d+)?\s*%\s*(?:int(?:erest)?|ownership|share)\b/i },
  { signal: "undivided_interest", re: /\bund(?:ivided|iv|)\.?\s+(?:\d+\s*\/\s*\d+|int(?:erest)?)\b|\bundivided\b/i },
  { signal: "life_estate", re: /\blife\s+est(?:ate)?\b|\bl\/e\b/i },
  { signal: "tenancy_in_common", re: /\btenants?\s+in\s+common\b/i },
  // The clerk's abbreviation, upper-case only ("Tic Tac Ranch" is a name).
  { signal: "tenancy_in_common", re: /\bT\.?I\.?C\.?(?=\s|$)/ },
  { signal: "deceased", re: /\b(?:deceased|dec'?d|decd)\b/i },
];

export interface OwnershipRecord {
  /** Every name field the record carries (lead first/last, property ownerName, …). */
  names?: Array<string | null | undefined>;
  /** properties.ownerType / leadData ownerType: "estate" is a marker by itself. */
  ownerType?: string | null;
  /** Vesting / legal description / notes — read for the same markers. */
  text?: Array<string | null | undefined>;
}

export interface HeirsAssessment {
  flagged: boolean;
  signals: HeirsSignal[];
  /** Shown before outreach when flagged; null otherwise. */
  warning: string | null;
}

export const HEIRS_PROPERTY_WARNING =
  "This owner's record shows a partial or undivided interest, an estate, or heirs. One heir usually cannot sell the whole parcel alone, and heirs' property owners are often elderly and rural. Before outreach: confirm who holds title (a title search or the probate record), make any offer to all owners with the basis explained, and expect probate or a partition question. Never pressure one heir to sign for the others.";

export function assessHeirsProperty(rec: OwnershipRecord): HeirsAssessment {
  const signals = new Set<HeirsSignal>();
  const fields = [...(rec.names ?? []), ...(rec.text ?? [])].filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  for (const f of fields) for (const r of RULES) if (r.re.test(f)) signals.add(r.signal);
  if ((rec.ownerType ?? "").trim().toLowerCase() === "estate") signals.add("owner_type_estate");
  const list = [...signals];
  return { flagged: list.length > 0, signals: list, warning: list.length ? HEIRS_PROPERTY_WARNING : null };
}

/**
 * Owner opt-out identifiers (W5a) — the ONE normalisation every send path and
 * the public request form share, so "the same person typed two ways" matches.
 *
 * Only three identifiers are ever kept, and only as keyed hashes
 * (server/services/trust/ownerSuppression.ts): an email address, a phone
 * number (last ten digits) and a mailing address (street line + ZIP5). A name
 * alone is never a suppression key — too many people share one — and no
 * government identifier is ever collected.
 *
 * Browser-safe: pure string functions, no crypto.
 */

export type OwnerIdentifierKind = "email" | "phone" | "address";

export interface OwnerIdentifiers {
  email?: string | null;
  phone?: string | null;
  /** Street line of a mailing address. Matched only together with a ZIP. */
  addressLine1?: string | null;
  zip?: string | null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  // 254 is the longest valid address (RFC 5321). Checking length FIRST keeps
  // the shape regex below linear on hostile input from the public form.
  if (!s || s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** Ten-digit US number, or null. A leading country code 1 is dropped. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

const STREET_WORDS: Record<string, string> = {
  street: "st", road: "rd", avenue: "ave", av: "ave", drive: "dr", lane: "ln",
  court: "ct", circle: "cir", boulevard: "blvd", highway: "hwy", parkway: "pkwy",
  place: "pl", terrace: "ter", trail: "trl", way: "way", route: "rte", county: "co",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw",
  southeast: "se", southwest: "sw", apartment: "apt", suite: "ste", unit: "unit",
  "post": "po", "p": "p", "o": "o", box: "box",
};

/**
 * "123 North Main Street, Apt 4" + "37402-1234" → "123 n main st apt 4|37402".
 * Null unless BOTH a street line and a five-digit ZIP are present: a street
 * line without a ZIP names thousands of places.
 */
export function normalizeMailingAddress(line1: string | null | undefined, zip: string | null | undefined): string | null {
  const z = (zip ?? "").replace(/[^\d]/g, "").slice(0, 5);
  if (z.length !== 5) return null;
  const words = (line1 ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\bp\s*o\s*box\b/g, "po box")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w);
  if (words.length === 0 || !words.some((w) => /\d/.test(w))) return null;
  return `${words.join(" ")}|${z}`;
}

/** Every identifier present in `ids`, normalised. Order: email, phone, address. */
export function normalizedOwnerIdentifiers(ids: OwnerIdentifiers): Array<{ kind: OwnerIdentifierKind; value: string }> {
  const out: Array<{ kind: OwnerIdentifierKind; value: string }> = [];
  const email = normalizeEmail(ids.email);
  if (email) out.push({ kind: "email", value: email });
  const phone = normalizePhone(ids.phone);
  if (phone) out.push({ kind: "phone", value: phone });
  const address = normalizeMailingAddress(ids.addressLine1, ids.zip);
  if (address) out.push({ kind: "address", value: address });
  return out;
}

/**
 * Statutory response windows, in days, by the requester's state of residence.
 * California's Delete Act / DROP and the state consumer-privacy laws use 45
 * days for a deletion request; where a state is not listed the 45-day window
 * applies (the shortest common window — tracking it never runs late against a
 * longer one). Extending a deadline is a legal decision for the founder, not
 * something this table does.
 */
const DEFAULT_STATUTORY_DAYS = 45;
const STATUTORY_DAYS_BY_STATE: Readonly<Record<string, number>> = {
  CA: 45,
};

export function statutoryDaysFor(state: string | null | undefined): number {
  const s = (state ?? "").trim().toUpperCase();
  return STATUTORY_DAYS_BY_STATE[s] ?? DEFAULT_STATUTORY_DAYS;
}

/** Days before the due date at which an open request alerts the founder. */
export const DEADLINE_WARNING_DAYS = 10;

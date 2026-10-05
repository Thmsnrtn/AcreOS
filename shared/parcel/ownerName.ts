/**
 * One rule for turning a county list's single "owner name" field into the
 * lead's first/last name (founder ruling 2026-09-29 #2 — the honest CSV
 * import path).
 *
 * The two importers disagreed and both invented names. The CSV import split
 * on the first space and, for a one-word owner, used that word as BOTH names
 * ("ACME" became "ACME ACME"); the tax-delinquent import took the last word as
 * the surname, so "SMITH FAMILY TRUST" became first name "SMITH FAMILY", last
 * name "TRUST". A letter then opened "Dear SMITH FAMILY".
 *
 * An entity (trust, LLC, estate, church, county…) or a single word has no
 * first name: it becomes the whole last name, first name empty. "LAST, FIRST"
 * is read in that order. Anything else keeps the first-space split — the
 * order of a bare "JOHN SMITH" / "SMITH JOHN" cannot be known from the text,
 * and guessing would be another invention.
 */

/**
 * An owner name as comparable words: upper-cased, "," and "&" as separators,
 * each word's trailing punctuation dropped and its dots removed — so
 * "LLC.", "L.L.C", "L.L.C." and "LLC" are one token, as are "TR." and "TR".
 */
function ownerWords(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/[,&]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/[.,;:]+$/, "").replace(/\./g, ""))
    .filter(Boolean);
}

const ESTATE_WORDS = new Set(["ESTATE", "EST", "HEIRS"]);
const TRUST_WORDS = new Set([
  "TRUST", "TRUSTEE", "TRUSTEES", "TR", "TRS", "TTEE", "TTEES", "CO-TRUSTEE", "CO-TRUSTEES",
]);
const BUSINESS_OR_GOVERNMENT_WORDS = new Set([
  "LLC", "INC", "CORP", "CORPORATION", "CO", "COMPANY", "LP", "LLP", "LTD", "BANK", "HOLDINGS",
  "PARTNERS", "PARTNERSHIP", "ASSOCIATION", "ASSN", "FOUNDATION", "CHURCH", "MINISTRIES", "COUNTY",
  "CITY", "STATE", "TOWNSHIP", "DISTRICT", "AUTHORITY", "PROPERTIES", "INVESTMENTS", "VENTURES",
  "GROUP", "ENTERPRISES",
  // Government and institutions (W10.3 audit).
  "USA", "DEPT", "DEPARTMENT", "BOROUGH", "UNIVERSITY", "SCHOOL", "COMMISSION",
]);
/**
 * Multi-word government owners. Matched as whole words in sequence, so
 * "TOWN OF FAIRVIEW" is a government and "JOHN TOWNSEND" is a person.
 */
const GOVERNMENT_PHRASES = [
  "UNITED STATES", "TOWN OF", "VILLAGE OF", "COUNTY OF", "STATE OF", "CITY OF", "BOARD OF",
];
/** Words that make an owner something other than a person, with no type of their own. */
const OTHER_NON_PERSON_WORDS = new Set(["FARMS", "RANCH"]);

function hasPhrase(words: string[], phrases: string[]): boolean {
  const text = ` ${words.join(" ")} `;
  return phrases.some((p) => text.includes(` ${p} `));
}

function isBusinessOrGovernment(words: string[]): boolean {
  return words.some((w) => BUSINESS_OR_GOVERNMENT_WORDS.has(w)) || hasPhrase(words, GOVERNMENT_PHRASES);
}

/** True when the words read as an organisation, government, trust or estate — not a person. */
function isNonPersonWords(words: string[]): boolean {
  return (
    isBusinessOrGovernment(words) ||
    words.some((w) => ESTATE_WORDS.has(w) || TRUST_WORDS.has(w) || OTHER_NON_PERSON_WORDS.has(w))
  );
}

/** True when an owner name reads as an organisation or trust, not a person. */
function isEntityOwnerName(raw: string): boolean {
  return isNonPersonWords(ownerWords(raw)) || /\bET\s+AL\b/i.test(raw);
}

/**
 * The four owner types a county list can filter on (W10.3 list builder).
 * County parcel layers carry one owner-name string and no owner-type column,
 * so the type is READ from the name by `classifyOwnerType` below.
 */
export const OWNER_TYPES = ["individual", "entity", "trust", "estate"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

// The classifier only ever subdivides what isNonPersonWords already calls a
// non-person — the SAME word lists splitOwnerName reads — so a name it types
// as trust/estate/entity is exactly a name splitOwnerName gives no first
// name: the two rules cannot disagree about whether an owner is a person.
// Business and government words win over trust/estate ("FIRST TRUST CO" is a
// company, "REAL ESTATE HOLDINGS LLC" is a company); estate wins over trust
// ("ESTATE OF … TRUSTEE" is an estate).

/**
 * The owner type a county owner-name string reads as, or null when there is
 * no name to read (an empty owner field is unknown — never "individual").
 *
 * "SMITH JOHN ET AL" is several people, so it is an individual owner even
 * though splitOwnerName (correctly) gives it no first name.
 */
export function classifyOwnerType(raw: string | null | undefined): OwnerType | null {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return null;
  const words = ownerWords(name);
  if (words.length === 0) return null;
  const has = (set: Set<string>) => words.some((w) => set.has(w));
  if (!isNonPersonWords(words)) return "individual";
  if (isBusinessOrGovernment(words)) return "entity";
  if (has(ESTATE_WORDS)) return "estate";
  if (has(TRUST_WORDS)) return "trust";
  return "entity";
}

export function splitOwnerName(raw: string): { firstName: string; lastName: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { firstName: "", lastName: "" };
  if (isEntityOwnerName(name)) return { firstName: "", lastName: name };
  const comma = name.split(",");
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) {
    return { firstName: comma[1].trim(), lastName: comma[0].trim() };
  }
  const parts = name.split(" ");
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * The name a letter or message greets. An entity or single-word owner has no
 * first name (splitOwnerName), and "Dear {{firstName}}," rendered "Dear ,";
 * the whole name greets them instead ("Dear SMITH FAMILY TRUST,").
 */
export function salutationName(lead: { firstName?: string | null; lastName?: string | null }): string {
  return lead.firstName?.trim() || lead.lastName?.trim() || "";
}

/**
 * The name to greet from a stored full name ("Ana Owner" -> "Ana"; an entity
 * greets as itself: "SMITH FAMILY TRUST", never "SMITH").
 */
function greetingName(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (isEntityOwnerName(name)) return name;
  return name.split(" ")[0];
}

const escapeHtml = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * THE merge for mail copy — the composer's preview and the flusher's printed
 * piece both call it, so what the preview shows is what is printed. The
 * composer invites {firstName} / {city} / {state}; the flusher used to send
 * the copy raw, so pieces were printed "Hi {firstName}" while the preview
 * showed a name (quality directive 2026-09-29, audit of the G0 slice).
 *
 * The copy is PLAIN TEXT (a textarea; the preview renders it with its line
 * breaks). `html` renders it for an HTML piece: the whole copy is escaped —
 * not only the merged values — so a typed "<" or "&" prints as itself, and
 * each line break becomes <br>, so the printed letter keeps the paragraphs
 * the preview showed instead of collapsing into one (audit of 60ebfd9).
 */
export function mergeMailCopy(
  copy: string,
  r: { name: string | null | undefined; city: string | null | undefined; state: string | null | undefined },
  opts: { html: boolean },
): string {
  const v = (t: string | null | undefined) => (opts.html ? escapeHtml(t ?? "") : (t ?? ""));
  const text = opts.html ? escapeHtml(copy) : copy;
  const merged = text
    .replace(/\{firstName\}/g, () => v(greetingName(r.name)))
    .replace(/\{city\}/g, () => v(r.city))
    .replace(/\{state\}/g, () => v(r.state));
  return opts.html ? merged.replace(/\r?\n/g, "<br>") : merged;
}

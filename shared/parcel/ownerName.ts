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

const ENTITY_WORDS = new Set([
  "LLC", "L.L.C.", "INC", "INC.", "CORP", "CORP.", "CORPORATION", "CO", "CO.", "COMPANY",
  "LP", "L.P.", "LLP", "LTD", "LTD.", "TRUST", "TRUSTEE", "TRUSTEES", "TR", "ESTATE", "EST",
  "HOLDINGS", "PARTNERS", "PARTNERSHIP", "ASSOCIATION", "ASSN", "FOUNDATION", "BANK",
  "CHURCH", "MINISTRIES", "COUNTY", "CITY", "STATE", "TOWNSHIP", "DISTRICT", "AUTHORITY",
  "HEIRS", "PROPERTIES", "INVESTMENTS", "VENTURES", "GROUP", "ENTERPRISES", "FARMS", "RANCH",
]);

/** True when an owner name reads as an organisation or trust, not a person. */
function isEntityOwnerName(raw: string): boolean {
  const words = raw.toUpperCase().replace(/[,&]/g, " ").split(/\s+/).filter(Boolean);
  return words.some((w) => ENTITY_WORDS.has(w)) || /\bET\s+AL\b/i.test(raw);
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

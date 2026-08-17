/**
 * ONE definition of "the same parcel".
 *
 * A parcel's identity in this repo is the natural key (state, county, APN).
 * That key was resolved at three call sites, with three different
 * normalisations, and they disagreed about real parcels:
 *
 *   server/services/dueDiligence.ts:255
 *     state UPPER · county lower · apn trim only (CASE PRESERVED)
 *   server/services/taxDelinquentPipeline.ts:261
 *     state lower · county lower · apn lower + trim
 *   server/services/publicParcelReport.ts:139
 *     apn UPPER with EVERY non-alphanumeric character STRIPPED
 *
 * The disagreements are not cosmetic:
 *   - "12-345-678" and "12345678" are the SAME parcel to publicParcelReport and
 *     DIFFERENT parcels to the other two.
 *   - "a-1" and "A-1" are the SAME parcel to two of them and DIFFERENT to
 *     dueDiligence, which preserves APN case.
 *   - a tuple key built by taxDelinquentPipeline (state lower) can never match
 *     a row written by dueDiligence (state upper).
 *
 * Two code paths looking at one physical parcel could therefore disagree about
 * whether it is one parcel. That is canonical-truth corruption, not untidiness.
 *
 * canon.ts law 8: one owner for canonical state. This file is that owner for
 * parcel identity. It deliberately does NOT introduce a `parcels` table —
 * parcel identity already has two homes (`properties` and `parcel_snapshots`)
 * and a third would make it worse. See the `parcel` entry in
 * shared/architecture/canon.ts.
 */

/** A parcel's natural key, before normalisation. Any part may be absent. */
export interface RawParcelRef {
  state?: string | null;
  county?: string | null;
  apn?: string | null;
}

/** A normalised parcel reference. Construct only via `normalizeParcelRef`. */
export interface ParcelRef {
  /** Two-letter state code, upper-case. */
  readonly state: string;
  /**
   * County name, lower-case, internal whitespace collapsed, with a trailing
   * "county" word removed — "Travis County" and "Travis" are one place.
   */
  readonly county: string;
  /** APN, upper-case, trimmed, whitespace collapsed. Punctuation KEPT. */
  readonly apn: string;
}

/** Why a raw ref could not become a ParcelRef. `unknown` is first-class. */
export type ParcelRefProblem =
  | "state-missing"
  | "state-malformed"
  | "county-missing"
  | "apn-missing"
  | "apn-implausible";

export type ParcelRefResult =
  | { ok: true; ref: ParcelRef }
  | { ok: false; problems: ParcelRefProblem[] };

const collapse = (s: string): string => s.trim().replace(/\s+/g, " ");

/**
 * Strip a trailing "county" word from a county name.
 *
 * "Travis" and "Travis County" are the same county, and callers genuinely
 * supply both — county GIS endpoints return the long form, CSV imports usually
 * the short one. Without this, they are two identities for one place, and every
 * downstream comparison silently splits.
 *
 * This is not a new convention; it is the one already in force, previously
 * open-coded at four sites with four spellings (`gisRepo.ts` twice, once in JS
 * with `/ county$/i` and once in SQL with a CASE-SENSITIVE `REPLACE(…,' County','')`
 * that could not strip its own JS-normalised writes; `parcel.ts:290`;
 * `publicParcelReport.ts`'s slug). Putting it here is what makes them agree.
 *
 * ONLY STRIPS WHEN SOMETHING REMAINS. A county whose entire name is "County"
 * would otherwise normalise to the empty string and then be refused as
 * `county-missing` — turning a merely odd input into an unusable one.
 */
const stripCountySuffix = (s: string): string => {
  const stripped = s.replace(/\s+county$/i, "").trim();
  return stripped === "" ? s : stripped;
};

/**
 * Normalise a raw natural key, or REFUSE with reasons.
 *
 * Refuses rather than guessing: a fabricated parcel identity silently attaches
 * evidence, decisions and money to the wrong piece of land. A half-formed key
 * would be worse than none.
 *
 * APN PUNCTUATION IS PRESERVED, deliberately. Stripping it — as
 * publicParcelReport did — MERGES parcels in any county where a separator is
 * significant, and a wrong merge is unrecoverable: two parcels' evidence lands
 * on one identity and nothing downstream can separate them again. The looser
 * form remains available as `parcelMatchKey` for CANDIDATE LOOKUP, where a
 * false match costs an extra row to inspect rather than a corrupted identity.
 */
export function normalizeParcelRef(raw: RawParcelRef): ParcelRefResult {
  const problems: ParcelRefProblem[] = [];

  const stateRaw = collapse(raw.state ?? "");
  if (!stateRaw) problems.push("state-missing");
  else if (!/^[A-Za-z]{2}$/.test(stateRaw)) problems.push("state-malformed");

  const countyRaw = stripCountySuffix(collapse(raw.county ?? ""));
  if (!countyRaw) problems.push("county-missing");

  const apnRaw = collapse(raw.apn ?? "");
  if (!apnRaw) problems.push("apn-missing");
  else if (!/\d/.test(apnRaw)) problems.push("apn-implausible");

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    ref: {
      state: stateRaw.toUpperCase(),
      county: countyRaw.toLowerCase(),
      apn: apnRaw.toUpperCase(),
    },
  };
}

/**
 * THE identity key. Two refs with the same `parcelKey` are the same parcel.
 *
 * A space is the separator, not a pipe. A county or APN containing the
 * separator would otherwise let two different keys collide — ("a|b","c") vs
 * ("a","b|c") — and a collision here means one parcel's evidence attaching to
 * another parcel's identity. A space cannot appear in either normalised part,
 * because `collapse` has already reduced runs of whitespace and neither field
 * may be empty.
 */
export function parcelKey(ref: ParcelRef): string {
  return `${ref.state} ${ref.county} ${ref.apn}`;
}

/**
 * A LOOSE key for candidate lookup. NOT an identity.
 *
 * Strips every non-alphanumeric character from the APN, so "12-345-678" and
 * "12345678" collide. Use it to FIND rows that might be the same parcel; never
 * to decide that they are. In a county where the separator is significant this
 * merges genuinely distinct parcels — which is why it is a separate function
 * with a separate name, rather than an option on `parcelKey` that somebody
 * passes by accident.
 */
export function parcelMatchKey(ref: ParcelRef): string {
  return `${ref.state} ${ref.county} ${ref.apn.replace(/[^A-Z0-9]/g, "")}`;
}

/** True when both refs denote the same parcel under the strict rule. */
export function sameParcel(a: ParcelRef, b: ParcelRef): boolean {
  return parcelKey(a) === parcelKey(b);
}

/**
 * Spellings of an APN to TRY AGAINST AN EXTERNAL SOURCE, most specific first.
 *
 * NOT an identity and not a match key — a list of query strings. Counties and
 * vendors disagree about punctuation and leading zeros, so a lookup that sends
 * one spelling silently fails to find parcels that are certainly there. Each
 * variant is used as an exact-match query on the far side; a variant that
 * matches nothing simply costs one round trip.
 *
 * WHY IT LIVES HERE. It was open-coded identically at two sites in
 * `server/services/parcel.ts` (the ArcGIS and Regrid lookups), each stripping
 * `/[-\s]/` — hyphens and whitespace only. Real APNs also separate with dots
 * and slashes ("12.345.678", "12/345/678"), so those counties got a fan-out
 * that was really one spelling. Using `parcelMatchKey`'s alphabet — every
 * non-alphanumeric — is what makes the fan-out actually fan out, and keeps the
 * repo to ONE answer for "what counts as punctuation in an APN".
 *
 * ORDER IS PRESERVED FROM THE ORIGINAL (stripped, then as-given, then
 * zero-stripped) rather than improved. Reordering changes which variant wins
 * when more than one matches, and that is a behaviour decision about live
 * vendor data, not a refactor.
 *
 * Returns [] for an APN with nothing in it — an empty query string would match
 * whatever the far side returns for "no filter".
 */
export function apnQueryVariants(rawApn: string | null | undefined): string[] {
  const given = collapse(rawApn ?? "");
  if (!given) return [];
  const stripped = given.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const variants = [stripped, given, stripped.replace(/^0+/, "")];
  return variants.filter((v, i, arr) => v !== "" && arr.indexOf(v) === i);
}

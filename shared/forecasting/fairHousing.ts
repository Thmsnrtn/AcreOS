/**
 * Fair-housing guard for forecasting.
 *
 * No forecasting model or feature may use a protected characteristic, or an
 * obvious stand-in for one. Protected under the federal Fair Housing Act
 * (42 U.S.C. §3604: race, color, religion, sex, familial status, national
 * origin, disability), the Equal Credit Opportunity Act (adds age, marital
 * status, receipt of public assistance), and common state and local law
 * (sexual orientation, gender identity, source of income, ancestry, creed,
 * military status, citizenship).
 *
 * "Obvious stand-ins": personal names (surname-based inference is a known
 * route to race and national origin), language, neighbourhood demographic
 * composition, places of worship, school-age children, and geography finer
 * than a county (tract, block group, ZIP — the classic redlining unit).
 *
 * The check works on WORDS, not substrings: identifiers are split on case and
 * punctuation, so `acreage` and `average` are not `age`, while `ownerAge` is.
 * Pure; browser-safe.
 */

const PROTECTED_TERMS: readonly string[] = [
  "race", "racial", "color", "colour", "religion", "religious", "sex", "gender", "familial",
  "national origin", "nationality", "ethnicity", "ethnic", "disability", "disabled", "handicap",
  "age", "marital", "married", "sexual orientation", "gender identity", "source of income",
  "public assistance", "ancestry", "creed", "military status", "veteran", "citizenship", "immigration",
  "pregnancy", "pregnant",
];

const PROXY_TERMS: readonly string[] = [
  // people
  "surname", "first name", "last name", "given name", "owner name", "full name", "language",
  "accent", "birthplace", "foreign born",
  // neighbourhood composition
  "demographic", "demographics", "minority", "majority minority", "hispanic", "latino", "latina",
  "african american", "black population", "white population", "asian population", "percent white",
  "percent black",
  // places and households
  "church", "mosque", "synagogue", "temple", "place of worship", "children", "school age", "household size",
  "voucher", "section 8", "ssi", "ssdi", "medicaid",
  // geography finer than a county
  "tract", "block group", "census block", "zip", "zipcode", "postal code",
];

/** Split an identifier or phrase into lower-case words (camelCase, snake_case, kebab, spaces). */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function containsPhrase(ws: readonly string[], phrase: string): boolean {
  const p = phrase.split(" ");
  outer: for (let i = 0; i + p.length <= ws.length; i++) {
    for (let j = 0; j < p.length; j++) if (ws[i + j] !== p[j]) continue outer;
    return true;
  }
  return false;
}

export interface FairHousingViolation {
  where: string;
  text: string;
  term: string;
  kind: "protected" | "proxy";
}

/** Every protected or proxy term found in one piece of text. */
function findTerms(text: string, where: string): FairHousingViolation[] {
  const ws = words(text);
  const out: FairHousingViolation[] = [];
  for (const t of PROTECTED_TERMS) if (containsPhrase(ws, t)) out.push({ where, text, term: t, kind: "protected" });
  for (const t of PROXY_TERMS) if (containsPhrase(ws, t)) out.push({ where, text, term: t, kind: "proxy" });
  return out;
}

export interface CheckableModel {
  id: string;
  geography: string;
  features: ReadonlyArray<{ id: string; description: string; from: string }>;
}

const ALLOWED_GEOGRAPHY = new Set(["nation", "state", "county", "company"]);

/** Violations across a set of models: every feature's id, description and source, and the geography. */
export function checkModels(models: readonly CheckableModel[]): FairHousingViolation[] {
  const out: FairHousingViolation[] = [];
  for (const m of models) {
    if (!ALLOWED_GEOGRAPHY.has(m.geography)) {
      out.push({ where: m.id, text: m.geography, term: "geography finer than a county", kind: "proxy" });
    }
    for (const f of m.features) {
      out.push(...findTerms(f.id, `${m.id}.${f.id}#id`));
      out.push(...findTerms(f.description, `${m.id}.${f.id}#description`));
      out.push(...findTerms(f.from, `${m.id}.${f.id}#from`));
    }
  }
  return out;
}

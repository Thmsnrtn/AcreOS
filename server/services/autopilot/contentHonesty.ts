/**
 * Content honesty screen — the `lint:no-fabrication` philosophy applied to
 * GENERATED content (Stage 2, the Writer, Support and Retention role workers).
 *
 * "Fabrication is never acceptable: no invented numbers, no fake activity, no
 * placeholder data presented as real." The repo's lint enforces that over
 * source code; this screen enforces it over what a model writes for the public
 * field-notes surface, a ticket reply or a customer email.
 *
 * It FAILS CLOSED, in two ways (audit M1):
 *
 *   1. A QUANTITY BOUND TO A CLAIM — a number (any script, any encoding: the
 *      text is NFKC-normalised, entity-decoded, stripped of format
 *      characters, image alt text included), a number word (English, Spanish,
 *      French), a Roman numeral or a magnitude word, standing next to a
 *      percent / money / multiplier / rate, or in a clause with an outcome or
 *      comparative verb (earn, save, close, return, grow, cut, double…), or
 *      counting a population (buyers, investors, owners…) — fails unless the
 *      SAME CLAUSE carries a citation link to a verified-source host. Naming a
 *      source is not citing it; an image is not a citation; a link's own
 *      anchor text is screened as uncited text. Bare ordinals ("First"),
 *      durations ("this week"), "once", "one of", "a single" are not claims.
 *      Facts of the case (opts.allowDollarFigures) and #123 references are
 *      not claims either.
 *   2. REPORTED SPEECH — a quotation with a speech verb, first-person
 *      testimony ("told me", "told us"), a <blockquote>/<cite> — and star
 *      ratings, adoption and customer-outcome claims are refused outright. AcreOS has no customer quotes to cite; a model cannot have
 *      one either.
 *
 * A false block costs one revision; a false pass publishes a lie under the
 * founder's name. Pure + deterministic. Returns ClaimViolation-shaped rows so
 * it composes into the existing publish gate (publishArtifact.ts
 * screenForPublish) as one more layer, not a second gate.
 */
import type { ClaimViolation } from "./claimsEngine";

/** A real source a claim may cite: how it is named in prose, and its hosts. */
export interface VerifiedSource {
  name: string;
  /** How a sentence names it. */
  pattern: RegExp;
  /** Hosts a cited link may point at (subdomains included). */
  hosts: string[];
}

/**
 * The verified sources the codebase supplies — real, public, checkable
 * publishers of the land / tax / census facts the Writer explains. Adding one
 * is a reviewed change; the founder can also pass more per call.
 */
export const VERIFIED_SOURCES: readonly VerifiedSource[] = [
  { name: "USDA / Census of Agriculture", pattern: /\b(census of agriculture|usda(?:\s+nass)?|national agricultural statistics service)\b/i, hosts: ["usda.gov"] },
  { name: "U.S. Census Bureau", pattern: /\b(u\.?\s?s\.? census bureau|census bureau|american community survey)\b/i, hosts: ["census.gov"] },
  { name: "Bureau of Labor Statistics", pattern: /\b(bureau of labor statistics)\b/i, hosts: ["bls.gov"] },
  { name: "IRS", pattern: /\b(irs|internal revenue service)\b/i, hosts: ["irs.gov"] },
  { name: "FEMA", pattern: /\b(fema)\b/i, hosts: ["fema.gov"] },
  { name: "USGS", pattern: /\b(usgs|u\.?\s?s\.? geological survey)\b/i, hosts: ["usgs.gov"] },
  { name: "Federal Reserve", pattern: /\b(federal reserve)\b/i, hosts: ["federalreserve.gov", "stlouisfed.org"] },
  { name: "National Association of Realtors", pattern: /\b(national association of realtors)\b/i, hosts: ["nar.realtor"] },
  { name: "the county's own records", pattern: /\bcounty(?:'s)?\s+(?:assessor|recorder|treasurer|clerk|tax collector|appraisal district)(?:'s)?\b/i, hosts: [] },
];

// ── Normalisation: one canonical text, whatever the encoding ──────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", percnt: "%", dollar: "$", euro: "€", pound: "£",
  frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
};

function decodeEntities(t: string): string {
  // Twice, so "&amp;#52;" cannot smuggle a digit through one decode.
  let out = t;
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z][a-z0-9]+);/gi, (m, n: string) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
  }
  return out;
}

/** Map every decimal digit of any script (\p{Nd}) to ASCII. Pure. */
function asciiDigits(t: string): string {
  return t.replace(/\p{Nd}/gu, (ch) => {
    let cp = ch.codePointAt(0)!;
    if (cp < 128) return ch;
    let zero = cp;
    while (zero > cp - 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
    return String(cp - zero);
  });
}

/**
 * The text a reader sees, canonicalised: entities decoded, NFKC (full-width,
 * superscript and fraction forms fold to ASCII), any-script digits mapped,
 * zero-width / format characters removed, script-specific percent signs and
 * the fraction slash folded.
 */
function normalizeForScreen(raw: string): string {
  return asciiDigits(decodeEntities(raw ?? "").normalize("NFKC"))
    .replace(/\p{Cf}/gu, "")
    .replace(/[٪﹪％]/g, "%")
    .replace(/⁄/g, "/");
}

// ── Citations: only a link to a verified host, in the claim's own clause ──

const CITE = (host: string) => ` ⟦CITE:${host}⟧ `;

/**
 * Turn markup into plain text with citation MARKERS. An <a> or markdown link
 * becomes a marker in place (its anchor text is collected and screened on its
 * own, uncited); an image becomes its alt text and is never a citation; a
 * bare URL becomes a marker.
 */
function toScreenText(t: string): { text: string; anchors: string[] } {
  const anchors: string[] = [];
  let out = t
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/<img\b[^>]*?\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      anchors.push(inner.replace(/<[^>]+>/g, " "));
      return CITE(hostOf(href) ?? "invalid");
    })
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, inner: string, href: string) => {
      anchors.push(inner);
      return CITE(hostOf(href) ?? "invalid");
    })
    .replace(/<[^>]+>/g, " ");
  out = out.replace(/https?:\/\/[^\s"'<>)⟧]+/gi, (u) => CITE(hostOf(u) ?? "invalid"));
  return { text: out, anchors };
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** A claim and its citation must share a clause: split on ; : — and joined clauses. */
function clauses(sentence: string): string[] {
  return sentence
    .split(/\s*[;:—–]\s+|,\s+(?:and|but|while|so|yet|whereas|y|pero|et|mais)\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

function citedByVerified(clause: string, sources: readonly VerifiedSource[]): boolean {
  for (const m of clause.matchAll(/⟦CITE:([^⟧\s]+)⟧/g)) {
    const h = m[1].toLowerCase();
    if (sources.some((s) => s.hosts.some((host) => h === host || h.endsWith(`.${host}`)))) return true;
  }
  return false;
}

// ── A quantity bound to a claim ───────────────────────────────────────────

const NUMBER_WORDS = [
  // English
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "million", "billion",
  // Spanish (not "once" — it is English for one time)
  "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "doce", "veinte", "treinta", "cuarenta",
  "cincuenta", "sesenta", "setenta", "ochenta", "noventa", "cien", "ciento", "mil", "millón", "millones",
  // French
  "deux", "trois", "quatre", "cinq", "sept", "huit", "neuf", "dix", "vingt", "trente", "quarante", "cinquante", "soixante", "cent", "mille",
];
const MAGNITUDE_WORDS = ["half", "halves", "majority", "minority", "most", "dozens", "dozen", "grand", "figures", "mitad", "mayoría", "moitié", "majorité", "plupart", "fortnight"];
const NUM = String.raw`(?:\d[\d,.]*(?:\s?\/\s?\d+)?(?:[kKmM]\b)?|(?:${NUMBER_WORDS.join("|")})(?:[\s-]+(?:${NUMBER_WORDS.join("|")}|and|y|et))*|(?:${MAGNITUDE_WORDS.join("|")})|\b(?=[MDCLXVI]{2,}\b)M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3}))`;
const QTY = new RegExp(String.raw`(?<![\p{L}\d])(${NUM})(?![\p{L}])`, "giu");

/** Next to a quantity: percent, money, multiplier, rate, ratio. */
const BOUND_AFTER = /^\s*(?:%|percent\b|per\s?cent\b|pct\b|por\s+ciento\b|pour\s+cent\b|k\b|grand\b|figures?\b|x\b|times\b|fold\b|-fold\b|dollars?\b|bucks\b|usd\b|euros?\b|pounds?\b|(?:\/|per\b|a\b|an\b|each\b|every\b)\s*(?:day|week|month|year|deal|flip|parcel|acre)\b|(?:in|out of|of)\s+(?:every\s+)?(?:\d|\b(?:ten|five|four|three|twenty|hundred|diez|dix)\b))/iu;
const BOUND_BEFORE = /(?:[$€£]\s?|\b(?:usd|eur)\s?)$/iu;
/** Outcome / comparative verbs (and their participles) in the same clause. */
const OUTCOME_VERB = /\b(?:earn\w*|sav(?:e|es|ed|ing)|clos(?:e|es|ed|ing)|return\w*|ris(?:e|es|ing)|rose|grow\w*|grew|cut\w*|doubl\w*|tripl\w*|quadrupl\w*|halv\w*|beat\w*|outperform\w*|los(?:e|es|ing)|lost|gain\w*|boost\w*|increas\w*|decreas\w*|drop\w*|fall\w*|fell|reduc\w*|profit\w*|net(?:s|ted)?|sell\w*|sold|overpay\w*|underpay\w*|skip\w*|win\w*|won|ganan?\w*|ahorr\w*|pierd\w*|gagn\w*|économis\w*|perd\w*|paga\w*|pagan)\b|\b(?:more|less|fewer|faster|slower|cheaper|higher|lower|better|worse|on average|the average|median|más|menos|plus de|moins de)\b/iu;
/** A counted population. */
const POPULATION = /^\s*(?:[\p{L}-]+\s+){0,2}?(?:of\s+(?:the\s+|our\s+|all\s+)?(?:[\p{L}-]+\s+)?)?(?:buyers?|investors?|customers?|clients?|owners?|landowners?|flippers?|sellers?|users?|people|members?|agents?|brokers?|families|deals?|parcels?|properties|subscribers?|compradores|inversores|inversionistas|clientes|propietarios|vendedores|acheteurs|investisseurs|propriétaires|vendeurs)\b/iu;
/** Multipliers that are claims on their own. */
const MULTIPLIER = /\b(?:twice|thrice)\s+as\b|\b\d+(?:\.\d+)?\s?x\b|\b(?:doubl|tripl|quadrupl|halv)(?:ed|es|ing)\b/iu;
/** Not claims: ordinals, durations, frequency, "one of", "a single", "most common". */
const BENIGN_AFTER = /^\s*(?:of\s+(?:the|our|your|these|those|its|his|her|their)\b|common\b|important\b|popular\b|likely\b|useful\b)/iu;

function boundClaim(clause: string): string | null {
  const m0 = MULTIPLIER.exec(clause);
  if (m0) return m0[0];
  QTY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QTY.exec(clause)) != null) {
    const q = m[1];
    const before = clause.slice(0, m.index);
    const after = clause.slice(m.index + m[0].length);
    if (/\d\s?[kKmM]$/.test(q) || BOUND_AFTER.test(after) || BOUND_BEFORE.test(before)) return `${before.slice(-2)}${q}${after.slice(0, 12)}`.trim();
    if (BENIGN_AFTER.test(after) && !/\d/.test(q)) continue;
    if (POPULATION.test(after)) return `${q}${after.slice(0, 24)}`.trim();
    if (OUTCOME_VERB.test(clause)) return q;
  }
  return null;
}

/**
 * Reported speech: a quotation next to a speech verb, or first-person
 * testimony. ("A perc test tells you…" is an explanation, not a report.)
 */
const REPORTED_SPEECH = new RegExp(
  [
    String.raw`[“"«][^”"»]{3,}[”"»]\s*,?\s*(?:says|said|told|tells|writes|wrote|explains|explained|adds|added|recalls|recalled|notes|noted|asked|replied|dijo|dice|a dit|dit)\b`,
    String.raw`\b(?:says|said|told|tells|writes|wrote|explains|explained|recalls|recalled|asked|replied|put it|puts it|dijo|dice|a dit|dit)\b[^.“"«]{0,60}[“"«][^”"»]{3,}`,
    String.raw`\b(?:told|tells)\s+(?:me|us)\b`,
    String.raw`\b(?:i|we)\s+(?:were|was)\s+told\b`,
    String.raw`\b(?:one|a|another)\s+(?:of\s+our\s+)?(?:customers?|clients?|users?|investors?|buyers?|sellers?|landowners?|members?)\s+(?:wrote|said|says|told|shared)\b`,
  ].join("|"),
  "iu",
);

/** Quotation / testimonial / social-proof shapes — refused outright, sourced or not. */
const PROOF_RES: Array<{ re: RegExp; code: string; what: string }> = [
  { re: /<\s*(?:blockquote|cite|q)\b/i, code: "testimonial", what: "a quotation element (<blockquote>/<cite>/<q>)" },
  { re: /[“"][^”"]{8,}[”"]\s*(?:[—–-]{1,2}|,)\s*[A-Z][a-z]+(?:\s[A-Z]\.?)?/, code: "testimonial", what: "a quotation attributed to a named person" },
  { re: /[“"][^”"]{8,}[,.!?]?[”"]\s*,?\s*(?:says|said|told us|tells us|writes|wrote|explains|explained|adds|added|recalls|recalled|notes|noted)\b/i, code: "testimonial", what: "a quotation attributed to someone" },
  { re: /\b(?:says|said|told us|tells us|wrote|writes|explains|explained|recalls|recalled|put it|puts it)\b[^.“"]{0,60}[:,]?\s*[“"][^”"]{8,}/i, code: "testimonial", what: "a quotation attributed to someone" },
  { re: /\bas\s+(?:one|a|another|many|our)\s+(?:\w+\s+){0,2}(?:told us|put it|said|says|explained|wrote)\b/i, code: "testimonial", what: "a reported statement" },
  { re: /(?:^|\n|>)\s*[—–]\s*[A-Z][a-z]+\s[A-Z]\.?(?:,\s*[A-Z][a-z]+)?\s*(?:<|\n|$)/, code: "testimonial", what: "a quote signature line" },
  { re: /\b(?:testimonials?|reviews?)\s+from\s+(?:our\s+)?(?:customers|users|clients|investors)\b/i, code: "testimonial", what: "customer testimonials" },
  { re: /\b(?:one|a|another|many|our)\s+(?:happy\s+|satisfied\s+)?(?:customers?|users?|clients?|investors?|landowners?|buyers?|sellers?)\s+(?:said|says|told us|wrote|reports?)\b/i, code: "testimonial", what: "a reported customer statement" },
  { re: /★{3,}|\b[45](?:\.\d)?[- ]stars?\b|\b5\/5\b/i, code: "social_proof", what: "a star rating" },
  { re: /\b(?:trusted|used|loved|chosen)\s+by\s+(?:thousands|hundreds|millions|\d[\d,]*\+?)\b/i, code: "social_proof", what: "an adoption claim" },
  { re: /\b(?:thousands|hundreds|millions)\s+of\s+(?:investors|customers|users|landowners|buyers)\b/i, code: "social_proof", what: "an adoption claim" },
  { re: /\bjoin\s+(?:\d[\d,]*\+?|thousands|hundreds)\b/i, code: "social_proof", what: "an adoption claim" },
  { re: /\b(?:our|acreos)\s+(?:customers|users|clients)\s+(?:save|saved|earn|earned|close|closed|average|doubled|tripled)\b/i, code: "social_proof", what: "a customer-outcome claim" },
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Screen generated text for invented claims and fake social proof.
 * `allowDollarFigures` lists dollar figures that are facts of the case (the
 * customer's own purchase, an amount they wrote) — never invented.
 * `verifiedSources` adds founder-supplied sources to VERIFIED_SOURCES.
 */
export function screenFabrication(
  text: string,
  opts: { allowDollarFigures?: string[]; verifiedSources?: readonly VerifiedSource[] } = {},
): ClaimViolation[] {
  const out: ClaimViolation[] = [];
  const canonical = normalizeForScreen(text ?? "");
  for (const p of PROOF_RES) {
    const m = p.re.exec(canonical);
    if (m) {
      out.push({
        code: p.code,
        severity: "critical",
        match: m[0].slice(0, 120),
        message: `Generated content contains ${p.what}. AcreOS has no such quote or proof to cite — refusing rather than fabricating.`,
      });
    }
  }
  const sources = [...VERIFIED_SOURCES, ...(opts.verifiedSources ?? [])];
  const allowed = (opts.allowDollarFigures ?? []).map((x) => x.replace(/\s/g, "")).filter(Boolean);
  const { text: plain, anchors } = toScreenText(canonical);
  const units: Array<{ text: string; citable: boolean }> = [
    ...sentences(plain).flatMap((s) => clauses(s).map((c) => ({ text: c, citable: true }))),
    // A link's own words are screened as UNCITED text: a claim cannot cite itself.
    ...anchors.flatMap((a) => sentences(a).map((c) => ({ text: c, citable: false }))),
  ];
  for (const u of units) {
    const speech = REPORTED_SPEECH.exec(u.text);
    if (speech) {
      out.push({
        code: "testimonial",
        severity: "critical",
        match: speech[0].slice(0, 120),
        message: `Generated content reports what someone said ("${speech[0]}"). AcreOS has no such statement to cite — refusing rather than fabricating.`,
      });
      continue;
    }
    // Facts of the case and record references (#123) are not claims.
    let probe = u.text.replace(/#\d+\b/g, " ");
    for (const a of allowed) probe = probe.split(a).join(" ").split(a.replace(/^\$/, "$ ")).join(" ");
    const claim = boundClaim(probe.replace(/⟦CITE:[^⟧]*⟧/g, " "));
    if (!claim) continue;
    if (u.citable && citedByVerified(u.text, sources)) continue;
    out.push({
      code: "unsourced_statistic",
      severity: "critical",
      match: claim.slice(0, 120),
      message: `Generated content states a quantity as a claim ("${claim}") without a citation link to a verified source in the same clause. Naming a source is not citing it: link to ${sources.flatMap((x) => x.hosts).join(", ") || "a verified source"} beside the claim, or remove it.`,
    });
  }
  return out;
}

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
 *   1. STRUCTURAL: any sentence carrying a QUANTITY — a digit, a number word,
 *      a magnitude word (k, grand, figures, most, majority, half, double…) or
 *      a time quantity (days, a fortnight…) — fails unless the same sentence
 *      LINKS to a host on the verified-source allowlist (VERIFIED_SOURCES, or
 *      founder-supplied opts.verifiedSources). Naming a source is not citing
 *      it: "According to the IRS, 87% …" is refused without the link, because
 *      the name costs a model nothing. Facts of the case (opts
 *      .allowDollarFigures) and record references (#123) are not claims.
 *   2. Any REPORTED SPEECH or QUOTATION — "told me/us", "says", "said", a
 *      quoted passage, a <blockquote>/<cite> — and star ratings, adoption and
 *      customer-outcome claims are refused outright. AcreOS has no customer quotes to cite; a model cannot have
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

/**
 * STRUCTURAL claim detection (audit M1, round 2). Enumerating claim SHAPES
 * failed open twice — "Nine of every ten buyers", "over 4k parcels", "net
 * five figures per flip", "close deals in a fortnight on average" each slipped
 * a shape list. So a sentence is a CLAIM when it carries ANY quantity at all:
 * a digit, a number word, a magnitude word, or a time quantity. What it says
 * does not matter; only whether it can be checked does.
 */
const QUANTITY_RES: Array<{ re: RegExp; what: string }> = [
  { re: /\d/, what: "a number" },
  {
    re: /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|first|second|third|fourth|fifth|tenth|once|twice|thrice|single|pair|couple|percent|percentage)\b/i,
    what: "a number word",
  },
  {
    re: /\b(?:k|grand|figures?|most|majority|minority|half|halves|halved|quarters?|double[ds]?|doubling|triple[ds]?|tripling|quadrupl\w*|\w+fold|average|averages|median|typical(?:ly)?|dozens?)\b/i,
    what: "a magnitude",
  },
  {
    re: /\b(?:fortnight|overnight|week(?:s|end)?|days?|months?|years?|hours?|minutes?|quarterly|annually|yearly|monthly|weekly|daily)\b/i,
    what: "a time quantity",
  },
];

/** Reported speech: someone said something. Refused outright — AcreOS has no one to quote. */
const REPORTED_SPEECH = /\b(?:told|tell|tells)\s+(?:me|us|him|her|them|you)\b|\b(?:says|said|saying|quoted|quote|quotes|recalls|recalled|wrote|writes|explained|explains|mentioned|shared with (?:me|us))\b|[“”"«»][^“”"«»]{8,}[“”"«»]/i;

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

function sentences(text: string): string[] {
  return text
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The verified source a sentence LINKS to (host on the allowlist), or null. Naming one is not enough. */
function verifiedLink(sentence: string, sources: readonly VerifiedSource[]): string | null {
  for (const m of sentence.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    const h = hostOf(m[0]);
    if (!h) continue;
    const src = sources.find((s) => s.hosts.some((host) => h === host || h.endsWith(`.${host}`)));
    if (src) return src.name;
  }
  return null;
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
  const raw = text ?? "";
  for (const p of PROOF_RES) {
    const m = p.re.exec(raw);
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
  for (const s of sentences(raw)) {
    const speech = REPORTED_SPEECH.exec(s);
    if (speech) {
      out.push({
        code: "testimonial",
        severity: "critical",
        match: speech[0].slice(0, 120),
        message: `Generated content reports what someone said ("${speech[0]}"). AcreOS has no such statement to cite — refusing rather than fabricating.`,
      });
      continue;
    }
    // Facts of the case (the customer's own purchase amount) and ticket /
    // record references (#123) are not claims; links are judged separately.
    let probe = s.replace(/https?:\/\/[^\s"'<>)]+/gi, " ").replace(/#\d+\b/g, " ");
    for (const a of allowed) probe = probe.split(a).join(" ").split(a.replace(/^\$/, "$ ")).join(" ");
    let hit: { m: RegExpExecArray; what: string } | null = null;
    for (const q of QUANTITY_RES) {
      const m = q.re.exec(probe);
      if (m) {
        hit = { m, what: q.what };
        break;
      }
    }
    if (!hit) continue;
    if (verifiedLink(s, sources)) continue;
    out.push({
      code: "unsourced_statistic",
      severity: "critical",
      match: hit.m[0].slice(0, 120),
      message: `Generated content states ${hit.what} ("${hit.m[0]}") without a link to a verified source in the same sentence. Naming a source is not citing it: link to ${sources.flatMap((x) => x.hosts).join(", ") || "a verified source"}, or remove the claim.`,
    });
  }
  return out;
}

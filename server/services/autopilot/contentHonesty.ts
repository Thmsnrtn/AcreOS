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
 *   1. Any numeric, statistical or comparative CLAIM — digits or words
 *      ("Eighty-seven percent", "one in twenty", "9/10", "nearly half",
 *      "doubled their close rate", "3x", "$3,500 off", "4,000 dollars") — must
 *      carry, in the same sentence, a CITATION THE GATE CAN VERIFY: the name of
 *      a source on VERIFIED_SOURCES (real public sources this codebase names),
 *      one the founder supplied (opts.verifiedSources), or a link to one of
 *      their hosts. A generic cue is not a citation — "according to our
 *      internal data", "a recent study", or an invented publication name are
 *      exactly what a model writes when it has no source — so they are refused
 *      with the reason named.
 *   2. Any QUOTATION or TESTIMONIAL — a quote attributed to a person ("…,"
 *      says Mike R.; As one landowner told us, "…"), a <blockquote>/<cite>,
 *      star ratings, adoption and customer-outcome claims — is refused
 *      outright. AcreOS has no customer quotes to cite; a model cannot have
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

/** Cues a model uses to LOOK sourced. Not a citation by themselves. */
const SOURCE_CUE = /\b(according to|per (?:the )?[A-Z]|source[sd]?:|sourced from|as reported by|reported by|published by|a (?:recent )?(?:study|survey|report)|research (?:shows|finds|found)|data (?:shows|show))\b/i;

const NUMBER_WORD = String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)`;

/** Shapes that read as a factual, numeric, statistical or comparative claim. */
const CLAIM_RES: Array<{ re: RegExp; what: string; dollar?: boolean }> = [
  { re: /\b\d{1,3}(?:\.\d+)?\s?%/, what: "a percentage" },
  { re: /\b\d{1,3}(?:\.\d+)?\s?(?:percent|per cent|pct)\b/i, what: "a percentage" },
  { re: new RegExp(String.raw`\b${NUMBER_WORD}(?:[\s-]+${NUMBER_WORD})*\s+(?:percent|per cent)\b`, "i"), what: "a percentage" },
  { re: new RegExp(String.raw`\b(?:\d+|${NUMBER_WORD})\s+(?:in|out of)\s+(?:every\s+)?(?:\d+|${NUMBER_WORD})\b`, "i"), what: "a ratio" },
  { re: /(?<![\/\d])\b\d{1,3}\s?\/\s?\d{1,3}\b(?!\s?\/\d)/, what: "a ratio" },
  { re: /\b(?:nearly|almost|about|roughly|over|under|more than|less than|fewer than|just over|just under)?\s*(?:half|a third|one third|a quarter|one quarter|two[\s-]thirds|three[\s-]quarters|the majority|a majority|the minority)\s+of\b/i, what: "a proportion" },
  { re: /\bmost\s+(?:land\s+)?(?:investors|buyers|sellers|landowners|owners|customers|users|people|agents|brokers|deals|parcels)\b/i, what: "a proportion" },
  { re: /\b(?:doubl|tripl|quadrupl|halv)(?:e|ed|es|ing)\b/i, what: "a comparative claim" },
  { re: /\b\d+(?:\.\d+)?\s?x\b(?!\s?\d)/i, what: "a comparative claim" },
  { re: new RegExp(String.raw`\b(?:twice|thrice|(?:\d+|${NUMBER_WORD})\s+times)\s+(?:as|more|faster|higher|better|lower|cheaper|less)\b`, "i"), what: "a comparative claim" },
  { re: /\b(?:more|less|fewer|faster|higher|lower|better|cheaper)\s+than\s+(?:the\s+)?(?:average|most|others|competitors|industry)\b/i, what: "a comparative claim" },
  { re: /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|million|billion)?\b/i, what: "a dollar figure", dollar: true },
  { re: /\b\d[\d,]*(?:\.\d+)?\s?(?:k|thousand|million|billion)?\s?(?:dollars?|usd|bucks)\b/i, what: "a dollar figure", dollar: true },
  { re: new RegExp(String.raw`\b${NUMBER_WORD}(?:[\s-]+${NUMBER_WORD})*\s+(?:dollars?|bucks)\b`, "i"), what: "a dollar figure", dollar: true },
  { re: /\b\d[\d,]{2,}\+?\s+(?:investors|customers|users|buyers|sellers|landowners|people|members|deals|parcels|acres sold)\b/i, what: "a count of people/deals" },
  { re: /\b(?:average|median|typical(?:ly)?)\b[^.]{0,40}\b\d[\d,.]*/i, what: "an average/median figure" },
];

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

/** The verified source a sentence cites (by name, or by a link to its host), or null. */
function verifiedCitation(sentence: string, sources: readonly VerifiedSource[]): string | null {
  // Names are read from the prose only — a URL that merely CONTAINS a source's
  // name ("usda.gov.example.net") is judged by its host below, never its text.
  const prose = sentence.replace(/https?:\/\/[^\s"'<>)]+/gi, " ");
  for (const src of sources) if (src.pattern.test(prose)) return src.name;
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
  const allowed = new Set((opts.allowDollarFigures ?? []).map((s) => s.replace(/\s/g, "")));
  for (const s of sentences(raw)) {
    let claim: RegExpMatchArray | undefined;
    let what = "";
    for (const st of CLAIM_RES) {
      // Every occurrence, not only the first: an allowed figure (the
      // customer's own purchase) must not shield an invented one beside it.
      const all = [...s.matchAll(new RegExp(st.re.source, st.re.flags.includes("g") ? st.re.flags : `${st.re.flags}g`))];
      const m = all.find((x) => !(st.dollar && allowed.has(x[0].replace(/\s/g, ""))));
      if (m) {
        claim = m;
        what = st.what;
        break;
      }
    }
    if (!claim) continue;
    if (verifiedCitation(s, sources)) continue;
    const cue = SOURCE_CUE.exec(s);
    out.push({
      code: "unsourced_statistic",
      severity: "critical",
      match: claim[0].slice(0, 120),
      message: cue
        ? `Generated content states ${what} ("${claim[0]}") and cites "${cue[0]}…", which is not a source this gate can verify. Cite a verified source (${sources.map((x) => x.name).join(", ")}) or remove the claim.`
        : `Generated content states ${what} ("${claim[0]}") with no verifiable source in the same sentence. Cite a verified source (${sources.map((x) => x.name).join(", ")}) or remove it.`,
    });
  }
  return out;
}

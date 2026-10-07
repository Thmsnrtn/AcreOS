/**
 * Content honesty screen — the `lint:no-fabrication` philosophy applied to
 * GENERATED content (Stage 2, the Writer and Retention role workers).
 *
 * "Fabrication is never acceptable: no invented numbers, no fake activity, no
 * placeholder data presented as real." The repo's lint enforces that over
 * source code; nothing enforced it over what a model writes for the public
 * field-notes surface or a customer email. A model asked for a persuasive
 * explainer will happily write "87% of investors overpay" or "— Mike R.,
 * Texas: AcreOS saved me $4,000". Both are invented, both read as fact.
 *
 * This screen FAILS CLOSED: anything shaped like a statistic must carry a
 * source attribution in the same sentence, and anything shaped like a
 * testimonial or social proof is refused outright (AcreOS has no customer
 * quotes to cite; a model cannot have one either). A false block costs one
 * revision; a false pass publishes a lie under the founder's name.
 *
 * Pure + deterministic → exhaustively testable. Returns ClaimViolation-shaped
 * rows so it composes into the existing publish gate (publishArtifact.ts
 * screenForPublish) as one more layer, not a second gate.
 */
import type { ClaimViolation } from "./claimsEngine";

/** A sentence counts as sourced when it attributes its number to someone. */
const SOURCE_CUE =
  /\b(according to|per (?:the )?[A-Z]|source[sd]?:|sourced from|as reported by|reported by|published by|(?:county|state|federal|census|usda|irs|fema|bls|nar)\b[^.]*\b(?:data|records?|report|survey|estimates?|figures)|as of (?:19|20)\d\d|\((?:source|via|see)\b)/i;

/** Number shapes that read as a factual statistic. */
const STAT_RES: Array<{ re: RegExp; what: string }> = [
  { re: /\b\d{1,3}(?:\.\d+)?\s?%/, what: "a percentage" },
  { re: /\b\d{1,3}(?:\.\d+)?\s?percent\b/i, what: "a percentage" },
  { re: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:in|out of) (?:\d+|ten|five|four|three|two)\b/i, what: "a ratio" },
  { re: /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|million|billion)?\b(?![^.]*\b(?:fee|price|plan|per month|\/mo)\b)/i, what: "a dollar figure" },
  { re: /\b\d[\d,]{2,}\+?\s+(?:investors|customers|users|buyers|sellers|landowners|people|members|deals|parcels|acres sold)\b/i, what: "a count of people/deals" },
  { re: /\b(?:average|median|typical(?:ly)?)\b[^.]{0,40}\b\d[\d,.]*/i, what: "an average/median figure" },
];

/** Testimonial / social-proof shapes — refused outright, sourced or not. */
const PROOF_RES: Array<{ re: RegExp; code: string; what: string }> = [
  { re: /[“"][^”"]{8,}[”"]\s*(?:[—–-]{1,2}|,)\s*[A-Z][a-z]+(?:\s[A-Z]\.?)?/, code: "testimonial", what: "a quotation attributed to a named person" },
  { re: /(?:^|\n|>)\s*[—–]\s*[A-Z][a-z]+\s[A-Z]\.?(?:,\s*[A-Z][a-z]+)?\s*(?:<|\n|$)/, code: "testimonial", what: "a quote signature line" },
  { re: /\b(?:testimonials?|reviews?)\s+from\s+(?:our\s+)?(?:customers|users|clients|investors)\b/i, code: "testimonial", what: "customer testimonials" },
  { re: /\b(?:one|a|another|many|our)\s+(?:happy\s+|satisfied\s+)?(?:customers?|users?|clients?|investors?)\s+(?:said|says|told us|wrote|reports?)\b/i, code: "testimonial", what: "a reported customer statement" },
  { re: /★{3,}|\b[45](?:\.\d)?[- ]stars?\b|\b5\/5\b/i, code: "social_proof", what: "a star rating" },
  { re: /\b(?:trusted|used|loved|chosen)\s+by\s+(?:thousands|hundreds|millions|\d[\d,]*\+?)\b/i, code: "social_proof", what: "an adoption claim" },
  { re: /\b(?:thousands|hundreds|millions)\s+of\s+(?:investors|customers|users|landowners|buyers)\b/i, code: "social_proof", what: "an adoption claim" },
  { re: /\bjoin\s+(?:\d[\d,]*\+?|thousands|hundreds)\b/i, code: "social_proof", what: "an adoption claim" },
  { re: /\b(?:our|acreos)\s+(?:customers|users|clients)\s+(?:save|saved|earn|earned|close|closed|average)\b/i, code: "social_proof", what: "a customer-outcome claim" },
];

function sentences(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Screen generated text for invented statistics and fake social proof.
 * `allowDollarFigures` lists dollar figures that are facts of the case (the
 * customer's own purchase, an amount they wrote) — never invented.
 */
export function screenFabrication(text: string, opts: { allowDollarFigures?: string[] } = {}): ClaimViolation[] {
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
  const allowed = new Set((opts.allowDollarFigures ?? []).map((s) => s.replace(/\s/g, "")));
  for (const s of sentences(raw)) {
    if (SOURCE_CUE.test(s)) continue;
    for (const st of STAT_RES) {
      // Every occurrence, not only the first: an allowed figure (the
      // customer's own purchase) must not shield an invented one beside it.
      const all = [...s.matchAll(new RegExp(st.re.source, st.re.flags.includes("g") ? st.re.flags : `${st.re.flags}g`))];
      const m = all.find((x) => !(st.what === "a dollar figure" && allowed.has(x[0].replace(/\s/g, ""))));
      if (!m) continue;
      out.push({
        code: "unsourced_statistic",
        severity: "critical",
        match: m[0].slice(0, 120),
        message: `Generated content states ${st.what} ("${m[0]}") with no source in the same sentence. Cite where it comes from (e.g. "according to the county assessor, as of 2024") or remove it.`,
      });
      break;
    }
  }
  return out;
}

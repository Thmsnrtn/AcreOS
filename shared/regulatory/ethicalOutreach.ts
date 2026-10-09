/**
 * The ethical-outreach check for a template a customer sends to landowners.
 *
 * Three rules, each a finding with a reason the investor can act on:
 *
 *   DECEPTIVE (refused at send) — copy that makes a landowner believe
 *     something false: an "official" / "final" / tax-deed / past-due notice
 *     look (government impersonation), a guarantee, false familiarity ("as we
 *     discussed", "following up on our conversation" in a cold letter), or a
 *     fabricated deadline. The FTC Act § 5 (15 U.S.C. § 45(a)) declares
 *     deceptive acts or practices in or affecting commerce unlawful.
 *   OFFER BASIS (warned) — copy that names a dollar offer must say how the
 *     number was set (comparable sales, assessed value, the parcel's access or
 *     condition…). A bare number to a long-held owner reads as an appraisal.
 *   PROBATE CARE (warned) — copy to an estate, an heir or a recently bereaved
 *     owner (or any copy that mentions an estate or a death) may not use
 *     urgency, and must point to the executor / personal representative or
 *     an attorney and say there is no rush.
 *
 * Pure; reads only the text and what the caller says about the audience.
 */

export type OutreachRule = "deceptive" | "offer_basis" | "probate_care";

export interface OutreachFinding {
  rule: OutreachRule;
  /** "refuse" — the send is refused; "warn" — shown before the send. */
  severity: "refuse" | "warn";
  match: string;
  why: string;
}

const DECEPTIVE: Array<{ re: RegExp; why: string }> = [
  { re: /\b(?:final|official|important legal|urgent legal|second)\s+notice\b/i, why: "reads as an official or legal notice; an offer letter is not a notice" },
  { re: /\bnotice\s+of\s+(?:default|foreclosure|tax\s+(?:deed|sale|lien)|delinquen\w+)\b/i, why: "imitates a government or court notice" },
  { re: /\b(?:past\s+due|delinquent\s+account|amount\s+due|payment\s+required)\b/i, why: "implies the owner owes the sender money" },
  { re: /\b(?:county|state|government|treasurer'?s?|tax\s+collector'?s?|assessor'?s?)\s+(?:office|department|division|agency)\s+(?:of|requires|notice)\b/i, why: "implies the letter comes from a government office" },
  { re: /\bguarantee(?:d|s)?\b/i, why: "a guarantee the investor cannot make" },
  { re: /\b(?:as\s+we\s+discussed|as\s+promised|following\s+up\s+on\s+our\s+(?:conversation|call|meeting)|per\s+our\s+(?:conversation|call))\b/i, why: "claims a prior conversation that did not happen in cold outreach" },
  { re: /\b(?:offer|this\s+deal|price)\s+expires?\s+(?:today|tomorrow|tonight|in\s+\d+\s+(?:hours?|days?))\b|\b(?:only|just)\s+\d+\s+(?:hours?|days?)\s+left\b|\blast\s+chance\b|\bact\s+(?:now|immediately)\b/i, why: "a manufactured deadline" },
];

const OFFER = /\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:k\b)?[^.\n]{0,60}\b(?:offer|cash|pay|purchase)\b|\b(?:offer|cash|pay|purchase)\b[^.\n]{0,60}\$\s?\d/i;
const OFFER_BASIS = /\b(?:based\s+on|because|comparable|comps?\b|recent(?:ly)?\s+sold|recent\s+sales|sales\s+of\s+similar|assessed\s+value|appraised|per\s+acre|how\s+we\s+(?:arrived|set|got|calculated)|our\s+offer\s+reflects|we\s+(?:looked|reviewed)\s+at)\b/i;

const PROBATE_TOPIC = /\b(?:estate\s+of|probate|executor|executrix|personal\s+representative|heirs?|inherit(?:ed|ance)|passed\s+away|passing\s+of|deceased|late\s+(?:mr|mrs|ms)\.?|condolences|sorry\s+for\s+your\s+loss)\b/i;
const PROBATE_URGENCY = /\b(?:quick(?:ly)?|fast|asap|right\s+away|immediately|before\s+the\s+court|avoid\s+probate\s+costs|expires?|deadline|limited\s+time|today)\b/i;
const PROBATE_CARE = /\b(?:executor|executrix|personal\s+representative|(?:estate\s+)?attorney|lawyer)\b[\s\S]*\b(?:no\s+rush|no\s+hurry|take\s+(?:your|all\s+the)\s+time|whenever\s+(?:you(?:'re|\s+are)\s+ready|it\s+suits))\b|\b(?:no\s+rush|no\s+hurry|take\s+(?:your|all\s+the)\s+time)\b[\s\S]*\b(?:executor|executrix|personal\s+representative|(?:estate\s+)?attorney|lawyer)\b/i;

export function checkOutreachTemplate(input: { text: string; audience?: { probate?: boolean } }): OutreachFinding[] {
  const text = input.text ?? "";
  const out: OutreachFinding[] = [];
  for (const d of DECEPTIVE) {
    const m = d.re.exec(text);
    if (m) out.push({ rule: "deceptive", severity: "refuse", match: m[0], why: d.why });
  }
  const offer = OFFER.exec(text);
  if (offer && !OFFER_BASIS.test(text)) {
    out.push({ rule: "offer_basis", severity: "warn", match: offer[0].trim(), why: "names an offer without saying how it was set — add the basis (comparable sales, assessed value, access, condition)" });
  }
  const probate = input.audience?.probate === true || PROBATE_TOPIC.test(text);
  if (probate) {
    const urgent = PROBATE_URGENCY.exec(text);
    if (urgent) out.push({ rule: "probate_care", severity: "warn", match: urgent[0], why: "urgency toward an estate or a bereaved family" });
    if (!PROBATE_CARE.test(text)) out.push({ rule: "probate_care", severity: "warn", match: "", why: "to an estate or heir: point to the executor / personal representative or an attorney, and say there is no rush" });
  }
  return out;
}

export function refusesSend(findings: OutreachFinding[]): boolean {
  return findings.some((f) => f.severity === "refuse");
}

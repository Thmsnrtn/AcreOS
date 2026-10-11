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
 * BILINGUAL (W5b). Every rule has a Spanish form, and BOTH forms run on every
 * text whatever language the campaign says it is in — a Spanish "AVISO FINAL"
 * in a campaign marked English is refused exactly like "FINAL NOTICE". The
 * Spanish patterns use Unicode-aware word edges (`\b` is ASCII-only in JS and
 * never sees an edge before "última" or "pérdida").
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

/** Unicode word edges for the Spanish patterns. */
const L = "(?<![\\p{L}\\p{N}_])";
const R = "(?![\\p{L}\\p{N}_])";
const es = (body: string): RegExp => new RegExp(`${L}(?:${body})${R}`, "iu");

const DECEPTIVE_ES: Array<{ re: RegExp; why: string }> = [
  { re: es("(?:aviso|notificaci[oó]n)\\s+(?:final|oficial|legal|urgente|importante)|(?:[uú]ltimo|segundo)\\s+aviso"), why: "reads as an official or legal notice (Spanish); an offer letter is not a notice" },
  { re: es("aviso\\s+de\\s+(?:incumplimiento|ejecuci[oó]n\\s+hipotecaria|embargo|venta\\s+(?:por|de)\\s+impuestos|morosidad|subasta)"), why: "imitates a government or court notice (Spanish)" },
  { re: es("pago\\s+(?:vencido|atrasado|requerido|pendiente)|cuenta\\s+morosa|saldo\\s+(?:vencido|adeudado)|monto\\s+adeudado"), why: "implies the owner owes the sender money (Spanish)" },
  { re: es("(?:oficina|departamento|divisi[oó]n|agencia)\\s+(?:del?\\s+)?(?:tesorer[oa]|recaudador(?:a)?\\s+de\\s+impuestos|tasador(?:a)?|gobierno)|(?:oficina|departamento)\\s+del?\\s+(?:condado|estado)\\s+(?:requiere|notifica|informa)"), why: "implies the letter comes from a government office (Spanish)" },
  { re: es("garantiz(?:a|amos|ado|ada|ados|adas|o)|garant[ií]a(?:s)?"), why: "a guarantee the investor cannot make (Spanish)" },
  { re: es("como\\s+(?:lo\\s+)?(?:hablamos|conversamos|acordamos|prometimos)|seg[uú]n\\s+(?:lo\\s+)?(?:hablado|conversado|acordado)|(?:dando|en)\\s+seguimiento\\s+a\\s+nuestra\\s+(?:conversaci[oó]n|llamada|reuni[oó]n)"), why: "claims a prior conversation that did not happen in cold outreach (Spanish)" },
  { re: es("(?:la\\s+)?oferta\\s+(?:vence|expira|caduca)\\s+(?:hoy|ma[nñ]ana|esta\\s+noche|en\\s+\\d+\\s+(?:horas?|d[ií]as?))|(?:solo|s[oó]lo)\\s+(?:le\\s+)?(?:quedan|restan)\\s+\\d+\\s+(?:horas?|d[ií]as?)|(?:quedan|restan)\\s+(?:solo|s[oó]lo)\\s+\\d+\\s+(?:horas?|d[ií]as?)|[uú]ltima\\s+oportunidad|(?:act[uú]e|act[uú]a|responda|llame)\\s+(?:ya|ahora\\s+mismo|de\\s+inmediato|inmediatamente)"), why: "a manufactured deadline (Spanish)" },
];

const OFFER_ES = new RegExp(
  `\\$\\s?\\d[\\d,.]*[^.\\n]{0,60}${L}(?:ofert\\p{L}*|ofrec\\p{L}*|ofrezc\\p{L}*|efectivo|pag\\p{L}*|compr\\p{L}*)|${L}(?:ofert\\p{L}*|ofrec\\p{L}*|ofrezc\\p{L}*|efectivo|pag\\p{L}*|compr\\p{L}*)[^.\\n]{0,60}\\$\\s?\\d`,
  "iu",
);
const OFFER_BASIS_ES = es("basad[oa]s?\\s+en|con\\s+base\\s+en|debido\\s+a|porque|comparables?|ventas\\s+recientes|vendid[oa]s?\\s+recientemente|terrenos\\s+similares|valor\\s+(?:catastral|tasado|de\\s+tasaci[oó]n|fiscal|de\\s+aval[uú]o)|aval[uú]o|por\\s+acre|as[ií]\\s+(?:calculamos|llegamos)|c[oó]mo\\s+(?:calculamos|llegamos)|nuestra\\s+oferta\\s+refleja|revisamos");

const PROBATE_TOPIC_ES = es("sucesi[oó]n|testamentari[oa]|albacea|representante\\s+personal|herederos?|herederas?|hered(?:[oó]|ado|ada|aron)|herencia|falleci(?:[oó]|do|da|miento)|difunt[oa]|condolencias|lamentamos\\s+(?:mucho\\s+)?su\\s+p[eé]rdida|sentido\\s+p[eé]same");
const PROBATE_URGENCY_ES = es("r[aá]pid[oa]s?|r[aá]pidamente|con\\s+rapidez|pronto|de\\s+inmediato|inmediatamente|cuanto\\s+antes|ya\\s+mismo|evitar\\s+(?:los\\s+)?costos\\s+de\\s+(?:la\\s+)?sucesi[oó]n|vence|fecha\\s+l[ií]mite|tiempo\\s+limitado|hoy");
const PROBATE_CARE_ES = new RegExp(
  `${L}(?:albacea|representante\\s+personal|abogad[oa])${R}[\\s\\S]*${L}(?:sin\\s+prisa|no\\s+hay\\s+prisa|t[oó]mese\\s+(?:su|todo\\s+el)\\s+tiempo|cuando\\s+(?:est[eé]n?|se\\s+sienta)\\s+list[oa]s?|cuando\\s+le\\s+convenga)${R}` +
    `|${L}(?:sin\\s+prisa|no\\s+hay\\s+prisa|t[oó]mese\\s+(?:su|todo\\s+el)\\s+tiempo)${R}[\\s\\S]*${L}(?:albacea|representante\\s+personal|abogad[oa])${R}`,
  "iu",
);

const OFFER = /\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:k\b)?[^.\n]{0,60}\b(?:offer|cash|pay|purchase)\b|\b(?:offer|cash|pay|purchase)\b[^.\n]{0,60}\$\s?\d/i;
const OFFER_BASIS = /\b(?:based\s+on|because|comparable|comps?\b|recent(?:ly)?\s+sold|recent\s+sales|sales\s+of\s+similar|assessed\s+value|appraised|per\s+acre|how\s+we\s+(?:arrived|set|got|calculated)|our\s+offer\s+reflects|we\s+(?:looked|reviewed)\s+at)\b/i;

const PROBATE_TOPIC = /\b(?:estate\s+of|probate|executor|executrix|personal\s+representative|heirs?|inherit(?:ed|ance)|passed\s+away|passing\s+of|deceased|late\s+(?:mr|mrs|ms)\.?|condolences|sorry\s+for\s+your\s+loss)\b/i;
const PROBATE_URGENCY = /\b(?:quick(?:ly)?|fast|asap|right\s+away|immediately|before\s+the\s+court|avoid\s+probate\s+costs|expires?|deadline|limited\s+time|today)\b/i;
const PROBATE_CARE = /\b(?:executor|executrix|personal\s+representative|(?:estate\s+)?attorney|lawyer)\b[\s\S]*\b(?:no\s+rush|no\s+hurry|take\s+(?:your|all\s+the)\s+time|whenever\s+(?:you(?:'re|\s+are)\s+ready|it\s+suits))\b|\b(?:no\s+rush|no\s+hurry|take\s+(?:your|all\s+the)\s+time)\b[\s\S]*\b(?:executor|executrix|personal\s+representative|(?:estate\s+)?attorney|lawyer)\b/i;

export function checkOutreachTemplate(input: { text: string; audience?: { probate?: boolean } }): OutreachFinding[] {
  const text = input.text ?? "";
  const out: OutreachFinding[] = [];
  for (const d of [...DECEPTIVE, ...DECEPTIVE_ES]) {
    const m = d.re.exec(text);
    if (m) out.push({ rule: "deceptive", severity: "refuse", match: m[0], why: d.why });
  }
  const offer = OFFER.exec(text) ?? OFFER_ES.exec(text);
  if (offer && !OFFER_BASIS.test(text) && !OFFER_BASIS_ES.test(text)) {
    out.push({ rule: "offer_basis", severity: "warn", match: offer[0].trim(), why: "names an offer without saying how it was set — add the basis (comparable sales, assessed value, access, condition)" });
  }
  const probate = input.audience?.probate === true || PROBATE_TOPIC.test(text) || PROBATE_TOPIC_ES.test(text);
  if (probate) {
    const urgent = PROBATE_URGENCY.exec(text) ?? PROBATE_URGENCY_ES.exec(text);
    if (urgent) out.push({ rule: "probate_care", severity: "warn", match: urgent[0], why: "urgency toward an estate or a bereaved family" });
    if (!PROBATE_CARE.test(text) && !PROBATE_CARE_ES.test(text)) out.push({ rule: "probate_care", severity: "warn", match: "", why: "to an estate or heir: point to the executor / personal representative or an attorney, and say there is no rush" });
  }
  return out;
}

export function refusesSend(findings: OutreachFinding[]): boolean {
  return findings.some((f) => f.severity === "refuse");
}

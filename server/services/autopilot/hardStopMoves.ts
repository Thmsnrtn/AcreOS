/**
 * Hard-stop classification for MOVES (Stage 2, S9).
 *
 * The hands lane already refuses to REGISTER an actuator for a hard-stop class
 * (hardStops.ts matchHardStopHand), and the executor / agent-authority lanes
 * refuse theirs. A MOVE is a fourth shape: the Operator (a model) may propose a
 * net-new move such as "purge_inactive_customer_data" or "raise_prices_40pct".
 * In the founder simulation the deletion proposal was held SILENTLY (the
 * compliance gate blocked it once and the escalation classifier treats a
 * single compliance block as self-correction), and the pricing proposal
 * reached the founder as an ordinary "Approve a finance action" — which, now
 * that approving an ask enqueues the move, a one-tap yes would have queued.
 *
 * So a move is screened for the hard-stop classes BEFORE any gate: it is never
 * enqueued (not by the loop, not by an approval), and it is ALWAYS surfaced to
 * the founder as what it is. Pure.
 */
import { HARD_STOP_SPEND_LIMIT_USD, matchHardStopHand, type HardStop } from "./hardStops";

/**
 * FAIL-CLOSED hard-stop vocabulary (audit H4). The first version matched a
 * verb next to a noun ("raise … prices"), so a model only had to word it
 * differently — "repricing", "move everyone to the Pro tier", "countersign the
 * vendor's terms", "anonymize churned accounts" — and the move read as
 * ordinary. A hard-stop is now recognised by the SUBJECT it touches, not the
 * verb a model chose: anything touching pricing / plans / tiers / fees,
 * anything touching contracts / terms / signatures, and any deletion,
 * anonymization or erasure of customer data. A false hold costs the founder
 * one tap; a false pass is a pricing change or a data purge.
 */
const MOVE_PATTERNS: ReadonlyArray<{ re: RegExp; hardStop: HardStop }> = [
  // pricing — the subject itself: price/pricing/repricing, fees, discounts,
  // coupons, tiers, and named / paid / subscription plans.
  {
    re: /\b(re-?pric\w*|pric(?:e|es|ed|ing)|fees?|surcharges?|discount\w*|coupons?|promo(?:tional)?[\s_-]?codes?|tiers?|(?:subscription|billing|paid|pro|premium|starter|basic|growth|enterprise|annual|monthly)[\s_-]+plans?|plans?[\s_-]+(?:change|migration|limits?|upgrade|downgrade|pricing))\b/i,
    hardStop: "pricing_changes",
  },
  // pricing, the plan-move shapes: free/paid cohorts, a named plan with a
  // number, "the 49 option", "N a month going forward".
  {
    re: /\b(?:free|paid|trial)[\s_-]+(?:users?|plans?|tiers?|accounts?|customers?|members?|cohorts?)\b[\s\S]*\b(?:to|onto|into)\b|\b(?:to|onto|into)[\s_-]+(?:paid|the[\s_-]+\$?\d+[\s_-]+(?:option|plan|package|level))\b|\b(?:starter|pro|premium|enterprise|basic|plus|business)\b[\s_-]+\$?\d+\b|\b\$?\d+[\s_-]+(?:a|per|\/)[\s_-]*(?:month|mo|year|yr)[\s_-]+going[\s_-]+forward\b/i,
    hardStop: "pricing_changes",
  },
  // pricing, by what the customer PAYS (red-team working set, 2026-10-07):
  // "simplify what customers pay", "adjust what the Pro bundle costs", "the
  // monthly amount new signups are charged", "retire the legacy rate",
  // "annual billing … at a higher number", "the entry package", "a single 79 level".
  {
    re: /\bwhat\s+(?:\w+[\s-]+){0,3}(?:pays?|paying|costs?|is\s+charged|are\s+charged)\b|\b(?:amount|price|sum)\s+(?:\w+[\s-]+){0,3}(?:is|are|get|gets)?\s*charged\b|\b(?:legacy|founding(?:[\s-]+member)?|member|grandfathered|introductory|subscription|monthly|annual|yearly)[\s-]+rates?\b|\b(?:annual|monthly|yearly)[\s-]+billing\b|\b(?:entry|starter|basic|base|pro|premium|top|single|cheapest|lowest)[\s-]+(?:\$?\d+[\s-]+)?(?:package|bundle|level|option)s?\b|\b(?:package|bundle)s?\b[\s\S]{0,40}\b(?:costs?|\$?\d+[\s-]+(?:level|option))\b/i,
    hardStop: "pricing_changes",
  },
  // legal — contracts, agreements, terms, signatures, settlements, acceptance
  // of an offer/terms, indemnities. "sign" but not "sign up / sign in / signal".
  {
    re: /\b(contracts?|agreements?|terms(?:[\s_-]+of[\s_-]+(?:service|use))?|tos|countersign\w*|sign(?:s|ed|ing)?(?![\s_-]*(?:up|in|out|on|al))|signatures?|e-?sign\w*|docusign|settle(?:ment)?s?|leases?|nda|indemn\w*|addend(?:um|a)|accept(?:s|ed|ing|ance)?[\s_-]+(?:\w+[\s_-]+){0,3}?(?:terms|offer|contract|agreement|quote|proposal))\b/i,
    hardStop: "legal_signing",
  },
  {
    re: /\b(paperwork|renewals?|t&cs?|conditions|obligations?|binding|commit(?:s|ted|ting)?[\s_-]+to[\s_-]+(?:a|the)[\s_-]+(?:vendor|partner|supplier)|agree(?:s|d|ing)?[\s_-]+to|okay[\s_-]+the|ok[\s_-]+the|approve[\s_-]+the[\s_-]+(?:vendor|renewal|deal))\b/i,
    hardStop: "legal_signing",
  },
  // customer-data deletion — any deleting / purging / erasing / wiping /
  // anonymizing / pseudonymizing / redacting / scrubbing verb anywhere with a
  // customer-data subject anywhere.
  {
    re: /\b(delet\w*|purg\w*|eras\w*|wip(?:e|es|ed|ing)|destroy\w*|anonymi[sz]\w*|pseudonymi[sz]\w*|de-?identif\w*|redact\w*|scrub\w*|forget|drop(?:s|ped|ping)?[\s_-]+(?:the[\s_-]+|all[\s_-]+)?(?:table|rows?|data|records?|accounts?))\b[\s\S]*\b(customers?|users?|orgs?|organi[sz]ations?|accounts?|tenants?|leads?|contacts?|data|records?|pii|histor(?:y|ies)|profiles?|emails?)\b|\b(customers?|users?|orgs?|organi[sz]ations?|accounts?|tenants?|leads?|contacts?|data|records?|pii|profiles?)\b[\s\S]*\b(delet\w*|purg\w*|eras\w*|wip(?:e|es|ed|ing)|anonymi[sz]\w*|pseudonymi[sz]\w*|redact\w*)\b/i,
    hardStop: "customer_data_deletion",
  },
  {
    re: /\b(?:clear(?:ing)?[\s_-]+out|get(?:ting)?[\s_-]+rid[\s_-]+of|remov\w*|offboard\w*|cull\w*|prun\w*|retire\w*)\b[\s\S]*\b(?:borrowers?|buyers?|sellers?|customers?|users?|members?|accounts?|leads?|contacts?|signups?|tenants?|orgs?|them|for[\s_-]+good|permanently|forever)\b/i,
    hardStop: "customer_data_deletion",
  },
];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "two thousand five hundred" → 2500; null when it is not a number phrase. Pure. */
function wordsToNumber(phrase: string): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of phrase.toLowerCase().split(/[\s-]+/).filter((x) => x && x !== "and" && x !== "a")) {
    if (w in NUMBER_WORDS) {
      current += NUMBER_WORDS[w];
      seen = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (w === "thousand" || w === "grand") {
      total += (current || 1) * 1_000;
      current = 0;
      seen = true;
    } else if (w === "million") {
      total += (current || 1) * 1_000_000;
      current = 0;
      seen = true;
    } else return null;
  }
  return seen ? total + current : null;
}

const DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)\s?(k|m|thousand|million)?`;
const WORDNUM = String.raw`((?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|million|and|a)[\s-]+)+)`;

function scaled(base: string, mult?: string): number {
  const n = Number(base.replace(/,/g, ""));
  const m = (mult ?? "").toLowerCase();
  return n * (m === "k" || m === "thousand" ? 1_000 : m === "m" || m === "million" ? 1_000_000 : 1);
}

/**
 * Every USD amount a text states, as a total commitment (audit H4): "$2,000",
 * "$1.5k", "2,000 dollars", "USD 900", "two thousand dollars", and a RATE —
 * "$40/day for 30 days" is $1,200; "$40 a day" with no end is unbounded
 * (Infinity: an open-ended spend cannot be shown under any ceiling). Pure.
 */
export function moneyAmountsUsd(text: string): number[] {
  const out: number[] = [];
  const t = text ?? "";
  const amountRe = new RegExp(
    String.raw`(?:\$\s?${NUM}|\b${NUM}\s?(?:dollars?|usd|bucks)\b|\busd\s?${NUM}|\b${WORDNUM}(?:dollars?|bucks|grand)\b|\b(\d[\d,]*(?:\.\d+)?)\s?(k|grand)\b|\b(\d[\d,]*(?:\.\d+)?)(?=\s*(?:\/|per\b|a\b|an\b|each\b|every\b)\s*(?:day|week|month|year)\b))`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = amountRe.exec(t)) != null) {
    let amount: number | null = null;
    if (m[1] != null) amount = scaled(m[1], m[2]);
    else if (m[3] != null) amount = scaled(m[3], m[4]);
    else if (m[5] != null) amount = scaled(m[5], m[6]);
    else if (m[7] != null) {
      const n = wordsToNumber(m[7]);
      amount = n == null ? null : /grand$/i.test(m[0].trim()) ? n * 1_000 : n;
    }
    else if (m[8] != null) amount = scaled(m[8], m[9] === "grand" ? "thousand" : m[9]);
    else if (m[10] != null) amount = Number(m[10].replace(/,/g, ""));
    if (amount == null || !Number.isFinite(amount)) continue;
    // A rate? "/day", "per week", "a month", "each day", "daily".
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const rate = /^\s*(?:\/|per\b|a\b|an\b|each\b|every\b)\s*(day|week|month|year)\b|^\s*(daily|weekly|monthly|yearly|annually)\b/i.exec(after);
    if (rate) {
      const unit = (rate[1] ?? { daily: "day", weekly: "week", monthly: "month", yearly: "year", annually: "year" }[rate[2].toLowerCase()]).toLowerCase();
      const rest = after.slice(rate[0].length);
      const dur = /^\s*(?:for|over|x|×|during|across)\s*(?:the\s+next\s+|a\s+|an\s+)?(\d+|[a-z-]+)?\s*(day|week|month|year)s?\b/i.exec(rest);
      if (dur) {
        const count = dur[1] == null ? 1 : /^\d+$/.test(dur[1]) ? Number(dur[1]) : wordsToNumber(dur[1]);
        if (count == null) {
          out.push(Number.POSITIVE_INFINITY);
          continue;
        }
        out.push((amount * count * DAYS[dur[2].toLowerCase()]) / DAYS[unit]);
      } else {
        out.push(Number.POSITIVE_INFINITY); // open-ended recurring spend
      }
      continue;
    }
    out.push(amount);
  }
  return out;
}

/** Money-SHAPED text (founder-only for chat and grants, even with no parseable amount). Pure. */
const MONEY_SHAPED_RE =
  /\b(?:full|account|stripe|remaining|outstanding|credit|available)[\s_-]+balances?\b|\bstripe\b|\$\s?\d|\b\d[\d,.]*\s?(?:dollars?|usd|bucks|cents?)\b|\b(?:dollars?|usd)\b|\b(refund\w*|charg(?:e|es|ed|ing)|chargebacks?|payments?|pay(?:s|ing|outs?)?|spend\w*|spent|budgets?|invoic\w*|billing|bill(?:s|ed)?|credits?|money|cash|revenue|wires?|transfers?|ad[\s_-]?spend|costs?|dunning|subscriptions?|ads?|advertis\w*|promoted|boost(?:ed|ing)?|sponsored|campaigns?|grand|paid)\b/i;
export function isMoneyShaped(text: string): boolean {
  return MONEY_SHAPED_RE.test(text ?? "");
}

export interface MoveLike {
  kind: string;
  rationale?: string;
  isNetNew?: boolean;
}

/**
 * The hard-stop class a move implements, or null. Reads the move kind AND its
 * rationale (a model can name a harmless kind and describe the harm). A spend
 * over the hard-stop limit is detected from stated amounts on net-new moves
 * (catalog moves carry no free-form amounts). Pure + total.
 */
export function hardStopForMove(move: MoveLike): HardStop | null {
  const kindText = move.kind.replace(/_/g, " ");
  const hay = `${kindText} ${move.rationale ?? ""}`;
  const hand = matchHardStopHand(move.kind, move.rationale ?? "");
  if (hand) return hand;
  for (const p of MOVE_PATTERNS) if (p.re.test(hay)) return p.hardStop;
  if (moneyAmountsUsd(hay).some((a) => a > HARD_STOP_SPEND_LIMIT_USD)) return "spend_over_500_usd";
  return null;
}

// A sentence that says something was DONE (first person, perfective, passive
// completion) — the shape of a claim, as opposed to an explanation.
const COMPLETION_CLAIM = /\b(?:i['’]ve|i have|we['’]ve|we have|i['’]ll|we['’]ll|i will|we will|has been|have been|is done|are done|all done|done|taken care of|went ahead|accepted|signed|executed|lowered|raised|reduced|changed|deleted|erased|wiped|approved)\b/i;
const NEGATED = /\b(?:not|never|no|won['’]t|can['’]t|cannot|isn['’]t|aren['’]t|doesn['’]t|don['’]t|didn['’]t)\b/i;

/**
 * The hard-stop class a CUSTOMER-FACING message claims was done, or null.
 * Found by the simulation's red-team world (2026-10-07): a support reply
 * telling a customer "I've taken care of it: … accept the reseller's proposed
 * terms on our behalf" was witnessed and posted. A role worker may explain,
 * and may say the founder is reviewing — it may never tell a customer that a
 * founder-only action (pricing, legal signing, a spend over the limit, a data
 * deletion) has been or will be done. Per sentence: a completion claim, not
 * negated, not an honest hand-off to the founder, whose subject is a hard-stop. Pure.
 */
export function claimsFounderOnlyAction(text: string): HardStop | null {
  for (const sentence of (text ?? "").split(/(?<=[.!?])\s+|\n+/)) {
    if (!COMPLETION_CLAIM.test(sentence) || NEGATED.test(sentence)) continue;
    if (/\bfounder\b/i.test(sentence)) continue;
    const hs = hardStopForMove({ kind: "customer_reply", rationale: sentence });
    if (hs) return hs;
  }
  return null;
}

/**
 * The classes that are FOUNDER-TAP ONLY — never released by a WitnessGrant and
 * never answered for him by the chat. The four permanent hard-stops (which an
 * approval does not even enqueue), plus two that the founder's own tap on the
 * Decisions door may approve: any net-new move (the kernel has never seen it)
 * and any finance-domain or money-shaped move.
 */
export const FOUNDER_ONLY_CLASSES = [
  "pricing_changes",
  "legal_signing",
  "spend_over_500_usd",
  "customer_data_deletion",
  "net_new_move",
  "money_or_finance",
] as const;
export type FounderOnlyClass = (typeof FOUNDER_ONLY_CLASSES)[number];

/** The founder-only class a move falls in, or null. Fails closed. Pure. */
export function founderOnlyClassForMove(move: MoveLike & { domain?: string }): FounderOnlyClass | null {
  const hs = hardStopForMove(move);
  if (hs) return hs;
  if (move.isNetNew) return "net_new_move";
  if (move.domain === "finance" || isMoneyShaped(`${move.kind.replace(/_/g, " ")} ${move.rationale ?? ""}`)) return "money_or_finance";
  return null;
}

const HARD_STOP_LABEL: Record<HardStop, string> = {
  pricing_changes: "a pricing change",
  legal_signing: "legal signing",
  spend_over_500_usd: `a spend over $${HARD_STOP_SPEND_LIMIT_USD}`,
  customer_data_deletion: "deleting customer data",
};

/** The founder-facing ask for a held hard-stop move — ONE wording, used by the loop and planAndAct (so a repeat folds). */
export function heldHardStopAsk(move: MoveLike & { kind: string }, hardStop: HardStop): { questionSummary: string; questionBody: string } {
  return {
    questionSummary: `Held — founder-only: ${HARD_STOP_LABEL[hardStop]} (${move.kind})`,
    questionBody: [
      `The autopilot proposed ${HARD_STOP_LABEL[hardStop]}: ${move.rationale ?? "(no rationale given)"}`,
      "",
      "This is a permanent hard-stop — never autonomous, and approving here does NOT run it. Nothing was done.",
      "If you want it, do it yourself; if not, decline and it stays held.",
    ].join("\n"),
  };
}

/**
 * S9 — screen EVERY move the loop is considering (not only the one that wins
 * the tick): each hard-stop proposal is surfaced as a held ask and removed, so
 * it can never act and is never held silently because it ranked second.
 */
export async function holdAndSurfaceHardStops<M extends MoveLike & { kind: string }>(
  moves: M[],
  ask: (a: { questionSummary: string; questionBody: string }) => Promise<unknown>,
): Promise<{ remaining: M[]; held: Array<{ kind: string; hardStop: HardStop }> }> {
  const remaining: M[] = [];
  const held: Array<{ kind: string; hardStop: HardStop }> = [];
  for (const m of moves) {
    const hs = hardStopForMove(m);
    if (!hs) {
      remaining.push(m);
      continue;
    }
    held.push({ kind: m.kind, hardStop: hs });
    await ask(heldHardStopAsk(m, hs));
  }
  return { remaining, held };
}

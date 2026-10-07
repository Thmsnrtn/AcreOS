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

const MOVE_PATTERNS: ReadonlyArray<{ re: RegExp; hardStop: HardStop }> = [
  // pricing — raise/lower/cut/change … price(s)/pricing/plan price
  { re: /\b(raise|raising|lower|lowering|increase|increasing|decrease|decreasing|cut|cutting|change|changing|update|updating|set|setting|adjust|adjusting|discount|discounting)[\s_-]+(?:\w+[\s_-]+){0,3}?(price|prices|pricing)\b/i, hardStop: "pricing_changes" },
  { re: /\b(price|prices|pricing)[\s_-]+(increase|decrease|change|hike|cut|update)\b/i, hardStop: "pricing_changes" },
  // legal signing — sign/execute a contract/agreement/settlement
  { re: /\b(sign|signing|execute|executing|countersign)[\s_-]+(?:\w+[\s_-]+){0,3}?(contract|agreement|settlement|lease|nda|legal)\b/i, hardStop: "legal_signing" },
  // customer-data deletion — delete/purge/erase/wipe … customer/user/org/account … data/records/accounts
  { re: /\b(delete|deleting|purge|purging|erase|erasing|wipe|wiping|destroy|destroying|drop|dropping)[\s_-]+(?:\w+[\s_-]+){0,4}?(customer|user|org|organization|account|tenant|lead)s?[\s_-]*(?:\w+[\s_-]+){0,2}?(data|records|accounts|rows|history)?\b/i, hardStop: "customer_data_deletion" },
];

/** Dollar amounts in free text ("$2,000", "$1.5k"). Pure. */
function dollarAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const base = Number(m[1].replace(/,/g, ""));
    const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
    if (Number.isFinite(base)) out.push(base * mult);
  }
  return out;
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
  if (move.isNetNew && dollarAmounts(hay).some((a) => a > HARD_STOP_SPEND_LIMIT_USD)) return "spend_over_500_usd";
  return null;
}

export const HARD_STOP_LABEL: Record<HardStop, string> = {
  pricing_changes: "a pricing change",
  legal_signing: "legal signing",
  spend_over_500_usd: `a spend over $${HARD_STOP_SPEND_LIMIT_USD}`,
  customer_data_deletion: "deleting customer data",
};

/**
 * Routine support runs without a per-ticket tap (founder decision 2026-10-09,
 * docs/company/founder-decisions-2026-10-08.md; constitution
 * `routine-support-autonomy`).
 *
 * Solene's support worker drafts every reply and refund into the witnessed
 * queue (pending actions) exactly as before. This policy releases a draft
 * WITHOUT the founder's tap only when the ticket it answers is ROUTINE:
 *
 *   how_to       the customer asks how to do something in AcreOS;
 *   account      login, password, email, plan, billing date, invoice, seats,
 *                cancelling (in-app);
 *   small_refund a refund of a purchase, at or under the existing $50 refund
 *                ceiling, through the existing refund hand.
 *
 * Everything else goes to the founder as ONE ask per ticket: anything legal
 * (the support legal-intake classifier), money above $50, a data-deletion
 * request, an angry customer, a bug report, and anything UNCLEAR. The
 * classifier FAILS CLOSED: release needs a positive routine signal AND no risk
 * signal, and every unknown — an unreadable ticket, a classifier error, a
 * draft that does not match the ticket's kind — holds the draft for the
 * founder.
 *
 * Release goes through the same approvePendingHand path a founder tap uses
 * (hash re-verify, atomic claim, the hand's own rules, the panic stop, the
 * receipt), after the founder's live controls (delegationBlockedByControls)
 * and the hand's delegated rules (delegatedHandRefusal). Every release and
 * every hold is written to the experience log, which is what the Story door
 * reads (/api/founder/autopilot/story).
 */
import { classifyLegalIntake } from "../supportLegalIntake";
import { REFUND_CEILING_CENTS } from "../autopilot/hands/apply-refund";

export const ROUTINE_SUPPORT_DECISION = "founder decision 2026-10-09: routine support tickets are answered without a per-ticket tap";
/** The approver attribution on a release (the audit / receipt / Story read it). */
export const ROUTINE_SUPPORT_APPROVER = "solene (routine-support policy, founder decision 2026-10-09)";
/** The hands this policy may ever release, and the only drafting role. */
export const ROUTINE_SUPPORT_HANDS = ["reply_support_ticket", "apply_refund"] as const;
export const ROUTINE_SUPPORT_ROLE = "support";

export type RoutineKind = "how_to" | "account" | "small_refund";
export type FounderReason =
  | "legal"
  | "data_deletion"
  | "money_over_ceiling"
  | "angry"
  | "bug"
  | "unclear"
  | "unreadable";

export type TicketTriage =
  | { verdict: "routine"; kind: RoutineKind; signals: string[] }
  | { verdict: "founder"; reason: FounderReason; detail: string };

export interface TicketText {
  subject?: string | null;
  description?: string | null;
  /** The customer's own follow-up messages (role "user"), oldest first. */
  customerMessages?: string[];
}

// ── risk signals (any one → founder) ────────────────────────────────────────
const ANGRY: RegExp[] = [
  /\b(?:furious|livid|outraged|disgusted|appalled|infuriat\w*|pissed)\b/i,
  /\b(?:unacceptable|ridiculous|absurd|pathetic|disgrace(?:ful)?|incompetent|useless|garbage|worst)\b/i,
  /\b(?:scam(?:med|mers?)?|fraud(?:ulent)?|rip(?:ped)?[\s-]?off|theft|stole|stealing)\b/i,
  /\b(?:chargeback|charge[\s-]?back|dispute (?:the|this) charge|report(?:ing)? you|better business bureau|BBB|FTC|attorney general)\b/i,
  /\b(?:wtf|damn|hell|crap|shit\w*|fuck\w*|bullshit)\b/i,
  /!!+/,
  /\?\?\?+/,
];
const BUG = /\b(?:bug|error|crash(?:ed|es|ing)?|broken|won'?t (?:load|work|open|save)|doesn'?t (?:load|work|save)|not (?:working|loading)|nothing happen(?:s|ed)|spin(?:s|ning)? forever|blank (?:page|screen)|500|failed to)\b/i;
// ── routine signals (one needed) ────────────────────────────────────────────
const HOW_TO = /\b(?:how (?:do|can|should|would) i|how to|where (?:do|can|is|are)|can i\b|is there a way|what(?:'s| is) the (?:best )?way|help me (?:find|set ?up|import|send|use)|walk me through|guide|tutorial|step[s]? to)\b/i;
const ACCOUNT = /\b(?:password|log ?in|sign ?in|reset|two[\s-]?factor|2fa|email address|change (?:my )?email|account settings|my plan|upgrade|downgrade|billing date|renewal date|invoice|receipt|seat|add (?:a )?(?:user|teammate|member)|cancel(?:ling|lation)? (?:my )?(?:subscription|plan|account)|cancel)\b/i;
const REFUND = /\b(?:refund|money back|charged (?:twice|again|by mistake|in error)|double[\s-]?charged)\b/i;
const DOLLARS = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;

const MIN_MEANINGFUL_CHARS = 20;

function dollarAmountsCents(text: string): number[] {
  return [...text.matchAll(DOLLARS)].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100)).filter((n) => Number.isFinite(n));
}

function capsShouting(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
  if (words.length < 4) return false;
  const loud = words.filter((w) => w === w.toUpperCase()).length;
  return loud / words.length >= 0.5;
}

/**
 * Pure. Routine only when a routine signal is present and NO risk signal is.
 * Fails closed: any exception is "founder: unreadable".
 */
export function triageTicket(t: TicketText): TicketTriage {
  try {
    const parts = [t.subject ?? "", t.description ?? "", ...(t.customerMessages ?? [])].map((s) => String(s ?? ""));
    const text = parts.join("\n").trim();
    if (text.replace(/\s+/g, " ").length < MIN_MEANINGFUL_CHARS) {
      return { verdict: "founder", reason: "unclear", detail: "the ticket says too little to know what is being asked" };
    }
    const legal = classifyLegalIntake(text);
    if (legal) {
      return legal.kind === "data_deletion"
        ? { verdict: "founder", reason: "data_deletion", detail: legal.label }
        : { verdict: "founder", reason: "legal", detail: legal.label };
    }
    for (const re of ANGRY) {
      const m = re.exec(text);
      if (m) return { verdict: "founder", reason: "angry", detail: `the customer is upset ("${m[0]}")` };
    }
    if (capsShouting(text)) return { verdict: "founder", reason: "angry", detail: "the customer is writing in capitals" };
    const amounts = dollarAmountsCents(text);
    const over = amounts.find((c) => c > REFUND_CEILING_CENTS);
    if (over != null) {
      return { verdict: "founder", reason: "money_over_ceiling", detail: `$${(over / 100).toFixed(2)} is over the $${(REFUND_CEILING_CENTS / 100).toFixed(2)} the support worker may handle` };
    }
    if (BUG.test(text)) return { verdict: "founder", reason: "bug", detail: "the customer reports something not working" };

    const signals: string[] = [];
    if (REFUND.test(text)) signals.push("refund");
    if (ACCOUNT.test(text)) signals.push("account");
    if (HOW_TO.test(text)) signals.push("how_to");
    if (signals.length === 0) {
      return { verdict: "founder", reason: "unclear", detail: "no how-to, account or small-refund request recognised" };
    }
    const kind: RoutineKind = signals.includes("refund") ? "small_refund" : signals.includes("account") ? "account" : "how_to";
    return { verdict: "routine", kind, signals };
  } catch (err) {
    return { verdict: "founder", reason: "unreadable", detail: `the ticket could not be classified (${err instanceof Error ? err.message : String(err)})` };
  }
}

export interface DraftToJudge {
  handName: string;
  sourceRole: string | null;
  args: Record<string, unknown>;
}

export type DraftVerdict =
  | { release: true; triage: Extract<TicketTriage, { verdict: "routine" }> }
  | { release: false; reason: string; triage: TicketTriage | null; escalate: boolean };

/**
 * Pure. Whether one frozen support draft may go out under the policy, given
 * its ticket's triage. `escalate` says the ticket belongs with the founder
 * (as one ask); false means "not this policy's to judge" (another hand, role).
 */
export function judgeDraft(draft: DraftToJudge, ticket: TicketText | null): DraftVerdict {
  if (!isRoutineSupportDraft(draft)) {
    return { release: false, reason: "not a support-worker reply or refund", triage: null, escalate: false };
  }
  if (!ticket) return { release: false, reason: "the ticket could not be read — held for the founder", triage: null, escalate: true };
  const triage = triageTicket(ticket);
  if (triage.verdict !== "routine") return { release: false, reason: `${triage.reason}: ${triage.detail}`, triage, escalate: true };
  if (draft.handName === "apply_refund") {
    const cents = typeof draft.args.amount_cents === "number" ? draft.args.amount_cents : NaN;
    if (triage.kind !== "small_refund") return { release: false, reason: "a refund drafted on a ticket that does not ask for one", triage, escalate: true };
    if (!Number.isFinite(cents) || cents <= 0 || cents > REFUND_CEILING_CENTS) {
      return { release: false, reason: `refund amount not provably within $${(REFUND_CEILING_CENTS / 100).toFixed(2)}`, triage, escalate: true };
    }
  }
  return { release: true, triage };
}

/** True for the drafts this policy judges: a support-worker reply or refund. */
export function isRoutineSupportDraft(draft: Pick<DraftToJudge, "handName" | "sourceRole">): boolean {
  return (ROUTINE_SUPPORT_HANDS as readonly string[]).includes(draft.handName) && draft.sourceRole === ROUTINE_SUPPORT_ROLE;
}

/** The ticket a frozen support draft answers (reply: ticket_id; refund: the "ticket #N" its reason names). */
export function ticketIdOfDraft(draft: DraftToJudge): number | null {
  const direct = draft.args.ticket_id;
  if (typeof direct === "number" && Number.isInteger(direct) && direct > 0) return direct;
  const m = /^ticket #(\d+):/.exec(String(draft.args.reason ?? ""));
  return m ? Number(m[1]) : null;
}

/**
 * State security-deposit return deadlines + itemization duties.
 *
 * Why this registry exists
 * ────────────────────────
 * `security_deposits.statutoryDeadline` shipped as a column with a comment
 * ("state-driven (Texas 30d)") and NO writer — no route ever populated it.
 * Deposit mishandling is the single most common landlord-tenant claim, and
 * the penalty in most states is not "return the money late", it is forfeiture
 * of the right to withhold ANYTHING plus statutory damages (often 2-3x the
 * deposit) plus fees. A column nobody fills is worse than no column: the UI
 * renders an empty countdown and the operator believes there is no clock.
 *
 * Posture (identical to leaseNoticeRules.ts and the late_fee_rules table)
 * ──────────────────────────────────────────────────────────────────────
 *   - Landlord/operator side only. This is not tenant-rights advice.
 *   - Every entry carries its statutory citation.
 *   - A state we are NOT confident about is ABSENT, and the absence is
 *     surfaced verbatim ("deadline for KY is not in the registry") rather
 *     than defaulted to 30 days. Guessing a deposit deadline is exactly the
 *     fabrication this codebase refuses: the operator would rely on a date
 *     we invented, in the one workflow where the date IS the liability.
 *   - Needs attorney review per state before being relied on in court. The
 *     same caveat the late-fee rules carry.
 *
 * Two-branch statutes
 * ───────────────────
 * Several states set a SHORTER deadline when the landlord withholds nothing
 * (FL 15d vs 30d, MT 10d vs 30d, IL 45d return vs 30d itemization). Where the
 * branches differ we encode both and pick by `hasDeductions`. Where a statute
 * gives the landlord a longer window only on a condition we cannot verify from
 * our own data (a lease clause, a tenant's written demand, damages that are
 * "not reasonably ascertainable"), we encode the SHORTER window and put the
 * condition in `note`. Being early is never the violation.
 */

export interface DepositReturnRule {
  /** 2-letter state / jurisdiction code. */
  state: string;
  /**
   * Days the landlord has to deliver the itemized statement + any refund when
   * amounts ARE withheld. This is the deadline the clock counts to.
   */
  deadlineDays: number;
  /**
   * Days allowed when NOTHING is withheld, where the statute is shorter or
   * longer than `deadlineDays`. Undefined ⇒ same window either way.
   */
  deadlineDaysNoDeductions?: number;
  /** true ⇒ `deadlineDays` is counted in business days, not calendar days. */
  businessDays?: boolean;
  /** Whether an itemized written statement of deductions is required. */
  itemizedStatementRequired: boolean;
  citation: string;
  /** Conditions/caveats the operator must read before relying on the date. */
  note?: string;
}

/**
 * Deliberately incomplete. An absent jurisdiction is reported as unknown.
 * KY is absent on purpose: KRS §383.580 runs a two-stage process (itemized
 * list, then a tenant-response window, then forfeiture consequences) that
 * does not reduce to a single "N days from move-out" number we are willing
 * to put in front of an operator. Same rule as everywhere else here — if we
 * are not sure, we say so.
 */
const RULES: Record<string, DepositReturnRule> = {
  AL: { state: "AL", deadlineDays: 60, itemizedStatementRequired: true, citation: "Ala. Code §35-9A-201(b)" },
  AK: {
    state: "AK", deadlineDays: 14, itemizedStatementRequired: true,
    citation: "Alaska Stat. §34.03.070(b)",
    note: "14 days where the tenancy ended with the notice the statute requires; 30 days where the tenant left without proper notice. Encoded at 14 — the shorter window.",
  },
  AZ: {
    state: "AZ", deadlineDays: 14, businessDays: true, itemizedStatementRequired: true,
    citation: "A.R.S. §33-1321(D)",
    note: "14 BUSINESS days. Weekends are excluded below; state holidays are not encoded, so treat the computed date as the outer edge.",
  },
  AR: { state: "AR", deadlineDays: 60, itemizedStatementRequired: true, citation: "Ark. Code §18-16-305" },
  CA: { state: "CA", deadlineDays: 21, itemizedStatementRequired: true, citation: "Cal. Civ. Code §1950.5(g)" },
  CO: {
    state: "CO", deadlineDays: 30, itemizedStatementRequired: true,
    citation: "C.R.S. §38-12-103(1)",
    note: "A written lease may extend this to as much as 60 days. Encoded at the 30-day statutory default; verify the lease before relying on a longer window.",
  },
  CT: {
    state: "CT", deadlineDays: 30, itemizedStatementRequired: true,
    citation: "Conn. Gen. Stat. §47a-21(d)(2)",
    note: "30 days after termination, or 15 days after the landlord receives the tenant's forwarding address, whichever is LATER. Encoded at 30 from move-out.",
  },
  DC: { state: "DC", deadlineDays: 45, itemizedStatementRequired: true, citation: "14 DCMR §308-309" },
  DE: { state: "DE", deadlineDays: 20, itemizedStatementRequired: true, citation: "25 Del. C. §5514(f)" },
  FL: {
    state: "FL", deadlineDays: 30, deadlineDaysNoDeductions: 15, itemizedStatementRequired: true,
    citation: "Fla. Stat. §83.49(3)",
    note: "15 days to return the deposit when nothing is withheld; 30 days to send the written notice of intent to impose a claim when something is.",
  },
  GA: { state: "GA", deadlineDays: 30, itemizedStatementRequired: true, citation: "O.C.G.A. §44-7-34(a)" },
  HI: { state: "HI", deadlineDays: 14, itemizedStatementRequired: true, citation: "HRS §521-44(c)" },
  IA: { state: "IA", deadlineDays: 30, itemizedStatementRequired: true, citation: "Iowa Code §562A.12(3)" },
  ID: {
    state: "ID", deadlineDays: 21, itemizedStatementRequired: true,
    citation: "Idaho Code §6-321",
    note: "21 days by default; a written agreement may allow up to 30. Encoded at 21.",
  },
  IL: {
    state: "IL", deadlineDays: 30, deadlineDaysNoDeductions: 45, itemizedStatementRequired: true,
    citation: "765 ILCS 710/1",
    note: "Itemized statement (with paid receipts or estimates) within 30 days of vacating; the balance within 45. The 30-day itemization deadline is the binding one when anything is withheld.",
  },
  IN: { state: "IN", deadlineDays: 45, itemizedStatementRequired: true, citation: "Ind. Code §32-31-3-12" },
  KS: { state: "KS", deadlineDays: 30, itemizedStatementRequired: true, citation: "K.S.A. §58-2550(b)" },
  LA: { state: "LA", deadlineDays: 30, itemizedStatementRequired: true, citation: "La. R.S. §9:3251(A)" },
  MA: { state: "MA", deadlineDays: 30, itemizedStatementRequired: true, citation: "Mass. Gen. Laws c.186 §15B(4)" },
  MD: { state: "MD", deadlineDays: 45, itemizedStatementRequired: true, citation: "Md. Code, Real Prop. §8-203(e)(1)" },
  ME: {
    state: "ME", deadlineDays: 21, itemizedStatementRequired: true,
    citation: "14 M.R.S. §6033",
    note: "21 days for a tenancy at will; 30 days under a written lease. Encoded at 21 — the shorter window.",
  },
  MI: { state: "MI", deadlineDays: 30, itemizedStatementRequired: true, citation: "MCL §554.609" },
  MN: { state: "MN", deadlineDays: 21, itemizedStatementRequired: true, citation: "Minn. Stat. §504B.178(3)" },
  MO: { state: "MO", deadlineDays: 30, itemizedStatementRequired: true, citation: "Mo. Rev. Stat. §535.300(3)" },
  MS: { state: "MS", deadlineDays: 45, itemizedStatementRequired: true, citation: "Miss. Code §89-8-21(3)" },
  MT: {
    state: "MT", deadlineDays: 30, deadlineDaysNoDeductions: 10, itemizedStatementRequired: true,
    citation: "Mont. Code §70-25-202",
    note: "10 days when no deductions are taken; 30 days when a deduction is made and an itemized list is delivered.",
  },
  NC: {
    state: "NC", deadlineDays: 30, itemizedStatementRequired: true,
    citation: "N.C.G.S. §42-52",
    note: "30 days; if the extent of the loss is not reasonably ascertainable in that window, an interim accounting is due at 30 days and the final one at 60. Encoded at 30.",
  },
  ND: { state: "ND", deadlineDays: 30, itemizedStatementRequired: true, citation: "N.D. Cent. Code §47-16-07.1(3)" },
  NE: { state: "NE", deadlineDays: 14, itemizedStatementRequired: true, citation: "Neb. Rev. Stat. §76-1416(2)" },
  NH: { state: "NH", deadlineDays: 30, itemizedStatementRequired: true, citation: "N.H. RSA §540-A:7" },
  NJ: { state: "NJ", deadlineDays: 30, itemizedStatementRequired: true, citation: "N.J.S.A. §46:8-21.1" },
  NM: { state: "NM", deadlineDays: 30, itemizedStatementRequired: true, citation: "N.M. Stat. §47-8-18(C)" },
  NV: { state: "NV", deadlineDays: 30, itemizedStatementRequired: true, citation: "NRS §118A.242(4)" },
  NY: { state: "NY", deadlineDays: 14, itemizedStatementRequired: true, citation: "N.Y. Gen. Oblig. Law §7-108(1-a)(e)" },
  OH: { state: "OH", deadlineDays: 30, itemizedStatementRequired: true, citation: "Ohio Rev. Code §5321.16(B)" },
  OK: {
    state: "OK", deadlineDays: 30, itemizedStatementRequired: true,
    citation: "Okla. Stat. tit. 41 §115(B)",
    note: "The statute runs the window from the tenant's written demand for the deposit. Encoded from move-out, which is never later than the demand.",
  },
  OR: { state: "OR", deadlineDays: 31, itemizedStatementRequired: true, citation: "ORS §90.300(13)" },
  PA: { state: "PA", deadlineDays: 30, itemizedStatementRequired: true, citation: "68 P.S. §250.512(a)" },
  RI: { state: "RI", deadlineDays: 20, itemizedStatementRequired: true, citation: "R.I. Gen. Laws §34-18-19(b)" },
  SC: { state: "SC", deadlineDays: 30, itemizedStatementRequired: true, citation: "S.C. Code §27-40-410(b)" },
  SD: {
    state: "SD", deadlineDays: 14, itemizedStatementRequired: true,
    citation: "S.D.C.L. §43-32-24",
    note: "14 days to return the undisputed portion; a written itemized accounting is due within 45 days on the tenant's request.",
  },
  TN: { state: "TN", deadlineDays: 30, itemizedStatementRequired: true, citation: "T.C.A. §66-28-301(g)" },
  TX: { state: "TX", deadlineDays: 30, itemizedStatementRequired: true, citation: "Tex. Prop. Code §92.103(a), §92.104(c)" },
  UT: { state: "UT", deadlineDays: 30, itemizedStatementRequired: true, citation: "Utah Code §57-17-3(2)" },
  VA: { state: "VA", deadlineDays: 45, itemizedStatementRequired: true, citation: "Va. Code §55.1-1226(A)" },
  VT: { state: "VT", deadlineDays: 14, itemizedStatementRequired: true, citation: "9 V.S.A. §4461(c)" },
  WA: { state: "WA", deadlineDays: 30, itemizedStatementRequired: true, citation: "RCW 59.18.280(1)" },
  WI: { state: "WI", deadlineDays: 21, itemizedStatementRequired: true, citation: "Wis. Stat. §704.28(4)" },
  WV: {
    state: "WV", deadlineDays: 60, itemizedStatementRequired: true,
    citation: "W. Va. Code §37-6A-2(a)",
    note: "60 days after the tenancy ends, or 45 days after a new tenant occupies the unit, whichever is EARLIER. Encoded at 60 from move-out; re-letting the unit shortens it.",
  },
  WY: {
    state: "WY", deadlineDays: 30, itemizedStatementRequired: true,
    citation: "Wyo. Stat. §1-21-1208(a)",
    note: "30 days after the tenancy ends, or 15 days after receiving the tenant's forwarding address, whichever is later; 60 days where deductions for damage are itemized. Encoded at 30.",
  },
};

/** Every jurisdiction with an encoded deadline. Sorted, stable. */
export const DEPOSIT_RULE_STATES: readonly string[] = Object.keys(RULES).sort();

/** Returns the rule for a jurisdiction (2-letter, any case). Null if absent. */
export function getDepositReturnRule(state: string | null | undefined): DepositReturnRule | null {
  if (!state) return null;
  const key = state.toUpperCase().trim();
  return RULES[key] ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD date column into a UTC-midnight Date. Null if unusable. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const trimmed = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add calendar days in UTC. */
function addCalendarDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Add business days (Mon-Fri) in UTC. State holidays are NOT encoded — the
 * caller is told so via the rule's `note`, and the returned date is therefore
 * the outer edge rather than a guarantee.
 */
function addBusinessDays(from: Date, days: number): Date {
  let cursor = from;
  let remaining = days;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return cursor;
}

export interface DepositDeadlineResult {
  /** false ⇒ we have no encoded rule; every other field is null. */
  known: boolean;
  /** YYYY-MM-DD the itemized statement + refund must be delivered by. */
  deadlineDate: string | null;
  deadlineDays: number | null;
  businessDays: boolean;
  itemizedStatementRequired: boolean | null;
  citation: string | null;
  note: string | null;
  /** Populated ONLY when known=false. Render this verbatim; never a date. */
  unknownReason: string | null;
}

/**
 * The deposit clock. `moveOutDate` is the trigger — the day the tenancy
 * actually ended (move-out inspection date, or the lease's end date when the
 * lease is marked ended/terminated without an inspection).
 *
 * When the jurisdiction is not in the registry we return
 * `{ known: false, deadlineDate: null, unknownReason: "…" }`. Callers MUST
 * surface `unknownReason` instead of substituting a default — the whole point
 * of this function is to refuse to invent the one date that creates liability.
 */
export function computeDepositDeadline(args: {
  moveOutDate: string | null | undefined;
  state: string | null | undefined;
  hasDeductions: boolean;
}): DepositDeadlineResult {
  const unknown = (reason: string): DepositDeadlineResult => ({
    known: false,
    deadlineDate: null,
    deadlineDays: null,
    businessDays: false,
    itemizedStatementRequired: null,
    citation: null,
    note: null,
    unknownReason: reason,
  });

  const rule = getDepositReturnRule(args.state);
  if (!rule) {
    const label = args.state ? args.state.toUpperCase().trim() : "(no state on the lease)";
    return unknown(
      `No security-deposit return deadline is encoded for ${label}. AcreOS will not guess a statutory date — ` +
        "confirm the deadline with counsel for this jurisdiction and calendar it manually.",
    );
  }

  const moveOut = parseIsoDate(args.moveOutDate);
  if (!moveOut) {
    return unknown(
      `A move-out date is required before the ${rule.state} deposit clock can start (${rule.citation}). ` +
        "Record the move-out inspection date or the lease end date first.",
    );
  }

  const days =
    !args.hasDeductions && rule.deadlineDaysNoDeductions !== undefined
      ? rule.deadlineDaysNoDeductions
      : rule.deadlineDays;

  const deadline = rule.businessDays ? addBusinessDays(moveOut, days) : addCalendarDays(moveOut, days);

  return {
    known: true,
    deadlineDate: toIso(deadline),
    deadlineDays: days,
    businessDays: rule.businessDays === true,
    itemizedStatementRequired: rule.itemizedStatementRequired,
    citation: rule.citation,
    note: rule.note ?? null,
    unknownReason: null,
  };
}

export interface DepositCountdown {
  deadlineDate: string | null;
  /** Negative once the deadline has passed. Null when there is no deadline. */
  daysRemaining: number | null;
  overdue: boolean;
  /** true when ≤ 7 days remain (or it is already overdue). */
  urgent: boolean;
}

/** Countdown for the UI. No deadline ⇒ every field null/false, never a zero. */
export function depositDeadlineCountdown(
  deadlineDate: string | null | undefined,
  today: Date = new Date(),
): DepositCountdown {
  const deadline = parseIsoDate(deadlineDate);
  if (!deadline) {
    return { deadlineDate: null, daysRemaining: null, overdue: false, urgent: false };
  }
  const todayUtc = parseIsoDate(toIso(today)) ?? today;
  const daysRemaining = Math.round((deadline.getTime() - todayUtc.getTime()) / DAY_MS);
  return {
    deadlineDate: toIso(deadline),
    daysRemaining,
    overdue: daysRemaining < 0,
    urgent: daysRemaining <= 7,
  };
}

// shared/support/triage.ts
/**
 * Support-email triage for the support@ inbox watch (PKG-2 Stage 1b).
 *
 * SCOPE: this is the EMAIL inbox side. The in-app ticket system and its
 * `server/services/supportLegalIntake.ts` classifier are a separate, untouched
 * surface; this module mirrors that classifier's over-inclusive spirit for
 * privacy/legal-shaped mail.
 *
 * CLOCKS: the response clocks below are [PROPOSED] until Tom ratifies them.
 * They are internally operative (they order the human queue and drive
 * re-alerts) — nothing sends on them autonomously. Classification NEVER sends
 * anything.
 *
 * Pure functions, no zod, one import (the shared DSAR clock).
 */

import { stampDsarDeadline, type DsarDeadlineStamp } from "../privacy/dsarClock";

export const SUPPORT_TRIAGE_CATEGORIES = [
  "how-to",
  "bug",
  "billing-question",
  "billing-money",
  "complaint",
  "privacy",
  "legal-shaped",
  "abuse/security",
] as const;

export type SupportTriageCategory = (typeof SUPPORT_TRIAGE_CATEGORIES)[number];

/** The clocks are proposals until Tom ratifies them. */
export const SUPPORT_CLOCKS_STATUS = "PROPOSED" as const;

export type SupportFirstResponseClock =
  | { kind: "same-day" } // acknowledgement draft prepared the same day the message arrives
  | { kind: "same-business-day" } // first response within the same business day
  | { kind: "business-days"; days: number };

export interface SupportCategoryRouting {
  /** privacy + legal-shaped brief Tom the same day; billing-money same-day WITH the prepared pack. */
  briefTom: "same-day" | "digest";
  firstResponse: SupportFirstResponseClock;
  /** true only for privacy. */
  stampPrivacyDeadline: boolean;
  /** legal-shaped: no reply drafted for sending without Tom/counsel. */
  draftReply: "template-or-draft" | "none-without-tom-or-counsel";
  notes: string;
}

export const SUPPORT_CATEGORY_ROUTING: Record<SupportTriageCategory, SupportCategoryRouting> = {
  privacy: {
    briefTom: "same-day",
    firstResponse: { kind: "same-day" },
    stampPrivacyDeadline: true,
    draftReply: "template-or-draft",
    notes:
      "Acknowledgement draft to Tom same day; deadline stamped at arrival from the DSAR clock constant.",
  },
  "legal-shaped": {
    briefTom: "same-day",
    firstResponse: { kind: "same-day" },
    stampPrivacyDeadline: false,
    draftReply: "none-without-tom-or-counsel",
    notes:
      "Demand/regulator/attorney/rights-holder mail; never answered from a template alone.",
  },
  "billing-money": {
    briefTom: "same-day",
    firstResponse: { kind: "same-business-day" },
    stampPrivacyDeadline: false,
    draftReply: "template-or-draft",
    notes:
      "Refund/dispute/chargeback notice; briefs Tom same-day WITH the prepared pack.",
  },
  complaint: {
    briefTom: "digest",
    firstResponse: { kind: "same-business-day" },
    stampPrivacyDeadline: false,
    draftReply: "template-or-draft",
    notes: "Same business day acknowledgement draft.",
  },
  "billing-question": {
    briefTom: "digest",
    firstResponse: { kind: "business-days", days: 1 },
    stampPrivacyDeadline: false,
    draftReply: "template-or-draft",
    notes: "Routine billing question; first response within 1 business day.",
  },
  bug: {
    briefTom: "digest",
    firstResponse: { kind: "business-days", days: 1 },
    stampPrivacyDeadline: false,
    draftReply: "template-or-draft",
    notes: "Becomes an issue/package, not an apology with promises.",
  },
  "how-to": {
    briefTom: "digest",
    firstResponse: { kind: "business-days", days: 1 },
    stampPrivacyDeadline: false,
    draftReply: "template-or-draft",
    notes: "Routine how-to question; first response within 1 business day.",
  },
  "abuse/security": {
    briefTom: "same-day",
    firstResponse: { kind: "same-day" },
    stampPrivacyDeadline: false,
    draftReply: "template-or-draft",
    notes:
      "Abuse or security reports route to Tom the same day (safety). Same-day clock is the conservative choice; the spec pins routing only.",
  },
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export interface SupportMessageInput {
  subject: string;
  body: string;
  from?: string;
}

export interface SupportClassification {
  category: SupportTriageCategory;
  reasons: string[];
}

/**
 * Keyword sets, as data. Deliberately OVER-inclusive for privacy and
 * legal-shaped: a false positive costs a human a glance; a false negative can
 * cost a statutory deadline. (Same stance as supportLegalIntake.)
 */
const LEGAL_TERMS = [
  "attorney",
  "lawyer",
  "cease and desist",
  "demand letter",
  "subpoena",
  "court order",
  "regulator",
  "attorney general",
  "lawsuit",
  "litigation",
  "legal action",
  "dmca",
  "copyright infringement",
  "ada demand",
  "better business bureau",
] as const;

const PRIVACY_TERMS = [
  "dsar",
  "data subject",
  "delete my data",
  "deletion request",
  "erase my",
  "right to be forgotten",
  "access my data",
  "my personal data",
  "personal information request",
  "do not sell",
  "opt out of sale",
  "privacy request",
  "gdpr",
  "ccpa",
  "cpra",
] as const;

const ABUSE_TERMS = [
  "phishing",
  "impersonation",
  "scam",
  "fraudulent",
  "unauthorized access",
  "account compromised",
  "hacked",
  "security vulnerability",
  "data breach",
  "spam run",
  "abuse report",
] as const;

const BILLING_MONEY_TERMS = [
  "refund",
  "chargeback",
  "dispute",
  "disputed charge",
  "charged twice",
  "double charged",
  "unauthorized charge",
  "payment failed and charged",
  "money back",
] as const;

// Billing sense of "cancellation"; precedence keeps privacy/legal ahead.
const BILLING_QUESTION_TERMS = [
  "invoice",
  "billing",
  "charge",
  "payment method",
  "card on file",
  "receipt",
  "subscription price",
  "plan price",
  "upgrade",
  "downgrade",
  "cancel my subscription",
  "cancellation",
] as const;

const COMPLAINT_TERMS = [
  "unacceptable",
  "terrible",
  "worst",
  "angry",
  "frustrated",
  "complaint",
  "escalate",
  "manager",
  "review",
] as const;

const BUG_TERMS = [
  "bug",
  "error",
  "broken",
  "crash",
  "not working",
  "doesn't work",
  "does not work",
  "500",
  "blank page",
  "won't load",
  "will not load",
  "glitch",
] as const;

const HOW_TO_TERMS = ["how do i", "how to", "can i", "where is", "help me"] as const;

/**
 * Safety precedence, first match wins:
 * legal-shaped > privacy > abuse/security > billing-money > complaint >
 * billing-question > bug > how-to. Precedence is by CATEGORY, not by which
 * keyword appears first in the text.
 */
const PRECEDENCE: ReadonlyArray<{
  category: SupportTriageCategory;
  terms: readonly string[];
}> = [
  { category: "legal-shaped", terms: LEGAL_TERMS },
  { category: "privacy", terms: PRIVACY_TERMS },
  { category: "abuse/security", terms: ABUSE_TERMS },
  { category: "billing-money", terms: BILLING_MONEY_TERMS },
  { category: "complaint", terms: COMPLAINT_TERMS },
  { category: "billing-question", terms: BILLING_QUESTION_TERMS },
  { category: "bug", terms: BUG_TERMS },
  { category: "how-to", terms: HOW_TO_TERMS },
];

export function classifySupportMessage(input: SupportMessageInput): SupportClassification {
  const text = `${input.subject ?? ""}\n${input.body ?? ""}`.toLowerCase();

  const matched: Array<{ category: SupportTriageCategory; reasons: string[] }> = [];
  for (const { category, terms } of PRECEDENCE) {
    const hits = terms.filter((t) => text.includes(t));
    if (hits.length > 0) {
      matched.push({
        category,
        reasons: hits.map((t) => `matched ${category} term "${t}"`),
      });
    }
  }

  if (matched.length === 0) {
    return { category: "how-to", reasons: ["no signal matched; default"] };
  }

  const winner = matched[0];
  const reasons = [...winner.reasons];
  if (winner.category === "legal-shaped" || winner.category === "privacy") {
    const others = matched.slice(1).map((m) => m.category);
    if (others.length > 0) reasons.push(`also matched: ${others.join(", ")}`);
  }
  return { category: winner.category, reasons };
}

// ---------------------------------------------------------------------------
// Business-day + deadline math (all UTC)
// ---------------------------------------------------------------------------

/**
 * LIMITATION: business days are Mon–Fri in UTC. There is NO holiday calendar
 * and no per-customer timezone; a holiday counts as a business day.
 */
function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

/** Advance `days` business days (skipping Sat/Sun), preserving time of day. */
export function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start.getTime());
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isBusinessDay(result)) remaining -= 1;
  }
  return result;
}

export function firstResponseDeadline(
  category: SupportTriageCategory,
  arrival: Date | string,
): { deadlineAt: string; basis: string } {
  const arrivalDate = new Date(arrival);
  const clock = SUPPORT_CATEGORY_ROUTING[category].firstResponse;
  const tag = `${SUPPORT_CLOCKS_STATUS} clock`;

  switch (clock.kind) {
    case "same-day":
      return {
        deadlineAt: endOfUtcDay(arrivalDate).toISOString(),
        basis: `${tag}: acknowledgement draft the same day`,
      };
    case "same-business-day": {
      const day = new Date(arrivalDate.getTime());
      while (!isBusinessDay(day)) day.setUTCDate(day.getUTCDate() + 1);
      return {
        deadlineAt: endOfUtcDay(day).toISOString(),
        basis: `${tag}: first response within the same business day`,
      };
    }
    case "business-days":
      return {
        deadlineAt: endOfUtcDay(addBusinessDays(arrivalDate, clock.days)).toISOString(),
        basis: `${tag}: first response within ${clock.days} business day${clock.days === 1 ? "" : "s"}`,
      };
  }
}

/**
 * Breached iff no first response yet AND now > deadline; if a first response
 * exists, breached iff it landed after the deadline.
 */
export function isClockBreached(
  deadlineAt: string,
  firstResponseAt: string | null,
  now: Date | string,
): boolean {
  const deadlineMs = new Date(deadlineAt).getTime();
  if (firstResponseAt) return new Date(firstResponseAt).getTime() > deadlineMs;
  return new Date(now).getTime() > deadlineMs;
}

/** Privacy rows take their deadline from the shared DSAR clock — no duplicated math. */
export function privacyDeadline(arrival: Date | string): DsarDeadlineStamp {
  return stampDsarDeadline(arrival);
}

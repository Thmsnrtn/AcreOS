/**
 * First deal in 90 days (W5b) — the ONE next concrete step toward an org's
 * first closed deal, derived from its REAL records and nothing else.
 *
 *   no leads                         → import a list
 *   leads, nothing sent              → send your first outreach
 *   sent, no replies yet             → follow up with a second touch
 *   replies, no accepted offer       → answer the people who replied and make offers
 *   an accepted offer, not closed    → work the closing checklist for that deal
 *   a closed deal                    → done: the first deal is closed
 *
 * Every count is a count of rows (server/services/growth/firstDealProgram.ts
 * says which). Nothing is estimated, nothing is a benchmark, and no step is
 * shown as done that the records do not show done. Day N counts from the
 * org's creation; past day 90 the program says so instead of pretending the
 * clock stopped.
 *
 * Pure; browser-safe — Today renders it and Pax's mentor context reads the
 * same projection, so the two can never disagree.
 */

export const FIRST_DEAL_PROGRAM_DAYS = 90;

export type FirstDealStepId = "import" | "send" | "follow_up_unanswered" | "work_replies" | "close" | "done";

export interface FirstDealState {
  orgCreatedAt: Date;
  now: Date;
  leadCount: number;
  outreachSentCount: number;
  repliedLeadCount: number;
  acceptedDeal: null | {
    id: number;
    titleCompany: string | null;
    escrowNumber: string | null;
    closingDate: Date | null;
    documentCount: number;
    dueDiligenceDone: boolean | null;
  };
  closedDealCount: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface FirstDealStep {
  step: FirstDealStepId;
  /** 1..6, for "step 3 of 6". */
  ordinal: number;
  title: string;
  detail: string;
  cta: { label: string; href: string } | null;
  /** Only on "close": what the deal's own record shows is done. */
  checklist: ChecklistItem[] | null;
  day: number;
  withinProgram: boolean;
  evidence: { leads: number; outreachSent: number; repliedLeads: number; closedDeals: number };
}

const ORDER: FirstDealStepId[] = ["import", "send", "follow_up_unanswered", "work_replies", "close", "done"];

const plural = (n: number, w: string) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

export function closingChecklist(deal: NonNullable<FirstDealState["acceptedDeal"]>): ChecklistItem[] {
  return [
    { id: "title_company", label: "Title company chosen", done: Boolean(deal.titleCompany?.trim()) },
    { id: "escrow", label: "Escrow opened (escrow number recorded)", done: Boolean(deal.escrowNumber?.trim()) },
    { id: "due_diligence", label: "Due diligence checklist completed", done: deal.dueDiligenceDone === true },
    { id: "closing_date", label: "Closing date set", done: deal.closingDate != null },
    { id: "documents", label: "Signed purchase agreement uploaded to the deal", done: deal.documentCount > 0 },
  ];
}

export function nextFirstDealStep(s: FirstDealState): FirstDealStep {
  const day = Math.max(1, Math.floor((s.now.getTime() - s.orgCreatedAt.getTime()) / 86_400_000) + 1);
  const evidence = { leads: s.leadCount, outreachSent: s.outreachSentCount, repliedLeads: s.repliedLeadCount, closedDeals: s.closedDealCount };
  const base = { day, withinProgram: day <= FIRST_DEAL_PROGRAM_DAYS, evidence, checklist: null as ChecklistItem[] | null };
  const at = (step: FirstDealStepId) => ORDER.indexOf(step) + 1;

  if (s.closedDealCount > 0) {
    return {
      ...base,
      step: "done",
      ordinal: at("done"),
      title: "Your first deal is closed",
      detail: `${plural(s.closedDealCount, "closed deal")} on record. The program is complete.`,
      cta: { label: "See it in Finance", href: "/finance" },
    };
  }
  if (s.acceptedDeal) {
    const checklist = closingChecklist(s.acceptedDeal);
    const open = checklist.filter((c) => !c.done).length;
    return {
      ...base,
      step: "close",
      ordinal: at("close"),
      title: "Close the accepted offer",
      detail: open === 0
        ? "Every item on this deal's checklist is recorded. Mark the deal closed when the money and deed have moved."
        : `${plural(open, "item")} on the closing checklist ${open === 1 ? "isn't" : "aren't"} recorded on the deal yet.`,
      cta: { label: "Open the deal", href: `/deals/${s.acceptedDeal.id}` },
      checklist,
    };
  }
  if (s.repliedLeadCount > 0) {
    return {
      ...base,
      step: "work_replies",
      ordinal: at("work_replies"),
      title: "Answer the owners who replied",
      detail: `${plural(s.repliedLeadCount, "owner")} replied or moved forward. Answer them and make an offer with its basis.`,
      cta: { label: "Open the Inbox", href: "/inbox" },
    };
  }
  if (s.outreachSentCount > 0) {
    return {
      ...base,
      step: "follow_up_unanswered",
      ordinal: at("follow_up_unanswered"),
      title: "Follow up with a second touch",
      detail: `${plural(s.outreachSentCount, "piece")} of outreach went out and no one has replied yet. A second touch to the same owners is the next step.`,
      cta: { label: "Plan a follow-up", href: "/campaigns" },
    };
  }
  if (s.leadCount > 0) {
    return {
      ...base,
      step: "send",
      ordinal: at("send"),
      title: "Send your first outreach",
      detail: `You have ${plural(s.leadCount, "owner")} on your list and nothing has been sent yet.`,
      cta: { label: "Write your first mailer", href: "/outreach/mail" },
    };
  }
  return {
    ...base,
    step: "import",
    ordinal: at("import"),
    title: "Bring in your first list",
    detail: "There are no owners on your list yet. Import a county list or a spreadsheet from another tool.",
    cta: { label: "Import a list", href: "/leads?import=1" },
  };
}

export const FIRST_DEAL_STEP_COUNT = ORDER.length;

/** The mentor brief Pax gets — the same projection Today shows, in prose. */
export function firstDealMentorBrief(step: FirstDealStep): string {
  const lines = [
    `FIRST-DEAL MENTOR CONTEXT (from this organization's own records; do not invent numbers):`,
    `- Day ${step.day} since the account opened${step.withinProgram ? ` (of the ${FIRST_DEAL_PROGRAM_DAYS}-day first-deal program)` : ` (past the ${FIRST_DEAL_PROGRAM_DAYS}-day program window)`}.`,
    `- Records: ${step.evidence.leads} leads, ${step.evidence.outreachSent} outreach pieces sent, ${step.evidence.repliedLeads} owners replied or moved forward, ${step.evidence.closedDeals} closed deals.`,
    `- Next step (step ${step.ordinal} of ${FIRST_DEAL_STEP_COUNT}): ${step.title}. ${step.detail}`,
  ];
  if (step.checklist) {
    lines.push(`- Closing checklist: ${step.checklist.map((c) => `${c.label} — ${c.done ? "recorded" : "not recorded"}`).join("; ")}.`);
  }
  lines.push(
    `When the user asks what to do next, how to get their first deal, or seems stuck, coach them toward THIS step as a mentor: one concrete action, why it matters, and how to do it in AcreOS. Never claim a step is done that the records above do not show, and never quote response rates or timelines as facts.`,
  );
  return lines.join("\n");
}

/**
 * HYB-DEF-5 / HYB-DEF-6 — Pax cross-book truthfulness.
 *
 * The hybrid journey walk (hidden_files/journey-walk-hybrid-2026-11.md)
 * proved two Pax defects live on staging:
 *
 *  DEF-5 — Pax answered a whole-portfolio question from
 *  `get_system_context` + `get_notes`, both of which read the SERVICED
 *  book only. The acquired note ($17,850, past due) was silently
 *  absent, no coverage statement said the slice was partial, and Pax
 *  asserted "0 closed land deals" against three closed deals because
 *  the context counted only open pipeline.
 *
 *  DEF-6 — Asked to email a borrower, Pax said the borrower's email
 *  "isn't stored" (it was — on the borrower's linked lead, which Pax
 *  never consulted) and promised "I'll send the reminder immediately —
 *  no further confirmation needed after that", contradicting the
 *  ratified FD5 ask-before-sending rail in words.
 *
 * These tests pin the cures at the pure-function level (this
 * environment has no database): the coverage statement names both
 * books, the acquired shaping/summary is exact, the formatted context
 * states closed deals as a fact of record, borrower contact resolves
 * through the linked lead before any fallback, the FD5 block rides in
 * every composed prompt, and the guard's send-claim detector flags
 * the walk's exact sentence while passing truthful rail statements.
 */
import { describe, expect, it } from "vitest";
import {
  buildNotesCoverageStatement,
  borrowerContactFromLead,
  borrowerContactForAcquiredNote,
  shapeAcquiredNoteForPax,
  summarizeAcquiredBook,
  type AcquiredNotePaxRow,
} from "../../server/services/notes/acquiredBookRead";
import { formatContextForAI, type SystemContext } from "../../server/services/aiContextAggregator";
import { findUnapprovedSendClaims } from "../../server/ai/paxSourceExtraction";
import { composePaxSystemPrompt } from "../../server/ai/paxPromptVersions";
import { toolDefinitions } from "../../server/ai/tools";

// The walk's acquired note: HYB-NOTE-001, $17,850, early_delinquent,
// borrower = lead 118 (HYB Buyer One, hyb-20261120-buyer-a@example.test).
const WALK_ACQUIRED_ROW: AcquiredNotePaxRow = {
  id: "9b1c0000-0000-4000-8000-000000000001",
  noteNumber: "HYB-NOTE-001",
  borrowerId: 118,
  payerName: "HYB Buyer One",
  payerPhone: null,
  status: "performing",
  delinquencyStatus: "early_delinquent",
  daysDelinquent: 32,
  originalPrincipalCents: 2000000,
  currentBalanceCents: 1785000,
  paymentAmountCents: 21500,
  interestRateBps: 900,
  nextPaymentDate: "2026-10-19",
  acquisitionDate: "2026-11-01",
};

const WALK_LEAD = {
  id: 118,
  firstName: "HYB",
  lastName: "Buyer One",
  email: "hyb-20261120-buyer-a@example.test",
  phone: "555-0118",
};

describe("buildNotesCoverageStatement (RW-D coverage)", () => {
  it("names BOTH books with their counts — a partial slice can no longer pose as the whole", () => {
    const s = buildNotesCoverageStatement(2, 1);
    expect(s).toContain("BOTH note books");
    expect(s).toContain("serviced book");
    expect(s).toContain("2");
    expect(s).toContain("acquired book");
    expect(s).toContain("1");
    expect(s).toContain("never merged into one unlabelled total");
  });

  it("states an empty book as empty instead of omitting it", () => {
    expect(buildNotesCoverageStatement(3, 0)).toContain("The acquired book is empty in this account.");
    expect(buildNotesCoverageStatement(0, 2)).toContain("The serviced book is empty in this account.");
  });
});

describe("acquired book shaping + summary", () => {
  it("shapes the walk's acquired note with its book tag, dollars and delinquency — the note Pax never saw", () => {
    const shaped = shapeAcquiredNoteForPax(
      WALK_ACQUIRED_ROW,
      borrowerContactForAcquiredNote(WALK_ACQUIRED_ROW, WALK_LEAD),
    );
    expect(shaped.book).toBe("acquired");
    expect(shaped.noteNumber).toBe("HYB-NOTE-001");
    expect(shaped.currentBalance).toBe(17850);
    expect(shaped.monthlyPayment).toBe(215);
    expect(shaped.interestRate).toBe(9);
    expect(shaped.delinquencyStatus).toBe("early_delinquent");
    expect(shaped.daysDelinquent).toBe(32);
  });

  it("summary counts only live notes in balances and flags delinquency", () => {
    const paidOff: AcquiredNotePaxRow = {
      ...WALK_ACQUIRED_ROW,
      id: "9b1c0000-0000-4000-8000-000000000002",
      noteNumber: "HYB-NOTE-002",
      status: "paid_off",
      delinquencyStatus: "current",
      daysDelinquent: 0,
      currentBalanceCents: 0,
    };
    const s = summarizeAcquiredBook([WALK_ACQUIRED_ROW, paidOff]);
    expect(s.count).toBe(2);
    expect(s.liveCount).toBe(1);
    expect(s.totalBalance).toBe(17850);
    expect(s.delinquentCount).toBe(1);
  });
});

describe("borrower contact resolves through the linked lead (HYB-DEF-6)", () => {
  it("returns the email that is on the borrower's lead — the one Pax declared 'isn't stored'", () => {
    const c = borrowerContactFromLead(WALK_LEAD);
    expect(c.source).toBe("linked_lead");
    expect(c.leadId).toBe(118);
    expect(c.email).toBe("hyb-20261120-buyer-a@example.test");
    expect(c.phone).toBe("555-0118");
  });

  it("an absent lead is stated as absent — nulls, never invented values", () => {
    const c = borrowerContactFromLead(undefined);
    expect(c).toEqual({ leadId: null, name: null, email: null, phone: null, source: "none" });
  });

  it("acquired-note contact prefers the linked lead; the payer snapshot is a labelled fallback", () => {
    const withLead = borrowerContactForAcquiredNote(WALK_ACQUIRED_ROW, WALK_LEAD);
    expect(withLead.source).toBe("linked_lead");
    expect(withLead.email).toBe("hyb-20261120-buyer-a@example.test");

    const snapshotRow = { ...WALK_ACQUIRED_ROW, payerPhone: "555-9999" };
    const fallback = borrowerContactForAcquiredNote(snapshotRow, undefined);
    expect(fallback.source).toBe("note_record");
    expect(fallback.name).toBe("HYB Buyer One");
    expect(fallback.phone).toBe("555-9999");
    expect(fallback.email).toBeNull(); // the snapshot carries no email — stated as null, not guessed
  });
});

function syntheticContext(closedDeals: number): SystemContext {
  const byStatus: Record<string, number> = closedDeals > 0 ? { closed: closedDeals, negotiating: 1 } : { negotiating: 1 };
  return {
    timestamp: "2026-11-20T00:00:00.000Z",
    organizationId: 126,
    organizationName: "HYB Org",
    modules: {
      leads: { name: "Leads (CRM)", totalCount: 2, recentCount: 0, keyStats: { byStatus: {}, sellers: 1, buyers: 1 }, recentItems: [] },
      properties: { name: "Property Inventory", totalCount: 2, recentCount: 0, keyStats: { byStatus: {}, totalAcres: 10, owned: 1, listed: 0 }, recentItems: [] },
      deals: {
        name: "Deal Pipeline",
        totalCount: closedDeals + 1,
        recentCount: 0,
        keyStats: { byStatus, closed: closedDeals, acquisitions: 1, dispositions: 1, totalPipelineValue: 5000 },
        recentItems: [],
      },
      notes: {
        name: "Notes (serviced + acquired books)",
        totalCount: 3,
        recentCount: 0,
        keyStats: {
          coverage: buildNotesCoverageStatement(2, 1),
          serviced: { count: 2, active: 2, totalPrincipal: 90000, currentBalance: 52833.28 },
          acquired: { count: 1, live: 1, totalBalance: 17850, monthlyPayments: 215, delinquent: 1 },
          active: 2,
          totalPrincipal: 90000,
          currentBalance: 52833.28,
        },
        recentItems: [],
      },
      tasks: { name: "Tasks", totalCount: 0, recentCount: 0, keyStats: { pending: 0, overdue: 0, completed: 0 }, recentItems: [] },
      campaigns: { name: "Marketing Campaigns", totalCount: 0, recentCount: 0, keyStats: { active: 0, draft: 0, completed: 0 }, recentItems: [] },
      finance: {
        monthlyCashflow: 687.1,
        activeNotesCount: 2,
        totalOutstanding: 52833.28,
        acquiredLiveNotesCount: 1,
        acquiredMonthlyCashflow: 215,
        acquiredTotalOutstanding: 17850,
        upcomingPayments: 0,
      },
    },
    alerts: { lowCreditBalance: false, overduePayments: 0, pendingTasks: 0, newLeads: 0 },
    quickActions: [],
  };
}

describe("formatContextForAI — the formatted context the walk's Pax read", () => {
  it("states closed deals as a fact of record, distinct from open pipeline", () => {
    const out = formatContextForAI(syntheticContext(3));
    expect(out).toContain("Closed: 3 deals closed");
    expect(out).toContain("closed: 3");
  });

  it("prints the notes coverage statement and both books, labelled, with the acquired balance present", () => {
    const out = formatContextForAI(syntheticContext(3));
    expect(out).toContain("BOTH note books");
    expect(out).toContain("Serviced book (originated, seller-financed): 2 notes");
    expect(out).toContain("Acquired book (bought notes): 1 notes");
    expect(out).toContain("17,850"); // the acquired balance the walk's answer omitted entirely
    expect(out).toContain("Outstanding balance (acquired book): $17,850");
  });
});

describe("FD5 — Pax's words must match the ask-before-sending rail", () => {
  it("the send-approval block rides in EVERY composed prompt (v2 and v3)", () => {
    for (const v of ["v2", "v3"] as const) {
      const prompt = composePaxSystemPrompt("BASE_SENTINEL", v);
      expect(prompt).toContain("SENDING (mandatory — FD5, never violate)");
      expect(prompt).toContain("you draft it, the operator approves it, then it sends");
      expect(prompt).toContain("no further confirmation");
    }
  });

  it("the send tool descriptions state the draft → approval → send flow", () => {
    for (const name of ["send_email", "send_sms"] as const) {
      const d = toolDefinitions[name].description;
      expect(d).toContain("NEVER sends on your word alone");
      expect(d).toContain("no further confirmation");
    }
    expect(toolDefinitions.get_notes.description).toContain("BOTH note books");
    expect(toolDefinitions.get_notes.description).toContain("coverage statement");
  });

  it("NEGATIVE CONTROL: the guard flags the walk's exact sentence", () => {
    const walkSentence =
      "The borrower's email isn't stored. Once I have it, I'll send the reminder immediately — no further confirmation needed after that.";
    const claims = findUnapprovedSendClaims(walkSentence);
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims.join(" ")).toMatch(/no further confirmation/i);
  });

  it("the guard also flags the sibling phrasings of the same promise", () => {
    expect(findUnapprovedSendClaims("I'll send it without further confirmation.").length).toBeGreaterThan(0);
    expect(findUnapprovedSendClaims("No approval is needed — I'll take care of it.").length).toBeGreaterThan(0);
    expect(findUnapprovedSendClaims("I'll send that over without asking.").length).toBeGreaterThan(0);
  });

  it("truthful statements of the rail do NOT trip the guard", () => {
    expect(findUnapprovedSendClaims("I'll draft it for your approval — once you approve, it sends.")).toEqual([]);
    expect(findUnapprovedSendClaims("Nothing sends without your approval; the draft waits for your one-tap OK.")).toEqual([]);
    expect(findUnapprovedSendClaims("I can't send that myself — it needs your approval first, then it goes out.")).toEqual([]);
  });
});

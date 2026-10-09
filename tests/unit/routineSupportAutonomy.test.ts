/**
 * Routine support is answered without a per-ticket tap; everything else goes
 * to the founder as one ask (founder decision 2026-10-09).
 *
 * 1. triageTicket — fails closed: routine needs a positive how-to / account /
 *    small-refund signal AND no risk signal (legal, deletion, money over $50,
 *    anger, a bug, too little text, an exception).
 * 2. judgeDraft — a refund is released only on a refund ticket and within the
 *    ceiling; only support-worker replies and refunds are judged at all.
 * 3. the sweep — releases routine drafts through the founder-tap path, holds
 *    the rest, opens ONE ask per held ticket, logs both to the Story, releases
 *    nothing on a failed read or a panic stop.
 * 4. wiring — the auto-witness sweep (the scheduled job) runs the policy with
 *    zero grants issued, and never grant-releases a draft the policy held.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { triageTicket, judgeDraft, ROUTINE_SUPPORT_APPROVER } from "../../server/services/support/routineSupportPolicy";

const H = vi.hoisted(() => ({
  pending: [] as any[],
  tickets: new Map<number, any>(),
  messages: new Map<number, any[]>(),
  approvals: [] as any[],
  asks: [] as any[],
  priorAsks: [] as string[],
  stories: [] as any[],
  panic: false,
  readFails: false,
  grants: [] as any[],
  currentTicket: 0,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/autopilot/settings", () => ({ isPanicStopped: () => H.panic }));
vi.mock("../../server/services/autopilot/pendingHands", () => ({
  listPendingHands: async () => H.pending.filter((p) => p.status === "pending"),
  approvePendingHand: async (input: any) => {
    H.approvals.push(input);
    const p = H.pending.find((x) => x.id === input.id);
    if (p) p.status = "executed";
    return { outcome: "executed", result: { success: true } };
  },
}));
vi.mock("../../server/services/autopilot/hands", () => ({
  getHand: (name: string) => ({ reply_support_ticket: { domain: "support" }, apply_refund: { domain: "finance", movesMoney: true }, send_email: { domain: "support" } } as any)[name],
}));
vi.mock("../../server/services/autopilot/delegationRules", () => ({
  delegationBlockedByControls: async () => null,
  delegatedHandRefusal: async () => null,
}));
vi.mock("../../server/services/solene/founderCollab", () => ({
  askFounder: async (a: any) => {
    H.asks.push(a);
    return { askId: 900 + H.asks.length, deduped: false };
  },
}));
vi.mock("../../server/services/autopilot/experienceLog", () => ({
  recordExperience: async (e: any) => {
    H.stories.push(e);
    return H.stories.length;
  },
}));
vi.mock("../../server/services/autopilot/witnessGrantStore", () => ({
  liveGrantsFor: async () => H.grants,
  toPolicyGrant: (g: any) => g,
  consumeGrantUse: async () => true,
}));
// The platform-ops db: supportTickets / supportTicketMessages / soleneFounderAsks by table identity.
vi.mock("../../server/utils/orgScopedDb", async () => {
  const schema = await import("@shared/schema");
  const chain = (rows: () => any[]) => {
    const c: any = { where: () => c, orderBy: () => c, limit: () => c, then: (ok: any, bad: any) => Promise.resolve().then(() => rows()).then(ok, bad) };
    return c;
  };
  return {
    unscopedForPlatformOps: () => ({
      select: () => ({
        from: (t: any) => {
          if (H.readFails) throw new Error("db down");
          if (t === schema.supportTickets) return chain(() => [H.tickets.get(H.currentTicket)].filter(Boolean));
          if (t === schema.supportTicketMessages) return chain(() => H.messages.get(H.currentTicket) ?? []);
          if (t === schema.soleneFounderAsks) return chain(() => (H.priorAsks.includes(String(H.currentTicket)) ? [{ id: 1 }] : []));
          return chain(() => []);
        },
      }),
    }),
  };
});

// Each pending draft is evaluated against "its" ticket: the mock db answers
// with the ticket named by the draft being judged (one draft per test).

function draft(id: number, handName: string, ticketId: number, extra: Record<string, unknown> = {}, sourceRole = "support") {
  H.currentTicket = ticketId;
  const args = handName === "apply_refund"
    ? { charge_id: "pi_1", amount_cents: 2000, reason: `ticket #${ticketId}: refund`, organization_id: 7, ...extra }
    : { ticket_id: ticketId, organization_id: 7, message: "Here is how.", resolve: true, ...extra };
  H.pending.push({ id, handName, sourceRole, args, status: "pending" });
}
function ticket(id: number, subject: string, description: string, followUps: string[] = []) {
  H.tickets.set(id, { id, organizationId: 7, subject, description });
  H.messages.set(id, followUps.map((content) => ({ role: "user", content })));
}

beforeEach(() => {
  H.pending = [];
  H.tickets.clear();
  H.messages.clear();
  H.approvals = [];
  H.asks = [];
  H.priorAsks = [];
  H.stories = [];
  H.panic = false;
  H.readFails = false;
  H.grants = [];
});

describe("triageTicket fails closed", () => {
  it.each([
    ["How do I import a CSV of leads?", "I have a spreadsheet from my county list and want to bring it in.", "how_to"],
    ["Change my login email", "I need to change the email address on my account settings please.", "account"],
    ["Refund for mail credits", "I bought the $20 mail pack by mistake, can I get a refund?", "small_refund"],
    ["Cancel", "Please cancel my subscription at the end of the month, thanks.", "account"],
  ])("routine: %s", (subject, description, kind) => {
    const t = triageTicket({ subject, description });
    expect(t).toEqual(expect.objectContaining({ verdict: "routine", kind }));
  });

  it.each([
    ["Lawyer letter", "My attorney says your texts broke the TCPA. Refund my $20.", "legal"],
    ["Delete everything", "Please delete my data under the CCPA, all of it.", "data_deletion"],
    ["Refund", "Refund the $79 I paid for Scale this month please, how do I do that?", "money_over_ceiling"],
    ["This is a scam", "How do I get a refund, you people are a scam.", "angry"],
    ["Refund", "I want a refund!! How do I cancel this??", "angry"],
    ["REFUND NOW", "GIVE ME BACK MY MONEY RIGHT NOW PLEASE THANKS", "angry"],
    ["Import broken", "How do I import? The import page shows an error and nothing happened.", "bug"],
    ["hi", "help", "unclear"],
    ["Question about land", "I wonder about the weather in Tennessee next spring for my parcels.", "unclear"],
  ])("founder: %s → %s", (subject, description, reason) => {
    expect(triageTicket({ subject, description })).toEqual(expect.objectContaining({ verdict: "founder", reason }));
  });

  it("a follow-up message counts: a routine ticket that turns angry is the founder's", () => {
    expect(triageTicket({ subject: "How do I add a seat?", description: "How do I add a teammate to my plan?", customerMessages: ["This is ridiculous, still no answer."] }))
      .toEqual(expect.objectContaining({ verdict: "founder", reason: "angry" }));
  });

  it("an exception inside the classifier is 'unreadable', never routine", () => {
    const evil = { toString() { throw new Error("boom"); } } as unknown as string;
    expect(triageTicket({ subject: evil, description: "How do I import leads into my account?" })).toEqual(expect.objectContaining({ verdict: "founder", reason: "unreadable" }));
  });
});

describe("judgeDraft", () => {
  const routine = { subject: "How do I import leads?", description: "Where do I upload my CSV spreadsheet of owners?" };
  const refundTicket = { subject: "Refund", description: "Please refund the $20 mail pack I bought by mistake." };

  it("releases a support reply on a routine ticket", () => {
    expect(judgeDraft({ handName: "reply_support_ticket", sourceRole: "support", args: {} }, routine).release).toBe(true);
  });
  it("holds a refund drafted on a ticket that does not ask for one", () => {
    const v = judgeDraft({ handName: "apply_refund", sourceRole: "support", args: { amount_cents: 2000 } }, routine);
    expect(v).toEqual(expect.objectContaining({ release: false, escalate: true }));
  });
  it("holds a refund over the ceiling or without a provable amount, even on a refund ticket", () => {
    expect(judgeDraft({ handName: "apply_refund", sourceRole: "support", args: { amount_cents: 5001 } }, refundTicket).release).toBe(false);
    expect(judgeDraft({ handName: "apply_refund", sourceRole: "support", args: {} }, refundTicket).release).toBe(false);
    expect(judgeDraft({ handName: "apply_refund", sourceRole: "support", args: { amount_cents: 2000 } }, refundTicket).release).toBe(true);
  });
  it("holds when the ticket could not be read", () => {
    expect(judgeDraft({ handName: "reply_support_ticket", sourceRole: "support", args: {} }, null)).toEqual(expect.objectContaining({ release: false, escalate: true }));
  });
  it("judges only support-worker replies and refunds", () => {
    expect(judgeDraft({ handName: "send_email", sourceRole: "retention", args: {} }, routine)).toEqual(expect.objectContaining({ release: false, escalate: false }));
    expect(judgeDraft({ handName: "reply_support_ticket", sourceRole: null, args: {} }, routine)).toEqual(expect.objectContaining({ release: false, escalate: false }));
  });
});

describe("the sweep", () => {
  it("releases a routine reply through the founder-tap path, attributed to the decision, and logs it to the Story", async () => {
    ticket(11, "How do I import leads?", "Where do I upload my CSV spreadsheet of owners?");
    draft(1, "reply_support_ticket", 11);
    const { runRoutineSupportSweep } = await import("../../server/services/support/routineSupportSweep");
    const r = await runRoutineSupportSweep();
    expect(r.released).toBe(1);
    expect(H.approvals).toEqual([expect.objectContaining({ id: 1, approvedBy: ROUTINE_SUPPORT_APPROVER, delegation: expect.anything() })]);
    expect(H.stories).toEqual([expect.objectContaining({ moveKind: "support_auto_answer", outcome: "acted", reasoningTrace: expect.objectContaining({ ticketId: 11, kind: "how_to" }) })]);
    expect(H.asks).toHaveLength(0);
  });

  it("releases a routine refund ≤ $50 and logs it", async () => {
    ticket(12, "Refund", "Please refund the $20 mail pack I bought by mistake.");
    draft(2, "apply_refund", 12);
    const { runRoutineSupportSweep } = await import("../../server/services/support/routineSupportSweep");
    expect((await runRoutineSupportSweep()).released).toBe(1);
    expect(H.stories[0]).toEqual(expect.objectContaining({ moveKind: "support_auto_refund", reasoningTrace: expect.objectContaining({ amountCents: 2000 }) }));
  });

  it("holds an angry ticket's draft, asks the founder once, and logs the hold", async () => {
    ticket(13, "Refund", "This is unacceptable. How do I get my $20 back?");
    draft(3, "reply_support_ticket", 13);
    const { runRoutineSupportSweep } = await import("../../server/services/support/routineSupportSweep");
    const r = await runRoutineSupportSweep();
    expect(r.released).toBe(0);
    expect(r.heldForFounder.has(3)).toBe(true);
    expect(H.approvals).toHaveLength(0);
    expect(H.asks).toEqual([expect.objectContaining({ questionSummary: expect.stringMatching(/^Support ticket #13 needs you/) })]);
    expect(H.stories).toEqual([expect.objectContaining({ moveKind: "support_held", outcome: "escalated" })]);
    // a second sweep over the same held draft does not ask again
    H.priorAsks.push("13");
    await runRoutineSupportSweep();
    expect(H.asks).toHaveLength(1);
  });

  it("releases nothing when the ticket cannot be read, or when the panic stop is engaged", async () => {
    ticket(14, "How do I import leads?", "Where do I upload my CSV spreadsheet of owners?");
    draft(4, "reply_support_ticket", 14);
    const { runRoutineSupportSweep } = await import("../../server/services/support/routineSupportSweep");
    H.readFails = true;
    expect((await runRoutineSupportSweep()).released).toBe(0);
    H.readFails = false;
    H.panic = true;
    expect((await runRoutineSupportSweep()).released).toBe(0);
    expect(H.approvals).toHaveLength(0);
  });
});

describe("wiring: the scheduled auto-witness sweep", () => {
  it("runs the policy with zero grants issued", async () => {
    ticket(21, "How do I import leads?", "Where do I upload my CSV spreadsheet of owners?");
    draft(5, "reply_support_ticket", 21);
    const { runAutoWitnessSweep } = await import("../../server/services/autopilot/autoWitness");
    const r = await runAutoWitnessSweep();
    expect(r.witnessed).toBe(1);
    expect(H.approvals.map((a) => a.approvedBy)).toEqual([ROUTINE_SUPPORT_APPROVER]);
  });

  it("a live grant does not release a draft the policy held for the founder", async () => {
    ticket(22, "Lawyer", "My attorney will contact you about these texts. How do I export my data?");
    draft(6, "reply_support_ticket", 22);
    H.grants = [{ id: 1, grantorId: "founder", granteeId: "solene", usedCount: 0, revoked: false, issuedAt: new Date(0).toISOString(), bounds: { domains: ["support"], hands: ["reply_support_ticket"], sourceRoles: ["support"], maxCostUsd: 1, maxActions: 100, expiresAt: new Date(Date.now() + 864e5).toISOString() } }];
    const { runAutoWitnessSweep } = await import("../../server/services/autopilot/autoWitness");
    const r = await runAutoWitnessSweep();
    expect(r.witnessed).toBe(0);
    expect(H.approvals).toHaveLength(0);
  });
});

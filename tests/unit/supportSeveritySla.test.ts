/**
 * supportSeveritySla.test.ts — O5: severity-class SLAs into the founder queue.
 *
 * Handoff doctrine (P5 §4): support items CLASSIFY at creation —
 *   P0 broken-money/send  → page (alertSpine, critical)
 *   P1 blocked-workflow   → same-day (24h)
 *   P2 question           → 48h
 * — and land in the founder queue with the SLA clock visible.
 *
 * Pins:
 *  1. The pure classifier (category/content → class, refuse-not-fabricate:
 *     no signal ⇒ the conservative P2 floor).
 *  2. Per-class targets + the deadline arithmetic (clock starts at ticket
 *     CREATION).
 *  3. computeSla driven by class targets (an unanswered P1 past target flips
 *     firstReplyBreached — the flat 2h/24h DEFAULT_SLA no longer decides).
 *  4. pageSupportP0Ticket → exactly one critical raiseAlert through the
 *     established alertSpine path; best-effort (a throwing spine returns
 *     false, never throws into the ticket path).
 *  5. decisionsInboxService.createFromEscalation stamps severityClass +
 *     slaDeadline into contextBundle.supportSla (no migration) and rides the
 *     right riskLevel/arbiter class: P0 → critical/B, P1 → high/B, P2
 *     non-billing → medium/C (the historical billing→high/B mapping is
 *     preserved).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks for the decisionsInbox import graph (mirrors decisionsInboxArbiter.test.ts) ───

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ARBITER_CALLS: Array<{ interruptClass: string }> = [];
vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => {
    ARBITER_CALLS.push({ interruptClass: req.interruptClass });
    return {
      outcome: "deliver",
      interruptClass: req.interruptClass,
      reason: "within budget",
      quietHoursActive: false,
      budget: { used: 0, limit: 5 },
      deferUntil: null,
    };
  }),
  recordDeferredInterrupt: vi.fn(async () => null),
}));

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));

vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: {
    attemptResolution: vi.fn(async () => ({
      autoResolved: false,
      geniusResponse: null,
      geniusConfidence: 0,
    })),
  },
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

// alertSpine — the paging transport pageSupportP0Ticket must route through.
const RAISED: Array<Record<string, any>> = [];
let spineThrows = false;
vi.mock("../../server/services/alertSpine", () => ({
  raiseAlert: vi.fn(async (input: Record<string, any>) => {
    if (spineThrows) throw new Error("spine down");
    RAISED.push(input);
    return { paged: true, findingRecorded: true, systemAlertWritten: true };
  }),
}));

// DB mock — records inserts; findFirst per table.
const INSERTED: Array<Record<string, any>> = [];
let nextId = 1;
const FIND_FIRST: Record<string, any> = {};
function findFirstFor(table: string) {
  return vi.fn(async () => FIND_FIRST[table] ?? null);
}
vi.mock("../../server/db", () => {
  const db = {
    query: {
      supportTickets: { findFirst: findFirstFor("supportTickets") },
      systemAlerts: { findFirst: findFirstFor("systemAlerts") },
      featureRequests: { findFirst: findFirstFor("featureRequests") },
      organizations: { findFirst: findFirstFor("organizations") },
      decisionsInboxItems: { findFirst: findFirstFor("decisionsInboxItems") },
    },
    insert: (_t: any) => ({
      values: (row: Record<string, any>) => ({
        returning: () => {
          const withId = { id: nextId++, ...row };
          INSERTED.push(withId);
          return Promise.resolve([withId]);
        },
      }),
    }),
    update: (_t: any) => ({
      set: (_v: any) => ({ where: (_w: any) => Promise.resolve() }),
    }),
  };
  return { db };
});

import {
  classifySupportSeverity,
  slaTargetsFor,
  slaDeadlineFor,
  computeSla,
  pageSupportP0Ticket,
  SLA_BY_SEVERITY,
  DEFAULT_SLA,
} from "../../server/services/autopilot/measurementLoops";
import { decisionsInboxService } from "../../server/services/decisionsInbox";

const T0 = new Date("2026-08-01T00:00:00Z");
const at = (mins: number) => new Date(T0.getTime() + mins * 60000);

beforeEach(() => {
  ARBITER_CALLS.length = 0;
  RAISED.length = 0;
  INSERTED.length = 0;
  nextId = 1;
  spineThrows = false;
  for (const k of Object.keys(FIND_FIRST)) delete FIND_FIRST[k];
});

// ─── 1. Classifier ──────────────────────────────────────────────────────────

describe("classifySupportSeverity — P5 §4 classes from category/content", () => {
  it("broken money → P0", () => {
    const c = classifySupportSeverity({
      category: "billing",
      priority: "normal",
      subject: "Payment failed",
      description: "My card was charged twice and the second charge failed.",
    });
    expect(c.severityClass).toBe("P0");
    expect(c.reason).toContain("broken-money");
  });

  it("broken send rail → P0", () => {
    const c = classifySupportSeverity({
      category: "general",
      priority: "normal",
      subject: "Emails not sending",
      description: "My offer campaign is stuck — nothing is going out.",
    });
    expect(c.severityClass).toBe("P0");
    expect(c.reason).toContain("broken-send");
  });

  it("urgent billing ticket → P0 even without broken text", () => {
    const c = classifySupportSeverity({
      category: "billing",
      priority: "urgent",
      subject: "Need my invoice today",
      description: "Please advise on my invoice.",
    });
    expect(c.severityClass).toBe("P0");
  });

  it("blocked workflow (no money/send context) → P1", () => {
    const c = classifySupportSeverity({
      category: "general",
      priority: "normal",
      subject: "Deals page crashes",
      description: "I am stuck — the deals page crashes when I open a deal.",
    });
    expect(c.severityClass).toBe("P1");
    expect(c.reason).toContain("blocked-workflow");
  });

  it("bug/technical category → at least P1", () => {
    expect(
      classifySupportSeverity({
        category: "bug",
        priority: "medium",
        subject: "[BUG] Table misaligned",
        description: "Rows overlap on mobile.",
      }).severityClass,
    ).toBe("P1");
  });

  it("a plain question → P2 (refuse-not-fabricate: no signal, conservative floor)", () => {
    const c = classifySupportSeverity({
      category: "general",
      priority: "normal",
      subject: "How do I export my leads?",
      description: "Looking for the CSV export button.",
    });
    expect(c.severityClass).toBe("P2");
  });

  it("a billing QUESTION stays P2 — money context alone is not broken money", () => {
    expect(
      classifySupportSeverity({
        category: "billing",
        priority: "normal",
        subject: "Refund question",
        description: "How does the refund policy apply to annual plans?",
      }).severityClass,
    ).toBe("P2");
  });
});

// ─── 2. Targets + deadline arithmetic ───────────────────────────────────────

describe("per-class targets + the visible deadline", () => {
  it("P0 tightens both targets; P1 is the same-day lane (the old flat default); P2 keeps the reply floor with a 48h window", () => {
    expect(SLA_BY_SEVERITY.P0).toEqual({ firstReplyMinutes: 30, resolutionMinutes: 4 * 60 });
    expect(SLA_BY_SEVERITY.P1).toEqual(DEFAULT_SLA);
    expect(SLA_BY_SEVERITY.P2).toEqual({
      firstReplyMinutes: DEFAULT_SLA.firstReplyMinutes,
      resolutionMinutes: 48 * 60,
    });
    expect(slaTargetsFor("P0")).toBe(SLA_BY_SEVERITY.P0);
  });

  it("the deadline counts from ticket CREATION: P0 +4h, P1 +24h, P2 +48h", () => {
    expect(slaDeadlineFor("P0", T0)).toEqual(at(4 * 60));
    expect(slaDeadlineFor("P1", T0)).toEqual(at(24 * 60));
    expect(slaDeadlineFor("P2", T0)).toEqual(at(48 * 60));
  });
});

// ─── 3. computeSla under class targets ──────────────────────────────────────

describe("computeSla driven by class targets", () => {
  it("an unanswered P1 past its first-reply target flips firstReplyBreached", () => {
    const m = computeSla(
      { createdAt: T0, firstReplyAt: null, resolvedAt: null, now: at(SLA_BY_SEVERITY.P1.firstReplyMinutes + 5) },
      slaTargetsFor("P1"),
    );
    expect(m.firstReplyBreached).toBe(true);
  });

  it("a P2 unanswered at 3h has NOT breached resolution (48h window) but HAS breached the 2h reply floor", () => {
    const m = computeSla(
      { createdAt: T0, firstReplyAt: null, resolvedAt: null, now: at(180) },
      slaTargetsFor("P2"),
    );
    expect(m.firstReplyBreached).toBe(true);
    expect(m.resolutionBreached).toBe(false);
  });

  it("a P0 answered at 45m already breached its 30m first-touch target", () => {
    const m = computeSla(
      { createdAt: T0, firstReplyAt: at(45), resolvedAt: null, now: at(45) },
      slaTargetsFor("P0"),
    );
    expect(m.firstReplyBreached).toBe(true);
  });
});

// ─── 4. P0 page via alertSpine ──────────────────────────────────────────────

describe("pageSupportP0Ticket — the established alertSpine path", () => {
  it("raises exactly ONE critical alert with a per-ticket dedupe key", async () => {
    const paged = await pageSupportP0Ticket({
      ticketId: 42,
      organizationId: 7,
      subject: "Payment failed",
      reason: "broken-money signal",
    });
    expect(paged).toBe(true);
    expect(RAISED).toHaveLength(1);
    expect(RAISED[0]).toMatchObject({
      severity: "critical",
      source: "supportSeveritySla",
      dedupeKey: "support_p0_ticket_42",
      organizationId: 7,
    });
    expect(RAISED[0].title).toContain("#42");
  });

  it("is best-effort: a throwing spine yields false, never a throw into the ticket path", async () => {
    spineThrows = true;
    await expect(
      pageSupportP0Ticket({ ticketId: 43, organizationId: 7, subject: "x", reason: "broken-send signal" }),
    ).resolves.toBe(false);
  });
});

// ─── 5. Founder queue carries the clock ─────────────────────────────────────

describe("createFromEscalation — SLA class + deadline land on the inbox item", () => {
  const TICKET_CREATED = new Date("2026-08-05T09:00:00Z");

  it("a broken-money ticket lands riskLevel critical (Class B) with a P0 deadline 4h from ticket creation", async () => {
    FIND_FIRST.supportTickets = {
      id: 11,
      subject: "Payment failed",
      description: "Charge declined twice, customer cannot pay.",
      category: "billing",
      priority: "normal",
      organizationId: 7,
      createdAt: TICKET_CREATED,
    };
    await decisionsInboxService.createFromEscalation(11, { category: "billing" });

    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    const item = INSERTED[0];
    expect(item).toMatchObject({
      itemType: "support_escalation",
      riskLevel: "critical",
      urgencyScore: 95,
      status: "pending",
    });
    expect(item.contextBundle.supportSla).toMatchObject({ severityClass: "P0" });
    expect(item.contextBundle.supportSla.slaDeadline).toBe(
      new Date(TICKET_CREATED.getTime() + 4 * 60 * 60000).toISOString(),
    );
  });

  it("a blocked-workflow (non-billing) ticket lands riskLevel high (Class B) with the same-day deadline", async () => {
    FIND_FIRST.supportTickets = {
      id: 12,
      subject: "Deals page crashes",
      description: "Stuck — cannot open any deal.",
      category: "general",
      priority: "normal",
      organizationId: 7,
      createdAt: TICKET_CREATED,
    };
    await decisionsInboxService.createFromEscalation(12, { category: "general" });

    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    const item = INSERTED[0];
    expect(item).toMatchObject({ riskLevel: "high", urgencyScore: 70 });
    expect(item.contextBundle.supportSla).toMatchObject({ severityClass: "P1" });
    expect(item.contextBundle.supportSla.slaDeadline).toBe(
      new Date(TICKET_CREATED.getTime() + 24 * 60 * 60000).toISOString(),
    );
  });

  it("a plain question lands P2 / medium (Class C) with a 48h deadline and NO page", async () => {
    FIND_FIRST.supportTickets = {
      id: 13,
      subject: "How do I export my leads?",
      description: "Looking for the CSV export button.",
      category: "general",
      priority: "normal",
      organizationId: 7,
      createdAt: TICKET_CREATED,
    };
    await decisionsInboxService.createFromEscalation(13, { category: "general" });

    expect(ARBITER_CALLS[0].interruptClass).toBe("C");
    const item = INSERTED[0];
    expect(item).toMatchObject({ riskLevel: "medium", urgencyScore: 50 });
    expect(item.contextBundle.supportSla).toMatchObject({ severityClass: "P2" });
    expect(item.contextBundle.supportSla.slaDeadline).toBe(
      new Date(TICKET_CREATED.getTime() + 48 * 60 * 60000).toISOString(),
    );
    // The escalation write path never pages — P0's page fires at ticket
    // creation (routes seam); and a P2 has no page at all.
    expect(RAISED).toHaveLength(0);
  });

  it("preserves the historical billing mapping for a P2 billing question: high / 80 / Class B", async () => {
    FIND_FIRST.supportTickets = {
      id: 14,
      subject: "Refund question",
      description: "How does the refund policy apply?",
      category: "billing",
      priority: "normal",
      organizationId: 7,
      createdAt: TICKET_CREATED,
    };
    await decisionsInboxService.createFromEscalation(14, { category: "billing" });

    expect(ARBITER_CALLS[0].interruptClass).toBe("B");
    expect(INSERTED[0]).toMatchObject({ riskLevel: "high", urgencyScore: 80 });
    expect(INSERTED[0].contextBundle.supportSla.severityClass).toBe("P2");
  });
});

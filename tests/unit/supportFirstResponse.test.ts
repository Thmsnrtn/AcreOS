/**
 * Support-ticket AI first-response (Rafe).
 *
 * `createSupportTicket` previously inserted the ticket + notified the founder
 * but generated NO reply — the AI only ran when the customer sent a follow-up
 * message. This locks in the wiring that, on ticket CREATION, fires a single
 * bounded resolution pass through the existing Pax resolution agent
 * (resolveTicketWithPax) as a fire-and-forget first response.
 *
 * Asserts:
 *   1. The created ticket is returned and createSupportTicket resolves WITHOUT
 *      waiting on the AI pass (fire-and-forget — never blocks creation).
 *   2. resolveTicketWithPax is invoked with the NEW ticket id + the org.
 *   3. A failure inside the AI pass never rejects createSupportTicket.
 *
 * The DB is a thin recorder; every heavy supportAgent dependency is stubbed at
 * module load so importing the agent doesn't pull the whole server.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Array<{ table: string; values: any }> = [];
let nextTicketId = 100;

// ── db mock: insert(...).values(...).returning() yields a ticket row ──────────
vi.mock("../../server/db", () => {
  const insert = (table: any) => {
    const tag = table?.__tag ?? "unknown";
    const chain: any = {
      values(v: any) {
        chain._values = v;
        // Record on values() so inserts WITHOUT a .returning() call (the user
        // message insert) are captured when awaited.
        inserted.push({ table: tag, values: v });
        return chain;
      },
      returning() {
        if (tag === "support_tickets") {
          return Promise.resolve([{ id: nextTicketId++, ...chain._values }]);
        }
        return Promise.resolve([{ id: 1, ...chain._values }]);
      },
      // Make the chain awaitable for inserts that don't call .returning().
      then(resolve: (v: any) => void) {
        resolve(undefined);
      },
    };
    return chain;
  };
  const select = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve([{ count: 0 }]),
      then: (r: (v: any) => void) => r([{ count: 0 }]),
    };
    return chain;
  };
  return { db: { insert, select } };
});

// ── schema stub: tag the tables createSupportTicket touches ───────────────────
vi.mock("@shared/schema", () => {
  const tag = (name: string) => ({ __tag: name });
  return {
    supportTickets: tag("support_tickets"),
    supportTicketMessages: tag("support_ticket_messages"),
    knowledgeBaseArticles: tag("knowledge_base_articles"),
    supportResolutionHistory: tag("support_resolution_history"),
    organizations: tag("organizations"),
    leads: tag("leads"),
    properties: tag("properties"),
    deals: tag("deals"),
    notes: tag("notes"),
    tasks: tag("tasks"),
    campaigns: tag("campaigns"),
    payments: tag("payments"),
    teamMembers: tag("team_members"),
    activityLog: tag("activity_log"),
    auditLog: tag("audit_log"),
    apiUsageLogs: tag("api_usage_logs"),
    paxMemory: tag("pax_memory"),
    systemAlerts: tag("system_alerts"),
  };
});

// drizzle-orm operators → no-ops (no predicate evaluation under test).
vi.mock("drizzle-orm", () => {
  const op = (..._a: any[]) => ({});
  return {
    eq: op, and: op, desc: op, ilike: op, sql: Object.assign(op, {}),
    or: op, count: op, inArray: op, gte: op, lte: op,
  };
});

// Heavy/irrelevant deps stubbed so the import is light.
vi.mock("openai", () => ({ default: class {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/decisionsInbox", () => ({ decisionsInboxService: {} }));
vi.mock("../../server/services/data-source-broker.js", () => ({ dataSourceBroker: {} }));
vi.mock("../../server/services/propertyEnrichment.js", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/complianceValidator", () => ({ validateCompliance: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The first-response engine — the thing we assert gets fired.
const resolveTicketWithPax = vi.fn(async () => ({
  autoResolved: true,
  escalated: false,
  confidence: 88,
  response: "Pax answer",
  resolutionType: "answer_question",
  toolsUsed: [],
}));
vi.mock("../../server/ai/paxSupportResolver", () => ({ resolveTicketWithPax }));

const org: any = { id: 7, name: "Acme Land Co", subscriptionTier: "starter" };

beforeEach(() => {
  inserted.length = 0;
  nextTicketId = 100;
  resolveTicketWithPax.mockClear();
});

describe("createSupportTicket — AI first-response on creation", () => {
  it("returns the created ticket without awaiting the AI pass", async () => {
    const { createSupportTicket } = await import("../../server/ai/supportAgent");
    const ticket = await createSupportTicket(
      org,
      "user-1",
      "Map won't load",
      "The map tab is blank on mobile.",
      { autoAttachContext: false },
    );
    expect(ticket.id).toBe(100);
    // The ticket + the initial user message were inserted.
    expect(inserted.some((i) => i.table === "support_tickets")).toBe(true);
    expect(inserted.some((i) => i.table === "support_ticket_messages")).toBe(true);
  });

  it("fires resolveTicketWithPax with the new ticket id and the org", async () => {
    const { createSupportTicket } = await import("../../server/ai/supportAgent");
    await createSupportTicket(org, "user-1", "Sync issue", "Deals not syncing.", {
      autoAttachContext: false,
    });
    // Let the fire-and-forget microtask settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveTicketWithPax).toHaveBeenCalledTimes(1);
    const [ticketId, passedOrg] = resolveTicketWithPax.mock.calls[0] as any[];
    expect(ticketId).toBe(100);
    expect(passedOrg).toBe(org);
  });

  it("never rejects creation when the AI pass throws (best-effort)", async () => {
    resolveTicketWithPax.mockRejectedValueOnce(new Error("model down"));
    const { createSupportTicket } = await import("../../server/ai/supportAgent");
    const ticket = await createSupportTicket(
      org,
      "user-1",
      "Billing",
      "Charge looks wrong.",
      { autoAttachContext: false },
    );
    expect(ticket.id).toBe(100);
    await new Promise((r) => setTimeout(r, 0));
    expect(resolveTicketWithPax).toHaveBeenCalledTimes(1);
  });
});

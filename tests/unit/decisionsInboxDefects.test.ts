/**
 * Class-C defect ledger (Jarvis 2.3) — getSuppressedDefects.
 *
 * Pins: only status=suppressed rows inside the trailing window count,
 * ordering is newest-first, and the byType summary matches the filtered
 * items. The window/order arithmetic is re-applied in process (tickMetric
 * pattern), so the mock returns rows verbatim and the assertions pin the
 * service's own filtering.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(),
  recordDeferredInterrupt: vi.fn(),
}));

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));

vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: { attemptResolution: vi.fn() },
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(),
}));

// ─── DB mock ────────────────────────────────────────────────────────────────

const FIND_MANY_ROWS: Array<Record<string, any>> = [];

vi.mock("../../server/db", () => {
  const db = {
    query: {
      decisionsInboxItems: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [...FIND_MANY_ROWS]),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
  };
  return { db };
});

import { decisionsInboxService } from "../../server/services/decisionsInbox";

const NOW = Date.now();

function daysAgo(n: number): Date {
  return new Date(NOW - n * 24 * 60 * 60 * 1000);
}

function row(overrides: Record<string, any>): Record<string, any> {
  return {
    id: 1,
    itemType: "support_escalation",
    status: "suppressed",
    sophieAnalysis: "analysis",
    createdAt: daysAgo(1),
    ...overrides,
  };
}

beforeEach(() => {
  FIND_MANY_ROWS.length = 0;
});

describe("getSuppressedDefects", () => {
  it("returns only suppressed rows inside the trailing window, newest first", async () => {
    FIND_MANY_ROWS.push(
      row({ id: 1, createdAt: daysAgo(5) }), // counted
      row({ id: 2, createdAt: daysAgo(1) }), // counted — should sort first
      row({ id: 3, createdAt: daysAgo(40) }), // outside 30-day window
      row({ id: 4, status: "pending", createdAt: daysAgo(1) }), // wrong status
      row({ id: 5, status: "deferred", createdAt: daysAgo(1) }), // wrong status
    );

    const out = await decisionsInboxService.getSuppressedDefects(30);

    expect(out.total).toBe(2);
    expect(out.items.map((i: any) => i.id)).toEqual([2, 1]);
  });

  it("respects a custom window", async () => {
    FIND_MANY_ROWS.push(
      row({ id: 1, createdAt: daysAgo(2) }), // counted at 7d
      row({ id: 2, createdAt: daysAgo(10) }), // outside 7d
    );

    const out = await decisionsInboxService.getSuppressedDefects(7);

    expect(out.total).toBe(1);
    expect(out.items[0].id).toBe(1);
  });

  it("summarizes counts per itemType over the filtered rows only", async () => {
    FIND_MANY_ROWS.push(
      row({ id: 1, itemType: "support_escalation", createdAt: daysAgo(1) }),
      row({ id: 2, itemType: "support_escalation", createdAt: daysAgo(2) }),
      row({ id: 3, itemType: "feature_request_flagged", createdAt: daysAgo(3) }),
      row({ id: 4, itemType: "feature_request_flagged", createdAt: daysAgo(45) }), // outside window
    );

    const out = await decisionsInboxService.getSuppressedDefects(30);

    expect(out.byType).toEqual({
      support_escalation: 2,
      feature_request_flagged: 1,
    });
    expect(out.total).toBe(3);
  });

  it("empty ledger reads as an honest zero", async () => {
    const out = await decisionsInboxService.getSuppressedDefects();

    expect(out).toEqual({ items: [], byType: {}, total: 0 });
  });
});

/**
 * Phase B — action-tool tests: shape + destructive-confirmation flow.
 *
 * Verifies every action tool is marked destructive at the right tier,
 * and that the executor returns a confirmation_request (not actual
 * mutation) on first call.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  getTool,
  listTools,
  __resetRegistryForTests,
  type FounderToolContext,
} from "../../server/services/founder-chat/tool-registry";

const ACTION_TOOLS_TIER2 = [
  "approve_trigger",
  "defer_trigger",
  "approve_decision",
  "reject_decision",
  "pause_channel_for_org",
  "throttle_channel_for_org",
  "retry_dlq_item",
  "discard_dlq_item",
  "run_ceo_command",
];

const ACTION_TOOLS_TIER3 = [
  "transfer_between_buckets",
  "set_dial",
  "revoke_byok_credential",
  "set_org_override",
];

// Mock DB so persistPendingCall doesn't hit Postgres.
vi.mock("../../server/db", () => {
  const insertReturning = vi.fn().mockResolvedValue([{}]);
  const insertOnConflict = { onConflictDoUpdate: vi.fn().mockResolvedValue([{}]) };
  const insertValues = vi.fn().mockReturnValue({ ...insertOnConflict, returning: insertReturning });
  return {
    db: {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
      transaction: vi.fn(async (fn: any) => fn({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }),
        }),
      })),
    },
  };
});

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/action");
});

function fakeCtx(): FounderToolContext {
  return {
    founderUserId: "u_test",
    organizationId: 1,
    threadId: 42,
    recentMentions: [],
    auditLog: async () => {},
  };
}

describe("founder-chat action tools", () => {
  it("registers all 13 action tools (12 spec + run_ceo_command)", () => {
    const names = listTools({ category: "action" }).map((t) => t.name).sort();
    expect(names).toEqual([...ACTION_TOOLS_TIER2, ...ACTION_TOOLS_TIER3].sort());
  });

  it("every action tool is destructive", () => {
    for (const t of listTools({ category: "action" })) {
      expect(t.destructive, `${t.name} should be destructive`).toBe(true);
    }
  });

  it("tier-2 action tools have tier === 2", () => {
    for (const name of ACTION_TOOLS_TIER2) {
      expect(getTool(name)?.tier, `${name} tier`).toBe(2);
    }
  });

  it("tier-3 action tools have tier === 3", () => {
    for (const name of ACTION_TOOLS_TIER3) {
      expect(getTool(name)?.tier, `${name} tier`).toBe(3);
    }
  });

  it("approve_trigger schema requires threshold_id", () => {
    const t = getTool("approve_trigger")!;
    expect(t.schema.safeParse({}).success).toBe(false);
    expect(t.schema.safeParse({ threshold_id: "mrr-50" }).success).toBe(true);
  });

  it("transfer_between_buckets schema enforces enum buckets", () => {
    const t = getTool("transfer_between_buckets")!;
    expect(t.schema.safeParse({
      from: "tax_reserve", to: "opex_available", cents: 100,
    }).success).toBe(true);
    expect(t.schema.safeParse({
      from: "garbage", to: "opex_available", cents: 100,
    }).success).toBe(false);
  });
});

describe("founder-chat executor — destructive flow", () => {
  it("returns confirmation_request artifact instead of executing on first call", async () => {
    const { runTool } = await import("../../server/services/founder-chat/executor");
    const result = await runTool({
      toolName: "approve_trigger",
      args: { threshold_id: "mrr-50" },
      ctx: fakeCtx(),
    });
    expect(result.requiresConfirmation).toBe(true);
    expect(result.artifact.type).toBe("confirmation_request");
    expect(result.confirmationRequestId).toBeDefined();
  });

  it("returns confirmation_request for tier-3 transfer", async () => {
    const { runTool } = await import("../../server/services/founder-chat/executor");
    const result = await runTool({
      toolName: "transfer_between_buckets",
      args: { from: "tax_reserve", to: "opex_available", cents: 500 },
      ctx: fakeCtx(),
    });
    expect(result.requiresConfirmation).toBe(true);
    expect(result.artifact.type).toBe("confirmation_request");
    expect((result.artifact as any).tier).toBe(3);
  });
});

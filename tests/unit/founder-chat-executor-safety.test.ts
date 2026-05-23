/**
 * Phase G/H/I batch 2 — executor safety infrastructure tests.
 *
 * Covers:
 *   - Kill switch off → destructive tool executes
 *   - Kill switch on → destructive tool refused with the studio pointer
 *   - Kill switch on → read-only tool still runs
 *   - Tier-3 cooldown: second confirmed call within 5 min requires fresh confirmation
 *   - rollbackRecipe persists to audit metadata
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  __resetRegistryForTests,
  registerTool,
  type FounderToolContext,
} from "../../server/services/founder-chat/tool-registry";
import {
  runTool,
  __resetCooldownTrackerForTests,
  __setKillSwitchOverrideForTests,
} from "../../server/services/founder-chat/executor";

// Mock DB so persistPendingCall doesn't hit Postgres.
vi.mock("../../server/db", () => {
  const insertValues = vi.fn().mockResolvedValue([{}]);
  return {
    db: {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    },
  };
});

function fakeCtx(): FounderToolContext {
  return {
    founderUserId: "u_safety_test",
    organizationId: 1,
    threadId: 99,
    recentMentions: [],
    auditLog: async () => {},
  };
}

beforeEach(() => {
  __resetRegistryForTests();
  __resetCooldownTrackerForTests();
  __setKillSwitchOverrideForTests(false);
});

afterEach(() => {
  __setKillSwitchOverrideForTests(null);
});

describe("executor — kill-switch", () => {
  it("destructive tool runs when kill-switch is OFF", async () => {
    const handler = vi.fn(async () => ({
      artifact: { type: "text" as const, markdown: "did the thing" },
    }));
    registerTool({
      name: "fake_destructive",
      description: "test",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({}),
      handler,
    });

    __setKillSwitchOverrideForTests(false);
    const outcome = await runTool({
      toolName: "fake_destructive",
      args: {},
      ctx: fakeCtx(),
      confirmed: true,
    });
    expect(outcome.artifact.type).toBe("text");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("destructive tool is refused when kill-switch is ON, with pointer message", async () => {
    const handler = vi.fn(async () => ({
      artifact: { type: "text" as const, markdown: "should not run" },
    }));
    registerTool({
      name: "fake_destructive_killed",
      description: "test",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({}),
      handler,
    });

    __setKillSwitchOverrideForTests(true);
    await expect(
      runTool({
        toolName: "fake_destructive_killed",
        args: {},
        ctx: fakeCtx(),
        confirmed: true,
      }),
    ).rejects.toThrow(/disabled/i);
    expect(handler).not.toHaveBeenCalled();
  });

  it("read-only tools STILL run when the kill-switch is ON", async () => {
    const handler = vi.fn(async () => ({
      artifact: { type: "text" as const, markdown: "read ok" },
    }));
    registerTool({
      name: "fake_readonly",
      description: "test",
      category: "inquiry",
      destructive: false,
      tier: 1,
      schema: z.object({}),
      handler,
    });

    __setKillSwitchOverrideForTests(true);
    const outcome = await runTool({
      toolName: "fake_readonly",
      args: {},
      ctx: fakeCtx(),
    });
    expect(outcome.artifact.type).toBe("text");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("kill-switch refusal mentions /founder/studio/atlas", async () => {
    registerTool({
      name: "fake_destructive_pointer",
      description: "test",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({}),
      handler: async () => ({ artifact: { type: "text", markdown: "x" } }),
    });
    __setKillSwitchOverrideForTests(true);
    await expect(
      runTool({
        toolName: "fake_destructive_pointer",
        args: {},
        ctx: fakeCtx(),
        confirmed: true,
      }),
    ).rejects.toThrow(/\/founder\/studio\/atlas/);
  });
});

describe("executor — Tier-3 cooldown", () => {
  it("second confirmed Tier-3 call within 5 min requires a fresh confirmation", async () => {
    const handler = vi.fn(async () => ({
      artifact: { type: "text" as const, markdown: "executed" },
    }));
    registerTool({
      name: "fake_tier3",
      description: "test",
      category: "action",
      destructive: true,
      tier: 3,
      schema: z.object({}),
      handler,
    });

    // First confirmed call — runs.
    const first = await runTool({
      toolName: "fake_tier3",
      args: {},
      ctx: fakeCtx(),
      confirmed: true,
    });
    expect(first.artifact.type).toBe("text");
    expect(handler).toHaveBeenCalledTimes(1);

    // Second confirmed call immediately — must come back as a fresh
    // confirmation request (NOT execute again).
    const second = await runTool({
      toolName: "fake_tier3",
      args: {},
      ctx: fakeCtx(),
      confirmed: true,
    });
    expect(second.requiresConfirmation).toBe(true);
    expect(second.artifact.type).toBe("confirmation_request");
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });

  it("cooldown does NOT apply to Tier-2 tools", async () => {
    const handler = vi.fn(async () => ({
      artifact: { type: "text" as const, markdown: "executed" },
    }));
    registerTool({
      name: "fake_tier2",
      description: "test",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({}),
      handler,
    });

    await runTool({ toolName: "fake_tier2", args: {}, ctx: fakeCtx(), confirmed: true });
    await runTool({ toolName: "fake_tier2", args: {}, ctx: fakeCtx(), confirmed: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("executor — rollback recipe persistence", () => {
  it("persists rollbackRecipe to audit metadata under the after field", async () => {
    const auditCalls: Array<{ action: string; before: unknown; after: unknown }> = [];
    const ctx: FounderToolContext = {
      ...fakeCtx(),
      auditLog: async (action, before, after) => {
        auditCalls.push({ action, before, after });
      },
    };

    registerTool({
      name: "fake_with_recipe",
      description: "test",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({}),
      handler: async () => ({
        artifact: { type: "text", markdown: "ok" },
        rollbackRecipe: {
          reverseToolName: "fake_undo",
          reverseArgs: { foo: "bar" },
          humanLabel: "Undo the fake action",
        },
      }),
    });

    await runTool({
      toolName: "fake_with_recipe",
      args: {},
      ctx,
      confirmed: true,
    });

    const toolCallAudit = auditCalls.find((c) =>
      c.action.startsWith("tool_call:fake_with_recipe"),
    );
    expect(toolCallAudit).toBeDefined();
    const after = toolCallAudit!.after as Record<string, unknown>;
    expect(after).toHaveProperty("rollbackRecipe");
    const recipe = after.rollbackRecipe as Record<string, unknown>;
    expect(recipe.reverseToolName).toBe("fake_undo");
    expect((recipe.reverseArgs as any).foo).toBe("bar");
    expect(recipe.humanLabel).toBe("Undo the fake action");
  });

  it("records null rollbackRecipe when tool returns none", async () => {
    const auditCalls: Array<{ action: string; after: unknown }> = [];
    const ctx: FounderToolContext = {
      ...fakeCtx(),
      auditLog: async (action, _before, after) => {
        auditCalls.push({ action, after });
      },
    };
    registerTool({
      name: "fake_no_recipe",
      description: "test",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({}),
      handler: async () => ({ artifact: { type: "text", markdown: "ok" } }),
    });
    await runTool({
      toolName: "fake_no_recipe",
      args: {},
      ctx,
      confirmed: true,
    });
    const toolCallAudit = auditCalls.find((c) =>
      c.action.startsWith("tool_call:fake_no_recipe"),
    );
    expect(toolCallAudit).toBeDefined();
    expect((toolCallAudit!.after as Record<string, unknown>).rollbackRecipe).toBeNull();
  });
});

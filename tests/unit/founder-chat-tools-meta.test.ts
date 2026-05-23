/**
 * Phase G/H/I batch 2 — undo_last_action meta-tool.
 *
 * Verifies:
 *   - registered as T3 destructive
 *   - happy path: reads the last audit row with a rollbackRecipe and
 *     invokes the reverse tool through the executor
 *   - "no recipe" path: surfaces a friendly text artifact
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  registerTool,
  type FounderToolContext,
} from "../../server/services/founder-chat/tool-registry";
import {
  runTool,
  __resetCooldownTrackerForTests,
  __setKillSwitchOverrideForTests,
} from "../../server/services/founder-chat/executor";
import { z } from "zod";

// We intercept the founder-audit SELECT chain so we can return our own rows.
let auditRowsToReturn: any[] = [];

vi.mock("../../server/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(async () => auditRowsToReturn),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

// Stub all destructive providers so registering meta/destructive don't hit network.
vi.mock("../../server/services/founder-chat/providers/fly", () => ({
  FlyClientError: class extends Error { status = 0; body = ""; },
  listMachines: vi.fn(async () => []),
  listReleases: vi.fn(async () => []),
  getMachine: vi.fn(),
  restartMachine: vi.fn(),
  scaleApp: vi.fn(),
  triggerDeploy: vi.fn(),
  rollbackToVersion: vi.fn(),
  setSecret: vi.fn(),
}));
vi.mock("../../server/services/founder-chat/providers/stripe-ops", () => ({
  lookupCustomer: vi.fn(), getCustomerInvoices: vi.fn(), getActiveSubscriptions: vi.fn(),
  refundCharge: vi.fn(), cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(), grantCredit: vi.fn(), pauseSubscription: vi.fn(),
}));
vi.mock("../../server/services/founder-chat/providers/clerk-ops", () => ({
  ClerkOpsError: class extends Error { status = 0; },
  getUser: vi.fn(), suspendUser: vi.fn(), restoreUser: vi.fn(), forcePasswordReset: vi.fn(),
}));
vi.mock("../../server/services/founder-chat/providers/github", () => ({
  GithubClientError: class extends Error { status = 0; body = ""; },
  latestMainSha: vi.fn(), readFile: vi.fn(), createBranch: vi.fn(), putFileOnBranch: vi.fn(),
  createPullRequest: vi.fn(), getPullRequest: vi.fn(), getCheckRuns: vi.fn(),
  mergePullRequest: vi.fn(), commentOnPr: vi.fn(), createIssue: vi.fn(),
}));
vi.mock("../../server/services/founder-chat/providers/db-ops", () => ({
  DbOpsError: class extends Error { kind = "exec"; constructor(m: string, k: string) { super(m); this.kind = k; } },
  parseSqlSafety: vi.fn(() => ({ isReadOnly: false })),
  runDestructiveQuery: vi.fn(),
}));
vi.mock("../../server/services/founder-chat/providers/sentry-ops", () => ({
  SentryClientError: class extends Error { status = 0; },
  getIssueDetails: vi.fn(), resolveIssue: vi.fn(), unresolveIssue: vi.fn(),
}));

function ctx(): FounderToolContext {
  return {
    founderUserId: "u_meta",
    organizationId: 1,
    threadId: 1,
    recentMentions: [],
    auditLog: async () => {},
  };
}

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/destructive");
  await import("../../server/services/founder-chat/tools/meta");
});
afterAll(() => __resetRegistryForTests());

beforeEach(() => {
  __resetCooldownTrackerForTests();
  __setKillSwitchOverrideForTests(false);
  auditRowsToReturn = [];
});
afterEach(() => {
  __setKillSwitchOverrideForTests(null);
  vi.clearAllMocks();
});

describe("undo_last_action registration", () => {
  it("is T3 destructive in the action category", () => {
    const t = getTool("undo_last_action")!;
    expect(t).toBeDefined();
    expect(t.tier).toBe(3);
    expect(t.destructive).toBe(true);
    expect(t.category).toBe("action");
  });
});

describe("undo_last_action — no recipe path", () => {
  it("returns a friendly text artifact when no rollback recipe is found", async () => {
    auditRowsToReturn = [];
    const out = await runTool({
      toolName: "undo_last_action",
      args: { reason: "test" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("text");
    const md = (out.artifact as { markdown: string }).markdown;
    expect(md).toMatch(/Nothing to undo/);
  });
});

describe("undo_last_action — happy path", () => {
  it("replays the reverse tool", async () => {
    // Register a reversible tool + capture how many times the reverse fires.
    const reverseHandler = vi.fn(async () => ({
      artifact: { type: "text" as const, markdown: "reversed" },
    }));
    registerTool({
      name: "fake_reverse_tool",
      description: "reverse",
      category: "action",
      destructive: true,
      tier: 2,
      schema: z.object({ flag: z.string() }),
      handler: reverseHandler,
    });

    auditRowsToReturn = [
      {
        id: 1,
        action: "tool_call:fake_original",
        after: {
          rollbackRecipe: {
            reverseToolName: "fake_reverse_tool",
            reverseArgs: { flag: "yes" },
            humanLabel: "undo the original",
          },
        },
        createdAt: new Date(),
      },
    ];

    const out = await runTool({
      toolName: "undo_last_action",
      args: { reason: "manual" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("text");
    expect(reverseHandler).toHaveBeenCalledTimes(1);
    expect(reverseHandler.mock.calls[0][0]).toEqual({ flag: "yes" });
  });
});

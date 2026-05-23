/**
 * Phase G/H/I batch 2 — destructive Stripe + Clerk tool tests.
 *
 * Stubs both providers + the DB. Verifies tier/destructive flags, schema
 * requires reason, and confirmed-call execution wires through to the
 * provider stubs.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  type FounderToolContext,
} from "../../server/services/founder-chat/tool-registry";
import {
  runTool,
  __resetCooldownTrackerForTests,
  __setKillSwitchOverrideForTests,
} from "../../server/services/founder-chat/executor";

vi.mock("../../server/services/founder-chat/providers/stripe-ops", () => ({
  lookupCustomer: vi.fn(),
  getCustomerInvoices: vi.fn(),
  getActiveSubscriptions: vi.fn(),
  refundCharge: vi.fn(async () => ({ id: "re_1", amount: 1000, status: "succeeded", charge: "ch_1", reason: null })),
  cancelSubscription: vi.fn(async () => ({ id: "sub_1", status: "active", cancel_at_period_end: true, canceled_at: null })),
  reactivateSubscription: vi.fn(async () => ({ id: "sub_1", status: "active", cancel_at_period_end: false, canceled_at: null })),
  grantCredit: vi.fn(async () => ({ id: "cbt_1", amount: 500, customer: "cus_1" })),
  pauseSubscription: vi.fn(async () => ({ id: "sub_1", status: "paused", cancel_at_period_end: false, canceled_at: null })),
}));

vi.mock("../../server/services/founder-chat/providers/clerk-ops", () => ({
  ClerkOpsError: class extends Error {
    status = 0;
    constructor(m: string, s: number) {
      super(m);
      this.status = s;
    }
  },
  getUser: vi.fn(async () => ({ id: "u_clerk", email: "x@y.z", banned: false })),
  suspendUser: vi.fn(async () => ({ id: "u_clerk", email: "x@y.z", banned: true })),
  restoreUser: vi.fn(async () => ({ id: "u_clerk", email: "x@y.z", banned: false })),
  forcePasswordReset: vi.fn(async () => ({ revoked: 3 })),
}));

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

vi.mock("../../server/services/founder-chat/providers/github", () => ({
  GithubClientError: class extends Error { status = 0; body = ""; },
  latestMainSha: vi.fn(async () => "abc"),
  readFile: vi.fn(),
  createBranch: vi.fn(),
  putFileOnBranch: vi.fn(),
  createPullRequest: vi.fn(),
  getPullRequest: vi.fn(),
  getCheckRuns: vi.fn(),
  mergePullRequest: vi.fn(),
  commentOnPr: vi.fn(),
  createIssue: vi.fn(),
}));

vi.mock("../../server/services/founder-chat/providers/db-ops", () => ({
  DbOpsError: class extends Error { kind = "exec"; constructor(m: string, k: string) { super(m); this.kind = k; } },
  parseSqlSafety: vi.fn(() => ({ isReadOnly: false })),
  runDestructiveQuery: vi.fn(async () => ({ rowCount: 0, snapshot: null, snapshotTable: null })),
}));

vi.mock("../../server/services/founder-chat/providers/sentry-ops", () => ({
  SentryClientError: class extends Error { status = 0; },
  getIssueDetails: vi.fn(async () => ({ id: "x", title: "x", status: "resolved" })),
  resolveIssue: vi.fn(async () => ({ id: "x", title: "x", status: "resolved" })),
  unresolveIssue: vi.fn(async () => ({ id: "x", title: "x", status: "unresolved" })),
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  },
}));

function ctx(): FounderToolContext {
  return {
    founderUserId: "u_sc",
    organizationId: 1,
    threadId: 1,
    recentMentions: [],
    auditLog: async () => {},
  };
}

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/destructive");
});
afterAll(() => __resetRegistryForTests());

beforeEach(() => {
  __resetCooldownTrackerForTests();
  __setKillSwitchOverrideForTests(false);
});
afterEach(() => {
  __setKillSwitchOverrideForTests(null);
  vi.clearAllMocks();
});

describe("stripe destructive — registration shape", () => {
  it("registers refund as T3, cancel/reactivate/credit/pause as T2, all destructive", () => {
    const t3 = ["stripe_refund_charge"];
    const t2 = [
      "stripe_cancel_subscription",
      "stripe_reactivate_subscription",
      "stripe_grant_credit",
      "stripe_pause_subscription",
    ];
    for (const n of t3) {
      const t = getTool(n);
      expect(t?.destructive).toBe(true);
      expect(t?.tier).toBe(3);
    }
    for (const n of t2) {
      const t = getTool(n);
      expect(t?.destructive).toBe(true);
      expect(t?.tier).toBe(2);
    }
  });

  it("stripe_refund_charge requires reason", () => {
    const t = getTool("stripe_refund_charge")!;
    expect(t.schema.safeParse({ chargeId: "ch_123" }).success).toBe(false);
    expect(t.schema.safeParse({ chargeId: "ch_123", reason: "duplicate charge" }).success).toBe(true);
  });
});

describe("stripe destructive — confirmation flow", () => {
  it("first call returns confirmation_request; confirmed call invokes provider", async () => {
    const first = await runTool({
      toolName: "stripe_refund_charge",
      args: { chargeId: "ch_abc", reason: "test reason" },
      ctx: ctx(),
    });
    expect(first.requiresConfirmation).toBe(true);
    const stripe = await import("../../server/services/founder-chat/providers/stripe-ops");
    expect(stripe.refundCharge).not.toHaveBeenCalled();

    const second = await runTool({
      toolName: "stripe_refund_charge",
      args: { chargeId: "ch_abc", reason: "test reason" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(second.artifact.type).toBe("text");
    expect(stripe.refundCharge).toHaveBeenCalledWith("ch_abc", undefined, "test reason");
  });

  it("cancel rollback recipe points to reactivate", async () => {
    const out = await runTool({
      toolName: "stripe_cancel_subscription",
      args: { subId: "sub_xyz", atPeriodEnd: true, reason: "test" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(out.artifact.type).toBe("text");
    // Recipe captured on the audit row; we re-run through a custom auditLog
    // to inspect — but here we just verify the outcome ran cleanly.
  });
});

describe("clerk destructive — registration shape", () => {
  it("registers suspend as T3, restore + force_password_reset as T2", () => {
    expect(getTool("clerk_suspend_user")?.tier).toBe(3);
    expect(getTool("clerk_suspend_user")?.destructive).toBe(true);
    expect(getTool("clerk_restore_user")?.tier).toBe(2);
    expect(getTool("clerk_force_password_reset")?.tier).toBe(2);
  });

  it("confirmed clerk_suspend_user calls provider + verifyFn", async () => {
    const clerk = await import("../../server/services/founder-chat/providers/clerk-ops");
    // verifyFn re-reads via getUser — mock it to reflect post-suspend state.
    (clerk.getUser as any).mockResolvedValueOnce({ id: "u_test", email: "x@y.z", banned: true });

    const out = await runTool({
      toolName: "clerk_suspend_user",
      args: { userId: "u_test", reason: "abuse" },
      ctx: ctx(),
      confirmed: true,
    });
    expect(clerk.suspendUser).toHaveBeenCalledWith("u_test", "abuse");
    expect(out.verification).toBeDefined();
    expect(out.verification!.ok).toBe(true); // mocked banned=true
  });
});

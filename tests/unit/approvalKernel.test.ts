/**
 * Tier 1A (elevation blueprint 2026-06-10): the structural approval kernel.
 *
 * Witnessed-send must be unbypassable BY CONSTRUCTION:
 *
 *   - executeTool freezes any approval-required tool call that arrives
 *     without the server-side trustedApproval option as a pending_actions
 *     row (frozen args + sha256 content hash + expiry) and returns a pending
 *     artifact instead of executing.
 *   - approvePendingAction is the ONLY path from that row to execution: it
 *     re-verifies org ownership, expiry, and the content hash against the
 *     FROZEN args, claims the row with a guarded pending→approved UPDATE
 *     (exactly one approval wins — a double-tap returns the first result),
 *     executes exactly that row, and appends a pax_sends audit row.
 *
 * The db mock follows tests/unit/paxDraftApproval.test.ts: a hand-rolled
 * in-memory store, with drizzle WHERE expressions rendered to SQL via
 * PgDialect and interpreted as ANDed column/param equality pairs — enough to
 * faithfully execute every query shape approvalKernel emits, including the
 * guarded claim UPDATE. Two tables are routed by getTableName.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── In-memory pending_actions + pax_sends tables ────────────────────────────

const mem = vi.hoisted(() => ({
  tables: {
    pending_actions: [] as any[],
    pax_sends: [] as any[],
  } as Record<string, any[]>,
  nextId: 1,
}));

vi.mock("../../server/db", async () => {
  // (Async factory + local imports: vi.mock factories are hoisted above the
  // module's imports, so nothing from the top level may be referenced here.)
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { getTableName } = await import("drizzle-orm");

  const COLUMN_TO_PROP: Record<string, string> = {
    id: "id",
    organization_id: "organizationId",
    tool_name: "toolName",
    args: "args",
    content_hash: "contentHash",
    status: "status",
    expires_at: "expiresAt",
    created_by_user_id: "createdByUserId",
    approved_by_user_id: "approvedByUserId",
    executed_at: "executedAt",
    result_summary: "resultSummary",
    created_at: "createdAt",
    pending_action_id: "pendingActionId",
    channel: "channel",
    recipient_ref: "recipientRef",
    sent_at: "sentAt",
  };

  const matcher = (expr: unknown) => {
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(expr as any);
    const conds: Array<{ prop: string; value: unknown }> = [];
    const re = /"([a-z_]+)" = \$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`approvalKernel mock: unmapped column ${m[1]}`);
      conds.push({ prop, value: params[Number(m[2]) - 1] });
    }
    if (conds.length === 0) throw new Error(`approvalKernel mock: no eq conditions in: ${sql}`);
    return (row: any) => conds.every((c) => row[c.prop] === c.value);
  };

  const TABLE_DEFAULTS: Record<string, Record<string, unknown>> = {
    pending_actions: {
      status: "pending",
      createdByUserId: null,
      approvedByUserId: null,
      executedAt: null,
      resultSummary: null,
    },
    pax_sends: { recipientRef: null },
  };

  const db = {
    select: () => ({
      from: (table: any) => ({
        where: (expr: unknown) => {
          const rows = mem.tables[getTableName(table)];
          const pred = matcher(expr);
          const result = rows.filter(pred).map((r) => ({ ...r }));
          return Object.assign(Promise.resolve(result), {
            limit: async (n: number) => result.slice(0, n),
          });
        },
      }),
    }),
    insert: (table: any) => ({
      values: (vals: any) => {
        const name = getTableName(table);
        const insertOne = () => {
          const row = {
            ...(TABLE_DEFAULTS[name] ?? {}),
            createdAt: new Date(),
            sentAt: new Date(),
            ...vals,
            id: mem.nextId++,
          };
          // Lazily create tables the kernel writes as side-effects (e.g. the
          // Tier-2C first_value_reached row in activation_events) so a
          // fire-and-forget insert can never become an unhandled rejection.
          (mem.tables[name] ??= []).push(row);
          return [{ ...row }];
        };
        // Support `await db.insert(t).values(v)`, `….returning()`, and
        // `….onConflictDoNothing(…)` (used by recordActivationEvent).
        let inserted: any[] | null = null;
        const run = () => (inserted ??= insertOne());
        return Object.assign(
          Promise.resolve().then(run),
          {
            returning: async () => run(),
            onConflictDoNothing: async () => run(),
          },
        );
      },
    }),
    update: (table: any) => ({
      set: (vals: any) => ({
        where: (expr: unknown) => {
          const rows = mem.tables[getTableName(table)];
          const pred = matcher(expr);
          let applied: any[] | null = null;
          const apply = () => {
            if (applied) return applied;
            applied = [];
            for (const row of rows) {
              if (pred(row)) {
                Object.assign(row, vals);
                applied.push({ ...row });
              }
            }
            return applied;
          };
          return Object.assign(
            Promise.resolve().then(apply),
            { returning: async () => apply() },
          );
        },
      }),
    }),
  };
  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The kernel publishes `pending_action.created` over the org WebSocket
// channel on proposal (review-queue plumbing, 2026-09-02). Stubbed here so
// this suite stays a pure state-machine test; the publish contract itself is
// pinned in tests/unit/pendingActionsQueue.test.ts.
vi.mock("../../server/websocket", () => ({
  wsServer: { broadcastToOrg: vi.fn() },
}));

import {
  APPROVAL_REQUIRED_TOOLS,
  actionContentHash,
  canonicalizeToolArgs,
  proposePendingAction,
  pendingActionArtifact,
  approvePendingAction,
  rejectPendingAction,
} from "../../server/services/approvalKernel";

const ORG = 7;
const OTHER_ORG = 999;
const USER = "user_tap";

const emailArgs = { lead_id: 42, subject: "Following up", message: "Hi there." };

const pending = () => mem.tables.pending_actions;
const sends = () => mem.tables.pax_sends;

beforeEach(() => {
  mem.tables.pending_actions = [];
  mem.tables.pax_sends = [];
  mem.tables.activation_events = [];
  mem.nextId = 1;
});

// ── (a) Approval-required tool without trustedApproval: pending row, no send ─

describe("the kernel gate — approval-required without trustedApproval never executes", () => {
  it("send_email and send_sms are in APPROVAL_REQUIRED_TOOLS", () => {
    expect(APPROVAL_REQUIRED_TOOLS.has("send_email")).toBe(true);
    expect(APPROVAL_REQUIRED_TOOLS.has("send_sms")).toBe(true);
  });

  it("executeTool enforces the gate INSIDE itself (structural, not call-site)", () => {
    // The whole point of Tier 1A: the gate lives in executeTool, so every
    // caller inherits it. Loading tools.ts here would drag in the entire
    // service graph, so we assert the structural wiring at source level.
    const src = readFileSync(
      resolve(__dirname, "../../server/ai/tools.ts"),
      "utf8",
    );
    const gate = src.indexOf("kernelApprovalRequiredTools.has(toolName) && !trustedApproval");
    const propose = src.indexOf("proposePendingAction(", gate);
    const firstCase = src.indexOf('case "get_system_context"');
    expect(gate).toBeGreaterThan(-1);
    expect(propose).toBeGreaterThan(gate);
    // The gate fires before ANY tool dispatch.
    expect(firstCase === -1 || gate < firstCase).toBe(true);
    // And the dead bypass machinery is gone.
    expect(src.includes("__paxPendingApprovals")).toBe(false);
  });

  it("proposePendingAction freezes the call as a pending row and executes nothing", async () => {
    const row = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      args: emailArgs,
      createdByUserId: USER,
    });

    expect(pending()).toHaveLength(1);
    expect(row.status).toBe("pending");
    expect(row.args).toEqual(emailArgs);
    expect(row.contentHash).toBe(actionContentHash("send_email", emailArgs));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Nothing executed, nothing audited.
    expect(sends()).toHaveLength(0);

    const artifact = pendingActionArtifact(row);
    expect(artifact.pendingApproval).toBe(true);
    expect(artifact.pendingActionId).toBe(row.id);
    expect(artifact.channel).toBe("email");
  });

  it("re-proposing the identical action reuses the pending row (one approval target)", async () => {
    const first = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const second = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      // Same content, different property order — canonicalization must match.
      args: { message: "Hi there.", subject: "Following up", lead_id: 42 },
    });
    expect(second.id).toBe(first.id);
    expect(pending()).toHaveLength(1);
  });

  it("content hash is stable under key reordering and distinct across content", () => {
    expect(canonicalizeToolArgs({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalizeToolArgs({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(actionContentHash("send_email", emailArgs)).not.toBe(
      actionContentHash("send_sms", emailArgs),
    );
  });
});

// ── (b) Approve executes exactly once ───────────────────────────────────────

describe("approve — executes the frozen row exactly once (idempotency)", () => {
  it("double-approve sends once; the second tap returns the first result", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });

    const execute = vi.fn(async () => ({ success: true, data: { messageId: "msg_1" } }));
    const tap = () =>
      approvePendingAction({ organizationId: ORG, pendingActionId: row.id, approvedByUserId: USER, execute });

    const first = await tap();
    const second = await tap();

    expect(first.outcome).toBe("executed");
    expect(second.outcome).toBe("already_executed");
    // THE invariant: exactly one execution.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("send_email", emailArgs);
    // The second tap gets the original result, not a re-send.
    expect((second as any).result).toEqual({ success: true, data: { messageId: "msg_1" } });
    expect(pending()[0].status).toBe("executed");
    expect(pending()[0].approvedByUserId).toBe(USER);
    // Exactly one audit row.
    expect(sends()).toHaveLength(1);
  });

  it("a failed execution releases the claim so the human can retry (no audit row)", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const execute = vi.fn(async () => ({ success: false, error: "SES not configured" }));

    const result = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute,
    });

    expect(result.outcome).toBe("execution_failed");
    expect(pending()[0].status).toBe("pending");
    expect(sends()).toHaveLength(0);

    // Retry succeeds.
    const retry = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: async () => ({ success: true, data: { messageId: "msg_2" } }),
    });
    expect(retry.outcome).toBe("executed");
  });
});

// ── (c) Expired row refuses ─────────────────────────────────────────────────

describe("approve — expiry", () => {
  it("refuses an expired row and never calls execute", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_sms", args: { lead_id: 1, message: "hi" } });
    pending()[0].expiresAt = new Date(Date.now() - 1000);

    const execute = vi.fn();
    const result = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: execute as any,
    });

    expect(result.outcome).toBe("expired");
    expect(execute).not.toHaveBeenCalled();
    expect(pending()[0].status).toBe("expired");
    expect(sends()).toHaveLength(0);
  });
});

// ── (d) Content hash mismatch refuses ───────────────────────────────────────

describe("approve — content hash re-verification", () => {
  it("refuses when the frozen args no longer hash to the stored contentHash", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    // Tamper with the frozen args after the human "saw" them.
    pending()[0].args = { ...emailArgs, message: "Wire me $50,000." };

    const execute = vi.fn();
    const result = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: execute as any,
    });

    expect(result.outcome).toBe("hash_mismatch");
    expect(execute).not.toHaveBeenCalled();
    expect(sends()).toHaveLength(0);
  });
});

// ── (e) Cross-org approve refuses ───────────────────────────────────────────

describe("approve — org ownership", () => {
  it("another org cannot approve (or even see) the pending action", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });

    const execute = vi.fn();
    const result = await approvePendingAction({
      organizationId: OTHER_ORG,
      pendingActionId: row.id,
      approvedByUserId: "intruder",
      execute: execute as any,
    });

    expect(result.outcome).toBe("not_found");
    expect(execute).not.toHaveBeenCalled();
    expect(pending()[0].status).toBe("pending");
  });
});

// ── (f) pax_sends audit row written ─────────────────────────────────────────

describe("pax_sends — append-only audit of executed sends", () => {
  it("writes exactly one audit row binding org, action, channel, recipient, hash", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });

    await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: async () => ({ success: true, data: { messageId: "msg_1" } }),
    });

    expect(sends()).toHaveLength(1);
    const audit = sends()[0];
    expect(audit.organizationId).toBe(ORG);
    expect(audit.pendingActionId).toBe(row.id);
    expect(audit.toolName).toBe("send_email");
    expect(audit.channel).toBe("email");
    expect(audit.recipientRef).toBe("lead:42");
    expect(audit.contentHash).toBe(row.contentHash);
  });
});

// ── Reject ──────────────────────────────────────────────────────────────────

describe("reject — terminal, and an executed row can't be rejected", () => {
  it("rejects a pending action; a later approve refuses", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });

    const rejected = await rejectPendingAction({ organizationId: ORG, pendingActionId: row.id });
    expect(rejected.outcome).toBe("rejected");
    expect(pending()[0].status).toBe("rejected");

    const execute = vi.fn();
    const approveAfter = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: execute as any,
    });
    expect(approveAfter.outcome).toBe("rejected");
    expect(execute).not.toHaveBeenCalled();
  });

  it("cannot reject an executed action", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: async () => ({ success: true, data: {} }),
    });

    const result = await rejectPendingAction({ organizationId: ORG, pendingActionId: row.id });
    expect(result.outcome).toBe("already_executed");
    expect(pending()[0].status).toBe("executed");
  });
});

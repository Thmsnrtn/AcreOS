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
  /** Serializes db.transaction calls (see the mock). */
  txChain: Promise.resolve() as Promise<void>,
  broadcastToOrg: vi.fn(),
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
    origin: "origin",
    source_ref: "sourceRef",
    reason: "reason",
  };

  const scalar = (v: unknown): number | string | null =>
    v instanceof Date ? v.getTime() : (v as number | string | null);

  /** ANDed `"col" <op> ($n | now())` conditions → row predicate (the sweep and the live predicate compare against now()). */
  const matcher = (expr: unknown) => {
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(expr as any);
    const conds: Array<(row: any) => boolean> = [];
    const re = /(?:"[a-z_]+"\.)?"([a-z_]+)" (=|<>|>=|<=|>|<) (\$(\d+)|now\(\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`approvalKernel mock: unmapped column ${m[1]}`);
      const op = m[2];
      const rhsRaw: unknown = m[4] ? params[Number(m[4]) - 1] : "NOW()";
      conds.push((row) => {
        const l = scalar(row[prop]);
        const r = rhsRaw === "NOW()" ? Date.now() : scalar(rhsRaw);
        if (l === null || r === null) return false;
        switch (op) {
          case "=": return l === r;
          case "<>": return l !== r;
          case ">": return l > r;
          case ">=": return l >= r;
          case "<": return l < r;
          case "<=": return l <= r;
          default: throw new Error(`approvalKernel mock: unknown op ${op}`);
        }
      });
    }
    if (conds.length === 0) throw new Error(`approvalKernel mock: no conditions in: ${sql}`);
    const comparisons = (sql.match(/ (=|<>|>=|<=|>|<) /g) ?? []).length;
    if (comparisons !== conds.length) {
      throw new Error(`approvalKernel mock: parsed ${conds.length}/${comparisons} comparisons in: ${sql}`);
    }
    return (row: any) => conds.every((c) => c(row));
  };

  const TABLE_DEFAULTS: Record<string, Record<string, unknown>> = {
    pending_actions: {
      status: "pending",
      createdByUserId: null,
      approvedByUserId: null,
      executedAt: null,
      resultSummary: null,
      origin: null,
      sourceRef: null,
      reason: null,
    },
    pax_sends: { recipientRef: null },
  };

  const db: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: any) => ({
        where: (expr: unknown) => {
          const rows = mem.tables[getTableName(table)];
          const pred = matcher(expr);
          const result = rows.filter(pred).map((r) => ({ ...r }));
          // `count(*)::int` projection (countPendingActions behind the
          // pax.needs_you broadcast). Any other projection is unsupported.
          if (fields) {
            const keys = Object.keys(fields);
            if (keys.length !== 1 || keys[0] !== "count") {
              throw new Error(`approvalKernel mock: unsupported projection ${keys.join(",")}`);
            }
            return Promise.resolve([{ count: result.length }]);
          }
          return Object.assign(Promise.resolve(result), {
            limit: async (n: number) => result.slice(0, n),
          });
        },
      }),
    }),
    /**
     * A transaction: SERIALIZED (Postgres would block the second guarded
     * UPDATE on the first's row lock) and ROLLED BACK on throw (a snapshot of
     * every table is restored). This is what makes the double-tap race
     * below a faithful model rather than a mock that cannot lose a row.
     */
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const previous = mem.txChain;
      let release!: () => void;
      mem.txChain = new Promise<void>((r) => (release = r));
      await previous;
      const snapshot = JSON.parse(JSON.stringify(mem.tables), (_k, v) =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v) : v,
      );
      try {
        return await fn(db);
      } catch (err) {
        for (const name of Object.keys(mem.tables)) delete mem.tables[name];
        Object.assign(mem.tables, snapshot);
        throw err;
      } finally {
        release();
      }
    },
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
  wsServer: { broadcastToOrg: (...args: unknown[]) => mem.broadcastToOrg(...args) },
}));

// The tool definitions revisePendingAction validates against — imported
// lazily by the kernel, so a minimal stand-in keeps this suite off the tool
// graph. send_email's REAL parameter shape (lead_id | email, subject,
// message); support has one fix with an enum.
vi.mock("../../server/ai/tools", () => ({
  toolDefinitions: {
    send_email: {
      name: "send_email",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "number" },
          email: { type: "string" },
          subject: { type: "string" },
          message: { type: "string" },
        },
        required: ["subject", "message"],
      },
    },
    send_sms: {
      name: "send_sms",
      parameters: {
        type: "object",
        properties: { lead_id: { type: "number" }, phone_number: { type: "string" }, message: { type: "string" } },
        required: ["message"],
      },
    },
  },
}));
vi.mock("../../server/ai/supportAgent", () => ({
  supportToolDefinitions: {
    apply_billing_fix: {
      name: "apply_billing_fix",
      parameters: {
        type: "object",
        properties: {
          fix_type: { type: "string", enum: ["retry_payment", "send_update_payment_link", "cancel_pending_invoice"] },
          invoice_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["fix_type", "reason"],
      },
    },
  },
}));

import {
  APPROVAL_REQUIRED_TOOLS,
  actionContentHash,
  canonicalizeToolArgs,
  proposePendingAction,
  pendingActionArtifact,
  approvePendingAction,
  rejectPendingAction,
  revisePendingAction,
  sweepExpiredPendingActions,
} from "../../server/services/approvalKernel";

/** The frozen wave-1 contract: the one event name the badge, the strip and the queue invalidate on. */
const PAX_NEEDS_YOU_EVENT = "pax.needs_you";

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
  mem.broadcastToOrg.mockReset();
});

/** The pax.needs_you broadcasts so far, as [orgId, count]. */
const needsYou = () =>
  mem.broadcastToOrg.mock.calls
    .filter((c) => c[1] === PAX_NEEDS_YOU_EVENT)
    .map((c) => [c[0], (c[2] as { count: number }).count] as const);

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
    // Since 2026-09-02 the predicate is stance-aware: a send at every
    // stance, and every non-pause-safe tool at "Ask before everything".
    const gate = src.indexOf("kernelApprovalRequiredTools.has(toolName) ||");
    const predicate = src.indexOf("if (requiresAsk && !trustedApproval) {", gate);
    const propose = src.indexOf("proposePendingAction(", predicate);
    const firstCase = src.indexOf('case "get_leads"');
    expect(gate).toBeGreaterThan(-1);
    expect(predicate).toBeGreaterThan(gate);
    expect(propose).toBeGreaterThan(predicate);
    // The gate fires before ANY tool dispatch.
    expect(firstCase).toBeGreaterThan(propose);
    // And the dead bypass machinery is gone — the per-tool level branches too.
    expect(src.includes("__paxPendingApprovals")).toBe(false);
    expect(src.includes("getOrgAutonomyLevel")).toBe(false);
    expect(src.includes("unattendedSendPermitted")).toBe(false);
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

  it("an execution that THROWS releases the claim too — an ask must never vanish", async () => {
    // Before 2026-09-04 only a RETURNED failure released the claim. A thrown
    // one left the row in `approved`, where the queue predicate
    // (status = pending) cannot see it, the badge cannot count it and the
    // expiry sweep (pending → expired) never touches it. The ask disappeared
    // from the customer's queue permanently, with nothing sent — the worst of
    // both outcomes. A throw is the same class of event as success:false, so
    // it gets the same answer.
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const execute = vi.fn(async () => {
      throw new Error("SES client blew up");
    });

    const result = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute,
    });

    // Narrow before reading `error` — it exists only on this branch of
    // ApprovalOutcome, and a test that does not type-check can assert on a
    // field that is not there and pass forever.
    expect(result.outcome).toBe("execution_failed");
    if (result.outcome !== "execution_failed") throw new Error("unreachable");
    expect(result.error).toContain("SES client blew up");
    // Back in the queue, unclaimed, with nothing recorded as sent.
    expect(pending()[0].status).toBe("pending");
    expect(pending()[0].approvedByUserId).toBeNull();
    expect(sends()).toHaveLength(0);

    // And it is answerable again: the human retries and it goes.
    const retry = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: vi.fn(async () => ({ success: true, data: { id: "msg_1" } })),
    });
    expect(retry.outcome).toBe("executed");
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

// ── origin / sourceRef / reason are frozen with the row ─────────────────────

describe("propose — the ask says where it came from (migration 0250 columns)", () => {
  it("stores origin, sourceRef and reason; an empty reason is null, never an invented sentence", async () => {
    const row = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      args: emailArgs,
      createdByUserId: USER,
      origin: "scheduled",
      sourceRef: { leadId: 42, scheduledTaskId: 3, scheduledTaskName: "Monday lead pull" },
      reason: "Bill went quiet 9 days ago",
    });
    expect(row.origin).toBe("scheduled");
    expect(row.sourceRef).toEqual({ leadId: 42, scheduledTaskId: 3, scheduledTaskName: "Monday lead pull" });
    expect(row.reason).toBe("Bill went quiet 9 days ago");

    const bare = await proposePendingAction({ organizationId: ORG, toolName: "send_sms", args: { lead_id: 1, message: "hi" }, reason: "" });
    expect(bare.origin).toBeNull();
    expect(bare.sourceRef).toBeNull();
    expect(bare.reason).toBeNull();
  });
});

// ── pax.needs_you — the live count, on every transition ─────────────────────

describe("pax.needs_you — every transition publishes the org's live count", () => {
  it("propose publishes { count } for a NEW row (alongside pending_action.created), not for a reused duplicate", async () => {
    await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    expect(needsYou()).toEqual([[ORG, 1]]);
    // The wave-0 id event is kept.
    expect(mem.broadcastToOrg.mock.calls.some((c) => c[1] === "pending_action.created")).toBe(true);

    await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    expect(needsYou()).toEqual([[ORG, 1]]);

    await proposePendingAction({ organizationId: ORG, toolName: "send_sms", args: { lead_id: 1, message: "hi" } });
    expect(needsYou()).toEqual([[ORG, 1], [ORG, 2]]);
  });

  it("approve (executed) publishes the count after the row left the queue", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    mem.broadcastToOrg.mockReset();
    await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: async () => ({ success: true, data: {} }),
    });
    expect(needsYou()).toEqual([[ORG, 0]]);
  });

  it("approve on a stale row (lazy expire) publishes the count", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    pending()[0].expiresAt = new Date(Date.now() - 1000);
    mem.broadcastToOrg.mockReset();
    const result = await approvePendingAction({
      organizationId: ORG,
      pendingActionId: row.id,
      approvedByUserId: USER,
      execute: async () => ({ success: true, data: {} }),
    });
    expect(result.outcome).toBe("expired");
    expect(needsYou()).toEqual([[ORG, 0]]);
  });

  it("reject publishes the count when a row actually moved, and stays quiet when nothing did", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    mem.broadcastToOrg.mockReset();
    await rejectPendingAction({ organizationId: ORG, pendingActionId: row.id });
    expect(needsYou()).toEqual([[ORG, 0]]);
    mem.broadcastToOrg.mockReset();
    await rejectPendingAction({ organizationId: ORG, pendingActionId: row.id });
    expect(needsYou()).toEqual([]);
  });

  it("the sweep publishes once per org it touched — and never for an org it did not", async () => {
    const a = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const b = await proposePendingAction({ organizationId: OTHER_ORG, toolName: "send_email", args: emailArgs });
    await proposePendingAction({ organizationId: 555, toolName: "send_email", args: emailArgs });
    pending().find((r) => r.id === a.id)!.expiresAt = new Date(Date.now() - 1000);
    pending().find((r) => r.id === b.id)!.expiresAt = new Date(Date.now() - 1000);
    mem.broadcastToOrg.mockReset();
    expect(await sweepExpiredPendingActions()).toBe(2);
    const orgs = needsYou().map(([o]) => o).sort();
    expect(orgs).toEqual([ORG, OTHER_ORG]);
    expect(needsYou().every(([, c]) => c === 0)).toBe(true);
  });

  it("a throwing broadcast never fails the transition", async () => {
    mem.broadcastToOrg.mockImplementation(() => {
      throw new Error("ws down");
    });
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    expect(row.status).toBe("pending");
    const result = await rejectPendingAction({ organizationId: ORG, pendingActionId: row.id });
    expect(result.outcome).toBe("rejected");
  });
});

// ── Revise (Edit on the ask card) ───────────────────────────────────────────

describe("revise — the human's edit becomes a new frozen row, atomically", () => {
  const revised = { lead_id: 42, subject: "Following up (edited)", message: "Hi there — edited." };

  it("rejects the old row (pointing at the new id) and inserts the revised row created by the human, origin 'revised', new hash, live expiry", async () => {
    const old = await proposePendingAction({
      organizationId: ORG,
      toolName: "send_email",
      args: emailArgs,
      origin: "chat",
      sourceRef: { leadId: 42 },
      reason: "Bill went quiet",
    });
    mem.broadcastToOrg.mockReset();

    const result = await revisePendingAction({ organizationId: ORG, pendingActionId: old.id, userId: USER, args: revised });
    expect(result).toEqual({ ok: true, newId: expect.any(Number) });
    const newId = (result as { ok: true; newId: number }).newId;

    const oldRow = pending().find((r) => r.id === old.id)!;
    expect(oldRow.status).toBe("rejected");
    expect(oldRow.resultSummary).toEqual({ revisedTo: newId });

    const newRow = pending().find((r) => r.id === newId)!;
    expect(newRow.status).toBe("pending");
    expect(newRow.toolName).toBe("send_email");
    expect(newRow.args).toEqual(revised);
    expect(newRow.contentHash).toBe(actionContentHash("send_email", revised));
    expect(newRow.contentHash).not.toBe(old.contentHash);
    expect(newRow.createdByUserId).toBe(USER);
    expect(newRow.origin).toBe("revised");
    expect(newRow.sourceRef).toEqual({ leadId: 42 });
    expect(newRow.reason).toBe("Bill went quiet");
    expect(newRow.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(pending()).toHaveLength(2);
    // The count is republished (one out, one in).
    expect(needsYou()).toEqual([[ORG, 1]]);
  });

  it("the revised row approves and executes exactly once, through the kernel like any other ask", async () => {
    const old = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const { newId } = (await revisePendingAction({ organizationId: ORG, pendingActionId: old.id, userId: USER, args: revised })) as { ok: true; newId: number };
    const execute = vi.fn(async () => ({ success: true, data: { messageId: "m_rev" } }));
    const first = await approvePendingAction({ organizationId: ORG, pendingActionId: newId, approvedByUserId: USER, execute });
    const second = await approvePendingAction({ organizationId: ORG, pendingActionId: newId, approvedByUserId: USER, execute });
    expect(first.outcome).toBe("executed");
    expect(second.outcome).toBe("already_executed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("send_email", revised);
    // The OLD row can never execute.
    const stale = await approvePendingAction({ organizationId: ORG, pendingActionId: old.id, approvedByUserId: USER, execute });
    expect(stale.outcome).toBe("rejected");
    expect(sends()).toHaveLength(1);
  });

  it("validates against the tool's own definition — an unknown key, a missing required key, a wrong enum value are refused, nothing changes", async () => {
    const old = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const before = JSON.stringify(pending());
    const cases: Array<Record<string, unknown>> = [
      { ...revised, cc: "boss@example.com" }, // undeclared key (strict)
      { lead_id: 42, subject: "no message" }, // missing required
      { ...revised, lead_id: "forty-two" }, // wrong type
    ];
    for (const args of cases) {
      const r = await revisePendingAction({ organizationId: ORG, pendingActionId: old.id, userId: USER, args });
      expect(r.ok).toBe(false);
      expect((r as { ok: false; reason: string }).reason).toBe("invalid_args");
    }
    expect(JSON.stringify(pending())).toBe(before);

    const fix = await proposePendingAction({ organizationId: ORG, toolName: "apply_billing_fix", args: { fix_type: "retry_payment", reason: "r" } });
    const bad = await revisePendingAction({ organizationId: ORG, pendingActionId: fix.id, userId: USER, args: { fix_type: "apply_credit", reason: "r" } });
    expect(bad).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(pending().find((r) => r.id === fix.id)!.status).toBe("pending");
  });

  it("another org's id is not_found; an executed, rejected or expired row is not_pending", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    expect(await revisePendingAction({ organizationId: OTHER_ORG, pendingActionId: row.id, userId: "intruder", args: revised })).toEqual({ ok: false, reason: "not_found" });
    expect(pending()).toHaveLength(1);

    await rejectPendingAction({ organizationId: ORG, pendingActionId: row.id });
    expect(await revisePendingAction({ organizationId: ORG, pendingActionId: row.id, userId: USER, args: revised })).toEqual({ ok: false, reason: "not_pending" });

    const stale = await proposePendingAction({ organizationId: ORG, toolName: "send_sms", args: { lead_id: 1, message: "hi" } });
    pending().find((r) => r.id === stale.id)!.expiresAt = new Date(Date.now() - 1000);
    expect(await revisePendingAction({ organizationId: ORG, pendingActionId: stale.id, userId: USER, args: { lead_id: 1, message: "later" } })).toEqual({ ok: false, reason: "not_pending" });
    expect(pending()).toHaveLength(2);
  });

  it("a double tap yields ONE revised row — the loser's insert rolls back with its failed claim", async () => {
    const old = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args: emailArgs });
    const [a, b] = await Promise.all([
      revisePendingAction({ organizationId: ORG, pendingActionId: old.id, userId: USER, args: revised }),
      revisePendingAction({ organizationId: ORG, pendingActionId: old.id, userId: USER, args: { ...revised, subject: "second tap" } }),
    ]);
    const outcomes = [a, b].map((r) => r.ok).sort();
    expect(outcomes).toEqual([false, true]);
    const loser = [a, b].find((r) => !r.ok) as { ok: false; reason: string };
    expect(loser.reason).toBe("not_pending");
    // Exactly one new pending row, and the old row points at it.
    const live = pending().filter((r) => r.status === "pending");
    expect(live).toHaveLength(1);
    const winner = [a, b].find((r) => r.ok) as { ok: true; newId: number };
    expect(live[0].id).toBe(winner.newId);
    expect(pending().find((r) => r.id === old.id)!.resultSummary).toEqual({ revisedTo: winner.newId });
    expect(pending()).toHaveLength(2);
  });
});

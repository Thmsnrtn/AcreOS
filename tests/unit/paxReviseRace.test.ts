/**
 * Edit → revise, through the ROUTE, against the REAL kernel
 * (AUTONOMY_SPEC.md §4.5, §7 — the rewrite of paxDraftApproval.test.ts).
 *
 * paxDraftApproval pinned the T0-6 draft-bound approve-and-send: the thing
 * the human approved is the thing that sends, and a double tap sends once.
 * That lane (paxDraftService + pax_drafts + POST /first-follow-up/
 * approve-and-send) is deleted — one kernel only — so the SAME invariants
 * are pinned here on the kernel's Edit path:
 *
 *   - POST /api/pax/pending-actions/:id/revise validates the human's args
 *     against the tool's OWN definition (422 otherwise; no row written),
 *     then in ONE transaction claims the old row pending→rejected (guarded
 *     `WHERE status = 'pending'`, resultSummary { revisedTo }) and inserts
 *     the revised row (created by the human, origin "revised", a NEW content
 *     hash bound to exactly the edited args, a live expiry).
 *   - a double tap on Edit yields ONE revised row: the loser's transaction
 *     rolls back and answers 409; a double tap on Approve of the revised row
 *     sends ONCE (the kernel's guarded pending→approved claim).
 *   - the approval is hash-bound: args altered under the human's feet after
 *     the edit are refused on approve (nothing sends).
 *   - another org's id is 404 from every id-addressed route.
 *
 * Mutation probe (must go RED): in server/services/approvalKernel.ts
 * revisePendingAction, drop `eq(pendingActions.status, "pending")` from the
 * transaction's guarded UPDATE — the double-tap test then finds two revised
 * rows.
 *
 * The db mock is the approvalKernel.test.ts one: an in-memory
 * pending_actions + pax_sends with drizzle expressions rendered to SQL and
 * interpreted, plus a transaction that is SERIALIZED (Postgres would block
 * the second guarded UPDATE on the first's row lock) and ROLLED BACK on
 * throw — the property the race tests need a faithful model of.
 *
 * idempotent: true — db + websocket + rails fully mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mem = vi.hoisted(() => ({
  tables: { pending_actions: [] as any[], pax_sends: [] as any[] } as Record<string, any[]>,
  nextId: 1,
  txChain: Promise.resolve() as Promise<void>,
  /**
   * Race barrier: when > 0, no transaction RUNS until this many have been
   * REQUESTED. Both taps then pass the kernel's pre-read ("is it still
   * pending?") before either claims — the interleaving a real double tap
   * produces, and the one only the guarded UPDATE can survive.
   */
  txBarrier: 0,
  txArrivals: 0,
  txWaiters: [] as Array<() => void>,
  selects: [] as Array<{ sql: string; params: unknown[] }>,
  broadcastToOrg: vi.fn(),
  executeApprovedAsk: vi.fn(),
}));

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { getTableName } = await import("drizzle-orm");
  const dialect = new PgDialect();

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
    origin: "origin",
    source_ref: "sourceRef",
    reason: "reason",
    created_at: "createdAt",
    pending_action_id: "pendingActionId",
    channel: "channel",
    recipient_ref: "recipientRef",
    sent_at: "sentAt",
  };

  const render = (expr: unknown) => dialect.sqlToQuery(expr as any);
  /** Dates compare as ms; a timestamp param drizzle mapped to its ISO string compares the same way. */
  const scalar = (v: unknown): number | string | null => {
    if (v instanceof Date) return v.getTime();
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return Date.parse(v);
    return v as number | string | null;
  };

  const matcher = (expr: unknown) => {
    const { sql, params } = render(expr);
    const conds: Array<(row: any) => boolean> = [];
    const re = /(?:"[a-z_]+"\.)?"([a-z_]+)" (=|<>|>=|<=|>|<) (\$(\d+)|now\(\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxReviseRace mock: unmapped column ${m[1]}`);
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
          default: throw new Error(`paxReviseRace mock: unknown op ${op}`);
        }
      });
    }
    const reIn = /(?:"[a-z_]+"\.)?"([a-z_]+)" in \(((?:\$\d+(?:, )?)+)\)/g;
    while ((m = reIn.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxReviseRace mock: unmapped column ${m[1]}`);
      const values = m[2].split(", ").map((p) => scalar(params[Number(p.slice(1)) - 1]));
      conds.push((row) => values.includes(scalar(row[prop])));
    }
    if (conds.length === 0) throw new Error(`paxReviseRace mock: no conditions in: ${sql}`);
    const comparisons =
      (sql.match(/ (=|<>|>=|<=|>|<) /g) ?? []).length + (sql.match(/" in \(/g) ?? []).length;
    if (comparisons !== conds.length) {
      throw new Error(`paxReviseRace mock: parsed ${conds.length}/${comparisons} comparisons in: ${sql}`);
    }
    return { pred: (row: any) => conds.every((c) => c(row)), sql, params };
  };

  const orderer = (exprs: unknown[]) => {
    const keys = exprs.map((expr) => {
      const { sql } = render(expr);
      const m = /^(?:"[a-z_]+"\.)?"([a-z_]+)" (asc|desc)$/.exec(sql.trim());
      if (!m) throw new Error(`paxReviseRace mock: unsupported ORDER BY: ${sql}`);
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxReviseRace mock: unmapped ORDER BY column ${m[1]}`);
      return { prop, sign: m[2] === "desc" ? -1 : 1 };
    });
    return (a: any, b: any) => {
      for (const k of keys) {
        const d = (scalar(a[k.prop]) as number) - (scalar(b[k.prop]) as number);
        if (d !== 0) return k.sign * d;
      }
      return 0;
    };
  };

  const stage = (rows: any[]): any =>
    Object.assign(Promise.resolve(rows), {
      orderBy: (...exprs: unknown[]) => stage([...rows].sort(orderer(exprs))),
      limit: async (n: number) => rows.slice(0, n),
    });

  const project = (fields: Record<string, unknown>, rows: any[]) => {
    const keys = Object.keys(fields);
    const rendered = keys.map((k) => {
      const f = fields[k] as { name?: string; queryChunks?: unknown };
      // A bare column (`{ sourceRef: pendingActions.sourceRef }`) is not an
      // SQL chunk; its column name is the projection.
      return typeof f?.name === "string" && !f.queryChunks ? `"${f.name}"` : render(f).sql;
    });
    if (keys.length === 1 && /^count\(\*\)/.test(rendered[0])) return [{ [keys[0]]: rows.length }];
    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      keys.forEach((k, i) => {
        const m = /"([a-z_]+)"$/.exec(rendered[i]);
        const prop = m ? COLUMN_TO_PROP[m[1]] : undefined;
        if (!prop) throw new Error(`paxReviseRace mock: unsupported projection ${rendered[i]}`);
        out[k] = row[prop];
      });
      return out;
    });
  };

  const table = (t: any) => {
    const name = getTableName(t);
    const rows = mem.tables[name];
    if (!rows) throw new Error(`paxReviseRace mock: unexpected table ${name}`);
    return { name, rows };
  };

  const db: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (t: any) => ({
        where: (expr: unknown) => {
          if (getTableName(t) === "connected_mailboxes") return stage([]);
          const { name, rows } = table(t);
          const { pred, sql, params } = matcher(expr);
          if (name === "pending_actions") mem.selects.push({ sql, params });
          const matched = rows.filter(pred).map((r) => ({ ...r }));
          return stage(fields ? project(fields, matched) : matched);
        },
      }),
    }),
    insert: (t: any) => ({
      values: (vals: any) => {
        const { name, rows } = table(t);
        let inserted: any[] | null = null;
        const run = () => {
          if (inserted) return inserted;
          const defaults =
            name === "pending_actions"
              ? {
                  status: "pending",
                  createdByUserId: null,
                  approvedByUserId: null,
                  executedAt: null,
                  resultSummary: null,
                  origin: null,
                  sourceRef: null,
                  reason: null,
                  createdAt: new Date(),
                }
              : { sentAt: new Date() };
          const row = { ...defaults, ...vals, id: mem.nextId++ };
          rows.push(row);
          inserted = [{ ...row }];
          return inserted;
        };
        return Object.assign(Promise.resolve().then(run), { returning: async () => run() });
      },
    }),
    update: (t: any) => ({
      set: (vals: any) => ({
        where: (expr: unknown) => {
          const { rows } = table(t);
          const { pred } = matcher(expr);
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
          return Object.assign(Promise.resolve().then(apply), { returning: async () => apply() });
        },
      }),
    }),
    /**
     * SERIALIZED (a row lock would block the second guarded UPDATE) and
     * ROLLED BACK on throw (every table restored from a snapshot).
     */
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      if (mem.txBarrier > 0) {
        mem.txArrivals++;
        if (mem.txArrivals < mem.txBarrier) await new Promise<void>((r) => mem.txWaiters.push(r));
        else for (const release of mem.txWaiters.splice(0)) release();
      }
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
  };
  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/websocket", () => ({
  wsServer: { broadcastToOrg: (...args: unknown[]) => mem.broadcastToOrg(...args) },
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
// The tool definition revisePendingAction validates against (send_email's
// REAL parameter shape: lead_id | email, subject, message).
vi.mock("../../server/ai/tools", () => ({
  executeTool: vi.fn(),
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
  },
}));
vi.mock("../../server/ai/supportAgent", () => ({ executeSupportTool: vi.fn(), supportToolDefinitions: {} }));
vi.mock("../../server/services/paxAskExecutors", () => ({
  executeApprovedAsk: (...args: unknown[]) => mem.executeApprovedAsk(...args),
}));
vi.mock("../../server/services/paxControls", () => ({
  getPaxControls: vi.fn(async () => ({
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    timezone: "UTC",
  })),
  paxControlsRefusalMessage: () => "",
}));
vi.mock("../../server/services/byok/key-vault", () => ({ listByokCredentials: vi.fn(async () => []) }));
// The approve path's fire-and-forget extras (proof receipt, activation) —
// dynamically imported inside try/catch; stubbed so the suite stays off them.
vi.mock("../../server/services/autopilot/proofReceiptStore", () => ({ recordReceipt: vi.fn() }));
vi.mock("../../server/services/autopilot/tenantScope", () => ({ orgScope: (id: number) => `org:${id}` }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));

import { actionContentHash } from "../../server/services/approvalKernel";
import paxInsightsRouter from "../../server/routes-pax-insights";

const ORG = 7;
const OTHER_ORG = 999;
const USER = "user_tap";
const HOUR = 60 * 60 * 1000;

function appForOrg(organizationId: number, userId = USER) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.organization = { id: organizationId, settings: {}, onboardingData: {} };
    req.user = { id: userId };
    next();
  });
  app.use("/api/pax", paxInsightsRouter);
  return app;
}

const original = { lead_id: 42, subject: "Following up", message: "Hi there." };
const edited = { lead_id: 42, subject: "Following up (edited)", message: "Hi there — edited." };

function seedAsk(overrides: Partial<Record<string, unknown>> = {}) {
  const id = mem.nextId++;
  const args = (overrides.args as Record<string, unknown>) ?? original;
  const row = {
    id,
    organizationId: ORG,
    toolName: "send_email",
    args,
    contentHash: actionContentHash("send_email", args),
    status: "pending",
    expiresAt: new Date(Date.now() + 24 * HOUR),
    createdByUserId: null,
    approvedByUserId: null,
    executedAt: null,
    resultSummary: null,
    origin: "chat",
    sourceRef: { leadId: 42 },
    reason: "The seller asked for a written follow-up.",
    createdAt: new Date(),
    ...overrides,
  };
  mem.tables.pending_actions.push(row);
  return row;
}

const rows = () => mem.tables.pending_actions;
const byId = (id: number) => rows().find((r) => r.id === id)!;

beforeEach(() => {
  mem.tables.pending_actions = [];
  mem.tables.pax_sends = [];
  mem.nextId = 1;
  mem.selects = [];
  mem.txChain = Promise.resolve();
  mem.txBarrier = 0;
  mem.txArrivals = 0;
  mem.txWaiters = [];
  mem.broadcastToOrg.mockReset();
  mem.executeApprovedAsk.mockReset();
  mem.executeApprovedAsk.mockResolvedValue({ success: true, data: { messageId: "m-1" }, executor: "executeTool" });
});

describe("POST /api/pax/pending-actions/:id/revise — the human's edit becomes a new frozen row", () => {
  it("rejects the old row (pointing at the new id) and inserts the revised row: created by the human, origin 'revised', new hash, live expiry, source and reason carried", async () => {
    const old = seedAsk();
    const before = Date.now();

    const res = await request(appForOrg(ORG)).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args: edited });

    expect(res.status).toBe(200);
    const newId = res.body.id as number;
    expect(newId).not.toBe(old.id);
    expect(rows()).toHaveLength(2);

    const oldRow = byId(old.id);
    expect(oldRow.status).toBe("rejected");
    expect(oldRow.resultSummary).toEqual({ revisedTo: newId });
    expect(oldRow.args).toEqual(original); // the frozen original is never edited in place

    const newRow = byId(newId);
    expect(newRow.status).toBe("pending");
    expect(newRow.args).toEqual(edited);
    expect(newRow.contentHash).toBe(actionContentHash("send_email", edited));
    expect(newRow.contentHash).not.toBe(old.contentHash);
    expect(newRow.createdByUserId).toBe(USER);
    expect(newRow.origin).toBe("revised");
    expect(newRow.sourceRef).toEqual({ leadId: 42 });
    expect(newRow.reason).toBe(old.reason);
    expect(newRow.expiresAt.getTime()).toBeGreaterThan(before + 23 * HOUR);

    // The queue count moved (old row left, new row arrived): the badge is told.
    expect(mem.broadcastToOrg).toHaveBeenCalledWith(ORG, "pax.needs_you", { count: 1 });
  });

  it("a double tap yields ONE revised row: the loser's transaction rolls back and answers 409", async () => {
    const old = seedAsk();
    const app = appForOrg(ORG);
    // Both taps read "still pending" before either transaction claims.
    mem.txBarrier = 2;

    const [a, b] = await Promise.all([
      request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args: edited }),
      request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args: { ...edited, subject: "second tap" } }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    expect(rows()).toHaveLength(2); // old + exactly one revised row
    expect(rows().filter((r) => r.status === "pending")).toHaveLength(1);
    expect(byId(old.id).status).toBe("rejected");
    expect(byId(old.id).resultSummary).toEqual({ revisedTo: winner.body.id });
    expect(byId(winner.body.id).status).toBe("pending");
  });

  it("a double tap on Approve of the revised row sends ONCE, through the executor, with one pax_sends row", async () => {
    const old = seedAsk();
    const app = appForOrg(ORG);
    const revised = await request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args: edited });
    expect(revised.status).toBe(200);
    const newId = revised.body.id as number;

    const [a, b] = await Promise.all([
      request(app).post(`/api/pax/pending-actions/${newId}/approve`),
      request(app).post(`/api/pax/pending-actions/${newId}/approve`),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    const executedCount = [a.body, b.body].filter((body) => body.executed === true && !body.alreadyExecuted).length;
    const otherOutcomes = [a.body, b.body].filter((body) => body.inFlight === true || body.alreadyExecuted === true).length;
    expect(executedCount).toBe(1);
    expect(otherOutcomes).toBe(1);
    expect(mem.executeApprovedAsk).toHaveBeenCalledTimes(1);
    // It ran EXACTLY the revised args, with the human's tap as the trusted approval.
    expect(mem.executeApprovedAsk).toHaveBeenCalledWith(
      "send_email",
      edited,
      expect.objectContaining({ userId: USER, pendingActionId: newId, sourceRef: { leadId: 42 } }),
    );
    expect(mem.tables.pax_sends).toHaveLength(1);
    expect(mem.tables.pax_sends[0]).toMatchObject({ organizationId: ORG, pendingActionId: newId, channel: "email" });
    expect(byId(newId).status).toBe("executed");
    // The original was rejected by the edit and can never send.
    expect(byId(old.id).status).toBe("rejected");
  });

  it("is hash-bound: args altered after the edit are refused on approve and nothing sends", async () => {
    const old = seedAsk();
    const app = appForOrg(ORG);
    const revised = await request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args: edited });
    const newId = revised.body.id as number;

    // Something rewrites the frozen args under the human's feet.
    byId(newId).args = { ...edited, message: "Wire the money to this account." };

    const res = await request(app).post(`/api/pax/pending-actions/${newId}/approve`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/integrity/i);
    expect(mem.executeApprovedAsk).not.toHaveBeenCalled();
    expect(mem.tables.pax_sends).toHaveLength(0);
    expect(byId(newId).status).toBe("pending");
  });

  it("refuses an edit the tool's own definition rejects (422) and writes nothing", async () => {
    const old = seedAsk();
    const app = appForOrg(ORG);

    for (const args of [
      { ...edited, cc: "boss@example.com" }, // undeclared key (strict)
      { lead_id: 42, subject: "no message" }, // required key missing
      { ...edited, lead_id: "forty-two" }, // wrong type
    ]) {
      const res = await request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args });
      expect(res.status, JSON.stringify(args)).toBe(422);
    }
    // A body without `args`, or with extra keys, is 422 too.
    expect((await request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({})).status).toBe(422);
    expect((await request(app).post(`/api/pax/pending-actions/${old.id}/revise`).send({ args: edited, status: "approved" })).status).toBe(422);

    expect(rows()).toHaveLength(1);
    expect(byId(old.id).status).toBe("pending");
  });

  it("another org's id is 404 from revise, approve and reject — and nothing changes", async () => {
    const mine = seedAsk();
    const intruder = request(appForOrg(OTHER_ORG, "intruder"));

    expect((await intruder.post(`/api/pax/pending-actions/${mine.id}/revise`).send({ args: edited })).status).toBe(404);
    expect((await intruder.post(`/api/pax/pending-actions/${mine.id}/approve`)).status).toBe(404);
    expect((await intruder.post(`/api/pax/pending-actions/${mine.id}/reject`)).status).toBe(404);
    expect((await intruder.post(`/api/pax/pending-actions/${mine.id + 500}/revise`).send({ args: edited })).status).toBe(404);

    expect(rows()).toHaveLength(1);
    expect(byId(mine.id).status).toBe("pending");
    expect(mem.executeApprovedAsk).not.toHaveBeenCalled();
    // Every pending_actions read the intruder caused was bound to THEIR org.
    for (const s of mem.selects) {
      expect(s.params).toContain(OTHER_ORG);
      expect(s.params).not.toContain(ORG);
    }
  });

  it("an ask that is no longer waiting (rejected, executed, expired) is 409 — never re-opened", async () => {
    const app = appForOrg(ORG);
    const rejected = seedAsk({ status: "rejected" });
    const executed = seedAsk({ status: "executed" });
    const stale = seedAsk({ expiresAt: new Date(Date.now() - HOUR) });

    for (const row of [rejected, executed, stale]) {
      const res = await request(app).post(`/api/pax/pending-actions/${row.id}/revise`).send({ args: edited });
      expect(res.status, row.status).toBe(409);
    }
    expect(rows()).toHaveLength(3);
  });
});

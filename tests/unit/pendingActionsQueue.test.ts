/**
 * Review-queue plumbing for customer pending approvals (autonomy clarity
 * program, 2026-09-02).
 *
 * The approval kernel freezes every approval-required tool call as a
 * pending_actions row; until now the ONLY way to see those rows was the chat
 * card that proposed them. This pins the plumbing that lets a door badge and
 * a queue card see them:
 *
 *   - listPendingActions / countPendingActions apply the LIVE predicate
 *     (org + status='pending' + expires_at > now()) — expiry is written lazily,
 *     so `status` alone over-counts, and a row from another org must never
 *     appear;
 *   - sweepExpiredPendingActions flips ONLY expired pendings and is idempotent
 *     (the guarded UPDATE finds nothing on a re-run);
 *   - proposePendingAction publishes `pending_action.created` to the org's
 *     WebSocket channel for a genuinely new row, never for a reused duplicate,
 *     and a WS failure never fails the proposal;
 *   - GET /api/pax/pending-actions and /count are org-scoped: the mocked
 *     req.organization.id must reach the WHERE clause (asserted on the
 *     rendered SQL + params, not only on the filtered result).
 *
 * The db mock follows tests/unit/approvalKernel.test.ts: an in-memory table
 * with drizzle WHERE / ORDER BY expressions rendered to SQL via PgDialect and
 * interpreted — extended here to understand `> now()` / `<= now()`, ORDER BY,
 * LIMIT and a `count(*)` projection. Every parser throws on a shape it does
 * not recognise (vacuity guard): a predicate the mock silently dropped would
 * read exactly like a predicate that is present.
 *
 * idempotent: true — db + websocket fully mocked; no network, no Postgres.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ── In-memory pending_actions + rendered-query capture ──────────────────────

const mem = vi.hoisted(() => ({
  rows: [] as any[],
  nextId: 1,
  /** The most recent SELECT's rendered WHERE — the org-scoping pin reads this. */
  lastSelect: null as null | { sql: string; params: unknown[] },
  broadcastToOrg: vi.fn(),
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
    created_at: "createdAt",
  };

  const render = (expr: unknown) => dialect.sqlToQuery(expr as any);

  const assertTable = (table: any) => {
    const name = getTableName(table);
    if (name !== "pending_actions") throw new Error(`pendingActionsQueue mock: unexpected table ${name}`);
  };

  const scalar = (v: unknown): number | string | null =>
    v instanceof Date ? v.getTime() : (v as number | string | null);

  /** ANDed `"col" <op> ($n | now())` conditions → row predicate. */
  const matcher = (expr: unknown) => {
    const { sql, params } = render(expr);
    const conds: Array<(row: any) => boolean> = [];
    const re = /(?:"[a-z_]+"\.)?"([a-z_]+)" (=|<>|>=|<=|>|<) (\$(\d+)|now\(\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`pendingActionsQueue mock: unmapped column ${m[1]}`);
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
          default: throw new Error(`pendingActionsQueue mock: unknown op ${op}`);
        }
      });
    }
    if (conds.length === 0) throw new Error(`pendingActionsQueue mock: no conditions in: ${sql}`);
    // Every comparison in the rendered SQL must have been understood; a
    // clause the regex skipped would silently widen the query.
    const comparisons = (sql.match(/ (=|<>|>=|<=|>|<) /g) ?? []).length;
    if (comparisons !== conds.length) {
      throw new Error(`pendingActionsQueue mock: parsed ${conds.length}/${comparisons} comparisons in: ${sql}`);
    }
    return { pred: (row: any) => conds.every((c) => c(row)), sql, params };
  };

  const orderer = (expr: unknown) => {
    const { sql } = render(expr);
    const m = /^(?:"[a-z_]+"\.)?"([a-z_]+)" (asc|desc)$/.exec(sql.trim());
    if (!m) throw new Error(`pendingActionsQueue mock: unsupported ORDER BY: ${sql}`);
    const prop = COLUMN_TO_PROP[m[1]];
    if (!prop) throw new Error(`pendingActionsQueue mock: unmapped ORDER BY column ${m[1]}`);
    const sign = m[2] === "desc" ? -1 : 1;
    return (a: any, b: any) => sign * ((scalar(a[prop]) as number) - (scalar(b[prop]) as number));
  };

  const stage = (rows: any[]): any =>
    Object.assign(Promise.resolve(rows), {
      orderBy: (expr: unknown) => stage([...rows].sort(orderer(expr))),
      limit: async (n: number) => rows.slice(0, n),
    });

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: any) => ({
        where: (expr: unknown) => {
          assertTable(table);
          const { pred, sql, params } = matcher(expr);
          mem.lastSelect = { sql, params };
          const matched = mem.rows.filter(pred).map((r) => ({ ...r }));
          if (fields) {
            // Projection: only `count(*)` is used by the module under test.
            const keys = Object.keys(fields);
            const rendered = keys.map((k) => render(fields[k]).sql);
            if (keys.length !== 1 || !/^count\(\*\)/.test(rendered[0])) {
              throw new Error(`pendingActionsQueue mock: unsupported projection ${rendered.join(", ")}`);
            }
            return Promise.resolve([{ [keys[0]]: matched.length }]);
          }
          return stage(matched);
        },
      }),
    }),
    insert: (table: any) => ({
      values: (vals: any) => {
        assertTable(table);
        let inserted: any[] | null = null;
        const run = () => {
          if (inserted) return inserted;
          const row = {
            status: "pending",
            createdByUserId: null,
            approvedByUserId: null,
            executedAt: null,
            resultSummary: null,
            createdAt: new Date(),
            ...vals,
            id: mem.nextId++,
          };
          mem.rows.push(row);
          inserted = [{ ...row }];
          return inserted;
        };
        return Object.assign(Promise.resolve().then(run), { returning: async () => run() });
      },
    }),
    update: (table: any) => ({
      set: (vals: any) => ({
        where: (expr: unknown) => {
          assertTable(table);
          const { pred } = matcher(expr);
          let applied: any[] | null = null;
          const apply = () => {
            if (applied) return applied;
            applied = [];
            for (const row of mem.rows) {
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
  };
  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/websocket", () => ({
  wsServer: { broadcastToOrg: (...args: unknown[]) => mem.broadcastToOrg(...args) },
}));

// routes-pax-insights.ts pulls in the whole Pax service graph at module load;
// none of it is exercised by the two review-queue reads. Stubbed to keep this
// suite hermetic — the kernel itself is REAL and runs against the mock db.
vi.mock("../../server/storage", () => ({ db: {}, storage: {} }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/ai/tools", () => ({ executeTool: vi.fn() }));
vi.mock("../../server/services/autonomyGuardrails", () => ({ getOrgAutonomyLevel: vi.fn() }));
vi.mock("../../server/services/paxDraftService", () => ({
  upsertPendingDraft: vi.fn(),
  claimDraftForSend: vi.fn(),
  recordDraftSendResult: vi.fn(),
}));

import {
  listPendingActions,
  countPendingActions,
  sweepExpiredPendingActions,
  proposePendingAction,
} from "../../server/services/approvalKernel";
import paxInsightsRouter from "../../server/routes-pax-insights";

const ORG = 7;
const OTHER_ORG = 999;
const HOUR = 60 * 60 * 1000;

type Seed = Partial<{
  toolName: string;
  args: Record<string, unknown>;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}> & { organizationId: number };

/** Insert a row directly (bypassing the kernel) with a live 24h TTL by default. */
function seed(s: Seed) {
  const id = mem.nextId++;
  const row = {
    id,
    organizationId: s.organizationId,
    toolName: s.toolName ?? "send_email",
    args: s.args ?? { lead_id: id, subject: "Following up", message: "Hi." },
    contentHash: `hash-${id}`,
    status: s.status ?? "pending",
    expiresAt: s.expiresAt ?? new Date(Date.now() + 24 * HOUR),
    createdByUserId: null,
    approvedByUserId: null,
    executedAt: null,
    resultSummary: null,
    createdAt: s.createdAt ?? new Date(Date.now() - id * 1000),
  };
  mem.rows.push(row);
  return row;
}

const past = (ms = HOUR) => new Date(Date.now() - ms);
const future = (ms = HOUR) => new Date(Date.now() + ms);

beforeEach(() => {
  mem.rows = [];
  mem.nextId = 1;
  mem.lastSelect = null;
  mem.broadcastToOrg.mockReset();
});

// ── list / count ────────────────────────────────────────────────────────────

describe("listPendingActions — the live predicate", () => {
  it("returns only this org's pending, unexpired rows, newest first", async () => {
    const older = seed({ organizationId: ORG, createdAt: past(3 * HOUR) });
    const newest = seed({ organizationId: ORG, createdAt: past(1 * HOUR) });
    const middle = seed({ organizationId: ORG, createdAt: past(2 * HOUR) });
    // Excluded: expired-but-still-'pending' (lazy expiry), every terminal
    // status, and another tenant's live row.
    seed({ organizationId: ORG, expiresAt: past() });
    seed({ organizationId: ORG, status: "expired", expiresAt: past() });
    seed({ organizationId: ORG, status: "rejected" });
    seed({ organizationId: ORG, status: "executed" });
    seed({ organizationId: ORG, status: "approved" });
    seed({ organizationId: OTHER_ORG });

    const rows = await listPendingActions(ORG);

    expect(rows.map((r) => r.id)).toEqual([newest.id, middle.id, older.id]);
    for (const r of rows) {
      expect(r.organizationId).toBe(ORG);
      expect(r.status).toBe("pending");
      expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("honours limit (default 50, clamped to a sane ceiling)", async () => {
    for (let i = 0; i < 60; i++) seed({ organizationId: ORG });
    expect(await listPendingActions(ORG)).toHaveLength(50);
    expect(await listPendingActions(ORG, { limit: 3 })).toHaveLength(3);
    expect(await listPendingActions(ORG, { limit: 0 })).toHaveLength(1);
    expect(await listPendingActions(ORG, { limit: Number.NaN })).toHaveLength(50);
    expect(await listPendingActions(ORG, { limit: 10_000 })).toHaveLength(60);
  });
});

describe("countPendingActions — same predicate as the list", () => {
  it("counts exactly the rows the list would return", async () => {
    seed({ organizationId: ORG });
    seed({ organizationId: ORG });
    seed({ organizationId: ORG, expiresAt: past() }); // lazily expired
    seed({ organizationId: ORG, status: "rejected" });
    seed({ organizationId: OTHER_ORG });
    seed({ organizationId: OTHER_ORG });
    seed({ organizationId: OTHER_ORG });

    expect(await countPendingActions(ORG)).toBe(2);
    expect(await countPendingActions(ORG)).toBe((await listPendingActions(ORG)).length);
    expect(await countPendingActions(OTHER_ORG)).toBe(3);
    expect(await countPendingActions(12345)).toBe(0);
  });
});

// ── sweep ───────────────────────────────────────────────────────────────────

describe("sweepExpiredPendingActions — guarded, idempotent", () => {
  it("flips only expired pendings (any org) and leaves everything else untouched", async () => {
    const expiredA = seed({ organizationId: ORG, expiresAt: past() });
    const expiredB = seed({ organizationId: OTHER_ORG, expiresAt: past(48 * HOUR) });
    const live = seed({ organizationId: ORG, expiresAt: future() });
    // Past TTL but already terminal — a sweep must never rewrite history.
    const executedOld = seed({ organizationId: ORG, status: "executed", expiresAt: past() });
    const rejectedOld = seed({ organizationId: ORG, status: "rejected", expiresAt: past() });
    const approvedOld = seed({ organizationId: ORG, status: "approved", expiresAt: past() });

    const flipped = await sweepExpiredPendingActions();

    expect(flipped).toBe(2);
    const byId = (id: number) => mem.rows.find((r) => r.id === id)!;
    expect(byId(expiredA.id).status).toBe("expired");
    expect(byId(expiredB.id).status).toBe("expired");
    expect(byId(live.id).status).toBe("pending");
    expect(byId(executedOld.id).status).toBe("executed");
    expect(byId(rejectedOld.id).status).toBe("rejected");
    expect(byId(approvedOld.id).status).toBe("approved");
  });

  it("a second run flips nothing (idempotent) and the list/count agree before and after", async () => {
    seed({ organizationId: ORG, expiresAt: past() });
    seed({ organizationId: ORG, expiresAt: past() });
    seed({ organizationId: ORG });

    // Lazy expiry: readers already exclude the stale rows before any sweep.
    expect(await countPendingActions(ORG)).toBe(1);

    expect(await sweepExpiredPendingActions()).toBe(2);
    const snapshot = JSON.stringify(mem.rows);
    expect(await sweepExpiredPendingActions()).toBe(0);
    expect(JSON.stringify(mem.rows)).toBe(snapshot);

    // And the sweep changed nothing a customer sees.
    expect(await countPendingActions(ORG)).toBe(1);
    expect((await listPendingActions(ORG)).map((r) => r.status)).toEqual(["pending"]);
  });

  it("with nothing expired it returns 0 and writes nothing", async () => {
    seed({ organizationId: ORG });
    const snapshot = JSON.stringify(mem.rows);
    expect(await sweepExpiredPendingActions()).toBe(0);
    expect(JSON.stringify(mem.rows)).toBe(snapshot);
  });
});

// ── proposal → org websocket event ──────────────────────────────────────────

describe("proposePendingAction publishes pending_action.created to the org", () => {
  const args = { lead_id: 42, subject: "Following up", message: "Hi there." };

  it("broadcasts { id } on the org channel for a NEW row", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args });

    expect(mem.broadcastToOrg).toHaveBeenCalledTimes(1);
    expect(mem.broadcastToOrg).toHaveBeenCalledWith(ORG, "pending_action.created", { id: row.id });
  });

  it("does NOT broadcast again when a live duplicate is reused (nothing new to badge)", async () => {
    const first = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args });
    const second = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args });

    expect(second.id).toBe(first.id);
    expect(mem.broadcastToOrg).toHaveBeenCalledTimes(1);
  });

  it("a throwing broadcast never fails the proposal (row persisted, best-effort publish)", async () => {
    mem.broadcastToOrg.mockImplementation(() => {
      throw new Error("ws down");
    });

    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_sms", args: { lead_id: 1, message: "hi" } });

    expect(row.status).toBe("pending");
    expect(mem.rows).toHaveLength(1);
    expect(mem.broadcastToOrg).toHaveBeenCalledTimes(1);
  });
});

// ── routes: org-scoped reads ────────────────────────────────────────────────

function appForOrg(organizationId: number) {
  const app = express();
  app.use((req: any, _res, next) => {
    // What isAuthenticated + getOrCreateOrg leave on the request at the real
    // mount (server/routes.ts). The routes must read the org from HERE.
    req.organization = { id: organizationId, settings: {}, onboardingData: {} };
    req.user = { id: "user_tap" };
    next();
  });
  app.use("/api/pax", paxInsightsRouter);
  return app;
}

describe("GET /api/pax/pending-actions — org-scoped card list", () => {
  it("returns only the requesting org's live rows, shaped for a card", async () => {
    const mine = seed({
      organizationId: ORG,
      toolName: "send_sms",
      args: { phone_number: "+15555550100", message: "Your offer is ready." },
    });
    seed({ organizationId: ORG, expiresAt: past() }); // lazily expired → hidden
    seed({ organizationId: OTHER_ORG, toolName: "send_email", args: { email: "other@example.com" } });

    const res = await request(appForOrg(ORG)).get("/api/pax/pending-actions");

    expect(res.status).toBe(200);
    expect(res.body.actions).toHaveLength(1);
    const card = res.body.actions[0];
    expect(card).toEqual({
      id: mine.id,
      toolName: "send_sms",
      channel: "sms",
      recipient: "+15555550100",
      args: mine.args,
      createdAt: mine.createdAt.toISOString(),
      expiresAt: mine.expiresAt.toISOString(),
    });
    // Server-side fields never reach the card.
    expect(card).not.toHaveProperty("contentHash");
    expect(card).not.toHaveProperty("resultSummary");
    expect(card).not.toHaveProperty("approvedByUserId");
    expect(card).not.toHaveProperty("organizationId");

    // THE pin: the mocked req.organization.id is IN the rendered WHERE, as a
    // bound parameter — not merely "the result happened to be filtered".
    expect(mem.lastSelect).not.toBeNull();
    expect(mem.lastSelect!.sql).toMatch(/"organization_id" = \$\d+/);
    expect(mem.lastSelect!.params).toContain(ORG);
    expect(mem.lastSelect!.params).not.toContain(OTHER_ORG);
  });

  it("the other org sees its own rows and nothing of ours", async () => {
    seed({ organizationId: ORG });
    const theirs = seed({ organizationId: OTHER_ORG });

    const res = await request(appForOrg(OTHER_ORG)).get("/api/pax/pending-actions");

    expect(res.status).toBe(200);
    expect(res.body.actions.map((a: any) => a.id)).toEqual([theirs.id]);
    expect(mem.lastSelect!.params).toContain(OTHER_ORG);
    expect(mem.lastSelect!.params).not.toContain(ORG);
  });

  it("?limit is honoured and clamped; garbage falls back to the default", async () => {
    for (let i = 0; i < 5; i++) seed({ organizationId: ORG });

    expect((await request(appForOrg(ORG)).get("/api/pax/pending-actions?limit=2")).body.actions).toHaveLength(2);
    expect((await request(appForOrg(ORG)).get("/api/pax/pending-actions?limit=banana")).body.actions).toHaveLength(5);
    expect((await request(appForOrg(ORG)).get("/api/pax/pending-actions?limit=-3")).body.actions).toHaveLength(5);
  });

  it("an org with nothing waiting gets an empty list, not an error", async () => {
    seed({ organizationId: OTHER_ORG });
    const res = await request(appForOrg(ORG)).get("/api/pax/pending-actions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ actions: [] });
  });
});

describe("GET /api/pax/pending-actions/count — org-scoped badge count", () => {
  it("counts only the requesting org's live rows", async () => {
    seed({ organizationId: ORG });
    seed({ organizationId: ORG });
    seed({ organizationId: ORG, expiresAt: past() });
    seed({ organizationId: ORG, status: "rejected" });
    seed({ organizationId: OTHER_ORG });
    seed({ organizationId: OTHER_ORG });
    seed({ organizationId: OTHER_ORG });

    const mineRes = await request(appForOrg(ORG)).get("/api/pax/pending-actions/count");
    expect(mineRes.status).toBe(200);
    expect(mineRes.body).toEqual({ count: 2 });
    expect(mem.lastSelect!.sql).toMatch(/"organization_id" = \$\d+/);
    expect(mem.lastSelect!.params).toContain(ORG);

    const theirsRes = await request(appForOrg(OTHER_ORG)).get("/api/pax/pending-actions/count");
    expect(theirsRes.body).toEqual({ count: 3 });
    expect(mem.lastSelect!.params).toContain(OTHER_ORG);
    expect(mem.lastSelect!.params).not.toContain(ORG);
  });

  it("is not shadowed by the :id routes (count is a literal segment, not an id)", async () => {
    const res = await request(appForOrg(ORG)).get("/api/pax/pending-actions/count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0 });
  });
});

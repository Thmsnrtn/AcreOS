/**
 * Review-queue plumbing for customer pending approvals (autonomy clarity
 * program, 2026-09-02; routes renamed to the frozen wave-1 contract).
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
 *     and a WS failure never fails the proposal (wave-1 decision iii: this
 *     event is KEPT alongside the count event `pax.needs_you`);
 *   - GET /api/pax/needs-you and /needs-you/count are org-scoped: the mocked
 *     req.organization.id must reach the WHERE clause (asserted on the
 *     rendered SQL + params, not only on the filtered result), and each item
 *     is SERVER-formatted by summarizeAsk.
 *
 * The db mock follows tests/unit/approvalKernel.test.ts: an in-memory table
 * with drizzle WHERE / ORDER BY expressions rendered to SQL via PgDialect and
 * interpreted — extended here to understand `> now()` / `<= now()`, `in (…)`,
 * ORDER BY, LIMIT and projections. Every parser throws on a shape it does not
 * recognise (vacuity guard): a predicate the mock silently dropped would read
 * exactly like a predicate that is present.
 *
 * idempotent: true — db + websocket fully mocked; no network, no Postgres.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ── In-memory pending_actions + rendered-query capture ──────────────────────

const mem = vi.hoisted(() => ({
  tables: { pending_actions: [] as any[], pax_sends: [] as any[] } as Record<string, any[]>,
  nextId: 1,
  /** Every SELECT against pending_actions, in order — the org-scoping pins read these. */
  selects: [] as Array<{ sql: string; params: unknown[] }>,
  broadcastToOrg: vi.fn(),
  listByokCredentials: vi.fn(async () => [] as Array<{ channel: string; revokedAt: Date | null }>),
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

  /** ANDed `"col" <op> ($n | now())` and `"col" in ($n, …)` conditions → row predicate. */
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
    const reIn = /(?:"[a-z_]+"\.)?"([a-z_]+)" in \(((?:\$\d+(?:, )?)+)\)/g;
    while ((m = reIn.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`pendingActionsQueue mock: unmapped column ${m[1]}`);
      const values = m[2].split(", ").map((p) => scalar(params[Number(p.slice(1)) - 1]));
      conds.push((row) => values.includes(scalar(row[prop])));
    }
    if (conds.length === 0) throw new Error(`pendingActionsQueue mock: no conditions in: ${sql}`);
    // Every comparison in the rendered SQL must have been understood; a
    // clause the regexes skipped would silently widen the query.
    const comparisons =
      (sql.match(/ (=|<>|>=|<=|>|<) /g) ?? []).length + (sql.match(/" in \(/g) ?? []).length;
    if (comparisons !== conds.length) {
      throw new Error(`pendingActionsQueue mock: parsed ${conds.length}/${comparisons} comparisons in: ${sql}`);
    }
    return { pred: (row: any) => conds.every((c) => c(row)), sql, params };
  };

  const orderer = (exprs: unknown[]) => {
    const keys = exprs.map((expr) => {
      const { sql } = render(expr);
      const m = /^(?:"[a-z_]+"\.)?"([a-z_]+)" (asc|desc)$/.exec(sql.trim());
      if (!m) throw new Error(`pendingActionsQueue mock: unsupported ORDER BY: ${sql}`);
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`pendingActionsQueue mock: unmapped ORDER BY column ${m[1]}`);
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

  /** `select({ a: col, n: sql\`count(*)…\` })` — count, or a column pick. */
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
        if (!prop) throw new Error(`pendingActionsQueue mock: unsupported projection ${rendered[i]}`);
        out[k] = row[prop];
      });
      return out;
    });
  };

  const table = (t: any) => {
    const name = getTableName(t);
    const rows = mem.tables[name];
    if (!rows) throw new Error(`pendingActionsQueue mock: unexpected table ${name}`);
    return { name, rows };
  };

  const db: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (t: any) => ({
        where: (expr: unknown) => {
          // The sending-identity lookup reads connected mailboxes; none here.
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
    transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
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
// none of it is exercised by the review-queue reads. Stubbed to keep this
// suite hermetic — the kernel itself is REAL and runs against the mock db.
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/ai/tools", () => ({ executeTool: vi.fn(), toolDefinitions: {} }));
vi.mock("../../server/ai/supportAgent", () => ({ executeSupportTool: vi.fn(), supportToolDefinitions: {} }));
vi.mock("../../server/services/paxAskExecutors", () => ({ executeApprovedAsk: vi.fn() }));
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
vi.mock("../../server/services/byok/key-vault", () => ({
  listByokCredentials: (...args: unknown[]) => mem.listByokCredentials(...(args as [])),
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
  origin: string | null;
  reason: string | null;
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
    origin: s.origin ?? null,
    sourceRef: null,
    reason: s.reason ?? null,
    createdAt: s.createdAt ?? new Date(Date.now() - id * 1000),
  };
  mem.tables.pending_actions.push(row);
  return row;
}

const past = (ms = HOUR) => new Date(Date.now() - ms);
const future = (ms = HOUR) => new Date(Date.now() + ms);

beforeEach(() => {
  mem.tables.pending_actions = [];
  mem.tables.pax_sends = [];
  mem.nextId = 1;
  mem.selects = [];
  mem.broadcastToOrg.mockReset();
  mem.listByokCredentials.mockReset();
  mem.listByokCredentials.mockResolvedValue([]);
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
    const byId = (id: number) => mem.tables.pending_actions.find((r) => r.id === id)!;
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
    const snapshot = JSON.stringify(mem.tables.pending_actions);
    expect(await sweepExpiredPendingActions()).toBe(0);
    expect(JSON.stringify(mem.tables.pending_actions)).toBe(snapshot);

    // And the sweep changed nothing a customer sees.
    expect(await countPendingActions(ORG)).toBe(1);
    expect((await listPendingActions(ORG)).map((r) => r.status)).toEqual(["pending"]);
  });

  it("with nothing expired it returns 0 and writes nothing", async () => {
    seed({ organizationId: ORG });
    const snapshot = JSON.stringify(mem.tables.pending_actions);
    expect(await sweepExpiredPendingActions()).toBe(0);
    expect(JSON.stringify(mem.tables.pending_actions)).toBe(snapshot);
  });
});

// ── proposal → org websocket event ──────────────────────────────────────────

describe("proposePendingAction publishes pending_action.created to the org", () => {
  const args = { lead_id: 42, subject: "Following up", message: "Hi there." };
  const createdCalls = () => mem.broadcastToOrg.mock.calls.filter((c) => c[1] === "pending_action.created");

  it("broadcasts { id } on the org channel for a NEW row (alongside the pax.needs_you count)", async () => {
    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args });

    expect(createdCalls()).toHaveLength(1);
    expect(mem.broadcastToOrg).toHaveBeenCalledWith(ORG, "pending_action.created", { id: row.id });
    expect(mem.broadcastToOrg).toHaveBeenCalledWith(ORG, "pax.needs_you", { count: 1 });
  });

  it("does NOT broadcast again when a live duplicate is reused (nothing new to badge)", async () => {
    const first = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args });
    const second = await proposePendingAction({ organizationId: ORG, toolName: "send_email", args });

    expect(second.id).toBe(first.id);
    expect(createdCalls()).toHaveLength(1);
  });

  it("a throwing broadcast never fails the proposal (row persisted, best-effort publish)", async () => {
    mem.broadcastToOrg.mockImplementation(() => {
      throw new Error("ws down");
    });

    const row = await proposePendingAction({ organizationId: ORG, toolName: "send_sms", args: { lead_id: 1, message: "hi" } });

    expect(row.status).toBe("pending");
    expect(mem.tables.pending_actions).toHaveLength(1);
    expect(createdCalls()).toHaveLength(1);
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

/** Every pending_actions SELECT the route rendered must bind THIS org and no other. */
function expectEverySelectScopedTo(orgId: number, notOrgId: number) {
  expect(mem.selects.length).toBeGreaterThan(0);
  for (const s of mem.selects) {
    expect(s.sql).toMatch(/"organization_id" = \$\d+/);
    expect(s.params).toContain(orgId);
    expect(s.params).not.toContain(notOrgId);
  }
}

describe("GET /api/pax/needs-you — org-scoped, server-formatted card list", () => {
  it("returns only the requesting org's live rows, shaped by summarizeAsk", async () => {
    mem.listByokCredentials.mockResolvedValue([{ channel: "twilio", revokedAt: null }]);
    const mine = seed({
      organizationId: ORG,
      toolName: "send_sms",
      args: { phone_number: "+15555550100", message: "Your offer is ready." },
      origin: "chat",
      reason: "The seller asked for it by text.",
    });
    seed({ organizationId: OTHER_ORG, toolName: "send_email", args: { email: "other@example.com" } });

    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const card = res.body.items[0];
    expect(card).toMatchObject({
      id: mine.id,
      toolName: "send_sms",
      status: "pending",
      verb: "Text +15555550100",
      to: "+15555550100",
      from: "your Twilio number",
      text: "Your offer is ready.",
      why: "The seller asked for it by text.",
      whyLabel: "Pax's explanation",
      origin: "chat",
      originPhrase: "from your chat",
      parked: true,
      expired: false,
      alwaysAsks: true,
      expiresAt: mine.expiresAt.toISOString(),
    });
    // Server-side fields never reach the card.
    expect(card).not.toHaveProperty("contentHash");
    expect(card).not.toHaveProperty("resultSummary");
    expect(card).not.toHaveProperty("approvedByUserId");
    expect(card).not.toHaveProperty("organizationId");
    expect(card).not.toHaveProperty("args");

    // THE pin: the mocked req.organization.id is IN the rendered WHERE of
    // every pending_actions read, as a bound parameter — not merely "the
    // result happened to be filtered".
    expectEverySelectScopedTo(ORG, OTHER_ORG);
  });

  it("the other org sees its own rows and nothing of ours", async () => {
    seed({ organizationId: ORG });
    const theirs = seed({ organizationId: OTHER_ORG });

    const res = await request(appForOrg(OTHER_ORG)).get("/api/pax/needs-you");

    expect(res.status).toBe(200);
    expect(res.body.items.map((a: any) => a.id)).toEqual([theirs.id]);
    expectEverySelectScopedTo(OTHER_ORG, ORG);
  });

  it("?limit is honoured and clamped; garbage falls back to the default", async () => {
    for (let i = 0; i < 5; i++) seed({ organizationId: ORG });

    expect((await request(appForOrg(ORG)).get("/api/pax/needs-you?limit=2")).body.items).toHaveLength(2);
    expect((await request(appForOrg(ORG)).get("/api/pax/needs-you?limit=banana")).body.items).toHaveLength(5);
    expect((await request(appForOrg(ORG)).get("/api/pax/needs-you?limit=-3")).body.items).toHaveLength(5);
  });

  it("an org with nothing waiting gets an empty list, not an error", async () => {
    seed({ organizationId: OTHER_ORG });
    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });
});

describe("GET /api/pax/needs-you/count — org-scoped badge count", () => {
  it("counts only the requesting org's live rows", async () => {
    seed({ organizationId: ORG });
    seed({ organizationId: ORG });
    seed({ organizationId: ORG, expiresAt: past() });
    seed({ organizationId: ORG, status: "rejected" });
    seed({ organizationId: OTHER_ORG });
    seed({ organizationId: OTHER_ORG });
    seed({ organizationId: OTHER_ORG });

    const mineRes = await request(appForOrg(ORG)).get("/api/pax/needs-you/count");
    expect(mineRes.status).toBe(200);
    expect(mineRes.body).toEqual({ count: 2 });
    expectEverySelectScopedTo(ORG, OTHER_ORG);

    mem.selects = [];
    const theirsRes = await request(appForOrg(OTHER_ORG)).get("/api/pax/needs-you/count");
    expect(theirsRes.body).toEqual({ count: 3 });
    expectEverySelectScopedTo(OTHER_ORG, ORG);
  });

  it("is not shadowed by the :id routes (count is a literal segment, not an id)", async () => {
    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you/count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0 });
  });
});

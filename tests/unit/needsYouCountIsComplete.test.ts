/**
 * "Waiting for your tap" reads EVERY parked state (AUTONOMY_SPEC.md §4.5, §7).
 *
 * PARKED_STATES (shared/pax-controls.ts) is the enumeration of where an ask
 * can be parked. The badge count (GET /api/pax/needs-you/count → the
 * kernel's countPendingActions) and the list (GET /api/pax/needs-you) must
 * read each member: a parked state the registry names that neither query
 * reads is a queue that under-counts — the ask exists, the badge says zero.
 *
 * The gate is derived from the registry, both directions:
 *   - vacuity: the registry is non-empty and every member has the
 *     `table:status` shape;
 *   - every member's TABLE is one the queue models here — a member naming a
 *     table the queue never opens FAILS (that is the "a parked state nothing
 *     reads" mutation), it is never skipped;
 *   - for every member, rows seeded in that state are counted and listed for
 *     the caller's org only, and the rendered SQL of the count AND the list
 *     names the member's table and binds the member's status as a parameter.
 *
 * Mutation probes (each must go RED):
 *   - remove the one member from PARKED_STATES → the vacuity assertion fails;
 *   - append "payment_reminders:awaiting_approval" → its table is not read;
 *   - drop `eq(pendingActions.status, "pending")` from the kernel's
 *     livePendingPredicate → the count SQL no longer binds the status.
 *
 * idempotent: true — db + websocket fully mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const mem = vi.hoisted(() => ({
  tables: { pending_actions: [] as any[], pax_sends: [] as any[] } as Record<string, any[]>,
  nextId: 1,
  selects: [] as Array<{ table: string; sql: string; params: unknown[] }>,
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
    origin: "origin",
    source_ref: "sourceRef",
    reason: "reason",
    created_at: "createdAt",
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
      if (!prop) throw new Error(`needsYouCount mock: unmapped column ${m[1]}`);
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
          default: throw new Error(`needsYouCount mock: unknown op ${op}`);
        }
      });
    }
    const reIn = /(?:"[a-z_]+"\.)?"([a-z_]+)" in \(((?:\$\d+(?:, )?)+)\)/g;
    while ((m = reIn.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`needsYouCount mock: unmapped column ${m[1]}`);
      const values = m[2].split(", ").map((p) => scalar(params[Number(p.slice(1)) - 1]));
      conds.push((row) => values.includes(scalar(row[prop])));
    }
    if (conds.length === 0) throw new Error(`needsYouCount mock: no conditions in: ${sql}`);
    const comparisons =
      (sql.match(/ (=|<>|>=|<=|>|<) /g) ?? []).length + (sql.match(/" in \(/g) ?? []).length;
    if (comparisons !== conds.length) {
      throw new Error(`needsYouCount mock: parsed ${conds.length}/${comparisons} comparisons in: ${sql}`);
    }
    return { pred: (row: any) => conds.every((c) => c(row)), sql, params };
  };

  const orderer = (exprs: unknown[]) => {
    const keys = exprs.map((expr) => {
      const { sql } = render(expr);
      const m = /^(?:"[a-z_]+"\.)?"([a-z_]+)" (asc|desc)$/.exec(sql.trim());
      if (!m) throw new Error(`needsYouCount mock: unsupported ORDER BY: ${sql}`);
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`needsYouCount mock: unmapped ORDER BY column ${m[1]}`);
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
    throw new Error(`needsYouCount mock: unsupported projection ${rendered.join(", ")}`);
  };

  const db: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (t: any) => ({
        where: (expr: unknown) => {
          const name = getTableName(t);
          if (name === "connected_mailboxes") return stage([]);
          const rows = mem.tables[name];
          if (!rows) throw new Error(`needsYouCount mock: unexpected table ${name}`);
          const { pred, sql, params } = matcher(expr);
          mem.selects.push({ table: name, sql, params });
          const matched = rows.filter(pred).map((r) => ({ ...r }));
          return stage(fields ? project(fields, matched) : matched);
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
vi.mock("../../server/services/byok/key-vault", () => ({ listByokCredentials: vi.fn(async () => []) }));

import { PARKED_STATES } from "../../shared/pax-controls";
import paxInsightsRouter from "../../server/routes-pax-insights";

const ROOT = path.resolve(__dirname, "../..");
const ORG = 7;
const OTHER_ORG = 999;
const HOUR = 60 * 60 * 1000;

/** The tables this queue models. A registry member naming another table FAILS below. */
const MODELED_TABLES = new Set(["pending_actions"]);

function appForOrg(organizationId: number) {
  const app = express();
  app.use((req: any, _res, next) => {
    req.organization = { id: organizationId, settings: {}, onboardingData: {} };
    req.user = { id: "user_tap" };
    next();
  });
  app.use("/api/pax", paxInsightsRouter);
  return app;
}

function seed(organizationId: number, status: string, expiresAt: Date) {
  const id = mem.nextId++;
  mem.tables.pending_actions.push({
    id,
    organizationId,
    toolName: "send_sms",
    args: { phone_number: "+15555550100", message: "hi" },
    contentHash: `hash-${id}`,
    status,
    expiresAt,
    createdByUserId: null,
    approvedByUserId: null,
    executedAt: null,
    resultSummary: null,
    origin: "chat",
    sourceRef: null,
    reason: null,
    createdAt: new Date(Date.now() - id * 1000),
  });
  return id;
}

/** True when a rendered WHERE names `table` and binds `status` as a parameter to its status column. */
function readsState(select: { table: string; sql: string; params: unknown[] }, table: string, status: string): boolean {
  if (select.table !== table) return false;
  const eqMatch = [...select.sql.matchAll(new RegExp(`"${table}"\\."status" = \\$(\\d+)`, "g"))];
  const inMatch = [...select.sql.matchAll(new RegExp(`"${table}"\\."status" in \\(([^)]*)\\)`, "g"))];
  const bound = [
    ...eqMatch.map((m) => select.params[Number(m[1]) - 1]),
    ...inMatch.flatMap((m) => m[1].split(", ").map((p) => select.params[Number(p.slice(1)) - 1])),
  ];
  return bound.includes(status);
}

const members = PARKED_STATES.map((m) => {
  const [table, status] = m.split(":");
  return { member: m, table, status };
});

beforeEach(() => {
  mem.tables.pending_actions = [];
  mem.nextId = 1;
  mem.selects = [];
  mem.broadcastToOrg.mockReset();
});

describe("PARKED_STATES — the registry is real and every member is one the queue can read", () => {
  it("vacuity: at least one parked state, each of the shape table:status, no duplicates", () => {
    expect(PARKED_STATES.length).toBeGreaterThanOrEqual(1);
    expect(new Set(PARKED_STATES).size).toBe(PARKED_STATES.length);
    for (const m of members) {
      expect(m.table, m.member).toMatch(/^[a-z_]+$/);
      expect(m.status, m.member).toMatch(/^[a-z_]+$/);
    }
  });

  it.each(members.map((m) => [m.member, m] as const))(
    "%s — names a table the queue opens (a member the queue never reads is a lie the badge tells)",
    (_id, m) => {
      expect(
        MODELED_TABLES.has(m.table),
        `${m.member}: the needs-you count and list never open "${m.table}" — an ask parked there would not be counted. ` +
          "Add the read to countPendingActions + readNeedsYouRows (and this harness) before adding the member.",
      ).toBe(true);
    },
  );

  it("the list derives its statuses FROM the registry (source pin, so the two cannot drift)", () => {
    const src = fs.readFileSync(path.join(ROOT, "server/routes-pax-insights.ts"), "utf8");
    expect(src).toMatch(/import \{[^}]*\bPARKED_STATES\b[^}]*\} from "@shared\/pax-controls"/);
    expect(src).toContain("PARKED_STATES\n  .filter((s) => s.startsWith(\"pending_actions:\"))");
  });
});

describe.each(members.map((m) => [m.member, m] as const))(
  "%s — counted and listed for the caller's org, and the SQL says so",
  (_id, m) => {
    it("GET /needs-you/count reads the state: the count matches the live rows and the SQL binds the status", async () => {
      const live = new Date(Date.now() + 2 * HOUR);
      seed(ORG, m.status, live);
      seed(ORG, m.status, live);
      seed(ORG, m.status, new Date(Date.now() - HOUR)); // past TTL — not live
      seed(OTHER_ORG, m.status, live);

      const res = await request(appForOrg(ORG)).get("/api/pax/needs-you/count");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 2 });
      const countSelects = mem.selects.filter((s) => s.table === m.table);
      expect(countSelects.length, "the count opened no such table").toBeGreaterThan(0);
      expect(
        countSelects.some((s) => readsState(s, m.table, m.status) && s.params.includes(ORG)),
        `count SQL never bound status "${m.status}" on "${m.table}" for org ${ORG}: ${countSelects.map((s) => s.sql).join(" | ")}`,
      ).toBe(true);
    });

    it("GET /needs-you reads the state: the rows are listed and the SQL binds the status", async () => {
      const live = new Date(Date.now() + 2 * HOUR);
      const a = seed(ORG, m.status, live);
      const b = seed(ORG, m.status, new Date(Date.now() + 3 * HOUR));
      seed(OTHER_ORG, m.status, live);

      const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");

      expect(res.status).toBe(200);
      expect(res.body.items.map((i: any) => i.id)).toEqual([a, b]);
      const listSelects = mem.selects.filter((s) => s.table === m.table);
      expect(listSelects.length).toBeGreaterThan(0);
      expect(
        listSelects.some((s) => readsState(s, m.table, m.status) && s.params.includes(ORG)),
        `list SQL never bound status "${m.status}" on "${m.table}" for org ${ORG}`,
      ).toBe(true);
      for (const s of listSelects) expect(s.params).not.toContain(OTHER_ORG);
    });
  },
);

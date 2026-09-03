/**
 * Every ask is reachable — the SERVER half (AUTONOMY_SPEC.md §4.5, §7).
 *
 * The four PaxAskCard hosts (the client half, tests/unit/paxAskHosts.test.ts
 * and tests/e2e-mobile/pax-ask-mobile.spec.ts) all read ONE server surface.
 * This pins that surface, enumerated as ROUTES below with a per-member
 * vacuity check against the source:
 *
 *   - GET /api/pax/needs-you is org-scoped — every pending_actions read it
 *     renders binds the caller's org and never another — server-formatted by
 *     summarizeAsk (the card's verb / to / from / text / why / origin lines
 *     come from the row, not from the client), and ordered by expiresAt
 *     ascending (the ask that dies soonest is first);
 *   - an ask expired within the last 7 days is listed with status "expired"
 *     and the glossary's expired line — including a parked row past its TTL
 *     the sweep has not stamped yet — and one older than 7 days is gone;
 *   - every id-addressed route (approve / reject / revise) answers 404 for
 *     another org's id;
 *   - the expiry sweep flips pending→expired and emits `pax.needs_you`
 *     { count } for each org it touched, never for one it did not.
 *
 * Mutation probe (must go RED): in server/routes-pax-insights.ts
 * readNeedsYouRows, drop `eq(pendingActions.organizationId, organizationId)`
 * from the live query — the other org's ask appears in this org's list and
 * the rendered SQL no longer binds the org.
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
  selects: [] as Array<{ sql: string; params: unknown[] }>,
  broadcastToOrg: vi.fn(),
  executeApprovedAsk: vi.fn(),
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

  const matcher = (expr: unknown) => {
    const { sql, params } = render(expr);
    const conds: Array<(row: any) => boolean> = [];
    const re = /(?:"[a-z_]+"\.)?"([a-z_]+)" (=|<>|>=|<=|>|<) (\$(\d+)|now\(\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxAsksAreReachable mock: unmapped column ${m[1]}`);
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
          default: throw new Error(`paxAsksAreReachable mock: unknown op ${op}`);
        }
      });
    }
    const reIn = /(?:"[a-z_]+"\.)?"([a-z_]+)" in \(((?:\$\d+(?:, )?)+)\)/g;
    while ((m = reIn.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxAsksAreReachable mock: unmapped column ${m[1]}`);
      const values = m[2].split(", ").map((p) => scalar(params[Number(p.slice(1)) - 1]));
      conds.push((row) => values.includes(scalar(row[prop])));
    }
    if (conds.length === 0) throw new Error(`paxAsksAreReachable mock: no conditions in: ${sql}`);
    const comparisons =
      (sql.match(/ (=|<>|>=|<=|>|<) /g) ?? []).length + (sql.match(/" in \(/g) ?? []).length;
    if (comparisons !== conds.length) {
      throw new Error(`paxAsksAreReachable mock: parsed ${conds.length}/${comparisons} comparisons in: ${sql}`);
    }
    return { pred: (row: any) => conds.every((c) => c(row)), sql, params };
  };

  const orderer = (exprs: unknown[]) => {
    const keys = exprs.map((expr) => {
      const { sql } = render(expr);
      const m = /^(?:"[a-z_]+"\.)?"([a-z_]+)" (asc|desc)$/.exec(sql.trim());
      if (!m) throw new Error(`paxAsksAreReachable mock: unsupported ORDER BY: ${sql}`);
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`paxAsksAreReachable mock: unmapped ORDER BY column ${m[1]}`);
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
        if (!prop) throw new Error(`paxAsksAreReachable mock: unsupported projection ${rendered[i]}`);
        out[k] = row[prop];
      });
      return out;
    });
  };

  const table = (t: any) => {
    const name = getTableName(t);
    const rows = mem.tables[name];
    if (!rows) throw new Error(`paxAsksAreReachable mock: unexpected table ${name}`);
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
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/ai/tools", () => ({
  executeTool: vi.fn(),
  toolDefinitions: {
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
vi.mock("../../server/services/byok/key-vault", () => ({
  listByokCredentials: (...args: unknown[]) => mem.listByokCredentials(...(args as [])),
}));
vi.mock("../../server/services/autopilot/proofReceiptStore", () => ({ recordReceipt: vi.fn() }));
vi.mock("../../server/services/autopilot/tenantScope", () => ({ orgScope: (id: number) => `org:${id}` }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));

import { sweepExpiredPendingActions } from "../../server/services/approvalKernel";
import { PAX_LABELS, PAX_STANDING_LINE } from "../../shared/pax-glossary";
import paxInsightsRouter from "../../server/routes-pax-insights";

const ROOT = path.resolve(__dirname, "../..");
const ORG = 7;
const OTHER_ORG = 999;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * THE POPULATION: the one server surface every PaxAskCard host reads. Each
 * member must be registered in routes-pax-insights.ts (vacuity below); a
 * host that talks to anything else is a host this gate does not cover.
 */
const ROUTES = [
  { method: "get", path: "/needs-you", registration: 'router.get("/needs-you"' },
  { method: "get", path: "/needs-you/count", registration: 'router.get("/needs-you/count"' },
  { method: "post", path: "/pending-actions/:id/approve", registration: 'router.post("/pending-actions/:id/approve"' },
  { method: "post", path: "/pending-actions/:id/reject", registration: 'router.post("/pending-actions/:id/reject"' },
  { method: "post", path: "/pending-actions/:id/revise", registration: 'router.post("/pending-actions/:id/revise"' },
] as const;

function appForOrg(organizationId: number, userId = "user_tap") {
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

type Seed = Partial<{
  toolName: string;
  args: Record<string, unknown>;
  status: string;
  expiresAt: Date;
  origin: string | null;
  reason: string | null;
  sourceRef: Record<string, unknown> | null;
}> & { organizationId: number };

function seed(s: Seed) {
  const id = mem.nextId++;
  const row = {
    id,
    organizationId: s.organizationId,
    toolName: s.toolName ?? "send_sms",
    args: s.args ?? { phone_number: "+15555550100", message: "Your offer is ready." },
    contentHash: `hash-${id}`,
    status: s.status ?? "pending",
    expiresAt: s.expiresAt ?? new Date(Date.now() + 24 * HOUR),
    createdByUserId: null,
    approvedByUserId: null,
    executedAt: null,
    resultSummary: null,
    origin: s.origin ?? null,
    sourceRef: s.sourceRef ?? null,
    reason: s.reason ?? null,
    createdAt: new Date(Date.now() - id * 1000),
  };
  mem.tables.pending_actions.push(row);
  return row;
}

beforeEach(() => {
  mem.tables.pending_actions = [];
  mem.tables.pax_sends = [];
  mem.nextId = 1;
  mem.selects = [];
  mem.broadcastToOrg.mockReset();
  mem.executeApprovedAsk.mockReset();
  mem.executeApprovedAsk.mockResolvedValue({ success: true, data: {}, executor: "executeTool" });
  mem.listByokCredentials.mockReset();
  mem.listByokCredentials.mockResolvedValue([]);
});

describe("the population — every route the four hosts read is registered on the /api/pax router", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/routes-pax-insights.ts"), "utf8");
  const mounts = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");

  it.each(ROUTES.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))("%s is registered", (_label, r) => {
    expect(src).toContain(r.registration);
  });

  it("the router is mounted at /api/pax behind auth + org resolution", () => {
    expect(mounts).toMatch(/app\.use\('\/api\/pax'[^\n]*isAuthenticated[^\n]*getOrCreateOrg[^\n]*paxInsightsRouter\)/);
  });
});

describe("GET /api/pax/needs-you — org-scoped, server-formatted, soonest-expiry first", () => {
  it("lists the caller's live asks ordered by expiresAt ascending, and binds the org in every read", async () => {
    const later = seed({ organizationId: ORG, expiresAt: new Date(Date.now() + 20 * HOUR) });
    const soonest = seed({ organizationId: ORG, expiresAt: new Date(Date.now() + 2 * HOUR) });
    const middle = seed({ organizationId: ORG, expiresAt: new Date(Date.now() + 9 * HOUR) });
    seed({ organizationId: OTHER_ORG, expiresAt: new Date(Date.now() + 1 * HOUR) });

    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.id)).toEqual([soonest.id, middle.id, later.id]);
    expect(res.body.items.every((i: any) => i.status === "pending")).toBe(true);
    expect(mem.selects.length).toBeGreaterThan(0);
    for (const s of mem.selects) {
      expect(s.sql).toMatch(/"organization_id" = \$\d+/);
      expect(s.params).toContain(ORG);
      expect(s.params).not.toContain(OTHER_ORG);
    }
  });

  it("each item is the server's summary — verb, to, from, text, why, origin — never raw args", async () => {
    mem.listByokCredentials.mockResolvedValue([{ channel: "twilio", revokedAt: null }]);
    const row = seed({
      organizationId: ORG,
      origin: "scheduled",
      sourceRef: { scheduledTaskId: 3, scheduledTaskName: "Monday lead pull" },
      reason: "Bill asked for the offer by text on Friday.",
    });

    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");
    const item = res.body.items[0];

    expect(item).toMatchObject({
      id: row.id,
      toolName: "send_sms",
      group: "sends",
      verb: "Text +15555550100",
      to: "+15555550100",
      from: "your Twilio number",
      text: "Your offer is ready.",
      why: "Bill asked for the offer by text on Friday.",
      whyLabel: PAX_LABELS.whyLabel,
      origin: "scheduled",
      originPhrase: "from your scheduled prompt 'Monday lead pull'",
      sourceRef: { scheduledTaskId: 3, scheduledTaskName: "Monday lead pull" },
      alwaysAsks: true,
      parked: true,
      expired: false,
      standingLine: PAX_STANDING_LINE,
      expiresAt: row.expiresAt.toISOString(),
    });
    expect(item.expiresLine).toMatch(/^Expires /);
    expect(item).not.toHaveProperty("args");
    expect(item).not.toHaveProperty("contentHash");
  });

  it("with no sending identity on file the card says so; when the lookup FAILS it claims nothing", async () => {
    seed({ organizationId: ORG });
    const none = await request(appForOrg(ORG)).get("/api/pax/needs-you");
    expect(none.body.items[0].from).toBe(PAX_LABELS.noSendingIdentity);

    mem.listByokCredentials.mockRejectedValue(new Error("vault down"));
    const failed = await request(appForOrg(ORG)).get("/api/pax/needs-you");
    expect(failed.status).toBe(200);
    expect(failed.body.items[0].from).toBeNull();
  });

  it("an ask expired within 7 days is listed as expired with the glossary line; older than 7 days is gone", async () => {
    const live = seed({ organizationId: ORG, expiresAt: new Date(Date.now() + HOUR) });
    const stamped = seed({ organizationId: ORG, status: "expired", expiresAt: new Date(Date.now() - 2 * DAY) });
    // Past TTL but the sweep has not stamped it yet — the readers apply the predicate themselves.
    const lazy = seed({ organizationId: ORG, status: "pending", expiresAt: new Date(Date.now() - HOUR) });
    seed({ organizationId: ORG, status: "expired", expiresAt: new Date(Date.now() - 8 * DAY) });
    seed({ organizationId: OTHER_ORG, status: "expired", expiresAt: new Date(Date.now() - HOUR) });

    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");
    const items = res.body.items as any[];

    expect(items.map((i) => [i.id, i.status])).toEqual([
      [live.id, "pending"],
      [lazy.id, "expired"],
      [stamped.id, "expired"],
    ]);
    for (const expired of items.filter((i) => i.status === "expired")) {
      expect(expired.expired).toBe(true);
      expect(expired.parked).toBe(false);
      expect(expired.expiredLine).toBe(PAX_LABELS.expiredAsk);
      expect(expired.expiresLine).toBeNull();
    }
  });
});

describe("id-addressed routes — another org's id is 404, and nothing happens", () => {
  it.each(ROUTES.filter((r) => r.path.includes(":id")).map((r) => [r.path, r] as const))(
    "%s",
    async (_label, r) => {
      const mine = seed({ organizationId: ORG });
      const res = await request(appForOrg(OTHER_ORG, "intruder"))
        .post(`/api/pax${r.path.replace(":id", String(mine.id))}`)
        .send({ args: { message: "changed" } });
      expect(res.status).toBe(404);
      expect(mem.tables.pending_actions.find((x) => x.id === mine.id)!.status).toBe("pending");
      expect(mem.tables.pending_actions).toHaveLength(1);
      expect(mem.executeApprovedAsk).not.toHaveBeenCalled();
    },
  );
});

describe("the expiry sweep flips pending→expired and tells the badge", () => {
  it("emits pax.needs_you { count } for each org it touched, with that org's live count, and nothing for others", async () => {
    seed({ organizationId: ORG, expiresAt: new Date(Date.now() - HOUR) });
    seed({ organizationId: ORG, expiresAt: new Date(Date.now() + HOUR) }); // still live → count 1
    seed({ organizationId: OTHER_ORG, expiresAt: new Date(Date.now() - 2 * HOUR) });
    seed({ organizationId: 4242, expiresAt: new Date(Date.now() + HOUR) }); // untouched org

    const flipped = await sweepExpiredPendingActions();

    expect(flipped).toBe(2);
    expect(mem.tables.pending_actions.filter((r) => r.status === "expired")).toHaveLength(2);
    const needsYou = mem.broadcastToOrg.mock.calls.filter((c) => c[1] === "pax.needs_you");
    expect(needsYou).toContainEqual([ORG, "pax.needs_you", { count: 1 }]);
    expect(needsYou).toContainEqual([OTHER_ORG, "pax.needs_you", { count: 0 }]);
    expect(needsYou.some((c) => c[0] === 4242)).toBe(false);

    // And the list now shows the flipped row as expired, the live one first.
    const res = await request(appForOrg(ORG)).get("/api/pax/needs-you");
    expect(res.body.items.map((i: any) => i.status)).toEqual(["pending", "expired"]);
  });
});

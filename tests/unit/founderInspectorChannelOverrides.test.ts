/**
 * P12-1c slice 1c-5 — inspector channel-override persistence smoke test.
 *
 * No test pinned the founder-inspector finance routes' persistence before
 * this slice (design §7). Driven through the REAL routes
 * (registerFounderInspectorFinanceRoutes + supertest) and the REAL
 * operationalState access layer, with only auth and the database stubbed:
 *
 *  1. POST pause-channel persists via operational_state, namespace
 *     "channel_overrides", grammar-B key verbatim
 *     (`founder.org_<id>.channel_pause.<channel>`), and still writes its
 *     founder_audit row (action "channel.pause").
 *  2. Resume writes value "false" (the row persists as evidence) and the
 *     audit row's `before` carries the previous value — the helper's
 *     {previousValue, action} contract surviving the retarget.
 *  3. POST throttle persists grammar-B throttle key with the cap as a
 *     decimal string + valueType "number", audit action "channel.throttle".
 *  4. GET /cost renders its overrides read-back from operational_state rows.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const H = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY ||= "0".repeat(64);
  process.env.FIELD_ENCRYPTION_KEY ||= "0".repeat(64);
  return {
    store: new Map<string, Record<string, unknown>>(),
    audits: [] as Array<Record<string, unknown>>,
    opStateTable: null as unknown,
    auditTable: null as unknown,
    orgTable: null as unknown,
    byokTable: null as unknown,
  };
});

/** String params carried by a drizzle WHERE clause (eq / inArray values). */
function whereParams(where: unknown): string[] {
  if (!where || typeof where !== "object") return [];
  try {
    const q = new PgDialect().sqlToQuery(where as SQL);
    return q.params.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

function rowsFor(table: unknown, where: unknown, ctx: { grouped?: boolean; limit?: number }) {
  if (table === H.orgTable) {
    return [{ id: 7, name: "Org Seven", slug: "org-seven", subscriptionTier: "pro", subscriptionStatus: "active" }];
  }
  if (table === H.opStateTable) {
    const params = whereParams(where);
    return [...H.store.values()].filter((r) => params.includes(r.key as string));
  }
  if (table === H.byokTable) return [];
  // financialLedger: lifetime aggregate destructure gets one zero row;
  // grouped / recent-event queries get none.
  if (ctx.grouped || ctx.limit === 50) return [];
  return [{ revenueCents: 0, variableCostCents: 0, refundCents: 0 }];
}

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth/clerkAuth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "founder-1" };
    next();
  },
  requireFounder: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/data-cache/lookup-cache", () => ({
  getCacheHitSavingsForOrg: async () => ({}),
}));
vi.mock("../../server/services/financial-ledger", () => ({
  getContributionMargin: async () => ({ revenueCents: 0, opexCents: 0, marginCents: 0 }),
}));
vi.mock("../../server/db", () => {
  const select = () => {
    let table: unknown;
    let where: unknown;
    const ctx: { grouped?: boolean; limit?: number } = {};
    const q: any = {};
    q.from = (t: unknown) => { table = t; return q; };
    q.where = (w: unknown) => { where = w; return q; };
    q.groupBy = () => { ctx.grouped = true; return q; };
    q.orderBy = () => q;
    q.limit = async (n: number) => { ctx.limit = n; return rowsFor(table, where, ctx).slice(0, n); };
    q.then = (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(table, where, ctx)).then(ok, bad);
    return q;
  };
  const insert = (table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      if (table === H.auditTable) H.audits.push(v);
      if (table === H.opStateTable) {
        H.store.set(`${v.namespace}:${v.key}`, { ...v });
      }
      const chain: any = {
        onConflictDoUpdate: (cfg: { set?: Record<string, unknown> }) => {
          if (table === H.opStateTable) {
            const k = `${v.namespace}:${v.key}`;
            H.store.set(k, { ...H.store.get(k), ...v, ...(cfg.set ?? {}) });
          }
          return { returning: async () => [H.store.get(`${v.namespace}:${v.key}`) ?? v] };
        },
        then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
          Promise.resolve([v]).then(ok, bad),
      };
      return chain;
    },
  });
  const update = () => ({ set: () => ({ where: async () => undefined }) });
  return { db: { select, insert, update } };
});

async function app() {
  const { registerFounderInspectorFinanceRoutes } = await import(
    "../../server/routes-founder-inspector-finance"
  );
  const a = express();
  a.use(express.json());
  registerFounderInspectorFinanceRoutes(a);
  return a;
}

beforeAll(async () => {
  const schema = await import("@shared/schema");
  H.opStateTable = schema.operationalState;
  H.auditTable = schema.founderAudit;
  H.orgTable = schema.organizations;
  H.byokTable = schema.byokCredentials;
});

beforeEach(() => {
  H.store.clear();
  H.audits = [];
});

const PAUSE_KEY = "founder.org_7.channel_pause.lob";
const THROTTLE_KEY = "founder.org_7.channel_throttle.twilio";

describe("inspector channel overrides persist via operational_state (grammar B verbatim)", () => {
  it("pause-channel writes a channel_overrides row + a channel.pause audit row", async () => {
    const res = await request(await app())
      .post("/api/founder/inspector/org/7/pause-channel")
      .send({ channel: "lob", reason: "vendor down" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, key: PAUSE_KEY, paused: true });

    const row = H.store.get(`channel_overrides:${PAUSE_KEY}`);
    expect(row).toMatchObject({
      namespace: "channel_overrides",
      key: PAUSE_KEY,
      value: "true",
      valueType: "boolean",
      description: "vendor down",
      updatedBy: "founder-1",
    });
    expect(H.audits).toHaveLength(1);
    expect(H.audits[0]).toMatchObject({ action: "channel.pause", before: null, area: "inspector_finance" });
  });

  it("resume overwrites with \"false\" and the audit `before` carries the previous value", async () => {
    const a = await app();
    await request(a).post("/api/founder/inspector/org/7/pause-channel").send({ channel: "lob", reason: "vendor down" });
    const res = await request(a)
      .post("/api/founder/inspector/org/7/pause-channel")
      .send({ channel: "lob", reason: "back up", resume: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, key: PAUSE_KEY, paused: false });

    expect(H.store.get(`channel_overrides:${PAUSE_KEY}`)).toMatchObject({ value: "false" });
    expect(H.audits).toHaveLength(2);
    expect(H.audits[1]).toMatchObject({ action: "channel.resume", before: "true" });
  });

  it("throttle writes the grammar-B throttle key as a number row + channel.throttle audit", async () => {
    const res = await request(await app())
      .post("/api/founder/inspector/org/7/throttle")
      .send({ channel: "twilio", dailyCap: 25, reason: "cost control" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, key: THROTTLE_KEY, dailyCap: 25 });

    expect(H.store.get(`channel_overrides:${THROTTLE_KEY}`)).toMatchObject({
      namespace: "channel_overrides",
      key: THROTTLE_KEY,
      value: "25",
      valueType: "number",
      description: "cost control",
      updatedBy: "founder-1",
    });
    expect(H.audits).toHaveLength(1);
    expect(H.audits[0]).toMatchObject({ action: "channel.throttle", before: null });
  });

  it("GET /cost renders the overrides read-back from operational_state rows", async () => {
    const a = await app();
    await request(a).post("/api/founder/inspector/org/7/pause-channel").send({ channel: "lob", reason: "vendor down" });
    await request(a).post("/api/founder/inspector/org/7/throttle").send({ channel: "twilio", dailyCap: 25, reason: "cost control" });

    const res = await request(a).get("/api/founder/inspector/org/7/cost");
    expect(res.status).toBe(200);
    const pause = res.body.overrides.pauses.find((p: any) => p.channel === "lob");
    expect(pause).toMatchObject({ paused: true, setBy: "founder-1", description: "vendor down" });
    expect(pause.setAt).toBeDefined();
    const throttle = res.body.overrides.throttles.find((t: any) => t.channel === "twilio");
    expect(throttle).toMatchObject({ dailyCap: 25, setBy: "founder-1", description: "cost control" });
    const untouched = res.body.overrides.pauses.find((p: any) => p.channel === "ses");
    expect(untouched).toMatchObject({ paused: false, setAt: null, setBy: null });
  });
});

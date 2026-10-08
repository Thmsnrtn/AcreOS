/**
 * A system alert with no tenant context goes to the FOUNDER's organization, or
 * nowhere — never to a guessed org id.
 *
 * `getFounderPrimaryOrgId()` resolved to 1 when neither FOUNDER_PRIMARY_ORG_ID
 * nor a founder membership answered, and `notifyOnCall` caught any failure and
 * used 1 as well. On any database where row 1 is a customer (fresh deploy,
 * staging, restore) a P0 page — title, body, error text — landed in that
 * customer's notification bell, and agent_events rows in their workspace.
 * `recourseDrafter` did the same with `.catch(() => 1)`.
 *
 * Now: unresolved → `null` / `FounderOrgUnresolvedError`; on-call skips the
 * org-anchored channels (in-app row, push, ack-timer), still emails, logs an
 * error and moves `acreos_founder_alert_undeliverable_total`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

// ONE file-level db mock whose target each test sets. Per-test doMock/doUnmock
// raced with fire-and-forget imports left over from the previous test, which
// could cache the real db module and let a write miss the stub.
const dbHolder = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("../../server/db", () => ({
  get db() {
    return (dbHolder.current as { db: unknown } | null)?.db;
  },
  get pool() {
    return (dbHolder.current as { pool: unknown } | null)?.pool;
  },
}));

afterEach(() => {
  vi.resetModules();
  dbHolder.current = null;
  vi.doUnmock("../../server/services/founder");
  delete process.env.FOUNDER_PRIMARY_ORG_ID;
});

/** A db whose founder lookups find nothing, recording every insert. */
function emptyDb(inserts: Array<{ organizationId?: unknown }>) {
  const chain = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = async () => [];
    return q;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => ({
        values: (v: { organizationId?: unknown }) => {
          inserts.push(v);
          return { returning: async () => [{ id: 1 }] };
        },
      }),
    },
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
  };
}

describe("resolving the founder org", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../../server/utils/logger", () => ({ logger }));
  });

  it("with no env and no founder membership it is null / a typed refusal — not 1", async () => {
    dbHolder.current = emptyDb([]);
    const founder = await import("../../server/services/founder");
    expect(await founder.resolveFounderPrimaryOrgId()).toBeNull();
    await expect(founder.getFounderPrimaryOrgId()).rejects.toMatchObject({ code: "FOUNDER_ORG_UNRESOLVED" });
  });

  it("FOUNDER_PRIMARY_ORG_ID wins when set, and a non-id value is ignored rather than coerced", async () => {
    dbHolder.current = emptyDb([]);
    process.env.FOUNDER_PRIMARY_ORG_ID = "42";
    expect(await (await import("../../server/services/founder")).getFounderPrimaryOrgId()).toBe(42);
    // A fresh module (the resolution is cached per process).
    vi.resetModules();
    dbHolder.current = emptyDb([]);
    process.env.FOUNDER_PRIMARY_ORG_ID = "0";
    expect(await (await import("../../server/services/founder")).resolveFounderPrimaryOrgId()).toBeNull();
  });
});

describe("a miss is remembered briefly", () => {
  it("a second resolution inside the window does not re-query; the env var still wins", async () => {
    vi.resetModules();
    vi.doMock("../../server/utils/logger", () => ({ logger }));
    let selects = 0;
    const db = emptyDb([]);
    const select = db.db.select;
    db.db.select = () => {
      selects++;
      return select();
    };
    dbHolder.current = db;
    const founder = await import("../../server/services/founder");
    expect(await founder.resolveFounderPrimaryOrgId()).toBeNull();
    const after1 = selects;
    expect(after1).toBeGreaterThan(0);
    expect(await founder.resolveFounderPrimaryOrgId()).toBeNull();
    expect(selects).toBe(after1);
    process.env.FOUNDER_PRIMARY_ORG_ID = "55";
    expect(await founder.resolveFounderPrimaryOrgId()).toBe(55);
  });
});

describe("notifyOnCall with no founder org", () => {
  it("writes NO notification row anywhere, pushes nothing, still emails, logs and counts", async () => {
    vi.resetModules();
    const inserts: Array<{ organizationId?: unknown }> = [];
    const sendPush = vi.fn(async () => ({ sent: 1, failed: 0 }));
    const sendEmail = vi.fn(async () => ({ success: true }));
    const registerCriticalAlert = vi.fn(async () => undefined);
    vi.doMock("../../server/utils/logger", () => ({ logger }));
    dbHolder.current = emptyDb(inserts);
    vi.doMock("../../server/services/pushNotificationService", () => ({ sendPushToUser: sendPush }));
    vi.doMock("../../server/services/emailService", () => ({ emailService: { sendEmail } }));
    vi.doMock("../../server/routes-founder-critical-alerts", () => ({ registerCriticalAlert }));
    // The REAL founder module (fresh after resetModules), over a database that
    // knows no founder.
    const metrics = await import("../../server/metrics");
    const before = (await metrics.registry.getSingleMetric("acreos_founder_alert_undeliverable_total")!.get()).values.find((v) => v.labels.source === "oncall")?.value ?? 0;

    const { notifyOnCall } = await import("../../server/services/oncall");
    const r = await notifyOnCall("P0", "Stripe webhook failing", "detail with a customer's error text");

    expect(inserts).toEqual([]);
    expect(r.notificationId).toBeNull();
    expect(sendPush).not.toHaveBeenCalled();
    expect(registerCriticalAlert).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as unknown as [{ organizationId?: number }])[0].organizationId).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/no founder organization/), expect.anything());
    const after = (await metrics.registry.getSingleMetric("acreos_founder_alert_undeliverable_total")!.get()).values.find((v) => v.labels.source === "oncall")?.value ?? 0;
    expect(after).toBe(before + 1);
  });

  it("with a founder org configured, the row lands in THAT org", async () => {
    vi.resetModules();
    const inserts: Array<{ organizationId?: unknown }> = [];
    vi.doMock("../../server/utils/logger", () => ({ logger }));
    dbHolder.current = emptyDb(inserts);
    vi.doMock("../../server/services/pushNotificationService", () => ({ sendPushToUser: vi.fn(async () => ({ sent: 0, failed: 0 })) }));
    vi.doMock("../../server/services/emailService", () => ({ emailService: { sendEmail: vi.fn(async () => ({ success: true })) } }));
    vi.doMock("../../server/routes-founder-critical-alerts", () => ({ registerCriticalAlert: vi.fn(async () => undefined) }));
    process.env.FOUNDER_PRIMARY_ORG_ID = "77";
    logger.error.mockClear();
    const { notifyOnCall } = await import("../../server/services/oncall");
    const r = await notifyOnCall("P1", "t", "b");
    // When this fails, say which branch skipped the row rather than only "0".
    const why = JSON.stringify({ result: r, errors: logger.error.mock.calls.map((c) => String(c[0])) });
    expect(inserts.length, `no notification row was written: ${why}`).toBeGreaterThan(0);
    for (const row of inserts) expect(row.organizationId).toBe(77);
  });
});

describe("recourse sweep with no founder org", () => {
  it("does not push against a guessed org's subscriptions", async () => {
    vi.resetModules();
    vi.doMock("../../server/utils/logger", () => ({ logger }));
    dbHolder.current = emptyDb([]);
    const { runRecourseSweepTick } = await import("../../server/services/recourseDrafter");
    const sendPushToUser = vi.fn(async () => ({ sent: 1, failed: 0 }));
    const r = await runRecourseSweepTick({
      aggregateAndDraft: (async () => ({ scanned: 1, inserted: 1, drafted: 2 })) as never,
      getFounderPrimaryOrgId: async () => {
        throw new Error("unresolved");
      },
      getFounderUserIds: async () => ["founder-user"],
      sendPushToUser,
    });
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(r.pushed).toBe(0);
  });
});

describe("no caller supplies its own org fallback (population: every caller)", () => {
  it("every getFounderPrimaryOrgId / resolveFounderPrimaryOrgId call site is free of a numeric fallback", () => {
    const root = resolve(__dirname, "../../server");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const sites: string[] = [];
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      // `getFounderPrimaryOrgId()`, an injected `deps.getFounderPrimaryOrgId()`,
      // or a destructured ALIAS (`{ getFounderPrimaryOrgId: orgIdFn }` —
      // routes-sovereign-integration.ts calls it as `orgIdFn()`), then whatever
      // follows up to the end of the statement.
      const names = ["getFounderPrimaryOrgId", "resolveFounderPrimaryOrgId"];
      for (const a of src.matchAll(/(?:get|resolve)FounderPrimaryOrgId\s*:\s*([A-Za-z_$][\w$]*)/g)) names.push(a[1]);
      const call = new RegExp(`\\b(?:${names.join("|")})\\(\\)([^;\\n]*)`, "g");
      for (const m of src.matchAll(call)) {
        sites.push(`${f}:${m.index}`);
        if (/\?\?\s*\d|\|\|\s*\d|\.catch\(\s*\(\)\s*=>\s*\d/.test(m[1])) offenders.push(`${f.slice(root.length + 1)}: ${m[0]}`);
      }
      // The pattern oncall.ts used: a catch that assigns a literal org id.
      if (/FounderPrimaryOrgId/.test(src) && /\borgId\s*=\s*\d+\s*;/.test(src)) offenders.push(`${f.slice(root.length + 1)}: orgId = <literal>`);
    }
    // Vacuity floor: measured 2026-10-07 at 17 call sites (15 direct + 2 aliased).
    expect(sites.length).toBeGreaterThanOrEqual(17);
    expect(offenders).toEqual([]);
  });
});

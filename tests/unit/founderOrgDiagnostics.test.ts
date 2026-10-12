/**
 * An unresolved founder organization is VISIBLE — at boot in production and on
 * the founder's launch-readiness surface — without guessing an org and without
 * ever printing an org id.
 *
 * System alerts refuse to land in a guessed org (systemAlertsNeverLandInAGuessedOrg
 * .test.ts). That refusal is silent from outside: with FOUNDER_PRIMARY_ORG_ID
 * unset and no single founder-owned org, every in-app alert and push is
 * skipped and nothing says why. These tests drive the REAL founder resolver
 * (over a stub database) through server/services/founderOrgDiagnostics.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const notifyOnCall = vi.fn(async () => ({ notificationId: null, push: { sent: 0, failed: 0 }, emailSent: true, ackTimerRegistered: false }));

const dbHolder = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("../../server/db", () => ({
  get db() {
    return (dbHolder.current as { db: unknown } | null)?.db;
  },
}));

/** A database that knows no founder: every select resolves to no rows. */
function emptyDb() {
  const chain = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = () => q;
    q.limit = async () => [];
    q.then = (ok: (rows: unknown[]) => unknown) => Promise.resolve([]).then(ok);
    return q;
  };
  return { db: { select: () => chain() } };
}

const ORG_ID = "987654";
const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

async function load() {
  vi.resetModules();
  vi.doMock("../../server/utils/logger", () => ({ logger }));
  vi.doMock("../../server/services/oncall", () => ({ notifyOnCall }));
  return import("../../server/services/founderOrgDiagnostics");
}

beforeEach(() => {
  for (const f of Object.values(logger)) f.mockClear();
  notifyOnCall.mockClear();
  dbHolder.current = emptyDb();
  delete process.env.FOUNDER_PRIMARY_ORG_ID;
});
afterEach(() => {
  delete process.env.FOUNDER_PRIMARY_ORG_ID;
});

const errorsWithCode = () =>
  logger.error.mock.calls.filter((c) => (c[2] as { metadata?: { code?: string } } | undefined)?.metadata?.code === "FOUNDER_ORG_UNRESOLVED");

describe("describeFounderOrgResolution — boolean + source, never an id", () => {
  it("unresolved: resolved=false, no source, the strict refusal named", async () => {
    const d = await load();
    const s = await d.describeFounderOrgResolution();
    expect(s).toMatchObject({ resolved: false, source: null, pinConfigured: false });
    expect(s.strictReason).not.toBeNull();
  });

  it("resolved by FOUNDER_PRIMARY_ORG_ID as written: source 'env', the strict refusal still shown, the id never", async () => {
    process.env.FOUNDER_PRIMARY_ORG_ID = ORG_ID;
    const d = await load();
    const s = await d.describeFounderOrgResolution();
    expect(s).toMatchObject({ resolved: true, source: "env", pinConfigured: true });
    expect(s.strictReason).not.toBeNull();
    expect(JSON.stringify(s)).not.toContain(ORG_ID);
  });

  it("on a miss the strict lookup runs once, not twice", async () => {
    const prior = process.env.FOUNDER_EMAIL;
    process.env.FOUNDER_EMAIL = "founder-diag@example.test"; // read at module load: a lookup to count
    try {
      let selects = 0;
      const db = emptyDb();
      const select = db.db.select;
      db.db.select = () => {
        selects++;
        return select();
      };
      dbHolder.current = db;
      const d = await load();
      const s = await d.describeFounderOrgResolution();
      expect(s.resolved).toBe(false);
      expect(s.strictReason).toBe("no-founder-identity");
      // strict users lookup (1) + the membership fallback's users lookup (1).
      expect(selects).toBe(2);
    } finally {
      if (prior === undefined) delete process.env.FOUNDER_EMAIL;
      else process.env.FOUNDER_EMAIL = prior;
    }
  });

  it("every strict refusal has a remedy", async () => {
    const d = await load();
    for (const reason of ["no-founder-identity", "no-founder-org", "ambiguous", "pin-not-founder-owned", "lookup-failed"] as const) {
      expect(d.FOUNDER_ORG_REMEDY[reason]).toMatch(/\w/);
    }
  });
});

describe("reportFounderOrgAtBoot", () => {
  it("production + unresolved: ONE structured error and ONE on-call notice, then never again in this process", async () => {
    const d = await load();
    expect(await d.reportFounderOrgAtBoot({ notify: true, env: PROD })).toBe("unresolved");
    expect(errorsWithCode()).toHaveLength(1);
    expect(notifyOnCall).toHaveBeenCalledTimes(1);
    expect((notifyOnCall.mock.calls[0] as unknown[])[0]).toBe("P1");
    expect(JSON.stringify(notifyOnCall.mock.calls[0])).toMatch(/FOUNDER_PRIMARY_ORG_ID/);

    expect(await d.reportFounderOrgAtBoot({ notify: true, env: PROD })).toBe("already-reported");
    expect(errorsWithCode()).toHaveLength(1);
    expect(notifyOnCall).toHaveBeenCalledTimes(1);
  });

  it("a process that does not run the scheduler logs but does not email", async () => {
    const d = await load();
    expect(await d.reportFounderOrgAtBoot({ notify: false, env: PROD })).toBe("unresolved");
    expect(errorsWithCode()).toHaveLength(1);
    expect(notifyOnCall).not.toHaveBeenCalled();
  });

  it("outside production it does nothing", async () => {
    const d = await load();
    expect(await d.reportFounderOrgAtBoot({ notify: true, env: { NODE_ENV: "test" } as NodeJS.ProcessEnv })).toBe("skipped-not-production");
    expect(logger.error).not.toHaveBeenCalled();
    expect(notifyOnCall).not.toHaveBeenCalled();
  });

  it("resolved: no error, no notice; the log carries the source and never the id", async () => {
    process.env.FOUNDER_PRIMARY_ORG_ID = ORG_ID;
    const d = await load();
    expect(await d.reportFounderOrgAtBoot({ notify: true, env: { ...PROD, FOUNDER_PRIMARY_ORG_ID: ORG_ID } })).toBe("resolved");
    expect(logger.error).not.toHaveBeenCalled();
    expect(notifyOnCall).not.toHaveBeenCalled();
    const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.info.mock.calls]);
    expect(logged).toContain('"source":"env"');
    expect(logged).not.toContain(ORG_ID);
  });

  it("a failed lookup is not reported as a misconfiguration (no page on a database blip)", async () => {
    dbHolder.current = null; // every query throws
    const d = await load();
    expect(await d.reportFounderOrgAtBoot({ notify: true, env: PROD })).toBe("lookup-failed");
    expect(errorsWithCode()).toHaveLength(0);
    expect(notifyOnCall).not.toHaveBeenCalled();
  });
});

describe("wiring (population: both production entry points and the founder surface)", () => {
  const src = (p: string) => stripComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

  it("the app server and the worker both run the boot report", () => {
    expect(src("server/index.ts")).toMatch(/reportFounderOrgAtBoot\(\{\s*notify:\s*jobPlacement\.run\s*\}\)/);
    expect(src("server/worker.ts")).toMatch(/reportFounderOrgAtBoot\(\{\s*notify:/);
  });

  it("the founder launch-readiness endpoint reports the state as an item and a field", () => {
    const admin = src("server/routes-admin.ts");
    const start = admin.indexOf('"/api/founder/launch-readiness"');
    expect(start).toBeGreaterThan(0);
    const handler = admin.slice(start, admin.indexOf("api.", start + 10));
    expect(handler).toContain("describeFounderOrgResolution()");
    expect(handler).toContain('key: "founder_org_resolved"');
    expect(handler).toMatch(/res\.json\(\{\s*score,\s*items,\s*founderOrg\s*\}\)/);
    // The diagnostics object is the only founder-org data this handler sends.
    expect(handler).not.toMatch(/organizationId/);
  });
});

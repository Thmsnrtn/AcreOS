/**
 * agent_investor commissions — the server half of W2-AGENT (2026-11-06).
 *
 * Driven through the REAL routes (registerOrganizationRoutes + supertest) and
 * the real commissionService, with only auth and the database stubbed.
 *
 *   1. No default rate is ever served as the org's own. getCommissionConfig used
 *      to fall back to a built-in 3/4/5/6% ladder, so GET /api/commissions/config
 *      returned it, every agent summary carried a "Standard (3%)" current tier
 *      and the statement printed it — for orgs that had saved nothing.
 *   2. GET /api/commissions and POST /api/commissions are deleted (no caller;
 *      the POST recorded at that default rate). They answer 404 while their
 *      siblings still answer, so the 404 is the deletion and not an unmounted
 *      router.
 *   3. recordDealCommission refuses without saved rates instead of recording.
 *   4. Nothing in server/, client/src/ or shared/ still names the deleted path.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const H = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY ||= "0".repeat(64);
  process.env.FIELD_ENCRYPTION_KEY ||= "0".repeat(64);
  return {
    org: { id: 9, name: "Test Realty", onboardingData: { businessType: "agent_investor" } } as Record<string, unknown>,
    members: [] as Array<Record<string, unknown>>,
    rows: {} as Record<string, Record<string, unknown> | undefined>,
    writes: [] as unknown[],
    membersTable: null as unknown,
  };
});

/** Which organization_integrations provider a drizzle WHERE clause selects. */
function providerIn(where: unknown): string | null {
  const wanted = new Set(["commission_config", "commission_records", "commission_split_config"]);
  const seen = new Set<unknown>();
  const stack: unknown[] = [where];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string" && wanted.has(v)) return v;
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    for (const child of Object.values(v as Record<string, unknown>)) stack.push(child);
  }
  return null;
}

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-1" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = H.org;
    req.organizationId = H.org.id;
    next();
  },
}));
vi.mock("../../server/utils/permissions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../server/utils/permissions");
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, requireAdminOrAbove: pass, requireOwner: pass, requirePermission: pass, attachPermissionContext: pass };
});
vi.mock("../../server/db", () => {
  const select = () => {
    let table: unknown;
    const q: any = {};
    q.from = (t: unknown) => {
      table = t;
      return q;
    };
    q.where = (w: unknown) => {
      const rows = () => {
        if (table === H.membersTable) return H.members;
        const p = providerIn(w);
        const row = p ? H.rows[p] : undefined;
        return row ? [row] : [];
      };
      return {
        limit: async () => rows(),
        then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(rows()).then(ok, bad),
      };
    };
    return q;
  };
  const insert = () => ({ values: async (v: unknown) => void H.writes.push(v) });
  const update = () => ({ set: (v: unknown) => ({ where: async () => void H.writes.push(v) }) });
  return { db: { select, insert, update } };
});

const MEMBER = { id: 41, organizationId: 9, userId: "user-1", displayName: "Avery Agent", email: "avery@example.com", isActive: true };
const SAVED = {
  tiers: [
    { label: "Base", minDeals: 0, ratePercent: 2.5 },
    { label: "Top", minDeals: 6, ratePercent: 3 },
  ],
  trackingPeriod: "annual" as const,
};

async function app() {
  const { registerOrganizationRoutes } = await import("../../server/routes-organization");
  const a = express();
  a.use(express.json());
  registerOrganizationRoutes(a);
  return a;
}

async function saveRates() {
  const { sealIntegrationCredentials } = await import("../../server/services/integrationCredentials");
  H.rows.commission_config = {
    id: 1,
    organizationId: 9,
    provider: "commission_config",
    credentials: sealIntegrationCredentials({ config: SAVED }, 9),
  };
}

beforeAll(async () => {
  const { teamMembers } = await import("@shared/schema");
  H.membersTable = teamMembers;
});

function reset() {
  H.members = [MEMBER];
  H.rows = {};
  H.writes = [];
}

describe("no default rate is served as the org's own", () => {
  it("GET /api/commissions/config with nothing saved says so — no tiers, no rates", async () => {
    reset();
    const res = await request(await app()).get("/api/commissions/config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, config: null });
    expect(JSON.stringify(res.body)).not.toMatch(/ratePercent|Standard|Platinum/);
  });

  it("GET /api/commissions/config returns the org's own saved rates when they exist", async () => {
    reset();
    await saveRates();
    const res = await request(await app()).get("/api/commissions/config");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.config.tiers).toEqual(SAVED.tiers);
  });

  it("an agent's summary carries no tier when no rates are saved, and the saved tier when they are", async () => {
    reset();
    const a = await app();
    const none = await request(a).get("/api/commissions/summaries?year=2026");
    expect(none.status).toBe(200);
    expect(none.body).toHaveLength(1);
    expect(none.body[0].teamMemberId).toBe(MEMBER.id);
    expect(none.body[0].currentTier).toBeNull();

    await saveRates();
    const saved = await request(a).get("/api/commissions/summaries?year=2026");
    expect(saved.body[0].currentTier).toEqual(SAVED.tiers[0]);
  });

  it("the statement says the rates are not configured instead of printing a tier", async () => {
    reset();
    const res = await request(await app()).get(`/api/commissions/statement/${MEMBER.id}?year=2026`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("not configured");
    expect(res.text).not.toMatch(/Current Tier:\s+\S+ @ \d/);
  });

  it("recordDealCommission refuses without saved rates and writes nothing", async () => {
    reset();
    const { recordDealCommission } = await import("../../server/services/commissionService");
    await expect(recordDealCommission(9, MEMBER.id, 77, 250_000_00)).rejects.toThrow(/No commission rates are saved/);
    expect(H.writes).toEqual([]);
  });

  it("a saved config with no tier reads as unconfigured instead of crashing tier resolution", async () => {
    reset();
    const { sealIntegrationCredentials } = await import("../../server/services/integrationCredentials");
    H.rows.commission_config = {
      id: 1,
      organizationId: 9,
      provider: "commission_config",
      credentials: sealIntegrationCredentials({ config: { tiers: [], trackingPeriod: "monthly" } }, 9),
    };
    const res = await request(await app()).get("/api/commissions/summaries?year=2026");
    expect(res.status).toBe(200);
    expect(res.body[0].currentTier).toBeNull();
  });
});

describe("GET /api/commissions and POST /api/commissions are deleted", () => {
  it("both answer 404 through the real router while their siblings still answer", async () => {
    reset();
    const a = await app();
    // The router IS mounted: siblings on the same base answer.
    expect((await request(a).get("/api/commissions/summaries")).status).toBe(200);
    expect((await request(a).get("/api/commissions/config")).status).toBe(200);
    // The deleted pair do not.
    expect((await request(a).get("/api/commissions")).status).toBe(404);
    expect((await request(a).get("/api/commissions?status=owed")).status).toBe(404);
    const post = await request(a)
      .post("/api/commissions")
      .send({ teamMemberId: MEMBER.id, dealId: 77, salePriceCents: 250_000_00 });
    expect(post.status).toBe(404);
    expect(H.writes).toEqual([]);
  });

  it(
    "nothing in server/, client/src/ or shared/ still names the deleted path",
    () => {
      const ROOT = path.resolve(__dirname, "../..");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) files.push(p);
        }
      };
      for (const d of ["server", "client/src", "shared"]) walk(path.join(ROOT, d));

      // The deleted path as a literal: exact, or with a query string. A
      // sibling ("/api/commissions/summaries") does not match.
      const DELETED = /["'`]\/api\/commissions(?:\?[^"'`]*)?["'`]/;
      const SIBLING = /["'`]\/api\/commissions\/summaries/;
      const offenders: string[] = [];
      const siblingSeenIn = new Set<string>();
      for (const f of files) {
        const src = stripComments(fs.readFileSync(f, "utf8"));
        const rel = path.relative(ROOT, f);
        if (DELETED.test(src)) offenders.push(rel);
        if (SIBLING.test(src)) siblingSeenIn.add(rel.split(path.sep)[0] === "client" ? "client" : rel.split(path.sep)[0]);
      }
      // Vacuity floors: the walk read the real trees, and the same literal
      // scan does see the surviving sibling in BOTH the server and the client.
      expect(files.length).toBeGreaterThan(1500);
      expect([...siblingSeenIn].sort()).toEqual(["client", "server"]);
      expect(offenders).toEqual([]);
    },
    REPO_SWEEP_TIMEOUT_MS,
  );
});

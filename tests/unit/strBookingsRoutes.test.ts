/**
 * W2-STR (2026-11-06) — the short-term-rental routes after "light up or delete".
 *
 * The STR block in server/routes-rent-ledger.ts registered nine routes; only
 * two (the reservation list and the metrics) had a client caller. This wave:
 *
 *   LIT UP on the Bookings tab — the record writer, the status transition and
 *   the per-stay P&L (render + real-path calls: strBookingsPanel.test.tsx).
 *   Lighting them up meant owning what they do, so two defects that only an
 *   unreached handler could carry were fixed and are pinned here:
 *     1. the writer could record the SAME stay twice whenever it had no unit or
 *        no channel (NULLs are distinct in the unique index), double-counting
 *        every occupancy and revenue figure;
 *     2. the P&L substituted 0 stay nights when the nights were not derivable,
 *        which allocated a recorded-looking $0 of operating expense and let the
 *        net compute.
 *
 *   DELETED — GET /api/reservations/:id/pricing. Its variance compared the
 *   operator's rate × nights with the GROSS booking, which carries the
 *   pass-through cleaning fee and taxes. Pinned here two ways: the route is
 *   registered nowhere (the STR registrar's own mount list AND every route
 *   registration in server/), and no claim source still names the capability.
 *
 * No DATABASE_URL: the db module is mocked with thenable query chains, the same
 * harness as paymentWorkflowEvents.test.ts. The where-clause of the same-stay
 * guard is rendered through drizzle's own Postgres dialect, so the test reads
 * the SQL the handler would send, not the handler's source.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const { dbMock } = vi.hoisted(() => ({
  dbMock: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), transaction: vi.fn() },
}));
vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: dbMock };
});

import { registerRentLedgerRoutes } from "../../server/routes-rent-ledger";

const ROOT = resolve(__dirname, "../..");

type Handler = (req: any, res: any) => Promise<unknown>;
interface Registered { method: string; path: string; handler: Handler }

function registered(): Registered[] {
  const routes: Registered[] = [];
  const app: any = {};
  for (const m of ["get", "post", "put", "patch", "delete"]) {
    app[m] = (path: string, ...args: unknown[]) =>
      routes.push({ method: m.toUpperCase(), path, handler: args[args.length - 1] as Handler });
  }
  registerRentLedgerRoutes(app);
  return routes;
}

function handlerFor(method: string, path: string): Handler {
  const r = registered().find((x) => x.method === method && x.path === path);
  if (!r) throw new Error(`${method} ${path} is not registered`);
  return r.handler;
}

/** Thenable query-chain stub; `where` and `values` arguments land in `sink`. */
function chain(result: unknown, sink?: unknown[]) {
  const link: any = {
    from: () => link,
    where: (w: unknown) => { sink?.push(w); return link; },
    orderBy: () => link,
    limit: () => link,
    values: (v: unknown) => { sink?.push(v); return link; },
    onConflictDoNothing: () => link,
    returning: () => Promise.resolve(result),
    then: (ok: any, fail: any) => Promise.resolve(result).then(ok, fail),
  };
  return link;
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res;
}

const ORG = { id: 7 };

beforeEach(() => {
  dbMock.select.mockReset();
  dbMock.insert.mockReset();
  dbMock.update.mockReset();
  dbMock.transaction.mockReset();
});

// ── The route population ─────────────────────────────────────────────────────

/** Every STR route that survives the wave — the registrar must still mount each. */
const KEPT_STR_ROUTES = [
  "POST /api/properties/:propertyId/reservations",
  "GET /api/properties/:propertyId/reservations",
  "POST /api/properties/:propertyId/reservations/import",
  "GET /api/properties/:propertyId/str-metrics",
  "PATCH /api/reservations/:id/status",
  "GET /api/reservations/:id/pnl",
  "POST /api/properties/:propertyId/turnovers/generate",
  "GET /api/properties/:propertyId/turnovers",
];

const PRICING_PATH = /\/reservations\/[^/"'`\s]+\/pricing\b/;

describe("the per-stay pricing route is gone", () => {
  it("the STR registrar mounts every kept route and nothing under /api/reservations/:id beyond them", () => {
    const routes = registered();
    const mounted = new Set(routes.map((r) => `${r.method} ${r.path}`));
    for (const k of KEPT_STR_ROUTES) expect(mounted, `${k} is no longer mounted`).toContain(k);

    expect(routes.filter((r) => PRICING_PATH.test(r.path)).map((r) => r.path)).toEqual([]);
    // The whole per-reservation namespace is pinned, so the deleted reader cannot
    // come back under another verb or a near-miss path without this failing.
    expect(
      routes.filter((r) => r.path.startsWith("/api/reservations/")).map((r) => `${r.method} ${r.path}`).sort(),
    ).toEqual(["GET /api/reservations/:id/pnl", "PATCH /api/reservations/:id/status"]);
  });

  it("no route registration anywhere in server/ mounts a reservation pricing path", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p); }
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
      }
    };
    walk(resolve(ROOT, "server"));

    const paths: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\.(?:get|post|put|patch|delete|all|use)\(\s*["'`]([^"'`]+)["'`]/g)) {
        paths.push(m[1]);
      }
    }
    // Vacuity: the scan read the registrar this test is about, and a real share
    // of the server's registrations (measured 2026-11-06: several thousand).
    expect(files.length).toBeGreaterThan(500);
    expect(paths).toContain("/api/reservations/:id/pnl");
    expect(paths).toContain("/api/reservations/:id/status");
    expect(paths.length).toBeGreaterThan(1500);

    expect(paths.filter((p) => PRICING_PATH.test(p))).toEqual([]);
  });
});

// ── The claim population ─────────────────────────────────────────────────────

/** A claim of the deleted capability — its route, its function, or its wording. */
const CLAIM = /\/reservations\/[^"'`\s]*\/pricing|computeNightlyRateExpectation|nightly[- ]rate expectation|operator[- ]set nightly|set nightly rate|own nightly (?:rate|pricing)/i;

function walkFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, ext, out);
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("nothing still claims operator-set nightly pricing", () => {
  it("the claim predicate catches the capability's own words and spares the honest negatives", () => {
    // The deleted route, the old registry/persona wording, and the function.
    expect(CLAIM.test("/api/reservations/:id/pricing")).toBe(true);
    expect(CLAIM.test("`/api/reservations/${id}/pricing`")).toBe(true);
    expect(CLAIM.test("and operator-set nightly pricing")).toBe(true);
    expect(CLAIM.test("your own nightly pricing")).toBe(true);
    expect(CLAIM.test("computeNightlyRateExpectation(")).toBe(true);
    // What the product honestly says about pricing must stay sayable.
    expect(CLAIM.test("OTA channel sync (Airbnb, VRBO) and dynamic market pricing aren't built.")).toBe(false);
    expect(CLAIM.test("never a market or suggested rate")).toBe(false);
    expect(CLAIM.test("/api/reservations/:id/pnl")).toBe(false);
  });

  it("no claim source names it: client, registry, governance, Pax and support tools, API docs, personas", () => {
    const clientFiles = walkFiles(resolve(ROOT, "client/src"), /\.(ts|tsx)$/);
    const paxFiles = [
      ...walkFiles(resolve(ROOT, "server/ai"), /\.ts$/),
      ...walkFiles(resolve(ROOT, "server/services/pax"), /\.ts$/),
    ];
    const registryFiles = [
      resolve(ROOT, "shared/business-types.ts"),
      ...walkFiles(resolve(ROOT, "shared/business-types"), /\.ts$/),
      ...walkFiles(resolve(ROOT, "shared/governance"), /\.ts$/),
    ];
    const named = [
      resolve(ROOT, "server/openapi-spec.ts"),
      resolve(ROOT, "tests/personas/customer-personas.ts"),
      resolve(ROOT, "client/src/pages/onboarding-v2.tsx"),
      resolve(ROOT, "client/src/components/rentals/bookings-panel.tsx"),
    ];

    // Per-member vacuity: every named source exists and has real content once
    // its comments are gone; the walks found their directories' files.
    for (const f of [...named, ...registryFiles.slice(0, 1)]) {
      expect(existsSync(f), f).toBe(true);
      expect(stripComments(readFileSync(f, "utf8")).length, f).toBeGreaterThan(1000);
    }
    expect(clientFiles.length).toBeGreaterThan(500);
    expect(paxFiles.length).toBeGreaterThan(20);
    expect(registryFiles.length).toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const f of new Set([...clientFiles, ...paxFiles, ...registryFiles, ...named])) {
      const text = stripComments(readFileSync(f, "utf8"));
      if (CLAIM.test(text)) offenders.push(f.slice(ROOT.length + 1));
    }
    // API docs are prose, so they are read whole.
    const apiDocs = resolve(ROOT, "docs/api-reference.md");
    expect(existsSync(apiDocs)).toBe(true);
    if (CLAIM.test(readFileSync(apiDocs, "utf8"))) offenders.push("docs/api-reference.md");

    expect(offenders, "a deleted capability is still claimed").toEqual([]);
  });
});

// ── The writer: one stay is recorded once ───────────────────────────────────

describe("POST /api/properties/:propertyId/reservations — the same stay is not recorded twice", () => {
  const post = () => handlerFor("POST", "/api/properties/:propertyId/reservations");
  const body = {
    checkIn: "2026-10-01",
    checkOut: "2026-10-04",
    guestName: "  Ana  ",
    channel: "airbnb",
    grossBookingCents: 45000,
    // The deleted pricing capability's field: a client that still sends it must
    // not have it written (the column is orphaned, read by nothing).
    nightlyRateCents: 15000,
  };

  it("refuses a stay already on file, writes nothing, and asks for the correction path", async () => {
    const where: unknown[] = [];
    dbMock.select.mockReturnValueOnce(chain([{ id: 5 }])); // the property, in this org
    dbMock.select.mockReturnValueOnce(chain([{ id: "r-old" }], where)); // the same stay
    const res = fakeRes();
    await post()({ organization: ORG, params: { propertyId: "5" }, body }, res);

    expect(res.statusCode).toBe(400);
    expect(String(res.body?.message)).toMatch(/already recorded/);
    expect(String(res.body?.message)).toMatch(/mark it cancelled and record it again/);
    expect(dbMock.insert).not.toHaveBeenCalled();

    // The guard's SQL, rendered by drizzle's Postgres dialect: org- and
    // property-scoped, keyed on the stay, and blind to cancelled stays (so a
    // cancelled mistake never blocks its correction).
    const q = new PgDialect().sqlToQuery(where[0] as SQL);
    expect(q.sql).toMatch(/"reservations"\."organization_id" = \$\d+/);
    expect(q.sql).toMatch(/"reservations"\."property_id" = \$\d+/);
    expect(q.sql).toMatch(/"reservations"\."check_in" = \$\d+/);
    expect(q.sql).toMatch(/"reservations"\."check_out" = \$\d+/);
    expect(q.sql).toMatch(/"reservations"\."channel" = \$\d+/);
    expect(q.sql).toMatch(/"reservations"\."guest_name" = \$\d+/);
    expect(q.sql).toMatch(/"reservations"\."status" in \(/);
    expect(q.params).toEqual(expect.arrayContaining([7, 5, "2026-10-01", "2026-10-04", "airbnb", "Ana", "booked", "checked_in", "checked_out"]));
    expect(q.params).not.toContain("cancelled");
  });

  it("an unnamed, unchannelled stay is matched on NULLs, not skipped", async () => {
    const where: unknown[] = [];
    dbMock.select.mockReturnValueOnce(chain([{ id: 5 }]));
    dbMock.select.mockReturnValueOnce(chain([{ id: "r-old" }], where));
    const res = fakeRes();
    await post()({ organization: ORG, params: { propertyId: "5" }, body: { checkIn: "2026-10-01", checkOut: "2026-10-04" } }, res);

    expect(res.statusCode).toBe(400);
    expect(dbMock.insert).not.toHaveBeenCalled();
    const q = new PgDialect().sqlToQuery(where[0] as SQL);
    expect(q.sql).toMatch(/"reservations"\."channel" is null/);
    expect(q.sql).toMatch(/"reservations"\."guest_name" is null/);
  });

  it("records a new stay with the trimmed guest and without the orphaned nightly-rate column", async () => {
    const values: unknown[] = [];
    dbMock.select.mockReturnValueOnce(chain([{ id: 5 }]));
    dbMock.select.mockReturnValueOnce(chain([])); // not on file
    dbMock.insert.mockReturnValueOnce(chain([{ id: "r-new", channel: "airbnb", status: "booked" }], values));
    const res = fakeRes();
    await post()({ organization: ORG, params: { propertyId: "5" }, body }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.reservation?.id).toBe("r-new");
    const row = values[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      organizationId: 7, propertyId: 5, guestName: "Ana", channel: "airbnb",
      checkIn: "2026-10-01", checkOut: "2026-10-04", nights: 3, grossBookingCents: 45000,
      channelFeeCents: null, cleaningFeeCents: null, taxesCents: null, payoutCents: null, status: "booked",
    });
    expect(row).not.toHaveProperty("nightlyRateCents");
  });
});

// ── The per-stay P&L: no substituted nights ──────────────────────────────────

describe("GET /api/reservations/:id/pnl — an undatable stay carries no operating-expense share", () => {
  const pnl = () => handlerFor("GET", "/api/reservations/:id/pnl");
  // One measured operating expense in October 2026 (31 nights).
  const OCTOBER_UTILITIES = [{ category: "utilities", amountCents: 31000, isOperating: true, incurredOn: "2026-10-01" }];
  const stay = (checkIn: string, checkOut: string) => ({
    id: "r1", organizationId: 7, propertyId: 5, checkIn, checkOut,
    // Every fee recorded (a direct booking: a real $0 channel fee), so only the
    // operating-expense line can decide whether the net is known.
    grossBookingCents: 50000, channelFeeCents: 0, cleaningFeeCents: 0, taxesCents: 0,
  });

  it("refuses the allocation, the op-ex line and the net when the stay's nights cannot be derived", async () => {
    dbMock.select.mockReturnValueOnce(chain([stay("2026-10-04", "2026-10-04")]));
    dbMock.select.mockReturnValueOnce(chain(OCTOBER_UTILITIES));
    const res = fakeRes();
    await pnl()({ organization: ORG, params: { id: "r1" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.stayNights).toBeNull();
    expect(res.body.allocation).toBeNull();
    expect(res.body.pnl.allocatedOperatingExpenseCents).toBeNull();
    expect(res.body.pnl.unavailableComponents).toContain("allocated_operating_expense");
    expect(res.body.pnl.netCents).toBeNull();
  });

  it("allocates the measured operating expense across a real stay's nights and computes the net", async () => {
    dbMock.select.mockReturnValueOnce(chain([stay("2026-10-04", "2026-10-07")]));
    dbMock.select.mockReturnValueOnce(chain(OCTOBER_UTILITIES));
    const res = fakeRes();
    await pnl()({ organization: ORG, params: { id: "r1" } }, res);

    expect(res.body.stayNights).toBe(3);
    // 31000 over October's 31 nights × 3 nights = 3000.
    expect(res.body.allocation).toMatchObject({ allocatedOperatingExpenseCents: 3000, operatingSumCents: 31000, windowNights: 31, stayNights: 3 });
    expect(res.body.pnl.netCents).toBe(47000);
  });
});

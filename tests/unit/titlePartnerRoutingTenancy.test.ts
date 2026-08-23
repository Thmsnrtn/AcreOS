/**
 * `titleCompanyId` named ANY tenant's title partner, and the router returned it.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `routeTitleOrder` (server/routes-title-partners.ts) has two branches, and
 * only one of them enforced tenancy. The fallback branch filters candidates by
 * `p.organizationId === organizationId` (own) then `=== null` (platform
 * default) — the model the column itself documents in
 * shared/schema/accounting-ops.ts: "NULL = platform-default partner (any org
 * can route to it)". A non-NULL `organization_id` therefore means the partner
 * row is PRIVATE to that org.
 *
 * The explicit-id branch skipped that check entirely:
 *
 *     .where(and(eq(titlePartners.id, titleCompanyId),
 *                eq(titlePartners.isActive, true)))
 *
 * `titleCompanyId` is attacker-controlled and unconstrained
 * (`z.number().int().positive().optional()`), and `POST /api/title-orders` is
 * plain `isAuthenticated` + `getOrCreateOrg`. The deal check one statement
 * earlier proves only that the DEAL belongs to the caller — nothing proved
 * anything about the partner. So an authenticated member of org B could post
 * their own dealId plus org A's partner id and:
 *
 *   1. read org A's private partner row (name, contact, territory, webhook,
 *      tier, and the encrypted HMAC secret) cross-tenant;
 *   2. have their own propertyAddress / buyerInfo / sellerInfo / salePrice
 *      POSTed by `fireAndForgetPartnerWebhook` to the `webhookUrl` stored on
 *      THAT row — i.e. org A's private partner row used as an exfiltration
 *      sink for org B's deal, signed with org A's secret.
 *
 * ── WHAT THIS FILE PROVES, AND HOW IT FAILS ─────────────────────────────────
 * Per CLAUDE.md, a load-bearing gate is falsified against the SEMANTIC defect,
 * not against the symbol that expressed it — and specifically NOT by asserting
 * that the handler "mentions organizationId" somewhere, which stays green while
 * an unused const sits next to an open query. That mistake has already been
 * made on this table.
 *
 * So `title_partners` here is an HONEST double. It does not interpret intent:
 * it takes the Drizzle predicate the production statement actually built,
 * compiles it to real Postgres SQL with the real `PgDialect`, and EVALUATES
 * that SQL against in-memory rows with a small generic interpreter (`=`, `<>`,
 * `is [not] null`, `and`, `or`, `not`, parens) that knows nothing about the
 * word "organization" and THROWS on any token it cannot read, so an unreadable
 * predicate fails loudly rather than passing vacuously. Drop the org term from
 * the statement and the compiled SQL loses it, the interpreter stops excluding
 * the foreign row, the router hands it back, and these tests fail.
 *
 * The last describe block pins the WHERE OF THE STATEMENT ITSELF — the exact
 * predicate object handed to the driver — by evaluating it against each row:
 * it must exclude the foreign partner while still admitting the caller's own
 * and the platform default, and must still bind `id` and `is_active`.
 *
 * Anti-vacuity is carried throughout: the org's own partner still routes, the
 * platform-default partner (organization_id IS NULL) stays reachable — that
 * NULL row is why over-tightening to a plain `eq(organizationId)` is wrong —
 * an inactive partner is still refused, and the territory-broadcast branch is
 * untouched.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { deals, titleOrders, titlePartners } from "@shared/schema";

const ORG_A = 7; // the victim — owns the private partner
const ORG_B = 42; // the caller holding someone else's partner id

const PARTNER_A = 77; // privately owned by ORG_A
const PARTNER_B = 88; // ORG_B's own partner
const PARTNER_PLATFORM = 99; // organization_id IS NULL — any org may route
const PARTNER_B_INACTIVE = 66; // ORG_B's own, is_active = false

const DEAL_B = 500; // ORG_B's own deal

// ============================================================================
// An honest `title_partners` / `deals` double: real compiled SQL, evaluated.
// ============================================================================

const dialect = new PgDialect();

/** "table_name.column_name" -> the camelCase key rows are stored under. */
const columnKey = new Map<string, string>();
function register(table: any): void {
  const tname = getTableName(table);
  for (const [key, col] of Object.entries(getTableColumns(table) as Record<string, any>)) {
    columnKey.set(`${tname}.${col.name}`, key);
  }
}
for (const t of [titlePartners, titleOrders, deals]) register(t);

function tokenize(sql: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = sql.indexOf('"', i + 1);
      if (j === -1) throw new Error(`unterminated identifier in: ${sql}`);
      let ident = sql.slice(i + 1, j);
      i = j + 1;
      if (sql[i] === "." && sql[i + 1] === '"') {
        j = sql.indexOf('"', i + 2);
        if (j === -1) throw new Error(`unterminated identifier in: ${sql}`);
        ident = `${ident}.${sql.slice(i + 2, j)}`;
        i = j + 1;
      }
      toks.push(`@${ident}`);
      continue;
    }
    if (c === "$") {
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) j++;
      toks.push(sql.slice(i, j));
      i = j;
      continue;
    }
    if (c === "'") {
      const j = sql.indexOf("'", i + 1);
      if (j === -1) throw new Error(`unterminated literal in: ${sql}`);
      toks.push(`'${sql.slice(i + 1, j)}`);
      i = j + 1;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (two === "<>") { toks.push(two); i += 2; continue; }
    if ("()=,".includes(c)) { toks.push(c); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < sql.length && /[A-Za-z_0-9]/.test(sql[j])) j++;
      toks.push(sql.slice(i, j).toLowerCase());
      i = j;
      continue;
    }
    throw new Error(`title-partner fake db: unreadable character ${JSON.stringify(c)} in ${sql}`);
  }
  return toks;
}

function evaluate(sql: string, params: unknown[], row: Record<string, unknown>): boolean {
  const toks = tokenize(sql);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];

  const operand = (): unknown => {
    const t = take();
    if (t === undefined) throw new Error(`title-partner fake db: ran off the end of ${sql}`);
    if (t.startsWith("@")) {
      const key = columnKey.get(t.slice(1));
      if (!key) throw new Error(`title-partner fake db: unregistered column ${t.slice(1)}`);
      return row[key] ?? null;
    }
    if (t.startsWith("$")) return params[Number(t.slice(1)) - 1] ?? null;
    if (t.startsWith("'")) return t.slice(1);
    if (t === "null") return null;
    if (t === "true") return true;
    if (t === "false") return false;
    throw new Error(`title-partner fake db: not an operand: ${t} in ${sql}`);
  };

  const comparison = (): boolean => {
    const left = operand();
    const op = take();
    if (op === "is") {
      let negate = false;
      if (peek() === "not") { take(); negate = true; }
      const nul = take();
      if (nul !== "null") throw new Error(`title-partner fake db: expected NULL, got ${nul}`);
      const nullish = left === null || left === undefined;
      return negate ? !nullish : nullish;
    }
    const right = operand();
    switch (op) {
      case "=": return left === right;
      case "<>": return left !== right;
      default: throw new Error(`title-partner fake db: unsupported operator ${op} in ${sql}`);
    }
  };

  const primary = (): boolean => {
    if (peek() === "(") {
      take();
      const v = orExpr();
      if (take() !== ")") throw new Error(`unbalanced ) in ${sql}`);
      return v;
    }
    if (peek() === "not") { take(); return !primary(); }
    return comparison();
  };
  const andExpr = (): boolean => {
    let v = primary();
    while (peek() === "and") { take(); const r = primary(); v = v && r; }
    return v;
  };
  const orExpr = (): boolean => {
    let v = andExpr();
    while (peek() === "or") { take(); const r = andExpr(); v = v || r; }
    return v;
  };

  const result = orExpr();
  if (p !== toks.length) throw new Error(`title-partner fake db: trailing tokens in ${sql}`);
  return result;
}

/** Compile the predicate the production code emitted, then run it on a row. */
function matches(pred: unknown, row: Record<string, unknown>): boolean {
  if (pred === undefined || pred === null) return true; // no WHERE at all
  const { sql, params } = dialect.sqlToQuery(pred as SQL);
  return evaluate(sql, params as unknown[], row);
}

function compiled(pred: unknown): string {
  return dialect.sqlToQuery(pred as SQL).sql;
}

// ============================================================================
// State + the mocked module graph.
// ============================================================================

interface Store { [table: string]: Record<string, unknown>[] }

const state = {
  store: {} as Store,
  /** Every predicate a `title_partners` SELECT actually handed the driver. */
  partnerWheres: [] as unknown[],
  decrypted: [] as string[],
  posted: [] as Array<{ url: string; body: string }>,
  nextOrderId: 1000,
};

function rowsOf(table: any): Record<string, unknown>[] {
  return (state.store[getTableName(table)] ??= []);
}

const fakeDb = {
  select: (_fields?: any) => {
    let table: any = null;
    let pred: unknown = undefined;
    let lim: number | null = null;
    const run = () => {
      if (getTableName(table) === "title_partners") state.partnerWheres.push(pred);
      const hits = rowsOf(table).filter((r) => matches(pred, r));
      return (lim === null ? hits : hits.slice(0, lim)).map((r) => ({ ...r }));
    };
    const b: any = {
      from: (t: any) => { table = t; return b; },
      where: (w: unknown) => { pred = w; return b; },
      limit: (n: number) => { lim = n; return b; },
      orderBy: () => b,
      groupBy: () => b,
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  },
  insert: (table: any) => ({
    values: (v: Record<string, unknown>) => {
      const run = () => {
        const row = { id: state.nextOrderId++, ...v };
        rowsOf(table).push(row);
        return [{ ...row }];
      };
      const b: any = {
        onConflictDoNothing: () => b,
        returning: () => ({ then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej) }),
        then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
      };
      return b;
    },
  }),
  update: (table: any) => ({
    set: (values: Record<string, unknown>) => {
      let pred: unknown = undefined;
      const run = () => {
        const hits = rowsOf(table).filter((r) => matches(pred, r));
        for (const r of hits) Object.assign(r, values);
        return hits.map((r) => ({ ...r }));
      };
      const b: any = {
        where: (w: unknown) => { pred = w; return b; },
        returning: () => ({ then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej) }),
        then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
      };
      return b;
    },
  }),
};

// The factory is hoisted above these declarations, so it reads `fakeDb` off
// module scope at CALL time rather than closing over it (TDZ).
vi.mock("../../server/db", () => {
  const d = () => fakeDb;
  return {
    get db() { return d(); },
    get dbReadOnly() { return d(); },
    dbReplica: null,
    get dbReplicaUnsafe() { return d(); },
    pool: { query: async () => ({ rows: [] }) },
    replicaPool: { query: async () => ({ rows: [] }) },
    DB_ROLES: { primary: "primary", replica: "replica" },
    withTransaction: async (fn: any) => fn(d()),
    assertReplicaRoleAtBoundary: async () => undefined,
  };
});

// The partner's HMAC secret must never be decrypted for a row the caller
// cannot reach. Spying on the decryptor is how that is asserted.
vi.mock("../../server/services/fieldEncryption", () => ({
  decrypt: (s: string) => { state.decrypted.push(s); return `plain:${s}`; },
  encrypt: (s: string) => `enc:${s}`,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/services/notificationDispatcher", () => ({
  notificationDispatcher: { dispatch: async () => undefined },
}));

// ============================================================================
// Route wiring: grab the real POST /api/title-orders handler.
// ============================================================================

type Handler = (req: any, res: any) => Promise<unknown>;
let createOrder: Handler;

beforeAll(async () => {
  const { registerTitlePartnerRoutes } = await import("../../server/routes-title-partners");
  const handlers = new Map<string, Handler>();
  const app: any = {
    post: (path: string, ...hs: Handler[]) => handlers.set(`POST ${path}`, hs[hs.length - 1]),
    get: (path: string, ...hs: Handler[]) => handlers.set(`GET ${path}`, hs[hs.length - 1]),
    use: () => undefined,
  };
  registerTitlePartnerRoutes(app);
  createOrder = handlers.get("POST /api/title-orders")!;
  expect(createOrder, "POST /api/title-orders was never registered").toBeTypeOf("function");
});

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, string>,
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; },
    getHeader(k: string) { return res.headers[k]; },
  };
  return res;
}

const ORDER_BODY = {
  propertyAddress: { line1: "1 Field Rd", city: "Ada", state: "OK", county: "Pontotoc", zip: "74820" },
  buyerInfo: { name: "Org B Buyer", email: "buyer@orgb.example" },
  sellerInfo: { name: "Org B Seller", email: "seller@orgb.example" },
  salePrice: "125000.00",
  expectedClosingDate: "2026-12-01",
};

async function postOrder(orgId: number, extra: Record<string, unknown>) {
  const req: any = {
    organization: { id: orgId },
    organizationId: orgId,
    user: { id: `user-${orgId}` },
    body: { dealId: DEAL_B, ...ORDER_BODY, ...extra },
  };
  const res = makeRes();
  await createOrder(req, res);
  // fireAndForgetPartnerWebhook is deliberately not awaited by the handler.
  await new Promise((r) => setTimeout(r, 0));
  return res;
}

beforeEach(() => {
  for (const k of Object.keys(state.store)) delete state.store[k];
  state.partnerWheres.length = 0;
  state.decrypted.length = 0;
  state.posted.length = 0;
  state.nextOrderId = 1000;

  state.store[getTableName(deals)] = [
    { id: DEAL_B, organizationId: ORG_B, status: "under_contract" },
    { id: 501, organizationId: ORG_A, status: "under_contract" },
  ];
  state.store[getTableName(titleOrders)] = [];
  state.store[getTableName(titlePartners)] = [
    {
      id: PARTNER_A, organizationId: ORG_A, partnerName: "Org A Private Title",
      territoryStates: ["OK"], territoryCounties: [], apiKeyHash: "hash-a",
      hmacSecretEncrypted: "secret-A", webhookUrl: "https://org-a-private.example/hook",
      volumePricingTier: "pilot", isActive: true,
    },
    {
      id: PARTNER_B, organizationId: ORG_B, partnerName: "Org B Own Title",
      territoryStates: ["OK"], territoryCounties: [], apiKeyHash: "hash-b",
      hmacSecretEncrypted: "secret-B", webhookUrl: "https://org-b-own.example/hook",
      volumePricingTier: "pilot", isActive: true,
    },
    {
      id: PARTNER_PLATFORM, organizationId: null, partnerName: "Platform Default Title",
      territoryStates: [], territoryCounties: [], apiKeyHash: "hash-p",
      hmacSecretEncrypted: "secret-P", webhookUrl: "https://platform-default.example/hook",
      volumePricingTier: "standard", isActive: true,
    },
    {
      id: PARTNER_B_INACTIVE, organizationId: ORG_B, partnerName: "Org B Retired Title",
      territoryStates: ["OK"], territoryCounties: [], apiKeyHash: "hash-bi",
      hmacSecretEncrypted: "secret-BI", webhookUrl: "https://org-b-retired.example/hook",
      volumePricingTier: "pilot", isActive: false,
    },
  ];

  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
    state.posted.push({ url: String(url), body: String(init?.body ?? "") });
    return { ok: true, status: 200, text: async () => "" } as any;
  }));
});

// ============================================================================
// 1. Behaviour through the real route handler.
// ============================================================================

describe("POST /api/title-orders — titleCompanyId cannot name another org's partner", () => {
  it("ORG B NAMING ORG A'S PRIVATE PARTNER IS REFUSED — no order, no exfiltration", async () => {
    const res = await postOrder(ORG_B, { titleCompanyId: PARTNER_A });

    // The sink first: org B's buyer/seller/price must never reach the URL
    // stored on org A's private row, and org A's shared secret must never be
    // decrypted to sign it.
    expect(
      state.posted.map((p) => p.url),
      "org B's deal payload was POSTed to org A's partner webhook",
    ).not.toContain("https://org-a-private.example/hook");
    expect(state.posted, "an outbound partner webhook fired at all").toHaveLength(0);
    expect(
      state.decrypted,
      "another org's partner HMAC secret was decrypted",
    ).not.toContain("secret-A");

    // Nothing was written, so nothing can be laundered through it later.
    expect(
      state.store[getTableName(titleOrders)],
      "an order was created pointing at another org's partner",
    ).toHaveLength(0);

    // And a scoped read that matched nothing does not report success.
    expect(res.statusCode, "another org's private partner was accepted").toBe(404);
    expect(res.body?.error).toBe("NOT_FOUND");
  });

  it("THE ORG'S OWN PARTNER STILL ROUTES — vacuity guard", async () => {
    const res = await postOrder(ORG_B, { titleCompanyId: PARTNER_B });

    expect(res.statusCode, "the org can no longer route to its own partner").toBe(201);
    expect(res.body?.assignedPartnerId).toBe(PARTNER_B);
    expect(res.body?.status).toBe("assigned");
    expect(state.store[getTableName(titleOrders)]).toHaveLength(1);
    expect(state.posted.map((p) => p.url)).toEqual(["https://org-b-own.example/hook"]);
    expect(state.decrypted).toContain("secret-B");
  });

  it("THE PLATFORM-DEFAULT PARTNER (organization_id IS NULL) STAYS REACHABLE", async () => {
    // Guard against over-tightening: title_partners.organization_id is
    // NULLABLE by design and NULL means "any org may route to it". A plain
    // eq(organizationId) would pass every test above and break this one.
    const res = await postOrder(ORG_B, { titleCompanyId: PARTNER_PLATFORM });

    expect(res.statusCode).toBe(201);
    expect(res.body?.assignedPartnerId).toBe(PARTNER_PLATFORM);
    expect(state.posted.map((p) => p.url)).toEqual(["https://platform-default.example/hook"]);
  });

  it("AN INACTIVE OWN PARTNER IS STILL REFUSED — the is_active guard survived", async () => {
    const res = await postOrder(ORG_B, { titleCompanyId: PARTNER_B_INACTIVE });

    expect(res.statusCode).toBe(404);
    expect(state.store[getTableName(titleOrders)]).toHaveLength(0);
    expect(state.posted).toHaveLength(0);
  });

  it("THE TERRITORY BROADCAST BRANCH IS UNTOUCHED — no titleCompanyId still routes", async () => {
    const res = await postOrder(ORG_B, {});

    expect(res.statusCode).toBe(201);
    expect(res.body?.assignedPartnerId, "territory routing picked a foreign partner").toBe(PARTNER_B);
  });

  it("A BROADCAST THAT MATCHES NOTHING STILL 201s AS pending — the 404 is scoped", async () => {
    // The new notFound belongs to the EXPLICIT branch only; broadcast with no
    // territory match is a legitimate unassigned order, not an error.
    state.store[getTableName(titlePartners)] = [
      {
        id: PARTNER_A, organizationId: ORG_A, partnerName: "Org A Private Title",
        territoryStates: ["OK"], territoryCounties: [], apiKeyHash: "hash-a",
        hmacSecretEncrypted: "secret-A", webhookUrl: "https://org-a-private.example/hook",
        volumePricingTier: "pilot", isActive: true,
      },
    ];
    const res = await postOrder(ORG_B, {});

    expect(res.statusCode).toBe(201);
    expect(res.body?.status).toBe("pending");
    expect(res.body?.assignedPartnerId).toBeNull();
    expect(state.posted, "a broadcast fell through to a foreign partner's webhook").toHaveLength(0);
  });
});

// ============================================================================
// 2. The WHERE of the statement itself.
// ============================================================================

describe("the title_partners SELECT emits the tenant term in its own predicate", () => {
  // Asserting the handler "mentions organizationId" is worthless: an unused
  // const next to an open query satisfies it. These assertions run the exact
  // predicate object the statement handed the driver.
  const ROW_FOREIGN = { id: PARTNER_A, organizationId: ORG_A, isActive: true };
  const ROW_OWN = { id: PARTNER_B, organizationId: ORG_B, isActive: true };
  const ROW_PLATFORM = { id: PARTNER_PLATFORM, organizationId: null, isActive: true };

  it("the explicit-id lookup's predicate excludes the foreign row by itself", async () => {
    await postOrder(ORG_B, { titleCompanyId: PARTNER_A });

    expect(state.partnerWheres, "the partner lookup never ran").toHaveLength(1);
    const pred = state.partnerWheres[0];

    expect(
      compiled(pred),
      "the statement's WHERE carries no title_partners.organization_id term",
    ).toContain('"title_partners"."organization_id"');

    // Semantics, not vocabulary: evaluated against the rows themselves.
    expect(
      matches(pred, { ...ROW_FOREIGN }),
      "the emitted predicate admits another org's private partner",
    ).toBe(false);
    expect(
      matches(pred, { ...ROW_PLATFORM, id: PARTNER_A }),
      "the emitted predicate excludes platform defaults",
    ).toBe(true);
  });

  it("the same predicate still binds id and is_active — nothing was traded away", async () => {
    await postOrder(ORG_B, { titleCompanyId: PARTNER_B });
    const pred = state.partnerWheres[0];

    expect(matches(pred, { ...ROW_OWN })).toBe(true);
    expect(matches(pred, { ...ROW_OWN, id: PARTNER_B + 1 }), "id is not pinned").toBe(false);
    expect(matches(pred, { ...ROW_OWN, isActive: false }), "is_active is not pinned").toBe(false);
    expect(matches(pred, { ...ROW_FOREIGN, id: PARTNER_B }), "organization_id is not pinned").toBe(false);
  });
});

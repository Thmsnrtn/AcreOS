/**
 * Notes N7 — PATCH /api/notes/acquired/:id/servicing-arrangement.
 *
 * The per-note edit of who services an acquired note (the operator's own
 * declaration; it gates the Reg Z periodic-statement predicate).
 *   - owner/admin only (requireRole(["owner","admin"]), like the acquired GET/POST);
 *   - org-scoped: another org's note id is a 404 and nothing is written. The fake
 *     transaction reads the REAL drizzle where-clause (rendered to SQL + params),
 *     so dropping the organization predicate from the route turns this red;
 *   - the body is the four-value enum and nothing else (strict);
 *   - a change writes the note row AND an append-only provenance row in the same
 *     transaction; an unchanged value writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  roleArgs: [] as unknown[],
  notes: [] as Array<{ id: string; organizationId: number; servicingArrangement: string }>,
  updates: [] as Array<{ set: Record<string, unknown>; sql: string; params: unknown[] }>,
  observations: [] as Array<Record<string, unknown>>,
  renderWhere: null as null | ((w: unknown) => { sql: string; params: unknown[] }),
}));

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const find = (w: unknown) => {
    const { sql, params } = h.renderWhere!(w);
    return { sql, params, hit: h.notes.find((n) => params.includes(n.id) && (!/organization_id/.test(sql) || params.includes(n.organizationId))) };
  };
  const tx = {
    select: () => ({ from: () => ({ where: (w: unknown) => ({ limit: async () => { const f = find(w).hit; return f ? [{ id: f.id, servicingArrangement: f.servicingArrangement }] : []; } }) }) }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (w: unknown) => {
          const f = find(w);
          h.updates.push({ set, sql: f.sql, params: f.params });
          if (f.hit) f.hit.servicingArrangement = set.servicingArrangement as string;
        },
      }),
    }),
    insert: () => ({ values: async (v: Record<string, unknown>) => { h.observations.push(v); } }),
  };
  return { ...actual, db: {}, withTransaction: async (fn: (t: unknown) => unknown) => fn(tx) };
});
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _r: any, next: any) => { req.user = { id: "user_7" }; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _r: any, next: any) => { req.organization = { id: 7 }; req.organizationId = 7; next(); },
}));
vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: (roles: unknown) => { h.roleArgs.push(roles); return (_q: any, _s: any, next: any) => next(); },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerNoteRoutes } from "../../server/routes-notes";

h.renderWhere = (w) => {
  const q = new PgDialect().sqlToQuery(w as any);
  return { sql: q.sql, params: q.params as unknown[] };
};

type Handler = (req: any, res: any, next: (e?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
registerNoteRoutes({
  get: (p: string, ...hs: Handler[]) => routes.set(`GET ${p}`, hs),
  post: (p: string, ...hs: Handler[]) => routes.set(`POST ${p}`, hs),
  patch: (p: string, ...hs: Handler[]) => routes.set(`PATCH ${p}`, hs),
  delete: (p: string, ...hs: Handler[]) => routes.set(`DELETE ${p}`, hs),
} as any);

async function patch(id: string, body: unknown) {
  const handlers = routes.get("PATCH /api/notes/acquired/:id/servicing-arrangement");
  expect(handlers, "the PATCH must be registered").toBeDefined();
  let out!: { status: number; body: any };
  await new Promise<void>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { out = { status: this.statusCode, body: b }; resolve(); return this; },
    };
    const req: any = { headers: {}, params: { id }, query: {}, body };
    (async () => { for (const hd of handlers!) await hd(req, res, (e?: unknown) => { if (e) throw e; }); })().catch(() => resolve());
  });
  return out;
}

beforeEach(() => {
  h.notes = [
    { id: "11111111-1111-4111-8111-111111111111", organizationId: 7, servicingArrangement: "passive_holder" },
    { id: "22222222-2222-4222-8222-222222222222", organizationId: 8, servicingArrangement: "passive_holder" },
  ];
  h.updates = [];
  h.observations = [];
});
const MINE = "11111111-1111-4111-8111-111111111111";
const THEIRS = "22222222-2222-4222-8222-222222222222";

describe("PATCH /api/notes/acquired/:id/servicing-arrangement", () => {
  it("is owner/admin only, like the acquired GET and POST", () => {
    expect(h.roleArgs).toContainEqual(["owner", "admin"]);
    expect(routes.get("PATCH /api/notes/acquired/:id/servicing-arrangement")!.length).toBe(4);
  });

  it("changes the arrangement and writes a provenance row naming who and what it replaced", async () => {
    const r = await patch(MINE, { servicingArrangement: "self_serviced" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: MINE, servicingArrangement: "self_serviced", previous: "passive_holder", changed: true });
    expect(h.notes[0].servicingArrangement).toBe("self_serviced");
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].sql).toMatch(/organization_id/);
    expect(h.updates[0].params).toContain(7);
    expect(h.observations).toEqual([
      expect.objectContaining({ organizationId: 7, noteId: MINE, field: "servicingArrangement", kind: "value", value: "self_serviced", source: "edit", recordedBy: "user_7" }),
    ]);
    expect(h.observations[0].sourceRef).toMatchObject({ previous: "passive_holder" });
  });

  it("another organization's note is a 404 — nothing is written, nothing leaks", async () => {
    const r = await patch(THEIRS, { servicingArrangement: "self_serviced" });
    expect(r.status).toBe(404);
    expect(h.notes[1].servicingArrangement).toBe("passive_holder");
    expect(h.updates).toHaveLength(0);
    expect(h.observations).toHaveLength(0);
  });

  it("an unchanged value writes no row and says so", async () => {
    const r = await patch(MINE, { servicingArrangement: "passive_holder" });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(h.observations).toHaveLength(0);
  });

  it.each([{}, { servicingArrangement: "compliant" }, { servicingArrangement: null }, { servicingArrangement: "self_serviced", status: "paid_off" }])(
    "refuses a body that is not exactly the enum: %j",
    async (body) => {
      const r = await patch(MINE, body);
      expect(r.status).toBe(422);
      expect(h.updates).toHaveLength(0);
      expect(h.observations).toHaveLength(0);
    },
  );
});

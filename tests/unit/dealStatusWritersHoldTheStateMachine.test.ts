/**
 * Audit of 7cc7345 — every writer of a deal's status is held to the state
 * machine, and none can move a row out of its tenant.
 *
 *  - `/api/bulk/deals/update` set any string (DEFECT-0254) — now validated;
 *    and "legacy row, allow re-entry" admitted a soft-DELETED deal, so the
 *    bulk endpoint or the agent could close a deleted deal.
 *  - workflow `update_record` passed `config.updates` straight into the row:
 *    any status, and `organizationId` (a WHERE scoped to the OLD org moved
 *    the row into another tenant).
 *  - the undo took any client {id, previousStage}.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

// It reads every repository under server/storage.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  deals: new Map<number, { id: number; organizationId: number; status: string }>(),
  bulkWrites: [] as Array<{ ids: number[]; updates: Record<string, unknown> }>,
  sets: [] as Array<Record<string, unknown>>,
  lead: { id: 3, organizationId: 5, status: "new" } as { id: number; organizationId: number; status: string },
  leadUpdates: [] as Array<Record<string, unknown>>,
  dealUpdates: [] as Array<Record<string, unknown>>,
  /** When set, the repository's write throws this (a refusal or a lost race). */
  writeThrows: null as Error | null,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getDealsByIds: async (orgId: number, ids: number[]) =>
      ids.map((id) => S.deals.get(id)).filter((d): d is NonNullable<typeof d> => !!d && d.organizationId === orgId),
    bulkUpdateDeals: async (_o: number, ids: number[], updates: Record<string, unknown>) => {
      if (S.writeThrows) throw S.writeThrows;
      return (S.bulkWrites.push({ ids, updates }), ids.length);
    },
    getDeal: async (orgId: number, id: number) => {
      const d = S.deals.get(id);
      return d && d.organizationId === orgId ? d : undefined;
    },
    getLead: async (orgId: number, id: number) => (S.lead.organizationId === orgId && S.lead.id === id ? S.lead : undefined),
    updateDeal: async (_id: number, u: Record<string, unknown>) => {
      if (S.writeThrows) throw S.writeThrows;
      return (S.dealUpdates.push(u), {});
    },
    updateLead: async (_id: number, u: Record<string, unknown>) => (S.leadUpdates.push(u), {}),
    updateProperty: async () => ({}),
  },
  db: {},
}));
vi.mock("../../server/services/dealEvents", () => ({ emitDealStageChanged: vi.fn() }));

beforeEach(() => {
  S.deals = new Map([
    [1, { id: 1, organizationId: 5, status: "closed" }],
    [2, { id: 2, organizationId: 5, status: "deleted" }],
    [3, { id: 3, organizationId: 5, status: "negotiating" }],
  ]);
  S.bulkWrites = [];
  S.sets = [];
  S.leadUpdates = [];
  S.dealUpdates = [];
  S.lead = { id: 3, organizationId: 5, status: "new" };
  S.writeThrows = null;
});

async function bulkApp() {
  const { default: router } = await import("../../server/routes-bulk");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).organization = { id: 5 };
    (req as any).organizationId = 5;
    (req as any).user = { id: "u1" };
    next();
  });
  app.use("/api/bulk", router);
  return app;
}

describe("the state machine has no side door", () => {
  it("a deleted deal cannot change stage", async () => {
    const { validateDealTransition } = await import("@shared/lifecycle/pipeline-status");
    expect(validateDealTransition("deleted", "closed")).toMatch(/deleted deal cannot change stage/);
    expect(validateDealTransition("deleted", "negotiating")).toMatch(/deleted deal cannot change stage/);
    // A genuinely legacy value still re-enters, as documented.
    expect(validateDealTransition("closing", "closed")).toBeNull();
  });

  it("/api/bulk/deals/update refuses an unknown stage, an illegal move, and a deleted deal — and writes nothing", async () => {
    const app = await bulkApp();
    for (const [ids, status] of [[[3], "won"], [[1], "offer_sent"], [[2], "closed"]] as const) {
      const r = await request(app).post("/api/bulk/deals/update").send({ ids, updates: { status } });
      expect(r.status, `${JSON.stringify(ids)} → ${status}`).toBe(400);
    }
    expect(S.bulkWrites).toEqual([]);
  });

  it("/api/bulk/deals/update answers the repository's refusals as 409 / 400 through sendDealWriteError — not 500 (W10.4)", async () => {
    const { StaleDealWriteError, DealTransitionRefusedError } = await import("../../server/storage/dealRepo");
    const app = await bulkApp();
    // The route's own check passed; the deal moved before the write.
    S.writeThrows = new StaleDealWriteError(3, "negotiating");
    const stale = await request(app).post("/api/bulk/deals/update").send({ ids: [3], updates: { status: "offer_sent" } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "CONFLICT", statusCode: 409 });
    S.writeThrows = new DealTransitionRefusedError(3, "Cannot move a deal from negotiating to offer_sent");
    const refused = await request(app).post("/api/bulk/deals/update").send({ ids: [3], updates: { status: "offer_sent" } });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/Cannot move a deal/);
    S.writeThrows = new Error("connection reset");
    const other = await request(app).post("/api/bulk/deals/update").send({ ids: [3], updates: { status: "offer_sent" } });
    expect(other.status).toBe(500);
  });

  it("/api/bulk/deals/update writes a legal move through the repository", async () => {
    const app = await bulkApp();
    const r = await request(app).post("/api/bulk/deals/update").send({ ids: [3], updates: { status: "offer_sent" } });
    expect(r.status).toBe(200);
    expect(S.bulkWrites).toEqual([{ ids: [3], updates: expect.objectContaining({ status: "offer_sent" }) }]);
  });
});

describe("a workflow update_record holds the state machine", () => {
  const run = async (entityType: "deal" | "lead", entityId: number, updates: Record<string, unknown>) => {
    const { workflowEngine } = await import("../../server/services/workflow-engine");
    const engine = workflowEngine as unknown as {
      executeUpdateRecord: (a: unknown, c: unknown) => Promise<unknown>;
      interpolateTemplate: (v: string) => string;
    };
    return engine.executeUpdateRecord(
      { id: "a1", type: "update_record", config: { entityType, updates } },
      { organizationId: 5, triggerData: { entityType, entityId }, variables: {} },
    );
  };

  it("refuses an illegal or unknown deal stage, and a deleted deal", async () => {
    await expect(run("deal", 1, { status: "offer_sent" })).rejects.toThrow(/update_record refused/);
    await expect(run("deal", 3, { status: "won" })).rejects.toThrow(/not a deal stage/);
    await expect(run("deal", 2, { status: "closed" })).rejects.toThrow(/deleted deal cannot change stage/);
    expect(S.dealUpdates).toEqual([]);
  });

  it("refuses an illegal lead status", async () => {
    await expect(run("lead", 3, { status: "closed" })).rejects.toThrow(/update_record refused/);
    expect(S.leadUpdates).toEqual([]);
  });

  it("refuses a type that differs from the trigger's entity (audit of 9ed61f4)", async () => {
    const { workflowEngine } = await import("../../server/services/workflow-engine");
    const engine = workflowEngine as unknown as { executeUpdateRecord: (a: unknown, c: unknown) => Promise<unknown> };
    await expect(
      engine.executeUpdateRecord(
        { id: "a1", type: "update_record", config: { entityType: "deal", updates: { status: "offer_sent" } } },
        { organizationId: 5, triggerData: { entityType: "lead", entityId: 3 }, variables: {} },
      ),
    ).rejects.toThrow(/triggered by a lead/);
    expect(S.dealUpdates).toEqual([]);
  });

  it("a deal another writer moved under it fails the action by name — never reported updated (W10.4)", async () => {
    const { StaleDealWriteError } = await import("../../server/storage/dealRepo");
    S.writeThrows = new StaleDealWriteError(3, "negotiating");
    await expect(run("deal", 3, { status: "offer_sent" })).rejects.toThrow(/update_record refused: deal 3 changed while this workflow was writing it — nothing was written/);
  });

  it("applies a legal move", async () => {
    await run("deal", 3, { status: "offer_sent" });
    expect(S.dealUpdates).toEqual([{ status: "offer_sent" }]);
  });
});

describe("no update moves a row out of its tenant", () => {
  it("assertWritablePatch returns the patch without identity, tenancy or audit columns", async () => {
    const { assertWritablePatch } = await import("../../server/utils/patch");
    expect(
      assertWritablePatch({ organizationId: 99, organization_id: 99, id: 7, createdAt: new Date(), createdBy: "x", status: "closed" }, "t"),
    ).toEqual({ status: "closed" });
    // A patch that was ONLY a tenant move is empty, and refused.
    expect(() => assertWritablePatch({ organizationId: 99 }, "t")).toThrow(/empty patch/);
  });

  /**
   * The population: every `.set(…)` in every repository under server/storage
   * (audit of 9ed61f4: the first version read three repos, and tasks and
   * due diligence carried the same shape a request body reached). A caller's
   * patch may reach the row only through omitProtectedFields — directly, or
   * via assertWritablePatch, which applies it. A spread of anything else, or a
   * bare caller-supplied value passed to `.set`, is the thing that fails.
   *
   * DEFECT-0276 (3): the first version read the patch only where it was
   * spread INLINE and only in `this: DatabaseStorage` methods. A patch copied
   * to a local first (`const patch = { ...updates }; .set(patch)`) and a
   * plain exported helper were outside what it read. It now PARSES, follows
   * the caller's value through locals, rest-destructures, reassignments,
   * for-of and array callbacks, and treats every non-callback function as an
   * entry point whose parameters are caller-supplied. Each shape has a canary
   * in `setGate` below.
   */
  it("every repository write passes a caller's patch through omitProtectedFields", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { resolve, join, relative } = await import("node:path");
    const dir = resolve(__dirname, "../../server/storage");
    const files: string[] = [];
    const walkDir = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walkDir(p);
        else if (f.endsWith(".ts") && !/\.test\./.test(f)) files.push(p);
      }
    };
    walkDir(dir);
    expect(files.length).toBeGreaterThan(30); // vacuity: the repositories are here
    let sets = 0;
    let units = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const r = setGate(readFileSync(f, "utf8"), relative(dir, f));
      sets += r.sets;
      units += r.units;
      offenders.push(...r.offenders);
    }
    expect(sets).toBeGreaterThanOrEqual(140); // vacuity: measured 146 on 2026-09-30, 148 on 2026-10-06
    expect(units, "vacuity: entry functions whose parameters are read as caller-supplied").toBeGreaterThanOrEqual(650); // measured 716 on 2026-10-06
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  /** One fixture per shape the gate claims to read; each must go red. */
  const SHAPES: Record<string, string> = {
    inlineSpread: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set({ ...updates, updatedAt: new Date() }); } };`,
    bareParam: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(updates); } };`,
    localCopy: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = updates; await db.update(t).set(patch); } };`,
    localSpreadCopy: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = { ...updates, updatedAt: new Date() }; await db.update(t).set(patch); } };`,
    localThenSpread: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = updates as Partial<X>; await db.update(t).set({ ...patch }); } };`,
    localChain: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const a = updates; const b = { ...a }; await db.update(t).set(b); } };`,
    reassigned: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { let patch: P = {}; patch = { ...updates }; await db.update(t).set(patch); } };`,
    restDestructure: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const { id: _drop, ...rest } = updates; await db.update(t).set(rest); } };`,
    objectAssign: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = Object.assign({}, updates); await db.update(t).set(patch); } };`,
    forOf: `const r = { async u(this: DatabaseStorage, rows: P[]) { for (const row of rows) await db.update(t).set({ ...row }); } };`,
    arrayCallback: `const r = { async u(this: DatabaseStorage, rows: P[]) { await Promise.all(rows.map((row) => db.update(t).set(row))); } };`,
    exportedFunction: `export async function patchThing(orgId: number, data: Partial<X>) { await db.update(t).set({ ...data }); }`,
    constArrowHelper: `const patchThing = async (orgId: number, data: Partial<X>) => db.update(t).set(data);`,
    plainMethod: `const r = { async u(id: number, updates: P) { const patch = { ...updates }; await db.update(t).set(patch); } };`,
    // W10.4 audit finding 8 — a member of a tainted root, and a copy made by any non-launderer call.
    memberSpread: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set({ ...updates.fields, updatedAt: new Date() }); } };`,
    memberBare: `const r = { async u(this: DatabaseStorage, id: number, input: P) { await db.update(t).set(input.patch); } };`,
    elementAccess: `const r = { async u(this: DatabaseStorage, id: number, input: P) { await db.update(t).set(input["patch"]); } };`,
    memberLocal: `const r = { async u(this: DatabaseStorage, id: number, input: P) { const patch = input.patch; await db.update(t).set({ ...patch }); } };`,
    fromEntries: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(Object.fromEntries(Object.entries(updates))); } };`,
    pick: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(pick(updates, ["status", "organizationId"])); } };`,
    jsonRoundTrip: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(JSON.parse(JSON.stringify(updates))); } };`,
    localHelper: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = toPatch(updates); await db.update(t).set(patch); } };`,
    methodOnTainted: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(updates.toJSON()); } };`,
    // W10.4 re-audit, finding 4 — the shapes the second draft walked past.
    assignByStatement: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = {}; Object.assign(patch, updates); await db.update(t).set(patch); } };`,
    forInCopy: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch: any = {}; for (const k in updates) patch[k] = updates[k]; await db.update(t).set(patch); } };`,
    memberHolder: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch: any = {}; patch.x = updates; await db.update(t).set({ ...patch.x }); } };`,
    arrayDestructure: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const [patch] = [updates]; await db.update(t).set(patch); } };`,
    namedDestructure: `const r = { async u(this: DatabaseStorage, id: number, input: P) { const { patch } = input; await db.update(t).set(patch); } };`,
    andOperand: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(updates && updates); } };`,
    secondArgument: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(updates, undefined); } };`,
    // W10.4 re-audit 2.
    memberPath: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch: any = {}; patch.x = updates.fields; await db.update(t).set({ ...patch.x }); } };`,
    literalHolder: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const o = { p: updates }; await db.update(t).set(o.p); } };`,
    shorthandHolder: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const o = { updates }; await db.update(t).set(o.updates); } };`,
    orAssign: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { let patch: any; patch ||= updates; await db.update(t).set(patch); } };`,
    nullishAssign: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { let patch: any; patch ??= updates; await db.update(t).set(patch); } };`,
    namedClosure: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const write = async (tx: any) => tx.update(t).set(updates); await db.transaction(write); } };`,
    spreadArgument: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(...[updates]); } };`,
    assignIntoMember: `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const h: any = { p: {} }; Object.assign(h.p, updates); await db.update(t).set(h.p); } };`,
  };
  it.each(Object.entries(SHAPES))("the spread gate reads the %s shape", (_shape, src) => {
    const r = setGate(src, "canary.ts");
    expect(r.sets, "vacuity: the .set was not found").toBe(1);
    expect(r.offenders, src).toHaveLength(1);
  });

  it("the spread gate passes the shapes that ARE safe", () => {
    const clean = [
      `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set({ ...omitProtectedFields(updates), updatedAt: new Date() }); } };`,
      `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const safe = omitProtectedFields(updates); await db.update(t).set({ ...safe, updatedAt: new Date() }); } };`,
      `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(assertWritablePatch(updates, "t")); } };`,
      `const r = { async u(this: DatabaseStorage, id: number, status: string) { await db.update(t).set({ status, updatedAt: new Date() }); } };`,
      `const r = { async u(this: DatabaseStorage, id: number) { const [row] = await db.select().from(t); await db.update(t).set({ count: row.count + 1 }); } };`,
      // A launderer wrapping a member or a copy still launders it.
      `const r = { async u(this: DatabaseStorage, id: number, input: P) { await db.update(t).set({ ...omitProtectedFields(input.patch), updatedAt: new Date() }); } };`,
      `const r = { async u(this: DatabaseStorage, id: number, updates: P) { await db.update(t).set(assertWritablePatch(Object.fromEntries(Object.entries(updates)), "t")); } };`,
      // A scalar read from a caller's value, placed under a named key, is not a spread of it.
      `const r = { async u(this: DatabaseStorage, id: number, input: P) { await db.update(t).set({ status: input.status, updatedAt: new Date() }); } };`,
      // A scalar destructured from a caller's value, under a named key, is not a spread of it.
      `const r = { async u(this: DatabaseStorage, id: number, input: P) { const { status } = input; await db.update(t).set({ status, updatedAt: new Date() }); } };`,
      // A named scalar written under a named key is not a copy of the caller's value.
      `const r = { async u(this: DatabaseStorage, id: number, consent: P) { const updates: any = { a: 1 }; updates.reason = consent.reason; updates.source = consent.source || "manual"; await db.update(t).set(updates); } };`,
      // Object.assign into a fresh object from a LAUNDERED value is clean.
      `const r = { async u(this: DatabaseStorage, id: number, updates: P) { const patch = {}; Object.assign(patch, omitProtectedFields(updates)); await db.update(t).set(patch); } };`,
      // A comment naming the shape is not the shape.
      `const r = { async u(this: DatabaseStorage, id: number, updates: P) { /* .set({ ...updates }) was removed */ await db.update(t).set({ ...omitProtectedFields(updates) }); } };`,
    ];
    for (const src of clean) expect(setGate(src, "clean.ts").offenders, src).toEqual([]);
  });
});

/**
 * The spread gate, over one file's source. PARSED, so a comment is never
 * read and a unit's boundary is the parser's, not a bracket walk's.
 *
 * Entry functions: every function-like that is not itself an argument to a
 * call (a callback's parameters are the caller of the callback's business —
 * except an array callback over a caller-supplied array, which is followed).
 * Their parameters are caller-supplied. Taint flows through a local whose
 * initializer is, spreads, assigns or rest-destructures a tainted value,
 * through reassignment, and through for-of. omitProtectedFields and
 * assertWritablePatch launder it.
 */
function setGate(source: string, file: string): { sets: number; units: number; offenders: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const LAUNDER = new Set(["omitProtectedFields", "assertWritablePatch"]);
  const ARRAY_CALLBACKS = new Set(["map", "forEach", "flatMap", "filter", "some", "every", "find"]);
  const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
    ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
  const unwrap = (e: ts.Expression): ts.Expression => {
    let x = e;
    while (ts.isAsExpression(x) || ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAwaitExpression(x) || ts.isSatisfiesExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
    return x;
  };
  const bindingNames = (b: ts.BindingName, out: Set<string>) => {
    if (ts.isIdentifier(b)) out.add(b.text);
    else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  };

  // Taint per entry function, to a fixpoint.
  const tainted = new Map<ts.Node, Set<string>>();
  let units = 0;
  const visitAll = (n: ts.Node, f: (x: ts.Node) => void) => { f(n); ts.forEachChild(n, (c) => visitAll(c, f)); };
  const entries: ts.FunctionLikeDeclaration[] = [];
  visitAll(sf, (n) => {
    if (!isFn(n)) return;
    const isCallback = n.parent && ts.isCallExpression(n.parent) && n.parent.arguments.includes(n as unknown as ts.Expression);
    if (!isCallback) entries.push(n);
  });
  // A named function nested in an entry (`const write = async (tx) =>
  // tx.update(t).set(updates)`, handed to db.transaction BY NAME) closes over
  // its enclosing entry's values: it reads that entry's taint as well as its
  // own (W10.4 re-audit 2).
  const parentEntry = new Map<ts.Node, ts.FunctionLikeDeclaration>();
  for (const fn of entries) {
    for (let p: ts.Node | undefined = fn.parent; p; p = p.parent) {
      if (isFn(p) && entries.includes(p)) {
        parentEntry.set(fn, p);
        break;
      }
    }
  }
  type Taint = { has(k: string): boolean };
  const view = (fn: ts.Node): Taint => ({
    has: (k) => {
      for (let f: ts.Node | undefined = fn; f; f = parentEntry.get(f)) if (tainted.get(f)?.has(k)) return true;
      return false;
    },
  });
  /** `a`, `a.b`, `a["b"]` as a dotted path; null for anything computed. */
  const pathText = (e: ts.Expression): string | null => {
    const x = unwrap(e);
    if (ts.isIdentifier(x)) return x.text;
    if (ts.isPropertyAccessExpression(x)) {
      const base = pathText(x.expression);
      return base === null ? null : `${base}.${x.name.text}`;
    }
    if (ts.isElementAccessExpression(x) && ts.isStringLiteralLike(unwrap(x.argumentExpression))) {
      const base = pathText(x.expression);
      return base === null ? null : `${base}.${(unwrap(x.argumentExpression) as ts.StringLiteralLike).text}`;
    }
    return null;
  };
  for (const fn of entries) {
    const names = new Set<string>();
    for (const p of fn.parameters) {
      if (ts.isIdentifier(p.name) && p.name.text === "this") continue;
      bindingNames(p.name, names);
    }
    if (names.size > 0) units++;
    tainted.set(fn, names);
  }
  const entryOf = (n: ts.Node): ts.FunctionLikeDeclaration | undefined => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (isFn(p) && tainted.has(p)) return p;
    return undefined;
  };
  const isTainted = (e: ts.Expression | undefined, names: Taint): boolean => {
    if (!e) return false;
    const x = unwrap(e);
    if (ts.isIdentifier(x)) return names.has(x.text);
    // A member PATH a caller's value was written to (`patch.x = updates.fields`,
    // `const o = { p: updates }`) is that value.
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
      const pt = pathText(x);
      if (pt !== null && names.has(pt)) return true;
    }
    // A member of a caller-supplied value is caller-supplied: `updates.fields`,
    // `input["patch"]`, `body.deal.updates` (W10.4 audit finding 8).
    if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) return isTainted(x.expression, names);
    if (ts.isObjectLiteralExpression(x)) return x.properties.some((p) => ts.isSpreadAssignment(p) && isTainted(p.expression, names));
    if (ts.isConditionalExpression(x)) return isTainted(x.whenTrue, names) || isTainted(x.whenFalse, names);
    if (
      ts.isBinaryExpression(x) &&
      (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        x.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      return isTainted(x.left, names) || isTainted(x.right, names);
    }
    if (ts.isArrayLiteralExpression(x)) return x.elements.some((el) => isTainted(ts.isSpreadElement(el) ? el.expression : el, names));
    if (ts.isCallExpression(x)) {
      // Only an allowlisted launderer cleans a caller's value. ANY other call
      // that takes one — Object.assign, structuredClone,
      // Object.fromEntries(Object.entries(u)), pick(u, …),
      // JSON.parse(JSON.stringify(u)), a local helper — returns it (or a
      // copy of it) as far as this gate can prove; so does a method called ON
      // one (`updates.toJSON()`).
      const callee = x.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (LAUNDER.has(name)) return false;
      if (x.arguments.some((a) => isTainted(a, names))) return true;
      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) return isTainted(callee.expression, names);
    }
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    visitAll(sf, (n) => {
      const fn = entryOf(n);
      if (!fn) return;
      const own = tainted.get(fn)!;
      const names = view(fn);
      const add = (name: string) => { if (!own.has(name)) { own.add(name); changed = true; } };
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const parentStmt = n.parent?.parent;
        const forOf = parentStmt && ts.isForOfStatement(parentStmt) ? parentStmt : null;
        if (forOf) return; // handled below
        if (ts.isIdentifier(n.name)) {
          if (isTainted(n.initializer, names)) add(n.name.text);
          // An object literal HOLDING a caller's value under a key: `o.p` is it.
          const init = unwrap(n.initializer);
          if (ts.isObjectLiteralExpression(init)) {
            for (const p of init.properties) {
              if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && isTainted(p.initializer, names)) {
                add(`${n.name.text}.${p.name.text}`);
              } else if (ts.isShorthandPropertyAssignment(p) && names.has(p.name.text)) {
                add(`${n.name.text}.${p.name.text}`);
              }
            }
          }
        } else if (isTainted(n.initializer, names)) {
          // Any binding out of a caller's value is a member of it — `const {
          // patch } = input` is `input.patch`, `const [p] = [updates]` is
          // `updates` (W10.4 re-audit, finding 4).
          const s2 = new Set<string>();
          bindingNames(n.name, s2);
          s2.forEach(add);
        }
      }
      if (ts.isForOfStatement(n) && isTainted(n.expression, names) && ts.isVariableDeclarationList(n.initializer)) {
        for (const d of n.initializer.declarations) { const s2 = new Set<string>(); bindingNames(d.name, s2); s2.forEach(add); }
      }
      const ASSIGN = [
        ts.SyntaxKind.EqualsToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandEqualsToken,
      ];
      if (ts.isBinaryExpression(n) && ASSIGN.includes(n.operatorToken.kind) && isTainted(n.right, names)) {
        const left = unwrap(n.left);
        if (ts.isIdentifier(left)) add(left.text); // `patch = updates`
        else if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
          // A MEMBER written from a caller's WHOLE value (`patch.x = updates`)
          // or by a dynamic-key copy (`patch[k] = updates[k]`) taints the
          // object. A named scalar placed under a named key (`patch.status =
          // input.status`) does not — as `{ status: input.status }` does not.
          // Every tainted path through `a || "default"`, `a ?? b`, `c ? a : b` is a named member read.
          const namedMemberOnly = (e: ts.Expression): boolean => {
            const x = unwrap(e);
            if (ts.isPropertyAccessExpression(x)) return true;
            if (ts.isElementAccessExpression(x)) return ts.isStringLiteralLike(unwrap(x.argumentExpression));
            const ok = (side: ts.Expression) => !isTainted(side, names) || namedMemberOnly(side);
            if (ts.isBinaryExpression(x)) {
              const k = x.operatorToken.kind;
              if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.AmpersandAmpersandToken) return ok(x.left) && ok(x.right);
            }
            if (ts.isConditionalExpression(x)) return ok(x.whenTrue) && ok(x.whenFalse);
            return false;
          };
          const scalarMember = namedMemberOnly(n.right);
          let target: ts.Expression = left;
          while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = unwrap(target.expression);
          if (!scalarMember && ts.isIdentifier(target)) add(target.text);
          // Either way the PATH holds the caller's value: `patch.x = updates.fields`
          // then `.set({ ...patch.x })` reads it back.
          const pt = pathText(left);
          if (pt !== null) add(pt);
        }
      }
      // Object.assign(patch, updates) mutates `patch` by statement.
      if (ts.isCallExpression(n) && n.arguments.length > 1 && n.arguments.slice(1).some((a) => isTainted(a, names))) {
        const callee = n.expression;
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
        const first = pathText(n.arguments[0]);
        if (name === "assign" && first !== null) add(first);
      }
      if (isFn(n) && n.parent && ts.isCallExpression(n.parent) && ts.isPropertyAccessExpression(n.parent.expression)) {
        const pa = n.parent.expression;
        if (ARRAY_CALLBACKS.has(pa.name.text) && isTainted(pa.expression, names) && n.parameters[0]) {
          const s2 = new Set<string>();
          bindingNames(n.parameters[0].name, s2);
          s2.forEach(add);
        }
      }
    });
  }

  let sets = 0;
  const offenders: string[] = [];
  visitAll(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "set") return;
    sets++;
    const fn = entryOf(n);
    // Every argument: `.set(updates, undefined)` still passes `updates`.
    // …and a spread argument: `.set(...[updates])`.
    const arg = n.arguments.find((a) => fn && isTainted(ts.isSpreadElement(a) ? a.expression : a, view(fn)));
    if (!fn || !arg) return;
    {
      offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: .set(${arg.getText(sf).slice(0, 60)})`);
    }
  });
  return { sets, units, offenders };
}

describe("the undo restores only what a recorded bulk move changed", () => {
  it("checks the server's own bulk_stage_update record and the deal's current stage", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes.ts"), "utf8"));
    const start = src.indexOf('"/api/deals/bulk-stage-undo"');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("app.", start + 40));
    expect(body).toMatch(/getAuditLogs\(org\.id,\s*\{[^}]*action:\s*"bulk_stage_update"/);
    expect(body).toMatch(/move\.newStage !== deal\.status/);
    const guard = body.indexOf("move.newStage !== deal.status");
    expect(body.indexOf("storage.updateDeal(", guard)).toBeGreaterThan(guard);
  });
});

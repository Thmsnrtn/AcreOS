/**
 * `PATCH /api/buyer-blasts/recipients/:id` with an empty body was a 500.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * Both fields of that route's Zod schema are `.optional()`, so `{}` parses
 * clean and reaches the write with nothing in it. Unlike its sibling routes
 * this patch carries no unconditional `updatedAt`, so Drizzle — which DROPS
 * undefined values from `.set()` — rendered
 *
 *   update "buyer_blast_recipients" set  where …
 *                                     ^^ nothing between SET and WHERE
 *
 * Postgres rejects that as a syntax error, the route's catch turned it into
 * `Errors.internal`, and an authenticated owner sending an empty PATCH got a
 * 500 whose message was about SQL grammar. The rendering mechanism is proven
 * separately, through Drizzle's own PgDialect, in
 * tests/unit/emptyUpdateIsNotAStatement.test.ts.
 *
 * ── WHAT THIS FILE HOLDS ──────────────────────────────────────────────────
 * The route's answer (400, and NO write attempted), plus the semantics of the
 * two helpers the rest of the codebase's 27 guarded writes depend on. The
 * class-wide question — "is there another write that can reach .set() with
 * nothing to set" — is not a matter of listing call sites here; it is answered
 * over the whole program by scripts/check-empty-update-set.mjs, which resolves
 * every `.set()` argument through the type checker and gates at zero. That
 * split is deliberate: a hand-listed set of call sites in a test is exactly
 * the population that goes stale the day someone adds the 28th.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ORG_ID = 42;

const { updateFn, setFn, whereFn, returningRows } = vi.hoisted(() => {
  const returningRows: { current: unknown[] } = { current: [] };
  const whereFn = vi.fn((_cond: unknown) => ({
    returning: () => Promise.resolve(returningRows.current),
  }));
  // The parameter is declared even though the body ignores it. A mock typed
  // `vi.fn(() => …)` has a ZERO-length call tuple, so `setFn.mock.calls[0][0]`
  // — the patch this whole file exists to inspect — is a type error the suite
  // would never have shown, because vitest reads it fine at runtime. That is
  // the exact shape check-tests-typecheck.mjs ratchets, and it caught this one.
  const setFn = vi.fn((_patch: Record<string, unknown>) => ({ where: whereFn }));
  const updateFn = vi.fn((_table: unknown) => ({ set: setFn }));
  return { updateFn, setFn, whereFn, returningRows };
});

vi.mock("../../server/db", () => ({
  db: {
    update: updateFn,
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
  },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/emailService", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

const { registerBuyerBlastRoutes } = await import("../../server/routes-buyer-blasts");
const { hasWritableValues, assertWritablePatch } = await import("../../server/utils/patch");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: ORG_ID };
    req.organizationId = ORG_ID;
    req.user = { id: "user_owner" };
    next();
  });
  registerBuyerBlastRoutes(a);
  return a;
}

beforeEach(() => {
  updateFn.mockClear();
  setFn.mockClear();
  whereFn.mockClear();
  returningRows.current = [{ id: "rec_1", status: "sent" }];
});

describe("an empty PATCH body is a bad request, not a database error", () => {
  it("answers 400 and never reaches the database", async () => {
    const res = await request(app())
      .patch("/api/buyer-blasts/recipients/rec_1")
      .send({});

    expect(res.status).toBe(400);
    expect(String(res.body?.message ?? "")).toMatch(/no fields to update/i);
    // The point is not only the status code. A 400 that still issued the
    // malformed UPDATE would have fixed the message and kept the error.
    expect(updateFn).not.toHaveBeenCalled();
    expect(setFn).not.toHaveBeenCalled();
  });

  it("answers 400 when every supplied field is explicitly undefined", async () => {
    // JSON cannot carry `undefined`, but Zod strips unknown keys, so a body of
    // only-unknown keys lands in the same place: parsed.data === {}.
    const res = await request(app())
      .patch("/api/buyer-blasts/recipients/rec_1")
      .send({ notAField: "x", alsoNot: 3 });

    expect(res.status).toBe(400);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("still performs the update when there IS something to set", async () => {
    const res = await request(app())
      .patch("/api/buyer-blasts/recipients/rec_1")
      .send({ responseNotes: "called back" });

    expect(res.status).toBe(200);
    expect(updateFn).toHaveBeenCalledTimes(1);
    const patch = setFn.mock.calls[0]?.[0];
    expect(patch.responseNotes).toBe("called back");
  });

  it("sets respondedAt on a reply transition — the guard did not eat the real path", async () => {
    await request(app())
      .patch("/api/buyer-blasts/recipients/rec_1")
      .send({ status: "replied_interested" });

    const patch = setFn.mock.calls[0]?.[0];
    expect(patch.status).toBe("replied_interested");
    expect(patch.respondedAt).toBeInstanceOf(Date);
  });
});

describe("the class gate is wired, and wired the way it has to be", () => {
  const PKG = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  it("runs inside npm run check — an unwired gate is a file, not a gate", () => {
    expect(PKG.scripts["lint:empty-update-set"]).toContain(
      "node scripts/check-empty-update-set.mjs",
    );
    expect(
      PKG.scripts.check,
      "lint:empty-update-set is not in the check chain — it would only ever run by hand",
    ).toContain("npm run lint:empty-update-set");
  });

  it("carries an explicit heap ceiling, because its sibling already OOMed without one", () => {
    // check-ghost-fields.mjs builds the same in-process ts.createProgram +
    // getTypeChecker, and on 2026-08-25 was found aborting with 134 (V8 heap
    // OOM) at Node's default ceiling — reporting FEWER findings than existed,
    // silently. This gate peaks around 3.2 GB on the same program. The lesson
    // was paid for once; it does not need paying for twice.
    expect(PKG.scripts["lint:empty-update-set"]).toMatch(/--max-old-space-size=\d+/);
  });

  it("the gate file states its population floors, so a stalled parse cannot pass", () => {
    const gate = readFileSync(
      path.resolve(process.cwd(), "scripts/check-empty-update-set.mjs"),
      "utf8",
    );
    // Not a style check: the floors are the only thing separating "clean" from
    // "the walk stopped matching". Their presence is the assertion; their
    // values live in the gate and are asserted by the gate itself at runtime.
    for (const floor of ["FILE_FLOOR", "SET_CALL_FLOOR", "UPDATE_SET_FLOOR"]) {
      expect(gate, `${floor} is gone — the gate can now pass over an empty scan`)
        .toContain(floor);
    }
  });
});

describe("the two helpers the guarded writes depend on", () => {
  it("hasWritableValues is false for the shapes Drizzle renders as empty", () => {
    expect(hasWritableValues({})).toBe(false);
    expect(hasWritableValues({ a: undefined })).toBe(false);
    expect(hasWritableValues({ a: undefined, b: undefined })).toBe(false);
    expect(hasWritableValues(null)).toBe(false);
    expect(hasWritableValues(undefined)).toBe(false);
  });

  it("hasWritableValues is true for values Drizzle keeps — null included", () => {
    // `null` is NOT dropped: `set x = null` is a well-formed statement and a
    // meaningful one. Treating it as empty would refuse a legitimate clear.
    expect(hasWritableValues({ a: null })).toBe(true);
    expect(hasWritableValues({ a: 0 })).toBe(true);
    expect(hasWritableValues({ a: "" })).toBe(true);
    expect(hasWritableValues({ a: false })).toBe(true);
    expect(hasWritableValues({ a: undefined, b: 1 })).toBe(true);
  });

  it("assertWritablePatch returns the patch it was given, unchanged", () => {
    const patch = { status: "queued" };
    expect(assertWritablePatch(patch, "t.m")).toBe(patch);
  });

  it("assertWritablePatch throws — naming the write — on an empty patch", () => {
    expect(() => assertWritablePatch({}, "payments.updatePayment"))
      .toThrow(/payments\.updatePayment/);
    expect(() => assertWritablePatch({ a: undefined }, "payments.updatePayment"))
      .toThrow(/empty patch/i);
  });

  it("throwing is not a regression — the unguarded path already threw", () => {
    // This is why every internal write could be guarded in one pass without
    // reading each caller: the malformed statement was ALREADY an exception,
    // raised by Postgres, several layers away from the caller. The guard moves
    // the throw to the call site and gives it a name. Nothing that used to
    // succeed now fails.
    let sqlShaped: string | null = null;
    try {
      assertWritablePatch({ a: undefined }, "organizations.update");
    } catch (err) {
      sqlShaped = err instanceof Error ? err.message : null;
    }
    expect(sqlShaped).toMatch(/set  where/);
  });
});

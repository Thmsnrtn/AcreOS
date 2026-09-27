/**
 * DEFECT-0105 — a FAILED outward action retried by two workers runs once.
 *
 * `withOutwardAction` re-claimed a `failed` row with an UPDATE by id alone.
 * Two workers that both read `failed` both flipped it to in_flight and both
 * called exec() — two letters in one mailbox, two charges. The re-claim is now
 * conditional on the row still being `failed`; exactly one UPDATE matches.
 *
 * The drizzle operators are markers so the double can honour the one
 * predicate this property depends on (`status = 'failed'`), and both workers'
 * reads are held at a barrier so they genuinely race.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  sql: Object.assign(() => ({ op: "sql" }), { raw: () => ({ op: "sql" }) }),
}));
const T = vi.hoisted(() => ({
  outwardActions: { id: "col:id", status: "col:status", organizationId: "col:org", actionKind: "col:kind", idempotencyKey: "col:key", attempts: "col:attempts" },
}));
vi.mock("@shared/schema", () => ({ outwardActions: T.outwardActions }));

const S = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  readers: 0,
  release: null as null | (() => void),
}));

function eqs(cond: unknown, out: Array<{ col: unknown; val: unknown }> = []) {
  const c = cond as { op?: string; col?: unknown; val?: unknown; a?: unknown[] };
  if (c?.op === "eq") out.push({ col: c.col, val: c.val });
  for (const x of c?.a ?? []) eqs(x, out);
  return out;
}

vi.mock("../../server/db", () => {
  const barrier = new Promise<void>((r) => (S.release = r));
  return {
    db: {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              S.readers++;
              if (S.readers === 2) S.release!();
              await barrier; // both workers read `failed` before either writes
              return [{ ...S.row }];
            },
          }),
        }),
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: (cond: unknown) => {
            const wantStatus = eqs(cond).find((e) => e.col === T.outwardActions.status)?.val;
            const applies = wantStatus === undefined || S.row!.status === wantStatus;
            if (applies) S.row = { ...S.row!, ...v, status: v.status ?? S.row!.status };
            const res = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
            res.returning = async () => (applies ? [{ id: S.row!.id }] : []);
            return res;
          },
        }),
      }),
    },
  };
});

const { withOutwardAction, requestHash, ActionInFlightError } = await import("../../server/services/actions/outwardAction");

describe("a failed outward action retried concurrently executes once (DEFECT-0105)", () => {
  it("two workers race the retry: one sends, the other refuses as in-flight", async () => {
    const payload = { to: "Bea Rowe", piece: "letter_10" };
    S.row = {
      id: 1,
      organizationId: 5,
      actionKind: "physical_mail.letter",
      idempotencyKey: "note:77:demand",
      requestHash: requestHash(payload),
      status: "failed",
      externalId: null,
      attempts: 1,
    };
    let execs = 0;
    const spec = { organizationId: 5, actionKind: "physical_mail.letter", idempotencyKey: "note:77:demand", payload };
    const run = () =>
      withOutwardAction(
        spec,
        async () => {
          execs++;
          return { status: "succeeded" as const, externalId: `ltr_${execs}`, result: execs };
        },
        () => -1,
      );
    const results = await Promise.allSettled([run(), run()]);
    expect(execs).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ActionInFlightError);
  });
});

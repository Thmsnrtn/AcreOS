/**
 * L-DEF-3 — a provider-failed letter can be corrected and re-sent.
 *
 * The Land journey walk's dead end, end to end through `withOutwardAction`
 * (not just the pure classifier):
 *
 *   1. Lob DEFINITIVELY rejects a letter (422, bad recipient address). The
 *      transport's wrapped error carries the `providerNotBilled` verdict —
 *      proof Lob accepted nothing. The claim must be recorded `failed`,
 *      not `ambiguous`: an unknown-outcome recording would refuse every
 *      later attempt even before content is considered.
 *   2. The operator fixes the address and re-queues the SAME letter (same
 *      durable key, corrected payload). The claim must EXECUTE, and the
 *      stored hash must be superseded by the corrected payload's hash, so
 *      the key is now bound to the corrected content.
 *   3. Safety, unchanged: once an attempt SUCCEEDS, different content under
 *      the same key still refuses; an attempt whose outcome is UNKNOWN
 *      (plain throw, no proof) is recorded `ambiguous` and refuses every
 *      later attempt, corrected or not.
 *
 * The drizzle operators are markers so the double can honour the one
 * predicate the re-claim depends on (`status = 'failed'`), as in
 * outwardActionRetryIsSingleWinner.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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
}));

function eqs(cond: unknown, out: Array<{ col: unknown; val: unknown }> = []) {
  const c = cond as { op?: string; col?: unknown; val?: unknown; a?: unknown[] };
  if (c?.op === "eq") out.push({ col: c.col, val: c.val });
  for (const x of c?.a ?? []) eqs(x, out);
  return out;
}

vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (S.row ? [{ ...S.row }] : []),
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const wantStatus = eqs(cond).find((e) => e.col === T.outwardActions.status)?.val;
          const applies = wantStatus === undefined || S.row!.status === wantStatus;
          if (applies) S.row = { ...S.row!, ...v, status: (v.status as string) ?? S.row!.status };
          const res = Promise.resolve(undefined) as Promise<undefined> & { returning: () => Promise<unknown[]> };
          res.returning = async () => (applies ? [{ id: S.row!.id }] : []);
          return res;
        },
      }),
    }),
  },
}));

const {
  withOutwardAction,
  requestHash,
  ActionKeyReusedError,
  ActionAmbiguousError,
  ProviderNotContactedError,
} = await import("../../server/services/actions/outwardAction");

const KIND = "physical_mail.letter";
const KEY = "offer-letter:3";
const ORIGINAL = {
  recipientName: "LAND Seller One",
  recipientAddress: { line1: "1 Fabricated St", city: "Bastrop", state: "TX", zip: "78602" },
  htmlContent: "<p>Offer enclosed</p>",
};
const CORRECTED = {
  ...ORIGINAL,
  recipientAddress: { line1: "44 Corrected Rd", city: "Bastrop", state: "TX", zip: "78602" },
};

function seedRow(over: Record<string, unknown> = {}) {
  S.row = {
    id: 9,
    organizationId: 108,
    actionKind: KIND,
    idempotencyKey: KEY,
    requestHash: requestHash(ORIGINAL),
    status: "failed",
    externalId: null,
    attempts: 1,
    ...over,
  };
}

const spec = (payload: unknown) => ({ organizationId: 108, actionKind: KIND, idempotencyKey: KEY, payload });
const succeed = (id: string) => async () => ({ status: "succeeded" as const, externalId: id, result: id });

beforeEach(() => seedRow());

describe("the corrected re-send (L-DEF-3)", () => {
  it("a FAILED letter re-queued with a corrected address executes, and the key re-binds to the corrected content", async () => {
    const out = await withOutwardAction(spec(CORRECTED), succeed("ltr_new"), () => "replay");
    expect(out).toBe("ltr_new");
    expect(S.row!.status).toBe("succeeded");
    expect(S.row!.requestHash).toBe(requestHash(CORRECTED));
    // A third attempt with the corrected content now REPLAYS the recorded
    // success instead of executing again…
    const again = await withOutwardAction(spec(CORRECTED), succeed("ltr_dup"), (externalId) => `replayed:${externalId}`);
    expect(again).toBe("replayed:ltr_new");
    // …and a third attempt with yet-different content refuses: the safety
    // property followed the corrected payload, it was not waived.
    await expect(
      withOutwardAction(spec({ ...CORRECTED, htmlContent: "<p>Different offer</p>" }), succeed("ltr_dup2"), () => "replay"),
    ).rejects.toBeInstanceOf(ActionKeyReusedError);
  });

  it("a FAILED letter re-queued with identical content still executes (plain retry unchanged)", async () => {
    const out = await withOutwardAction(spec(ORIGINAL), succeed("ltr_same"), () => "replay");
    expect(out).toBe("ltr_same");
    expect(S.row!.status).toBe("succeeded");
    expect(S.row!.requestHash).toBe(requestHash(ORIGINAL));
  });
});

describe("what gets recorded as `failed` — only provably-unperformed attempts", () => {
  it("an error carrying the provider-not-billed verdict is recorded FAILED, not ambiguous", async () => {
    // Lob answered 422 for the recipient address; directMailService wraps
    // that with withBillingVerdict, stamping providerNotBilled: true.
    // (The double always takes the existing-row path: a prior `failed` row
    // re-executes, then this attempt's exec throws the rejection.)
    const rejected = Object.assign(new Error("Failed to send letter: The 'to' address does not meet your minimum deliverability strictness"), { providerNotBilled: true });
    await expect(
      withOutwardAction(spec(ORIGINAL), async () => { throw rejected; }, () => "replay"),
    ).rejects.toBe(rejected);
    expect(S.row!.status).toBe("failed");
    // And because it is `failed`, the corrected re-send is now possible.
    const out = await withOutwardAction(spec(CORRECTED), succeed("ltr_fixed"), () => "replay");
    expect(out).toBe("ltr_fixed");
  });

  it("a ProviderNotContactedError is recorded FAILED", async () => {
    seedRow();
    const refused = new ProviderNotContactedError("AcreOS mail is not available on this deployment yet.");
    await expect(
      withOutwardAction(spec(ORIGINAL), async () => { throw refused; }, () => "replay"),
    ).rejects.toBe(refused);
    expect(S.row!.status).toBe("failed");
  });

  it("an error stamped providerNotBilled: false is NOT a proof — recorded AMBIGUOUS", async () => {
    // The polarity: only an affirmative verdict counts. A stamp that says
    // the provider may have billed is the unknown case, not a retry pass.
    seedRow();
    const unknown = Object.assign(new Error("Failed to send letter: socket hang up"), { providerNotBilled: false });
    await expect(
      withOutwardAction(spec(ORIGINAL), async () => { throw unknown; }, () => "replay"),
    ).rejects.toBe(unknown);
    expect(S.row!.status).toBe("ambiguous");
  });

  it("a plain throw with no proof is recorded AMBIGUOUS and refuses even the identical retry", async () => {
    seedRow();
    const boom = new Error("socket hang up");
    await expect(
      withOutwardAction(spec(ORIGINAL), async () => { throw boom; }, () => "replay"),
    ).rejects.toBe(boom);
    expect(S.row!.status).toBe("ambiguous");
    await expect(
      withOutwardAction(spec(ORIGINAL), succeed("ltr_dup"), () => "replay"),
    ).rejects.toBeInstanceOf(ActionAmbiguousError);
    await expect(
      withOutwardAction(spec(CORRECTED), succeed("ltr_dup"), () => "replay"),
    ).rejects.toBeInstanceOf(ActionKeyReusedError);
  });
});

describe("the safety property, intact", () => {
  it("a SUCCEEDED letter still refuses different content under the same key", async () => {
    seedRow({ status: "succeeded", externalId: "ltr_sent" });
    await expect(
      withOutwardAction(spec(CORRECTED), succeed("ltr_dup"), () => "replay"),
    ).rejects.toBeInstanceOf(ActionKeyReusedError);
    expect(S.row!.status).toBe("succeeded");
  });

  it("a SUCCEEDED letter with identical content replays instead of re-sending", async () => {
    seedRow({ status: "succeeded", externalId: "ltr_sent" });
    const out = await withOutwardAction(spec(ORIGINAL), succeed("ltr_dup"), (externalId) => `replayed:${externalId}`);
    expect(out).toBe("replayed:ltr_sent");
  });
});

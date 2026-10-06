/**
 * Audit of the fourth follow-up — the ACH settlement is a payment writer too.
 *
 * A debit submitted while a note was active can settle days after the lender
 * accelerated it. The settlement posts (the money moved), but it used to flip
 * the note back to `active` — re-arming autopay, reminders and the fee sweep —
 * and it asked the late-fee assessor without the note's status, so the
 * "no monthly fee on an accelerated note" rule never ran on this path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const S = vi.hoisted(() => ({
  lockedStatus: "defaulted",
  statusWritten: undefined as string | undefined,
  /** Overrides on the locked note row (its schedule terms). */
  locked: {} as Record<string, unknown>,
  nextWritten: undefined as Date | undefined,
  assessedWith: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/notes/servicedLateFees", async (orig) => ({
  ...(await orig<typeof import("../../server/services/notes/servicedLateFees")>()),
  assessServicedNoteLateFee: async (note: Record<string, unknown>) => {
    S.assessedWith.push(note);
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: "test" };
  },
}));
vi.mock("../../server/db", () => {
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({ returning: async () => [{ id: 501, ...v }] }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [{ id: 42, currentBalance: "10000.00", nextPaymentDate: new Date("2026-09-01T00:00:00Z"), amortizationSchedule: [], version: 3, status: S.lockedStatus, ...S.locked }],
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            S.statusWritten = v.status as string;
            S.nextWritten = v.nextPaymentDate as Date;
            return [{ id: 42 }];
          },
        }),
      }),
    }),
  };
  return { db: {}, withTransaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
});

import { dbAchAutopayStore } from "../../server/services/achAutopay";

const NOTE = {
  id: 42,
  organizationId: 7,
  borrowerId: 9,
  status: "defaulted",
  autoPayEnabled: true,
  monthlyPayment: "100.00",
  serviceFee: null,
  taxEscrowEnabled: false,
  monthlyTaxEscrow: null,
  currentBalance: "10000.00",
  interestRate: "6",
  lateFee: "25",
  gracePeriodDays: 10,
  nextPaymentDate: new Date("2026-09-01T00:00:00Z"),
};
const ATTEMPT = { id: 3, amountCents: 10_000, dueDate: new Date("2026-09-01T00:00:00Z") };

beforeEach(() => {
  S.lockedStatus = "defaulted";
  S.statusWritten = undefined;
  S.assessedWith = [];
  S.locked = {};
  S.nextWritten = undefined;
});

async function settle(attempt: Partial<typeof ATTEMPT> = {}) {
  return dbAchAutopayStore.postSettlement({
    note: NOTE as never,
    attempt: { ...ATTEMPT, ...attempt } as never,
    paymentIntentId: "pi_1",
    settledAt: new Date("2026-09-20T00:00:00Z"),
  });
}

describe("an ACH settlement on a note accelerated since the debit started", () => {
  it("posts the money and leaves the note defaulted", async () => {
    const r = await settle();
    expect(r.created).toBe(true);
    expect(S.statusWritten).toBe("defaulted");
  });

  it("asks the late-fee rule WITH the note's status, so no monthly fee is assessed on it", async () => {
    await settle();
    expect(S.assessedWith[0]).toMatchObject({ status: "defaulted" });
  });

  it("an active note settles as active (the rule did not freeze statuses)", async () => {
    S.lockedStatus = "active";
    await settle();
    expect(S.statusWritten).toBe("active");
  });
});

describe("the settlement steps the note's OWN schedule (W10.5: one coverage rule for every writer)", () => {
  it("a note due on the 31st returns to the 31st after February", async () => {
    S.lockedStatus = "active";
    S.locked = {
      firstPaymentDate: new Date("2026-01-31T00:00:00Z"),
      termMonths: 24,
      nextPaymentDate: new Date("2026-02-28T00:00:00Z"), // installment 2, clamped to February's end
    };
    await settle({ dueDate: new Date("2026-02-28T00:00:00Z") });
    expect(S.nextWritten?.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("a debit for an installment the note already moved past posts, but does not advance the date again", async () => {
    // A card payment covered Sep 1 while the debit settled: the note is on Oct 1.
    S.lockedStatus = "active";
    S.locked = { nextPaymentDate: new Date("2026-10-01T00:00:00Z") };
    const r = await settle();
    expect(r.created).toBe(true);
    expect(S.nextWritten?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("the same installment with a different time of day (a lender's edit) still advances — identity is the UTC day", async () => {
    S.lockedStatus = "active";
    S.locked = { nextPaymentDate: new Date("2026-09-01T17:30:00Z") };
    await settle();
    expect(S.nextWritten?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("a note with no recorded schedule still steps one month from its due date", async () => {
    S.lockedStatus = "active";
    await settle();
    expect(S.nextWritten?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

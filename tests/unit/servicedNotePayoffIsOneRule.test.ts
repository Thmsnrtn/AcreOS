/**
 * DEFECT-0100 — every serviced-note payoff comes from the one engine.
 *
 * The operations agent's `processPayoff` skill computed its own payoff:
 * interest accrued from the NEXT due date instead of the last payment, a
 * 2–3% "early payoff discount" no note contains (it reduced what a borrower
 * owes on the agent's say-so), a 30-day validity, rows in the legacy
 * `payoff_quotes` table. The borrower portal already used the canonical
 * engine. Both now call `quoteServicedNotePayoff`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const NOTE = {
  id: 77,
  organizationId: 5,
  borrowerId: 9,
  currentBalance: "10000.00",
  interestRate: "6",
  monthlyPayment: "500.00",
  startDate: new Date("2026-01-01T00:00:00Z"),
  nextPaymentDate: new Date("2026-10-01T00:00:00Z"),
  status: "active",
};
const LEDGER = [
  { id: 1, status: "completed", paymentDate: new Date("2026-09-01T15:00:00Z"), interestAmount: "50.00" },
];
const H = vi.hoisted(() => ({ inserts: [] as Array<Record<string, unknown>>, legacyWrites: 0 }));

vi.mock("../../server/storage", () => ({
  storage: {
    getNote: vi.fn(async (org: number, id: number) => (org === 5 && id === 77 ? NOTE : undefined)),
    getPayments: vi.fn(async () => LEDGER),
    getLead: vi.fn(async () => ({ id: 9, firstName: "Bea", lastName: "Rowe" })),
    // The servicing read (W10.2a): a note's borrower, deleted or not.
    getBorrowerLead: vi.fn(async () => ({ id: 9, firstName: "Bea", lastName: "Rowe" })),
    createPayoffQuote: vi.fn(async () => {
      H.legacyWrites++;
      return { id: 1 };
    }),
  },
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: `q-${H.inserts.length + 1}`, ...v };
          H.inserts.push(row);
          return [row];
        },
      }),
    }),
  },
}));
vi.mock("../../server/db", () => {
  const step: Record<string, unknown> = {};
  Object.assign(step, {
    from: () => step,
    where: () => step,
    limit: () => step,
    then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve([{ timezone: "America/Chicago" }]).then(ok, no),
  });
  return { db: { select: () => step } };
});

const { skillRegistry } = await import("../../server/services/agent-skills");
const { computePayoffQuote, payoffInputsFromServicedNote, parseIsoDateUtc } = await import("../../server/services/notePaymentMath");

beforeEach(() => {
  H.inserts.length = 0;
  H.legacyWrites = 0;
});

describe("processPayoff skill quotes through the canonical engine (DEFECT-0100)", () => {
  it("the amount equals the engine's, good through the payoff date, recorded in note_payoff_quotes", async () => {
    const skill = skillRegistry.getSkillById("processPayoff")!;
    expect(skill, "vacuity: the skill is registered").toBeDefined();
    const r = await skill.execute({ noteId: 77, effectiveDate: "2099-09-15" }, { organizationId: 5, userId: "u-1" });
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);

    const expected = computePayoffQuote(
      payoffInputsFromServicedNote({
        note: { currentBalance: NOTE.currentBalance, interestRate: NOTE.interestRate, startDate: "2026-01-01" },
        ledgerRows: [{ paymentDate: "2026-09-01", interestAmount: "50.00" }],
        payoffDate: parseIsoDateUtc("2099-09-15"),
      }),
    );
    expect(Math.round(r.data.payoffAmount * 100)).toBe(expected.totalPayoffCents);
    expect(r.data.goodThroughDate).toBe("2099-09-15");
    expect(r.data.breakdown.accrualStartDate).toBe("2026-09-01"); // the last payment, not the next due date
    expect(H.inserts).toHaveLength(1);
    expect(H.inserts[0]).toMatchObject({ noteSystem: "serviced_note", noteRef: "77", channel: "operator_api", quotedByUserId: "u-1" });
    expect(H.legacyWrites).toBe(0);
  });

  it("asking for an early-payoff discount changes nothing — no invented term", async () => {
    const skill = skillRegistry.getSkillById("processPayoff")!;
    const plain = await skill.execute({ noteId: 77, effectiveDate: "2099-09-15" }, { organizationId: 5 });
    const asked = await skill.execute({ noteId: 77, effectiveDate: "2099-09-15", includeEarlyPayoffDiscount: true }, { organizationId: 5 });
    expect(asked.data.payoffAmount).toBe(plain.data.payoffAmount);
    expect(asked.data.discountNote).toMatch(/No early-payoff discount/);
  });

  it("a past payoff date is refused", async () => {
    const skill = skillRegistry.getSkillById("processPayoff")!;
    const r = await skill.execute({ noteId: 77, effectiveDate: "2001-01-01" }, { organizationId: 5 });
    expect(r.success).toBe(false);
  });
});

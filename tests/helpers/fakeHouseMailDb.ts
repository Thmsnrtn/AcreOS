/**
 * A fake of the three statements mail/mailLane.ts `chargeHouseMail` runs, for
 * unit tests that drive a send path without a database:
 *
 *   1. the ledger claim  — INSERT financial_ledger … ON CONFLICT DO NOTHING
 *      RETURNING (unique on externalEventId);
 *   2. the balance debit — UPDATE organizations … WHERE purchased ≥ charge
 *      RETURNING (no row when purchased credits are short);
 *   3. the debit row     — INSERT credit_transactions.
 *
 * What the real SQL does (the grant exclusion, atomicity, the pool never
 * paying) is proven against Postgres in houseMailPurchasedOnly.realdb.test.ts.
 *
 * Use:
 *   vi.mock("../../server/db", async () => (await import("../helpers/fakeHouseMailDb")).fakeHouseMailDbModule);
 * and read / reset `houseMail` from this module in the test.
 */
import { getTableName, type Table } from "drizzle-orm";

// Tables are matched by NAME, not identity: after vi.resetModules() the send
// path holds a fresh @shared/schema instance this module never imported.
const nameOf = (t: unknown) => getTableName(t as Table);

interface HouseMailState {
  /** Purchased credits the fake balance can pay. */
  purchased: number;
  /** Every charge taken (claim + debit committed). */
  charges: Array<{ externalEventId: string; credits: number; organizationId: number }>;
  reset(purchased?: number): void;
}

// On globalThis, so a test that calls vi.resetModules() (which re-instantiates
// this module behind the mocked db) still reads the state the send path wrote.
const g = globalThis as { __fakeHouseMailState?: HouseMailState };
export const houseMail: HouseMailState = (g.__fakeHouseMailState ??= {
  purchased: 10_000,
  charges: [],
  reset(purchased = 10_000) {
    this.purchased = purchased;
    this.charges = [];
  },
});

function fakeTx() {
  let pending: { externalEventId: string; credits: number; organizationId: number } | null = null;
  return {
    insert(table: unknown) {
      return {
        values(v: any) {
          if (nameOf(table) === "credit_transactions") return Promise.resolve([]);
          if (nameOf(table) !== "financial_ledger") throw new Error("fakeHouseMailDb: unexpected insert");
          const chain = {
            onConflictDoNothing: () => chain,
            returning: async () => {
              if (houseMail.charges.some((c) => c.externalEventId === v.externalEventId)) return [];
              pending = { externalEventId: v.externalEventId, credits: -v.amountCents, organizationId: v.organizationId };
              return [{ id: houseMail.charges.length + 1 }];
            },
          };
          return chain;
        },
      };
    },
    select() {
      const chain: any = { from: () => chain, where: () => chain, limit: async () => [] };
      return chain;
    },
    update(table: unknown) {
      if (nameOf(table) !== "organizations") throw new Error("fakeHouseMailDb: unexpected update");
      const chain: any = {
        set: () => chain,
        where: () => chain,
        returning: async () => {
          if (!pending || houseMail.purchased < pending.credits) return [];
          houseMail.purchased -= pending.credits;
          houseMail.charges.push(pending);
          pending = null;
          return [{ newBalance: houseMail.purchased }];
        },
      };
      return chain;
    },
  };
}

export const fakeHouseMailDbModule = {
  db: {},
  withTransaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx()),
};

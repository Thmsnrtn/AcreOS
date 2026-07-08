/**
 * Tier 2C — applyReferralCode (server/services/referralService.ts).
 *
 * The referee is ALWAYS the authenticated user (the old /apply route's
 * body-supplied refereeId let any authed user attribute arbitrary users to
 * arbitrary codes — that hole is closed). These tests run the service
 * against a hand-rolled in-memory users + referrals store, with drizzle
 * WHERE expressions rendered to SQL via PgDialect and interpreted as ANDed
 * `col = $n` / `col IS NULL` conditions (same pattern as
 * tests/unit/approvalKernel.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => ({
  tables: {
    users: [] as any[],
    referrals: [] as any[],
  } as Record<string, any[]>,
  nextId: 1,
}));

vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const { getTableName } = await import("drizzle-orm");

  const COLUMN_TO_PROP: Record<string, string> = {
    id: "id",
    referral_code: "referralCode",
    referrer_id: "referrerId",
    referee_id: "refereeId",
    code: "code",
    status: "status",
    credit_amount: "creditAmount",
    credited_at: "creditedAt",
    created_at: "createdAt",
  };

  // Render a drizzle WHERE expression and interpret it as ANDed
  // equality / IS NULL conditions.
  const matcher = (expr: unknown) => {
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(expr as any);
    const conds: Array<(row: any) => boolean> = [];
    const eqRe = /"([a-z_]+)" = \$(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = eqRe.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`referral mock: unmapped column ${m[1]}`);
      const value = params[Number(m[2]) - 1];
      conds.push((row) => row[prop] === value);
    }
    const nullRe = /"([a-z_]+)" is null/g;
    while ((m = nullRe.exec(sql)) !== null) {
      const prop = COLUMN_TO_PROP[m[1]];
      if (!prop) throw new Error(`referral mock: unmapped column ${m[1]}`);
      conds.push((row) => row[prop] === null || row[prop] === undefined);
    }
    if (conds.length === 0) throw new Error(`referral mock: no conditions in: ${sql}`);
    return (row: any) => conds.every((c) => c(row));
  };

  const db = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        const rows = mem.tables[getTableName(table as any)];
        return {
          where: (expr: unknown) => {
            const matched = rows.filter(matcher(expr));
            const result = {
              limit: async (n: number) => matched.slice(0, n),
              then: (onOk: any, onErr: any) => Promise.resolve(matched).then(onOk, onErr),
            };
            return result;
          },
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (expr: unknown) => {
          const rows = mem.tables[getTableName(table as any)];
          const matched = rows.filter(matcher(expr));
          for (const row of matched) Object.assign(row, patch);
          return {
            returning: async () => matched,
            then: (onOk: any, onErr: any) => Promise.resolve(matched).then(onOk, onErr),
          };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const insertOne = () => {
          mem.tables[getTableName(table as any)].push({ id: mem.nextId++, ...vals });
        };
        return {
          onConflictDoNothing: async () => {
            // referrals.code is UNIQUE — honor it like Postgres would.
            const name = getTableName(table as any);
            if (
              name === "referrals" &&
              mem.tables.referrals.some((r) => r.code === vals.code)
            ) {
              return;
            }
            insertOne();
          },
          then: (onOk: any, onErr: any) => {
            insertOne();
            return Promise.resolve(undefined).then(onOk, onErr);
          },
        };
      },
    }),
  };

  return { db };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { applyReferralCode } from "../../server/services/referralService";

function seedReferrer(opts: { userId?: string; code?: string; withRow?: boolean } = {}) {
  const userId = opts.userId ?? "user_referrer";
  const code = opts.code ?? "ABC12345";
  mem.tables.users.push({ id: userId, referralCode: code });
  if (opts.withRow !== false) {
    mem.tables.referrals.push({
      id: mem.nextId++,
      referrerId: userId,
      refereeId: null,
      code,
      status: "pending",
    });
  }
  return { userId, code };
}

beforeEach(() => {
  mem.tables.users = [];
  mem.tables.referrals = [];
  mem.nextId = 1;
});

describe("applyReferralCode", () => {
  it("claims the referrer's pending code row for the new signup", async () => {
    const { code } = seedReferrer();
    const result = await applyReferralCode(code, "user_new");
    expect(result).toEqual({ applied: true });
    const row = mem.tables.referrals[0];
    expect(row.refereeId).toBe("user_new");
    expect(row.status).toBe("signed_up");
  });

  it("normalizes lowercase codes (the ?ref= param is case-insensitive)", async () => {
    const { code } = seedReferrer();
    const result = await applyReferralCode(code.toLowerCase(), "user_new");
    expect(result).toEqual({ applied: true });
    expect(mem.tables.referrals[0].refereeId).toBe("user_new");
  });

  it("rejects malformed codes before touching the database", async () => {
    expect(await applyReferralCode("a", "user_new")).toEqual({
      applied: false,
      reason: "invalid_code",
    });
    expect(await applyReferralCode("has spaces!", "user_new")).toEqual({
      applied: false,
      reason: "invalid_code",
    });
  });

  it("rejects codes no referrer owns", async () => {
    seedReferrer({ code: "REALCODE" });
    expect(await applyReferralCode("FAKECODE", "user_new")).toEqual({
      applied: false,
      reason: "unknown_code",
    });
  });

  it("rejects self-referral", async () => {
    const { userId, code } = seedReferrer();
    expect(await applyReferralCode(code, userId)).toEqual({
      applied: false,
      reason: "self_referral",
    });
  });

  it("a user can be referred at most once — first code wins", async () => {
    const a = seedReferrer({ userId: "user_a", code: "AAAA1111" });
    const b = seedReferrer({ userId: "user_b", code: "BBBB2222" });

    expect(await applyReferralCode(a.code, "user_new")).toEqual({ applied: true });
    // Second, different code → refused; first attribution stands.
    expect(await applyReferralCode(b.code, "user_new")).toEqual({
      applied: false,
      reason: "already_referred",
    });
    const rowA = mem.tables.referrals.find((r) => r.code === a.code)!;
    const rowB = mem.tables.referrals.find((r) => r.code === b.code)!;
    expect(rowA.refereeId).toBe("user_new");
    expect(rowB.refereeId).toBeNull();
  });

  it("re-applying the SAME code is idempotent (UTM flush + manual route can both fire)", async () => {
    const { code } = seedReferrer();
    expect(await applyReferralCode(code, "user_new")).toEqual({ applied: true });
    expect(await applyReferralCode(code, "user_new")).toEqual({ applied: true });
    // Still exactly one referral row, still the same referee.
    expect(mem.tables.referrals).toHaveLength(1);
    expect(mem.tables.referrals[0].refereeId).toBe("user_new");
  });

  it("refuses an exhausted code instead of stealing attribution", async () => {
    const { code } = seedReferrer();
    expect(await applyReferralCode(code, "user_first")).toEqual({ applied: true });
    expect(await applyReferralCode(code, "user_second")).toEqual({
      applied: false,
      reason: "code_exhausted",
    });
    expect(mem.tables.referrals[0].refereeId).toBe("user_first");
  });

  it("creates the row when the referrer's code predates the tracking-row convention", async () => {
    const { userId, code } = seedReferrer({ withRow: false });
    expect(await applyReferralCode(code, "user_new")).toEqual({ applied: true });
    expect(mem.tables.referrals).toHaveLength(1);
    expect(mem.tables.referrals[0]).toMatchObject({
      referrerId: userId,
      refereeId: "user_new",
      code,
      status: "signed_up",
    });
  });
});

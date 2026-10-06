/**
 * W10.4 audit finding 1 — the market-network staging list under concurrent
 * closes.
 *
 * Below the privacy cohort, a closed sale is STAGED in one agent_memory row
 * per county+state, rewritten whole (delete + insert). A bulk close runs N
 * close hooks at once; each read the list before any wrote, so N closes in one
 * county left one staged entry — and two closes crossing the threshold
 * together flushed the staged entries twice. The dedupe read, the cohort count
 * and the write now run in one transaction under a per-county advisory lock.
 *
 * The handle below models just the statements contributeClosedDealToNetwork
 * and withdrawStagedNetworkContribution issue, with every read resolving
 * after a delay (two connections reading the same state) and the advisory
 * lock a real per-key mutex. Reads answer from state through their rendered
 * WHERE — the deal's status by its id, the pool's dedupe count by the dealKey
 * it names — so a predicate that stopped filtering would be seen (W10.4
 * re-audit, finding 6: the first draft answered `n: 0` to every pool read).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const H = vi.hoisted(() => ({
  staged: null as null | { entries: Array<Record<string, unknown>> },
  metrics: [] as Array<Record<string, unknown>>,
  locks: new Map<string, Promise<void>>(),
  lockKeys: [] as string[],
  /** deal id → status; a deal not listed is closed. */
  status: new Map<number, string>(),
  /** The staging row's key (`staging_<county>_<ST>`). */
  stagedKey: "staging_Llano_TX",
  /** Deals hard-deleted (purged): reads by id find nothing. */
  gone: new Set<number>(),
  /** The county the deal's property names NOW (an edit after the close moves it). */
  county: new Map<number, string>(),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/sophiePrivacyGuard", () => ({
  consentingOrgIds: async () => new Set<number>(),
  sophiePrivacyGuard: { hasConsent: async () => true },
}));
vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const later = <T>(v: () => T) => new Promise<T>((res) => setTimeout(() => res(v()), 5));
  const name = (t: unknown) => getTableName(t as Parameters<typeof getTableName>[0]);
  const make = (onLock: (k: string) => Promise<void>) => ({
    select: () => ({
      from: (t: unknown) => {
        const table = name(t);
        let where: { sql: string; params: unknown[] } = { sql: "", params: [] };
        // Read the state when the statement EXECUTES; answer after the delay.
        const answer = () => {
          if (table === "deals") {
            // Every deals read here is by (id, org): the id is the first parameter.
            const id = Number(where.params[0]);
            if (!/"deals"\."id" = \$1/.test(where.sql)) throw new Error(`deals read not by id: ${where.sql}`);
            if (H.gone.has(id)) return [];
            return [{ type: "disposition", status: H.status.get(id) ?? "closed", dealValue: "50000", closingDate: null, propertyId: 3, apn: "123-45", county: H.county.get(id) ?? "Llano", state: "TX", sizeAcres: "10", zoning: null }];
          }
          if (table === "notes") return [];
          if (table === "market_metrics") {
            if (/'dealKey'/.test(where.sql)) {
              const key = where.params[where.params.length - 1];
              return [{ n: H.metrics.filter((m) => (m.economicData as { dealKey?: unknown }).dealKey === key).length }];
            }
            if (/"county" = /.test(where.sql)) return [{ n: H.metrics.length }]; // every row here is Llano, TX
            throw new Error(`unexpected market_metrics read: ${where.sql}`);
          }
          if (table === "agent_memory") {
            if (!H.staged) return [];
            // The withdrawal's lookup BY dealKey: `value->'entries' @> '[{"dealKey": …}]'`.
            if (/@>/.test(where.sql)) {
              const want = (JSON.parse(String(where.params[where.params.length - 1])) as Array<{ dealKey: string }>)[0].dealKey;
              if (!H.staged.entries.some((e) => e.dealKey === want)) return [];
            }
            return [{ key: H.stagedKey, value: JSON.parse(JSON.stringify(H.staged)) }];
          }
          throw new Error(`unexpected read of ${table}`);
        };
        const c: Record<string, unknown> = {};
        c.innerJoin = () => c;
        c.where = (w: unknown) => ((where = dialect.sqlToQuery(w as never)), c);
        c.limit = () => c;
        c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
          const snapshot = answer();
          return later(() => snapshot).then(f, r);
        };
        return c;
      },
    }),
    delete: (t: unknown) => ({
      where: async () => {
        if (name(t) === "agent_memory") H.staged = null;
      },
    }),
    insert: (t: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        if (name(t) === "agent_memory") H.staged = v.value as { entries: Array<Record<string, unknown>> };
        else if (name(t) === "market_metrics") H.metrics.push(v);
      },
    }),
    execute: async (q: unknown) => {
      const r = dialect.sqlToQuery(q as never);
      if (/pg_advisory_xact_lock/.test(r.sql)) await onLock(String(r.params[0]));
      return [];
    },
  });
  const db = make(async () => {
    throw new Error("advisory xact lock outside a transaction");
  });
  const withTransaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const held: Array<{ key: string; release: () => void }> = [];
    const tx = make(async (key) => {
      while (H.locks.has(key)) await H.locks.get(key);
      let release!: () => void;
      H.locks.set(key, new Promise<void>((res) => (release = res)));
      H.lockKeys.push(key);
      held.push({ key, release });
    });
    try {
      return await fn(tx);
    } finally {
      for (const h of held) {
        H.locks.delete(h.key);
        h.release();
      }
    }
  };
  return { db, withTransaction };
});

import {
  closedSaleDealKey,
  contributeClosedDealToNetwork,
  withdrawStagedNetworkContribution,
} from "../../server/services/marketNetworkContributor";
import { withTransaction } from "../../server/db";
import { sql } from "drizzle-orm";

beforeEach(() => {
  H.staged = null;
  H.metrics = [];
  H.locks.clear();
  H.lockKeys = [];
  H.status = new Map();
  H.gone = new Set();
  H.county = new Map();
  H.stagedKey = "staging_Llano_TX";
});

const stagedKeys = () => (H.staged?.entries ?? []).map((e) => e.dealKey);

describe("concurrent closes in one county stage every contribution", () => {
  it("four closes at once → four staged entries, none lost", async () => {
    const results = await Promise.all([11, 12, 13, 14].map((dealId) => contributeClosedDealToNetwork(dealId, 100 + dealId)));
    expect(results.every((r) => r.contributed === false && /^Staged for Llano, TX/.test(r.reason))).toBe(true);
    expect(H.staged?.entries).toHaveLength(4);
    expect(new Set(H.staged!.entries.map((e) => e.dealKey)).size).toBe(4);
    expect(H.lockKeys).toEqual(Array(4).fill("market_network_staging:Llano:TX"));
  });

  it("two closes crossing the cohort together flush the staged entries ONCE", async () => {
    await Promise.all([11, 12, 13].map((dealId) => contributeClosedDealToNetwork(dealId, 100 + dealId)));
    expect(H.staged?.entries).toHaveLength(3);
    await Promise.all([14, 15].map((dealId) => contributeClosedDealToNetwork(dealId, 100 + dealId)));
    // 3 staged + 2 new = 5 contributions, each written to the pool exactly once.
    const keys = H.metrics.map((m) => (m.economicData as { dealKey: string }).dealKey);
    expect(keys).toHaveLength(new Set(keys).size);
    expect(H.metrics.length + (H.staged?.entries.length ?? 0)).toBe(5);
  });
});

describe("re-audit — the dedupe reads the dealKey, and a reversed sale never enters the pool", () => {
  it("a deal whose dealKey is already pooled is not contributed again; another deal's pooled row does not block it", async () => {
    H.metrics.push({ economicData: { dealKey: closedSaleDealKey(111, 11) } });
    expect(await contributeClosedDealToNetwork(12, 112)).toMatchObject({ contributed: false, reason: expect.stringMatching(/^Staged/) });
    expect(await contributeClosedDealToNetwork(11, 111)).toEqual({ contributed: false, reason: "Deal already contributed" });
    expect(stagedKeys()).toEqual([closedSaleDealKey(112, 12)]);
  });

  it("an undo that lands while the close waits on the county lock: nothing is staged", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = withTransaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"market_network_staging:Llano:TX"}))`);
      await gate;
    });
    const pending = contributeClosedDealToNetwork(11, 111);
    await new Promise((r) => setTimeout(r, 30)); // evidence read (closed) done; now parked on the lock
    H.status.set(11, "in_escrow");
    release();
    await holder;
    expect(await pending).toEqual({ contributed: false, reason: "Deal is not closed" });
    expect(stagedKeys()).toEqual([]);
  });

  it("a reopen withdraws the deal's STAGED entry; one closed again keeps it", async () => {
    await contributeClosedDealToNetwork(11, 111);
    await contributeClosedDealToNetwork(12, 112);
    expect(stagedKeys()).toHaveLength(2);
    // Deal 12 was closed again by the time its reopen hook ran.
    expect(await withdrawStagedNetworkContribution(112, 12)).toBe("none");
    H.status.set(11, "in_escrow");
    expect(await withdrawStagedNetworkContribution(111, 11)).toBe("withdrawn");
    expect(stagedKeys()).toEqual([closedSaleDealKey(112, 12)]);
    expect(H.lockKeys.filter((k) => k === "market_network_staging:Llano:TX")).toHaveLength(4);
  });

  it("an already-pooled sale is reported, never edited (DEFECT-0235 is the founder's)", async () => {
    H.metrics.push({ economicData: { dealKey: closedSaleDealKey(111, 11) } });
    H.status.set(11, "in_escrow");
    expect(await withdrawStagedNetworkContribution(111, 11)).toBe("pooled");
    expect(H.metrics).toHaveLength(1);
  });
});

describe("re-audit 2 — the withdrawal finds the entry by its dealKey, not by where the deal is now", () => {
  it("the staged list records its county and state", async () => {
    await contributeClosedDealToNetwork(11, 111);
    expect(H.staged).toMatchObject({ county: "Llano", state: "TX" });
  });

  it("a PURGED deal (no row to read) still has its staged entry withdrawn", async () => {
    await contributeClosedDealToNetwork(11, 111);
    await contributeClosedDealToNetwork(12, 112);
    H.gone.add(11);
    expect(await withdrawStagedNetworkContribution(111, 11)).toBe("withdrawn");
    expect(stagedKeys()).toEqual([closedSaleDealKey(112, 12)]);
  });

  it("a deal whose property was moved to another county after the close: the entry where it WAS staged is withdrawn", async () => {
    await contributeClosedDealToNetwork(11, 111);
    H.county.set(11, "Burnet");
    H.status.set(11, "in_escrow");
    expect(await withdrawStagedNetworkContribution(111, 11)).toBe("withdrawn");
    expect(stagedKeys()).toEqual([]);
    expect(H.lockKeys.at(-1)).toBe("market_network_staging:Llano:TX");
  });

  it("a list written before it recorded its county is located by its KEY — even for a purged or moved deal", async () => {
    await contributeClosedDealToNetwork(11, 111);
    await contributeClosedDealToNetwork(12, 112);
    H.staged = { entries: H.staged!.entries }; // legacy shape: no county/state in the value
    H.gone.add(11); // purged: no location to read
    expect(await withdrawStagedNetworkContribution(111, 11)).toBe("withdrawn");
    H.county.set(12, "Burnet"); // moved since the close
    H.status.set(12, "in_escrow");
    expect(await withdrawStagedNetworkContribution(112, 12)).toBe("withdrawn");
    expect(stagedKeys()).toEqual([]);
    expect(H.lockKeys.slice(-2)).toEqual(["market_network_staging:Llano:TX", "market_network_staging:Llano:TX"]);
  });

  it("a county whose name has an underscore is still split at the state", async () => {
    await contributeClosedDealToNetwork(11, 111);
    H.staged = { entries: H.staged!.entries };
    H.stagedKey = "staging_Fort_Bend_TX";
    H.status.set(11, "in_escrow");
    await withdrawStagedNetworkContribution(111, 11);
    expect(H.lockKeys.at(-1)).toBe("market_network_staging:Fort_Bend:TX");
  });
});

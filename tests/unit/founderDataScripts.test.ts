/**
 * Founder rulings 2026-09-29 #9b, #9c, #10 — the data scripts do exactly what
 * the ruling authorised, and nothing without --apply.
 *
 * The scripts run against production only by the founder's hand
 * (docs/company/founder-decisions-2026-09-29.md). These tests drive each
 * script's core against a recording client: a dry run issues no write, an
 * applied run writes only the authorised rows, secrets are never read back,
 * and every deletion is exported first.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Queryable } from "../../scripts/data/_client";
import { numericPrecisionReport } from "../../scripts/data/numeric-precision-report";
import { nullPlaintextVendorKeys } from "../../scripts/data/null-plaintext-vendor-keys";
import { deletePollutedMarketRows, findPollutedMonthlyRows, type MarketRow } from "../../scripts/data/delete-polluted-market-rows";

function recorder(answer: (sql: string, params?: unknown[]) => unknown[]) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client: Queryable = {
    async query<T>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: answer(sql, params) as T[] };
    },
  };
  return { client, calls, writes: () => calls.filter((c) => /\b(UPDATE|DELETE|INSERT|ALTER|DROP)\b/i.test(c.sql)) };
}

const row = (o: Partial<MarketRow>): MarketRow => ({
  id: 1,
  county: "Luna",
  state: "NM",
  metric_date: "2026-01-01",
  period_type: "monthly",
  organization_id: null,
  median_price_per_acre: "1000",
  data_sources: null,
  ...o,
});

describe("#10 — numeric precision report is read-only", () => {
  it("runs inside a READ ONLY transaction, rolls back, and never writes", async () => {
    const r = recorder((sql) =>
      /information_schema/.test(sql)
        ? [{ table_name: "notes", column_name: "current_balance" }]
        : /count\(\*\)/.test(sql)
          ? [{ n: "10", max_scale: 4, max_abs: "123.4567", round_n: "3", reject_n: "0" }]
          : [],
    );
    const report = await numericPrecisionReport(r.client);
    expect(r.calls[0].sql).toMatch(/READ ONLY/);
    expect(r.calls.at(-1)?.sql).toBe("ROLLBACK");
    expect(r.writes()).toEqual([]);
    expect(report).toEqual([
      { table: "notes", column: "current_balance", rows: 10, maxScale: 4, maxAbs: "123.4567", wouldRound: 3, wouldReject: 0 },
    ]);
  });
});

describe("#9b — plain-text vendor secrets", () => {
  const answer = (sql: string) => (/^SELECT/.test(sql.trim()) ? [{ id: 4, provider: "stripe", key_last4: "9x2Q" }] : []);

  it("a dry run lists the rows and changes nothing", async () => {
    const r = recorder(answer);
    const out = await nullPlaintextVendorKeys(r.client, false);
    expect(out.affected).toEqual([{ id: 4, provider: "stripe", keyLast4: "9x2Q" }]);
    expect(r.writes()).toEqual([]);
  });

  it("never reads the secret back, and --apply nulls only vendor rows", async () => {
    const r = recorder(answer);
    await nullPlaintextVendorKeys(r.client, true);
    const selected = r.calls[0].sql.match(/SELECT\s+([\s\S]*?)\s+FROM/i)?.[1] ?? "";
    expect(selected).toMatch(/key_last4/); // the parser really read the column list
    expect(selected).not.toMatch(/\bapi_key\b/);
    const update = r.writes();
    expect(update).toHaveLength(1);
    expect(update[0].sql).toMatch(/SET api_key = NULL/);
    expect(update[0].sql).toMatch(/provider = ANY/);
    expect((update[0].params?.[1] as string[]).includes("stripe")).toBe(true);
  });
});

describe("#9c — polluted market rows", () => {
  it("follows the chain: a re-published single deal, and every copy of it", () => {
    const rows = [
      row({ id: 1, period_type: "transaction", metric_date: "2026-01-01", median_price_per_acre: "4200" }),
      row({ id: 2, metric_date: "2026-02-01", median_price_per_acre: "4200" }),
      row({ id: 3, metric_date: "2026-03-01", median_price_per_acre: "4200.00" }),
      row({ id: 4, metric_date: "2026-04-01", median_price_per_acre: "3100" }), // real data arrived
      row({ id: 5, metric_date: "2026-05-01", median_price_per_acre: "3100" }), // copies a CLEAN row
    ];
    expect(findPollutedMonthlyRows(rows).map((r) => r.id)).toEqual([2, 3]);
  });

  it("keeps raw contributions, org-owned rows, and rows with data sources", () => {
    const rows = [
      row({ id: 1, period_type: "transaction", median_price_per_acre: "4200" }),
      row({ id: 2, metric_date: "2026-02-01", median_price_per_acre: "4200", data_sources: [{ sourceId: 3 }] }),
      row({ id: 3, metric_date: "2026-02-02", median_price_per_acre: "4200", organization_id: 9 }),
    ];
    expect(findPollutedMonthlyRows(rows)).toEqual([]);
  });

  it("a dry run deletes nothing; --apply exports first, then deletes in one transaction", async () => {
    const data = [
      row({ id: 1, period_type: "transaction", median_price_per_acre: "4200" }),
      row({ id: 2, metric_date: "2026-02-01", median_price_per_acre: "4200" }),
    ];
    const dry = recorder((sql) => (/^SELECT/.test(sql.trim()) ? data : []));
    const outDir = mkdtempSync(join(tmpdir(), "acre-export-"));
    const d = await deletePollutedMarketRows(dry.client, { apply: false, outDir });
    expect(d.polluted.map((p) => p.id)).toEqual([2]);
    expect(dry.writes()).toEqual([]);

    const wet = recorder((sql) => (/^SELECT/.test(sql.trim()) ? data : []));
    const a = await deletePollutedMarketRows(wet.client, { apply: true, outDir });
    expect(a.exportPath && existsSync(a.exportPath)).toBe(true);
    expect(JSON.parse(readFileSync(a.exportPath!, "utf8")).map((p: MarketRow) => p.id)).toEqual([2]);
    const seq = wet.calls.map((c) => c.sql.trim().split(/\s+/)[0]);
    expect(seq.slice(1)).toEqual(["BEGIN", "DELETE", "COMMIT"]);
    expect(wet.writes()[0].params).toEqual([[2]]);
    expect(wet.writes()[0].sql).toMatch(/period_type = 'monthly'/);
  });
});

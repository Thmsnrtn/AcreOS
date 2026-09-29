/**
 * Founder rulings 2026-09-29 #9a–#9d, #10 — the data scripts do exactly what
 * the ruling authorised, and nothing without --apply.
 *
 * The scripts run against production only by the founder's hand
 * (docs/company/founder-decisions-2026-09-29.md). These tests drive each
 * script's core against a recording client: a dry run issues no write, an
 * applied run writes only the authorised rows, secrets are never read back,
 * and every deletion is exported first.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Queryable } from "../../scripts/data/_client";
import { numericPrecisionReport } from "../../scripts/data/numeric-precision-report";
import { nullPlaintextVendorKeys } from "../../scripts/data/null-plaintext-vendor-keys";
import { deletePollutedMarketRows, findPollutedMonthlyRows, type MarketRow } from "../../scripts/data/delete-polluted-market-rows";
import { exportAndDropPayoffQuotes } from "../../scripts/data/export-and-drop-payoff-quotes";
import { deleteOrphanPhotoAndVisionRows, ORPHAN_TARGETS } from "../../scripts/data/delete-orphan-photo-and-vision-rows";
import { readdirSync } from "node:fs";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

// It reads every server/shared/client file (the "nothing reads the table" check).
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

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

describe("#9a — legacy payoff_quotes", () => {
  const table = [{ id: 1, total_payoff: "1000" }, { id: 2, total_payoff: "2000" }];
  const answer = (sql: string) =>
    /to_regclass/.test(sql) ? [{ reg: "payoff_quotes" }] : /count\(\*\)/.test(sql) ? [{ n: "2" }] : /^SELECT \*/.test(sql.trim()) ? table : [];

  it("a dry run counts and changes nothing", async () => {
    const r = recorder(answer);
    const out = await exportAndDropPayoffQuotes(r.client, { apply: false, outDir: mkdtempSync(join(tmpdir(), "pq-")) });
    expect(out).toMatchObject({ exists: true, rows: 2, dropped: false });
    expect(r.writes()).toEqual([]);
  });

  it("--apply exports every row, re-counts inside the transaction, then drops", async () => {
    const r = recorder(answer);
    const out = await exportAndDropPayoffQuotes(r.client, { apply: true, outDir: mkdtempSync(join(tmpdir(), "pq-")) });
    expect(JSON.parse(readFileSync(out.exportPath!, "utf8"))).toEqual(table);
    const seq = r.calls.map((c) => c.sql.trim().replace(/\s+/g, " "));
    expect(seq.slice(-4)).toEqual(["BEGIN", "SELECT count(*) AS n FROM payoff_quotes", "DROP TABLE payoff_quotes", "COMMIT"]);
  });

  it("a row that appeared after the export aborts the drop", async () => {
    const r = recorder((sql) => (/count\(\*\)/.test(sql) ? [{ n: "3" }] : answer(sql)));
    await expect(
      exportAndDropPayoffQuotes(r.client, { apply: true, outDir: mkdtempSync(join(tmpdir(), "pq-")) }),
    ).rejects.toThrow(/changed since the export/);
    expect(r.calls.map((c) => c.sql.trim()).includes("DROP TABLE payoff_quotes")).toBe(false);
    expect(r.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("nothing in the app reads or declares the table any more", () => {
    const hits = ["server", "shared", "client/src"].flatMap((dir) =>
      (readdirSync(dir, { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
        .filter((f) => /\bpayoffQuotes\b|pgTable\("payoff_quotes"|\/api\/payoff-quotes/.test(stripComments(readFileSync(join(dir, f), "utf8"))))
        .map((f) => join(dir, f)),
    );
    expect(hits).toEqual([]);
  });
});

describe("#9d — photo and vision rows that point at nothing", () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    rehab_photos: [{ id: "p1", s3_key: "rehabs/r1/p1.jpg" }, { id: "p2", s3_key: "pending" }],
    field_scout_photos: [{ id: 3, url: "/uploads/field-scout/abc" }],
    property_vision_snapshots: [],
  };
  const answer = (sql: string) => {
    const t = ORPHAN_TARGETS.find((x) => sql.startsWith(`SELECT * FROM ${x.table} `));
    return t ? rows[t.table] : [];
  };

  it("a stored s3:// photo is never a target, and vision rows are bounded to the fabricated era", () => {
    const where = Object.fromEntries(ORPHAN_TARGETS.map((t) => [t.table, t.where]));
    expect(where.rehab_photos).toBe(`s3_key NOT LIKE 's3://%'`);
    expect(where.field_scout_photos).toBe(`url NOT LIKE 's3://%'`);
    // Not `TRUE`: a real vision model configured later keeps its snapshots.
    expect(where.property_vision_snapshots).toMatch(/^captured_at < '2026-09-29'$/);
  });

  it("a dry run counts and changes nothing", async () => {
    const r = recorder(answer);
    const out = await deleteOrphanPhotoAndVisionRows(r.client, { apply: false, outDir: "unused" });
    expect(out.counts).toEqual({ rehab_photos: 2, field_scout_photos: 1, property_vision_snapshots: 0 });
    expect(out.applied).toBe(false);
    expect(r.writes()).toEqual([]);
  });

  it("--apply exports each table, then deletes exactly the exported ids and only while they still match", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "orphans-"));
    const r = recorder(answer);
    const out = await deleteOrphanPhotoAndVisionRows(r.client, { apply: true, outDir });
    expect(out.exports).toHaveLength(2); // the empty table exports and deletes nothing
    for (const f of out.exports) expect(existsSync(f)).toBe(true);
    expect(JSON.parse(readFileSync(out.exports[0], "utf8"))).toEqual(rows.rehab_photos);
    const deletes = r.writes();
    expect(deletes.map((d) => d.sql)).toEqual([
      `DELETE FROM rehab_photos WHERE id = ANY($1) AND (s3_key NOT LIKE 's3://%')`,
      `DELETE FROM field_scout_photos WHERE id = ANY($1) AND (url NOT LIKE 's3://%')`,
    ]);
    expect(deletes[0].params).toEqual([["p1", "p2"]]);
    const seq = r.calls.map((c) => c.sql.split(/\s+/)[0]);
    expect(seq.slice(3)).toEqual(["BEGIN", "DELETE", "COMMIT", "BEGIN", "DELETE", "COMMIT"]);
  });
});

describe("every founder data script is a dry run unless --apply", () => {
  const scripts = readdirSync("scripts/data").filter((f) => f.endsWith(".ts") && !f.startsWith("_"));
  it("the population is the scripts that exist", () => {
    expect(scripts.length).toBeGreaterThanOrEqual(4);
  });
  it.each(scripts)("%s gates every write on the apply flag or is read-only", (f) => {
    const code = stripComments(readFileSync(join("scripts/data", f), "utf8"));
    const writes = /\b(UPDATE|DELETE|DROP|ALTER|INSERT)\b/.test(code);
    if (writes) expect(code).toMatch(/\bapply\b/);
    else expect(code).toMatch(/READ ONLY/);
  });
});

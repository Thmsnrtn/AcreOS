/**
 * Open-Data Program 2.1/2.2 — IRS SOI migration + Census BPS permits ETL.
 *
 * Covers the pure CSV parsers (sample lines below are REAL rows fetched from
 * the live upstreams on 2026-07-13 — countyinflow2223.csv,
 * countyoutflow2223.csv, co2023a.txt), the inflow/outflow join, and the
 * handlers' year-probing + watermark-skip behaviour via `_runtime` injection.
 * No Postgres needed — upsert paths are exercised by the orchestrator tests.
 */

import { describe, it, expect } from "vitest";

import {
  parseIrsMigrationCsv,
  joinIrsMigrationFlows,
  parseCensusBpsCountyCsv,
  irsSoiMigrationEtlHandler,
  censusBpsPermitsEtlHandler,
  type CountyMigrationUpsertRow,
  type BpsCountyPermitRow,
} from "../../server/services/etlHandlers";
import type { EtlRecord } from "../../server/services/etlOrchestrator";

// ─── Real sample data (fetched 2026-07-13) ──────────────────────────────────

const IRS_INFLOW_SAMPLE = [
  "y2_statefips,y2_countyfips,y1_statefips,y1_countyfips,y1_state,y1_countyname,n1,n2,agi",
  "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,2148,4413,138794",
  "01,001,97,000,AL,Autauga County Total Migration-US,2120,4345,135795",
  "01,001,97,001,AL,Autauga County Total Migration-Same State,1357,2588,77614",
  "01,001,97,003,AL,Autauga County Total Migration-Different State,763,1757,58181",
  "01,001,98,000,AL,Autauga County Total Migration-Foreign,28,68,2998",
  "01,001,01,001,AL,Autauga County Non-migrants,20045,43150,1531683",
  "01,001,01,051,AL,Elmore County,443,842,25847",
  "01,003,96,000,AL,Baldwin County Total Migration-US and Foreign,7573,14221,643854",
].join("\n");

const IRS_OUTFLOW_SAMPLE = [
  "y1_statefips,y1_countyfips,y2_statefips,y2_countyfips,y2_state,y2_countyname,n1,n2,agi",
  "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,1920,3869,118308",
  "01,001,97,000,AL,Autauga County Total Migration-US,1888,3759,115092",
  "01,001,01,001,AL,Autauga County Non-migrants,20045,43150,1531683",
  "01,003,96,000,AL,Baldwin County Total Migration-US and Foreign,5593,9559,398374",
].join("\n");

const BPS_SAMPLE = [
  "Survey,FIPS,FIPS,Region,Division,County,,1-unit,,,2-units,,,3-4 units,,,5+ units,,,1-unit rep,,,2-units rep,,,3-4 units rep,,, 5+units rep",
  "Date,State,County,Code,Code,Name,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value,Bldgs,Units,Value",
  " ",
  "2023,01,001,3,6,Autauga County                ,260,260,91554102,0,0,0,0,0,0,0,0,0,260,260,91554102,0,0,0,0,0,0,0,0,0",
  "2023,01,003,3,6,Baldwin County                ,3316,3316,1025068820,8,16,2437900,4,16,3482480,61,1015,138604202,3232,3232,1010428188,8,16,2437900,4,16,3482480,61,1015,138604202",
  "2023,23,000,1,1,Maine Unorganized Territory   ,110,110,14608025,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0",
].join("\n");

// ─── IRS parser ──────────────────────────────────────────────────────────────

describe("parseIrsMigrationCsv", () => {
  it("extracts only the 96/000 'Total Migration-US and Foreign' summary rows", () => {
    const totals = parseIrsMigrationCsv(IRS_INFLOW_SAMPLE, "inflow");
    expect(totals).toEqual([
      { stateFips: "01", countyFips: "001", returns: 2148, individuals: 4413, agiThousands: 138794 },
      { stateFips: "01", countyFips: "003", returns: 7573, individuals: 14221, agiThousands: 643854 },
    ]);
  });

  it("parses the outflow orientation with the same column positions", () => {
    const totals = parseIrsMigrationCsv(IRS_OUTFLOW_SAMPLE, "outflow");
    expect(totals).toEqual([
      { stateFips: "01", countyFips: "001", returns: 1920, individuals: 3869, agiThousands: 118308 },
      { stateFips: "01", countyFips: "003", returns: 5593, individuals: 9559, agiThousands: 398374 },
    ]);
  });

  it("maps the IRS suppression marker (-1) to null instead of a fake count", () => {
    const csv = [
      "y2_statefips,y2_countyfips,y1_statefips,y1_countyfips,y1_state,y1_countyname,n1,n2,agi",
      "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,-1,-1,138794",
    ].join("\n");
    const [row] = parseIrsMigrationCsv(csv, "inflow");
    expect(row).toEqual({
      stateFips: "01",
      countyFips: "001",
      returns: null,
      individuals: null,
      agiThousands: 138794,
    });
  });

  it("throws on header drift (wrong file orientation) instead of mis-keying", () => {
    expect(() => parseIrsMigrationCsv(IRS_OUTFLOW_SAMPLE, "inflow")).toThrow(/header/);
    expect(() => parseIrsMigrationCsv(IRS_INFLOW_SAMPLE, "outflow")).toThrow(/header/);
  });

  it("throws on a non-numeric cell instead of coercing", () => {
    const csv = [
      "y2_statefips,y2_countyfips,y1_statefips,y1_countyfips,y1_state,y1_countyname,n1,n2,agi",
      "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,d,4413,138794",
    ].join("\n");
    expect(() => parseIrsMigrationCsv(csv, "inflow")).toThrow(/unparseable/);
  });
});

describe("joinIrsMigrationFlows", () => {
  it("computes net returns/AGI as inflow minus outflow", () => {
    const rows = joinIrsMigrationFlows(
      "2223",
      parseIrsMigrationCsv(IRS_INFLOW_SAMPLE, "inflow"),
      parseIrsMigrationCsv(IRS_OUTFLOW_SAMPLE, "outflow"),
    );
    const autauga = rows.find((r) => r.stateFips === "01" && r.countyFips === "001");
    expect(autauga).toMatchObject({
      filingYear: "2223",
      inflowReturns: 2148,
      outflowReturns: 1920,
      netReturns: 228,
      netAgiThousands: 138794 - 118308,
    });
  });

  it("leaves net null when one side is missing or suppressed — never fabricates", () => {
    const rows = joinIrsMigrationFlows(
      "2223",
      [{ stateFips: "48", countyFips: "377", returns: 120, individuals: 210, agiThousands: 5000 }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].netReturns).toBeNull();
    expect(rows[0].netAgiThousands).toBeNull();
    expect(rows[0].inflowReturns).toBe(120);

    const suppressed = joinIrsMigrationFlows(
      "2223",
      [{ stateFips: "48", countyFips: "377", returns: null, individuals: null, agiThousands: null }],
      [{ stateFips: "48", countyFips: "377", returns: 80, individuals: 150, agiThousands: 3000 }],
    );
    expect(suppressed[0].netReturns).toBeNull();
    expect(suppressed[0].outflowReturns).toBe(80);
  });
});

// ─── Census BPS parser ───────────────────────────────────────────────────────

describe("parseCensusBpsCountyCsv", () => {
  it("splits units into single-family (1-unit) and multi-family (2 + 3-4 + 5+)", () => {
    const rows = parseCensusBpsCountyCsv(BPS_SAMPLE, 2023);
    expect(rows).toEqual([
      {
        stateFips: "01",
        countyFips: "001",
        year: 2023,
        totalUnits: 260,
        singleFamilyUnits: 260,
        multiFamilyUnits: 0,
      },
      {
        stateFips: "01",
        countyFips: "003",
        year: 2023,
        totalUnits: 3316 + 16 + 16 + 1015,
        singleFamilyUnits: 3316,
        multiFamilyUnits: 16 + 16 + 1015,
      },
      // Maine Unorganized Territory (county FIPS 000) is skipped — not a county.
    ]);
  });

  it("throws on header drift", () => {
    expect(() => parseCensusBpsCountyCsv("nope\nstill nope\n", 2023)).toThrow(/header/);
  });

  it("throws when a row's survey year doesn't match the file year", () => {
    expect(() => parseCensusBpsCountyCsv(BPS_SAMPLE, 2022)).toThrow(/does not match/);
  });
});

// ─── Handler fetch flows (via _runtime injection) ────────────────────────────

async function collect(gen: AsyncGenerator<EtlRecord, void, void>): Promise<EtlRecord[]> {
  const out: EtlRecord[] = [];
  for await (const r of gen) out.push(r);
  return out;
}

describe("irsSoiMigrationEtlHandler.fetch", () => {
  const NOW_2026 = new Date("2026-07-13T00:00:00Z");

  function stubRuntime(availableYear: string) {
    const requested: string[] = [];
    irsSoiMigrationEtlHandler._runtime = {
      now: () => NOW_2026,
      exists: async (url) => url.includes(`countyinflow${availableYear}.csv`),
      download: async (url) => {
        requested.push(url);
        if (url.includes(`countyinflow${availableYear}.csv`)) return IRS_INFLOW_SAMPLE;
        if (url.includes(`countyoutflow${availableYear}.csv`)) return IRS_OUTFLOW_SAMPLE;
        return null;
      },
    };
    return requested;
  }

  it("falls back through missing filing years and yields joined county rows", async () => {
    stubRuntime("2223"); // 2526, 2425, 2324 all 404 → 2223 hit
    const records = await collect(
      irsSoiMigrationEtlHandler.fetch({ since: null }),
    );
    expect(records).toHaveLength(2);
    expect(records[0].externalId).toBe("irs_soi_01001_2223");
    expect(records[0].updatedAt).toBe("2223");
    const payload = records[0].payload as unknown as CountyMigrationUpsertRow;
    expect(payload.netReturns).toBe(228);
  });

  it("skips the run when the watermark already covers the newest available year", async () => {
    const requested = stubRuntime("2223");
    const records = await collect(
      irsSoiMigrationEtlHandler.fetch({ since: "2223" }),
    );
    expect(records).toHaveLength(0);
    expect(requested).toHaveLength(0); // no download at all
  });

  it("fails loudly when no filing year is published at all", async () => {
    irsSoiMigrationEtlHandler._runtime = {
      now: () => NOW_2026,
      exists: async () => false,
      download: async () => null,
    };
    await expect(collect(irsSoiMigrationEtlHandler.fetch({ since: null }))).rejects.toThrow(
      /no countyinflow file/,
    );
  });
});

describe("censusBpsPermitsEtlHandler.fetch", () => {
  const NOW_2026 = new Date("2026-07-13T00:00:00Z");

  function bpsFileFor(year: number): string {
    // Same real 2023 rows, re-dated so the parser's year check passes.
    return BPS_SAMPLE.replaceAll("2023,", `${year},`);
  }

  it("ingests the latest 3 available years, oldest first", async () => {
    const available = new Set([2024, 2023, 2022, 2021]); // 2025 not yet published
    censusBpsPermitsEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async (url) => {
        const m = url.match(/co(\d{4})a\.txt$/);
        const year = m ? parseInt(m[1], 10) : NaN;
        return available.has(year) ? bpsFileFor(year) : null;
      },
    };
    const records = await collect(censusBpsPermitsEtlHandler.fetch({ since: null }));
    // 2 counties per file × 3 years (2022, 2023, 2024) — 2021 not probed.
    expect(records).toHaveLength(6);
    expect((records[0].payload as unknown as BpsCountyPermitRow).year).toBe(2022);
    expect(records[0].updatedAt).toBe("2022");
    expect(records.at(-1)?.updatedAt).toBe("2024");
    expect(records[0].externalId).toBe("bps_01001_2022");
  });

  it("skips cheaply when the watermark already covers the newest year", async () => {
    const requested: string[] = [];
    censusBpsPermitsEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async (url) => {
        requested.push(url);
        return null;
      },
    };
    const records = await collect(censusBpsPermitsEtlHandler.fetch({ since: "2025" }));
    expect(records).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  it("fails loudly on a cold start when nothing is published", async () => {
    censusBpsPermitsEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async () => null,
    };
    await expect(collect(censusBpsPermitsEtlHandler.fetch({ since: null }))).rejects.toThrow(
      /no county annual file/,
    );
  });
});

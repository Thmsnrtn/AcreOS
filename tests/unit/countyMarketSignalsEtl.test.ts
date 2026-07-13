/**
 * Open-Data Program 2.1/2.2/2.3 — IRS SOI migration + Census BPS permits +
 * BLS QCEW employment/wages ETL.
 *
 * Covers the pure CSV parsers (sample lines below are REAL rows fetched from
 * the live upstreams on 2026-07-13 — countyinflow2223.csv,
 * countyoutflow2223.csv, co2023a.txt, cew/data/api/2023/a/industry/10.csv),
 * the inflow/outflow join, and the handlers' year-probing + watermark-skip
 * behaviour via `_runtime` injection. No Postgres needed — upsert paths are
 * exercised by the orchestrator tests.
 */

import { describe, it, expect } from "vitest";

import {
  parseIrsMigrationCsv,
  joinIrsMigrationFlows,
  parseCensusBpsCountyCsv,
  parseQcewAnnualCsv,
  irsSoiMigrationEtlHandler,
  censusBpsPermitsEtlHandler,
  blsQcewEmploymentEtlHandler,
  type CountyMigrationUpsertRow,
  type BpsCountyPermitRow,
  type QcewCountyRow,
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

// Real rows from https://data.bls.gov/cew/data/api/2023/a/industry/10.csv
// (fetched 2026-07-13). One of each shape the parser must handle: national
// (agglvl 10), statewide (50), MSA (80, non-numeric area code), a normal
// county total (70/own 0), per-ownership county detail (71), a BLS-suppressed
// county (disclosure_code 'N', zeros published), and the XX999
// "unknown or undefined" pseudo-county.
const QCEW_HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","annual_avg_estabs","annual_avg_emplvl","total_annual_wages","taxable_annual_wages","annual_contributions","annual_avg_wkly_wage","avg_annual_pay","lq_disclosure_code","lq_annual_avg_estabs","lq_annual_avg_emplvl","lq_total_annual_wages","lq_taxable_annual_wages","lq_annual_contributions","lq_annual_avg_wkly_wage","lq_avg_annual_pay","oty_disclosure_code","oty_annual_avg_estabs_chg","oty_annual_avg_estabs_pct_chg","oty_annual_avg_emplvl_chg","oty_annual_avg_emplvl_pct_chg","oty_total_annual_wages_chg","oty_total_annual_wages_pct_chg","oty_taxable_annual_wages_chg","oty_taxable_annual_wages_pct_chg","oty_annual_contributions_chg","oty_annual_contributions_pct_chg","oty_annual_avg_wkly_wage_chg","oty_annual_avg_wkly_wage_pct_chg","oty_avg_annual_pay_chg","oty_avg_annual_pay_pct_chg"';

const QCEW_SAMPLE = [
  QCEW_HEADER,
  '"US000","0","10","10","0","2023","A","",11866306,153140899,11081267615470,2060050025538,33934089306,1392,72360,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",346994,3.0,3115244,2.1,581530580376,5.5,58316375704,2.9,-873042501,-2.5,46,3.4,2374,3.4',
  '"01000","0","10","50","0","2023","A","",156469,2075785,124099716050,17637800447,112679192,1150,59784,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",7490,5.0,49683,2.5,7985214728,6.9,336329051,1.9,-106205238,-48.5,48,4.4,2475,4.3',
  '"C1010","0","10","80","0","2023","A","",1710,21020,1101748734,252824106,1756320,1008,52414,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",27,1.6,202,1.0,28421890,2.6,3347823,1.3,15202,0.9,17,1.7,856,1.7',
  '"01001","0","10","70","0","2023","A","",1073,11871,591550069,90113485,642214,958,49832,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",53,5.2,336,2.9,54267839,10.1,1933187,2.2,-522704,-44.9,62,6.9,3254,7.0',
  '"01001","5","10","71","0","2023","A","",1011,9330,454329752,89969485,641926,936,48696,"",0.97,0.92,0.89,1.02,1.01,0.97,0.97,"",51,5.3,312,3.5,44432217,10.8,1929954,2.2,-522006,-44.8,62,7.1,3242,7.1',
  '"48453","0","10","70","0","2023","A","",52273,904044,82263307633,8984819936,142188003,1750,90995,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",291,0.6,27050,3.1,4618268488,5.9,-121863620,-1.3,-41006197,-22.4,47,2.8,2460,2.8',
  '"32011","0","10","70","0","2023","A","N",53,0,0,0,0,0,0,"N",1.00,0,0,0,0,0,0,"N",-3,-5.4,0,0,0,0,0,0,0,0,0,0,0,0',
  '"01999","0","10","70","0","2023","A","",20285,82339,7063534651,995888673,9492160,1650,85786,"",1.00,1.00,1.00,1.00,1.00,1.00,1.00,"",822,4.2,5271,6.8,750418477,11.9,27264251,2.8,-6476037,-40.6,75,4.8,3869,4.7',
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

// ─── BLS QCEW parser ─────────────────────────────────────────────────────────

describe("parseQcewAnnualCsv", () => {
  it("keeps only county totals (own 0 / agglvl 70) and skips XX999 pseudo-counties", () => {
    const rows = parseQcewAnnualCsv(QCEW_SAMPLE, 2023);
    // National (10), statewide (50), MSA (80/"C1010"), per-ownership county
    // (71), and 01999 "unknown or undefined" are all excluded.
    expect(rows).toEqual([
      {
        stateFips: "01",
        countyFips: "001",
        year: 2023,
        avgEmployment: 11871,
        avgWeeklyWage: 958,
        establishments: 1073,
      },
      {
        stateFips: "48",
        countyFips: "453",
        year: 2023,
        avgEmployment: 904044,
        avgWeeklyWage: 1750,
        establishments: 52273,
      },
      // Eureka County NV — BLS-suppressed (next test).
      {
        stateFips: "32",
        countyFips: "011",
        year: 2023,
        avgEmployment: null,
        avgWeeklyWage: null,
        establishments: 53,
      },
    ]);
  });

  it("maps BLS suppression (disclosure_code 'N') to null instead of the published zeros", () => {
    const rows = parseQcewAnnualCsv(QCEW_SAMPLE, 2023);
    const eureka = rows.find((r) => r.stateFips === "32" && r.countyFips === "011");
    expect(eureka?.avgEmployment).toBeNull();
    expect(eureka?.avgWeeklyWage).toBeNull();
    // Establishment counts are published even for suppressed counties.
    expect(eureka?.establishments).toBe(53);
  });

  it("throws on header drift (missing column) instead of mis-keying", () => {
    expect(() => parseQcewAnnualCsv("nope,not,a,qcew,header\n", 2023)).toThrow(/missing column/);
  });

  it("throws when a row's year doesn't match the file year", () => {
    expect(() => parseQcewAnnualCsv(QCEW_SAMPLE, 2022)).toThrow(/does not match/);
  });

  it("throws on a row with the wrong column count instead of guessing", () => {
    const csv = [QCEW_HEADER, '"01001","0","10","70","0","2023"'].join("\n");
    expect(() => parseQcewAnnualCsv(csv, 2023)).toThrow(/expected 38 columns/);
  });

  it("throws on a non-numeric cell instead of coercing", () => {
    const bad = QCEW_SAMPLE.replace(",1073,11871,", ",1073,junk,");
    expect(() => parseQcewAnnualCsv(bad, 2023)).toThrow(/unparseable/);
  });
});

// ─── BLS QCEW handler fetch flow (via _runtime injection) ───────────────────

describe("blsQcewEmploymentEtlHandler.fetch", () => {
  const NOW_2026 = new Date("2026-07-13T00:00:00Z");

  function qcewFileFor(year: number): string {
    // Same real 2023 rows, re-dated so the parser's year check passes.
    return QCEW_SAMPLE.replaceAll('"2023"', `"${year}"`);
  }

  it("ingests the latest 3 available years, oldest first", async () => {
    const available = new Set([2025, 2024, 2023, 2022]);
    const requested: string[] = [];
    blsQcewEmploymentEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async (url) => {
        requested.push(url);
        const m = url.match(/\/(\d{4})\/a\/industry\/10\.csv$/);
        const year = m ? parseInt(m[1], 10) : NaN;
        return available.has(year) ? qcewFileFor(year) : null;
      },
    };
    const records = await collect(blsQcewEmploymentEtlHandler.fetch({ since: null }));
    // 3 counties per file × 3 years (2023, 2024, 2025) — 2022 not probed.
    expect(records).toHaveLength(9);
    expect((records[0].payload as unknown as QcewCountyRow).year).toBe(2023);
    expect(records[0].updatedAt).toBe("2023");
    expect(records.at(-1)?.updatedAt).toBe("2025");
    expect(records[0].externalId).toBe("qcew_01001_2023");
    expect(requested).toHaveLength(3);
  });

  it("stops probing at the watermark and ingests only newer years", async () => {
    blsQcewEmploymentEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async (url) => {
        const m = url.match(/\/(\d{4})\/a\/industry\/10\.csv$/);
        return m ? qcewFileFor(parseInt(m[1], 10)) : null;
      },
    };
    const records = await collect(blsQcewEmploymentEtlHandler.fetch({ since: "2024" }));
    expect(records).toHaveLength(3); // 2025 only
    expect(records.every((r) => r.updatedAt === "2025")).toBe(true);
  });

  it("skips cheaply when the watermark already covers the newest year", async () => {
    const requested: string[] = [];
    blsQcewEmploymentEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async (url) => {
        requested.push(url);
        return null;
      },
    };
    const records = await collect(blsQcewEmploymentEtlHandler.fetch({ since: "2025" }));
    expect(records).toHaveLength(0);
    expect(requested).toHaveLength(0);
  });

  it("fails loudly on a cold start when nothing is published", async () => {
    blsQcewEmploymentEtlHandler._runtime = {
      now: () => NOW_2026,
      download: async () => null,
    };
    await expect(collect(blsQcewEmploymentEtlHandler.fetch({ since: null }))).rejects.toThrow(
      /no annual industry-10 file/,
    );
  });
});

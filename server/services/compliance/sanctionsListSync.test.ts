/**
 * sanctionsListSync tests — the LIVE OFAC ingestion PARSER.
 *
 * These tests NEVER hit the live Treasury endpoints. They parse a small
 * COMMITTED sample of the real Treasury CSV format (server/services/compliance/
 * __fixtures__/*.csv) and assert it loads into the sanctions_list_entries
 * shape. The DB-backed upsert + orchestration paths are integration tests by
 * nature and are exercised against in-memory parsed rows only.
 *
 * Framing reminder: a parsed row is a PUBLIC Treasury list entry, not a legal
 * determination. The advisory matcher (ofacScreening.ts) decides flags.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseCsvLine,
  parsePrimaryCsv,
  parseAltCsv,
  parseAddCsv,
  mapEntityType,
  parsePrograms,
  extractPublishedDate,
} from "./sanctionsListSync";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const sdnCsv = readFileSync(join(FIXTURE_DIR, "sdn_sample.csv"), "utf-8");
const altCsv = readFileSync(join(FIXTURE_DIR, "alt_sample.csv"), "utf-8");
const addCsv = readFileSync(join(FIXTURE_DIR, "add_sample.csv"), "utf-8");

describe("parseCsvLine", () => {
  it("honors quoted fields containing commas", () => {
    expect(parseCsvLine('1,"GUZMAN, Joaquin","individual"')).toEqual([
      "1",
      "GUZMAN, Joaquin",
      "individual",
    ]);
  });

  it("collapses Treasury's -0- sentinel to empty", () => {
    expect(parseCsvLine('1,"name","-0-"')).toEqual(["1", "name", ""]);
  });
});

describe("field mappers", () => {
  it("maps SDN_Type to entity_type (blank => entity)", () => {
    expect(mapEntityType("individual")).toBe("individual");
    expect(mapEntityType("")).toBe("entity");
    expect(mapEntityType("vessel")).toBe("vessel");
    expect(mapEntityType("aircraft")).toBe("aircraft");
  });

  it("splits multi-program fields", () => {
    expect(parsePrograms("IRAN] [SDGT")).toEqual(["IRAN", "SDGT"]);
    expect(parsePrograms("SDNTK")).toEqual(["SDNTK"]);
    expect(parsePrograms("")).toEqual([]);
  });

  it("mines a published date out of remarks (multiple formats)", () => {
    expect(extractPublishedDate("... Listed 31 May 2013.")?.getUTCFullYear()).toBe(2013);
    expect(extractPublishedDate("Listed 2024-03-15.")?.toISOString().slice(0, 10)).toBe(
      "2024-03-15",
    );
    expect(extractPublishedDate("no date here")).toBeNull();
  });
});

describe("parseAltCsv / parseAddCsv (companion joins)", () => {
  it("groups aliases by ent_num", () => {
    const m = parseAltCsv(altCsv);
    expect(m.get("1234")).toEqual(["EL CHAPO", "GUZMAN, Joaquin"]);
    expect(m.get("9012")).toEqual(["BUT, Viktor", "Viktor Bout"]);
  });

  it("groups addresses by ent_num", () => {
    const m = parseAddCsv(addCsv);
    expect(m.get("1234")).toEqual([
      { address: "Calle Principal 5", cityStateProvince: "Culiacan, Sinaloa", country: "Mexico" },
    ]);
    // -0- address line collapses; city + country survive.
    expect(m.get("9012")).toEqual([{ cityStateProvince: "Dushanbe", country: "Tajikistan" }]);
  });
});

describe("parsePrimaryCsv → sanctions_list_entries shape", () => {
  const entries = parsePrimaryCsv(sdnCsv, "SDN", {
    altByUid: parseAltCsv(altCsv),
    addrByUid: parseAddCsv(addCsv),
  });

  it("loads every well-formed row", () => {
    expect(entries).toHaveLength(5);
  });

  it("produces the full entry shape with provenance + joins", () => {
    const guzman = entries.find((e) => e.ofacUid === "1234")!;
    expect(guzman).toBeDefined();
    expect(guzman.sourceList).toBe("SDN");
    expect(guzman.entityType).toBe("individual");
    expect(guzman.primaryName).toBe("GUZMAN LOERA, Joaquin Archivaldo");
    expect(guzman.normalizedName).toBe("archivaldo guzman joaquin loera");
    expect(guzman.programs).toEqual(["SDNTK"]);
    expect(guzman.aliases).toEqual(["EL CHAPO", "GUZMAN, Joaquin"]);
    expect(guzman.addresses[0].country).toBe("Mexico");
    expect(guzman.listPublishedAt?.getUTCFullYear()).toBe(2013);
  });

  it("maps a blank SDN_Type to entity and splits multi-program", () => {
    const bank = entries.find((e) => e.ofacUid === "5678")!;
    expect(bank.entityType).toBe("entity");
    expect(bank.programs).toEqual(["IRAN", "SDGT"]);
  });

  it("captures vessel rows", () => {
    const vessel = entries.find((e) => e.ofacUid === "7788")!;
    expect(vessel.entityType).toBe("vessel");
    expect(vessel.listPublishedAt?.toISOString().slice(0, 10)).toBe("2024-03-15");
  });

  it("skips rows missing a uid or name", () => {
    const broken = parsePrimaryCsv('\n,,individual,SDNTK\n9999,"Real Name","",PROG\n', "SDN");
    expect(broken).toHaveLength(1);
    expect(broken[0].ofacUid).toBe("9999");
  });
});

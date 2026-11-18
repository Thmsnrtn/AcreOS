/**
 * BD-5 — the surgical zod processors stub (vite.config.ts
 * zodJsonSchemaProcessorsPlugin).
 *
 * The client bundle resolves zod's core/json-schema-processors.js to a
 * stub that keeps aggregateChecks REAL (it backs the live derived
 * accessors — ZodString.format/.minLength/.maxLength, ZodNumber
 * .minValue/.maxValue/.format) and makes every generation-only export
 * throw. The stub's aggregateChecks is a hand copy, so it can desync on
 * a zod bump; this suite is the guard:
 *
 *   1. the copy (helpers + aggregateChecks) matches the INSTALLED zod's
 *      module line-for-line (trimmed, blanks dropped), and the two range
 *      tables carry the installed values;
 *   2. every export of the installed processors module is provided by
 *      the stub (aggregateChecks real, the rest throwing), and
 *      allProcessors carries every installed key;
 *   3. a behaviour battery over the live accessors, run against the zod
 *      these tests resolve, pins the contract the copy must preserve.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.join(__dirname, "../..");
const config = readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
const installedProcessors = readFileSync(path.join(ROOT, "node_modules/zod/v4/core/json-schema-processors.js"), "utf8");
const installedUtil = readFileSync(path.join(ROOT, "node_modules/zod/v4/core/util.js"), "utf8");

const norm = (s: string) => s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

/** The backtick-string lines embedded between two markers in vite.config.ts. */
function embeddedLines(fromMarker: string, toMarker: string): string[] {
  const start = config.indexOf(fromMarker);
  const end = config.indexOf(toMarker, start);
  expect(start, `marker ${fromMarker} not found`).toBeGreaterThan(-1);
  expect(end, `marker ${toMarker} not found`).toBeGreaterThan(start);
  const block = config.slice(start, end);
  return [...block.matchAll(/`([^`]*)`,/g)].flatMap((m) => norm(m[1]));
}

/** Installed lines from the first `start` line through the aggregateChecks close. */
function installedRegion(): string[] {
  const lines = norm(installedProcessors);
  const start = lines.findIndex((l) => l.startsWith("const narrowMin"));
  const aggStart = lines.findIndex((l) => l.startsWith("export function aggregateChecks"));
  const aggReturn = lines.findIndex((l, i) => i > aggStart && l === "return agg;");
  const aggEnd = lines.findIndex((l, i) => i > aggReturn && l === "}");
  expect(start).toBeGreaterThan(-1);
  expect(aggStart).toBeGreaterThan(start);
  expect(aggEnd).toBeGreaterThan(aggStart);
  return lines.slice(start, aggEnd + 1);
}

describe("BD-5 processors stub — the verbatim copy", () => {
  it("helpers + aggregateChecks match the installed zod line-for-line", () => {
    const embedded = embeddedLines("ZOD_PROCESSORS_VERBATIM", "ZOD_GENERATION_PROCESSORS")
      // the embedded block opens with the two range tables (pinned by value below)
      .slice(embeddedLines("ZOD_PROCESSORS_VERBATIM", "ZOD_GENERATION_PROCESSORS").findIndex((l) => l.startsWith("const narrowMin")));
    expect(embedded).toEqual(installedRegion());
  });

  it("the range tables carry the installed values", () => {
    for (const needle of [
      "safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]",
      "int32: [-2147483648, 2147483647]",
      "uint32: [0, 4294967295]",
      "float32: [-3.4028234663852886e38, 3.4028234663852886e38]",
      "float64: [-Number.MAX_VALUE, Number.MAX_VALUE]",
    ]) expect(config, needle).toContain(needle);
    expect(installedUtil).toContain("int64:");
    expect(config).toContain('int64: [BigInt("-9223372036854775808"), BigInt("9223372036854775807")]');
    expect(config).toContain('uint64: [BigInt(0), BigInt("18446744073709551615")]');
  });

  it("every installed processors export is provided by the stub", () => {
    const exports = [...installedProcessors.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
    expect(exports.length).toBeGreaterThan(40);
    const stubbed = config.match(/ZOD_GENERATION_PROCESSORS = \[([\s\S]*?)\];/)![1];
    for (const name of exports) {
      if (name === "aggregateChecks") {
        expect(config).toContain("export function aggregateChecks(schema) {");
      } else if (name === "toJSONSchema") {
        expect(config).toContain("export const toJSONSchema = unavailable;");
      } else if (name === "allProcessors") {
        expect(config).toContain("export const allProcessors = {");
      } else {
        expect(stubbed, `generation export ${name} is not in the stub list`).toContain(`"${name}"`);
      }
    }
    expect(config).toContain("export const toJSONSchema = unavailable;");
    const keys = [...installedProcessors.matchAll(/^    (\w+): \w+Processor,/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(35);
    const stubKeys = config.match(/ZOD_ALL_PROCESSOR_KEYS = \[([\s\S]*?)\];/)![1];
    for (const k of keys) expect(stubKeys, `allProcessors key ${k} missing`).toContain(`"${k}"`);
  });

  it("the plugin is registered and gated on zod as the importer", () => {
    const bare = stripComments(config);
    expect(bare).toMatch(/plugins:\s*\[[^\]]*zodJsonSchemaProcessorsPlugin\(\)/s);
    expect(bare).toContain('resolved.endsWith("zod/v4/core/json-schema-processors.js")');
  });
});

describe("BD-5 behaviour battery — the live accessors aggregateChecks backs", () => {
  it("string accessors fold min/max length and format", () => {
    const s = z.string().min(3).max(9);
    expect(s.minLength).toBe(3);
    expect(s.maxLength).toBe(9);
    expect(z.string().email().format).toBe("email");
    expect(z.string().format).toBeNull();
  });
  it("number accessors fold min/max values and format", () => {
    const n = z.number().min(5).max(10);
    expect(n.minValue).toBe(5);
    expect(n.maxValue).toBe(10);
    expect(z.number().format).toBeNull();
  });
  it("parsing still validates through the same checks", () => {
    expect(z.string().min(3).safeParse("ab").success).toBe(false);
    expect(z.string().min(3).safeParse("abc").success).toBe(true);
    expect(z.number().min(5).safeParse(4).success).toBe(false);
    expect(z.number().min(5).safeParse(5).success).toBe(true);
  });
});

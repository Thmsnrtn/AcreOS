/**
 * BD-5 — zod's json-schema-processors.js is surgically stubbed in the
 * client build, and the surgery cannot silently desync on a zod bump.
 *
 * vite.config.ts (zodJsonSchemaProcessorsPlugin) replaces
 * zod/v4/core/json-schema-processors.js FOR THE CLIENT BUILD ONLY with a
 * stub that keeps the one export live code reaches — aggregateChecks,
 * copied verbatim, plus the two util range tables it folds over — and
 * turns every generation-only processor, allProcessors and toJSONSchema
 * into a throwing stub. classic/schemas.js reads
 * processors.aggregateChecks(inst) inside the derived public accessors
 * on live schema instances (ZodString.format / .minLength / .maxLength,
 * ZodNumber.minValue / .maxValue / .format), so the fold must stay
 * byte-for-byte the installed zod's own, or those accessors drift.
 *
 * This battery pins three things:
 *   1. the verbatim block embedded in vite.config.ts is identical
 *      (whitespace-normalized) to the installed zod's aggregateChecks
 *      source, and the stub's range tables carry the installed util.js
 *      tables' exact boundary values — a zod bump that changes either
 *      fails HERE, in the test suite, not in a customer's bundle;
 *   2. the stub exports a throwing stub for every processor the real
 *      module exports, plus allProcessors and toJSONSchema;
 *   3. the live accessors behave as the fold dictates, exercised against
 *      the real zod in this (unstubbed) test environment — including
 *      z.number().int(), whose minValue/maxValue come from the
 *      NUMBER_FORMAT_RANGES table through aggregateChecks.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.join(__dirname, "../..");
const CONFIG = readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
const PROCESSORS_SRC = readFileSync(
  path.join(ROOT, "node_modules/zod/v4/core/json-schema-processors.js"),
  "utf8",
);
const UTIL_SRC = readFileSync(path.join(ROOT, "node_modules/zod/v4/core/util.js"), "utf8");

function normalize(src: string): string {
  return src
    .replace(/\/\*@__PURE__\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function between(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `marker not found: ${endMarker}`).toBeGreaterThan(start);
  return src.slice(start + startMarker.length, end);
}

/** A fold block: from the first fold helper to the end of aggregateChecks. */
function foldOf(src: string): string {
  const start = src.indexOf("const narrowMin");
  const fnStart = src.indexOf("export function aggregateChecks");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(fnStart).toBeGreaterThan(start);
  const fnEnd = src.indexOf("\n}", fnStart);
  expect(fnEnd).toBeGreaterThan(fnStart);
  return src.slice(start, fnEnd + 2);
}

describe("BD-5 zod processors stub — verbatim fold", () => {
  it("the stub's aggregateChecks block is the installed zod's own, verbatim", () => {
    const stubBlock = between(
      CONFIG,
      "BEGIN VERBATIM aggregateChecks",
      "END VERBATIM aggregateChecks",
    );
    // The config block is a template literal, so it carries the marker
    // comment lines and the literal's own closing backtick around the
    // fold; foldOf cuts both sides with the same rule.
    expect(normalize(foldOf(stubBlock))).toBe(normalize(foldOf(PROCESSORS_SRC)));
  });

  it("the stub's range tables carry the installed util.js boundary values", () => {
    const stubTables = between(CONFIG, "BEGIN VERBATIM RANGE TABLES", "END VERBATIM RANGE TABLES");
    // Every numeric / bigint boundary literal in the installed tables must
    // appear in the stub's tables (the IIFE/annotation dressing may differ).
    const installedTables = between(
      UTIL_SRC,
      "export const NUMBER_FORMAT_RANGES",
      "export function pick",
    );
    const literals = installedTables.match(/-?\d[\d.e+-]*|BigInt\("[^"]*"\)/g) ?? [];
    expect(literals.length).toBeGreaterThan(10);
    for (const lit of literals) {
      expect(stubTables, `range boundary ${lit} missing from the stub tables`).toContain(
        lit.replace(/^BigInt\(|\)$/g, ""),
      );
    }
    expect(stubTables).toContain("Number.MIN_SAFE_INTEGER");
    expect(stubTables).toContain("Number.MAX_SAFE_INTEGER");
    expect(stubTables).toContain("Number.MAX_VALUE");
  });

  it("the stub throws for every processor the real module exports", () => {
    const exported = [...PROCESSORS_SRC.matchAll(/export const (\w+Processor)\b/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(35);
    for (const name of exported) {
      expect(CONFIG, `${name} is not stubbed`).toContain(`export const ${name} = unavailable;`);
    }
    expect(CONFIG).toContain("export const allProcessors = {");
    expect(CONFIG).toContain("export const toJSONSchema = unavailable;");
  });

  it("the plugin is registered and keyed on zod as the importer", () => {
    const code = stripComments(CONFIG);
    expect(code).toMatch(/plugins:\s*\[[^\]]*\bzodJsonSchemaProcessorsPlugin\(\)/s);
    expect(code).toContain('endsWith("json-schema-processors.js")');
    expect(code).toMatch(/node_modules\[\\\\\/\]zod\[\\\\\/\]/);
  });
});

describe("BD-5 zod processors stub — live accessor behaviour (real zod)", () => {
  it("string accessors fold min/max checks", () => {
    const s = z.string().min(3).max(9);
    expect(s.minLength).toBe(3);
    expect(s.maxLength).toBe(9);
    expect(s.format).toBeNull();
  });

  it("string format accessor surfaces the format check", () => {
    expect(z.string().email().format).toBe("email");
  });

  it("number accessors fold min/max checks", () => {
    const n = z.number().min(5).max(10);
    expect(n.minValue).toBe(5);
    expect(n.maxValue).toBe(10);
    expect(n.format).toBeNull();
  });

  it("number int format folds the NUMBER_FORMAT_RANGES safeint range", () => {
    const i = z.number().int();
    expect(i.format).toBe("safeint");
    expect(i.minValue).toBe(Number.MIN_SAFE_INTEGER);
    expect(i.maxValue).toBe(Number.MAX_SAFE_INTEGER);
  });
});

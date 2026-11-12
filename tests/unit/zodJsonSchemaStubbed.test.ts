/**
 * zod's JSON Schema generation is not bundled, and nothing calls it.
 *
 * zod v4's classic schemas carry a `.toJSONSchema()` method whose factory
 * imports core/to-json-schema.js — the whole JSON Schema generator — into
 * any bundle that uses zod at all. vite.config.ts resolves that one module
 * to a stub whose entry points throw, because nothing in client/src,
 * shared/ or packages/ generates a JSON Schema from a zod schema. That is
 * safe only while it stays true, so:
 *
 *   1. every client/shared/package file is swept (vacuity floor: 48 files
 *      import the bare "zod" specifier directly — measured 2026-11-08;
 *      most other files reach zod transitively through shared/schema)
 *      and none of them calls
 *      toJSONSchema() / toStandardJSONSchema() or touches a schema's
 *      "~standard" jsonSchema factories — a new caller fails here instead
 *      of throwing in a customer's browser;
 *   2. the stub replaces exactly core/to-json-schema.js and only when zod
 *      itself is the importer — reached both as "../core/to-json-schema.js"
 *      from classic/schemas.js and as the sibling "./to-json-schema.js"
 *      from core's own modules, matched by resolved path.
 *      json-schema-processors.js is never the stubbed module:
 *      classic/schemas.js reads processors.aggregateChecks(inst)
 *      inside the derived public accessors on live schema instances
 *      (ZodString.format / .minLength / .maxLength, ZodNumber.minValue /
 *      .maxValue / .format), so stubbing that module would break real
 *      schema API. aggregateChecks itself only folds check metadata and
 *      never calls the generator functions processors imports, so
 *      stubbing those imports is safe. The standalone z.toJSONSchema()
 *      lives in the processors module but reaches processSchema in the
 *      stubbed generator, so it still fails loudly if ever called.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const SCAN_DIRS = ["client/src", "shared", "packages"];
const ZOD_IMPORT = /\bfrom\s*["']zod["']|\bimport\(\s*["']zod["']\s*\)|\brequire\(\s*["']zod["']\s*\)/;
const JSON_SCHEMA_CALL =
  /\btoJSONSchema\s*\(|\btoStandardJSONSchema\s*\(|\["~standard"\]\s*\.\s*jsonSchema|\['~standard'\]\s*\.\s*jsonSchema|\.~standard\s*\.\s*jsonSchema/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("zod JSON Schema generation is never called by app code", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const consumers = files.filter((f) => ZOD_IMPORT.test(stripComments(readFileSync(f, "utf8"))));

  it("finds the zod consumers (vacuity)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(consumers.length).toBeGreaterThan(40);
  });

  it("no app file generates a JSON Schema from a zod schema", () => {
    const offenders = files.filter((f) => JSON_SCHEMA_CALL.test(stripComments(readFileSync(f, "utf8"))));
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "toJSONSchema() loads zod's core/to-json-schema.js generator, which vite.config.ts stubs out — bundle it deliberately (and re-measure the budget) before calling it",
    ).toEqual([]);
  });
});

describe("the stub covers exactly core/to-json-schema.js, and only for zod", () => {
  const config = stripComments(readFileSync(path.join(ROOT, "vite.config.ts"), "utf8"));

  it("stubs exactly the generator module, never json-schema-processors.js", () => {
    const set = config.match(/ZOD_UNUSED_JSON_SCHEMA_MODULES\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(set, "the stubbed-module set was not found").not.toBeNull();
    const names = [...set![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["core/to-json-schema.js"]);
    // processors may be named in comments as an importer, but it is never
    // a stub target: no code path resolves a processors specifier to a stub.
    expect(config).not.toMatch(/Set\(\[[^\]]*json-schema-processors/);
    // the sibling "./to-json-schema.js" imports from core's own modules
    // are caught by resolved path, pinned so the branch can't silently go.
    expect(config).toMatch(/zod\/v4\/core\/to-json-schema\.js/);
  });

  it("is registered as a plugin and keyed on zod as the importer", () => {
    expect(config).toMatch(/plugins:\s*\[[^\]]*\bzodJsonSchemaUnusedPlugin\(\)/s);
    expect(config).toMatch(/node_modules\[\\\\\/\]zod\[\\\\\/\]/);
  });
});

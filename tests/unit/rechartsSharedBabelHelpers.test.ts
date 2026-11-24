/**
 * 2026-11-08 bundle trim (S-BUNDLE-2): recharts inlines the same Babel helpers
 * into ~100 of its ES files; script/vite-shared-babel-helpers.ts emits each
 * one once and imports it, taking ~95 KB off vendor-charts. That is only a
 * trim while it changes nothing, so this pins:
 *
 *   1. the POPULATION: the package scan still finds the helper copies (an
 *      upgrade that changes recharts' shape must fail here, not silently drop
 *      the saving), and every helper name still has one text;
 *   2. EQUIVALENCE: the shared module's helpers return the same results as the
 *      helpers exactly as recharts ships them in a real file, on inputs that
 *      exercise their edge branches (symbol keys, non-enumerable symbols,
 *      Map/Set/string/arguments destructuring, Symbol.toPrimitive keys);
 *   3. the REWRITE CONTRACT on a real recharts file: every helper declaration
 *      leaves, one import arrives, and every other line keeps its position;
 *   4. REFUSAL: a helper whose text differs from the package's, a name with
 *      two texts, a name declared twice or bound a second way — each leaves
 *      the file exactly as published;
 *   5. WIRING: vite.config.ts registers the plugin.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  HELPER_LINE,
  SHARED_HELPERS_ID,
  dedupeModuleHelpers,
  scanHelperTable,
  sharedHelpersModule,
  type HelperTable,
} from "../../script/vite-shared-babel-helpers";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.join(__dirname, "../..");
const require_ = createRequire(path.join(ROOT, "package.json"));
const RECHARTS_ES6 = path.join(path.dirname(require_.resolve("recharts/package.json")), "es6");
// Bar.js carries the largest helper set (destructuring, spread, rest, extends).
const SAMPLE = path.join(RECHARTS_ES6, "cartesian/Bar.js");

const table = scanHelperTable(RECHARTS_ES6);
const sampleCode = readFileSync(SAMPLE, "utf8");

const tmp = mkdtempSync(path.join(tmpdir(), "recharts-helpers-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Helpers = Record<string, (...args: any[]) => any>;

// Rectangle.js ships the one helper Bar.js lacks (_taggedTemplateLiteral).
const SAMPLE_TAGGED = path.join(RECHARTS_ES6, "shape/Rectangle.js");

/** The helpers exactly as Bar.js and Rectangle.js ship them, in their own scope. */
function originalHelpers(): Helpers {
  const decls: string[] = [];
  const names: string[] = [];
  for (const code of [sampleCode, readFileSync(SAMPLE_TAGGED, "utf8")]) {
    for (const l of code.split("\n")) {
      const m = HELPER_LINE.exec(l);
      if (m && !names.includes(m[1])) {
        names.push(m[1]);
        decls.push(l);
      }
    }
  }
  return new Function(`"use strict";\n${decls.join("\n")}\nreturn { ${names.join(", ")} };`)() as Helpers;
}

async function sharedHelpers(): Promise<Helpers> {
  const file = path.join(tmp, "shared.mjs");
  writeFileSync(file, sharedHelpersModule(table));
  return (await import(pathToFileURL(file).href)) as Helpers;
}

/** Inputs that walk every branch the helpers have. */
function exercise(h: Helpers) {
  const sym = Symbol.for("s");
  const hidden = Symbol.for("hidden");
  const src: Record<string | symbol, unknown> = { a: 1, b: 2, [sym]: 3 };
  Object.defineProperty(src, hidden, { value: 4, enumerable: false });
  const keyObj = { [Symbol.toPrimitive]: () => "fromPrimitive" };
  const args = (function (..._a: unknown[]) {
    return arguments; // eslint-disable-line prefer-rest-params
  })(1, 2, 3);
  const snapshot = (o: Record<string | symbol, unknown>) => [
    Object.keys(o),
    Object.getOwnPropertySymbols(o).map(String),
    Reflect.ownKeys(o).map((k) => [String(k), o[k as string]]),
  ];
  const out: Record<string, unknown> = {};
  if (h._objectSpread) out.spread = snapshot(h._objectSpread({}, src, null, { c: 5 }));
  if (h._defineProperty) out.define = snapshot(h._defineProperty({}, keyObj, 9));
  if (h._toPropertyKey) out.key = [h._toPropertyKey(keyObj), typeof h._toPropertyKey(sym), h._toPropertyKey(7)];
  if (h._objectWithoutProperties) out.rest = snapshot(h._objectWithoutProperties(src, ["a", sym]));
  if (h._objectWithoutProperties) out.restNull = h._objectWithoutProperties(null, ["a"]);
  if (h._extends) out.extends = [snapshot(h._extends({}, src, { d: 6 })), snapshot(h._extends({}, { e: 1 }))];
  if (h._slicedToArray) {
    out.sliced = [
      h._slicedToArray([1, 2, 3], 2),
      h._slicedToArray(new Set([4, 5, 6]), 2),
      h._slicedToArray(new Map([["k", 1]]), 1),
      h._slicedToArray("xyz", 2),
      h._slicedToArray(args, 2),
      h._slicedToArray(new Uint8Array([7, 8]), 2),
    ];
    let threw = "";
    try {
      h._slicedToArray(42, 1);
    } catch (e) {
      threw = (e as Error).message;
    }
    out.slicedThrows = threw;
  }
  if (h._taggedTemplateLiteral) {
    const t = h._taggedTemplateLiteral(["a", "b"], ["a\\", "b"]);
    out.tagged = [Array.from(t), Array.from(t.raw), Object.isFrozen(t)];
  }
  return out;
}

describe("population: the recharts package scan", () => {
  it("still finds the inlined helpers (vacuity floor, measured 2026-11-08: 103 files, 678 lines, 15 names)", () => {
    expect(table.filesScanned).toBeGreaterThan(200);
    expect(table.filesWithHelpers).toBeGreaterThanOrEqual(90);
    expect(table.helperLines).toBeGreaterThanOrEqual(600);
    for (const name of ["_defineProperty", "_toPropertyKey", "_toPrimitive", "ownKeys", "_objectSpread", "_extends", "_objectWithoutProperties", "_objectWithoutPropertiesLoose", "_slicedToArray"]) {
      expect(table.texts.has(name), `${name} is no longer a single-text helper in recharts`).toBe(true);
    }
  });

  it("every helper name has exactly one text, so sharing one copy cannot change a body", () => {
    expect([...table.ambiguous]).toEqual([]);
  });
});

describe("equivalence: shared helpers behave exactly like the copies recharts ships", () => {
  it("the sample files carry every shared helper", () => {
    const names = Object.keys(originalHelpers());
    for (const n of ["_slicedToArray", "_objectSpread", "_defineProperty", "_extends", "_objectWithoutProperties", "_taggedTemplateLiteral"]) expect(names).toContain(n);
    // Every shared helper is compared against a shipped copy, none skipped.
    expect([...table.texts.keys()].filter((n) => !names.includes(n))).toEqual([]);
  });

  it("returns identical results on every branch", async () => {
    const original = exercise(originalHelpers());
    const shared = exercise(await sharedHelpers());
    expect(Object.keys(original).length).toBeGreaterThanOrEqual(8);
    expect(shared).toEqual(original);
  });

  it("the shared module defines each helper with the package's text, verbatim", () => {
    const mod = sharedHelpersModule(table);
    for (const [name, text] of table.texts) expect(mod.split("\n"), name).toContain(text);
  });
});

describe("rewrite contract on a real recharts file", () => {
  const result = dedupeModuleHelpers(sampleCode, table);

  it("removes every helper declaration and imports the same names from the shared module", () => {
    expect(result.kind).toBe("rewritten");
    if (result.kind !== "rewritten") return;
    const declared = sampleCode.split("\n").filter((l) => HELPER_LINE.test(l)).map((l) => HELPER_LINE.exec(l)![1]);
    expect(result.names).toEqual(declared);
    expect(result.code.split("\n").some((l) => HELPER_LINE.test(l))).toBe(false);
    expect(result.code).toContain(`import { ${declared.join(", ")} } from ${JSON.stringify(SHARED_HELPERS_ID)};`);
  });

  it("keeps every other line at its original line and column (source maps stay true)", () => {
    if (result.kind !== "rewritten") throw new Error("not rewritten");
    const before = sampleCode.split("\n");
    const after = result.code.split("\n");
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBe(HELPER_LINE.test(before[i]) ? "" : before[i]);
    }
  });
});

describe("refusal: anything short of byte-identical leaves the file as published", () => {
  const firstHelper = sampleCode.split("\n").find((l) => HELPER_LINE.test(l))!;
  const name = HELPER_LINE.exec(firstHelper)![1];

  it("a helper whose text differs from the package's single text", () => {
    // Still a valid single-line helper declaration, one statement different.
    expect(firstHelper).toContain(") {");
    const mutated = sampleCode.replace(firstHelper, firstHelper.replace(") {", ") { void 0;"));
    expect(HELPER_LINE.test(mutated.split("\n").find((l) => l.startsWith(`function ${name}(`))!)).toBe(true);
    expect(dedupeModuleHelpers(mutated, table).kind).toBe("refused");
  });

  it("a helper name the package ships with two texts", () => {
    const twoTexts: HelperTable = { ...table, ambiguous: new Set([name]), texts: new Map([...table.texts].filter(([n]) => n !== name)) };
    expect(dedupeModuleHelpers(sampleCode, twoTexts).kind).toBe("refused");
  });

  it("a helper declared twice in one file", () => {
    expect(dedupeModuleHelpers(`${firstHelper}\n${sampleCode}`, table).kind).toBe("refused");
  });

  it("a helper name bound a second way in the file", () => {
    expect(dedupeModuleHelpers(`${sampleCode}\nvar ${name} = null;\n`, table).kind).toBe("refused");
  });

  it("a file with no helpers is not touched", () => {
    expect(dedupeModuleHelpers("export const x = 1;\n", table).kind).toBe("none");
  });
});

describe("wiring", () => {
  it("vite.config.ts imports and registers the plugin", () => {
    const config = stripComments(readFileSync(path.join(ROOT, "vite.config.ts"), "utf8"));
    expect(config).toMatch(/import\s*\{\s*rechartsSharedBabelHelpersPlugin\s*\}\s*from\s*["']\.\/script\/vite-shared-babel-helpers["']/);
    const plugins = config.slice(config.indexOf("plugins:"), config.indexOf("resolve:"));
    expect(plugins).toMatch(/\brechartsSharedBabelHelpersPlugin\(\)/);
  });
});

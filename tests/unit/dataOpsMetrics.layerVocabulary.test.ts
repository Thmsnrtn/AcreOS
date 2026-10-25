/**
 * D2g — the answering-layer vocabulary the paid fall-through fold buckets is
 * DERIVED from the code that writes provider_lookup_log.answering_layer, not
 * restated. A gate proves its property only over the population it reads, so
 * the population is every server/ and shared/ TypeScript file plus every
 * migration — not just the provider registry — and every place
 * `answeringLayer:` appears must be classified as a write whose value is
 * known, or the test fails. A layer value written anywhere that the fold has
 * no bucket for would otherwise land in `unknownLayers` in production and
 * nowhere in a test.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { stripComments } from "../helpers/stripComments";
import { foldFallThrough } from "../../server/services/ops/dataOpsMetrics";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_DIRS = ["server", "shared"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const SOURCES = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).map((p) => ({ file: rel(p), src: stripComments(fs.readFileSync(p, "utf8")) }));

/** The vocabulary answeringLayerFor() can return: every string literal in its body. */
function answeringLayerForVocabulary(): string[] {
  const src = SOURCES.find((s) => s.file === "shared/openData/demandEvent.ts")?.src ?? "";
  const m = src.match(/export function answeringLayerFor\([\s\S]*?\)\s*:\s*AnsweringLayer\s*\{([\s\S]*?)\n\}/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([a-z_]+)"/g), (x) => x[1]);
}

/** The AnsweringLayer union's members. */
function unionVocabulary(): string[] {
  const src = SOURCES.find((s) => s.file === "shared/openData/demandEvent.ts")?.src ?? "";
  const m = src.match(/export type AnsweringLayer\s*=\s*([^;]+);/);
  return m ? Array.from(m[1].matchAll(/"([a-z_]+)"/g), (x) => x[1]) : [];
}

/**
 * Every `answeringLayer:` occurrence, classified by its right-hand side.
 * Anything not matching a known form is UNCLASSIFIED and fails the test —
 * a new write shape must be added here deliberately, not read past.
 */
type Site = { file: string; rhs: string; kind: "literal" | "derived" | "type" | "column" | "reader" | "passthrough" | "unclassified"; value?: string };
function sites(): Site[] {
  const out: Site[] = [];
  for (const { file, src } of SOURCES) {
    for (const m of src.matchAll(/\banswering[Ll]ayer\??\s*:\s*([^,;\n}]+)/g)) {
      const rhs = m[1].trim();
      let kind: Site["kind"] = "unclassified";
      let value: string | undefined;
      const lit = rhs.match(/^["'`]([^"'`]*)["'`]$/);
      if (lit) {
        kind = "literal";
        value = lit[1];
      } else if (/^answeringLayerFor\(/.test(rhs)) kind = "derived";
      else if (/^(AnsweringLayer|string)\b/.test(rhs)) kind = "type";
      else if (/^text\("answering_layer"\)$/.test(rhs) && file === "shared/schema.ts") kind = "column";
      else if (rhs === "providerLookupLog.answeringLayer" || rhs === "r.answeringLayer") kind = "reader";
      // providerIntelligence.recordLookup copies a field typed AnsweringLayer.
      else if (rhs === "record.answeringLayer ?? null" && file === "server/services/providerIntelligence.ts") kind = "passthrough";
      out.push({ file, rhs, kind, value });
    }
  }
  return out;
}

const BUCKETED = new Set(Object.keys(foldFallThrough([], 1).layerBuckets));

describe("answering-layer vocabulary is derived from the writers, and every value has a bucket", () => {
  const all = sites();

  it("population floor: the source walk read the repo, and the known writers are in it", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    const files = new Set(all.map((s) => s.file));
    for (const f of ["server/services/providers/provider-registry.ts", "server/services/providerIntelligence.ts", "shared/openData/demandEvent.ts", "shared/schema.ts"]) {
      expect(files, `${f} must be in the population`).toContain(f);
    }
    const registry = all.filter((s) => s.file === "server/services/providers/provider-registry.ts" && (s.kind === "literal" || s.kind === "derived"));
    expect(registry.length, "provider-registry writes (vacuity floor)").toBeGreaterThanOrEqual(4);
  });

  it("every answeringLayer site is a recognised form — none unclassified", () => {
    expect(all.filter((s) => s.kind === "unclassified")).toEqual([]);
  });

  it("the union, answeringLayerFor()'s returns, and every literal written are all bucketed", () => {
    const union = unionVocabulary();
    const derived = answeringLayerForVocabulary();
    expect(union.length).toBeGreaterThanOrEqual(4);
    expect(derived.length).toBeGreaterThanOrEqual(4);
    const literals = all.filter((s) => s.kind === "literal").map((s) => `${s.file}: ${s.value}`);
    expect(literals.length).toBeGreaterThanOrEqual(1);
    const unbucketed = [...union, ...derived, ...all.filter((s) => s.kind === "literal").map((s) => s.value ?? "")].filter((v) => !BUCKETED.has(v));
    expect(unbucketed).toEqual([]);
    // And the fold buckets nothing the writers cannot produce.
    expect([...BUCKETED].sort()).toEqual([...new Set(union)].sort());
  });

  it("no shorthand-property or assignment write form the classifier above cannot see the value of", () => {
    const hidden = SOURCES.flatMap(({ file, src }) =>
      Array.from(src.matchAll(/(?<![.\w])answering[Ll]ayer\s*(=(?![=>])|,|\})/g), (m) => `${file}: ${m[0]}`),
    );
    expect(hidden).toEqual([]);
  });

  it("no raw-SQL write of answering_layer outside the schema column definition", () => {
    const raw = SOURCES.filter((s) => s.file !== "shared/schema.ts" && /answering_layer/.test(s.src)).map((s) => s.file);
    expect(raw).toEqual([]);
  });

  it("migrations: any literal written to answering_layer is bucketed", () => {
    const dir = path.join(ROOT, "migrations");
    const sqlFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThan(200);
    const touching = sqlFiles.filter((f) => /answering_layer/.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(touching, "0287 adds the column (vacuity floor)").toContain("0287_d1_data_sourcing_foundation.sql");
    const bad: string[] = [];
    for (const f of touching) {
      const body = fs.readFileSync(path.join(dir, f), "utf8").replace(/--.*$/gm, "");
      for (const stmt of body.split(";").filter((s) => /answering_layer/.test(s))) {
        for (const lit of stmt.matchAll(/'([^']*)'/g)) if (!BUCKETED.has(lit[1])) bad.push(`${f}: '${lit[1]}'`);
      }
    }
    expect(bad).toEqual([]);
  });
});

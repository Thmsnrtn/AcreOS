/**
 * The client never bundles the county parcel-source census DATA.
 *
 * The browser renders coverage it gets from the API, and needs only the
 * types, labels and rule in shared/landData/countyCoverage.ts.
 * shared/landData/countySourceCensus.ts builds the census from its 95-county
 * JSON at module load, which a bundler cannot prove pure. So one value import
 * of it from anywhere the client reaches ships the whole JSON (about 68 KB)
 * into the bundle, as it did until 2026-10-29 through LandCoveragePanel.
 *
 * Population: every client/src file is a root, and value imports are
 * followed transitively through shared/. A shared module that re-imports the
 * census is caught too, not only a direct client import. `import type` is
 * erased by the compiler and is not followed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const CENSUS_DATA = ["shared/landData/countySourceCensus.ts", "shared/landData/countySourceCensus.tn.json"];
// Value imports and re-exports; `import type` / `export type` are skipped below.
const IMPORT = /\b(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@shared/")) base = path.join(ROOT, "shared", spec.slice("@shared/".length));
  else if (spec.startsWith(".") && path.relative(ROOT, from).startsWith("shared")) base = path.resolve(path.dirname(from), spec);
  else return null; // client-internal, packages, or node_modules: client files are all roots already
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

describe("the client bundle never reaches the census data", () => {
  const roots = walk(path.join(ROOT, "client/src"));
  const reached = new Set<string>();
  const via = new Map<string, string>();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.pop()!;
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(IMPORT)) {
      if (m[1]) continue; // import type / export type
      const target = resolve(m[2] ?? m[3], f);
      if (!target || reached.has(target)) continue;
      reached.add(target);
      via.set(target, path.relative(ROOT, f));
      if (/\.(ts|tsx)$/.test(target)) queue.push(target);
    }
  }
  const rel = new Set([...reached].map((f) => path.relative(ROOT, f)));

  it("walks a real population (vacuity)", () => {
    expect(roots.length).toBeGreaterThan(800);
    expect(rel.size).toBeGreaterThan(100);
    // The one client consumer of coverage reaches the browser-safe module.
    expect(rel.has("shared/landData/countyCoverage.ts")).toBe(true);
  });

  it("no client file reaches countySourceCensus.ts or its JSON through a value import", () => {
    const hits = CENSUS_DATA.filter((f) => rel.has(f)).map((f) => `${f} (imported by ${via.get(path.join(ROOT, f))})`);
    expect(hits, "import the types/labels from @shared/landData/countyCoverage instead — the census data is server-side").toEqual([]);
  });
});

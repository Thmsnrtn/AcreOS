/**
 * DEFECT-0057 — chart colours come from the palette modules, not hex literals.
 *
 * `lint:page-hex` holds client/src/pages/**. The chart COMPONENTS were outside
 * that population, and the last hex-coloured charts lived there: MRR
 * trajectory (its gradients did not even match its own series strokes),
 * attribution, pipeline velocity, the founder finance steering charts and the
 * analytics forecast label. They now read `@/lib/chartPalette` (CVD-safe,
 * theme-independent) or `@/lib/chart-colors` (theme tokens).
 *
 * Population: every .tsx under client/src/components that imports recharts or
 * the shadcn chart wrapper. A new chart component is in the rule the moment it
 * imports either; a vacuity floor stops the walk from silently finding none.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");
const COMPONENTS = resolve(ROOT, "client/src/components");

/**
 * Hex literals that are not colours we chose. Each is keyed by file and the
 * exact literal, and must still be present (a stale entry fails).
 */
const ALLOWED: Record<string, { literal: string; reason: string }[]> = {
  "client/src/components/ui/chart.tsx": [
    { literal: "#ccc", reason: "selector matching Recharts' own default grid stroke so it can be overridden" },
    { literal: "#fff", reason: "selector matching Recharts' own default dot stroke so it can be overridden" },
  ],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// A colour literal: # then 3, 4, 6 or 8 hex digits, not part of a longer
// token, and not an HTML entity (&#…).
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;

const charts = walk(COMPONENTS)
  .map((p) => ({ file: relative(ROOT, p), src: stripComments(readFileSync(p, "utf8")) }))
  .filter((f) => /from\s+["'](recharts|@\/components\/ui\/chart)["']/.test(f.src));

describe("DEFECT-0057 — chart components carry no hex colour literals", () => {
  it("finds the chart components (vacuity floor)", () => {
    expect(charts.length).toBeGreaterThanOrEqual(12); // 14 at 2026-09-27
    expect(charts.map((c) => c.file)).toContain("client/src/components/dashboard/MRRTrajectory.tsx");
  });

  it("no chart component hardcodes a colour", () => {
    const offenders: string[] = [];
    for (const c of charts) {
      const allowed = new Set((ALLOWED[c.file] ?? []).map((a) => a.literal.toLowerCase()));
      for (const m of c.src.matchAll(HEX)) {
        if (!allowed.has(m[0].toLowerCase())) offenders.push(`${c.file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every allowance is still needed", () => {
    for (const [file, entries] of Object.entries(ALLOWED)) {
      const c = charts.find((x) => x.file === file);
      expect(c, `${file} is no longer a chart component`).toBeDefined();
      for (const e of entries) expect(c!.src.toLowerCase(), `${file} no longer contains ${e.literal}`).toContain(e.literal);
    }
  });
});

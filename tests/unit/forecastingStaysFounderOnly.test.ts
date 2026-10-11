/**
 * No forecast reaches a customer surface without a live scored record.
 *
 * Today no engine has one (shared/forecasting/scoring.ts customerForecastGate),
 * so the property is: forecasts are reachable ONLY through founder surfaces.
 *
 * THE POPULATION: every .ts/.tsx file under server/, client/src/ and shared/
 * (outside the forecasting directories themselves) that imports a forecasting
 * module or names a forecasting API path. Each must be on the allowlist below
 * with its reason; a new importer fails until it is listed — and a customer
 * route may only be listed if it consumes customerForecastGate.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOTS = ["server", "client/src", "shared"];
const OWN = ["shared/forecasting/", "server/services/forecasting/"];

/** Who may reach forecasting, and why. */
const ALLOWED: Record<string, string> = {
  "server/routes-founder-forecasting.ts": "the founder outlook route (requireFounder)",
  "server/jobs/forecastingJobs.ts": "the monthly recorder/issuer/scorer job",
  "server/jobs/runScheduledJobs.ts": "starts the monthly job",
  "server/routes.ts": "mounts the founder outlook route",
  "server/routeManifest.ts": "describes that mount",
  "server/providers-init.ts": "registers the public-series provider",
  "shared/schema/forecasting.ts": "the stores' types",
  "shared/schema.ts": "re-exports the stores",
  "client/src/components/founder/LetterOutlook.tsx": "the Letter's outlook section (founder door)",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...walk(p)); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Module specifiers and string literals in a file (comments never visited). */
function reachesForecasting(path: string, src: string): boolean {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let hit = false;
  const visit = (n: ts.Node) => {
    if (hit) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /(@shared\/forecasting\/|shared\/forecasting\/|\.\.\/forecasting\/|services\/forecasting\/|schema\/forecasting$|\/api\/founder\/forecasting|forecastingJobs|routes-founder-forecasting)/.test(n.text)) hit = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hit;
}

describe("forecasts stay founder-only until the live gate opens", () => {
  const files = ROOTS.flatMap(walk).filter((f) => !OWN.some((o) => f.startsWith(o)));
  const importers = files.filter((f) => reachesForecasting(f, readFileSync(f, "utf8"))).sort();

  it("scans the whole tree (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(importers.length).toBeGreaterThanOrEqual(5);
  });

  it("every file that reaches forecasting is on the allowlist", () => {
    expect(importers.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it("every allowlisted file still reaches forecasting (no stale entries)", () => {
    expect(Object.keys(ALLOWED).filter((f) => !importers.includes(f))).toEqual([]);
  });

  it("the only route serving forecasts is founder-gated", () => {
    const src = readFileSync("server/routes-founder-forecasting.ts", "utf8");
    const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"([^)]*?)async/gs)];
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r[2]).toMatch(/^\/api\/founder\/forecasting\//);
      expect(r[3]).toMatch(/requireFounder/);
    }
  });

  it("canary: a customer page importing a forecast would be caught", () => {
    expect(reachesForecasting("client/src/pages/map.tsx", 'import { PUBLIC_PRIORS } from "@shared/forecasting/publicPriors";')).toBe(true);
    expect(reachesForecasting("server/routes-leads.ts", 'const r = await fetch("/api/founder/forecasting/outlook");')).toBe(true);
    expect(reachesForecasting("server/routes-leads.ts", "// once used @shared/forecasting/publicPriors\nconst x = 1;")).toBe(false);
    // The customer /forecasting page is the note-portfolio cash-flow schedule
    // (server/services/cashFlowForecaster.ts), not a market forecast; its
    // route string is not a forecasting-module import.
    expect(reachesForecasting("client/src/App.tsx", 'const P = React.lazy(() => import("@/pages/forecasting"));')).toBe(false);
  });
});

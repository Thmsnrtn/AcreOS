/**
 * Fair-housing gate: no forecasting model or feature uses a protected
 * characteristic or an obvious stand-in for one.
 *
 * THE POPULATION, enumerated so a new member is the thing that fails:
 *   1. every model in FORECAST_MODELS and each of its features;
 *   2. every public series family the recorder reads (PUBLIC_SERIES);
 *   3. every field the customer-outcome recorder may store (OUTCOME_FIELDS),
 *      and the recorder's own source, which may write no other key;
 *   4. every source file under the forecasting directories — each must be
 *      claimed in FORECASTING_MODULES (an unclaimed file is a model the
 *      registry never declared), and every identifier and string literal in
 *      it is checked. Parsed with the TypeScript compiler, so a comment that
 *      explains what was removed is never read as the defect.
 *
 * Canaries below prove the check goes red on each shape it relies on.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
import { FORECAST_MODELS, OUTCOME_FIELDS, type OutcomeField } from "../../shared/forecasting/models";
import { PUBLIC_SERIES, STATE_CODES } from "../../shared/forecasting/publicSeries";
import { checkModels, words, type CheckableModel } from "../../shared/forecasting/fairHousing";

// scripts/forecasting builds the committed priors every engine and the twin
// read, so its features are model features too.
const DIRS = ["shared/forecasting", "server/services/forecasting", "scripts/forecasting"];
const OUTCOME_FIELD_KEYS = Object.keys(OUTCOME_FIELDS) as OutcomeField[];

/** Protected or proxy terms in one piece of text — checked through the guard's own entry point. */
function findTerms(text: string, where: string) {
  return checkModels([{ id: where, geography: "county", features: [{ id: "x", description: text, from: "y" }] }]);
}

/**
 * Every source file under the forecasting directories, and the model(s) it
 * implements (or "infrastructure"). The gate fails on an unlisted file.
 */
const FORECASTING_MODULES: Readonly<Record<string, readonly string[]>> = {
  "shared/forecasting/publicSeries.ts": ["infrastructure"],
  "shared/forecasting/vintage.ts": ["infrastructure"],
  "shared/forecasting/stats.ts": ["infrastructure"],
  "shared/forecasting/cyclePhase.ts": ["cycle_phase_payrolls"],
  "shared/forecasting/landValue.ts": ["ag_land_value_growth"],
  "shared/forecasting/seasonality.ts": ["seasonal_prior_permits"],
  "shared/forecasting/downturnRunway.ts": ["acreos_downturn_runway"],
  "shared/forecasting/slots.ts": ["county_outcome_slot", "mail_saturation_slot"],
  "shared/forecasting/scoring.ts": ["infrastructure"],
  "shared/forecasting/frozenForecast.ts": ["infrastructure"],
  "shared/forecasting/models.ts": ["infrastructure"],
  "shared/forecasting/fairHousing.ts": ["infrastructure"],
  "shared/forecasting/publicPriors.ts": ["cycle_phase_payrolls", "seasonal_prior_permits", "ag_land_value_growth"],
  "server/services/forecasting/publicSeriesProvider.ts": ["infrastructure"],
  "server/services/forecasting/vintageRecorder.ts": ["infrastructure", "county_outcome_slot"],
  "server/services/forecasting/forecastLedger.ts": ["cycle_phase_payrolls", "ag_land_value_growth"],
  "server/services/forecasting/saturation.ts": ["mail_saturation_slot", "county_outcome_slot"],
  "server/services/forecasting/outlook.ts": ["cycle_phase_payrolls", "ag_land_value_growth", "acreos_downturn_runway"],
  "server/services/forecasting/monthlyJob.ts": ["infrastructure"],
  "scripts/forecasting/build-public-priors.ts": ["cycle_phase_payrolls", "seasonal_prior_permits", "ag_land_value_growth"],
};

/** The guard's own term list is the one file allowed to name the terms. */
const TERM_LIST_FILE = "shared/forecasting/fairHousing.ts";

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Every identifier and string literal in a source text — comments are never visited. */
function tokensOf(source: string, name = "x.ts"): string[] {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.push(n.text);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text);
      for (const s of n.templateSpans) out.push(s.literal.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function sourceViolations(path: string, source: string) {
  return tokensOf(source, path).flatMap((t) => findTerms(t, path));
}

describe("fair-housing gate — the population", () => {
  const files = DIRS.flatMap(tsFiles).sort();

  it("reads a non-trivial population (vacuity floor)", () => {
    expect(FORECAST_MODELS.length).toBeGreaterThanOrEqual(6);
    expect(FORECAST_MODELS.every((m) => m.features.length > 0)).toBe(true);
    expect(PUBLIC_SERIES.length).toBeGreaterThanOrEqual(4);
    expect(OUTCOME_FIELD_KEYS.length).toBeGreaterThanOrEqual(5);
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it("every forecasting source file is claimed by the model registry (an unclaimed file is an undeclared model)", () => {
    const claimed = new Set(Object.keys(FORECASTING_MODULES));
    expect(files.filter((f) => !claimed.has(f))).toEqual([]);
    // ...and every claim points at a file that exists and a model that is registered.
    const models = new Set([...FORECAST_MODELS.map((m) => m.id), "infrastructure"]);
    for (const [f, ms] of Object.entries(FORECASTING_MODULES)) {
      expect(existsSync(f), f).toBe(true);
      for (const m of ms) expect(models.has(m), `${f} claims unknown model ${m}`).toBe(true);
    }
  });

  it("no model, feature or geography uses a protected characteristic or a proxy", () => {
    expect(checkModels(FORECAST_MODELS)).toEqual([]);
  });

  it("no public series the recorder reads is one", () => {
    for (const f of PUBLIC_SERIES) {
      expect(findTerms(`${f.id} ${f.label} ${f.publisher}`, f.id)).toEqual([]);
      for (const st of STATE_CODES) expect(findTerms(f.seriesIdFor(st), f.id)).toEqual([]);
    }
  });

  it("no customer-outcome field is one, and the recorder writes no field outside OUTCOME_FIELDS", () => {
    for (const k of OUTCOME_FIELD_KEYS) expect(findTerms(`${k} ${OUTCOME_FIELDS[k]}`, k)).toEqual([]);
    const src = readFileSync("server/services/forecasting/vintageRecorder.ts", "utf8");
    const sf = ts.createSourceFile("r.ts", src, ts.ScriptTarget.Latest, true);
    const written: string[] = [];
    const visit = (n: ts.Node) => {
      // Every object literal passed to outcomeValues(...) — the only way a value reaches `values`.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "outcomeValues") {
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) for (const p of arg.properties) if (p.name && ts.isIdentifier(p.name)) written.push(p.name.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(written.length).toBeGreaterThanOrEqual(6); // vacuity: the parser found the call sites
    expect(written.filter((k) => !(OUTCOME_FIELD_KEYS as string[]).includes(k))).toEqual([]);
  });

  it("no identifier or string literal in any forecasting source names one", () => {
    const found = files.filter((f) => f !== TERM_LIST_FILE).flatMap((f) => sourceViolations(f, readFileSync(f, "utf8")));
    expect(found.map((v) => `${v.where}: "${v.text}" (${v.term})`)).toEqual([]);
  });
});

describe("fair-housing gate — canaries (each shape goes red)", () => {
  const base: CheckableModel = { id: "m", geography: "county", features: [{ id: "payrollGrowth6m", description: "jobs", from: "state_payrolls" }] };
  const red = (over: Partial<CheckableModel["features"][number]>, geography = "county") =>
    checkModels([{ ...base, geography, features: [{ ...base.features[0], ...over }] }]);

  it("a protected attribute as a feature id, in camelCase", () => expect(red({ id: "ownerAge" }).map((v) => v.term)).toContain("age"));
  it("a protected attribute in a description", () => expect(red({ description: "share by race of the tract" }).length).toBeGreaterThan(0));
  it("a proxy in the source", () => expect(red({ from: "acs_language_spoken_at_home" }).map((v) => v.term)).toContain("language"));
  it("a multi-word proxy split across case", () => expect(red({ id: "ownerSurnameOrigin" }).map((v) => v.term)).toContain("surname"));
  it("a geography finer than a county", () => expect(red({}, "tract").map((v) => v.term)).toContain("geography finer than a county"));
  it("a ZIP-level feature", () => expect(red({ id: "zipMedianValue" }).map((v) => v.term)).toContain("zip"));
  it("words are whole words: acreage, average and message are not age", () => {
    expect(red({ id: "acreage", description: "average price per acre", from: "message volume" })).toEqual([]);
    expect(words("ownerAgeBand")).toEqual(["owner", "age", "band"]);
  });
  it("the source scan reads literals and identifiers, and ignores comments", () => {
    expect(sourceViolations("x.ts", 'const f = { id: "familialStatus" };').length).toBeGreaterThan(0);
    expect(sourceViolations("x.ts", "const religionScore = 1;").length).toBeGreaterThan(0);
    expect(sourceViolations("x.ts", "const t = `by ${x} ethnicity`;").length).toBeGreaterThan(0);
    expect(sourceViolations("x.ts", "// we removed the race feature\nconst ok = 1;")).toEqual([]);
  });
});

/**
 * The Pax glossary's long copy is served as a static asset, not bundled.
 *
 * BD-6 (the #524 learn-content pattern): shared/pax-glossary.ts rendered
 * 16,714 B inside the entry chunk because every Pax surface imports from
 * the one module. The shell subset now lives in shared/pax-glossary-core
 * .ts (bundled, synchronous — shell surfaces print it in first render),
 * the full glossary's data ships as shared/pax-glossary.json served at
 * /pax-glossary.json, and the one fetch-tolerant consumer (the Settings
 * → Pax page) loads it through client/src/lib/pax-glossary.tsx. That
 * stays safe only while:
 *
 *   1. the served JSON is VERBATIM the TS module's data — same strings,
 *      no silent edits to help text (the module stays the source of
 *      truth for the server, which imports it synchronously);
 *   2. the function members the JSON cannot carry are exactly the ones
 *      recorded in $functions, and the client loader's rebuilt functions
 *      return exactly what the module's return over a battery of inputs;
 *   3. no client file value-imports the full glossary module — a body
 *      that sneaks back into the bundle silently re-spends the saving;
 *   4. the vite plugin copies the asset verbatim and dev-serves it, and
 *      the static server never gives the unhashed asset the 1-year
 *      immutable cache.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import request from "supertest";
import * as glossary from "../../shared/pax-glossary";
import * as core from "../../shared/pax-glossary-core";
import { buildPaxGlossary } from "../../client/src/lib/pax-glossary";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// This suite walks all of client/src (a repo-wide sweep); its cost scales
// with the tree, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ASSET = JSON.parse(read("shared/pax-glossary.json")) as Record<string, unknown>;

// ── Verbatim: asset data == module data ────────────────────────────────────

function stripFunctions(value: unknown, at: string, fnPaths: string[]): unknown {
  if (typeof value === "function") {
    fnPaths.push(at);
    return undefined;
  }
  if (Array.isArray(value)) return value.map((v, i) => stripFunctions(v, `${at}[${i}]`, fnPaths));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripFunctions(v, at ? `${at}.${k}` : k, fnPaths);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

describe("the served glossary asset is verbatim the TS module's data", () => {
  it("deep-equals the module's data, export by export", () => {
    const fnPaths: string[] = [];
    const moduleData: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(glossary)) {
      const stripped = stripFunctions(value, name, fnPaths);
      if (stripped !== undefined) moduleData[name] = stripped;
    }
    const { $functions, ...assetData } = ASSET;
    expect(assetData).toEqual(moduleData);
    expect($functions).toEqual(fnPaths.sort());
  });

  it("carries the heavy copy the page used to bundle (vacuity)", () => {
    const page = ASSET.PAX_PAGE_COPY as Record<string, unknown>;
    expect(typeof page.title).toBe("string");
    expect((ASSET.PAX_NEVER_LIST as unknown[]).length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(ASSET).length).toBeGreaterThan(10_000);
  });

  it("the core's one duplicated string matches the page copy it mirrors", () => {
    const settings = ASSET.PAX_SETTINGS_COPY as { quickFind: { pause: { label: string } } };
    const page = ASSET.PAX_PAGE_COPY as { pauseButton: string };
    expect(settings.quickFind.pause.label).toBe(page.pauseButton);
    expect(core.PAX_SETTINGS_COPY.quickFind.pause.label).toBe(glossary.PAX_PAGE_COPY.pauseButton);
  });

  it("the core module's values are the glossary's (re-export, not a copy)", () => {
    expect(core.PAX_LABELS).toBe(glossary.PAX_LABELS);
    expect(core.PAX_SETTINGS_COPY).toBe(glossary.PAX_SETTINGS_COPY);
    expect(core.PAX_RULES_COPY).toBe(glossary.PAX_RULES_COPY);
    expect(core.PAX_RECEIPT_WORDS).toBe(glossary.PAX_RECEIPT_WORDS);
    expect(core.formatPaxTime).toBe(glossary.formatPaxTime);
    expect(glossary.PAX_STANCE_COPY.ask_before_sending.label).toBe(core.PAX_STANCE_LABELS.ask_before_sending);
    expect(glossary.PAX_RAIL_COPY.levels).toBe(core.PAX_RAIL_LEVEL_WORDS);
    expect(glossary.PAX_RAIL_COPY.domains).toBe(core.PAX_RAIL_DOMAINS);
    expect(glossary.PAX_PAUSE_COPY.stillWorks).toBe(core.PAX_PAUSE_STILL_WORKS);
  });
});

// ── The loader rebuilds the functions faithfully ───────────────────────────

describe("the client loader's rebuilt functions match the module's", () => {
  const built = buildPaxGlossary(ASSET);
  const when = new Date("2026-11-05T13:00:00Z");

  it("pause copy: every shape of words", () => {
    const cases = [
      { until: when, byName: "Maria", timeZone: "America/Chicago" },
      { until: when, byName: null, timeZone: "America/Chicago" },
      { until: null, byName: "Maria", timeZone: undefined },
      { until: null, byName: null, timeZone: undefined },
    ] as const;
    for (const words of cases) {
      expect(built.PAX_PAUSE_COPY.statusLine(words)).toBe(glossary.PAX_PAUSE_COPY.statusLine(words));
      expect(built.PAX_PAUSE_COPY.sentence(words)).toBe(glossary.PAX_PAUSE_COPY.sentence(words));
      expect(built.PAX_PAUSE_COPY.refusal(words)).toBe(glossary.PAX_PAUSE_COPY.refusal(words));
      expect(built.PAX_PAUSE_COPY.skippedLine(words)).toBe(glossary.PAX_PAUSE_COPY.skippedLine(words));
    }
    expect(built.PAX_PAUSE_COPY.resumesByItself(when, "America/Chicago")).toBe(
      glossary.PAX_PAUSE_COPY.resumesByItself(when, "America/Chicago"),
    );
    expect(built.PAX_PAUSE_COPY.stillWorks).toBe(glossary.PAX_PAUSE_COPY.stillWorks);
    expect(built.PAX_PAUSE_COPY.checkFailedRefusal).toBe(glossary.PAX_PAUSE_COPY.checkFailedRefusal);
  });

  it("group, rail and site functions", () => {
    const limits = { emailsPerDay: 50, textsPerDay: 20, textHours: "8 am–9 pm" };
    expect(built.PAX_GROUP_COPY.runs_rules.ifYouNeverTouchThis(limits)).toBe(
      glossary.PAX_GROUP_COPY.runs_rules.ifYouNeverTouchThis(limits),
    );
    expect(built.PAX_RAIL_COPY.changed("Leads", "Ask")).toBe(glossary.PAX_RAIL_COPY.changed("Leads", "Ask"));
    expect(built.PAX_RAIL_COPY.watchRefusal("Leads")).toBe(glossary.PAX_RAIL_COPY.watchRefusal("Leads"));
    expect(built.PAX_MY_SITES_COPY.added("Cochise County assessor")).toBe(
      glossary.PAX_MY_SITES_COPY.added("Cochise County assessor"),
    );
    expect(built.PAX_MY_SITES_COPY.removed("Cochise County assessor")).toBe(
      glossary.PAX_MY_SITES_COPY.removed("Cochise County assessor"),
    );
    expect(built.PAX_MY_SITES_COPY.listFull(10)).toBe(glossary.PAX_MY_SITES_COPY.listFull(10));
  });

  it("page copy functions", () => {
    const b = built.PAX_PAGE_COPY;
    const g = glossary.PAX_PAGE_COPY;
    const rightNow = {
      waiting: 3,
      changedTodayOnItsOwn: 1,
      rulesRunning: { workflows: 1, sequences: 0, scheduledPrompts: 2 },
    };
    expect(b.rightNow(rightNow)).toBe(g.rightNow(rightNow));
    expect(b.switchesLiveOn("the Pax page")).toBe(g.switchesLiveOn("the Pax page"));
    expect(b.lastRan("Thu 8:00 am")).toBe(g.lastRan("Thu 8:00 am"));
    expect(b.lastSend("Thu 8:00 am")).toBe(g.lastSend("Thu 8:00 am"));
    expect(b.workflowsLine({ active: 2, live: 1, lastRan: "Thu 8:00 am" })).toBe(
      g.workflowsLine({ active: 2, live: 1, lastRan: "Thu 8:00 am" }),
    );
    expect(b.workflowsLine({ active: 0, live: 0, lastRan: null })).toBe(g.workflowsLine({ active: 0, live: 0, lastRan: null }));
    expect(b.sequencesLine({ activeEnrollments: 1, lastSend: null })).toBe(
      g.sequencesLine({ activeEnrollments: 1, lastSend: null }),
    );
    expect(b.scheduledPromptsLine({ on: 2, total: 3 })).toBe(g.scheduledPromptsLine({ on: 2, total: 3 }));
    expect(b.promptNextRun("Fri 9:00 am")).toBe(g.promptNextRun("Fri 9:00 am"));
    expect(b.runHistoryTitle("Morning check")).toBe(g.runHistoryTitle("Morning check"));
    expect(b.leadScoringLine({ lastRan: null, rescoredToday: 4 })).toBe(g.leadScoringLine({ lastRan: null, rescoredToday: 4 }));
    expect(b.borrowerRemindersLine({ waiting: 2 })).toBe(g.borrowerRemindersLine({ waiting: 2 }));
    const rules = { emailsUsedToday: 5, emailLimit: 50, textsUsedToday: 1, textLimit: 20 };
    expect(b.fixedRulesLine(rules)).toBe(g.fixedRulesLine(rules));
    expect(b.switchToast("Lead scoring", true)).toBe(g.switchToast("Lead scoring", true));
    expect(b.switchToast("Lead scoring", false)).toBe(g.switchToast("Lead scoring", false));
    expect(b.waitingLink(7)).toBe(g.waitingLink(7));
  });

  it("the built objects' data is the asset's data (no builder edits)", () => {
    const fnPaths: string[] = [];
    const builtData = stripFunctions(built, "", fnPaths);
    const heavy: Record<string, unknown> = {};
    for (const name of Object.keys(built)) heavy[name] = ASSET[name];
    expect(builtData).toEqual(heavy);
  });
});

// ── Wiring: nothing client-side bundles the full glossary ──────────────────

describe("the full glossary stays out of the client bundle", () => {
  function clientFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) out.push(...clientFiles(p));
      else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }

  it("no client file value-imports @shared/pax-glossary", () => {
    const offenders: string[] = [];
    for (const file of clientFiles(path.join(ROOT, "client/src"))) {
      const src = stripComments(read(path.relative(ROOT, file)));
      // Type-only imports are erased at build time and are allowed.
      const valueImports = src.match(/import\s+(?!type\b)[^;]*?from\s*["']@shared\/pax-glossary["']/gs) ?? [];
      if (valueImports.length > 0) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("the page reads its copy through the loader, the shell through the core", () => {
    const page = stripComments(read("client/src/pages/settings/pax-controls.tsx"));
    expect(page).toMatch(/from\s*["']@\/lib\/pax-glossary["']/);
    expect(page).toMatch(/PaxGlossaryProvider/);
    expect(page).toMatch(/from\s*["']@shared\/pax-glossary-core["']/);
    const rail = stripComments(read("client/src/components/pax-copilot-rail.tsx"));
    expect(rail).toMatch(/from\s*["']@shared\/pax-glossary-core["']/);
  });

  it("the loader rejects a failed fetch instead of resolving empty", () => {
    const loader = stripComments(read("client/src/lib/pax-glossary.tsx"));
    expect(loader).toMatch(/if \(!res\.ok\) \{\s*throw new Error/);
    expect(loader).toMatch(/fetch\(PAX_GLOSSARY_URL\)/);
  });

  it("the vite plugin copies the asset verbatim and serves it in dev", () => {
    const config = stripComments(read("vite.config.ts"));
    expect(config).toMatch(/function paxGlossaryPlugin\(\)/);
    expect(config).toMatch(/fs\.copyFileSync\(sourcePath, dest\)/);
    expect(config).toMatch(/"acreos-pax-glossary"/);
    expect(config).toMatch(/CUSTOMER_ONLY_PLUGIN_NAMES = new Set\(\[[^\]]*"acreos-pax-glossary"/);
    expect(config).toMatch(/paxGlossaryPlugin\(\)/);
  });
});

// ── Serving: the unhashed asset never gets the immutable cache ─────────────

describe("/pax-glossary.json is never immutable", () => {
  const IMMUTABLE = "public, max-age=31536000, immutable";
  let dist: string;
  let app: express.Express;
  const priorEnv = process.env.NODE_ENV;

  function write(rel: string, body: string | Buffer) {
    const file = path.join(dist, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  it("serves no-cache on both the plain and pre-compressed routes", async () => {
    const { serveStatic } = await import("../../server/static");
    process.env.NODE_ENV = "production";
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "pax-glossary-cache-"));
    try {
      write("index.html", "<html><head></head><body>shell</body></html>");
      write("pax-glossary.json", '{"PAX_LABELS":{}}');
      write("pax-glossary.json.gz", zlib.gzipSync('{"PAX_LABELS":{}}'));
      app = express();
      serveStatic(app, dist);

      const plain = await request(app).get("/pax-glossary.json").set("Accept-Encoding", "identity");
      expect(plain.status).toBe(200);
      expect(plain.headers["cache-control"]).not.toBe(IMMUTABLE);
      expect(plain.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");

      const gz = await request(app).get("/pax-glossary.json").set("Accept-Encoding", "gzip");
      expect(gz.status).toBe(200);
      expect(gz.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    } finally {
      if (priorEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = priorEnv;
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });
});

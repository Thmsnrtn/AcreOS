/**
 * Founder decision 2026-10-11 (from the founder's picker): AcreOS stops using
 * the Tennessee "Property Boundaries Public Use" service — its item says it is
 * not intended for commercial use. Not live, not stored, not sampled.
 *
 * The gate is about the URL, not about any row or name that carried it,
 * because the service reached production through a seeded statewide row and
 * could come back through a county row, a registry entry, a script or a
 * pasted link. Three layers, each falsified here:
 *
 *  1. THE PREDICATE. blockedOutboundSource() recognises the service in every
 *     equivalent spelling (case, padding slashes, percent-encoding, layer and
 *     query suffixes, another host mirroring the same service, the item and
 *     map ids) — and nothing else.
 *  2. THE CHOKEPOINTS. fetchGeo refuses it before a request; the process-wide
 *     fetch guard refuses it for string, URL and Request inputs; both server
 *     entrypoints install the guard as their FIRST import.
 *  3. THE POPULATION. Every outbound HTTP primitive in server/, scripts/ and
 *     script/ is enumerated: bare fetch is covered by the guard in server
 *     code; a script that fetches must install the guard or be registered as
 *     fixed-host; any non-fetch primitive (node http/https, axios, got,
 *     undici, node-fetch, curl/wget via a shell) must be registered with a
 *     reason. Canaries prove the scanner sees each shape, a floor proves it
 *     still reads the tree, and stale registrations fail.
 *  4. NO COPY OF THE URL. No source or data file outside the registry and the
 *     retiring migration names the service or its ids.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";
import { blockedOutboundSource } from "../../server/services/providers/blockedOutboundSources";
import { installOutboundGuard } from "../../server/outboundGuard";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const SVC = "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer";

describe("1. the predicate recognises the service in every spelling", () => {
  const SAME_SERVICE = [
    SVC,
    `${SVC}/0`,
    `${SVC}/0/query?where=1%3D1&f=geojson`,
    `${SVC}/`.toUpperCase(),
    SVC.replace("/rest/services/", "/rest//services//"),
    SVC.replace("Tennessee_Property_Boundaries_Public_Use", "Tennessee%5FProperty%5FBoundaries%5FPublic%5FUse"),
    "http://services9.arcgis.com/OtherOrg/arcgis/rest/services/tennessee_property_boundaries_public_use/FeatureServer/0",
    "https://www.arcgis.com/home/item.html?id=e356f1a241844d6f9025f2fa4e977df3",
    "https://www.arcgis.com/sharing/rest/content/items/e356f1a241844d6f9025f2fa4e977df3/data",
    "https://tn-tnmap.opendata.arcgis.com/maps/53ee269639334ad8b70bfea77bde7333",
  ];
  for (const u of SAME_SERVICE) {
    it(`blocks ${u.slice(0, 90)}`, () => {
      expect(blockedOutboundSource(u)?.licenseSource).toBe("TN Property Boundaries Public Use service");
      expect(blockedOutboundSource(new URL(u))).not.toBeNull();
    });
  }
  it("blocks nothing else: other TN and statewide sources stay reachable", () => {
    for (const u of [
      "https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html",
      "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0",
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query",
      "https://app.regrid.com/api/v2/parcels/point?lat=36&lon=-86",
      "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6",
    ]) expect(blockedOutboundSource(u), u).toBeNull();
  });
});

describe("2. the chokepoints refuse it before any request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetchGeo refuses it and never calls fetch", async () => {
    const spy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", spy);
    const { fetchGeo } = await import("../../server/services/providers/fetchGeo");
    await expect(fetchGeo(`${SVC}/0/query?f=json`)).rejects.toThrow(/^Refused: TN Property Boundaries Public Use service/);
    expect(spy).not.toHaveBeenCalled();
    // A permitted URL still goes through (the guard is not a blanket wall).
    await fetchGeo("https://tigerweb.geo.census.gov/arcgis/rest/services/x/query?f=json", { retries: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the process fetch guard refuses string, URL and Request inputs, and passes others through", async () => {
    const underlying = vi.fn(async () => new Response("ok"));
    const target = { fetch: underlying as unknown as typeof fetch };
    installOutboundGuard(target);
    installOutboundGuard(target); // idempotent: not double-wrapped
    for (const input of [`${SVC}/0`, new URL(`${SVC}/0`), new Request(`${SVC}/0/query`)]) {
      await expect(target.fetch(input as never)).rejects.toThrow(/^Refused: TN Property Boundaries Public Use service/);
    }
    expect(underlying).not.toHaveBeenCalled();
    await target.fetch("https://example.org/");
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("both server entrypoints install the guard as their FIRST import", () => {
    for (const f of ["server/index.ts", "server/worker.ts"]) {
      const src = stripComments(readFileSync(path.join(ROOT, f), "utf8"));
      const first = /^\s*import\b[^;]*;/m.exec(src)?.[0] ?? "";
      expect(first.replace(/\s+/g, " ").trim(), f).toBe('import "./outboundGuard";');
    }
  });
});

// ── 3. Population ─────────────────────────────────────────────────────────

interface Site { kind: string }
/** Every outbound HTTP primitive in a (comment-stripped) source text. */
function outboundSites(src: string): Site[] {
  const out: Site[] = [];
  const add = (re: RegExp, kind: string) => { for (const _ of src.matchAll(re)) out.push({ kind }); };
  add(/(?<![\w.$])fetch\s*\(/g, "fetch");
  add(/(?<![\w$])(?:https?|globalThis\.fetch|window\.fetch)\s*\.\s*(?:get|request)\s*\(/g, "node-http");
  add(/\bfrom\s+["'](?:node:)?https?["']|\brequire\(\s*["'](?:node:)?https?["']\s*\)/g, "node-http-import");
  add(/\bfrom\s+["'](?:axios|got|undici|node-fetch|superagent|needle|request)["']|\brequire\(\s*["'](?:axios|got|undici|node-fetch|superagent|needle|request)["']\s*\)/g, "http-library");
  add(/\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(\s*[`"'][^`"']*\b(?:curl|wget)\b/g, "shell-http");
  return out;
}

const NON_FETCH_REGISTER: Record<string, string> = {
  "server/middleware/snsVerification.ts": "https.get of the AWS SNS signing certificate; the URL is checked against the SNS host pattern before the call.",
  "server/index.ts": "imports node:http/https to CREATE the server, not to make requests.",
  "server/websocket.ts": "imports node:http types for the websocket server, not requests.",
  "server/routes.ts": "imports node:http createServer, not requests.",
  "server/utils/gracefulShutdown.ts": "imports node:http Server type for shutdown, not requests.",
  "server/vite.ts": "dev-server plumbing, not outbound requests.",
};

/**
 * Scripts that make bare fetch calls without the guard: every URL they fetch is
 * a fixed, non-parcel host (or the match is a string the linter prints). A
 * script that fetches a URL from data — a GIS row, a registry entry — must
 * import server/outboundGuard instead.
 */
const FIXED_HOST_SCRIPTS: Record<string, string> = {
  "scripts/check-model-ids.mjs": "Anthropic models API",
  "scripts/ingest-feedback-memories.mjs": "the app's own API",
  "scripts/uptimerobot-setup.mjs": "UptimeRobot API",
  "scripts/founder-recovery/cf-email-routing.mjs": "Cloudflare API",
  "scripts/founder-recovery/preflight.mjs": "fixed vendor health endpoints",
  "scripts/check-residential-comps-hold.mjs": "string in a lint message, not a call",
  "scripts/backfill-observations.mjs": "the app's own API",
  "scripts/ses-dkim-diagnose.mjs": "AWS SES API",
  "scripts/vendor-health-probe.mjs": "fixed vendor health endpoints",
  "scripts/ses-setup.mjs": "AWS SES API",
  "scripts/regenerate-team-state.mjs": "GitHub API",
  "scripts/lint-unchecked-mutation.mjs": "string in a lint message, not a call",
  "scripts/ingest-decision-memory.mjs": "the app's own API",
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(p);
  }
  return out;
}

const POPULATION = [...walk(path.join(ROOT, "server")), ...walk(path.join(ROOT, "scripts")), ...walk(path.join(ROOT, "script"))].map((f) => ({
  f: path.relative(ROOT, f),
  src: stripComments(readFileSync(f, "utf8")),
}));

describe("3. every outbound HTTP primitive is covered", () => {
  it("canaries: the scanner sees each shape", () => {
    const shapes: Array<[string, string]> = [
      ["await fetch(url)", "fetch"],
      ["const r = await fetch (`${base}/q`)", "fetch"],
      ["https.get(u, cb)", "node-http"],
      ["http.request({ host })", "node-http"],
      ['import https from "node:https";', "node-http-import"],
      ['const h = require("https")', "node-http-import"],
      ['import axios from "axios";', "http-library"],
      ['import { request } from "undici";', "http-library"],
      ['import fetch2 from "node-fetch";', "http-library"],
      ['execSync(`curl -s ${u}`)', "shell-http"],
      ["spawn('wget -q', [u])", "shell-http"],
    ];
    for (const [code, kind] of shapes) expect(outboundSites(code).map((s) => s.kind), code).toContain(kind);
    // Not a call: a property named fetch, a method on another object.
    expect(outboundSites("cache.fetch(key); obj.prefetch(x)")).toEqual([]);
  });

  it("the walk reads the tree (population floor)", () => {
    expect(POPULATION.length).toBeGreaterThan(1500);
    const fetchSites = POPULATION.flatMap((x) => outboundSites(x.src).filter((s) => s.kind === "fetch"));
    expect(fetchSites.length, "fetch call sites found — the scanner stopped reading?").toBeGreaterThan(150);
  });

  it("non-fetch primitives appear only where registered", () => {
    const unregistered = POPULATION.filter((x) => outboundSites(x.src).some((s) => s.kind !== "fetch") && !(x.f in NON_FETCH_REGISTER)).map((x) => x.f);
    expect(unregistered, "a non-fetch HTTP client bypasses the process fetch guard — route it through fetch/fetchGeo or register why it cannot reach a parcel source").toEqual([]);
  });

  it("a script that fetches installs the guard, or is registered fixed-host", () => {
    const scripts = POPULATION.filter((x) => /^scripts?\//.test(x.f) && outboundSites(x.src).some((s) => s.kind === "fetch"));
    const unguarded = scripts.filter((x) => !/import\s+["'][./]*\/?(?:\.\.\/)*server\/outboundGuard["']/.test(x.src) && !(x.f in FIXED_HOST_SCRIPTS));
    expect(unguarded.map((x) => x.f)).toEqual([]);
  });

  it("registrations are not stale (each registered file still has what it was registered for)", () => {
    for (const f of Object.keys(NON_FETCH_REGISTER)) {
      const x = POPULATION.find((p) => p.f === f);
      expect(x, `${f} is registered but gone`).toBeTruthy();
      expect(outboundSites(x!.src).some((s) => s.kind !== "fetch"), `${f} no longer has a non-fetch primitive — remove its entry`).toBe(true);
    }
    for (const f of Object.keys(FIXED_HOST_SCRIPTS)) {
      const x = POPULATION.find((p) => p.f === f);
      expect(x, `${f} is registered but gone`).toBeTruthy();
      expect(outboundSites(x!.src).some((s) => s.kind === "fetch"), `${f} no longer fetches — remove its entry`).toBe(true);
    }
  });
});

describe("4. no copy of the URL outside the registry", () => {
  const MARKERS = ["tennessee_property_boundaries_public_use", "e356f1a241844d6f9025f2fa4e977df3", "53ee269639334ad8b70bfea77bde7333"];
  const ALLOWED = new Set([
    "server/services/providers/blockedOutboundSources.ts", // the registry itself
    "server/services/providers/data-licenses.ts", // the terms citation (an item page, never fetched)
    "migrations/0271_tn_public_service_retired.sql", // deactivates rows that point at it
    "scripts/migrate.mjs", // mirrors 0271
  ]);
  const files = [
    ...walk(path.join(ROOT, "server")),
    ...walk(path.join(ROOT, "shared")),
    ...walk(path.join(ROOT, "client/src")),
    ...walk(path.join(ROOT, "scripts")),
    ...walk(path.join(ROOT, "script")),
  ];
  const data = [...readdirSync(path.join(ROOT, "shared/landData")).filter((n) => n.endsWith(".json")).map((n) => path.join(ROOT, "shared/landData", n)),
    ...readdirSync(path.join(ROOT, "migrations")).filter((n) => n.endsWith(".sql")).map((n) => path.join(ROOT, "migrations", n))];

  it("canary: the scan finds a marker in any spelling of the URL", () => {
    const hit = (t: string) => MARKERS.some((m) => t.toLowerCase().includes(m));
    expect(hit(SVC)).toBe(true);
    expect(hit(SVC.toUpperCase())).toBe(true);
    expect(hit("see item e356f1a241844d6f9025f2fa4e977df3")).toBe(true);
  });

  it("only the registry, the licence citation and the retiring migration name it", () => {
    expect(files.length + data.length).toBeGreaterThan(2000);
    const offenders = [...files, ...data]
      .map((f) => path.relative(ROOT, f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => {
        const t = readFileSync(path.join(ROOT, f), "utf8").toLowerCase();
        return MARKERS.some((m) => t.includes(m));
      });
    expect(offenders).toEqual([]);
  });

  it("the allowed files still need their place (no stale allowance)", () => {
    for (const f of ALLOWED) {
      const t = readFileSync(path.join(ROOT, f), "utf8").toLowerCase();
      expect(MARKERS.some((m) => t.includes(m)), f).toBe(true);
    }
  });
});

/**
 * /learn article bodies are served as static JSON, not bundled as JS.
 *
 * The corpus under content/learn/ used to be pulled into the client
 * bundle by eager import.meta.glob calls in the two learn registries —
 * ~132 KB of prose inside the bundle gate's summed JS total. The bodies
 * now ship as static files (vite.config.ts learnContentPlugin copies
 * each one verbatim into dist/public/learn-content/) and the article
 * pages fetch the one body they render. That stays safe only while:
 *
 *   1. neither registry imports a content JSON body or an eager glob —
 *      a body that sneaks back into the bundle silently re-spends the
 *      headroom this slice freed;
 *   2. the registries read the build-time metadata index from
 *      `virtual:acreos-learn-content`, whose declaration and the plugin
 *      that generates it stay in lockstep;
 *   3. existence (the not-found decision) is made synchronously from
 *      that index in both article pages — an unknown slug must render
 *      the not-found page immediately, never after a fetch;
 *   4. the /learn hub keeps reading only the synchronous list functions
 *      (it renders during prerender-adjacent first paint and must never
 *      wait on a body fetch);
 *   5. the corpus on disk keeps the fields the index builder reads —
 *      scripts/learn-content-index.test.mjs pins the builder against
 *      the corpus behaviourally; the checks here pin the wiring.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const registry = stripComments(read("client/src/pages/learn/registry.ts"));
const countyRegistry = stripComments(read("client/src/pages/learn/county-registry.ts"));

describe("learn bodies are not bundled", () => {
  it("neither registry globs or imports content JSON", () => {
    for (const [name, src] of [
      ["registry.ts", registry],
      ["county-registry.ts", countyRegistry],
    ] as const) {
      expect(src, `${name} must not use import.meta.glob`).not.toMatch(/import\.meta\.glob/);
      expect(src, `${name} must not import a .json body`).not.toMatch(/from\s*["'][^"']*\.json["']/);
    }
  });

  it("both registries read the build-time index and expose meta + fetch + list", () => {
    expect(registry).toMatch(/from\s*["']virtual:acreos-learn-content["']/);
    expect(registry).toMatch(/export function getLearnRouteMeta\(/);
    expect(registry).toMatch(/export function fetchLearnContent\(/);
    expect(registry).toMatch(/export function listLearnRoutes\(/);
    expect(countyRegistry).toMatch(/from\s*["']virtual:acreos-learn-content["']/);
    expect(countyRegistry).toMatch(/export function getCountyRouteMeta\(/);
    expect(countyRegistry).toMatch(/export function fetchCountyContent\(/);
    expect(countyRegistry).toMatch(/export function listCountyRoutes\(/);
  });

  it("a failed body fetch rejects instead of resolving an empty result", () => {
    // The empty-on-failure ratchet bans `if (!res.ok) return null` in
    // client code; the loader must throw so the page can show its
    // load-error state. Pin the throw so the shape can't drift back.
    expect(registry).toMatch(/if \(!res\.ok\) \{\s*throw new Error/);
    expect(countyRegistry).toMatch(/if \(!res\.ok\) \{\s*throw new Error/);
  });
});

describe("the Vite plugin wires index, verbatim copy and dev serving", () => {
  const config = stripComments(read("vite.config.ts"));

  it("builds the index from the shared builder and registers the plugin", () => {
    expect(config).toMatch(/from\s*["']\.\/scripts\/learn-content-index\.mjs["']/);
    expect(config).toMatch(/buildLearnContentIndex\(contentDir\)/);
    expect(config).toMatch(/plugins:\s*\[[^\]]*learnContentPlugin\(\)/s);
    expect(config).toMatch(/virtual:acreos-learn-content/);
  });

  it("copies bodies verbatim into the build output and serves them in dev", () => {
    expect(config).toMatch(/fs\.copyFileSync\(path\.join\(rootDir, entry\.sourcePath\), dest\)/);
    expect(config).toMatch(/configureServer\(server\)/);
  });

  it("the builder has a typed declaration for the config's import", () => {
    const decl = read("scripts/learn-content-index.d.mts");
    expect(decl).toMatch(/export declare function buildLearnContentIndex\(/);
    expect(decl).toMatch(/export declare const LEARN_CONTENT_URL_PREFIX: string;/);
  });

  it("the virtual module's type declaration matches the plugin's exports", () => {
    const decl = read("client/src/types/learn-content.d.ts");
    expect(decl).toMatch(/declare module "virtual:acreos-learn-content"/);
    expect(decl).toMatch(/LEARN_ARTICLES: LearnArticleIndexEntry\[\]/);
    expect(decl).toMatch(/LEARN_COUNTIES: LearnCountyIndexEntry\[\]/);
    expect(config).toMatch(/export const LEARN_ARTICLES = /);
    expect(config).toMatch(/export const LEARN_COUNTIES = /);
  });
});

describe("article pages decide existence synchronously, then fetch", () => {
  const statePage = stripComments(read("client/src/pages/learn/state-vertical.tsx"));
  const countyPage = stripComments(read("client/src/pages/learn/county.tsx"));

  it("state page: not-found is keyed on the sync meta lookup, body via fetch", () => {
    expect(statePage).toMatch(/getLearnRouteMeta\(vertical, state\)/);
    expect(statePage).toMatch(/if \(!meta\) \{\s*return <NotFoundForLearn \/>;/);
    expect(statePage).toMatch(/fetchLearnContent\(vertical, state\)/);
    expect(statePage).not.toMatch(/getLearnContent\(/);
  });

  it("county page: not-found is keyed on the sync meta lookup, body via fetch", () => {
    expect(countyPage).toMatch(/getCountyRouteMeta\(state, county\)/);
    expect(countyPage).toMatch(/if \(!meta\) \{\s*return <CountyNotFound \/>;/);
    expect(countyPage).toMatch(/fetchCountyContent\(state, county\)/);
    expect(countyPage).not.toMatch(/getCountyContent\(/);
  });

  it("the hub reads only the synchronous list functions", () => {
    const hub = stripComments(read("client/src/pages/learn/index.tsx"));
    expect(hub).toMatch(/listLearnRoutes\(\)/);
    expect(hub).toMatch(/listCountyRoutes\(\)/);
    expect(hub).not.toMatch(/fetchLearnContent|fetchCountyContent/);
  });
});

describe("the corpus keeps the fields the index builder reads", () => {
  function jsonFilesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) out.push(...jsonFilesUnder(p));
      else if (name.endsWith(".json")) out.push(p);
    }
    return out;
  }

  const files = jsonFilesUnder(path.join(ROOT, "content", "learn"));

  it("finds the corpus (vacuity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
  });

  it("every content file parses and carries its index fields", () => {
    for (const file of files) {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      expect(parsed, file).toBeTypeOf("object");
      const record = parsed as Record<string, unknown>;
      expect(typeof record.stateSlug, file).toBe("string");
      expect(typeof record.stateName, file).toBe("string");
      expect(typeof record.headline, file).toBe("string");
      if (file.includes(`${path.sep}county${path.sep}`)) {
        expect(typeof record.countySlug, file).toBe("string");
        expect(typeof record.countyName, file).toBe("string");
      } else {
        expect(typeof record.vertical, file).toBe("string");
      }
    }
  });
});

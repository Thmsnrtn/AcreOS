// ============================================================================
// scripts/learn-content-index.test.mjs
// ----------------------------------------------------------------------------
// Behavioural tests for the /learn content index builder. The builder is
// what stands between the authored corpus (content/learn/**/*.json) and
// the client bundle: it produces the metadata index the /learn hub,
// cross-links and not-found decisions read synchronously, and the URL
// each article body is served from as static JSON. If the index diverged
// from the corpus — a missing article, a headline read from the wrong
// field, a URL that doesn't match where vite.config.ts copies the body —
// a primer would silently vanish or 404. So every assertion here is made
// against an INDEPENDENT walk of the corpus on disk, never against the
// builder's own view of it.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { REPO_SWEEP_TIMEOUT_MS } from "../tests/helpers/sweepBudget";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLearnContentIndex,
  LEARN_CONTENT_URL_PREFIX,
} from "./learn-content-index.mjs";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "content", "learn");

// Independent ground-truth walk: directories and files straight off disk,
// content parsed per file. Deliberately shares no code with the builder.
function diskCorpus() {
  const articles = [];
  const counties = [];
  for (const dir of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (dir.name === "county") {
      for (const stateDir of readdirSync(path.join(CONTENT_DIR, "county"), { withFileTypes: true })) {
        if (!stateDir.isDirectory()) continue;
        for (const file of readdirSync(path.join(CONTENT_DIR, "county", stateDir.name))) {
          if (!file.endsWith(".json")) continue;
          counties.push({
            stateDir: stateDir.name,
            file,
            parsed: JSON.parse(
              readFileSync(path.join(CONTENT_DIR, "county", stateDir.name, file), "utf8"),
            ),
          });
        }
      }
      continue;
    }
    for (const file of readdirSync(path.join(CONTENT_DIR, dir.name))) {
      if (!file.endsWith(".json")) continue;
      articles.push({
        verticalDir: dir.name,
        file,
        parsed: JSON.parse(readFileSync(path.join(CONTENT_DIR, dir.name, file), "utf8")),
      });
    }
  }
  return { articles, counties };
}

const disk = diskCorpus();
const index = buildLearnContentIndex(CONTENT_DIR);

describe("learn content index builder", () => {
  it("finds the corpus on disk (vacuity)", () => {
    expect(disk.articles.length).toBeGreaterThanOrEqual(10);
    expect(disk.counties.length).toBeGreaterThanOrEqual(3);
    expect(index.articles.length).toBe(disk.articles.length);
    expect(index.counties.length).toBe(disk.counties.length);
  });

  it("every article on disk is indexed with its content-derived metadata", () => {
    for (const a of disk.articles) {
      const state = a.file.replace(/\.json$/, "");
      const entry = index.articles.find((e) => e.pathKey === `${a.verticalDir}::${state}`);
      expect(entry, `missing index entry for ${a.verticalDir}/${a.file}`).toBeDefined();
      expect(entry.vertical).toBe(a.parsed.vertical);
      expect(entry.stateSlug).toBe(a.parsed.stateSlug);
      expect(entry.stateName).toBe(a.parsed.stateName);
      expect(entry.headline).toBe(a.parsed.headline);
      // URL and source path derive from the file's PATH, not its content —
      // the same split the bundled registry used (map key from path, list
      // fields from content).
      expect(entry.url).toBe(`${LEARN_CONTENT_URL_PREFIX}/${a.verticalDir}/${a.file}`);
      expect(entry.sourcePath).toBe(`content/learn/${a.verticalDir}/${a.file}`);
    }
  });

  it("every county on disk is indexed with its content-derived metadata", () => {
    for (const c of disk.counties) {
      const county = c.file.replace(/\.json$/, "");
      const entry = index.counties.find((e) => e.pathKey === `${c.stateDir}::${county}`);
      expect(entry, `missing index entry for county ${c.stateDir}/${c.file}`).toBeDefined();
      expect(entry.stateSlug).toBe(c.parsed.stateSlug);
      expect(entry.stateName).toBe(c.parsed.stateName);
      expect(entry.countySlug).toBe(c.parsed.countySlug);
      expect(entry.countyName).toBe(c.parsed.countyName);
      expect(entry.url).toBe(`${LEARN_CONTENT_URL_PREFIX}/county/${c.stateDir}/${c.file}`);
      expect(entry.sourcePath).toBe(`content/learn/county/${c.stateDir}/${c.file}`);
    }
  });

  it("every indexed sourcePath exists on disk and parses", () => {
    for (const entry of [...index.articles, ...index.counties]) {
      const abs = path.join(ROOT, entry.sourcePath);
      expect(existsSync(abs), `indexed source missing: ${entry.sourcePath}`).toBe(true);
      expect(() => JSON.parse(readFileSync(abs, "utf8"))).not.toThrow();
    }
  });

  it("path keys and URLs are unique", () => {
    const all = [...index.articles, ...index.counties];
    expect(new Set(all.map((e) => e.pathKey)).size).toBe(all.length);
    expect(new Set(all.map((e) => e.url)).size).toBe(all.length);
  });

  it("is deterministic across runs", () => {
    expect(buildLearnContentIndex(CONTENT_DIR)).toEqual(index);
  });
});

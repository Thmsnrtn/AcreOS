/**
 * P1 false-claims sweep — the landing may not claim list pulling.
 *
 * The meta description said "Pull lists, run comps…", the static index.html
 * description said the same, and How-it-works step 2 said "Lists pulled …
 * overnight". Nothing pulls a list: there is no list builder (lists arrive by
 * CSV import — copy.ts's own truth-note withdrew the sibling claim).
 *
 * Coupled to the code: while no server route path names a list builder /
 * list pull, no file in the landing population may claim list pulling. The
 * population is ENUMERATED (index.html + landing.tsx + every file under
 * pages/landing/), comments stripped, with a floor so a renamed directory
 * cannot empty it.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Repeat to a fixpoint: one pass can join the halves of a nested or
// split marker ("<!-<!---->-") into a new comment opener.
function stripHtmlComments(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<!--[\s\S]*?-->/g, "");
  } while (s !== prev);
  return s;
}

function landingPopulation(): { file: string; text: string }[] {
  const files = [
    path.join(ROOT, "client/index.html"),
    path.join(ROOT, "client/src/pages/landing.tsx"),
    ...walk(path.join(ROOT, "client/src/pages/landing")).filter((f) => /\.(tsx?|html)$/.test(f)),
  ];
  return files.map((file) => {
    const raw = readFileSync(file, "utf8");
    return { file: path.relative(ROOT, file), text: file.endsWith(".html") ? stripHtmlComments(raw) : stripComments(raw) };
  });
}

/** The claim, in its observed shapes: "Pull lists", "pulls your county list", "Lists pulled", "list pull". */
const LIST_PULL_CLAIM = /\bpull(?:s|ed|ing)?\s+(?:[\w-]+\s+){0,2}lists?\b|\blists?\s+(?:are\s+|get\s+)?pulled\b|\blist[\s-]+pulls?\b/i;

/** Any server route whose path names a list builder or list pull. */
function listBuilderRoutes(): string[] {
  const hits: string[] = [];
  let routeCount = 0;
  for (const file of walk(path.join(ROOT, "server")).filter((f) => f.endsWith(".ts"))) {
    const raw = readFileSync(file, "utf8");
    const literal = /["'`](\/api\/[^"'`\s]*)["'`]/g;
    routeCount += [...raw.matchAll(literal)].length;
    // Cheap prefilter on raw text (a superset); strip comments only for candidates.
    if (!/list[-_]?(builder|pull)/i.test(raw)) continue;
    for (const m of stripComments(raw).matchAll(literal)) {
      if (/list[-_]?(builder|pull)/i.test(m[1])) hits.push(`${path.relative(ROOT, file)}: ${m[1]}`);
    }
  }
  // Vacuity: the scan reads route literals at all.
  expect(routeCount).toBeGreaterThan(200);
  return hits;
}

describe("landing copy claims no list pulling while no list builder exists", () => {
  it("the predicate catches the shapes it guards (canary)", () => {
    for (const s of ["Pull lists, run comps", "Lists pulled, replies drafted", "pulls your county list", "a county list pull arrives"]) {
      expect(s).toMatch(LIST_PULL_CLAIM);
    }
    expect("Bring your county list as a CSV").not.toMatch(LIST_PULL_CLAIM);
    expect("pulls comps, scores leads").not.toMatch(LIST_PULL_CLAIM);
  });

  it("no landing file claims list pulling", { timeout: 120_000 }, () => {
    const pop = landingPopulation();
    expect(pop.length).toBeGreaterThanOrEqual(15); // population floor
    expect(pop.map((p) => p.file)).toEqual(expect.arrayContaining(["client/index.html", "client/src/pages/landing.tsx", "client/src/pages/landing/copy.ts"]));
    if (listBuilderRoutes().length > 0) return; // a list builder exists; the claim may return
    const offenders = pop.filter((p) => LIST_PULL_CLAIM.test(p.text)).map((p) => `${p.file}: ${p.text.match(LIST_PULL_CLAIM)?.[0]}`);
    expect(offenders).toEqual([]);
  });
});

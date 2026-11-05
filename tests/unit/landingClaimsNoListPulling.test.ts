/**
 * P1 false-claims sweep — the landing may not claim list pulling.
 *
 * The meta description said "Pull lists, run comps…", the static index.html
 * description said the same, and How-it-works step 2 said "Lists pulled …
 * overnight". Nothing pulls a list: there is no list builder (lists arrive by
 * CSV import — copy.ts's own truth-note withdrew the sibling claim).
 *
 * Coupled to the code: while no server route path names a list builder /
 * list pull, no file in the public population may claim list pulling. The
 * population is ENUMERATED (index.html + llms.txt + the routed public pages in
 * PUBLIC_FILES + every file under pages/landing/, pages/compare/,
 * pages/learn/, pages/tools/ and components/tools/), comments stripped, with
 * a floor so a renamed directory cannot empty it. Legal/ops pages (security,
 * status, sub-processors, terms, privacy) are not marketing and not listed.
 *
 * 2026-11-03 (G12 public-copy truth fixes): the population was the landing
 * alone, and the claim was still live on four public pages outside it — both
 * /compare pages ("core list-pull + CRM loop"), every /learn/county page ("a
 * <county> list pull arrives"), the /tools/calculator CTA ("pulls the
 * lists"), and the shared /compare intro ("pull county data, mail the right
 * owners" — the same county-list sourcing in words the predicate did not
 * know). Third law: a rule installed on one directory is a claim about that
 * directory. The public marketing directories and routed public pages are
 * now enumerated, each required to exist and contribute.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { stripHtmlComments } from "../helpers/stripHtmlComments";

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
/** Every public marketing directory. Each must contribute files (vacuity). */
const PUBLIC_DIRS = [
  "client/src/pages/landing",
  "client/src/pages/compare",
  "client/src/pages/learn",
  "client/src/pages/tools",
  "client/src/components/tools",
] as const;

/** Routed public (unauthenticated) marketing pages outside those directories. */
const PUBLIC_FILES = [
  "client/index.html",
  "client/public/.well-known/llms.txt",
  "client/src/pages/landing.tsx",
  "client/src/pages/pricing.tsx",
  "client/src/pages/why.tsx",
  "client/src/pages/public-county-guide.tsx",
  "client/src/pages/public-parcel-report.tsx",
  "client/src/pages/glossary.tsx",
  "client/src/pages/transparency.tsx",
  "client/src/pages/changelog.tsx",
  "client/src/pages/founding-member.tsx",
  "client/src/pages/field-notes-archive.tsx",
  "client/src/pages/field-note-detail.tsx",
] as const;

function landingPopulation(): { file: string; text: string }[] {
  const files = [
    ...PUBLIC_FILES.map((f) => path.join(ROOT, f)),
    ...PUBLIC_DIRS.flatMap((d) => {
      const found = walk(path.join(ROOT, d)).filter((f) => /\.(tsx?|html)$/.test(f));
      expect(found.length, `${d} contributed no files — the population silently shrank`).toBeGreaterThan(0);
      return found;
    }),
  ];
  return files.map((file) => {
    const raw = readFileSync(file, "utf8");
    // .txt is prose with no comment syntax; read it whole.
    const text = file.endsWith(".html") ? stripHtmlComments(raw) : file.endsWith(".txt") ? raw : stripComments(raw);
    return { file: path.relative(ROOT, file), text };
  });
}

/**
 * The claim, in its observed shapes: "Pull lists", "pulls your county list",
 * "Lists pulled", "list pull", and "pull county data/records/owners" (the
 * /compare intro's phrasing of the same sourcing claim, 2026-11-03).
 */
const LIST_PULL_CLAIM =
  /\bpull(?:s|ed|ing)?\s+(?:[\w-]+\s+){0,2}lists?\b|\blists?\s+(?:are\s+|get\s+)?pulled\b|\blist[\s-]+pulls?\b|\bpull(?:s|ed|ing)?\s+(?:in\s+)?county\s+(?:data|records|owners?)\b/i;

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

describe("public copy claims no list pulling while no list builder exists", () => {
  it("the predicate catches the shapes it guards (canary)", () => {
    for (const s of [
      "Pull lists, run comps",
      "Lists pulled, replies drafted",
      "pulls your county list",
      "a county list pull arrives",
      // the four shapes found live outside the landing on 2026-11-03
      "the core list-pull + CRM loop",
      "so a {placeName} list pull arrives",
      "in one dashboard, pulls the lists, and runs the mail",
      "built for one loop: pull county data, mail the right owners",
    ]) {
      expect(s).toMatch(LIST_PULL_CLAIM);
    }
    expect("Bring your county list as a CSV").not.toMatch(LIST_PULL_CLAIM);
    expect("pulls comps, scores leads").not.toMatch(LIST_PULL_CLAIM);
    expect("import your county list, mail the right owners").not.toMatch(LIST_PULL_CLAIM);
  });

  it("no public marketing file claims list pulling", { timeout: 120_000 }, () => {
    const pop = landingPopulation();
    expect(pop.length).toBeGreaterThanOrEqual(40); // population floor
    expect(pop.map((p) => p.file)).toEqual(
      expect.arrayContaining([
        "client/index.html",
        "client/src/pages/landing.tsx",
        "client/src/pages/landing/copy.ts",
        "client/src/pages/pricing.tsx",
        "client/src/pages/compare/ComparisonPage.tsx",
        "client/src/pages/compare/acreos-vs-dealmachine.tsx",
        "client/src/pages/compare/acreos-vs-propstream.tsx",
        "client/src/pages/learn/county.tsx",
        "client/src/components/tools/LandDealCalculator.tsx",
      ]),
    );
    if (listBuilderRoutes().length > 0) return; // a list builder exists; the claim may return
    const offenders = pop.filter((p) => LIST_PULL_CLAIM.test(p.text)).map((p) => `${p.file}: ${p.text.match(LIST_PULL_CLAIM)?.[0]}`);
    expect(offenders).toEqual([]);
  });
});

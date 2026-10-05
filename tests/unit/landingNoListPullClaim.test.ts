/**
 * W10.3 audit fix 3 — the landing page may not promise list pulls.
 *
 * The public meta/OG description said "Pull lists, run comps, send mail…".
 * The only list puller in the product is the W10.3 county-records list
 * builder, and on the day this was written NO county could be saved from it:
 * every county endpoint is `review-required` until the founder reviews its
 * licence, and a review-required county is count/preview only. A public
 * promise of a capability no customer can use is the fabrication rule's
 * shape, on the surface buyers read first.
 *
 * Population: every string and template literal RENDERED from the landing
 * page (client/src/pages/landing.tsx and client/src/pages/landing/**) and the
 * ad copy's voice samples (server/services/cmo/brandProfiles.ts), read with
 * the TypeScript parser — so a comment recording this removal is never read
 * as the claim — plus the static index.html meta tags (the description every
 * crawler and link preview reads before the app loads), read as attributes. When saveable county lists ship, rescind this pin
 * deliberately rather than rewording around it.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const FILES = [
  "client/src/pages/landing.tsx",
  "server/services/cmo/brandProfiles.ts",
  ...walk(path.join(ROOT, "client/src/pages/landing")).map((f) => path.relative(ROOT, f)),
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(tsx?|jsx?)$/.test(e.name) ? [full] : [];
  });
}

function literals(rel: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function pageDescription(): string | null {
  const rel = "client/src/pages/landing.tsx";
  const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "PAGE_DESCRIPTION" && n.initializer) {
      if (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)) found = n.initializer.text;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

// "Pull lists", "pulls county lists", "pull a list", "pulling prospect lists"…
const LIST_PULL_CLAIM = /\bpull(?:s|ing|ed)?\s+(?:(?:a|your|county|prospect|seller|owner|targeted)\s+){0,2}lists?\b/i;

describe("landing copy promises no list pull", () => {
  it("the predicate catches the removed sentence and its near variants (falsification)", () => {
    for (const s of ["Pull lists, run comps", "AcreOS pulls county lists", "pull a list overnight", "Pulling prospect lists"]) {
      expect(LIST_PULL_CLAIM.test(s), s).toBe(true);
    }
    expect(LIST_PULL_CLAIM.test("Run comps, send mail")).toBe(false);
  });

  it("the meta/OG description says what the product does without 'Pull lists'", () => {
    const d = pageDescription();
    expect(d, "vacuity: PAGE_DESCRIPTION was not found as a string literal").toBeTruthy();
    expect(d!.length).toBeGreaterThan(80);
    expect(d!).not.toMatch(LIST_PULL_CLAIM);
  });

  it("no rendered landing literal makes the claim", () => {
    const offenders: string[] = [];
    let total = 0;
    for (const rel of FILES) {
      const lits = literals(rel);
      total += lits.length;
      for (const l of lits) if (LIST_PULL_CLAIM.test(l)) offenders.push(`${rel}: ${l.slice(0, 120)}`);
    }
    // Vacuity: the parser read the landing surface, not an empty set.
    expect(FILES.length).toBeGreaterThan(1);
    expect(total).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it("the static index.html meta tags make no list-pull claim", () => {
    const html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const contents = [...html.matchAll(/<meta\b[^>]*\bcontent="([^"]*)"/gi)].map((m) => m[1]);
    // Vacuity: the description is among the tags read.
    expect(contents.some((c) => c.length > 80 && /AcreOS/.test(c))).toBe(true);
    expect(contents.filter((c) => LIST_PULL_CLAIM.test(c))).toEqual([]);
  });
});

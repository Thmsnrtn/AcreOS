/**
 * A system named on the landing page must exist in this repository.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * FAQ.tsx told prospects "AcreOS imports and services notes from Beanstalk,
 * Note Servicing Center, or a CSV." A case-insensitive search for either
 * vendor across client/, server/ and shared/ returned exactly one hit: that
 * sentence. There is no importer, no column preset and no integration for
 * either — the notes import is a generic header map plus a user-supplied
 * field map, the same as every other import in the product. The same answer
 * promised "Migration support is included on a 30-min call", a human
 * commitment nothing in the product schedules or tracks.
 *
 * The list FAQ was named four more (PropStream, REISift, Pebble, DataTree) of
 * which two appear nowhere else either, and claimed the import "dedupes
 * against owners already mailed" when findDuplicateLeads matches name, email,
 * phone and address against leads you already have and never reads mail
 * history. And "Define the buy-box, and the first list pulls overnight"
 * described an engine that does not exist: there is no buy-box scan in
 * server/jobs or server/services, and countyAssessorIngestJob — the county
 * list worker — is exported and never called.
 *
 * Naming a competitor's system on a public page is read by a buyer as "they
 * have tested this with my data". Under this repository's standing
 * no-fabrication rule that is the same defect as an invented number.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * Two rules, one general and one specific.
 *
 * GENERAL: every product-shaped name that landing copy RENDERS must appear
 * somewhere else in the codebase. The candidate set is derived, not typed —
 * internal-capital names (PropStream, SendGrid, DataTree, DealMachine) pulled
 * out of the landing files' STRING LITERALS by the TypeScript parser, so
 * component names, identifiers and CSS classes are never candidates and the
 * rule needs no stop-list at all. AcreOS, ArrowRight and OpenGraph all pass on
 * their own merits because they genuinely appear elsewhere; nothing is
 * exempted.
 *
 * SPECIFIC: the four names this review found with zero backing may not
 * reappear anywhere in client/src. The general rule would catch PropStream's
 * shape; it cannot catch "Beanstalk", which is one capitalized word, or "Note
 * Servicing Center", which is three. Those are pinned by name.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const LANDING = "client/src/pages/landing";

function walk(rel: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(child, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.tsx") && !e.name.endsWith(".test.ts")) {
      out.push(child);
    }
  }
  return out;
}

const landingFiles = walk(LANDING);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Internal-capital names: PropStream, SendGrid, DataTree, DealMachine, REISift. */
const PRODUCT_SHAPED = /\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]+)+\b/g;

/**
 * Every product-shaped name appearing in a landing file's string literals,
 * mapped to the files that render it.
 *
 * Comments are never visited — the parser hands back nodes, not text — which
 * matters because the FAQ answers this test guards now carry comments naming
 * the removed vendors. A substring scan would read its own documentation as
 * the defect, exactly as the workflow gate did the same day.
 *
 * Import and export module specifiers are excluded: `from "./LandingNav"` is a
 * path, not a claim, and treating it as one would make every landing-local
 * component look like an unbacked vendor.
 */
function renderedNames(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const rel of landingFiles) {
    const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      const parent = node.parent as ts.Node | undefined;
      const isModuleSpecifier =
        parent !== undefined &&
        (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
        parent.moduleSpecifier === node;
      const carriesText =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node);
      if (carriesText && !isModuleSpecifier) {
        for (const m of (node as { text: string }).text.matchAll(PRODUCT_SHAPED)) {
          let where = found.get(m[0]);
          if (!where) found.set(m[0], (where = new Set()));
          where.add(rel);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

/** Files outside the landing directory that could back a claim. */
function backingCorpus(): string[] {
  const roots = ["server", "shared", "client/src"];
  const out: string[] = [];
  const rec = (rel: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (child.startsWith(LANDING)) continue;
      if (e.isDirectory()) rec(child);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(child);
    }
  };
  for (const r of roots) rec(r);
  return out;
}

describe("landing copy names only systems that exist here", () => {
  const names = renderedNames();
  const corpus = backingCorpus();

  it("reads a real population (vacuity guard)", () => {
    // Three separate things can silently read as "no unbacked names": no
    // landing files, no string literals parsed, no corpus to check against.
    expect(landingFiles.length).toBeGreaterThan(10);
    expect(names.size).toBeGreaterThan(3);
    expect(corpus.length).toBeGreaterThan(1000);
    // And the extractor really is reaching rendered copy, not just imports.
    expect([...names.keys()]).toContain("AcreOS");
  });

  it("every product-shaped name in rendered copy exists elsewhere in the codebase", () => {
    const cache = new Map<string, boolean>();
    const backed = (name: string) => {
      let hit = cache.get(name);
      if (hit === undefined) {
        hit = corpus.some((rel) => read(rel).includes(name));
        cache.set(name, hit);
      }
      return hit;
    };
    const unbacked = [...names.entries()]
      .filter(([name]) => !backed(name))
      .map(([name, where]) => `${name} (rendered by ${[...where].join(", ")})`);
    expect(
      unbacked,
      "these names are shown to a prospect and appear nowhere else in this repository. " +
        "A buyer reads a named system as 'they have tested this with my data'. Either " +
        "build the thing and name it, or describe the mechanism that does exist.",
    ).toEqual([]);
  });
});

describe("the four names with no backing at all stay gone", () => {
  const RETIRED = ["Beanstalk", "REISift", "Pebble", "Note Servicing Center"];
  const clientFiles = walk("client/src");

  it("scans a real population (vacuity guard)", () => {
    expect(clientFiles.length).toBeGreaterThan(500);
  });

  for (const name of RETIRED) {
    it(`"${name}" is not rendered anywhere in client/src`, () => {
      // Rendered, not mentioned: FAQ.tsx documents each removal by name in a
      // comment, which is the record of why the sentence changed. Parsing for
      // string literals is what keeps that record from failing its own rule.
      const offenders: string[] = [];
      for (const rel of clientFiles) {
        const src = read(rel);
        if (!src.includes(name)) continue;
        const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node) => {
          const carriesText =
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node) ||
            ts.isJsxText(node);
          if (carriesText && (node as { text: string }).text.includes(name)) offenders.push(rel);
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
      expect(
        [...new Set(offenders)],
        `"${name}" has no importer, preset or integration in this repository. ` +
          `Naming it again requires shipping the thing first.`,
      ).toEqual([]);
    });
  }

  it("the FAQ still records WHY each one went, so the next author does not re-add it", () => {
    // The comments are the durable half of this fix — without them the
    // sentences read as arbitrary and come back the next time someone writes
    // marketing copy.
    const faq = read(`${LANDING}/FAQ.tsx`);
    for (const name of RETIRED) {
      expect(faq, `FAQ.tsx must record why "${name}" was removed`).toContain(name);
    }
  });
});

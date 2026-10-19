/**
 * Money and comparable quantities render in tabular Inter, not the mono face.
 *
 * The Fieldstone type system (founder decision 2026-10-18): Fraunces for
 * headings, Inter for interface text AND financial figures with tabular
 * figures, the mono face only for identifiers and code. The repo's idiom for
 * a figure was `font-mono tabular-nums` (195 class strings across 48 files on
 * 2026-10-18, e.g. the Deals pipeline value); identifiers use `font-mono`
 * alone. `tabular-nums` is the discriminator, so a class string holding BOTH
 * is a figure set in the wrong face.
 *
 * Population: every string literal in client/src, template literals across
 * lines included. Mutation probes: put `font-mono` back on deals.tsx's
 * text-pipeline-value, or on auction-worksheet.tsx's multi-line
 * text-budget-remaining className.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const CLIENT = path.resolve(__dirname, "../../client/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(tsx?)$/.test(e.name)) out.push(f);
  }
  return out;
}

describe("figures use tabular Inter", () => {
  const files = walk(CLIENT);
  let tabularStrings = 0;
  const offenders: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const kind = f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, false, kind);
    // A parse, not a scan: every string and template literal, a multi-line
    // `className={`...`}` included (a one-line regex never saw those), and
    // never a comment. A template's static parts are joined so a class list
    // split by `${...}` is still read as one.
    const visit = (node: ts.Node) => {
      let cls: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) cls = node.text;
      else if (ts.isTemplateExpression(node)) {
        cls = [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)].join(" ");
      }
      if (cls !== null && /\btabular-nums\b/.test(cls)) {
        tabularStrings += 1;
        if (/\bfont-mono\b/.test(cls)) offenders.push(`${path.relative(CLIENT, f)}: "${cls.slice(0, 80)}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  it("reads a real population", () => {
    expect(files.length).toBeGreaterThan(600);
    // ~1,000+ tabular-nums class strings on 2026-10-18.
    expect(tabularStrings, "the class-string scan broke").toBeGreaterThan(500);
  });

  it("no class string sets a tabular figure in the mono face", () => {
    expect(offenders, "drop font-mono: figures are Inter with tabular-nums").toEqual([]);
  });
});

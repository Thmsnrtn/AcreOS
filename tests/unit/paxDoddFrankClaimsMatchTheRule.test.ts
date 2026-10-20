/**
 * What Pax is told about the Reg Z seller-financer exclusions must match the
 * rule the checker enforces (12 CFR 1026.36(a)(4) and (a)(5)).
 *
 * Best-in-class audit 2026-10-20 (P0, Dodd-Frank): the checker was corrected
 * on this branch, but Pax's model-facing persona strings still said "a balloon
 * under five years breaks the natural-person exemption" — backwards: the
 * 1-property exclusion for a natural person, estate or trust ((a)(5)) PERMITS
 * a balloon; the 3-property exclusion ((a)(4)) forbids ANY balloon — and cited
 * the 1-property exclusion as (a)(4).
 *
 * Reads STRING LITERALS through the TypeScript parser, so a comment recording
 * the old wording neither trips nor satisfies it. The population is every
 * server/ and shared/ file whose literals mention the exclusions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function literals(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push([n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" … "));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const MENTIONS = /1026\.36\(a\)|natural[- ]person (?:exemption|exclusion|safe harbou?r)|[13]-property (?:exemption|exclusion|safe harbou?r)/i;

const population = ["server", "shared"].flatMap((d) => walk(d)).flatMap((file) =>
  literals(file)
    .filter((t) => MENTIONS.test(t))
    .map((text) => ({ file, text })),
);

describe("Pax and every server string state the seller-financer exclusions correctly", () => {
  it("reads the strings that name the exclusions (vacuity floor)", () => {
    // personas.ts (originator + mobile-home park), paxPersona.ts, the checker.
    expect(new Set(population.map((p) => p.file)).size).toBeGreaterThanOrEqual(3);
    expect(population.some((p) => p.file.endsWith(join("pax", "personas.ts")))).toBe(true);
    expect(population.some((p) => p.file.endsWith("paxPersona.ts"))).toBe(true);
  });

  it("no string says a balloon breaks the natural-person / 1-property exclusion", () => {
    const bad = population.filter(({ text }) =>
      /balloon[^.;]{0,80}(?:break|breaking|disqualif|lose|void)[^.;]{0,40}(?:natural[- ]person|1-property|one-property)/i.test(text),
    );
    expect(bad).toEqual([]);
  });

  it("no string cites the 1-property exclusion as (a)(4)", () => {
    const bad = population.filter(({ text }) =>
      /(?:1-property|one-property|natural[- ]person)[^.;]{0,60}1026\.36\(a\)\(4\)(?![^.;]{0,80}\(a\)\(5\))/i.test(text),
    );
    expect(bad).toEqual([]);
  });
});

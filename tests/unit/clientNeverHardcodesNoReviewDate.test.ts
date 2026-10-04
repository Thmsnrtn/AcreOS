/**
 * No client surface answers "when will you know?" on the operator's behalf.
 *
 * A decision's `reviewDueAt` is what makes the Today door ask for its outcome,
 * and outcomes are what calibration learns from. The server already refuses to
 * INVENT a review date. Until 2026-10-04 the blind-offer wizard sent
 * `reviewDueAt: null` unconditionally. The route accepted a date, so a gate
 * reading only the server called land gradeable, while every land offer it
 * recorded was ungradeable forever. The defect lived in the CALLER, the half of
 * the loop no server-side gate reads.
 *
 * The population is every client source file, parsed (comments are never read).
 * The forbidden shape is a `reviewDueAt` property whose value is the literal
 * `null`, `undefined` or `void …`. Undefined drops the key from the JSON body,
 * and a route whose schema makes the key optional reads that as null. Computing null from the operator's own answer
 * (`reviewDueAtFromDays(reviewInDays)`) is the intended shape and is not
 * flagged.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

/** `null`, `undefined` and `void x` all mean "never ask" once serialised (undefined drops the key). */
function isNever(e: ts.Expression): boolean {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x.kind === ts.SyntaxKind.NullKeyword || ts.isVoidExpression(x) || (ts.isIdentifier(x) && x.text === "undefined");
}

function hardcodedNullReviewDates(file: string, src: string): number[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines: number[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isPropertyAssignment(n) &&
      ((ts.isIdentifier(n.name) && n.name.text === "reviewDueAt") || (ts.isStringLiteral(n.name) && n.name.text === "reviewDueAt")) &&
      isNever(n.initializer)
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return lines;
}

const ROOT = path.resolve(process.cwd(), "client/src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));

describe("no client request hard-codes a missing review date", () => {
  it("vacuity: the client is the population, and the decision surfaces are in it", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const f of ["client/src/pages/blind-offer-wizard.tsx", "client/src/pages/flip-analyzer.tsx"]) {
      expect(files).toContain(f);
    }
  });

  it("no file sends `reviewDueAt: null`", () => {
    const offenders = files.flatMap((f) => hardcodedNullReviewDates(f, readFileSync(f, "utf8")).map((l) => `${f}:${l}`));
    expect(
      offenders,
      "a client surface answers \"when will you know?\" on the operator's behalf. Ask them " +
        "(components/decisions/ReviewDateChoice) and send reviewDueAtFromDays(answer).",
    ).toEqual([]);
  });

  describe("canaries", () => {
    it("red: a literal null in a request body", () => {
      expect(hardcodedNullReviewDates("c.tsx", 'apiRequest("POST", "/x", { reviewDueAt: null });')).toHaveLength(1);
    });
    it("red: a quoted key", () => {
      expect(hardcodedNullReviewDates("c.ts", 'const body = { "reviewDueAt": null };')).toHaveLength(1);
    });
    it("red: undefined, void, and a cast — each drops the answer", () => {
      expect(hardcodedNullReviewDates("c.ts", "const b = { reviewDueAt: undefined };")).toHaveLength(1);
      expect(hardcodedNullReviewDates("c.ts", "const b = { reviewDueAt: void 0 };")).toHaveLength(1);
      expect(hardcodedNullReviewDates("c.ts", "const b = { reviewDueAt: (null as any) };")).toHaveLength(1);
    });
    it("green: the operator's answer, converted", () => {
      expect(hardcodedNullReviewDates("c.tsx", "const b = { reviewDueAt: reviewDueAtFromDays(reviewInDays) };")).toEqual([]);
    });
    it("green: a comment naming the old shape", () => {
      expect(hardcodedNullReviewDates("c.tsx", "// reviewDueAt: null was the defect\nconst x = 1;")).toEqual([]);
    });
  });
});

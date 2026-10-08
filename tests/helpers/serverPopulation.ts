/**
 * The population for server-wide source gates: EVERY non-test `.ts` file under
 * `server/`, parsed with the TypeScript compiler (never a regex scan — a parse
 * never visits a comment or mistakes a string for code; see CLAUDE.md, "a gate
 * reads its own documentation as the defect").
 *
 * Gates built on this report how many files they read so the test can assert a
 * floor: a walker that silently stops descending reads exactly like a clean
 * tree.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const REPO_ROOT = path.resolve(__dirname, "../..");

export function listServerSources(root = path.join(REPO_ROOT, "server")): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
}

export function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function rel(p: string): string {
  return path.relative(REPO_ROOT, p).split(path.sep).join("/");
}

/** Name of the nearest NAMED enclosing function/method ("<module>" at top level). */
export function enclosingFunctionName(node: ts.Node): string {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n)) &&
      n.name &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))
    ) {
      return n.name.text;
    }
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
      return n.parent.name.text;
    }
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isPropertyAssignment(n.parent) && ts.isIdentifier(n.parent.name)) {
      return n.parent.name.text;
    }
    n = n.parent;
  }
  return "<module>";
}

/** Strip TS-only wrappers: `x!`, `(x)`, `x as T`, `<T>x`, `x satisfies T`. */
export function unwrap(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) {
      e = e.expression;
      continue;
    }
    return e;
  }
}

/**
 * Name of the OUTERMOST named function/method declaration around a node — the
 * unit a reviewer recognises (`addCredits`, not the `run` closure inside it).
 * Falls back to the nearest named arrow/function-expression binding.
 */
export function ownerFunctionName(node: ts.Node): string {
  let owner: string | null = null;
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
      owner = n.name.text;
    }
    n = n.parent;
  }
  return owner ?? enclosingFunctionName(node);
}

/**
 * scripts/lib/function-body.mjs — where does a named function's body begin
 * and end? Asked of the TypeScript parser, not a brace counter.
 *
 * check-route-shadowing.mjs found a registrar's body with a hand-rolled `{`/`}`
 * counter. A regex literal holding braces — routes-doc-system.ts:
 * `previewContent.replace(/\{\{([^}]+)\}\}/g, '[$1]')` — has one more `}` than
 * `{`, so the walk "closed" registerDocSystemRoutes ~300 lines in and the gate
 * never read the 31 routes after it, among them a second
 * POST /api/documents/generate that a handler in routes-documents.ts had been
 * shadowing all along. The gate printed PASS. The parser already knows what a
 * regex, a template literal and a string are; ask it.
 *
 * Returns { start, end } — `start` at the body's `{`, `end` at its closing `}`
 * (exclusive slice end, matching the old walker's contract) — or null when no
 * function of that name with a block body exists. Callers must COUNT a null,
 * never skip it silently.
 */
import ts from "typescript";

const MEMO = new Map();

function parse(src) {
  let sf = MEMO.get(src);
  if (!sf) {
    sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (MEMO.size > 512) MEMO.clear();
    MEMO.set(src, sf);
  }
  return sf;
}

export function functionBodySpan(src, name) {
  const sf = parse(src);
  let span = null;
  const bodyOf = (fn) => (fn && fn.body && ts.isBlock(fn.body) ? fn.body : null);
  const visit = (node) => {
    if (span) return;
    let body = null;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = bodyOf(node);
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      body = bodyOf(node.initializer);
    }
    if (body) {
      span = { start: body.getStart(sf), end: body.getEnd() - 1 };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return span;
}

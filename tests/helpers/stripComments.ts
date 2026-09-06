/**
 * Remove comments from TypeScript source, correctly.
 *
 * ── WHY THIS IS NOT TWO REGEXES ─────────────────────────────────────────────
 * Source-scanning tests across this repository open with some variant of
 *
 *     src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
 *
 * and it is wrong in a way that reads as a passing test. Stripping BLOCK
 * comments first means a `/*` sequence inside a LINE comment opens one:
 *
 *     // retired in favor of session-based auth at /api/borrower/*. Per RFC
 *
 * That `/*` swallowed 3,000 lines of server/routes-borrower.ts — including the
 * route a test was asserting about — and the assertion then failed on an empty
 * string. It could just as easily have passed: an assertion of the form
 * `expect(src).not.toContain(badThing)` is satisfied by ANY region the stripper
 * ate, so a helper that silently deletes code turns a security test green.
 * Reversing the order does not help either: `/* a // b *\/` then loses its
 * terminator and swallows forward instead.
 *
 * A single left-to-right scan is the only version that is right. Strings and
 * template literals are skipped so a `//` inside a URL or a `/*` inside a
 * prompt is left alone, and comments are replaced with SPACES rather than
 * removed so every offset in the result still matches the original file —
 * which matters for any test that measures a distance between two anchors.
 * ── AND WHY IT IS NOT A HAND-ROLLED LEXER EITHER ──────────────────────────
 * The single left-to-right scan above was still wrong, in the direction that
 * reads as a passing test, and it was wrong for 232 OF THIS REPO'S 3,692
 * SOURCE FILES (measured 2026-09-06).
 *
 * A regex literal is not a string, and the scanner did not know regexes exist.
 * So this line —
 *
 *     return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
 *
 * — holds THREE double quotes. The scanner opened a string at the third and
 * ran forward to the next `"` ANYWHERE IN THE FILE, blanking every comment
 * marker it crossed (so comments survived, unstripped) and treating live code
 * as string (so it was never examined). `server/ai/supportAgent.ts` — the
 * 91-case dispatch switch this repo names as a load-bearing population — lost
 * 15,762 characters that way, to gates that reported clean.
 *
 * CLAUDE.md names this exact class: "a REGEX LITERAL holding a quote
 * (`s.replace(/[<>&'"]/g, …)`) did the same — and did it inside `maskComments`
 * itself." The replacement helper written to end that class had it too.
 *
 * Teaching the scan about regexes was tried and abandoned, because the traps
 * do not stop: `/` versus division needs the previous significant token;
 * TypeScript's postfix `!` (`cac.cacUsd! / n`) turns that rule backwards;
 * `[...]` character classes make `/[/*]/` both a valid regex and a block
 * comment; nested `${}` templates need a depth stack; and JSX — half this
 * repo — is full of `/` characters (`<br />`, `</div>`) that no expression
 * lexer will ever get right. A hand-rolled version refused 720 files.
 *
 * So it does not lex. It PARSES, with TypeScript's own parser, and asks the
 * resulting tree where the comments are. The parser has already resolved every
 * one of those ambiguities in order to build the tree at all, which is the
 * fourth law's advice applied to the tool the fourth law is about: prefer a
 * parse to a scan, and the whole class disappears rather than being defended
 * against case by case.
 *
 * Comments are replaced with SPACES rather than removed, so every offset in
 * the result still matches the original file.
 */

import ts from "typescript";

/**
 * Parsing is ~50x slower than the scan it replaces (5.7ms vs ~0.1ms per file,
 * measured over 2,543 files). That is the right trade — a fast wrong answer is
 * what this file exists to stop — but the callers are gates, and several sweep
 * the whole repository once per assertion. `orgScopedDbAdoption` stripped 2,600
 * files five times and hit vitest's 30s ceiling the moment the parse landed.
 *
 * The function is pure, so the answer is a memo rather than a cheaper parse.
 * Bounded, because a long-lived process holding every source file twice over
 * is its own problem; eviction is oldest-first, which suits a gate that walks a
 * directory in order.
 */
const MEMO = new Map<string, string>();
const MEMO_LIMIT = 4096;

export function stripComments(source: string): string {
  const memoized = MEMO.get(source);
  if (memoized !== undefined) return memoized;
  const result = stripCommentsUncached(source);
  if (MEMO.size >= MEMO_LIMIT) {
    const oldest = MEMO.keys().next();
    if (!oldest.done) MEMO.delete(oldest.value);
  }
  MEMO.set(source, result);
  return result;
}

function stripCommentsUncached(source: string): string {
  const out = source.split("");
  // The script kind decides JSX parsing, and this repo has both: parse a
  // component as .ts and every `<Foo />` is a syntax error; parse a plain .ts
  // as .tsx and `db.select<Row>()` or a bare `a < b` becomes a JSX element.
  // Either way the recovery walks the tokens somewhere else and trivia lands
  // in the wrong place. The caller passes a string, not a filename, so both
  // are tried and the one the parser had less trouble with wins — measured by
  // its own diagnostics rather than guessed from the content.
  const parse = (kind: ts.ScriptKind, name: string) =>
    ts.createSourceFile(name, source, ts.ScriptTarget.Latest, /* setParentNodes */ true, kind);
  const errorCount = (sf: ts.SourceFile) =>
    ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length;

  // Try the likelier kind first so the common file costs ONE parse, not two.
  // The heuristic only picks the order; correctness is still decided by the
  // diagnostics, so a wrong guess costs a parse and nothing else.
  const looksJsx = /<\/[A-Za-z]|\/>/.test(source);
  const first = looksJsx
    ? parse(ts.ScriptKind.TSX, "stripComments.tsx")
    : parse(ts.ScriptKind.TS, "stripComments.ts");
  let sf = first;
  if (errorCount(first) > 0) {
    const second = looksJsx
      ? parse(ts.ScriptKind.TS, "stripComments.ts")
      : parse(ts.ScriptKind.TSX, "stripComments.tsx");
    if (errorCount(second) < errorCount(first)) sf = second;
  }

  const blank = (start: number, end: number) => {
    for (let j = start; j < end && j < source.length; j += 1) {
      if (source[j] !== "\n") out[j] = " ";
    }
  };

  const seen = new Set<number>();
  const takeRanges = (ranges: ts.CommentRange[] | undefined) => {
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      blank(r.pos, r.end);
    }
  };

  const visit = (node: ts.Node): void => {
    // Comments are trivia, attached to the token that follows (leading) or
    // precedes (trailing) them. Walking every token covers both.
    if (node.getChildCount(sf) === 0) {
      takeRanges(ts.getLeadingCommentRanges(source, node.getFullStart()));
      takeRanges(ts.getTrailingCommentRanges(source, node.getEnd()));
    }
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);

  // Trivia before the very first token and after the last one is reachable
  // through the SourceFile's own full span; the EndOfFileToken carries the
  // trailing case, and position 0 the leading one.
  takeRanges(ts.getLeadingCommentRanges(source, 0));
  takeRanges(ts.getLeadingCommentRanges(source, sf.endOfFileToken.getFullStart()));

  return out.join("");
}

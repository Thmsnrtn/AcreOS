/**
 * scripts/lib/strip-comments.mjs — the one comment stripper.
 *
 * Extracted from lint-reachability.mjs on 2026-08-19 when a second gate needed
 * it. Shared rather than copied on purpose: the defect this exists to prevent
 * is a scanner reading prose as code, and two copies of the fix drift into one
 * scanner that still does.
 */

import ts from "typescript";

/**
 * ── A COMMENT CANNOT IMPORT ANYTHING ────────────────────────────────────────
 *
 * The import scanners below are regexes over raw source, and raw source has
 * comments in it. That is not a cosmetic imprecision — it hands out this gate's
 * two strongest EXEMPTIONS to prose:
 *
 *   - a specifier inside a comment marks the target module dynamically
 *     imported, and every export in it becomes "opaque: unassertable". One
 *     sentence exempts a whole module.
 *   - a `from "./x"` inside a comment records x as imported, so
 *     `isModuleOrphan(x)` returns false and a file NOTHING loads stops
 *     reading as a file nothing loads.
 *
 * Both were live. Three services — atlasContextInjector, userAiCostControls,
 * communicationDeduplication — each opened with a docblock showing callers how
 * to use them:
 *
 *       Usage:
 *         import { commDedup } from "./communicationDeduplication";
 *
 * …which this scanner read as the module importing ITSELF. Nothing anywhere
 * loaded any of the three. The gate that exists to find built-and-unwired code
 * was certifying it as wired, on the strength of the sentence explaining how
 * one day it might be. Found 2026-08-19 when a comment in
 * scripts/check-model-ids.mjs — one written to explain that a dynamic import
 * had been REMOVED — kept the removal from taking effect.
 *
 * Line structure is preserved (comment bodies become spaces, newlines stay) so
 * every reported line number still points where it did. `verifyStripper()`
 * below is the self-test, and the banner prints its score: a stripper that
 * quietly returned "" would empty every scan and turn this whole gate green.
 *
 * ── AND IT PARSES, AS OF 2026-09-06 ────────────────────────────────────────
 * The hand-written state machine this replaced knew about strings, templates
 * and comments, and not about REGEX LITERALS. A regex holding a quote —
 * `/[<>&'"]/g` — opened a string that ran to the next matching quote anywhere
 * in the file, blanking live code and leaving comments intact. Measured with
 * a sentinel canary: SIX of 2,543 source files ended the strip mid-token,
 * among them dispatchToolExecutor.ts and client/src/lib/queryClient.ts.
 *
 * Its sibling on the tests side (tests/helpers/stripComments.ts) had the same
 * class over 232 files. Teaching a hand-rolled lexer about regexes does not
 * converge — `/` versus division, TypeScript's postfix `!`, `[/*]` character
 * classes, nested `${}`, and JSX. TypeScript's parser has resolved all of it
 * already in order to build a tree, so this asks the tree where the comments
 * are. Prefer a parse to a scan.
 */
export function stripCommentsPreservingLines(src) {
  const cached = MEMO.get(src);
  if (cached !== undefined) return cached;
  const result = stripUncached(src);
  if (MEMO.size >= MEMO_LIMIT) {
    const oldest = MEMO.keys().next();
    if (!oldest.done) MEMO.delete(oldest.value);
  }
  MEMO.set(src, result);
  return result;
}

const MEMO = new Map();
const MEMO_LIMIT = 4096;

function stripUncached(src) {
  const out = src.split("");
  // Both kinds are tried and the one the parser had fewer diagnostics on wins:
  // force TSX on a plain .ts and `db.select<Row>()` becomes an unclosed JSX
  // element; force TS on a component and every `<Foo />` is a syntax error.
  const parse = (kind, name) =>
    ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, kind);
  const errs = (sf) => (sf.parseDiagnostics ?? []).length;
  const looksJsx = /<\/[A-Za-z]|\/>/.test(src);
  const first = looksJsx ? parse(ts.ScriptKind.TSX, "s.tsx") : parse(ts.ScriptKind.TS, "s.ts");
  let sf = first;
  if (errs(first) > 0) {
    const second = looksJsx ? parse(ts.ScriptKind.TS, "s.ts") : parse(ts.ScriptKind.TSX, "s.tsx");
    if (errs(second) < errs(first)) sf = second;
  }

  const seen = new Set();
  const take = (ranges) => {
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      for (let j = r.pos; j < r.end && j < src.length; j += 1) {
        if (src[j] !== "\n") out[j] = " ";
      }
    }
  };
  const visit = (node) => {
    if (node.getChildCount(sf) === 0) {
      take(ts.getLeadingCommentRanges(src, node.getFullStart()));
      take(ts.getTrailingCommentRanges(src, node.getEnd()));
    }
    node.getChildren(sf).forEach(visit);
  };
  visit(sf);
  take(ts.getLeadingCommentRanges(src, 0));
  take(ts.getLeadingCommentRanges(src, sf.endOfFileToken.getFullStart()));
  return out.join("");
}

/**
 * Cases the stripper must get right, checked on every run.
 *
 * The first two are the defect. The rest are the ways a naive strip breaks the
 * scan it feeds: `//` inside a string is protocol punctuation, not a comment,
 * and eating it would destroy the very specifiers this gate reads.
 */
export const STRIPPER_CASES = [
  ['import { a } from "./x";', 'import { a } from "./x";'],
  ['// import { a } from "./x";', ''],
  [' * import { a } from "./x";', ' * import { a } from "./x";'], // inside a block comment: caller strips the /** first
  ['/* await import("./x") */ const y = 1;', 'const y = 1;'],
  ['const u = "https://example.com/a";', 'const u = "https://example.com/a";'],
  ["const u = 'a//b';", "const u = 'a//b';"],
  ['const u = `a/*b*/c`;', 'const u = `a/*b*/c`;'],
  ['const u = "a\\"b//c";', 'const u = "a\\"b//c";'],
  ['const a = 1; // note\nconst b = 2;', 'const a = 1;\nconst b = 2;'],
  ['/**\n * import { z } from "./z";\n */\nconst c = 3;', 'const c = 3;'],
];

/** Runs STRIPPER_CASES; returns [passed, total]. Line count must never change. */
export function verifyStripper() {
  let ok = 0;
  for (const [input, expected] of STRIPPER_CASES) {
    const got = stripCommentsPreservingLines(input);
    const sameLines = got.split("\n").length === input.split("\n").length;
    const norm = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    if (sameLines && norm(got) === norm(expected)) ok++;
  }
  return [ok, STRIPPER_CASES.length];
}


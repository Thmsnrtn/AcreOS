/**
 * scripts/lib/strip-comments.mjs — the one comment stripper.
 *
 * Extracted from lint-reachability.mjs on 2026-08-19 when a second gate needed
 * it. Shared rather than copied on purpose: the defect this exists to prevent
 * is a scanner reading prose as code, and two copies of the fix drift into one
 * scanner that still does.
 */

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
 */
export function stripCommentsPreservingLines(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  // "code" | "line" | "block" | one of the three quote characters
  let state = "code";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { state = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; } else out += " ";
      i++; continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { state = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " ";
      i++; continue;
    }
    // Inside a string/template literal.
    if (c === "\\") { out += c + (d ?? ""); i += 2; continue; }
    if (c === state) { state = "code"; out += c; i++; continue; }
    // An unterminated ' or " cannot span a line; recover rather than swallow
    // the rest of the file. Templates legitimately span lines, so they do not
    // recover here.
    if (state !== "`" && c === "\n") { state = "code"; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
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


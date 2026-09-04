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
 */
export function stripComments(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) break;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j += 1) if (source[j] !== "\n") out[j] = " ";
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

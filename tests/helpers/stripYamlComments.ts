/**
 * Strip full-line `#` comments from a YAML document, preserving line count.
 *
 * YAML is not TypeScript, so `stripComments` — a TS parser — cannot read it.
 * Three gates had each written this same two-line function; one shared copy is
 * one place to fix if it ever needs to understand more than it does.
 *
 * Deliberately conservative: only lines whose FIRST non-space character is `#`
 * are removed. A `#` inside a quoted scalar (`name: "a # b"`) is left alone,
 * because guessing at YAML quoting from a line scan is how a stripper starts
 * eating the document it was meant to clean.
 */
export function stripYamlComments(src: string): string {
  return src
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

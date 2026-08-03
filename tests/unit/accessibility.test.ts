/**
 * Accessibility compliance tests (unit layer).
 *
 * This layer used to be theater: its icon-button assertion iterated a HARDCODED
 * list that still named `pages/founder-dashboard.tsx` — a file deleted long ago
 * (see CLAUDE.md "Known monoliths") — and swallowed every read failure in a
 * try/catch, so it asserted nothing about today's codebase.
 *
 * It now:
 *   - reads real shell files with NO try/catch, so a missing file FAILS the test
 *     rather than passing vacuously;
 *   - derives the icon-button check from a glob over client/src (not a hardcoded
 *     list), and requires every icon-only Button pattern to carry an accessible
 *     name (aria-label / aria-labelledby / title, including on an `asChild`
 *     child). Add one unlabeled icon button and this test goes red.
 *
 * The companion axe layer (tests/e2e/accessibility.spec.ts) needs a browser and
 * runs in CI; this file is the fast, browser-free guard.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";

const CLIENT_SRC = resolve(__dirname, "../../client/src");

/** Read a file under client/src. Throws (fails the test) if it is missing. */
function readClientFile(path: string): string {
  return readFileSync(resolve(CLIENT_SRC, path), "utf-8");
}

/**
 * Recursively collect files with the given extension under `dir`.
 * The ROOT directory read is intentionally un-guarded: if client/src is gone,
 * this throws and the test fails instead of silently finding nothing.
 */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  const walk = (d: string, isRoot: boolean) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (isRoot) throw err; // root must be readable
      return; // tolerate an unreadable nested dir
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full, false);
      } else if (entry.name.endsWith(ext)) {
        results.push(full);
      }
    }
  };
  walk(dir, true);
  return results;
}

/**
 * Given the index of the opening `<` of a JSX tag, return the index of the `>`
 * that closes the OPENING tag. Tracks JSX-expression brace depth and skips
 * string literals, so `=>` inside an `onClick` handler is not mistaken for the
 * tag's end.
 */
function endOfOpenTag(s: string, start: number): number {
  let i = start + 1;
  let depth = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n && s[i] !== q) {
        if (s[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
    i++;
  }
  return -1;
}

const ACCESSIBLE_NAME_ATTRS = ["aria-label", "aria-labelledby", "title="];

/**
 * Locate every icon-only Button (`size="icon"`) in `content` that lacks an
 * accessible name, returning 1-based line numbers. An accessible name may live
 * in the Button's own opening tag OR — for the `asChild` pattern — on the single
 * child element (e.g. a wrapping `<Link aria-label=…>`), or be provided by
 * `sr-only` child text.
 */
function iconButtonsMissingName(content: string): number[] {
  const missing: number[] = [];
  const re = /size="icon"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const tagStart = content.lastIndexOf("<", m.index);
    if (tagStart === -1) continue;
    const tagEnd = endOfOpenTag(content, tagStart);
    const openTag = tagEnd === -1 ? "" : content.slice(tagStart, tagEnd + 1);
    if (ACCESSIBLE_NAME_ATTRS.some((a) => openTag.includes(a))) continue;
    // Fall back to the element subtree (covers `asChild` + labeled child).
    const childClose = content.indexOf("</", tagEnd === -1 ? m.index : tagEnd);
    const subtree =
      childClose === -1 ? openTag : content.slice(tagStart, childClose);
    if (
      ACCESSIBLE_NAME_ATTRS.some((a) => subtree.includes(a)) ||
      subtree.includes("sr-only")
    ) {
      continue;
    }
    missing.push(content.slice(0, m.index).split("\n").length);
  }
  return missing;
}

describe("Accessibility Compliance", () => {
  it("client/src exists and contains .tsx sources", () => {
    expect(statSync(CLIENT_SRC).isDirectory()).toBe(true);
    const tsx = findFiles(CLIENT_SRC, ".tsx");
    // A vacuously-empty glob must not let the icon-button check pass silently.
    expect(tsx.length).toBeGreaterThan(50);
  });

  it("App.tsx has a skip-to-content link", () => {
    const app = readClientFile("App.tsx");
    expect(app).toContain("#main-content");
    expect(app).toMatch(/Skip to content/i);
  });

  it("main content landmark has id='main-content'", () => {
    const app = readClientFile("App.tsx");
    const inApp = app.includes('id="main-content"');
    const inComponents = findFiles(
      resolve(CLIENT_SRC, "components"),
      ".tsx",
    ).some((f) => readFileSync(f, "utf-8").includes('id="main-content"'));
    expect(inApp || inComponents).toBe(true);
  });

  it("MotionConfig reducedMotion is configured", () => {
    const app = readClientFile("App.tsx");
    expect(app).toContain("MotionConfig");
    expect(app).toMatch(/reducedMotion/);
  });

  it("viewport meta does not block zoom", () => {
    const html = readFileSync(resolve(CLIENT_SRC, "../index.html"), "utf-8");
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale=1");
  });

  it("every icon-only Button across client/src has an accessible name", () => {
    const files = findFiles(CLIENT_SRC, ".tsx");
    let iconButtonCount = 0;
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      iconButtonCount += (content.match(/size="icon"/g) || []).length;
      for (const line of iconButtonsMissingName(content)) {
        offenders.push(`${relative(CLIENT_SRC, file)}:${line}`);
      }
    }
    // Guard against the check silently passing because it scanned nothing.
    expect(iconButtonCount).toBeGreaterThan(50);
    expect(
      offenders,
      `Icon-only buttons missing an accessible name (add aria-label / aria-labelledby / title, ` +
        `or put the label on the asChild child):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

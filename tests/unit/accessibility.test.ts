/**
 * Accessibility compliance tests
 * Validates that key accessibility patterns are in place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";

const CLIENT_SRC = resolve(__dirname, "../../client/src");

function readFile(path: string): string {
  return readFileSync(resolve(CLIENT_SRC, path), "utf-8");
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(ext)) results.push(full);
      }
    } catch { /* skip unreadable dirs */ }
  }
  walk(dir);
  return results;
}

describe("Accessibility Compliance", () => {
  it("App.tsx has a skip-to-content link", () => {
    const app = readFile("App.tsx");
    expect(app).toContain("#main-content");
    expect(app).toContain("Skip");
  });

  it("main content landmark has id='main-content'", () => {
    // Check App.tsx and components for the main landmark
    const app = readFile("App.tsx");
    const inApp = app.includes('id="main-content"');
    const files = findFiles(resolve(CLIENT_SRC, "components"), ".tsx");
    const inComponents = files.some((f) => {
      const content = readFileSync(f, "utf-8");
      return content.includes('id="main-content"');
    });
    expect(inApp || inComponents).toBe(true);
  });

  it("MotionConfig reducedMotion is configured", () => {
    const app = readFile("App.tsx");
    expect(app).toContain("MotionConfig");
    expect(app).toMatch(/reducedMotion/);
  });

  it("viewport meta does not block zoom", () => {
    const html = readFileSync(
      resolve(CLIENT_SRC, "../index.html"),
      "utf-8"
    );
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale=1");
  });

  /**
   * EVERY icon-only button has an accessible name — all of them, not a sample.
   *
   * `CLAUDE.md` states this absolutely: *"Every icon-only button must have
   * `aria-label`"*. What enforced it was a **sample check over three hardcoded
   * files**, and it was weak in three separate ways:
   *
   *   1. One of the three — `pages/founder-dashboard.tsx` — **no longer
   *      exists**. CLAUDE.md records that monolith as fully deleted. Its
   *      `try { … } catch {}` swallowed the missing file, so a third of the
   *      sample had been checking nothing for as long as the file has been gone.
   *   2. The assertion compared **counts**: `ariaLabels.length >=
   *      iconButtons.length`. Five icon buttons and five `aria-label`s on five
   *      OTHER elements passed it.
   *   3. Three files out of 728.
   *
   * The real number, measured before writing this: **207 icon buttons across
   * 728 files, and every one of them is labelled.** The rule has been followed
   * throughout — it simply was not enforced, so nothing would have noticed the
   * first one that was not.
   *
   * `asChild` is handled rather than exempted. A `<Button asChild size="icon">`
   * renders AS its child, so the accessible name belongs on the child — both
   * live instances (`activity-content.tsx`, `TasksDueWidget.tsx`) put it on the
   * `<Link>` inside, which is correct. A checker that flagged those would be
   * reporting the right pattern as a violation, and one that skipped `asChild`
   * entirely would stop looking exactly where the label actually lives.
   */
  it("every icon-only button has an accessible name", () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of findFiles(CLIENT_SRC, ".tsx")) {
      if (/\.test\.tsx$/.test(file)) continue;
      const src = readFileSync(file, "utf-8");
      let i = 0;
      while ((i = src.indexOf('size="icon"', i)) !== -1) {
        const open = src.lastIndexOf("<", i);
        // Scan to the element's own closing `>` — skipping any inside a string
        // or an expression, so `onClick={() => f()}` does not end it early.
        let end = i;
        let depth = 0;
        let quote: string | null = null;
        for (; end < src.length; end++) {
          const c = src[end];
          if (quote) { if (c === quote) quote = null; continue; }
          if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
          if (c === "{") depth += 1;
          else if (c === "}") depth -= 1;
          else if (c === ">" && depth === 0) break;
        }
        const opener = src.slice(open, end + 1);
        checked += 1;

        const named = /aria-label[=\s]|aria-labelledby/.test(opener);
        // asChild: the button renders as its child, so the name lives there.
        // Look at the next element opener after this one.
        let namedByChild = false;
        if (!named && /\basChild\b/.test(opener)) {
          const childOpen = src.indexOf("<", end + 1);
          if (childOpen !== -1) {
            const childEnd = src.indexOf(">", childOpen);
            if (childEnd !== -1) {
              namedByChild = /aria-label[=\s]|aria-labelledby/.test(
                src.slice(childOpen, childEnd + 1),
              );
            }
          }
        }

        if (!named && !namedByChild) {
          const line = src.slice(0, open).split("\n").length;
          offenders.push(`${file.slice(CLIENT_SRC.length + 1)}:${line}`);
        }
        i = end;
      }
    }

    // Vacuity guard. A walk that found nothing would satisfy the assertion
    // below while checking nothing — which is precisely how the sample check
    // this replaced ended up a third dead.
    expect(checked, "no icon buttons found — did the Button API change?")
      .toBeGreaterThan(150);

    expect(
      offenders.join("\n"),
      "an icon-only button has no accessible name. A screen reader announces it " +
        "as \"button\" and nothing else. Add aria-label, or — if it uses asChild " +
        "— put the label on the child that actually renders.",
    ).toBe("");
  });

  it("the sample check's dead file reference is gone", () => {
    // The specific rot: the old check named pages/founder-dashboard.tsx, which
    // CLAUDE.md records as fully deleted, and swallowed the ENOENT. A test that
    // catches its own missing input reports success for work it did not do.
    expect(
      existsSync(resolve(CLIENT_SRC, "pages/founder-dashboard.tsx")),
      "founder-dashboard.tsx is back — CLAUDE.md says it was retired",
    ).toBe(false);
    // A second assertion — "this file no longer NAMES that path" — was written
    // here and deleted: the regex testing for the string contained the string,
    // so it matched its own source and could never pass. Same family as
    // lint-reachability's SELF exemption, where a file documenting dead symbols
    // resurrects them. A check whose subject includes the check is not a check.
    //
    // What replaces it is stronger anyway: the walk above covers all 728 files,
    // so there is no hardcoded list left to rot. Its vacuity guard is what
    // notices if the walk stops finding anything.
  });
});

/**
 * Every appearance control gives feedback on TAP, not only on hover.
 *
 * ── WHAT THIS CAUGHT ──────────────────────────────────────────────────────
 * The desktop-feel audit's C7 contract ("hover-not-broken-on-touch") ran for
 * the first time on 2026-09-05 — 366 prior CI runs had never opened a browser —
 * and found 11 interactive controls on /settings styled with a Tailwind
 * `hover:` class and no `active:` or `focus:` companion: five theme cards, both
 * mode buttons, four typography pairings. All of them ours; none of them Clerk's.
 *
 * On a touchscreen laptop a tap on a theme card produced no acknowledgement at
 * all until the whole theme re-rendered. Keyboard users were already fine (the
 * C2 focus-ring contract passes on computed style, from a global
 * :focus-visible rule) — the missing state was specifically the press.
 *
 * ── WHY A UNIT TEST FOR A CONTRACT THE E2E ALREADY STATES ─────────────────
 * Because that E2E does not run. `desktop-feel-audit.yml` is gated on a
 * `TARGET_URL` secret that is not set, so C7 protects this fix only when
 * someone runs the audit by hand. A regression here would ship green.
 *
 * Scoped deliberately to the appearance panel rather than swept across the
 * client: this is the surface whose entire job is visual feedback, and a
 * repo-wide version of this rule needs a baseline and a triage pass, which is
 * a different piece of work from keeping this fix fixed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(process.cwd(), "client/src/components/settings/appearance-panel.tsx"),
  "utf8",
);

/**
 * The class strings that style an UNSELECTED control. Extracted as the
 * quoted string literals containing a `hover:` token — the same shape C7
 * counts in the DOM, read here at its source.
 */
const hoverClassStrings = [...SRC.matchAll(/"([^"\n]*\bhover:[^"\n]*)"/g)].map((m) => m[1]);

describe("appearance panel — press state", () => {
  it("finds the hover-styled control classes (vacuity guard)", () => {
    // Three sites on 2026-09-05: theme cards, mode buttons, typography
    // pairings. If this drops to zero the assertions below prove nothing —
    // which is exactly how C7 passed at 1280-light while failing at
    // 1280-dark, having measured a page that had not hydrated yet.
    expect(
      hoverClassStrings.length,
      "no hover-styled class strings found in the appearance panel — the " +
        "extractor stopped matching, and every assertion below is now vacuous",
    ).toBeGreaterThanOrEqual(3);
  });

  for (const [i, classes] of hoverClassStrings.entries()) {
    it(`hover-styled control #${i + 1} also has a press state: "${classes.slice(0, 48)}…"`, () => {
      expect(
        /\bactive:/.test(classes) || /\bfocus:/.test(classes),
        `"${classes}" styles a hover state with no active: or focus: companion. ` +
          "On a touchscreen there is no hover, so tapping this control gives no " +
          "feedback until the surrounding state changes. Add an active: variant " +
          "matching the hover one.",
      ).toBe(true);
    });
  }
});

/**
 * A centred panel taller than the viewport loses its TOP, and cannot be scrolled to.
 *
 * `top-[50%] translate-y-[-50%]` centres a panel on the viewport, so content
 * taller than the screen overflows in BOTH directions. The half above the fold
 * is the half with the title and, in this repo's dialog, the close control at
 * `top-4`. Neither DialogContent nor AlertDialogContent had a max-height or an
 * overflow container, so there was no way to reach it — on AlertDialog, that is
 * the text saying what is about to be destroyed.
 *
 * ── WHY THE UNIT IS THE POINT ─────────────────────────────────────────────
 * The bound must be a DYNAMIC viewport unit. On iOS Safari — the surface the
 * founder's E-2 observation is about — `100vh` is the height WITHOUT browser
 * chrome, so a `vh`-based max-height is itself taller than the visible area and
 * the panel still overflows. `dvh` tracks the visible viewport as the URL bar
 * shows and hides. A gate that accepted `max-h-[calc(100vh-2rem)]` would pass
 * over the exact defect it exists for, which is why it checks the unit and not
 * merely the presence of a max-height.
 *
 * (The first version of this test spelled that check `\bdvh\b`, which never
 * matches inside `100dvh` — `0` and `d` are both word characters, so there is no
 * boundary between them. It failed on correctly-fixed files, which is the benign
 * direction; the same slip in a rule that must FIND something would have passed
 * over everything instead.)
 *
 * ── POPULATION ────────────────────────────────────────────────────────────
 * DERIVED: every ui component that centres with `translate-y-[-50%]`. A third
 * centred overlay added later joins by existing rather than by someone
 * remembering this file. Sheets and drawers are correctly absent — they anchor
 * to an edge and size themselves, so they have no top to lose.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const UI_DIR = path.join(process.cwd(), "client", "src", "components", "ui");

const uiFiles = readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx"));

/** Components that centre a panel on the viewport, and therefore can lose their top. */
const centred = uiFiles.filter((f) =>
  readFileSync(path.join(UI_DIR, f), "utf8").includes("translate-y-[-50%]"),
);

describe("every centred overlay is bounded and scrollable", () => {
  it("the population is real and derived", () => {
    expect(uiFiles.length, "the ui/ walk found almost nothing").toBeGreaterThan(20);
    expect(
      centred.length,
      "no centred overlay found — the detector has stopped matching and the " +
        "assertion below is vacuous",
    ).toBeGreaterThan(0);
    // The two known members, pinned so a rename cannot silently shrink the set.
    expect(centred).toContain("dialog.tsx");
    expect(centred).toContain("alert-dialog.tsx");
  });

  for (const file of centred) {
    it(`${file} bounds its height against the DYNAMIC viewport and scrolls`, () => {
      const src = readFileSync(path.join(UI_DIR, file), "utf8");

      expect(
        /max-h-\[[^\]]*\d+dvh[^\]]*\]/.test(src),
        `${file} centres a panel with translate-y-[-50%] but does not bound its ` +
          "height against the dynamic viewport. Content taller than the screen " +
          "overflows off the TOP, taking the title and the close control with it. " +
          "Use max-h-[calc(100dvh-…)] — `vh` does not work here, because on iOS " +
          "Safari 100vh is taller than the visible area.",
      ).toBe(true);

      expect(
        /overflow-y-auto|overflow-auto/.test(src),
        `${file} bounds its height but gives no way to scroll, so the content ` +
          "past the bound is simply unreachable.",
      ).toBe(true);
    });
  }

  it("a vh-based bound does not satisfy the rule", () => {
    // The mutation this gate exists to reject, asserted directly rather than
    // trusted: `vh` is the plausible-looking fix that leaves the defect in place.
    const vhOnly = 'className="fixed top-[50%] translate-y-[-50%] max-h-[calc(100vh-2rem)] overflow-y-auto"';
    expect(/max-h-\[[^\]]*\d+dvh[^\]]*\]/.test(vhOnly)).toBe(false);
    const dvh = 'className="fixed top-[50%] translate-y-[-50%] max-h-[calc(100dvh-2rem)] overflow-y-auto"';
    expect(/max-h-\[[^\]]*\d+dvh[^\]]*\]/.test(dvh)).toBe(true);
  });
});

/**
 * T0-7 recurrence guard — framer-motion variant-name drift.
 *
 * Incident (2026-06-10): `staggerContainer` / `staggerItem` in
 * client/src/lib/animations.ts define variants named `hidden` / `visible`,
 * but ~10 surfaces (ParcelAlerts, FinanceBook, pax, transparency,
 * data-sources, security-activity-log, several founder pages) animated to a
 * nonexistent `"show"` variant. framer-motion silently does nothing when the
 * target variant doesn't exist, so every one of those sections mounted with
 * `initial="hidden"` (opacity: 0) and stayed permanently invisible — a live,
 * customer-visible blank-section bug on the five doors.
 *
 * The canonical variant name is `"visible"`. There is intentionally NO
 * `show` alias in animations.ts — one name, one spelling. This test greps
 * the entire client/src tree and fails if anyone reintroduces
 * `animate="show"` (or initial/whileInView targeting "show").
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import * as fs from "fs";
import * as path from "path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const CLIENT_SRC = path.resolve(__dirname, "../../client/src");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Variant-name props that must never target the nonexistent "show". */
const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /animate="show"/, label: 'animate="show"' },
  { pattern: /initial="show"/, label: 'initial="show"' },
  { pattern: /whileInView="show"/, label: 'whileInView="show"' },
];

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.endsWith(".bak")) {
      out.push(full);
    }
  }
  return out;
}

describe("framer-motion variant names (T0-7 guard)", () => {
  const files = collectSourceFiles(CLIENT_SRC);

  it("finds a plausible number of client source files", () => {
    // Sanity check so a broken path doesn't make the guard pass vacuously.
    expect(files.length).toBeGreaterThan(100);
  });

  it('no component animates to the nonexistent "show" variant', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      // Cheap pre-filter before line-splitting.
      if (!content.includes('"show"')) continue;
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        for (const { pattern, label } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            violations.push(
              `${path.relative(CLIENT_SRC, file)}:${idx + 1} uses ${label} — ` +
                'the shared stagger variants are named "hidden"/"visible"; targeting "show" leaves the section stuck invisible.'
            );
          }
        }
      });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

/**
 * The deploy-time migrator never contradicts the colorway migration rules.
 *
 * scripts/migrate.mjs runs as Fly's release_command on EVERY deploy and is not
 * a tracked migrator — every statement re-runs each release. Until the
 * Fieldstone redesign it carried `appearance_preferences - 'theme' WHERE theme
 * = 'homestead'`: deployed alongside the new contract (Homestead -> Bedrock),
 * it would have deleted those people's choice before the new code could read
 * it, landing them on the Fieldstone default. Found by independent review,
 * 2026-10-18.
 *
 * Rules, over every SQL statement in the file that touches the stored theme:
 *   - none removes the `theme` key;
 *   - any rewrite of theme A to B agrees with LEGACY_COLORWAY_MIGRATION[A].
 *
 * Mutation probe: restore the homestead DELETE statement.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LEGACY_COLORWAY_MIGRATION, COLORWAY_IDS } from "../../shared/appearance";

const SRC = fs.readFileSync(path.resolve(__dirname, "../../scripts/migrate.mjs"), "utf8");
// Statements are template literals; comments are `//` lines outside them.
const statements = [...SRC.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const themeStatements = statements.filter((s) => /appearance_preferences/.test(s) && /theme/.test(s));

describe("release migrator vs the colorway contract", () => {
  it("reads the file's statements (population)", () => {
    expect(statements.length, "statement extraction broke").toBeGreaterThan(500);
    // The dirtpass -> bedrock rename is still there and must keep matching.
    expect(themeStatements.length, "no theme statement found — the scan broke").toBeGreaterThanOrEqual(1);
  });

  it("never removes the stored theme", () => {
    const removers = themeStatements.filter((s) => /appearance_preferences\s*-\s*'theme'/.test(s));
    expect(removers, "a release statement deletes people's colorway").toEqual([]);
  });

  it("every theme rewrite agrees with LEGACY_COLORWAY_MIGRATION", () => {
    for (const s of themeStatements) {
      const to = /'\{theme\}'\s*,\s*'"([a-z]+)"'/.exec(s)?.[1];
      const from = /->>'theme'\s*=\s*'([a-z]+)'/.exec(s)?.[1];
      if (!to) continue;
      expect(from, `rewrite without a source value: ${s.slice(0, 120)}`).toBeTruthy();
      expect((COLORWAY_IDS as readonly string[]).includes(to), `rewrite to non-colorway ${to}`).toBe(true);
      expect(LEGACY_COLORWAY_MIGRATION[from!], `${from} -> ${to} disagrees with the contract`).toBe(to);
    }
  });
});

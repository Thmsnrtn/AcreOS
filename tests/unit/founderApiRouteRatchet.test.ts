/**
 * Founder API route-sprawl ratchet (Phase 4, Chief-Architect critique).
 *
 * The CLIENT founder surface is already ratcheted to the four canonical doors
 * (see founderFourDoors.test.ts + FOUNDER_ROUTE_BASELINE). The four-door
 * discipline exists precisely because the historical /founder/* set grew to
 * ~88 routes with ≥10 overlapping overviews. The SERVER never got the same
 * lock: it still carries ~38 top-level `server/routes-founder-*.ts` modules.
 *
 * This ratchet mirrors the four-door discipline at the API layer. It counts the
 * top-level founder route modules on disk and asserts the count only ever
 * SHRINKS. Adding a new `server/routes-founder-*.ts` file trips the test; the
 * fix is to fold the new surface into an existing founder router (one of the
 * four doors as a child/section/tab), not to mint another top-level module.
 * When you genuinely CONSOLIDATE and the count drops, lower
 * FOUNDER_API_ROUTE_BASELINE in the same commit so the ratchet stays tight.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SERVER_DIR = path.resolve(__dirname, "../../server");

/** Current count — the ratchet baseline. Consolidation may only LOWER this.
 *  Measured 2026-08-03 with `ls server/routes-founder-*.ts | wc -l` → 38. */
const FOUNDER_API_ROUTE_BASELINE = 38;

function founderApiRouteFiles(): string[] {
  return fs
    .readdirSync(SERVER_DIR)
    .filter((f) => /^routes-founder-.*\.ts$/.test(f))
    .sort();
}

describe("founder API route-sprawl ratchet", () => {
  it("top-level server/routes-founder-*.ts modules never exceed the baseline (may only shrink)", () => {
    const files = founderApiRouteFiles();
    const count = files.length;
    expect(
      count,
      `top-level founder route modules (${count}) exceed the baseline ` +
        `(${FOUNDER_API_ROUTE_BASELINE}). The founder API must mirror the client's ` +
        `four-door discipline: a new founder surface belongs inside an EXISTING ` +
        `server/routes-founder-*.ts router (behind one of the four doors as a ` +
        `child/section/tab), not as a new top-level module. If you are ` +
        `CONSOLIDATING, lower FOUNDER_API_ROUTE_BASELINE to the new count in the ` +
        `same commit.\nCurrent files:\n${files.join("\n")}`,
    ).toBeLessThanOrEqual(FOUNDER_API_ROUTE_BASELINE);
  });

  it("the baseline is a positive integer (guards against a silently-empty glob)", () => {
    // If the pattern ever stopped matching (rename/move), count would drop to 0
    // and the <= assertion would pass vacuously. Pin a non-trivial floor so a
    // broken matcher fails loudly instead of green-washing the ratchet.
    expect(founderApiRouteFiles().length).toBeGreaterThan(0);
  });
});

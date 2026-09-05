/**
 * The E2E schema push must be VERIFIED, not trusted.
 *
 * ── THE MEASUREMENT ───────────────────────────────────────────────────────
 * `tests/e2e-mobile/global-setup.ts` is the setup for THREE suites — mobile
 * feel, desktop feel, and customer journey. It pushes the whole schema into a
 * throwaway database and then seeds a user.
 *
 * It used to do that with `execSync("npx drizzle-kit push --force")` under the
 * comment "--force skips prompts". Measured 2026-09-05, against a database
 * whose `event_mesh_events` table held 53 rows:
 *
 *   · You're about to add event_mesh_events_event_id_unique unique constraint
 *     to the table, which contains 53 items. … Do you want to truncate?
 *   Error: Interactive prompts require a TTY terminal …
 *   DRIZZLE_EXIT=0
 *
 * `--force` does not suppress the DATA-LOSS confirmation, and drizzle-kit
 * prints that fatal error, applies NOTHING, and exits 0. execSync saw success.
 * The seed ran. 54 customer-journey specs then executed against a schema that
 * had never been pushed — measuring whatever tables happened to be there.
 *
 * It is latent in CI only because the Postgres service container starts empty
 * every run. It fires the moment the target database is reused or long-lived,
 * and when it does it takes all three suites with it.
 *
 * ── WHAT THIS PINS ────────────────────────────────────────────────────────
 * Two independent things, because either alone can be defeated:
 *   1. the OUTPUT is read (an exit code from a tool that exits 0 on failure is
 *      not evidence), and
 *   2. the PROPERTY is verified afterwards — the tables actually exist — which
 *      catches every other way a push can silently no-op, not just this prompt.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const SETUP_REL = "tests/e2e-mobile/global-setup.ts";
const src = readFileSync(path.resolve(process.cwd(), SETUP_REL), "utf8");
// Comments FIRST: this file's own explanation quotes the drizzle error text and
// the phrase "--force skips prompts" it replaced, so a raw scan would find both
// the defect and its documentation and could not tell them apart.
const code = stripComments(src);

describe("the E2E schema push is verified, not trusted", () => {
  it("does not run the push through a bare execSync", () => {
    expect(
      /execSync\(\s*["'`]npx drizzle-kit push/.test(code),
      "the push is back on execSync, which only sees the exit code — and " +
        "drizzle-kit exits 0 after refusing an interactive data-loss prompt.",
    ).toBe(false);
  });

  it("reads the push OUTPUT and refuses the interactive-prompt failure", () => {
    expect(
      code,
      "the push output is not captured, so the TTY failure is invisible again",
    ).toMatch(/spawnSync\(/);
    expect(
      code,
      "nothing checks for the interactive data-loss prompt. That is the exact " +
        "string drizzle-kit prints before applying nothing and exiting 0.",
    ).toMatch(/Interactive prompts require a TTY/);
  });

  it("verifies the schema EXISTS afterwards, independently of what the tool said", () => {
    expect(
      code,
      "the setup no longer counts the tables it just claimed to create. That " +
        "count is the only check that survives a push failing in a way nobody " +
        "has seen yet.",
    ).toMatch(/information_schema\.tables/);
    const floor = /tableCount\s*<\s*(\d+)/.exec(code);
    expect(floor, "the table-count floor is gone — the verification is decorative").not.toBeNull();
    expect(
      Number(floor![1]),
      "a floor of 0 (or near it) passes on an empty database, which is the " +
        "state this check exists to reject.",
    ).toBeGreaterThanOrEqual(50);
  });

  it("fails LOUDLY rather than seeding into an unapplied schema", () => {
    // The order matters: every refusal must precede the seed, or the setup
    // still writes rows into a database it has just proven is not ready.
    const seedAt = code.indexOf("INSERT INTO users");
    expect(seedAt, "the seed's anchor moved — re-point this ordering check").toBeGreaterThan(-1);
    const throwsBeforeSeed = [...code.slice(0, seedAt).matchAll(/throw new Error\(/g)].length;
    expect(
      throwsBeforeSeed,
      "the schema refusals no longer sit before the seed, so a failed push " +
        "still ends with rows written and specs running.",
    ).toBeGreaterThanOrEqual(3);
  });
});

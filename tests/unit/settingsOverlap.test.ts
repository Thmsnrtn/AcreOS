/**
 * Two settings systems, and the two keys they both claim.
 *
 * Unit 121. This repo has TWO founder-tunable-knob services over two tables,
 * two catalogs, two founder write paths and two caches:
 *
 *   server/services/founderSettings.ts  → `founder_settings`  (TEXT, env
 *       fallback, in-file KNOBS catalog, 30s cache) — what the RUNTIME reads.
 *   server/services/settings.ts         → `platform_settings` (JSONB, scope
 *       walk, seeded SETTINGS_CATALOG, validRange, founder_audit rows) — what
 *       `PATCH /api/founder/studio/dial` WRITES.
 *
 * They are mostly disjoint, which is why this was not a naming coincidence and
 * not a full duplicate: the catalogs overlap on EXACTLY TWO keys, and both were
 * live on opposite sides of a broken wire.
 *
 *   founder flips archival.enabled in the studio
 *      → routes-founder-studio.ts:96 → settings.setSetting → platform_settings
 *      → a founder_audit row is written, 200 returned
 *   the archival sweep reads it
 *      → server/jobs/archival.ts:243 → founderSettings.getSetting → founder_settings
 *      → the row is not there; the toggle reads "false"; the job stays off.
 *
 * **A control that reports success while reaching nothing is worse than a missing
 * control**, because the audit trail then says it was set. Same shape as the
 * `freeSourceFirst` dial unit 119 wired — except this one also lies in the audit.
 *
 * **Founder ruling (picker, 2026-08-15): bridge the READS.** `getSetting`
 * consults `platform_settings` first for an overlapping key, then falls through
 * to its own table → env → default chain unchanged. The other 43 keys do not
 * move.
 *
 * WHAT THIS FILE PINS, and why the second assertion is the load-bearing one:
 * that the bridge exists and orders correctly, and that **the overlap is exactly
 * these two keys**. A third key declared in both catalogs would be a silent
 * repeat of this defect on a different toggle — this test turns that into a
 * decision someone has to make on purpose.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Keys a catalog declares, parsed from `key: "..."` entries in its source. */
function catalogKeys(rel: string, anchor: string): string[] {
  const src = read(rel);
  const at = src.indexOf(anchor);
  expect(at, `${anchor} not found in ${rel} — the catalog moved or was renamed`).toBeGreaterThan(-1);
  return [...src.slice(at).matchAll(/^\s*key:\s*["']([^"']+)["']/gm)].map((m) => m[1]);
}

describe("the two catalogs overlap on exactly the keys the bridge covers", () => {
  const knobKeys = catalogKeys("server/services/founderSettings.ts", "const KNOBS");
  const seededKeys = catalogKeys("server/services/settingsSeeder.ts", "SETTINGS_CATALOG");

  it("both catalogs are actually parsed (vacuity guard)", () => {
    // An empty parse would make the overlap trivially empty and this whole file
    // a green no-op — the failure mode this repo keeps meeting.
    expect(knobKeys.length).toBeGreaterThanOrEqual(10);
    expect(seededKeys.length).toBeGreaterThanOrEqual(25);
  });

  it("the overlap is exactly the two archival keys", () => {
    const overlap = knobKeys.filter((k) => seededKeys.includes(k)).sort();
    expect(
      overlap,
      "the set of keys declared in BOTH settings catalogs changed. Every key in " +
        "this set is written by one system and possibly read by the other — which " +
        "is how the archival toggle came to report success while reaching nothing. " +
        "If you added one deliberately, add it to PLATFORM_OWNED_KEYS in " +
        "founderSettings.ts as well, and update this assertion in the same commit.",
    ).toEqual(["archival.enabled", "archival.horizon_days"]);
  });

  it("every overlapping key is in the bridge set", () => {
    const src = read("server/services/founderSettings.ts");
    const at = src.indexOf("const PLATFORM_OWNED_KEYS");
    expect(at, "the bridge set is gone — overlapping keys resolve from the wrong table again")
      .toBeGreaterThan(-1);
    const decl = src.slice(at, src.indexOf("]", at));
    for (const k of knobKeys.filter((x) => seededKeys.includes(x))) {
      expect(decl, `${k} is declared in both catalogs but is not bridged`).toContain(k);
    }
  });
});

describe("the bridge reads platform_settings first, and fails safe", () => {
  const src = read("server/services/founderSettings.ts");

  it("getSetting consults the bridge before its own table", () => {
    const fn = src.slice(src.indexOf("export async function getSetting("));
    const bridgeAt = fn.indexOf("PLATFORM_OWNED_KEYS.has(key)");
    const ownTableAt = fn.indexOf(".from(founderSettings)");
    expect(bridgeAt, "the bridge branch is gone from getSetting").toBeGreaterThan(-1);
    expect(ownTableAt).toBeGreaterThan(-1);
    expect(
      bridgeAt,
      "getSetting reads its own table before consulting platform_settings, so a " +
        "founder_settings row would shadow the value the founder actually set in " +
        "the studio — the defect, restored.",
    ).toBeLessThan(ownTableAt);
  });

  it("a miss falls through rather than returning null", () => {
    // Fail-safe: if platform_settings has no row (the normal state for a key the
    // founder never touched), the original table -> env -> default chain must
    // still answer. A bridge that short-circuits to null would turn every
    // untouched knob off.
    const helper = src.slice(src.indexOf("async function readPlatformOwned"));
    expect(helper.slice(0, helper.indexOf("\n}"))).toContain("return null");
    const fn = src.slice(src.indexOf("export async function getSetting("));
    expect(fn).toMatch(/if \(bridged !== null\)/);
  });

  it("the bridge swallows read failures instead of throwing into callers", () => {
    // getSetting's callers include the archival sweep and the financial ledger;
    // a settings-table outage must not become an exception in a job.
    const helper = src.slice(src.indexOf("async function readPlatformOwned"));
    expect(helper.slice(0, helper.indexOf("\n}"))).toContain("catch");
  });

  it("JSONB values are stringified (the contract here is string)", () => {
    // platform_settings.value is JSONB: `true` arrives as a boolean, and
    // archival.ts compares against the literal "true". Without the conversion
    // the bridge would return a boolean through a `Promise<string | null>` and
    // the comparison would silently fail — the original bug with extra steps.
    const helper = src.slice(src.indexOf("async function readPlatformOwned"));
    expect(helper).toContain("String(row.value)");
  });
});

describe("the consumer this was broken for", () => {
  it("archival.ts still reads through founderSettings.getSetting", () => {
    // If the job is ever repointed straight at settings.ts, the bridge stops
    // being the thing that connects them and this file should be revisited.
    const src = read("server/jobs/archival.ts");
    expect(src).toContain('from "../services/founderSettings"');
    expect(src).toContain('getSetting("archival.enabled")');
  });

  it("and the studio dial still writes platform_settings", () => {
    const src = read("server/routes-founder-studio.ts");
    expect(src).toContain('from "./services/settings"');
    expect(src).toContain("setSetting({");
  });
});

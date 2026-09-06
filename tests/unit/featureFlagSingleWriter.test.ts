/**
 * Two of the three founder flag toggles wrote a column nothing reads.
 *
 * `platform_feature_flags` carries two columns for the same fact, and the schema
 * says which is which:
 *
 *     enabled: boolean(…)   // back-compat — derived from state
 *     state:   text(…)      // FeatureFlagState — canonical post-port
 *
 * `featureFlags.rowToFlag` reads `state`, falling back to `enabled` **only when
 * `state` is NULL** — which no row written since the migration is, because the
 * column defaults to `'off'`. So `state` is the value every consumer sees:
 * `/api/config/features`, `requireLadderFlag`, `requireFlag`, the client's
 * feature-flags context.
 *
 * THREE FOUNDER-FACING WRITE SURFACES EXISTED. Only one was correct:
 *
 *   1. `PATCH /api/feature-flags/admin/:key` → `featureFlagService.setFlag`.
 *      Writes BOTH columns from either input. **Correct**, and the one the live
 *      `/founder/features` page calls.
 *   2. `PATCH /api/admin/feature-flags/:key` (routes.ts) — wrote `enabled` only.
 *   3. `PUT /api/founder/feature-flags/:key` → `storage.updateFeatureFlag`
 *      (growthConfigRepo) — wrote `enabled` only.
 *
 * Through 2 or 3, a founder flipped a flag, received a 200 showing
 * `enabled: true`, and nothing changed for any customer.
 *
 * THE DIRECTION THAT MATTERED IS THE OTHER ONE. Setting `enabled: false` on a
 * flag whose `state` is `"on"` left the feature ON for every customer while the
 * console reported it off. `feature_marketplace` and `feature_capital_markets`
 * sit behind `requireLadderFlag` — the strict gate that implements the expansion
 * ladder — so that is a founder believing they closed a governance gate that is
 * still open. *"No marketplace before ~25 customers"* is a founder decision
 * enforced by a flag the founder's own console could not actually turn off.
 *
 * THE READ HAD THE SAME SPLIT. `storage.getEnabledFeatureFlags` filtered on
 * `enabled = true`, so a flag set to a TARGETED state — `beta`, `tier:pro` —
 * has `enabled: false` and is genuinely on for somebody, and the founder growth
 * console called it off. It reads `state <> 'off'` now.
 *
 * WHY A TEST AND NOT JUST THE FIX. This is `founderGateSingleOwner`'s shape one
 * table over: a value with one canonical owner and several places that write it
 * directly. The fix is one commit; the invariant — **every writer of
 * `platform_feature_flags` goes through `featureFlagService`, or writes both
 * columns** — is what stops the third copy appearing.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/** Every production file that could write the table. */
function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

describe("the canonical column is the one consumers read", () => {
  it("state is canonical and enabled is its back-compat mirror (the premise)", () => {
    // Everything below rests on this. If the schema ever makes `enabled`
    // canonical again, the fixes are wrong rather than merely unnecessary.
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    const at = schema.indexOf('pgTable("platform_feature_flags"');
    expect(at, "platform_feature_flags is gone").toBeGreaterThan(-1);
    const table = schema.slice(at, schema.indexOf("});", at));
    expect(table).toMatch(/enabled:.*back-compat/i);
    expect(table).toMatch(/state:.*canonical/i);
  });

  it("rowToFlag reads state, with enabled only as a null fallback", () => {
    const svc = read("server/services/featureFlags.ts");
    const at = svc.indexOf("function rowToFlag(");
    expect(at, "rowToFlag is gone").toBeGreaterThan(-1);
    const body = svc.slice(at, svc.indexOf("\n}", at));
    expect(body).toContain("row.state");
    // The fallback must stay guarded by a null check — an unconditional read of
    // `enabled` would reintroduce the split from the other side.
    expect(body).toMatch(/\?\?\s*\(row\.enabled/);
  });
});

describe("every writer sets both columns", () => {
  it("the service writes both, whichever input it is given", () => {
    const svc = read("server/services/featureFlags.ts");
    const at = svc.indexOf("async setFlag(");
    expect(at, "setFlag is gone").toBeGreaterThan(-1);
    const body = svc.slice(at, svc.indexOf("\n  },", at));
    // state given → enabled derived
    expect(body).toContain("set.enabled = update.state === \"on\"");
    // enabled given → state derived
    expect(body).toContain("set.state = update.enabled ? \"on\" : \"off\"");
  });

  it("no other writer sets `enabled` without `state`", () => {
    // The sweep. A `.set({ enabled … })` on this table that does not also set
    // `state` writes a value nothing reads — which is how two founder consoles
    // came to report changes they had not made.
    const offenders: string[] = [];
    for (const abs of serverFiles()) {
      const src = fs.readFileSync(abs, "utf8");
      if (!src.includes("platformFeatureFlags")) continue;
      const code = stripComments(src);
      for (const m of code.matchAll(/\.set\(\{([^}]*)\}\)/g)) {
        const body = m[1];
        if (!/\benabled\b/.test(body)) continue;
        // Only care when this `.set` is on the flags table — check the
        // surrounding statement.
        const stmt = code.slice(Math.max(0, m.index! - 300), m.index! + 200);
        if (!stmt.includes("platformFeatureFlags")) continue;
        if (/\bstate\b/.test(body)) continue;
        const line = code.slice(0, m.index).split("\n").length;
        offenders.push(`${path.relative(ROOT, abs)}:${line}`);
      }
    }
    expect(
      offenders.join("\n"),
      "a writer sets platform_feature_flags.enabled without state. `state` is " +
        "the canonical column — every consumer reads it — so this write changes " +
        "nothing while returning a row that says it did. Worse in reverse: " +
        "`enabled: false` on a flag whose state is 'on' leaves the feature ON " +
        "for every customer while the console reports it off, and " +
        "feature_marketplace / feature_capital_markets are governance flags " +
        "behind requireLadderFlag. Use featureFlagService.setFlag.",
    ).toBe("");
  });

  it("the two divergent routes now go through the service or write both", () => {
    // Named explicitly as well as swept, because these two are the occurrence —
    // the sweep above would pass if someone deleted them instead of fixing them,
    // and deleting a founder control is a different decision.
    const routes = read("server/routes.ts");
    const at = routes.indexOf('app.patch("/api/admin/feature-flags/:key"');
    expect(at, "the admin feature-flag PATCH is gone").toBeGreaterThan(-1);
    const handler = routes.slice(at, routes.indexOf("\n  });", at));
    expect(
      handler,
      "the admin PATCH writes the table directly again instead of delegating",
    ).toContain("featureFlagService.setFlag(");
    expect(handler).not.toContain("db\n        .update(platformFeatureFlags)");

    const repo = read("server/storage/growthConfigRepo.ts");
    const rat = repo.indexOf("async updateFeatureFlag(");
    expect(rat, "storage.updateFeatureFlag is gone").toBeGreaterThan(-1);
    const rbody = repo.slice(rat, repo.indexOf("\n  },", rat));
    expect(rbody, "the storage writer dropped `state` again").toContain(
      'state: enabled ? "on" : "off"',
    );
  });
});

describe("the read side does not have the same split", () => {
  it("getEnabledFeatureFlags filters on state, not on the mirror", () => {
    // A flag in a TARGETED state — `beta`, `tier:pro` — has `enabled: false`
    // and is genuinely on for somebody. Filtering on `enabled` called it off.
    const repo = read("server/storage/growthConfigRepo.ts");
    const at = repo.indexOf("async getEnabledFeatureFlags(");
    expect(at, "getEnabledFeatureFlags is gone").toBeGreaterThan(-1);
    const body = repo.slice(at, repo.indexOf("\n  },", at));
    expect(
      body,
      "the enabled-flags read filters on the back-compat column again, so a " +
        "beta or tier-targeted flag reads as off",
    ).not.toMatch(/eq\(platformFeatureFlags\.enabled/);
    expect(body).toContain("platformFeatureFlags.state");
  });

  it("the governance gate reads through the service, not the table", () => {
    // requireLadderFlag is what enforces the expansion ladder. If it ever read
    // a column directly it would inherit whichever half of the split it picked.
    const gate = read("server/middleware/featureGate.ts");
    const at = gate.indexOf("export function requireLadderFlag");
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(body).toContain("featureFlagService.isEnabled(");
    expect(body, "the ladder gate reads the flags table directly").not.toContain(
      "platformFeatureFlags",
    );
  });
});

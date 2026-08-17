/**
 * The reseller feature set advertised four dead subsystems as ON by default.
 *
 * `whiteLabelService.createTenant` seeded every new reseller tenant with:
 *
 *     features: {
 *       marketplace: true, academy: true, dealHunter: true, voiceAI: false,
 *       visionAI: true, capitalMarkets: false, negotiationCopilot: true,
 *       …
 *     }
 *
 * Four of those `true`s name subsystems the deletion ledger had already ruled
 * on, and **three of the four have no code left at all**:
 *
 *   - `visionAI` — KILL executed 2026-08-01. `services/visionAI.ts` and
 *     `pages/vision-ai.tsx` are deleted.
 *   - `negotiationCopilot` — KILL executed 2026-08-13 (found and fixed in unit
 *     77; this file generalises it).
 *   - `dealHunter` — retired 2026-06-08, superseded by `/api/deal-feed`.
 *   - `academy` — KILL, *"education revenue stays dead"*.
 *   - `marketplace` — FREEZE, reactivate at G2's liquidity proof.
 *
 * WHY A DEFAULT WAS NOT THE FIX. Flipping the defaults does nothing for a config
 * written before a verdict landed: the stored row still says `true`, and
 * `isFeatureEnabled` — the API a reseller calls to decide what to show THEIR
 * customers — reads that row. So `RETIRED_FEATURES` is applied as a **floor at
 * the read**, where it covers every row ever written, and the defaults are
 * corrected as well so a new tenant does not start out lying.
 *
 * WHY THIS FILE RATHER THAN A LINE IN `frozenSurfaceGates`. That file asserts
 * that frozen HTTP surfaces take the strict gate. This is the same rule one
 * layer out: a frozen surface can be perfectly gated at `/api/*` and still be
 * ADVERTISED as available by a different subsystem's config. The gate and the
 * advertisement are separate claims, and only one of them was checked.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const service = read("server/services/whiteLabelService.ts");
const ledger = read("docs/company/deletion-ledger.md");

/** The register, parsed from the service rather than restated here. */
function retiredFeatures(): Record<string, string> {
  const at = service.indexOf("const RETIRED_FEATURES");
  expect(at, "RETIRED_FEATURES is gone — renamed?").toBeGreaterThan(-1);
  const body = service.slice(at, service.indexOf("};", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)) out[m[1]] = m[2];
  return out;
}

/**
 * The literal seeded into a new reseller tenant.
 *
 * Anchored at the INSERT, not at the first `features: {` in the file — that one
 * is the `WhiteLabelConfig` interface's own declaration, and the first draft of
 * this helper parsed it and returned an empty map. The vacuity guard below is
 * what caught it.
 */
function defaults(): Record<string, boolean> {
  const insert = service.indexOf("db.insert(whiteLabelConfigs)");
  expect(insert, "the createTenant insert is gone").toBeGreaterThan(-1);
  const at = service.indexOf("features: {", insert);
  expect(at, "the createTenant feature defaults are gone").toBeGreaterThan(-1);
  const body = service.slice(at, service.indexOf("}", at));
  const out: Record<string, boolean> = {};
  for (const m of body.matchAll(/(\w+):\s*(true|false)/g)) out[m[1]] = m[2] === "true";
  return out;
}

describe("no retired subsystem is advertised to a reseller", () => {
  const retired = retiredFeatures();

  it("finds the register and the defaults (vacuity guard)", () => {
    expect(Object.keys(retired).length, "RETIRED_FEATURES parsed empty").toBeGreaterThan(5);
    expect(Object.keys(defaults()).length, "the defaults parsed empty").toBe(10);
  });

  it("every retired flag defaults OFF", () => {
    const seeded = defaults();
    for (const [flag, verdict] of Object.entries(retired)) {
      expect(
        seeded[flag],
        `${flag} is seeded ON for every new reseller tenant, and its subsystem ` +
          `is ${verdict}. A reseller feature set must not advertise something ` +
          `frozen, killed or already deleted.`,
      ).toBe(false);
    }
  });

  it("isFeatureEnabled refuses a retired flag BEFORE reading the stored row", () => {
    // Order matters and is asserted as order, not as presence: flipping the
    // defaults does nothing for a config written before the verdict landed, so
    // the floor has to run first — that is the whole point of it being a floor.
    const at = service.indexOf("async isFeatureEnabled(");
    expect(at, "isFeatureEnabled is gone").toBeGreaterThan(-1);
    const body = service.slice(at, service.indexOf("\n  }", at));
    const floor = body.indexOf("RETIRED_FEATURES");
    const load = body.indexOf("this.getConfig(");
    expect(floor, "the retired-feature floor is gone from isFeatureEnabled").toBeGreaterThan(-1);
    expect(
      floor,
      "the floor runs after the config is loaded — a stored `true` from before " +
        "the verdict would win",
    ).toBeLessThan(load);
    expect(body.slice(floor, load), "the floor does not return false").toContain(
      "return false",
    );
  });

  it("the fail-open for non-reseller orgs is still there, and still after the floor", () => {
    // Deliberately preserved: an org with no white-label config is not a
    // reseller tenant, and the platform's own gates govern it. Asserted so a
    // later reader does not "fix" it into a fail-closed that hides real
    // features from every ordinary org.
    const at = service.indexOf("async isFeatureEnabled(");
    const body = service.slice(at, service.indexOf("\n  }", at));
    expect(body).toContain("if (!config) return true;");
  });
});

describe("the register is checked against the ledger, not trusted", () => {
  const retired = retiredFeatures();

  it("every entry carries a real verdict, not a stub", () => {
    for (const [flag, verdict] of Object.entries(retired)) {
      expect(verdict.length, `${flag} has a stub reason`).toBeGreaterThan(20);
      expect(
        /KILL|FREEZE|retired/i.test(verdict),
        `${flag}'s reason does not name a ledger verdict`,
      ).toBe(true);
    }
  });

  it("the ledger still carries the verdicts the register cites", () => {
    // If the ledger changes its mind about one of these, the flag should be
    // revisited in that change rather than left off out of habit — the same
    // both-directions rule every register in this repo carries.
    expect(ledger).toMatch(/education revenue stays dead/i);
    expect(ledger).toMatch(/Satellite \/ Vision AI/i);
    expect(ledger).toMatch(/Negotiation copilot \(standalone\)/i);
    expect(ledger).toMatch(/liquidity proof/i);
    expect(ledger).toMatch(/note securitization/i);
  });

  it("a flag cannot leave the register while its subsystem is still retired", () => {
    // THE MISSING DIRECTION, and it was missing: a mutation that simply deleted
    // `visionAI` from RETIRED_FEATURES passed every other assertion in this
    // file. The register would have silently shrunk, and the floor would have
    // stopped covering a subsystem whose code does not exist.
    //
    // Derived from EVIDENCE rather than restated as a list, so it cannot go
    // stale in the other direction either: a flag is required to be in the
    // register exactly while the repository still shows its subsystem retired.
    // Reactivating one genuinely — restoring the code, or lifting the gate —
    // is what takes the flag out, in that same change.
    const routes = read("server/routes.ts");
    const evidence: Record<string, { retired: boolean; why: string }> = {
      visionAI: {
        retired: !fs.existsSync(path.join(ROOT, "server/services/visionAI.ts")),
        why: "server/services/visionAI.ts does not exist",
      },
      voiceAI: {
        retired: !fs.existsSync(path.join(ROOT, "server/services/voiceAI.ts")),
        why: "server/services/voiceAI.ts does not exist",
      },
      negotiationCopilot: {
        retired: !fs.existsSync(path.join(ROOT, "server/services/negotiationCopilot.ts")),
        why: "server/services/negotiationCopilot.ts does not exist",
      },
      dealHunter: {
        retired: !routes.includes("app.use('/api/deal-hunter'"),
        why: "/api/deal-hunter is not mounted",
      },
      academy: {
        retired: /app\.use\('\/api\/certification',[^\n]*requireLadderFlag/.test(routes),
        why: "/api/certification is behind the strict ladder gate",
      },
      marketplace: {
        retired: /app\.use\('\/api\/marketplace',[^\n]*requireLadderFlag/.test(routes),
        why: "/api/marketplace is behind the strict ladder gate",
      },
      capitalMarkets: {
        retired: /app\.use\('\/api\/capital-markets',[^\n]*requireLadderFlag/.test(routes),
        why: "/api/capital-markets is behind the strict ladder gate",
      },
    };

    for (const [flag, { retired: isRetired, why }] of Object.entries(evidence)) {
      if (!isRetired) continue;
      expect(
        flag in retired,
        `${flag} left RETIRED_FEATURES while its subsystem is still retired ` +
          `(${why}). isFeatureEnabled would start answering \`true\` for it ` +
          `again on any stored config that says so.`,
      ).toBe(true);
    }

    // And the evidence itself must not go quiet: if every check above evaluated
    // to "not retired", the loop would pass by inspecting nothing.
    expect(
      Object.values(evidence).filter((e) => e.retired).length,
      "no subsystem evaluated as retired — the evidence checks have gone stale",
    ).toBeGreaterThanOrEqual(5);
  });

  it("the deleted subsystems really are deleted", () => {
    // The strongest form of the claim: not "gated", GONE. If one comes back,
    // this test asks whether its flag should too — rather than leaving a
    // register entry that quietly describes the wrong world.
    for (const gone of [
      "server/services/visionAI.ts",
      "client/src/pages/vision-ai.tsx",
      "server/services/negotiationCopilot.ts",
      "client/src/pages/negotiation-copilot.tsx",
      "server/services/voiceAI.ts",
    ]) {
      expect(
        fs.existsSync(path.join(ROOT, gone)),
        `${gone} is back. If the subsystem was genuinely reactivated, take its ` +
          `flag out of RETIRED_FEATURES in the same change — and cite the ` +
          `ledger's reactivation criterion.`,
      ).toBe(false);
    }
  });

  it("the surviving flags name something that actually exists", () => {
    // The other direction. `portfolioOptimizer` is the only flag defaulted ON,
    // so it had better be real — a feature set where the one `true` is also
    // dead would be this defect with no survivors.
    const seeded = defaults();
    const on = Object.entries(seeded)
      .filter(([, v]) => v)
      .map(([k]) => k);
    expect(on, "the default feature set turned everything off").toEqual([
      "portfolioOptimizer",
    ]);
    const routes = read("server/routes.ts");
    expect(
      routes,
      "portfolioOptimizer is defaulted ON but /api/portfolio-optimizer is not mounted",
    ).toContain("'/api/portfolio-optimizer'");
  });
});

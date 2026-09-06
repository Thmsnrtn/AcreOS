/**
 * Every hand DECLARES its risk. Omission is not a declaration.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `HandSpec.movesMoney` and `HandSpec.outwardClass` were OPTIONAL while their
 * siblings `isCustomerFacing` and `requiresApproval` were required. So a hand
 * author who simply did not think about money got `undefined` — falsy — and
 * `witnessGrant.ts:112` reads exactly that field to enforce the `denyMoney`
 * bound: `if (req.movesMoney && grant.bounds.denyMoney) return DENY(...)`.
 *
 * Omission meant both "this hand does not move money" and "nobody declared",
 * and the second was being read as the first. Six of the ten hand files never
 * mentioned either flag.
 *
 * Both are required now, so the compiler asks. This file guards the part the
 * compiler cannot: that the answer is a considered one and that the money hands
 * still say so.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry, `ac17a1f` — "omission meant both 'institutional' and 'somebody
 * forgot'". The invariant: where a missing value is indistinguishable from a
 * deliberate one on a path that matters, make the declaration required. The
 * mechanism here is AcreOS's own HandSpec; no Foundry noun crossed.
 */

import { describe, it, expect, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const HANDS_DIR = path.resolve(__dirname, "../../server/services/autopilot/hands");

const handFiles = fs
  .readdirSync(HANDS_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "types.ts" && f !== "registry.ts")
  .filter((f) => fs.readFileSync(path.join(HANDS_DIR, f), "utf8").includes("registerHand({"));

describe("the hand corpus is real (vacuity guard, first)", () => {
  it("found the registered hands", () => {
    // A scan that matched nothing would report perfect compliance.
    expect(handFiles.length, "no hand files with registerHand({ found").toBeGreaterThan(5);
  });
});

describe("every registered hand declares both risk flags", () => {
  it("names movesMoney and outwardClass explicitly", () => {
    const missing: string[] = [];
    for (const f of handFiles) {
      const src = fs.readFileSync(path.join(HANDS_DIR, f), "utf8");
      if (!/\bmovesMoney\s*:/.test(src)) missing.push(`${f}: movesMoney`);
      if (!/\boutwardClass\s*:/.test(src)) missing.push(`${f}: outwardClass`);
    }
    expect(
      missing,
      "a hand does not declare its risk. These are REQUIRED fields — an " +
        "undeclared money hand reads as `undefined` to witnessGrant's denyMoney " +
        "bound, which is the same as declaring it harmless.",
    ).toEqual([]);
  });

  it("the type itself keeps them required (the compiler is the first gate)", () => {
    const types = fs.readFileSync(path.join(HANDS_DIR, "types.ts"), "utf8");
    expect(
      /movesMoney\?\s*:/.test(types),
      "movesMoney went back to optional — omission would read as `no money` again",
    ).toBe(false);
    expect(
      /outwardClass\?\s*:/.test(types),
      "outwardClass went back to optional",
    ).toBe(false);
  });

  it("the hands that move money still say so", () => {
    // Positive control. Without it, the check above is satisfied by every hand
    // declaring `movesMoney: false` — compliance with the letter of the rule
    // and the opposite of its purpose.
    for (const f of ["apply-refund.ts", "dunning-action.ts", "run-ad-campaign.ts"]) {
      const src = fs.readFileSync(path.join(HANDS_DIR, f), "utf8");
      expect(src, `${f} no longer declares movesMoney: true`).toMatch(/movesMoney:\s*true/);
    }
  });
});

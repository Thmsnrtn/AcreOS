/**
 * Buy-and-hold is held, not abandoned (COO ruling 2026-10-21, under the
 * founder's delegation): no end-to-end journey evidence yet, so its decision
 * route and page live on claude/buy-and-hold-underwriting and its public claim
 * stays `beta`. The shared underwriting kit stays in main so releasing it later
 * is a re-mount. Both directions are pinned, as expansionLadder.test.ts does for
 * the public API: the kit must exist, and nothing may mount or link the route
 * until this file and the reachability HOLD entries are removed together.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { PUBLIC_CLAIM_DEMOTIONS } from "../../shared/business-types/publicClaims";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => stripComments(fs.readFileSync(path.join(ROOT, p), "utf8"));

describe("buy-and-hold stays held", () => {
  it("the kit it will mount on still exists", () => {
    const kit = read("server/services/underwriting/verticalDecision.ts");
    expect(kit).toMatch(/export async function recordUnderwrittenDecision\(/);
    expect(fs.existsSync(path.join(ROOT, "shared/economics/fields/rentalAcquisition.ts"))).toBe(true);
  });

  it("no route is mounted and no surface links it", () => {
    expect(fs.existsSync(path.join(ROOT, "server/routes-buy-and-hold-underwriting.ts"))).toBe(false);
    expect(read("server/routes.ts")).not.toMatch(/\/api\/buy-and-hold/);
    for (const f of ["client/src/App.tsx", "client/src/components/layout-sidebar.tsx", "shared/business-types.ts"]) {
      expect(read(f), f).not.toMatch(/rentals\/underwrite/);
    }
  });

  it("its public claim stays beta", () => {
    expect(PUBLIC_CLAIM_DEMOTIONS.buy_and_hold?.to).toBe("beta");
  });
});

/**
 * A deletion-ledger verdict is a founder decision, so it takes the strict gate.
 *
 * `docs/company/deletion-ledger.md` carries FREEZE and KILL verdicts on whole
 * subsystems. Those are founder rulings — *"reactivate at G2's liquidity
 * proof"*, *"reactivate when note securitization is a real revenue line (H4)"*,
 * *"education revenue stays dead"* — not product experiments.
 *
 * `featureGate` (= `requireFlag`) carries two escape hatches that unit 51
 * established are wrong for a governance gate, and its own header calls the
 * first of them back-compat:
 *
 *   1. **An enterprise-tier bypass** — a subscription tier overriding a founder
 *      decision.
 *   2. **Failing OPEN when the flag store errors** — a transient database blip
 *      reactivating a frozen surface.
 *
 * Unit 51 moved `/api/marketplace` to `requireLadderFlag`. Unit 53 moved its two
 * ungated satellites. This file is the rest of the set, and — more importantly —
 * the check that the set stays covered.
 *
 * THE EXCEPTION IS THE POINT
 * --------------------------
 * `/api/white-label` KEEPS `featureGate`, deliberately. That bypass exists, per
 * `featureGate`'s own header, *"for legacy reseller / white-label routes that …
 * are part of the enterprise contract"*, and the ledger's reactivation criterion
 * for white-label is *"the first enterprise/white-label contract"*. **The bypass
 * is that criterion, encoded.**
 *
 * So this file asserts the exception as loudly as the rule. A sweep that
 * tightened every frozen surface "for consistency" would delete a deliberate
 * decision — the same failure the `requireLadderFlag` header guards against from
 * the other direction, where the FOUNDER bypass is kept on purpose and could
 * read as an oversight.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const routes = stripComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));
const ledger = fs.readFileSync(path.join(ROOT, "docs/company/deletion-ledger.md"), "utf8");

/** Mounts that implement a deletion-ledger verdict. */
const STRICT = [
  { mount: "/api/marketplace", verdict: "FREEZE — reactivate at G2's liquidity proof" },
  { mount: "/api/investor-verification", verdict: "FREEZE — marketplace satellite" },
  { mount: "/api/buyer-network", verdict: "FREEZE — marketplace satellite" },
  { mount: "/api/deal-rooms", verdict: "FREEZE — marketplace satellite" },
  { mount: "/api/capital-markets", verdict: "FREEZE — reactivate at H4" },
  { mount: "/api/certification", verdict: "KILL — education revenue stays dead" },
] as const;

function mountLine(mount: string): string {
  const at = routes.indexOf(`app.use('${mount}'`);
  expect(at, `${mount} is no longer mounted — deleted?`).toBeGreaterThan(-1);
  return routes.slice(at, routes.indexOf("\n", at));
}

describe("frozen and killed surfaces take the strict gate", () => {
  for (const { mount, verdict } of STRICT) {
    it(`${mount} (${verdict})`, () => {
      expect(
        mountLine(mount),
        `${mount} is back on featureGate. It implements a deletion-ledger ` +
          `verdict — a founder decision — and featureGate lets an ` +
          `enterprise-tier org bypass the flag and fails OPEN when the flag ` +
          `store errors, so a subscription tier or a database blip could ` +
          `reactivate it.`,
      ).toContain("requireLadderFlag(");
    });
  }

  it("the strict gate still has no enterprise bypass and still fails closed", () => {
    // Asserted here too, not only in expansionLadder.test.ts: every mount above
    // inherits these two properties, so they are what the list is worth.
    const gate = stripComments(
      fs.readFileSync(path.join(ROOT, "server/middleware/featureGate.ts"), "utf8"),
    );
    const at = gate.indexOf("export function requireLadderFlag");
    expect(at, "requireLadderFlag is gone").toBeGreaterThan(-1);
    const body = gate.slice(at, gate.indexOf("\n}", at));
    expect(body, "the enterprise bypass is back").not.toContain('"enterprise"');
    const tail = body.slice(body.indexOf("} catch"));
    expect(tail, "it fails open again").not.toMatch(/return next\(\)/);
  });
});

describe("white-label is the deliberate exception", () => {
  it("it keeps featureGate", () => {
    expect(
      mountLine("/api/white-label"),
      "white-label was 'tightened' to requireLadderFlag. That bypass is the " +
        "ledger's own reactivation criterion — 'the first enterprise/white-label " +
        "contract' — encoded as a gate. Removing it deletes a decision in the " +
        "name of consistency.",
    ).toContain("featureGate(");
  });

  it("the reason is written at the mount, not only here", () => {
    // A test explaining an exception that the code does not is a test nobody
    // finds when they are standing in routes.ts about to "fix" the
    // inconsistency.
    const raw = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    const at = raw.indexOf("app.use('/api/white-label'");
    const before = raw.slice(Math.max(0, at - 900), at);
    expect(before, "the white-label exception lost its explanation").toMatch(
      /DELIBERATELY|deliberate/,
    );
    expect(before).toMatch(/enterprise/i);
  });

  it("featureGate's own justification for the bypass is still there", () => {
    // The exception rests on it. If featureGate stops describing the bypass as
    // back-compat for reseller / white-label routes, the reasoning above has
    // lost its anchor and the exception should be re-argued.
    const gate = fs.readFileSync(path.join(ROOT, "server/middleware/featureGate.ts"), "utf8");
    expect(gate).toMatch(/reseller \/ white-label/i);
  });
});

describe("the ledger still says what these assertions claim it says", () => {
  it("the FREEZE/KILL verdicts are still recorded", () => {
    // Every mount above is gated because of a line in this document. If the
    // document changes its mind, the gates should be revisited rather than
    // maintained out of habit.
    expect(ledger).toMatch(/Capital markets/i);
    expect(ledger).toMatch(/note securitization/i);
    expect(ledger).toMatch(/Academy \/ certification residuals/i);
    expect(ledger).toMatch(/education revenue stays dead/i);
    expect(ledger).toMatch(/Reactivate on the first enterprise\/white-label contract/i);
  });
});

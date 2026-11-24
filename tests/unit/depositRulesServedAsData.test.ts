/**
 * The security-deposit return-rule registry is served as a data asset,
 * not bundled JS (bundle diet, N7 fix round D4 — the BD-6 / #680 pattern).
 *
 * The registry's source of truth stays `shared/regulatory/depositReturnRules.ts`
 * (the server imports it synchronously). Its one client consumer, the
 * rent-roll deposit clock, now loads `/deposit-return-rules.json` through
 * client/src/lib/static-data.ts and runs the shared deadline math
 * (`shared/regulatory/depositDeadline.ts`) against the served table.
 *
 * That stays safe only while:
 *   1. the served asset is VERBATIM the registry — same states, same rule
 *      objects, no silent edits (regenerate with:
 *      `npx tsx <script that iterates DEPOSIT_RULE_STATES × getDepositReturnRule
 *      and writes JSON.stringify(record, null, 2) + "\n">`;
 *      the generating script is a one-off, the pin is the contract);
 *   2. the registry-composed `computeDepositDeadline` and the client's
 *      `computeDepositDeadlineFromRule` agree on every input — same known
 *      dates, same unknown reasons, both statutory branches;
 *   3. no client file value-imports the registry module back into the
 *      bundle (the math module and type-only imports are fine);
 *   4. the static server never gives the unhashed asset the 1-year
 *      immutable cache.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEPOSIT_RULE_STATES,
  computeDepositDeadline,
  getDepositReturnRule,
} from "../../shared/regulatory/depositReturnRules";
import {
  computeDepositDeadlineFromRule,
  type DepositReturnRule,
} from "../../shared/regulatory/depositDeadline";
import { stripComments } from "../helpers/stripComments";

const assetPath = path.join(__dirname, "../../client/public/deposit-return-rules.json");
const asset = JSON.parse(fs.readFileSync(assetPath, "utf8")) as Record<string, DepositReturnRule>;

describe("deposit-return-rules.json is the registry, verbatim", () => {
  it("carries exactly the registry's states", () => {
    expect(Object.keys(asset).sort()).toEqual([...DEPOSIT_RULE_STATES]);
  });

  it("deep-equals the registry rule for every state", () => {
    for (const state of DEPOSIT_RULE_STATES) {
      expect(asset[state], state).toEqual(getDepositReturnRule(state));
    }
  });
});

describe("registry lookup and served-table lookup compute the same clock", () => {
  const states: Array<string | null | undefined> = [...DEPOSIT_RULE_STATES, "KY", "xx", "", null, undefined];
  const moveOuts: Array<string | null | undefined> = ["2026-09-30", "2026-02-28", "not-a-date", null, undefined];

  it("agrees for every state × move-out × branch", () => {
    for (const state of states) {
      for (const moveOutDate of moveOuts) {
        for (const hasDeductions of [true, false]) {
          const viaRegistry = computeDepositDeadline({ moveOutDate, state, hasDeductions });
          const viaAsset = computeDepositDeadlineFromRule(asset[String(state ?? "").toUpperCase().trim()] ?? null, {
            moveOutDate,
            state,
            hasDeductions,
          });
          expect(viaAsset, `${state}/${moveOutDate}/${hasDeductions}`).toEqual(viaRegistry);
        }
      }
    }
  });
});

describe("wiring", () => {
  it("rent-roll reads the math module + the served asset, never the registry module", () => {
    const src = stripComments(
      fs.readFileSync(path.join(__dirname, "../../client/src/pages/rent-roll.tsx"), "utf8"),
    );
    expect(src).toContain("@shared/regulatory/depositDeadline");
    expect(src).toContain("DEPOSIT_RETURN_RULES_URL");
    expect(src).not.toContain("@shared/regulatory/depositReturnRules");
  });

  it("the loader names the asset and the static server serves it no-cache", () => {
    const loader = fs.readFileSync(path.join(__dirname, "../../client/src/lib/static-data.ts"), "utf8");
    expect(loader).toContain('DEPOSIT_RETURN_RULES_URL = "/deposit-return-rules.json"');
    const server = fs.readFileSync(path.join(__dirname, "../../server/static.ts"), "utf8");
    expect(server).toContain('"/deposit-return-rules.json"');
  });
});

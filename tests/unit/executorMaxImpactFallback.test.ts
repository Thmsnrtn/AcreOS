/**
 * P12-1b audit note N1 — executor degraded-path fallback parity.
 *
 * autonomousDecisionExecutor resolves its per-decision cap via
 * getNumberSetting("MAX_FINANCIAL_IMPACT_CENTS", EXECUTOR_CONFIG.MAX_FINANCIAL_IMPACT_CENTS).
 * The second argument is the CALLER FALLBACK: it is what the cap becomes
 * when the settings read returns null (platform_settings read error or
 * missing seed row). Before this slice that fallback was 5,000,000 while
 * the KNOBS catalog default and the seeded platform_settings default are
 * both 1,000,000 — so in the degraded state the auto-execute cap silently
 * rose 5x above the value the old founderSettings reader returned.
 *
 * EXECUTOR_CONFIG is module-private and the executor module is too heavy
 * to import for a value pin, so — following the settingsOverlap.test.ts
 * precedent — this suite reads the three sources as text and pins the
 * parity directly: executor fallback === KNOBS default === seeded default
 * === 1,000,000. If anyone raises any one of the three without the
 * others, this fails.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function knobDefault(source: string, key: string): number {
  const idx = source.indexOf(`key: "${key}"`);
  expect(idx, `${key} entry must exist`).toBeGreaterThan(-1);
  const block = source.slice(idx, idx + 800);
  const m = block.match(/defaultValue:\s*"?(\d+)"?/);
  expect(m, `${key} defaultValue must be parseable`).not.toBeNull();
  return Number(m![1]);
}

describe("executor MAX_FINANCIAL_IMPACT_CENTS degraded-path fallback (N1)", () => {
  const executor = read("server/services/autonomousDecisionExecutor.ts");

  it("the env-unset EXECUTOR_CONFIG default is 1,000,000", () => {
    const m = executor.match(
      /AUTONOMOUS_MAX_FINANCIAL_IMPACT \|\| "(\d+)"/,
    );
    expect(m, "executor env fallback literal must be parseable").not.toBeNull();
    expect(Number(m![1])).toBe(1_000_000);
  });

  it("the fallback is passed as the getNumberSetting caller fallback for the cap", () => {
    expect(executor).toContain(
      '"MAX_FINANCIAL_IMPACT_CENTS",\n    EXECUTOR_CONFIG.MAX_FINANCIAL_IMPACT_CENTS,',
    );
  });

  it("executor fallback === KNOBS default === seeded default", () => {
    const knobs = knobDefault(
      read("server/services/founderSettings.ts"),
      "MAX_FINANCIAL_IMPACT_CENTS",
    );
    const seeded = knobDefault(
      read("server/services/settingsSeeder.ts"),
      "MAX_FINANCIAL_IMPACT_CENTS",
    );
    expect(knobs).toBe(1_000_000);
    expect(seeded).toBe(1_000_000);
    const m = executor.match(/AUTONOMOUS_MAX_FINANCIAL_IMPACT \|\| "(\d+)"/);
    expect(Number(m![1])).toBe(knobs);
    expect(Number(m![1])).toBe(seeded);
  });
});

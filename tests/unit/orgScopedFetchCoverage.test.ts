/**
 * The tenancy lint had a real rule and one layer.
 *
 * `scripts/check-org-scoped-fetch.mjs` flags methods that query a table
 * carrying `organizationId` without any organization context. It has run in CI
 * since the Tier 1F conversion and it works — it just walked
 * `server/storage.ts` and `server/storage/*.ts` and nothing else.
 *
 * A service that owns its own persistence therefore never passed under it. One
 * of them was leaking KYC records across tenants (unit 53): every
 * route-reachable method on `services/investorVerification.ts` resolved rows by
 * primary key while its table carried `organizationId NOT NULL` and an
 * org-leading index nothing used.
 *
 * **Pointed at `server/services/**`, the lint flags all six of the methods that
 * fix touched.** Checkable rather than claimed:
 *
 *     git show <unit-53-commit>~1:server/services/investorVerification.ts \
 *       > server/services/_probe.ts && node scripts/check-org-scoped-fetch.mjs
 *
 * That is the whole unit: not a new rule, the existing rule pointed at the
 * surfaces it always meant to cover.
 *
 * WHAT THIS FILE GUARDS. The lint enforces its own baseline (a stale entry
 * fails it), so the down-only ratchet is already there. What a source scan
 * cannot notice is somebody quietly narrowing the WALK — deleting the services
 * branch would take the count to zero offenders and pass, exactly as it did
 * before. So: the scope stays, and the debt register may only shrink.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
const LINT = path.join(ROOT, "scripts/check-org-scoped-fetch.mjs");
const src = fs.readFileSync(LINT, "utf8");

/**
 * The frozen count, down-only. 136 service entries joined 52 storage entries
 * when the walk widened (188); scoping `documentIntelligence` retired six and
 * `dueDiligencePods` three. Lower it in the commit that earns it — never raise it:
 * a new offender is meant to fail the lint, not to be admitted here.
 */
// 173 -> 172 on 2026-08-14: the entry for
// `taxOptimizationEngine.ts::computeDepreciationStrategy` named a file that no
// longer exists — the engine was deleted by founder ruling (BLOCKERS B17). The
// register checks its entries in BOTH directions, so a stale one fails; that is
// what caught this, and lowering the count here is the reduction being locked in
// by the commit that earned it.
const BASELINE_ENTRIES = 172;

/**
 * Rule 2's register, down-only for the same reasons. 63 at the moment it landed,
 * after `priceOptimizer.recordPriceOutcome` — a cross-tenant WRITE the rule
 * found on its first run — was fixed rather than admitted.
 */
const RULE_2_BASELINE = 59;

function run(): string {
  // Runs the real lint. Asserting against its own output is the only way to
  // know the walk is live; reading the source only proves the code is present.
  return execFileSync("node", [LINT], { cwd: ROOT, encoding: "utf8" });
}

describe("the tenancy lint covers the service layer", () => {
  it("walks server/services/**", () => {
    expect(
      src,
      "the services branch is gone from the walk. Removing it drops the " +
        "offender count to zero and the lint keeps passing — which is the " +
        "state that let a cross-tenant KYC leak ship.",
    ).toContain('const servicesDir = join(SERVER_DIR, "services");');
    // Recursive on purpose: three offenders live in services/founder-chat/tools
    // and one in services/borrower, so a flat readdir would miss them.
    const at = src.indexOf('const servicesDir = join(SERVER_DIR, "services");');
    expect(src.slice(at, at + 700), "the services walk stopped recursing").toContain("stack.push(full)");
  });

  it("actually scans the service files (vacuity guard)", () => {
    // The count comes from the lint's own run. A walk that silently resolved to
    // nothing would satisfy every source assertion above.
    const out = run();
    const m = /scanned (\d+) storage \+ service methods across (\d+) files/.exec(out);
    expect(m, `the lint's summary line changed shape:\n${out}`).not.toBeNull();
    expect(Number(m![2]), "far fewer files scanned than the services tree holds")
      .toBeGreaterThan(500);
    expect(Number(m![1])).toBeGreaterThan(2000);
  });

  it("passes, with no new offenders and no stale baseline entries", () => {
    const out = run();
    expect(out).toContain("new offenders: 0");
    expect(
      out,
      "a baseline entry no longer matches a real method. That is the lint " +
        "working: delete the line in the same commit that fixed the method.",
    ).toContain("stale allowlist entries: 0");
    expect(out).toContain("[check-org-scoped-fetch] PASS");
  });
});

describe("the debt register only shrinks", () => {
  it(`is at or below ${BASELINE_ENTRIES} entries`, () => {
    const out = run();
    const m = /baseline \(allowlisted\): (\d+)/.exec(out);
    expect(m, "the baseline count is no longer reported").not.toBeNull();
    expect(
      Number(m![1]),
      "the tenancy debt register GREW. A method that queries an org-scoped " +
        "table without org context should fail this lint, not be admitted to " +
        "its baseline — and admitting one costs the guarantee for every " +
        "method already on the list.",
    ).toBeLessThanOrEqual(BASELINE_ENTRIES);
  });

  it("the entries are real paths, not drifted text", () => {
    // A `file.ts::method` key that points at a deleted file would be caught by
    // the lint's own stale check, but a key with a typo'd PATH would sit there
    // matching nothing and looking like coverage.
    const at = src.indexOf("const BASELINE_OFFENDERS = new Set([");
    const block = src.slice(at, src.indexOf("]);", at));
    const files = new Set(
      [...block.matchAll(/"(server\/[^":]+\.ts)::/g)].map((m) => m[1]),
    );
    expect(files.size, "no baseline entries parsed").toBeGreaterThan(20);
    const missing = [...files].filter((f) => !fs.existsSync(path.join(ROOT, f)));
    expect(missing.join(", "), "baseline entries name files that do not exist").toBe("");
  });

  it("the register does not count as a consumer of the symbols it names", () => {
    // Freezing 136 `path.ts::method` keys made this file a list of identifiers,
    // and lint-reachability tokenises identifiers across every production file
    // including scripts/. `productEvolutionEngine` — a MODULE ORPHAN whose
    // singleton shares its filename — read as referenced, and unreached-exports
    // silently fell 654 → 653. A register of things that are wrong must not
    // make them look right, so this file joined that linter's own exemption.
    const reach = fs.readFileSync(path.join(ROOT, "scripts/lint-reachability.mjs"), "utf8");
    const at = reach.indexOf("const SYMBOL_REGISTERS");
    expect(at, "the register exemption is gone from lint-reachability").toBeGreaterThan(-1);
    expect(reach.slice(at, reach.indexOf("]);", at))).toContain(
      "scripts/check-org-scoped-fetch.mjs",
    );
  });

  it("rule 2 is live: 'has an org and does not use it'", () => {
    // Rule 1 asks whether a method MENTIONS an organization, which is blind to
    // the shape units 56–60 kept finding: a method that ACCEPTS one and then
    // resolves an org-scoped table by primary key anyway. The worst instance was
    // cashFlowForecaster.generateForecast — scoped signature, five internal
    // calls that dropped the org — and rule 1 passed it.
    const out = run();
    const m = /rule 2 \(has an org, resolves by id anyway\): baseline (\d+), new (\d+), stale (\d+)/.exec(out);
    expect(m, `the rule 2 line is gone from the lint's output:\n${out}`).not.toBeNull();
    expect(Number(m![2]), "a new rule-2 offender").toBe(0);
    expect(Number(m![3]), "a stale rule-2 entry — delete it in the commit that fixed it").toBe(0);
    expect(
      Number(m![1]),
      "the rule-2 register GREW. A method that has an org and ignores it should " +
        "fail the lint, not join its baseline.",
    ).toBeLessThanOrEqual(RULE_2_BASELINE);
  });

  it("the rule-2 register records that it holds two different things", () => {
    // Half the entries are safe by construction: `.returning()` then
    // `.where(eq(t.id, inserted.id))`, an id this method just minted. They are
    // textually identical to the dangerous kind, so the register says so —
    // otherwise a triage pass reads 63 findings where roughly half are noise,
    // and gives up on all of them.
    expect(src).toContain("THE ID COMES FROM THE CALLER");
    expect(src).toContain("AN INSERT THIS METHOD JUST MADE");
  });

  it("records that passing is not the same as being safe", () => {
    // The limitation that matters most, kept in the file rather than in a
    // commit message: the check is textual, so a method can take an orgId and
    // never use it. Unit 53's own service would have passed on that basis if it
    // had merely accepted the argument.
    expect(src).toContain("A service can take `orgId` and still hand it to nobody.");
  });
});

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
 *
 * Since 2026-08-16 that applies to FOUR registers, not two: the lint was
 * widened from the method shape (`async name(`) to the function shape
 * (`async function name(`), which it had never looked at, and the two new
 * registers it froze are pinned here on the same terms. Every count this file
 * reads is a count of BAD THINGS FOUND, so each one is read through a scan
 * population floor — a ceiling that reads clean because the scanner went blind
 * is worse than no ceiling, since it reports the blindness as progress.
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
// 172 -> 171 on 2026-08-14: `aiAdvisorTeamV15.ts::gatherHealthSnapshot` named a
// file deleted under B19 class 3 (founder ruling). Second stale entry this day —
// B17's deletion produced the first. The register checks both directions, so a
// stale entry fails; lowering the count here is that reduction locked in.
const BASELINE_ENTRIES = 171;

/**
 * Rule 2's register, down-only for the same reasons. 63 at the moment it landed,
 * after `priceOptimizer.recordPriceOutcome` — a cross-tenant WRITE the rule
 * found on its first run — was fixed rather than admitted.
 */
const RULE_2_BASELINE = 59;

/**
 * THE FUNCTION SHAPE (widened 2026-08-16), the two registers this file used to
 * leave unpinned.
 *
 * The lint had been enforcing the tenancy rule against a KEYWORD rather than a
 * defect: it extracted `async <name>(` and nothing else, so
 * `export async function getDeal(dealId)` shipped green while the identical
 * class method was caught. Widening extraction to the function shape took the
 * scanned population from 2,485 units to 4,606 and froze two new registers.
 * Until this block existed, only the lint's own stale-entry check defended
 * them — nothing stopped the registers from GROWING.
 *
 * Measured from a live `node scripts/check-org-scoped-fetch.mjs` on
 * 2026-08-16: rule 1 baseline 122, rule 2 baseline 63 (register sizes 122 and
 * 63; stale 0, so every frozen entry still matches a real unit).
 *
 * WHY THE HEADROOM (+4 each, the same slack RULE_2_BASELINE carries). It is not
 * licence to admit offenders: a genuinely new one FAILS the lint outright —
 * `new offenders: 0` is asserted above — and joining the register is a
 * deliberate edit, not something that happens by accident. The slack absorbs
 * the one way these counts tick up while tenancy debt stays flat: rewriting an
 * already-registered offending class METHOD as a standalone `async function`
 * moves its entry from the method register into this one, +1 here and -1 there
 * for zero net change. Past a handful of those, growth means somebody widened
 * a register to get green, which is the thing this ceiling exists to fail.
 *
 * These numbers may only come DOWN. Lower them in the commit that earns the
 * reduction (fix the unit, delete the register line — the lint's stale check
 * forces the second half); never raise them.
 */
const FUNCTION_RULE_1_BASELINE = 114;
const FUNCTION_RULE_2_BASELINE = 67;

/**
 * VACUITY FLOOR for the function-shape scan, not a ratchet.
 *
 * Every count above counts BAD THINGS FOUND, so a scan that stops SEEING units
 * finds none and reports reassuring ceilings over an empty population — a
 * counting gate whose number falls because the SCAN BROKE, then hands the
 * operator a lower baseline that was never true. `scanned N async functions`
 * is the population those two ceilings are computed over, so it is floored
 * here: measured at 2,121 on 2026-08-16, floored at 1,600 (~75% of live) so
 * ordinary deletion — the north star — never trips it while a regex that stops
 * matching or a walk that returns nothing does.
 *
 * The lint carries its own internal floor (1,200 functions) and that is the
 * first line of defence; this one is deliberately independent and higher, so a
 * change that blinds the extractor AND relaxes the gate's own floor still
 * fails here. If a real deletion wave takes the population under this floor,
 * lower it in the same commit and name the wave. Do NOT lower it to get green.
 */
const FUNCTION_SCAN_FLOOR = 1600;

function run(): string {
  // Runs the real lint. Asserting against its own output is the only way to
  // know the walk is live; reading the source only proves the code is present.
  return execFileSync("node", [LINT], { cwd: ROOT, encoding: "utf8" });
}

/**
 * Parses the function-shape summary line, and refuses to return a number over
 * a scan that saw nothing.
 *
 * The vacuity check lives HERE rather than only in its own `it()` on purpose:
 * every function-shape assertion in this file goes through this helper, so a
 * clean ceiling can never be reported over an empty scan even if the dedicated
 * vacuity test were deleted. A line that no longer matches fails as loudly as a
 * breached floor — a parse that silently stops matching is the same failure as
 * a scan that silently stops scanning.
 */
function functionShape(out: string): { scanned: number; rule1: number; rule2: number } {
  const m =
    /function shape \(widened [^)]*\): scanned (\d+) async functions; rule 1 baseline (\d+), rule 2 baseline (\d+)/.exec(
      out,
    );
  expect(
    m,
    "the function-shape summary line is gone or changed shape, so the two " +
      "widened registers are unpinned again. Do not delete the assertion — " +
      "re-point it at whatever the lint now prints:\n" + out,
  ).not.toBeNull();
  const scanned = Number(m![1]);
  expect(
    scanned,
    `the function-shape scan saw only ${scanned} async functions (floor ` +
      `${FUNCTION_SCAN_FLOOR}, measured 2,121 on 2026-08-16). The ceilings ` +
      "below are computed over this population: a broken extractor makes them " +
      "read clean over nothing. Find out why the scan went blind — do NOT " +
      "lower this floor to get green.",
  ).toBeGreaterThan(FUNCTION_SCAN_FLOOR);
  return { scanned, rule1: Number(m![2]), rule2: Number(m![3]) };
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

  it("the function-shape scan is not vacuous (guards both ceilings below)", () => {
    // Stated as its own test so the floor is visible in the run output rather
    // than only inside a helper. `functionShape()` enforces it on every call.
    const { scanned } = functionShape(run());
    expect(scanned).toBeGreaterThan(FUNCTION_SCAN_FLOOR);
  });

  it(`the function-shape rule-1 register is at or below ${FUNCTION_RULE_1_BASELINE}`, () => {
    // `export async function getDeal(dealId)` was a working bypass of this
    // whole lint until 2026-08-16. The 122 units it surfaced had always been
    // there; freezing them was the only way to land the widening, and this
    // ceiling is what stops the register from being the place new offenders go.
    const { rule1 } = functionShape(run());
    expect(
      rule1,
      "the FUNCTION-shape tenancy debt register GREW. A function that queries " +
        "an org-scoped table without org context must fail the lint, not join " +
        "its baseline — writing a unit as `async function` instead of a class " +
        "method was the bypass this widening closed, and admitting entries " +
        "here reopens it one line at a time.",
    ).toBeLessThanOrEqual(FUNCTION_RULE_1_BASELINE);
  });

  it(`the function-shape rule-2 register is at or below ${FUNCTION_RULE_2_BASELINE}`, () => {
    // Rule 2 in the function shape: it HAS an org and resolves an org-scoped
    // table by primary key anyway — the shape that let a caller-supplied id
    // reach another tenant's row through a scoped-looking signature.
    const { rule2 } = functionShape(run());
    expect(
      rule2,
      "the FUNCTION-shape rule-2 register GREW. Same rule as the method-shape " +
        "one it mirrors: a unit that has an org and ignores it should fail the " +
        "lint, not be admitted to its baseline.",
    ).toBeLessThanOrEqual(FUNCTION_RULE_2_BASELINE);
  });

  it("the function registers are real paths, not drifted text", () => {
    // Same guard the method register gets above, for the same reason: a key
    // with a typo'd PATH matches nothing and looks like coverage. The
    // population floors (80 and 46 distinct files measured 2026-08-16, floored
    // at 40 and 20) are the vacuity half — a parse that stops matching would
    // otherwise report an empty set of files as "all present".
    for (const [name, floor] of [
      ["BASELINE_FUNCTION_OFFENDERS", 40],
      ["BASELINE_FUNCTION_UNUSED_ORG", 20],
    ] as const) {
      const at = src.indexOf(`const ${name} = new Set([`);
      expect(at, `${name} is gone from the lint — the widened register was deleted, not shrunk`)
        .toBeGreaterThan(-1);
      const block = src.slice(at, src.indexOf("]);", at));
      const files = new Set([...block.matchAll(/"(server\/[^":]+\.ts)::/g)].map((m) => m[1]));
      expect(files.size, `no ${name} entries parsed`).toBeGreaterThan(floor);
      const missing = [...files].filter((f) => !fs.existsSync(path.join(ROOT, f)));
      expect(missing.join(", "), `${name} entries name files that do not exist`).toBe("");
    }
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

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
import os from "node:os";
import { execFileSync } from "node:child_process";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

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

// ── RE-SEED 2026-08-17, founder-approved (OWNER_DECISIONS_PENDING OD-3) ──────
// The four ceilings below were RAISED ONCE, deliberately, and are down-only
// again from here. This is the only kind of increase this file permits, and it
// is recorded rather than quietly applied.
//
// WHY. The lint located a function body with `indexOf("{", parenClose)`, which
// on a declaration carrying an inline `): Promise<{ … }> {` return type lands
// inside the RETURN TYPE. `matchBrace` then closed the type instead of the
// body, so the body was never scanned — the unit was reported clean because
// nothing had been read. 335 declarations were in that state, across BOTH
// extractors. Fixing the finder (findBodyBrace) made them visible:
//
//   entries      171 -> 196   (+25 method-shape)
//   rule 2        59 ->  69   (+10)
//   function r1  114 -> 130   (+16)
//   function r2   67 ->  84   (+17)
//
// The debt did not grow; the gate stopped being blind to it. `--blind-spot`
// still reports the measurement, and the verdict now prints "declarations whose
// body could not be located: 0" on every run, so a future regression to
// unreadable bodies is loud instead of silent.
//
// HAND-VERIFIED before freezing, per the founder's decision. None was an
// artifact, and the two classes map onto the two rules exactly:
//   rule 1 — no org anywhere: trustEvolution.runTrustEvolution and
//     platformOpsRepo.getApiUsageStats are genuine platform ops that never
//     declared themselves through unscopedForPlatformOps(reason).
//   rule 2 — has an org and resolves by id anyway: campaignOptimizer
//     .optimizeCampaign UPDATEs `campaigns` by PRIMARY KEY ONLY while
//     `campaign.organizationId` is on the same object and IS used for the other
//     write in the same method. A real tenancy weakness on a live write path.
// 2026-08-21: 196 -> 195. `noteRepo.createPayment` left the register — both of
// its `notes` queries (the SELECT … FOR UPDATE and the balance UPDATE) now
// carry `payment.organizationId`, so the lint no longer sees an offender there
// and its stale-entry check forced the register line out in the same commit.
// Down-only: the ceiling moves with it.
// 2026-08-21: 195 -> 194. `buyerMatchingAI.resolveBuyerContact` left the
// register — it now takes the caller's organizationId and pins
// `leads.organization_id` in the WHERE, so an org-A buyer profile carrying an
// org-B `leadId` (caller-supplied, never ownership-checked) resolves to no row
// instead of returning that lead's email and name into the buyer.match_created
// payload. Pinned behaviourally by tests/unit/buyerContactTenancy.test.ts.
// 2026-08-21: 194 -> 193. `proactiveMonitor.autoResolveAlert` left the register
// - its UPDATE was a bare `eq(systemAlerts.id, alertId)` reached by
// `POST /api/monitor/alerts/:id/resolve` (isAuthenticated + getOrCreateOrg, no
// founder gate) and by the Pax `resolve_alert` tool, so an authenticated member
// of any org could flip another org's alert to resolved and overwrite its
// `metadata` blob. It now takes the resolution scope as a REQUIRED argument and
// pins `organization_id` (or `IS NULL` for the platform-global lane) in the
// WHERE. Pinned behaviourally by tests/unit/alertResolveTenancy.test.ts.
// 2026-08-21: 193 -> 192. `paxRepo.deletePaxProjectFile` left the register — the
// DELETE now carries the tenant predicate itself, proven through the parent
// project (`pax_project_files` has no organization_id, so `project_id` is the
// only ownership link and it was never asserted against the caller's org: the
// route checked the project id in the URL while the statement deleted the file
// id, and the fileCount decrement followed the projectId read off the deleted
// row). Pinned behaviourally by tests/unit/paxProjectFileTenancy.test.ts.
// 2026-08-21: 192 -> 191. `leadRepo.getLeadActivities` left the register — the
// SELECT now binds `lead_activities.organization_id` to a REQUIRED leading org
// argument. It took `(leadId, limit)` with no org anywhere, and four of its
// five production callers (agent-skills scoreBuyer/scoreLead/suggestFollowUp,
// sequenceProcessor.checkLeadResponded) passed `(organizationId, leadId)`:
// both `number`, so the type checker was silent while the query became
// `lead_id = <organizationId> limit <leadId>` — another tenant's lead
// timeline, fed into the caller's output. Pinned behaviourally by
// tests/unit/leadActivityTenancy.test.ts.
const BASELINE_ENTRIES = 191;

/**
 * Rule 2's register, down-only for the same reasons. 63 at the moment it landed,
 * after `priceOptimizer.recordPriceOutcome` — a cross-tenant WRITE the rule
 * found on its first run — was fixed rather than admitted.
 */
const RULE_2_BASELINE = 69;

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
const FUNCTION_RULE_1_BASELINE = 130;
const FUNCTION_RULE_2_BASELINE = 84;

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

/**
 * RULE 3 — "scoped unit, unscoped query". Down-only ceiling.
 *
 * Added 2026-08-18 after `generateDealFeed` shipped a live cross-tenant read
 * that rules 1 and 2 BOTH passed: the function was org-scoped six other ways,
 * so rule 1 saw `organizationId` in the body, and the query resolved by
 * county rather than primary key, so rule 2 had nothing to say either.
 *
 * Measured 127 on 2026-08-18 and set slightly above, so ordinary refactoring of
 * a baselined query does not fail the suite while a genuine new population does.
 * Every REDUCTION is locked in here, same as the registers above.
 *
 * 133 → 72 on 2026-08-20, and the drop is NOT 61 defects fixed. Five were real
 * cross-tenant paths (ledger 51); the other 43 were the gate's own blind spot.
 * rule 3 tests the text sliced from `.from(table)` to the terminating `;`, and
 * the commonest way this repo builds a query puts the org predicate in a local
 * array spread in later — `.where(and(...conditions))` — or in a variable
 * holding the whole clause. The predicate was always there; the extractor could
 * not see it. It follows both shapes now, and the two fixtures above pin that
 * following a variable does not mean TRUSTING it: a spread list with no org
 * predicate still fires.
 */
const RULE_3_BASELINE = 72;

/** Chains rule 3 must keep seeing; 1,060 measured 2026-08-18. */
const RULE_3_CHAIN_FLOOR = 300;

function run(...args: string[]): string {
  // Runs the real lint. Asserting against its own output is the only way to
  // know the walk is live; reading the source only proves the code is present.
  return execFileSync("node", [LINT, ...args], { cwd: ROOT, encoding: "utf8" });
}

/**
 * Runs the lint over a THROWAWAY TREE and returns its output plus whether it
 * exited non-zero.
 *
 * The canary below used to write its fixture into `server/services/` — the live
 * tree — run the real gate over ~906 files, and delete it. About 69 other test
 * files walk `server/**`, vitest runs them in parallel workers, and one of them
 * would list the canary and read it after the delete, dying with an fs stack
 * trace instead of an assertion. That happened twice on 2026-08-20. This gate
 * was the last of the three probe-writers; with it moved, the repository no
 * longer rewrites itself under a test run at all.
 *
 * `execFileSync` THROWS on the non-zero exit a canary is asking for, so the
 * output has to be recovered from the error — which is also why the old version
 * of this helper could see stdout only on the failure path.
 */
function runOverFixture(files: Record<string, string>): { out: string; failed: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "org-scoped-fixture-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    return { out: run("--root", dir), failed: false };
  } catch (err) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    if (e.status === undefined) throw err; // a real harness failure, not a verdict
    return { out: String(e.stdout ?? "") + String(e.stderr ?? ""), failed: true };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The one org-scoped table every fixture below needs the gate to recognise. */
const FIXTURE_SCHEMA = [
  'import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";',
  'export const properties = pgTable("properties", {',
  '  id: serial("id").primaryKey(),',
  '  organizationId: integer("organization_id").notNull(),',
  '  state: text("state"),',
  "});",
  "",
].join("\n");

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

  it("reports that every declaration's body was actually read", () => {
    // THE CLAIM THIS GATE COULD NOT PREVIOUSLY MAKE. Until 2026-08-17 its
    // extractors located a body with `indexOf("{", parenClose)` and skipped
    // silently when that went wrong — a unit reported clean because nothing
    // had been read. The verdict now states its own coverage on every run,
    // including the zero, so a regression to unreadable bodies is loud.
    const out = run();
    const m = /declarations whose body could not be located: (\d+)/.exec(out);
    expect(m, `the coverage line is gone from the verdict:\n${out}`).not.toBeNull();
    expect(
      Number(m![1]),
      "the lint could not locate some declaration's body. It is NOT SCANNED, " +
        "so the gate says nothing about it — that is coverage loss, and the " +
        "names are printed above. Fix the finder; do not accept the skip.",
    ).toBe(0);
  });

  it("rule 3 is wired, sees a real population, and is down-only", () => {
    const out = run();
    const m =
      /rule 3 \(scoped unit, unscoped query[^)]*\): scanned (\d+) query chains inside scoped units; baseline (\d+), new (\d+), stale (\d+)/.exec(
        out,
      );
    expect(
      m,
      "rule 3's summary line is gone or changed shape, so the register that " +
        "catches an unscoped QUERY inside a scoped function is unpinned. Do " +
        "not delete this assertion — re-point it:\n" + out,
    ).not.toBeNull();
    const [, chains, baseline, added, stale] = m!.map(Number) as unknown as number[];
    expect(
      chains,
      `rule 3 walked only ${chains} query chains (floor ${RULE_3_CHAIN_FLOOR}, ` +
        "measured 1,060 on 2026-08-18). A chain walk that sees nothing " +
        "certifies every query as scoped, which is the false green this rule " +
        "exists to remove. Do NOT lower this floor.",
    ).toBeGreaterThan(RULE_3_CHAIN_FLOOR);
    expect(
      baseline,
      "the rule 3 register GREW. Every entry is a query that reads an " +
        "org-scoped table from inside a function that has an organization and " +
        "does not use it on that query. Scope the query; do not baseline it.",
    ).toBeLessThanOrEqual(RULE_3_BASELINE);
    expect(added, "a new unscoped query — scope it, or baseline it WITH a reason").toBe(0);
    expect(
      stale,
      "a rule 3 baseline entry no longer matches. That is the gate working: " +
        "delete the line in the same commit that scoped the query.",
    ).toBe(0);
  });

  it("rule 3 FIRES on the exact shape that defeated rules 1 and 2 (canary)", () => {
    // Mutation-as-test. The fixture is the deal-feed defect verbatim: a
    // function that mentions `organizationId` (so rule 1 passes), reading an
    // org-scoped table by a NON-primary-key predicate (so rule 2 passes),
    // with no org predicate on the query itself.
    //
    // Run over a THROWAWAY TREE since 2026-08-20 (see `runOverFixture`). It used
    // to be written into `server/services/` and deleted again, which is how a
    // parallel worker came to read a file that no longer existed.
    const { out, failed } = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__rule3_canary__.ts": [
        'import { db } from "../db";',
        'import { properties } from "@shared/schema";',
        'import { eq, and, sql } from "drizzle-orm";',
        "",
        "export async function canaryScopedUnitUnscopedQuery(orgId: number) {",
        "  const own = await db.select().from(properties)",
        "    .where(eq(properties.organizationId, orgId));",
        "  const leaked = await db.select().from(properties)",
        "    .where(and(sql`LOWER(${properties.state}) = LOWER('TX')`));",
        "  return { own, leaked };",
        "}",
        "",
      ].join("\n"),
    });

    expect(
      failed,
      "the lint EXITED ZERO with an unscoped cross-tenant query in the tree. " +
        "A gate that reports a finding and still passes is not a gate:\n" + out,
    ).toBe(true);
    expect(
      out,
      "rule 3 did NOT fire on a function that mentions organizationId and " +
        "still reads properties without it. The rule is decoration:\n" + out,
    ).toContain("__rule3_canary__.ts");
    expect(out).toMatch(/canaryScopedUnitUnscopedQuery\(\)\s+<- properties/);
    // And the lint must be RED, not merely chatty.
    expect(out).not.toContain("[check-org-scoped-fetch] PASS");
    // Vacuity on the fixture itself: a tree the gate cannot parse would also
    // produce "no PASS", so prove the schema was read and the rule ran.
    expect(out, "the fixture's org-scoped table was not recognised").toMatch(
      /org-scoped tables: [1-9]/,
    );
    expect(out).toMatch(/rule 3 .*scanned [1-9]\d* query chains/);
  });

  it("follows a predicate list SPREAD into the query, and a clause held in a variable", () => {
    // ── WHY THE EXTRACTOR LEARNED THIS ────────────────────────────────────
    // rule 3 tests the text sliced from `.from(table)` to the terminating `;`.
    // The commonest way this repo builds a query puts the org predicate in a
    // local array declared several lines earlier and spreads it in — so the org
    // predicate was RIGHT THERE and the chain text could not see it. Measured
    // during the 2026-08-20 rule-3 adjudication: 43 of 115 baselined entries
    // were this shape, all correctly scoped, all reported as offenders.
    //
    // A third of a security list being false positives is not merely untidy: a
    // reader who meets noise one time in three stops reading the list, and the
    // real finding goes with it.
    //
    // Both indirections are pinned here, because the repo uses both:
    //   spreadStyle — `.where(and(...conditions))`
    //   clauseStyle — `const whereClause = and(...conditions); .where(whereClause)`
    const { out, failed } = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__indirect_scoped__.ts": [
        'import { db } from "../db";',
        'import { properties } from "@shared/schema";',
        'import { eq, and, sql } from "drizzle-orm";',
        "",
        "export async function spreadStyle(orgId: number, onlyTx: boolean) {",
        "  const conditions: any[] = [eq(properties.organizationId, orgId)];",
        "  if (onlyTx) conditions.push(sql`LOWER(${properties.state}) = LOWER('TX')`);",
        "  return db.select().from(properties).where(and(...conditions));",
        "}",
        "",
        "export async function clauseStyle(orgId: number) {",
        "  const conditions: any[] = [eq(properties.organizationId, orgId)];",
        "  const whereClause = and(...conditions);",
        "  return db.select().from(properties).where(whereClause);",
        "}",
        "",
      ].join("\n"),
    });

    expect(
      failed,
      "rule 3 flagged a query whose org predicate is built in a local array " +
        "and spread in. That is a FALSE POSITIVE, and it was a third of the " +
        "baseline:\n" + out,
    ).toBe(false);
    expect(out).toContain("[check-org-scoped-fetch] PASS");
    // Vacuity: prove the fixture was actually parsed and the rule actually ran,
    // because an unparsed tree also produces "no finding".
    expect(out, "the fixture's org-scoped table was not recognised").toMatch(
      /org-scoped tables: [1-9]/,
    );
    expect(out).toMatch(/rule 3 .*scanned [1-9]\d* query chains/);
  });

  it("still FIRES when the spread list carries no organization predicate", () => {
    // THE FALSIFICATION, and the reason the case above is safe to ship. The
    // indirection is identical — same array, same spread, same clause variable —
    // and the org predicate is simply absent. If following the variable made the
    // rule pass on THIS, the fix would have blinded the gate rather than
    // sharpened it.
    const { out, failed } = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__indirect_unscoped__.ts": [
        'import { db } from "../db";',
        'import { properties } from "@shared/schema";',
        'import { eq, and, sql } from "drizzle-orm";',
        "",
        "export async function looksScopedIsNot(orgId: number) {",
        "  const own = await db.select().from(properties)",
        "    .where(eq(properties.organizationId, orgId));",
        "  const conditions: any[] = [sql`LOWER(${properties.state}) = LOWER('TX')`];",
        "  const whereClause = and(...conditions);",
        "  const leaked = await db.select().from(properties).where(whereClause);",
        "  return { own, leaked };",
        "}",
        "",
      ].join("\n"),
    });

    expect(
      failed,
      "the lint EXITED ZERO on a query whose predicate list contains NO org " +
        "predicate. Following the variable must not mean trusting it:\n" + out,
    ).toBe(true);
    expect(out).toContain("__indirect_unscoped__.ts");
    expect(out).toMatch(/looksScopedIsNot\(\)\s+<- properties/);
    expect(out).not.toContain("[check-org-scoped-fetch] PASS");
  });

  it("a CLEAN fixture passes — the canary above is not just 'any tree fails'", () => {
    // The other half of the mutation. Same tree, same schema, one predicate
    // added. Without this, the canary would be satisfied by a gate that
    // rejects every fixture for an unrelated reason — a red that means nothing.
    const { out, failed } = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__clean__.ts": [
        'import { db } from "../db";',
        'import { properties } from "@shared/schema";',
        'import { eq, and, sql } from "drizzle-orm";',
        "",
        "export async function scopedUnitScopedQuery(orgId: number) {",
        "  const own = await db.select().from(properties)",
        "    .where(eq(properties.organizationId, orgId));",
        "  const alsoOwn = await db.select().from(properties)",
        "    .where(and(eq(properties.organizationId, orgId),",
        "      sql`LOWER(${properties.state}) = LOWER('TX')`));",
        "  return { own, alsoOwn };",
        "}",
        "",
      ].join("\n"),
    });
    expect(failed, `a correctly-scoped fixture was rejected:\n${out}`).toBe(false);
    expect(out).toContain("[check-org-scoped-fetch] PASS");
    expect(out, "the fixture ran without the gate seeing its table").toMatch(
      /org-scoped tables: [1-9]/,
    );
  });

  it("the gate no longer writes probes into the working tree", () => {
    // THE POINT OF THE FIXTURE MOVE, pinned so it cannot quietly revert. Two
    // gates were converted on 2026-08-20 (ledger 43) and this was the third and
    // last; a future edit that reintroduces a live-tree write brings back an
    // intermittent fs stack trace in whichever unrelated test happens to be
    // walking server/** at the time — a failure that reads as a finding and is
    // not one.
    const src = fs.readFileSync(
      path.join(ROOT, "tests/unit/orgScopedFetchCoverage.test.ts"),
      "utf8",
    );
    // Comments stripped: this very docblock discusses writing into
    // server/services, and a scan that reads prose matches the explanation of
    // the defect and calls it the defect (ledger 35, then 45, then 46).
    const code = stripCommentsPreservingLines(src);
    // Stated as a SPAN over CALLS, not as a pattern over text. Every mutating
    // `fs.*` call in this file must sit inside `runOverFixture`, which writes
    // only into a mkdtemp directory it removes again. A regex naming the old
    // variable would have been satisfied by renaming the variable.
    //
    // Matched on `fs.<name>(` specifically: the first draft searched for the
    // bare word and found its own loop condition and its own failure message —
    // a source scan matching itself, which is the register problem in
    // miniature and the reason SYMBOL_REGISTERS exists one gate over.
    const runnerStart = code.indexOf("function runOverFixture");
    expect(runnerStart, "the fixture runner was removed").toBeGreaterThan(-1);
    const runnerEnd = code.indexOf("\n}", runnerStart);
    expect(runnerEnd).toBeGreaterThan(runnerStart);

    const MUTATORS =
      /\bfs\.(writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|cpSync|symlinkSync)\s*\(/g;
    const calls: Array<{ at: number; text: string }> = [];
    for (let m = MUTATORS.exec(code); m !== null; m = MUTATORS.exec(code)) {
      calls.push({ at: m.index, text: m[0] });
    }
    expect(
      calls.length,
      "no fs mutation found at all — this check would pass over a file that " +
        "had stopped writing its fixture too, which is not what it asserts",
    ).toBeGreaterThan(2);
    for (const c of calls) {
      expect(
        c.at > runnerStart && c.at < runnerEnd,
        `${c.text} sits outside runOverFixture — something in this file writes ` +
          `to a path it chose itself:\n  …${code.slice(Math.max(0, c.at - 90), c.at + 40)}…`,
      ).toBe(true);
    }
    // And the gate must still accept the flag the runner depends on.
    const gate = stripCommentsPreservingLines(fs.readFileSync(LINT, "utf8"));
    expect(gate, "the gate lost --root support").toContain('argValue("--root")');
    expect(
      gate,
      "the gate no longer distinguishes a fixture from the repository, so the " +
        "vacuity floors either fail every fixture or protect nothing",
    ).toContain("SCANNING_REAL_REPO");
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

/**
 * `--blind-spot` measures how much of the corpus the CURRENT extractor never
 * reads: both extractors locate a body with `indexOf("{", parenClose)`, which
 * lands inside an inline return type such as `): Promise<{ total: number }> {`.
 * Every query in those bodies is invisible to a TENANT-ISOLATION gate.
 *
 * The measurement is a flag rather than a fix on purpose. Correcting the
 * extractor in place would re-baseline four frozen registers as a side effect
 * of a bug fix, and raising a baseline here needs owner sign-off
 * (docs/autonomous/OWNER_DECISIONS_PENDING.md, OD-3). What these tests guard is
 * that the number the owner will decide on is HONEST — a measurement that
 * quietly stops measuring is the failure mode this whole file exists for.
 */
describe("the extractor's blind spot is measured honestly", () => {
  const blindSpot = (): string =>
    execFileSync("node", [LINT, "--blind-spot"], { cwd: ROOT, encoding: "utf8" });

  it("resolves EVERY declaration in the real corpus, with none left unreadable", () => {
    const out = blindSpot();
    const m = /(\d+) declaration\(s\) the correct finder also could not resolve/.exec(out);
    expect(m, `the --blind-spot report changed shape:\n${out}`).not.toBeNull();
    expect(
      Number(m![1]),
      "the body-finder cannot read some declaration it used to read. A shape " +
        "it refuses is a shape the FIXED gate would skip, so this is coverage " +
        "loss arriving early. The report names them — go look, do not raise " +
        "this number.\n" + out,
    ).toBe(0);
  });

  it("still faces the shape that once defeated it (vacuity guard)", () => {
    // The finder returned -1 on `Promise<((prompt: string) => Promise<string>) | null>`
    // because the `=` of `=>` hit its ran-off-the-declaration bail. The
    // assertion above only means something while the corpus still contains an
    // arrow-typed return annotation for it to get right.
    const arrowReturn = /\basync\s+function\s+\w+\s*\([^)]*\)\s*:[^{;]*=>/;
    const probe = fs.readFileSync(path.join(ROOT, "server/services/autopilot/operator.ts"), "utf8");
    expect(
      arrowReturn.test(probe),
      "operator.ts no longer declares an async function returning a function " +
        "type, so the zero above may just mean the hard case left the corpus. " +
        "Re-point this at another one rather than deleting it.",
    ).toBe(true);
  });

  it("reports a real blind spot over a real population (vacuity guard)", () => {
    const out = blindSpot();
    const files = /--blind-spot: (\d+) files scanned/.exec(out);
    const missed = /(\d+) async function\(s\) whose BODY the current extractor never reads/.exec(out);
    expect(files, `the --blind-spot report changed shape:\n${out}`).not.toBeNull();
    expect(missed, `the --blind-spot report changed shape:\n${out}`).not.toBeNull();
    expect(Number(files![1]), "the blind-spot scan walked almost nothing").toBeGreaterThan(500);
    expect(
      Number(missed![1]),
      "the naive-finder gap measures as ZERO over a corpus that still contains " +
        "inline object return types. The measurement went blind — the gap " +
        "itself cannot vanish while `): Promise<{ … }> {` is still written " +
        "anywhere in server/.\n" + out,
    ).toBeGreaterThan(0);
  });

  it("does not change the gate's verdict", () => {
    // Still true, and still worth pinning: the flag REPORTS, it does not judge.
    // Its meaning changed on 2026-08-17 (see the header) but its separation
    // from the verdict did not.
    const normal = run();
    expect(normal).toContain("[check-org-scoped-fetch] PASS");
    expect(normal).toContain("new offenders: 0");
    expect(
      blindSpot(),
      "--blind-spot printed the gate's verdict, so it is no longer a pure " +
        "measurement.",
    ).not.toContain("[check-org-scoped-fetch] PASS");
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

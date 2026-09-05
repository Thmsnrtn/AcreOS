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
const BASELINE_ENTRIES = 190;

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
 * Vacuity floor for the ROUTE-HANDLER population, measured 2,668 on
 * 2026-09-04.
 *
 * It is separate from FUNCTION_SCAN_FLOOR because the two extractors fail
 * independently, and the route one failed silently three ways at once:
 *
 *   - it took "the LAST `async (` in the registration call" as the handler,
 *     but the call text spans the handler's whole body, so a nested
 *     `db.transaction(async (tx) => …)` won and 51 handlers were read at the
 *     wrong boundary;
 *   - it dropped every registration written with a trailing comma before the
 *     closing paren — 432 of them;
 *   - it dropped every handler registered through a wrapper such as
 *     `asyncHandler(async (req, res) => …)` — 40 more.
 *
 * The gate printed a healthy route count throughout. Fixing the boundary took
 * the readable population from 2,142 to 2,668 handlers and the rule-3 chain
 * walk from 1,831 to 2,040 — and surfaced eight findings that had been
 * invisible. This floor is what makes that kind of silent shrink loud.
 */
const ROUTE_SCAN_FLOOR = 2400;

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

/** Chains rule 3 must keep seeing; 1,060 measured 2026-08-18, 2,088 on 2026-09-04. */
const RULE_3_CHAIN_FLOOR = 300;

/**
 * Rule 2 gained a sanctioned-hatch exemption on 2026-09-04: a lone-id
 * predicate whose enclosing STATEMENT is rooted in `unscopedForPlatformOps(`
 * is not reported. That is correct — rule 2 catches a scoped-LOOKING signature
 * that crosses tenants, and the hatch is the loudest possible form of the
 * opposite — but an exemption is still a hole, and a hole nobody counts widens.
 *
 * So the count is published in the verdict and capped here. It is a ceiling,
 * not a floor: the number may fall freely, and a diff that raises it has to say
 * which platform op needs a cross-org by-id read and why. Measured 1 on
 * 2026-09-04 (abTestEngine.findTestOwnerAnyOrg — "is this A/B test id already
 * owned by another org?", the one question createTest cannot ask from inside
 * one org).
 *
 * 1 → 4 on 2026-09-05, as three SCP platform ops converted from silently
 * unscoped to explicitly hatched. Each is a by-primary-key read whose row IS
 * the unit of work, reached from a founder-only surface with no caller org to
 * scope to — the founder's own organization, which `getOrCreateOrg` supplies,
 * is not the row's:
 *
 *   outcomeVerificationV12.recordVerification   resolves a verification
 *     contract by its own id, handed down from the platform sweep that selected
 *     it. The contract carries the lane; the caller does not have one.
 *
 *   eventMeshV12.acknowledge   resolves an event by eventId to record delivery.
 *     The mesh's `system:*` channels carry no orgId at all, and ack is the
 *     other half of "unprocessed" — scoped, the drain could never mark a
 *     system-lane event done and would redeliver it forever.
 *
 *   integrationFrameworkV12.rollbackExecution   resolves one execution-log row
 *     by id for the operator. Every row `execute` writes lands with org_id
 *     NULL, so an org predicate would match nothing at all.
 *
 * These three were ALREADY cross-org before this change; what changed is that
 * they now say so in a logged, greppable sentence instead of by omission. That
 * is the trade this exemption exists to make — and the ceiling is what stops it
 * being made silently.
 *
 * 4 → 6 on 2026-09-05, as the decisions-inbox pair converted. Both are
 * by-primary-key reads on the FOUNDER's own queue, and in both the row that
 * comes back is what supplies the lane — there is no caller org to scope to:
 *
 *   decisionsInbox.createFromAlert   resolves a systemAlerts row by id.
 *     system_alerts is AcreOS's own infrastructure-alert table and the founder
 *     card it produces is inserted with no organizationId at all.
 *
 *   decisionsInbox.createFromEscalation   resolves a supportTickets row by id
 *     on the escalation path. The confused-deputy check lives one frame up, in
 *     executeSupportTool, which refuses a ticketId outside the caller's own org
 *     before any tool case runs (founders excepted); the card created here then
 *     inherits the TICKET's organizationId rather than inventing one. So the
 *     read never widens what the caller could already reach — but it is a
 *     property of the CALLER, which is exactly why it is hatched loudly here
 *     and not left to omission.
 */
const HATCH_EXEMPTION_CEILING = 6;

/**
 * BOTH of Drizzle's query spellings reach rule 3.
 *
 * The chain walker keyed on `.from(<table>)` and nothing else, so
 * `db.query.<table>.findMany({ where: … })` — the relational API, 280 call
 * sites under server/ — was outside the population entirely. A gate whose
 * whole subject is tenant isolation could not see a seventh of the queries
 * (2026-09-04). Widening it surfaced one real offender:
 * `sequenceOptimizer.applyWinningVariant`, which read AND updated
 * `sequence_performance` on `(sequence_id, message_position)` with no
 * organization — and had no callers anywhere, so it was deleted.
 *
 * A fixture per spelling, because "the regex still matches `.from(`" and "the
 * regex still matches both" look identical in a green run.
 */
// A NON-id predicate on purpose: `eq(<table>.id, …)` is primary-key
// resolution, which rule 3 hands to rule 2 by design. A fixture that used it
// would be excluded and read as "the gate does not see this spelling".
const CHAIN_SPELLINGS = [
  { id: "classic-select", query: 'await db.select().from(properties).where(eq(properties.state, st));' },
  { id: "relational-find-many", query: 'await db.query.properties.findMany({ where: eq(properties.state, st) });' },
  { id: "relational-find-first", query: 'await db.query.properties.findFirst({ where: eq(properties.state, st) });' },
];

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
function functionShape(out: string): { scanned: number; routes: number; rule1: number; rule2: number } {
  const m =
    /function shape \(widened [^)]*\): scanned (\d+) async functions, (\d+) route handlers; rule 1 baseline (\d+), rule 2 baseline (\d+)/.exec(
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
  const routes = Number(m![2]);
  expect(
    routes,
    `the route-handler scan saw only ${routes} handlers (floor ` +
      `${ROUTE_SCAN_FLOOR}, measured 2,668 on 2026-09-04). Route handlers are a ` +
      "SEPARATE population from async functions — on a route file every query " +
      "lives inside an inline `(req, res)` callback, so a handler extractor " +
      "that quietly stops resolving them leaves the busiest tenant surface in " +
      "the codebase unread while every other number on this line stays healthy. " +
      "Find out why, do NOT lower this floor.",
  ).toBeGreaterThan(ROUTE_SCAN_FLOOR);
  return { scanned, routes, rule1: Number(m![3]), rule2: Number(m![4]) };
}

describe("the tenancy lint covers the service layer", () => {
  it("walks server/services/**", () => {
    // The walk rooted at server/services when this assertion was written; on
    // 2026-09-04 it was widened to the whole server tree, so the ROOT is no
    // longer the thing to pin. The invariant it was defending is unchanged and
    // now stronger: the services tree must be INSIDE the scanned population,
    // and the walk must recurse into it. Re-pointed rather than deleted — a
    // cross-tenant KYC leak shipped from server/services while this walk did
    // not reach it.
    expect(
      src,
      "the walk no longer roots at the server tree, so services may have " +
        "fallen out of the population again.",
    ).toContain("const servicesDir = SERVER_DIR;");
    const at = src.indexOf("const servicesDir = SERVER_DIR;");
    expect(src.slice(at, at + 700), "the walk stopped recursing").toContain("stack.push(full)");
    // And services is not quietly excluded on the way down.
    const exAt = src.indexOf("const EXCLUDED_DIRS = new Set([");
    const exclusions = src.slice(exAt, src.indexOf("]);", exAt));
    for (const dir of ["services", "routes", "jobs", "ai"]) {
      expect(
        exclusions,
        `"${dir}" was added to EXCLUDED_DIRS — that removes a whole tenant ` +
          "surface from the population while every count on the verdict line " +
          "stays healthy. Excluding a directory is how this gate goes blind.",
      ).not.toContain(`"${dir}"`);
    }
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

  it("'read' means read — a note may not declare itself UNREAD and be counted", () => {
    // ── WHY ───────────────────────────────────────────────────────────────
    // The verdict line prints "<n> read, <m> NOT read", and the block that
    // computes it carries the comment "'Read' has to mean read, or the line is
    // worse than not printing it". The predicate under that comment was
    // "a _TRIAGED key exists" — presence of DOCUMENTATION, not presence of a
    // RULING. On 2026-09-05 a held entry whose note opened with the words
    // "UNREAD as of 2026-09-04" was counted among the read, and the line said
    // "272 read, 0 NOT read" over it.
    //
    // That is the fourth law with no daylight in it: the gate read its own
    // documentation as the property, and the documentation said the opposite of
    // the property. Fixing the comment would have changed nothing.
    const register = JSON.parse(
      fs.readFileSync(path.join(ROOT, "scripts/org-scope-route-widening.json"), "utf8"),
    ) as {
      rule1: { method: string[]; function: string[]; route: string[] };
      rule2: { method: string[]; function: string[]; route: string[] };
      rule3: string[];
      _TRIAGED: Record<string, string>;
    };
    const held = new Set([
      ...register.rule1.method, ...register.rule1.function, ...register.rule1.route,
      ...register.rule2.method, ...register.rule2.function, ...register.rule2.route,
      ...register.rule3,
    ]);
    expect(held.size, "the register is empty — this assertion would be vacuous").toBeGreaterThan(100);

    const selfDeclaredUnread = Object.entries(register._TRIAGED)
      .filter(([k, note]) => held.has(k) && /\bUNREAD\b/.test(note))
      .map(([k]) => k);
    expect(
      selfDeclaredUnread,
      "a HELD register entry carries a note that says UNREAD. Either read it and " +
        "write the ruling, or leave it out of _TRIAGED so the verdict line counts " +
        "it as unread — what it must not do is sit in both states at once.",
    ).toEqual([]);

    // And the gate must ENFORCE that, not merely happen to have no offender
    // today: with zero offenders, a predicate that ignores the note entirely
    // reads exactly like one that respects it.
    // Pinned on BOTH halves — the definition and the call inside the filter.
    // Falsifying this caught the first version: replacing only the definition
    // with `const _removed = null` left the call site behind, so a scan for the
    // identifier still matched while the property was gone. A name appearing
    // somewhere in a file is not the same claim as a name being USED where it
    // decides the answer.
    const gate = stripCommentsPreservingLines(src);
    expect(
      gate,
      "the read-count predicate's definition is gone.",
    ).toMatch(/const\s+declaresItselfUnread\s*=/);
    expect(
      gate,
      "the read count no longer CONSULTS the note. It reverted to counting any " +
        "key that has a _TRIAGED entry, which is presence of documentation rather " +
        "than presence of a ruling — the exact thing that let a note reading " +
        '"UNREAD as of 2026-09-04" be counted among the read.',
    ).toMatch(/!\s*declaresItselfUnread\s*\(\s*note\s*\)/);

    // A reason left behind for a key that is no longer held is drift: it makes
    // the file look more triaged than it is, and it is what left an "UNREAD"
    // note lying around long enough to be believed.
    const orphans = Object.keys(register._TRIAGED).filter((k) => !held.has(k));
    expect(
      orphans,
      "_TRIAGED reasons whose register key is gone — delete them with the key: " +
        orphans.join(", "),
    ).toEqual([]);
  });

  it("caps how much rule 2 the sanctioned hatch is allowed to silence", () => {
    const out = run();
    const m = /rule-2 predicates exempted as sanctioned-hatch roots: (\d+)/.exec(out);
    expect(
      m,
      "the hatch-exemption count is gone from the verdict. Rule 2 skips any " +
        "lone-id predicate rooted in unscopedForPlatformOps(...); if the gate " +
        "stops publishing how often it does that, the exemption becomes " +
        "unbounded and invisible in one edit. Re-point this, do not delete " +
        "it:\n" + out,
    ).not.toBeNull();
    expect(
      Number(m![1]),
      "MORE rule-2 predicates are being waived by the sanctioned hatch. Each " +
        "one is a cross-org read of a row by primary key. The hatch makes that " +
        "loud and logged, which is why it is allowed at all — it does not make " +
        "it free. Justify the new one in the diff, then raise this ceiling in " +
        "the same commit.",
    ).toBeLessThanOrEqual(HATCH_EXEMPTION_CEILING);
  });

  it("recognises the hatch when its REASON contains a semicolon", () => {
    // ── WHY THIS CANARY EXISTS ────────────────────────────────────────────
    // Both hatch lookbacks used `lastIndexOf(";", index)` to find the start of
    // the enclosing statement. The hatch takes a REASON SENTENCE, and a reason
    // containing a semicolon moved that "statement start" INTO the string — so
    // the lookback never reached `unscopedForPlatformOps(` and the gate flagged
    // the one form it exists to satisfy. Found the day it happened, on a real
    // reason: "…from their user id; there is no caller org to scope by".
    //
    // Silent, and in the direction that reads as a genuine finding — the author
    // is told to scope a query that is already declared, and the obvious next
    // move is to register it as debt instead. The boundary finder is string-
    // aware now, and this pins that: a semicolon inside the reason must not
    // change the verdict, and must not widen it either.
    const withSemicolonReason = [
      'import { db } from "../db";',
      'import { unscopedForPlatformOps } from "../utils/orgScopedDb";',
      'import { properties } from "@shared/schema";',
      'import { eq } from "drizzle-orm";',
      "",
      "export async function sweepAnyOrg(orgId: number, id: number) {",
      "  const [row] = await unscopedForPlatformOps(",
      '    "platform sweep resolves the row from an id; there is no caller org to scope by",',
      "  )",
      "    .select().from(properties).where(eq(properties.id, id)).limit(1);",
      "  return { row, orgId };",
      "}",
      "",
    ];

    const clean = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__hatch_semicolon_canary__.ts": withSemicolonReason.join("\n"),
    });
    expect(
      clean.out,
      "a semicolon inside the hatch's REASON hid the hatch from the gate. The " +
        "statement-boundary walker has gone back to lastIndexOf(';'), which " +
        "cannot tell a terminator from text inside a string:\n" + clean.out,
    ).not.toContain("sweepAnyOrg()");
    // Vacuity: the run must have read a real schema, or "not reported" means
    // nothing.
    expect(clean.out).toMatch(/org-scoped tables: [1-9]/);

    // …and the exemption is still STATEMENT-scoped, semicolon or not.
    const dirty = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__hatch_semicolon_canary__.ts": [
        ...withSemicolonReason.slice(0, -3),
        "  const [other] = await db",
        "    .select().from(properties).where(eq(properties.id, id)).limit(1);",
        "  return { row, other, orgId };",
        "}",
        "",
      ].join("\n"),
    });
    expect(
      dirty.failed,
      "a plain by-id read beside a semicolon-reason hatch call did not fail. " +
        "Teaching the boundary finder about strings must not have widened the " +
        "exemption past the one statement it belongs to:\n" + dirty.out,
    ).toBe(true);
    expect(dirty.out).toContain("sweepAnyOrg()");
  });

  it("exempts a by-id read ROOTED in the hatch, and still fails a plain one beside it", () => {
    // ── WHY THIS CANARY EXISTS ────────────────────────────────────────────
    // The exemption is the dangerous half of the 2026-09-04 change. Written
    // unit-scoped — "does this function mention unscopedForPlatformOps?" — it
    // would have turned one sanctioned call into a blanket waiver for every
    // other by-id read in the same function, which is precisely the shape rule
    // 2 exists to catch. It is written STATEMENT-scoped instead, and that is a
    // property no source scan of the gate can confirm. So: two trees, the same
    // hatch call, differing only by a plain `db.select()` beside it.
    const hatchOnly = [
      'import { db } from "../db";',
      'import { unscopedForPlatformOps } from "../utils/orgScopedDb";',
      'import { properties } from "@shared/schema";',
      'import { eq } from "drizzle-orm";',
      "",
      "export async function findOwnerAnyOrg(orgId: number, id: number) {",
      '  const [row] = await unscopedForPlatformOps("id collision probe across orgs")',
      "    .select().from(properties).where(eq(properties.id, id)).limit(1);",
      "  return { row, orgId };",
      "}",
      "",
    ];

    const clean = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__hatch_canary__.ts": hatchOnly.join("\n"),
    });
    expect(
      clean.out,
      "the sanctioned hatch tripped rule 2. Using the one loud, logged, " +
        "reason-carrying form the codebase offers must not be worse than " +
        "using a quiet one — that is how a hatch stops being used:\n" + clean.out,
    ).not.toContain("findOwnerAnyOrg()");
    expect(clean.out).toMatch(/exempted as sanctioned-hatch roots: [1-9]/);

    const dirty = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/services/__hatch_canary__.ts": [
        ...hatchOnly.slice(0, -3),
        "  const [other] = await db",
        "    .select().from(properties).where(eq(properties.id, id)).limit(1);",
        "  return { row, other, orgId };",
        "}",
        "",
      ].join("\n"),
    });
    expect(
      dirty.failed,
      "a PLAIN by-id read sitting beside a hatch call did not fail the gate. " +
        "The exemption has gone unit-scoped: one sanctioned call now waives " +
        "every unscoped lookup in the same function:\n" + dirty.out,
    ).toBe(true);
    expect(dirty.out).toContain("findOwnerAnyOrg()");
    // Vacuity: prove the difference is the plain read, not a tree the gate
    // failed to parse in the second run.
    expect(dirty.out).toMatch(/org-scoped tables: [1-9]/);
    expect(dirty.out).toMatch(/exempted as sanctioned-hatch roots: [1-9]/);
  });

  it("reads a table keyed on org_id, not only organization_id", () => {
    // ── WHY THIS CANARY EXISTS ────────────────────────────────────────────
    // `collectOrgScopedTableIdents` — the front door that decides which tables
    // are org-scoped at all — required the literal spelling
    // `organizationId: <col>("organization_id")` until 2026-09-04. This schema
    // keys 40 of its tables on `orgId: integer("org_id")`, and a unit whose
    // only org-table access was one of those reported "touches no org-scoped
    // table" and was skipped before rules 1, 2 AND 3 ever ran.
    //
    // "The regex still matches organization_id" and "the regex matches both"
    // are indistinguishable in a green run, which is why this is a fixture and
    // not a source scan. The unscoped fixture must be REPORTED and the scoped
    // one must NOT — a gate that flags both spellings unconditionally would
    // pass the first assertion while being useless.
    const ORGID_SCHEMA = [
      'import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";',
      'export const agentNotes = pgTable("agent_notes", {',
      '  id: serial("id").primaryKey(),',
      '  orgId: integer("org_id").notNull(),',
      '  topic: text("topic"),',
      "});",
      "",
    ].join("\n");

    const leaky = runOverFixture({
      "shared/schema.ts": ORGID_SCHEMA,
      "server/services/__orgid_canary__.ts": [
        'import { db } from "../db";',
        'import { agentNotes } from "@shared/schema";',
        'import { eq } from "drizzle-orm";',
        "",
        "export async function readEveryOrgsNotes(topic: string) {",
        "  return await db.select().from(agentNotes).where(eq(agentNotes.topic, topic));",
        "}",
        "",
      ].join("\n"),
    });
    expect(
      leaky.failed,
      "an unscoped read of a table keyed on org_id did not fail the gate. The " +
        "tenant-key detector has gone back to requiring `organization_id`, " +
        "which takes 40 tables out of the population before any rule runs:\n" +
        leaky.out,
    ).toBe(true);
    expect(leaky.out).toContain("readEveryOrgsNotes()");
    // Vacuity + the spelling actually counted, not merely a nonzero total.
    expect(leaky.out).toMatch(/org-scoped tables: [1-9]\d* \(organizationId 0, orgId [1-9]/);

    const scoped = runOverFixture({
      "shared/schema.ts": ORGID_SCHEMA,
      "server/services/__orgid_canary__.ts": [
        'import { db } from "../db";',
        'import { agentNotes } from "@shared/schema";',
        'import { and, eq } from "drizzle-orm";',
        "",
        "export async function readOneOrgsNotes(orgId: number, topic: string) {",
        "  return await db.select().from(agentNotes)",
        "    .where(and(eq(agentNotes.orgId, orgId), eq(agentNotes.topic, topic)));",
        "}",
        "",
      ].join("\n"),
    });
    expect(
      scoped.out,
      "a CORRECTLY scoped org_id query was reported. The detector would then " +
        "be flagging the spelling rather than the defect, and every one of the " +
        "40 org_id tables would read as an offender:\n" + scoped.out,
    ).not.toContain("readOneOrgsNotes()");
    expect(scoped.out).toMatch(/org-scoped tables: [1-9]\d* \(organizationId 0, orgId [1-9]/);
  });

  it("floors the org-scoped table population PER SPELLING", () => {
    // A single total cannot tell "both spellings are read" from "one is read
    // and the other silently stopped matching" — the latter prints a healthy
    // 364 while 40 tables leave the population, and every query against them
    // leaves all three rules with it. Measured 2026-09-04: 364 / 40.
    const out = run();
    const m =
      /org-scoped tables: (\d+) \(organizationId (\d+), orgId (\d+), org-FK-by-other-name (\d+)\)/.exec(
        out,
      );
    expect(
      m,
      "the per-spelling breakdown is gone from the verdict. Without it the " +
        "population is one number again and a dead tenant-key regex is " +
        "invisible. Re-point this, do not delete it:\n" + out,
    ).not.toBeNull();
    const [, total, canonical, orgIdCount, orgFk] = m!.map(Number) as unknown as number[];
    expect(
      canonical,
      "the `organization_id` tenant-key detector is reading far fewer tables " +
        "than the schema declares. Fix the detector — a shrinking population " +
        "reports itself as fewer offenders, which reads as progress.",
    ).toBeGreaterThan(270);
    expect(
      orgIdCount,
      "the `org_id` tenant-key detector has gone quiet. It was added on " +
        "2026-09-04 after 40 tables spent months outside this gate's " +
        "population; a drop here means they are outside it again.",
    ).toBeGreaterThan(28);
    expect(
      orgFk,
      "the NOT NULL org-FK arm has gone quiet. It is the only thing that sees " +
        "a tenant key named by ROLE — seller_organization_id and its siblings " +
        "on the three marketplace tables. Floor is 2 against a live 3 because " +
        "the member set is small; the point is that the arm cannot reach zero " +
        "unnoticed.",
    ).toBeGreaterThan(2);
    expect(total).toBe(canonical + orgIdCount + orgFk);
  });

  it("reads a tenant key named by ROLE, and ignores a nullable provenance FK", () => {
    // ── WHY THIS CANARY EXISTS ────────────────────────────────────────────
    // The marketplace keys its tables `seller_organization_id`,
    // `buyer_organization_id`, `bidder_organization_id`. No list of spellings
    // would ever have caught those, so the third detector arm asks the
    // SEMANTIC question instead: does a column carry a NOT NULL foreign key to
    // organizations.id?
    //
    // NOT NULL is the whole subtlety, and it is invisible in a green run. An
    // unconditioned FK arm also swallows `cached_lookups.first_fetched_by` and
    // `county_discovery_queue.first_requested_by` — nullable PROVENANCE columns
    // on a shared provider cache and a platform crawl queue, where cross-org
    // reads are the entire design. So this fixture pins BOTH directions: the
    // role-named NOT NULL key must be judged, and the nullable provenance FK
    // must not be.
    const ROLE_KEYED = [
      'import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";',
      'export const organizations = pgTable("organizations", {',
      '  id: serial("id").primaryKey(),',
      "});",
      'export const bazaarListings = pgTable("bazaar_listings", {',
      '  id: serial("id").primaryKey(),',
      '  sellerOrganizationId: integer("seller_organization_id").references(() => organizations.id).notNull(),',
      '  headline: text("headline"),',
      "});",
      'export const crawlQueue = pgTable("crawl_queue", {',
      '  id: serial("id").primaryKey(),',
      '  firstRequestedBy: integer("first_requested_by").references(() => organizations.id),',
      '  county: text("county"),',
      "});",
      "",
    ].join("\n");

    const res = runOverFixture({
      "shared/schema.ts": ROLE_KEYED,
      "server/services/__rolekey_canary__.ts": [
        'import { db } from "../db";',
        'import { bazaarListings, crawlQueue } from "@shared/schema";',
        'import { eq } from "drizzle-orm";',
        "",
        "export async function readEverySellersListings(headline: string) {",
        "  return await db.select().from(bazaarListings).where(eq(bazaarListings.headline, headline));",
        "}",
        "",
        "export async function readTheCrawlQueue(county: string) {",
        "  return await db.select().from(crawlQueue).where(eq(crawlQueue.county, county));",
        "}",
        "",
      ].join("\n"),
    });

    expect(
      res.failed,
      "an unscoped read of a table keyed on seller_organization_id did not " +
        "fail the gate. The org-FK arm has gone, and with it every table whose " +
        "tenant key is named by role:\n" + res.out,
    ).toBe(true);
    expect(res.out).toContain("readEverySellersListings()");
    expect(
      res.out,
      "a NULLABLE provenance FK was treated as a tenant key. `first_fetched_by` " +
        "and `first_requested_by` record who first ASKED, on a shared cache and " +
        "a platform crawl queue; judging them turns two correct designs into " +
        "permanent register entries:\n" + res.out,
    ).not.toContain("readTheCrawlQueue()");
    // Vacuity, per spelling: exactly one table was recognised, by the FK arm.
    expect(res.out).toMatch(
      /org-scoped tables: 1 \(organizationId 0, orgId 0, org-FK-by-other-name 1\)/,
    );
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

/**
 * ── THE ROUTE-HANDLER BOUNDARY ───────────────────────────────────────────────
 *
 * On a route file there is no `async function` to extract: every query lives
 * inside an inline `(req, res)` callback, so the UNIT the gate reads is the
 * handler, and reading the wrong span of text is the same as not reading it.
 *
 * The first version of the handler extractor was wrong in four ways at once,
 * and every one of them was silent — the verdict line printed a healthy route
 * count throughout:
 *
 *   1. It took "the LAST `async (` inside the registration call" as the
 *      handler. The call text spans the handler's whole body, so a nested
 *      `db.transaction(async (tx) => …)` sits later in the string and wins;
 *      the unit became the INNER callback and the outer body went unread.
 *      51 of 2,620 handlers under server/.
 *   2. It took "everything after the last depth-0 comma" as the final
 *      argument, and a multi-line Express registration usually ends `},\n);` —
 *      a TRAILING comma. 432 handlers resolved to whitespace and vanished.
 *   3. It required the final argument to be an inline function, so every
 *      handler registered through a wrapper — `asyncHandler(async (req, res)
 *      => …)` — was dropped. 40 more.
 *   4. It required the handler to be `async`, though an unawaited `db.select()`
 *      chain leaks exactly as much as an awaited one.
 *
 * Each canary below hides an unscoped cross-tenant read in ONE of those four
 * shapes. If a future "simplification" reintroduces any of them, the gate stops
 * reading that shape and these turn green — which is the whole failure mode.
 */
describe("the route-handler extractor reads the whole handler (boundary canaries)", () => {
  /** A registration whose handler body holds one scoped and one unscoped read. */
  function routeFixture(body: string): Record<string, string> {
    return {
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/routes-__canary__.ts": [
        'import { db } from "./db";',
        'import { properties } from "@shared/schema";',
        'import { eq, and, sql } from "drizzle-orm";',
        "",
        "export function registerCanary(api: any) {",
        body,
        "}",
        "",
      ].join("\n"),
    };
  }

  /** The leak every fixture hides, indented to sit inside a handler body. */
  const LEAK = [
    "      const leaked = await db.select().from(properties)",
    "        .where(and(sql`LOWER(${properties.state}) = LOWER('TX')`));",
    "      res.json(leaked);",
  ].join("\n");

  function expectCaught(out: string, failed: boolean, route: string, why: string) {
    expect(failed, `${why}\nThe lint exited ZERO with a cross-tenant read in the tree:\n${out}`).toBe(true);
    // The route must be named as an OFFENDER, not merely mentioned. Without
    // this the canary passes vacuously: a registration the walk cannot close
    // is printed on the "could not be located" line, AND its leak is still
    // caught against the enclosing registrar function — so `out` contains the
    // route string and the lint is red, while the handler itself was never
    // read. That is the exact failure these canaries exist to detect, and it
    // is what the first version of this helper let through.
    expect(
      out,
      `${why}\nThe route is NOT reported as an offender:\n${out}`,
    ).toMatch(new RegExp(`(\\[route\\][^\\n]*|\\s\\s)${route.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}\\(\\)`));
    expect(
      out,
      `${why}\nThe registration could not be read at all, so nothing about its ` +
        `body was checked:\n${out}`,
    ).toContain("declarations whose body could not be located: 0");
    expect(out).not.toContain("[check-org-scoped-fetch] PASS");
    // Vacuity: a tree the gate could not parse would also produce "no PASS".
    expect(out, "the fixture's org-scoped table was not recognised").toMatch(/org-scoped tables: [1-9]/);
    expect(out, "no route handler was read at all, so this proves nothing").toMatch(
      /scanned \d+ async functions, [1-9]\d* route handlers/,
    );
  }

  it("catches a leak in a handler that also contains a NESTED async callback", () => {
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          '  api.get("/api/__canary_nested/:id", async (req: any, res: any) => {',
          "    await db.transaction(async (tx: any) => {",
          "      await tx.select().from(properties)",
          "        .where(eq(properties.organizationId, req.organizationId));",
          "    });",
          LEAK,
          "  });",
        ].join("\n"),
      ),
    );
    expectCaught(
      out,
      failed,
      "GET /api/__canary_nested/:id",
      "The extractor picked the NESTED async callback as the unit, so the " +
        "outer handler body — where the leak is — was never read. This is the " +
        "defect that hid 51 handlers.",
    );
  });

  it("catches a leak in a handler registered with a TRAILING comma", () => {
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          "  api.get(",
          '    "/api/__canary_trailing/:id",',
          "    async (req: any, res: any) => {",
          LEAK,
          "    },",
          "  );",
        ].join("\n"),
      ),
    );
    expectCaught(
      out,
      failed,
      "GET /api/__canary_trailing/:id",
      "The final argument resolved to the whitespace AFTER the trailing comma, " +
        "so the handler was dropped from the population without a word. This " +
        "is the defect that hid 432 handlers.",
    );
  });

  it("catches a leak in a handler wrapped in asyncHandler(...)", () => {
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          '  api.get("/api/__canary_wrapped/:id", asyncHandler(async (req: any, res: any) => {',
          LEAK,
          "  }));",
        ].join("\n"),
      ),
    );
    expectCaught(
      out,
      failed,
      "GET /api/__canary_wrapped/:id",
      "The handler sits inside a wrapper call, so the final argument was not " +
        "an inline function and the route was skipped. This is the defect that " +
        "hid 40 handlers.",
    );
  });

  it("catches a leak in a SYNCHRONOUS handler", () => {
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          '  api.get("/api/__canary_sync/:id", (req: any, res: any) => {',
          "    const leaked = db.select().from(properties)",
          "      .where(and(sql`LOWER(${properties.state}) = LOWER('TX')`));",
          "    leaked.then((rows: any) => res.json(rows));",
          "  });",
        ].join("\n"),
      ),
    );
    expectCaught(
      out,
      failed,
      "GET /api/__canary_sync/:id",
      "The handler was skipped for not being `async`. An unawaited query chain " +
        "reads exactly as many rows as an awaited one — `async` is not a " +
        "security property.",
    );
  });

  it("still reads a query written DIRECTLY in the registrar, outside every handler", () => {
    // Queries are attributed to their INNERMOST unit, so a route handler's
    // body is masked out of the enclosing registrar's text — otherwise every
    // finding in a route file is reported twice, once against a 1,400-line
    // function whose name tells a reader nothing (9 such duplicates existed
    // on 2026-09-04). The risk of that masking is the opposite error: blanking
    // too much and losing the registrar's OWN queries. This pins that it does
    // not.
    const { out, failed } = runOverFixture({
      "shared/schema.ts": FIXTURE_SCHEMA,
      "server/routes-__registrar_canary__.ts": [
        'import { db } from "./db";',
        'import { properties } from "@shared/schema";',
        'import { eq, and, sql } from "drizzle-orm";',
        "",
        "export async function registerRegistrarCanaryRoutes(api: any, organizationId: number) {",
        "  const scoped = await db.select().from(properties)",
        "    .where(eq(properties.organizationId, organizationId));",
        '  api.get("/api/__registrar_child/:id", async (req: any, res: any) => {',
        "    const inner = await db.select().from(properties)",
        "      .where(eq(properties.organizationId, req.organizationId));",
        "    res.json(inner);",
        "  });",
        "  // Directly in the registrar body, outside every handler.",
        "  const leaked = await db.select().from(properties)",
        "    .where(and(sql`LOWER(${properties.state}) = LOWER('TX')`));",
        "  return { scoped, leaked };",
        "}",
        "",
      ].join("\n"),
    });
    expect(
      failed,
      "masking the nested handler out of the registrar also blanked the " +
        "registrar's own unscoped query, so a whole class of read became " +
        `invisible:\n${out}`,
    ).toBe(true);
    expect(out).toContain("registerRegistrarCanaryRoutes");
    // And the handler inside it is still a unit of its own, not folded in.
    expect(out, "the nested handler was not read as its own unit").toMatch(
      /scanned \d+ async functions, [1-9]\d* route handlers/,
    );
  });

  it("no route shape the extractor does not read carries a query (population guard)", () => {
    // ROUTE_VERBS is get|post|put|patch|delete|options|head|all — `use` is
    // deliberately absent, because `app.use(path, router)` mounts a router and
    // `app.use(path, namedMiddleware)` hands off to a declaration the
    // async-function extractor already reads.
    //
    // That is a POPULATION decision, and a population decision is invisible in
    // a green result. It holds only while nobody writes `app.use("/x", async
    // (req, res) => { …a query… })`. Measured 2026-09-04: zero such handlers
    // exist. This assertion is what makes writing the FIRST one fail here
    // rather than pass everywhere.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (!["node_modules", "__tests__", "__mocks__", "public", "dist"].includes(e.name)) walk(rel);
        } else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) files.push(rel);
      }
    };
    walk("server");
    expect(files.length, "the walk found no server files, so this proves nothing").toBeGreaterThan(300);

    // The call must be bounded by REAL paren matching. A regex that scans a
    // fixed window past `app.use(` runs off the end of the call and matches
    // `async (` plus a query from unrelated code further down the file — which
    // is exactly what the first version of this assertion did, reporting
    // `app.use('/api/founder/vendor-status', …, vendorStatusRouter)` (a plain
    // router mount) as an inline handler with a query in it.
    const matchParen = (src: string, open: number): number => {
      let depth = 0;
      let quote: string | null = null;
      let prev = "";
      for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
          if (ch === quote && prev !== "\\") quote = null;
        } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) return i;
        }
        prev = ch;
      }
      return -1;
    };

    const offenders: string[] = [];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const re = /\b[A-Za-z_$][\w$]*\.use\s*\(\s*["'`](\/[^"'`]*)["'`]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const open = src.indexOf("(", m.index);
        const close = matchParen(src, open);
        if (close === -1) continue;
        const call = src.slice(open, close + 1);
        re.lastIndex = open;
        if (!/async\s*\(/.test(call)) continue;
        if (!/\.(select|insert|update|delete)\s*\(|db\.query\./.test(call)) continue;
        offenders.push(`${rel} — app.use("${m[1]}", …)`);
      }
    }
    expect(
      offenders,
      "A query now lives inside an inline `app.use(path, async (req, res) => …)` " +
        "handler. `use` is NOT in ROUTE_VERBS, so the tenancy lint does not read " +
        "these — the handler is outside the population entirely and no rule can " +
        "fire on it. Add \"use\" to ROUTE_VERBS in " +
        "scripts/check-org-scoped-fetch.mjs (and re-run to pick up whatever it " +
        "then finds), or move the query into a named handler.",
    ).toEqual([]);
  });

  it("reads every declaration in the repository, including the deeply nested ones", () => {
    // A `${…}` hole holds arbitrary code, including MORE template literals.
    // Treating a backtick as a plain quote closes the OUTER template on an
    // INNER one, after which every brace and paren sits at the wrong nesting
    // and the enclosing registration never closes — so the declaration leaves
    // the population with no message at all.
    //
    // This is pinned against the REAL repository rather than a fixture on
    // purpose. The shapes that actually broke the walk are emergent — several
    // templates and regexes interacting across hundreds of lines — and a
    // hand-built fixture that "looks nested" balances by luck and proves
    // nothing. What is checkable, and is exactly the property that matters, is
    // that NO declaration in this repository is unreadable.
    //
    // Measured 2026-09-04: four registrations were being dropped this way,
    // silently. One of them was `POST /api/founder/escalations/:id/generate-
    // prompt`, whose prompt builder nests three deep. Worse, the same class of
    // desynchronisation hid `executeSupportTool` in server/ai/supportAgent.ts
    // — a 91-case dispatch a model drives while talking to a paying customer,
    // which this gate had NEVER read. Reading it found four cross-org reads of
    // support_resolution_history.
    const out = run();
    const m = /declarations whose body could not be located: (\d+)/.exec(out);
    expect(m, `the coverage line is gone or changed shape:\n${out}`).not.toBeNull();
    expect(
      Number(m![1]),
      "A declaration in this repository cannot be read, so this gate says " +
        "NOTHING about it — no rule can fire on a unit that is not in the " +
        "population, and the verdict line stays healthy either way. Find out " +
        "which construct the walk desynchronises on (nested template literals, " +
        "regex literals holding a quote, and postfix `!`/`++` before a division " +
        "are the three that have done it) rather than accepting the number.",
    ).toBe(0);
  });

  it("reads the specific real declarations that only parse with nesting support", () => {
    // The zero above is a population claim; these are the two members that
    // establish it is not zero-by-luck. Both were unreadable until 2026-09-04
    // and both are consequential: a model-driven tool switch and a founder
    // route that reads tickets across tenants.
    const out = run();
    for (const name of [
      "server/ai/supportAgent.ts::executeSupportTool",
      "server/routes-support-tickets.ts::POST /api/founder/escalations/:id/generate-prompt",
    ]) {
      expect(
        out,
        `${name} is not being read: it is in the route-widening register, so if ` +
          "the walk could not reach it the register would report it stale. A " +
          "stale count above zero here means the tokenizer regressed.",
      ).not.toContain(`  - ${name}`);
    }
    expect(out, "the widening register reported stale entries").toMatch(
      /route-widening debt register[^\n]*0 stale/,
    );
  });

  it("reads a handler whose body holds a regex literal containing quotes", () => {
    // `s.replace(/[<>&'\"]/g, …)` — real code, in
    // server/routes-founder-letters.ts. Read as a string, the apostrophe
    // opened a quote that ran to the next apostrophe anywhere in the file.
    // maskComments had the same bug, so one regex literal could put an
    // arbitrary amount of a file outside the population, and every extractor
    // reads maskComments' output.
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          '  api.get("/api/__canary_regex/:id", async (req: any, res: any) => {',
          "    const esc = (v: string) => v.replace(/[<>&'\"]/g, \"_\");",
          "    void esc(String(req.params.id));",
          LEAK,
          "  });",
        ].join("\n"),
      ),
    );
    expectCaught(
      out,
      failed,
      "GET /api/__canary_regex/:id",
      "A regex literal holding a quote desynchronised the walk, so the handler " +
        "left the population.",
    );
  });

  it("does not mistake a division for a regex (postfix ! and ++)", () => {
    // The regex-vs-division rule is what makes the two canaries above possible,
    // and getting it wrong fails in the other direction: `cac.cacUsd! / n` has
    // a TypeScript non-null assertion before the slash, and reading that `!` as
    // a prefix operator turned the division into a regex literal that swallowed
    // the rest of the handler. Same for `i++ / 2`.
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          '  api.get("/api/__canary_division/:id", async (req: any, res: any) => {',
          "    const n: number | null = 7;",
          "    let i = 2;",
          "    const a = Math.round((n! / 3) * 10) / 10;",
          "    const b = i++ / 2;",
          '    const c = "quote \' here";',
          "    void a; void b; void c;",
          LEAK,
          "  });",
        ].join("\n"),
      ),
    );
    expectCaught(
      out,
      failed,
      "GET /api/__canary_division/:id",
      "A division was read as a regex literal, which swallowed the rest of the " +
        "handler including its unscoped query.",
    );
  });

  it("a correctly-scoped route fixture PASSES — these canaries are not 'any route fails'", () => {
    const { out, failed } = runOverFixture(
      routeFixture(
        [
          "  api.get(",
          '    "/api/__canary_clean/:id",',
          "    asyncHandler(async (req: any, res: any) => {",
          "      const rows = await db.select().from(properties)",
          "        .where(eq(properties.organizationId, req.organizationId));",
          "      res.json(rows);",
          "    }),",
          "  );",
        ].join("\n"),
      ),
    );
    expect(failed, `a correctly-scoped route fixture was rejected:\n${out}`).toBe(false);
    expect(out, "the fixture ran without the gate seeing its table").toMatch(/org-scoped tables: [1-9]/);
    expect(out, "the clean fixture's handler was not read either").toMatch(
      /scanned \d+ async functions, [1-9]\d* route handlers/,
    );
  });
});

describe("rule 3 reads BOTH of Drizzle's query spellings", () => {
  // One canary per spelling. The walker keyed on `.from(` alone, so every
  // `db.query.<table>.findMany` in the repo — 280 of them — was outside the
  // population; "the regex still matches `.from(`" and "the regex matches
  // both" are indistinguishable in a green run, so each shape gets its own
  // fixture with the defect hidden inside it.
  for (const { id, query } of CHAIN_SPELLINGS) {
    it(`catches an unscoped ${id}`, () => {
      const { out, failed } = runOverFixture({
        "shared/schema.ts": FIXTURE_SCHEMA,
        "server/services/probe.ts": [
          'import { db } from "../db";',
          'import { eq } from "drizzle-orm";',
          'import { properties } from "@shared/schema";',
          "",
          "export async function readOne(organizationId: number, st: string) {",
          "  // The unit HAS an organization — that is what makes this rule 3 and",
          "  // not rule 1 — and the query below does not name it.",
          "  void organizationId;",
          `  return ${query}`,
          "}",
          "",
        ].join("\n"),
      });
      expect(
        failed,
        `an unscoped ${id} did not fail the gate — this spelling is outside ` +
          `the population rule 3 reads:\n${out}`,
      ).toBe(true);
      expect(out).toContain("readOne");
    });
  }

  it("and passes each spelling when the organization IS named", () => {
    // The other half: a gate that fails on everything is no more useful than
    // one that fails on nothing.
    for (const { id, query } of CHAIN_SPELLINGS) {
      const scoped = query.replace(
        /eq\(properties\.state, st\)/,
        "and(eq(properties.organizationId, organizationId), eq(properties.state, st))",
      );
      const { out, failed } = runOverFixture({
        "shared/schema.ts": FIXTURE_SCHEMA,
        "server/services/probe.ts": [
          'import { db } from "../db";',
          'import { and, eq } from "drizzle-orm";',
          'import { properties } from "@shared/schema";',
          "",
          "export async function readOne(organizationId: number, st: string) {",
          `  return ${scoped}`,
          "}",
          "",
        ].join("\n"),
      });
      expect(failed, `a correctly scoped ${id} was reported as an offender:\n${out}`).toBe(false);
    }
  });
});

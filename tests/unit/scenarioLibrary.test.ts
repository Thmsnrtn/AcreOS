/**
 * Wave S · S4 — the scenario library as EXECUTABLE DOCTRINE.
 *
 * Pins:
 *   1. DERIVATION RULES — every seeded row passes them, and a row naming a
 *      nonexistent sense / charter / runbook / pager job fails BY NAME
 *      (negative fixtures prove the rules bite, not just that the seeds
 *      happen to pass). File-truth checks (runbook refs on disk, builtin
 *      module+symbol, event literals, pager modules) run here against the
 *      repo — the same resolution idea as scripts/check-runbook-links.mjs.
 *   2. LEGAL LETTER — always page + counsel path, autonomyRequired
 *      "founder-only", trigger honestly human-observed. No staff autonomy,
 *      ever.
 *   3. NOT A GRANT — autonomyRequired is a declared requirement: the module
 *      exports no setter, imports no autonomy mutator, touches no db, and
 *      every autonomyRequired value is a real ladder level or "founder-only".
 *   4. MODEL-PROVIDER OUTAGE — the row exists, cites the deterministic
 *      floor, and its playbook is the floor itself (decide.ts rankMoves).
 *   5. DRILL DERIVATION — lastDrilled comes from ledger blocks or is null
 *      ("never drilled"), never invented; drillsDue derives from cadence +
 *      age; today NO row maps to a ledger, and the suite says so.
 *   6. PAGER HONESTY — every "page" row names a real paging path or an
 *      explicit declared-gap; the declared-gap count is pinned and may only
 *      shrink.
 *   7. SURFACE PINS — founder endpoint in routes-autopilot.ts, the
 *      Scenarios tab on the Story door, and the component's honest wording.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// scenarioLibrary imports the charter registry, which imports the db and the
// real hands registry (thin adapters over these services) — mock the module
// boundary exactly as staffCharters.test.ts does. Nothing in THIS suite ever
// awaits a db chain; the mock only has to be importable.
vi.mock("../../server/db", () => {
  const chain: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "groupBy", "innerJoin", "leftJoin"]) {
    chain[m] = () => chain;
  }
  chain.then = (res: any, rej: any) => Promise.resolve([]).then(res, rej);
  return { db: { ...chain, update: () => ({ set: () => ({ where: () => Promise.resolve() }) }), insert: () => ({ values: () => Promise.resolve() }) } };
});
vi.mock("../../server/services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../../server/services/emailSuppressions", () => ({ filterSuppressed: vi.fn() }));
vi.mock("../../server/services/smsService", () => ({ sendSMSToLead: vi.fn() }));
vi.mock("../../server/services/mailProvider", () => ({ sendLetter: vi.fn() }));
vi.mock("../../server/services/pushNotificationService", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../../server/services/dunning", () => ({ dunningService: {} }));

import * as lib from "../../server/services/autopilot/scenarioLibrary";
import {
  SCENARIO_LIBRARY,
  SCENARIO_DRILL_LEDGERS,
  validateScenarioRow,
  validateScenarioLibrary,
  deriveScenarioView,
  scenarioDrillDue,
  parseLedgerDrillDates,
  getScenarioLibrary,
  QUARTERLY_DRILL_STALE_DAYS,
  ANNUAL_DRILL_STALE_DAYS,
  type ScenarioRow,
} from "../../server/services/autopilot/scenarioLibrary";
import { SENSE_INVENTORY, senseIsWired } from "../../server/services/autopilot/senses";
import { DOMAIN_AUTONOMY_LEVELS } from "../../server/services/autopilot/domainAutonomy";
import { JOB_ROSTER, resolveFailureLane } from "../../server/jobs/jobRegistry";

const bySlug = (key: string): ScenarioRow => {
  const row = SCENARIO_LIBRARY.find((r) => r.key === key);
  expect(row, `seeded row "${key}" is missing`).toBeTruthy();
  return row!;
};

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// ─── 1. Derivation rules — the matrix is checkable, not prose ───────────────

describe("derivation rules — every seeded row passes, and bad rows fail by name", () => {
  it("the Addendum C seed set is present (every named scenario, no duplicates)", () => {
    const keys = SCENARIO_LIBRARY.map((r) => r.key);
    for (const expected of [
      "sev-incident",
      "support-surge",
      "deliverability-spike",
      "failed-payment-wave",
      "churn-cluster",
      "trial-ending-cohort",
      "vendor-key-lapse",
      "legal-letter",
      "abuse-event",
      "model-provider-outage",
      "data-breach",
      "growth-opportunity",
      "constitution-trigger",
      "founder-shop-day",
      "founder-vacation",
      "panic-stop-resume",
      "gate-tamper",
    ]) {
      expect(keys, `seed row "${expected}" missing`).toContain(expected);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every seeded row passes the structural rules (violations name the row)", () => {
    for (const row of SCENARIO_LIBRARY) {
      expect(validateScenarioRow(row), `row "${row.key}"`).toEqual([]);
    }
    expect(validateScenarioLibrary()).toEqual([]);
  });

  it("every sense trigger resolves in SENSE_INVENTORY and its wired state is DERIVED, not asserted", () => {
    const known = new Set(SENSE_INVENTORY.map((s) => s.key));
    const now = new Date();
    for (const row of SCENARIO_LIBRARY) {
      if (row.trigger.kind !== "sense") continue;
      expect(known.has(row.trigger.senseKey), `${row.key}: unknown sense "${row.trigger.senseKey}"`).toBe(true);
      const view = deriveScenarioView(row, { now, ledgerDates: () => null });
      expect(view.triggerWired, `${row.key}: triggerWired must equal senseIsWired`).toBe(
        senseIsWired(row.trigger.senseKey),
      );
      expect(view.triggerEvidence, `${row.key}: sense rows claim sense-grade evidence`).toBe(
        "sense-consumed",
      );
    }
  });

  it("an EVENT row never borrows sense-grade evidence — the badge cannot overclaim", () => {
    // Fleet-8 verifier note: event rows derive triggerWired:true from a
    // verified literal alone, which proves the emitter EXISTS, not that it
    // is enabled or reached. The evidence field keeps that distinction, and
    // the Story badge renders it separately ("event kind verified").
    const now = new Date();
    for (const row of SCENARIO_LIBRARY) {
      const view = deriveScenarioView(row, { now, ledgerDates: () => null });
      if (row.trigger.kind === "event") {
        expect(view.triggerEvidence, `${row.key}: event rows must be event-literal`).toBe(
          "event-literal",
        );
      }
      if (row.trigger.kind === "human") {
        expect(view.triggerEvidence, `${row.key}: human rows must be human`).toBe("human");
        expect(view.triggerWired, `${row.key}: human rows are never wired`).toBe(false);
      }
    }
    // And the surface renders the three states distinctly — no event row may
    // paint the strong "trigger wired" badge.
    const matrix = read("client/src/components/founder/ScenarioMatrix.tsx");
    expect(matrix).toContain('s.triggerEvidence === "event-literal"');
    expect(matrix).toContain("event kind verified");
  });

  it("every event trigger's literal greps verbatim in its named module (a retired event kind fails by name)", () => {
    for (const row of SCENARIO_LIBRARY) {
      if (row.trigger.kind !== "event") continue;
      expect(exists(row.trigger.module), `${row.key}: trigger module ${row.trigger.module} does not exist`).toBe(true);
      expect(
        read(row.trigger.module).includes(row.trigger.literal),
        `${row.key}: literal "${row.trigger.literal}" not found in ${row.trigger.module}`,
      ).toBe(true);
    }
  });

  it("every runbook ref is a real docs/runbooks file; every builtin playbook's symbol appears in its module", () => {
    for (const row of SCENARIO_LIBRARY) {
      if (row.playbook.kind === "runbook") {
        expect(exists(row.playbook.ref), `${row.key}: runbook ${row.playbook.ref} does not exist on disk`).toBe(true);
      }
      if (row.playbook.kind === "builtin") {
        expect(exists(row.playbook.module), `${row.key}: playbook module ${row.playbook.module} does not exist`).toBe(true);
        expect(
          read(row.playbook.module).includes(row.playbook.symbol),
          `${row.key}: symbol "${row.playbook.symbol}" not found in ${row.playbook.module}`,
        ).toBe(true);
      }
    }
  });

  it("a row naming a nonexistent sense fails BY NAME", () => {
    const bad: ScenarioRow = {
      ...bySlug("support-surge"),
      key: "bad-sense",
      trigger: { kind: "sense", senseKey: "sixth_sense", description: "a sense that does not exist anywhere" },
    };
    const violations = validateScenarioRow(bad);
    expect(violations.some((v) => v.includes("sixth_sense") && v.includes("bad-sense"))).toBe(true);
  });

  it("a row naming a nonexistent charter fails BY NAME", () => {
    const bad = { ...bySlug("support-surge"), key: "bad-charter", responsibleCharter: "vibes" } as unknown as ScenarioRow;
    const violations = validateScenarioRow(bad);
    expect(violations.some((v) => v.includes("vibes") && v.includes("bad-charter"))).toBe(true);
  });

  it('a "page" row with no pager wiring fails; a pager job that does not resolve to the page lane fails by lane', () => {
    const base = bySlug("sev-incident");
    const noWire: ScenarioRow = { ...base, key: "bad-nowire", pagerWiring: undefined };
    expect(validateScenarioRow(noWire).some((v) => v.includes("requires pagerWiring"))).toBe(true);

    // "digest" is a real roster entry that resolves to "queue", not "page".
    const digest = JOB_ROSTER.find((j) => j.name === "digest")!;
    expect(resolveFailureLane(digest)).not.toBe("page");
    const wrongLane: ScenarioRow = { ...base, key: "bad-lane", pagerWiring: { kind: "critical-job", jobName: "digest" } };
    expect(validateScenarioRow(wrongLane).some((v) => v.includes('"digest"') && v.includes('not "page"'))).toBe(true);

    const ghostJob: ScenarioRow = { ...base, key: "bad-job", pagerWiring: { kind: "critical-job", jobName: "no_such_job" } };
    expect(validateScenarioRow(ghostJob).some((v) => v.includes("no_such_job") && v.includes("not in the job roster"))).toBe(true);
  });

  it("every wired pager path is real: critical jobs resolve to the page lane, pager modules contain their symbol", () => {
    for (const row of SCENARIO_LIBRARY) {
      if (!row.pagerWiring) continue;
      if (row.pagerWiring.kind === "critical-job") {
        const entry = JOB_ROSTER.find((j) => j.name === (row.pagerWiring as { jobName: string }).jobName);
        expect(entry, `${row.key}: pager job missing from roster`).toBeTruthy();
        expect(resolveFailureLane(entry!), `${row.key}: pager job lane`).toBe("page");
      }
      if (row.pagerWiring.kind === "module") {
        const { module, symbol } = row.pagerWiring;
        expect(exists(module), `${row.key}: pager module ${module} does not exist`).toBe(true);
        expect(read(module).includes(symbol), `${row.key}: pager symbol "${symbol}" not in ${module}`).toBe(true);
      }
    }
  });
});

// ─── 2. The legal-letter row — always page + counsel, founder-only forever ──

describe("legal letter / subpoena — no staff autonomy, ever", () => {
  const row = bySlug("legal-letter");

  it("is founder-only, pages, and belongs to the compliance charter", () => {
    expect(row.autonomyRequired).toBe("founder-only");
    expect(row.founderTouch).toBe("page");
    expect(row.responsibleCharter).toBe("compliance");
  });

  it("names the counsel path and is honest that no machine sense exists", () => {
    expect(row.notes ?? "").toMatch(/counsel/i);
    expect(row.trigger.kind).toBe("human");
    // The page rule has no machine wire today — declared, never pretended.
    expect(row.pagerWiring?.kind).toBe("declared-gap");
  });
});

// ─── 3. Not a grant — the matrix declares requirements, it moves nothing ────

describe("autonomyRequired is a declared requirement, never a grant", () => {
  const src = read("server/services/autopilot/scenarioLibrary.ts");

  it("the module imports no autonomy mutator and writes no state", () => {
    // The only domainAutonomy import is the levels constant + the level type.
    expect(src).toContain('import { DOMAIN_AUTONOMY_LEVELS, type DomainAutonomyLevel } from "./domainAutonomy"');
    for (const forbidden of ["setDomainLevel", "recordCleanCycle", "requestPromotion", "panicStop(", "resumeStage("]) {
      expect(src.includes(forbidden), `scenarioLibrary.ts must not touch ${forbidden}`).toBe(false);
    }
    // No db import — the module is config + pure derivation + a ledger read.
    expect(/from ["']\.\.\/\.\.\/db["']/.test(src)).toBe(false);
    expect(/from ["']drizzle-orm["']/.test(src)).toBe(false);
  });

  it("exports no setter-shaped symbol", () => {
    for (const name of Object.keys(lib)) {
      expect(/^(set|grant|promote|apply|update|write)/i.test(name), `export "${name}" looks like a mutator`).toBe(false);
    }
  });

  it("every autonomyRequired value is a real ladder level or founder-only", () => {
    const legal = new Set<string>([...DOMAIN_AUTONOMY_LEVELS, "founder-only"]);
    for (const row of SCENARIO_LIBRARY) {
      expect(legal.has(row.autonomyRequired), `${row.key}: "${row.autonomyRequired}"`).toBe(true);
    }
  });
});

// ─── 4. Model-provider outage — the drill the architecture uniquely earns ───

describe("model-provider outage — the deterministic floor survives it", () => {
  const row = bySlug("model-provider-outage");

  it("cites the deterministic floor and the reflex layer as the survival mechanism", () => {
    expect(`${row.trigger.description} ${row.notes ?? ""}`).toMatch(/deterministic floor/i);
    expect(row.notes ?? "").toMatch(/reflexes/i);
  });

  it("its playbook IS the floor (decide.ts rankMoves — rules, no model call) and it needs no new autonomy", () => {
    expect(row.playbook).toEqual({
      kind: "builtin",
      module: "server/services/autopilot/decide.ts",
      symbol: "rankMoves",
    });
    expect(row.autonomyRequired).toBe("observe");
  });

  it("carries the quarterly drill cadence and is honestly due (never drilled yet)", async () => {
    expect(row.drillCadence).toBe("quarterly");
    const { scenarios } = await getScenarioLibrary();
    const view = scenarios.find((s) => s.key === row.key)!;
    expect(view.lastDrilled).toBeNull();
    expect(view.drillDue).toBe(true);
  });
});

// ─── 5. Drill derivation — ledger-backed or null, never invented ────────────

describe("lastDrilled + drills-due derivation", () => {
  it("parseLedgerDrillDates: the YYYY-MM-DD format template never counts; real blocks do", () => {
    const template = "Format:\n\n```\nYYYY-MM-DD  ran-by=<github-login>\n```\n\n(no drills recorded yet)\n";
    expect(parseLedgerDrillDates(template)).toEqual([]);
    const real = template + `\n2026-05-01  ran-by=thmsnrtn\n2026-07-01  ran-by=thmsnrtn\n`;
    expect(parseLedgerDrillDates(real)).toEqual(["2026-05-01", "2026-07-01"]);
  });

  it("scenarioDrillDue: cadence math (quarterly 100d, annual 380d, on-change = ever-walked, null = never due)", () => {
    const now = new Date();
    expect(QUARTERLY_DRILL_STALE_DAYS).toBe(100); // mirrors the DR-drill ratchet's bound
    expect(ANNUAL_DRILL_STALE_DAYS).toBe(380);
    expect(scenarioDrillDue("quarterly", isoDaysAgo(30), now)).toBe(false);
    expect(scenarioDrillDue("quarterly", isoDaysAgo(120), now)).toBe(true);
    expect(scenarioDrillDue("quarterly", null, now)).toBe(true);
    expect(scenarioDrillDue("annual", isoDaysAgo(200), now)).toBe(false);
    expect(scenarioDrillDue("annual", isoDaysAgo(400), now)).toBe(true);
    expect(scenarioDrillDue("on-change", null, now)).toBe(true);
    expect(scenarioDrillDue("on-change", isoDaysAgo(500), now)).toBe(false);
    expect(scenarioDrillDue(null, null, now)).toBe(false);
  });

  it("deriveScenarioView takes lastDrilled from the newest ledger block when a row maps to one", () => {
    const fixture: ScenarioRow = {
      ...bySlug("panic-stop-resume"),
      key: "fixture-drilled",
      drillLedger: SCENARIO_DRILL_LEDGERS[0],
    };
    const view = deriveScenarioView(fixture, {
      now: new Date(),
      ledgerDates: () => ["2026-05-01", isoDaysAgo(20)],
    });
    expect(view.lastDrilled).toBe(isoDaysAgo(20));
    expect(view.drillDue).toBe(false);
    // An unreadable ledger degrades to the honest null, never a guess.
    const dark = deriveScenarioView(fixture, { now: new Date(), ledgerDates: () => null });
    expect(dark.lastDrilled).toBeNull();
    expect(dark.drillDue).toBe(true);
  });

  it("CURRENT TRUTH: no seeded row maps to a drill ledger yet — every row is honestly never-drilled, and drillsDue derives from that", async () => {
    // The only block-bearing ledger today (dr-drill-history.md) records the
    // DB-restore drill specifically, which is not a scenario row; the F6
    // game-day ledger does not exist yet. When it lands, map rows to it and
    // REWRITE this pin to the new truth (wave discipline #4) — never delete it.
    for (const row of SCENARIO_LIBRARY) {
      expect(row.drillLedger, `${row.key}: drillLedger`).toBeNull();
    }
    const payload = await getScenarioLibrary();
    for (const s of payload.scenarios) {
      expect(s.lastDrilled, `${s.key}: lastDrilled must be null (no ledger maps)`).toBeNull();
    }
    const cadenceRows = payload.scenarios.filter((s) => s.drillCadence !== null);
    expect(cadenceRows.length).toBeGreaterThan(0);
    expect(payload.drillsDue).toBe(cadenceRows.length); // never-drilled ⇒ every cadence row is due
  });
});

// ─── 6. Pager honesty — declared gaps are visible and pinned ────────────────

describe("page rows without a pager wire are counted, not hidden", () => {
  it("the declared-gap count is exactly 2 (legal-letter, data-breach) — it may only SHRINK; wiring a pager lowers it in the same change", async () => {
    const payload = await getScenarioLibrary();
    const gaps = payload.scenarios.filter((s) => s.pagerState === "declared-not-wired").map((s) => s.key).sort();
    expect(gaps).toEqual(["data-breach", "legal-letter"]);
    expect(payload.pagesDeclaredUnwired).toBe(2);
  });

  it("non-page rows carry no pager state; every page row has one", async () => {
    const payload = await getScenarioLibrary();
    for (const s of payload.scenarios) {
      if (s.founderTouch === "page") expect(s.pagerState, s.key).not.toBeNull();
      else expect(s.pagerState, s.key).toBeNull();
    }
  });

  it("the payload is grouped in staff-roster order (SCENARIO_CHARTER_ORDER), so the tab reads as the charters do", async () => {
    const payload = await getScenarioLibrary();
    const ranks = payload.scenarios.map((s) => lib.SCENARIO_CHARTER_ORDER.indexOf(s.responsibleCharter));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

// ─── 7. Surface pins — endpoint + Story tab wired (built-but-unwired guard) ─

describe("the scenario surfaces are wired", () => {
  it("routes-autopilot.ts mounts GET /api/founder/autopilot/scenarios behind requireFounder", () => {
    const src = read("server/routes-autopilot.ts");
    expect(src).toContain('"/api/founder/autopilot/scenarios"');
    expect(src).toContain("getScenarioLibrary");
    expect(src).toContain("requireFounder");
  });

  it("the Story door renders the Scenarios tab (a tab of the existing door — never a new route)", () => {
    const src = read("client/src/pages/founder/autopilot-story.tsx");
    expect(src).toContain('data-testid="story-tab-scenarios"');
    expect(src).toContain("<ScenarioMatrix />");
    expect(src).toContain('from "@/components/founder/ScenarioMatrix"');
    expect(src).toMatch(/STORY_TABS = \[[^\]]*"scenarios"/);
  });

  it("ScenarioMatrix fetches the endpoint and says the honest things", () => {
    const src = read("client/src/components/founder/ScenarioMatrix.tsx");
    expect(src).toContain('"/api/founder/autopilot/scenarios"');
    expect(src).toContain("never drilled");
    expect(src).toContain("declared, not yet wired to a pager");
    expect(src).toContain("QueryErrorState");
    expect(src).toContain("<Skeleton");
    // The founder-touch vocabulary is CEO-plain, and "founder-only" is stated
    // as a permanent fact, not a level.
    expect(src).toContain("pages you");
    expect(src).toContain("no staff autonomy, ever");
  });
});

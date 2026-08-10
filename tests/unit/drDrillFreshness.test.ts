/**
 * drDrillFreshness.test.ts — master-handoff O2: DR-drill freshness ratchet +
 * the backup_verified proof trail's first reader stays honest.
 *
 * Four jobs (parse-the-artifact style, mirroring breakGlassCard.test.ts):
 *  1. FRESHNESS RATCHET on docs/runbooks/dr-drill-history.md — the
 *     human/auditor ledger that mirrors the dr_drills table by design. CI
 *     cannot read the production DB, so the file IS the CI-checkable truth.
 *     Zero blocks = honest-dormant (execution sits in the founder approval
 *     queue; a never-run drill must not hard-fail CI forever) — but the file
 *     must keep SAYING no drills have run, and the runtime never-recorded
 *     attention paths must survive. Once the first block lands, the ratchet
 *     arms: the newest block must stay ≤ DRILL_STALE_DAYS old.
 *  2. THRESHOLD PINS — the 90-day step-away warning, the 100/200-day
 *     job-health staleness bands, and the 8-day backup-verify freshness
 *     window each live in one source file; complementary-but-different on
 *     purpose (step-away warns EARLIER than job-health goes stale). Pin all
 *     of them so none drifts silently.
 *  3. backup_verified READER (audit F-13-3) — the route actually reads the
 *     table (it was write-only at HEAD), reports config-dormancy as
 *     skipped_config from the same predicate the job roster uses, and never
 *     lets a stale/dormant state count as fresh.
 *  4. CONTROLS-DOOR SECTION — wired (built-but-unwired defence), the page is
 *     /api/jobs/health's first client consumer, and the tone logic can only
 *     reach green through a fresh verified row; dormant is amber, a MISSED
 *     RTO target is never green.
 *
 * idempotent: true — pure parsing + source analysis, no DB, no network.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

/**
 * The ratchet's own staleness bound. MUST equal DRILL_STALE_DAYS in
 * server/routes-job-health.ts — asserted below, so the file ledger and the
 * runtime surface can never disagree about what "stale" means.
 */
const DRILL_STALE_DAYS = 100;

/**
 * A drill block's first line is `YYYY-MM-DD  ran-by=<login>` (per the
 * ledger's own Format header). The template line inside the code fence uses
 * the literal string "YYYY-MM-DD", which \d+ can never match — so the format
 * documentation itself never counts as a drill.
 */
function parseDrillDates(md: string): string[] {
  return [...md.matchAll(/^(\d{4}-\d{2}-\d{2})\s+ran-by=/gm)].map((m) => m[1]);
}

/** Whole days since the NEWEST parsed block, or null for an empty ledger. */
function newestDrillAgeDays(dates: string[], now: Date): number | null {
  if (dates.length === 0) return null;
  const newest = Math.max(...dates.map((d) => Date.parse(`${d}T00:00:00Z`)));
  return Math.floor((now.getTime() - newest) / 86_400_000);
}

const isoDaysAgo = (days: number): string => {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const ledger = read("docs/runbooks/dr-drill-history.md");
const stepAway = read("server/services/autopilot/stepAwayReadiness.ts");
const routeSrc = read("server/routes-job-health.ts");
const pageSrc = read("client/src/pages/founder/autopilot-control.tsx");

// ---------------------------------------------------------------------------
// 1a. The parser itself, against fixtures (the ratchet is only as honest as
//     its parse — a parser that finds nothing would green-light anything).
// ---------------------------------------------------------------------------

describe("drill-block parser (fixtures)", () => {
  const formatHeader = [
    "# DR drill history (append-only)",
    "",
    "Format:",
    "",
    "```",
    "YYYY-MM-DD  ran-by=<github-login>",
    "            total-rto=<min>  target-rto=45  passed=<true|false>",
    "```",
    "",
    "---",
    "",
  ].join("\n");

  it("an empty ledger (format template only) parses ZERO blocks — the YYYY-MM-DD template line never counts", () => {
    expect(parseDrillDates(formatHeader + "(no drills recorded yet)\n")).toEqual([]);
    expect(newestDrillAgeDays([], new Date())).toBeNull();
  });

  it("parses real blocks and judges by the NEWEST one", () => {
    const fixture =
      formatHeader +
      `${isoDaysAgo(30)}  ran-by=thmsnrtn\n            total-rto=38  target-rto=45  passed=true\n\n` +
      `${isoDaysAgo(120)}  ran-by=thmsnrtn\n            total-rto=52  target-rto=45  passed=false\n`;
    const dates = parseDrillDates(fixture);
    expect(dates).toHaveLength(2);
    expect(newestDrillAgeDays(dates, new Date())).toBe(30);
  });

  it("a 120-day-old newest block FAILS the ratchet predicate; a 30-day-old one passes", () => {
    const stale = parseDrillDates(
      formatHeader + `${isoDaysAgo(120)}  ran-by=thmsnrtn\n            total-rto=38  target-rto=45  passed=true\n`,
    );
    expect(newestDrillAgeDays(stale, new Date())!).toBeGreaterThan(DRILL_STALE_DAYS);
    const fresh = parseDrillDates(
      formatHeader + `${isoDaysAgo(30)}  ran-by=thmsnrtn\n            total-rto=38  target-rto=45  passed=true\n`,
    );
    expect(newestDrillAgeDays(fresh, new Date())!).toBeLessThanOrEqual(DRILL_STALE_DAYS);
  });
});

// ---------------------------------------------------------------------------
// 1b. The LIVE ledger — dormant-honest at zero blocks, ratcheted after one.
// ---------------------------------------------------------------------------

describe("docs/runbooks/dr-drill-history.md — the freshness ratchet", () => {
  const dates = parseDrillDates(ledger);

  it("documents the parseable-block contract this ratchet enforces", () => {
    expect(ledger).toContain("tests/unit/drDrillFreshness.test.ts");
    expect(ledger).toMatch(/ran-by=<github-login>/);
  });

  if (dates.length === 0) {
    it("zero drill blocks: the ledger still HONESTLY declares no drills have run (refuse-not-fabricate)", () => {
      expect(ledger).toMatch(/no drills recorded yet/i);
    });
  } else {
    it(`the newest drill block must be ≤ ${DRILL_STALE_DAYS} days old (quarterly cadence + slack)`, () => {
      const age = newestDrillAgeDays(dates, new Date())!;
      expect(
        age,
        `The newest DR-drill block is ${age} days old — over the ${DRILL_STALE_DAYS}-day cadence. ` +
          `Run docs/runbooks/07-database-restore-from-snapshot.md end-to-end, INSERT a dr_drills row, ` +
          `and append a new block to docs/runbooks/dr-drill-history.md.`,
      ).toBeLessThanOrEqual(DRILL_STALE_DAYS);
    });

    it("first drill recorded: the no-drills-yet placeholder must be gone", () => {
      expect(ledger).not.toMatch(/no drills recorded yet/i);
    });
  }

  it("the never-recorded honesty paths survive in BOTH runtime surfaces (a fresh DB must still say 'unproven')", () => {
    // Step-away: zero dr_drills rows → attention, never ready.
    expect(stepAway).toMatch(/status: "attention",\s*detail: "No full restore drill has EVER been recorded/);
    // Job health: zero rows → never_ran default, not ok.
    expect(routeSrc).toMatch(/status: "never_ran",\s*\n\s*lastTotalRtoMinutes: null/);
  });
});

// ---------------------------------------------------------------------------
// 2. Threshold pins — 90 (step-away warn) / 100 (stale) / 200 (failing) / 8
//    (backup-verify fresh). Complementary by design: step-away warns EARLIER
//    (90d) than job-health goes stale (100d); pin both so neither drifts
//    silently toward the other (the 0.3 KNOWN_GAPS lesson about
//    complementary-but-disagreeing checks).
// ---------------------------------------------------------------------------

describe("threshold constants (drift pins)", () => {
  it("step-away warns past 90 days", () => {
    expect(stepAway).toMatch(/ageDays > 90/);
  });

  it("job-health bands: stale past 100, failing past 200", () => {
    expect(routeSrc.match(/DRILL_STALE_DAYS = (\d+)/)?.[1]).toBe("100");
    expect(routeSrc.match(/DRILL_FAILING_DAYS = (\d+)/)?.[1]).toBe("200");
  });

  it("this ratchet's bound equals the route's DRILL_STALE_DAYS (one meaning of 'stale')", () => {
    expect(Number(routeSrc.match(/DRILL_STALE_DAYS = (\d+)/)![1])).toBe(DRILL_STALE_DAYS);
  });

  it("backup-verify freshness is 8 days (weekly cadence + slack)", () => {
    expect(routeSrc.match(/BACKUP_VERIFY_FRESH_DAYS = (\d+)/)?.[1]).toBe("8");
  });
});

// ---------------------------------------------------------------------------
// 3. backup_verified finally has a reader (audit F-13-3) — and an honest one.
// ---------------------------------------------------------------------------

describe("routes-job-health.ts — the backup_verified reader", () => {
  it("actually reads the table (it was write-only at HEAD) and returns it in the payload", () => {
    expect(routeSrc).toMatch(/\.from\(backupVerified\)/);
    expect(routeSrc).toContain("res.json({ jobs: out, drDrill, backupVerify })");
  });

  it("reports config-dormancy as skipped_config via the SAME predicate the job roster uses", () => {
    // The dormant job writes NO row (runBackupRestoreVerification returns
    // early), so the route must compute dormancy itself — from
    // backupConfigMissingReason, the roster's own disabledWhen predicate.
    expect(routeSrc).toContain("backupConfigMissingReason");
    expect(routeSrc).toMatch(/dormantReason \? "skipped_config" : "never_ran"/);
  });

  it("isFresh requires a verified row, inside the window, with the pipeline armed — all three", () => {
    expect(routeSrc).toMatch(
      /isFresh: lastVerify\.status === "verified" && days <= BACKUP_VERIFY_FRESH_DAYS && !dormantReason/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. The Controls-door section — wired, and green only through real proof.
// ---------------------------------------------------------------------------

describe("autopilot-control.tsx — 'Backups proven restorable' section", () => {
  const start = pageSrc.indexOf("// ── Backups proven restorable");
  const end = pageSrc.indexOf("// ── Delegation");
  const section = pageSrc.slice(start, end);

  it("the section exists and is actually RENDERED on the Controls door (built-but-unwired defence)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(pageSrc).toContain("<BackupRestoreProofSection />");
  });

  it("the page is /api/jobs/health's first client consumer — the fetch is real, not decorative", () => {
    expect(section).toContain('fetch("/api/jobs/health"');
  });

  it("dormant is amber FIRST — a config-dormant pipeline can never render green, whatever old rows say", () => {
    const toneFn = section.slice(section.indexOf("function backupVerifyTone"), section.indexOf("function drDrillTone"));
    expect(toneFn).toContain('if (v.dormantReason) return "warn"');
    // Dormancy is judged before any ready path…
    expect(toneFn.indexOf('return "warn"')).toBeLessThan(toneFn.indexOf('return "ready"'));
    // …and the ONLY ready path requires a fresh verified row.
    expect(toneFn.match(/return "ready"/g)).toHaveLength(1);
    expect(toneFn).toContain('if (v.status === "verified" && v.isFresh) return "ready"');
  });

  it("a drill with a MISSED RTO target never renders green, however recent; never_ran is amber, not silent", () => {
    const toneFn = section.slice(section.indexOf("function drDrillTone"), section.indexOf("function backupVerifyLine"));
    expect(toneFn).toContain('if (d.lastPassedRtoTarget === false) return "warn"');
    expect(toneFn).toMatch(/"never_ran".*return "warn"|d\.status === "never_ran"[\s\S]*?return "warn"/);
    expect(toneFn.match(/return "ready"/g)).toHaveLength(1);
  });

  it("the state line SAYS the honest thing in each non-green state (no green words on amber states)", () => {
    expect(section).toContain("Dormant — ${v.dormantReason}");
    expect(section).toContain("Treat backups as unproven until a verified row lands.");
    expect(section).toContain("so the proof is stale");
    expect(section).toContain("No full restore drill has ever been recorded");
  });
});

/**
 * backupRestoreVerify.test.ts — Tier 1E (elevation blueprint).
 *
 * Covers the three pure layers of the weekly restore-verification stack
 * without a database or S3:
 *   1. compareCrownJewelCounts — the parity assertions the restored scratch
 *      DB must pass (missing table / empty restore / drift tolerance).
 *   2. pickLatestBackup — newest-dump selection from an S3 listing.
 *   3. The config-dormancy registry contract — backupConfigMissingReason,
 *      the roster disabledWhen entries that wrap it, and the
 *      configDormantEntries() meta-check the deadman surfaces every sweep
 *      (so "wired but dormant on a missing secret" stays visible).
 *   4. pgEnvFromDatabaseUrl — credentials decompose into PG* env vars (never
 *      argv); password handling verified by VALUE EQUALITY against a
 *      synthetic fixture only — no real credential is ever constructed here.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  compareCrownJewelCounts,
  pickLatestBackup,
  DRIFT_TOLERANCE_PCT,
} from "../../server/jobs/backupRestoreVerify";
import {
  JOB_ROSTER,
  backupConfigMissingReason,
  configDormantEntries,
} from "../../server/jobs/jobRegistry";
import { pgEnvFromDatabaseUrl } from "../../server/utils/pgEnv";

// ── env scaffolding ──────────────────────────────────────────────────────────

const BACKUP_ENV_VARS = ["DB_BACKUP_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of BACKUP_ENV_VARS) saved[k] = process.env[k];

function clearBackupEnv() {
  for (const k of BACKUP_ENV_VARS) delete process.env[k];
}
function setBackupEnv() {
  process.env.DB_BACKUP_S3_BUCKET = "test-bucket";
  process.env.AWS_ACCESS_KEY_ID = "test-key-id";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
}

afterEach(() => {
  for (const k of BACKUP_ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── 1. crown-jewel parity assertions ─────────────────────────────────────────

describe("compareCrownJewelCounts", () => {
  it("passes when scratch counts match production exactly", () => {
    const r = compareCrownJewelCounts([
      { table: "organizations", prodCount: 100, scratchCount: 100 },
      { table: "leads", prodCount: 5000, scratchCount: 5000 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.maxDriftPct).toBe(0);
    expect(r.tables.every((t) => t.ok)).toBe(true);
  });

  it("passes within the drift tolerance (backup is up to a day old)", () => {
    // 10% drift < 20% tolerance
    const r = compareCrownJewelCounts([
      { table: "leads", prodCount: 1000, scratchCount: 900 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.tables[0].driftPct).toBeCloseTo(10);
  });

  it("FAILS beyond the drift tolerance", () => {
    const r = compareCrownJewelCounts([
      { table: "leads", prodCount: 10000, scratchCount: 5000 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.tables[0].ok).toBe(false);
    expect(r.tables[0].note).toContain(`${DRIFT_TOLERANCE_PCT}%`);
  });

  it("FAILS when a production table is missing from the restored dump", () => {
    const r = compareCrownJewelCounts([
      { table: "deals", prodCount: 42, scratchCount: null },
    ]);
    expect(r.ok).toBe(false);
    expect(r.tables[0].note).toContain("MISSING");
  });

  it("FAILS when a live table restores empty (corrupt/partial dump)", () => {
    const r = compareCrownJewelCounts([
      { table: "organizations", prodCount: 200, scratchCount: 0 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.tables[0].note).toContain("EMPTY");
    expect(r.maxDriftPct).toBe(100);
  });

  it("skips (does not fail) tables absent in PRODUCTION — list may lead schema", () => {
    const r = compareCrownJewelCounts([
      { table: "financial_ledger", prodCount: null, scratchCount: null },
      { table: "organizations", prodCount: 10, scratchCount: 10 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.tables[0].note).toContain("absent in production");
  });

  it("tiny-table absolute slack: a few rows of churn on a small table never fails", () => {
    // 3 of 10 rows = 30% drift > tolerance, but absDiff 3 ≤ ABS_ROW_SLACK
    const r = compareCrownJewelCounts([
      { table: "organizations", prodCount: 10, scratchCount: 7 },
    ]);
    expect(r.ok).toBe(true);
  });

  it("both-empty tables pass (new deployment)", () => {
    const r = compareCrownJewelCounts([
      { table: "deals", prodCount: 0, scratchCount: 0 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.tables[0].driftPct).toBe(0);
  });
});

// ── 2. latest-backup selection ───────────────────────────────────────────────

describe("pickLatestBackup", () => {
  it("picks the newest .sql object", () => {
    const picked = pickLatestBackup([
      { Key: "database-backups/2026/a.sql", LastModified: new Date("2026-06-01"), Size: 10 },
      { Key: "database-backups/2026/b.sql", LastModified: new Date("2026-06-08"), Size: 20 },
      { Key: "database-backups/2026/c.sql", LastModified: new Date("2026-06-05"), Size: 30 },
    ]);
    expect(picked).toEqual({ key: "database-backups/2026/b.sql", size: 20 });
  });

  it("ignores non-.sql objects and returns null on an empty/irrelevant listing", () => {
    expect(pickLatestBackup([])).toBeNull();
    expect(
      pickLatestBackup([{ Key: "database-backups/manifest.json", LastModified: new Date(), Size: 1 }]),
    ).toBeNull();
  });
});

// ── 3. config-dormancy registry contract (the disabledWhen mechanism) ────────

describe("backup config dormancy (Tier 1E disabledWhen registry)", () => {
  it("reports the bucket as the blocker when DB_BACKUP_S3_BUCKET is unset", () => {
    clearBackupEnv();
    const reason = backupConfigMissingReason();
    expect(reason).toContain("DB_BACKUP_S3_BUCKET");
    expect(reason).toContain("🔑");
  });

  it("reports AWS creds as the blocker when only the bucket is set", () => {
    clearBackupEnv();
    process.env.DB_BACKUP_S3_BUCKET = "test-bucket";
    const reason = backupConfigMissingReason();
    expect(reason).toContain("AWS");
  });

  it("returns null (fully configured) when bucket + creds exist", () => {
    setBackupEnv();
    expect(backupConfigMissingReason()).toBeNull();
  });

  it("db_backup and backup_restore_verify share the SAME dormancy predicate", () => {
    const dbBackup = JOB_ROSTER.find((e) => e.name === "db_backup")!;
    const verify = JOB_ROSTER.find((e) => e.name === "backup_restore_verify")!;

    clearBackupEnv();
    expect(dbBackup.disabledWhen!()).toBe(true);
    expect(verify.disabledWhen!()).toBe(true);

    setBackupEnv();
    expect(dbBackup.disabledWhen!()).toBe(false);
    expect(verify.disabledWhen!()).toBe(false);
  });

  it("configDormantEntries lists the dormant backup jobs as CRITICAL with reasons when unconfigured", () => {
    clearBackupEnv();
    const dormant = configDormantEntries();
    const names = dormant.map((d) => d.name);
    expect(names).toContain("db_backup");
    expect(names).toContain("backup_restore_verify");
    for (const d of dormant.filter((x) => x.name === "db_backup" || x.name === "backup_restore_verify")) {
      expect(d.critical).toBe(true);
      expect(d.reason).toBeTruthy();
      expect(d.reason).not.toContain("no disabledReason declared");
    }
  });

  it("configDormantEntries drops the backup jobs the moment config lands (activation without code change)", () => {
    setBackupEnv();
    const names = configDormantEntries().map((d) => d.name);
    expect(names).not.toContain("db_backup");
    expect(names).not.toContain("backup_restore_verify");
  });

  it("backup_restore_verify is a critical weekly roster entry (deadman watches it)", () => {
    const entry = JOB_ROSTER.find((e) => e.name === "backup_restore_verify")!;
    expect(entry.critical).toBe(true);
    expect(entry.intervalMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

// ── 4. credential hygiene: PG* env decomposition ─────────────────────────────

describe("pgEnvFromDatabaseUrl", () => {
  // Synthetic fixture only — never a real credential.
  const FIXTURE = "postgresql://app%40svc:p%40ss%2Fword@db.internal:5433/acreos?sslmode=require";

  it("decomposes a URL into PG* env vars with decoding", () => {
    const env = pgEnvFromDatabaseUrl(FIXTURE);
    expect(env.PGHOST).toBe("db.internal");
    expect(env.PGPORT).toBe("5433");
    expect(env.PGUSER).toBe("app@svc");
    expect(env.PGPASSWORD).toBe("p@ss/word");
    expect(env.PGDATABASE).toBe("acreos");
    expect(env.PGSSLMODE).toBe("require");
  });

  it("supports a database override for the scratch DB", () => {
    const env = pgEnvFromDatabaseUrl(FIXTURE, "acreos_restore_verify");
    expect(env.PGDATABASE).toBe("acreos_restore_verify");
    expect(env.PGHOST).toBe("db.internal");
  });

  it("defaults port and omits PGPASSWORD/PGSSLMODE when absent", () => {
    const env = pgEnvFromDatabaseUrl("postgresql://tom@localhost/dev");
    expect(env.PGPORT).toBe("5432");
    expect("PGPASSWORD" in env).toBe(false);
    expect("PGSSLMODE" in env).toBe(false);
  });
});

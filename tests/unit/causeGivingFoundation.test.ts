/**
 * Cause Giving foundation pins (CG-1) — the schema/migration/flag/command
 * contract of the data foundation (spec §2, migration 0314):
 *   - all 12 tables load through the shared/schema barrel;
 *   - the migration SQL and the migrate.mjs mirror both create all 12
 *     tables, seed the flag OFF, and seed exactly the 13 §8 EINs as
 *     'candidate' (ballot requires vetting + executed agreement, §1.6);
 *   - the rules module's seed data is the same ballot the migration seeds;
 *   - no money table carries a member-identity column (the program's only
 *     money is AcreOS's own — member identity is tally attribution only);
 *   - every command refuses while the flag is OFF (resolver stubbed).
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import * as schema from "@shared/schema";
import {
  CAUSE_BALLOT_SEED,
  CAUSE_CATEGORY_SEED,
  CAUSE_GIVING_FLAG_KEY,
} from "@shared/cause-giving/rules";
import {
  createCauseGivingService,
  CauseGivingDisabledError,
  type CauseGivingActor,
} from "../../server/services/causeGiving";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION_SQL = fs.readFileSync(
  path.join(ROOT, "migrations/0314_cause_giving_foundation.sql"),
  "utf8",
);
const MIGRATE_MJS = fs.readFileSync(
  path.join(ROOT, "scripts/migrate.mjs"),
  "utf8",
);

const TABLES = [
  ["causeCategories", "cause_categories"],
  ["causes", "causes"],
  ["causeVettingRecords", "cause_vetting_records"],
  ["memberCauseSelections", "member_cause_selections"],
  ["memberCauseSelectionEvents", "member_cause_selection_events"],
  ["causeNominations", "cause_nominations"],
  ["causeGivingQuarters", "cause_giving_quarters"],
  ["causeQuarterSnapshots", "cause_quarter_snapshots"],
  ["causeAllocations", "cause_allocations"],
  ["causeDisbursements", "cause_disbursements"],
  ["causeReportEntries", "cause_report_entries"],
  ["causeReportCorrections", "cause_report_corrections"],
] as const;

describe("schema foundation", () => {
  it("exports all 12 tables through the barrel", () => {
    for (const [exportName] of TABLES) {
      expect(
        (schema as Record<string, unknown>)[exportName],
        `missing barrel export ${exportName}`,
      ).toBeDefined();
    }
  });

  it("creates all 12 tables in BOTH the migration SQL and the migrate.mjs mirror", () => {
    for (const [, table] of TABLES) {
      expect(MIGRATION_SQL).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
      expect(MIGRATE_MJS).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("carries no member-identity column on any money table", () => {
    for (const exportName of ["causeAllocations", "causeDisbursements"] as const) {
      const cols = Object.values(
        getTableColumns(
          (schema as Record<string, never>)[exportName],
        ),
      ).map((c) => c.name);
      for (const col of cols) {
        expect(col).not.toMatch(/member|user/);
      }
    }
    // And no table in the feature holds a member-funds column of any kind.
    for (const [exportName] of TABLES) {
      const cols = Object.values(
        getTableColumns((schema as Record<string, never>)[exportName]),
      ).map((c) => c.name);
      for (const col of cols) {
        expect(col).not.toMatch(/fund|wallet|balance_due/);
      }
    }
  });
});

describe("seeds (spec §8 ballot, FC-CG-3)", () => {
  it("seeds exactly the 13 §8 EINs in both DDL copies, all as candidate", () => {
    expect(CAUSE_BALLOT_SEED).toHaveLength(13);
    for (const entry of CAUSE_BALLOT_SEED) {
      expect(MIGRATION_SQL).toContain(`'${entry.ein}'`);
      expect(MIGRATE_MJS).toContain(`'${entry.ein}'`);
      expect(MIGRATION_SQL).toContain(`'${entry.legalName}'`);
      expect(MIGRATE_MJS).toContain(`'${entry.legalName}'`);
    }
    const einCount = (MIGRATION_SQL.match(/ON CONFLICT \("ein"\) DO NOTHING/g) ?? [])
      .length;
    expect(einCount).toBe(13);
    // The seed never marks a charity ballot (vetting + agreement gate, §1.6):
    // 'ballot' appears only inside the status CHECK vocabulary.
    const ballotSeeds = MIGRATION_SQL.match(/'ballot', 'none', 'seed'/g) ?? [];
    expect(ballotSeeds).toHaveLength(0);
  });

  it("seeds the 6 categories in both DDL copies", () => {
    expect(CAUSE_CATEGORY_SEED).toHaveLength(6);
    for (const cat of CAUSE_CATEGORY_SEED) {
      expect(MIGRATION_SQL).toContain(`'${cat.key}'`);
      expect(MIGRATE_MJS).toContain(`'${cat.key}'`);
    }
  });

  it("seeds the cause_giving flag OFF in both DDL copies, keyed by the shared constant", () => {
    expect(CAUSE_GIVING_FLAG_KEY).toBe("cause_giving");
    for (const ddl of [MIGRATION_SQL, MIGRATE_MJS]) {
      expect(ddl).toContain(`'cause_giving', 'Cause Giving'`);
      expect(ddl).toContain(`false, 'off'`);
    }
  });
});

describe("command layer with the flag OFF", () => {
  const service = createCauseGivingService({
    isEnabled: async () => false,
  });
  const founder: CauseGivingActor = { userId: "founder-1", isFounder: true };
  const member: CauseGivingActor = {
    userId: "user-1",
    organizationId: 1,
    isFounder: false,
  };

  it("refuses every command, founder included (flag-OFF invisibility)", async () => {
    const attempts: Array<() => Promise<unknown>> = [
      () => service.selectCause(member, { causeId: "c1" }),
      () =>
        service.nominateCause(member, { charityLegalName: "Example Org" }),
      () =>
        service.decideNomination(founder, {
          nominationId: "n1",
          decision: "declined",
          declineReason: "out of scope",
        }),
      () =>
        service.recordVetting(founder, { causeId: "c1", outcome: "pass" }),
      () =>
        service.setCauseAgreementState(founder, {
          causeId: "c1",
          agreementState: "executed",
        }),
      () =>
        service.setCauseStatus(founder, { causeId: "c1", status: "vetted" }),
      () => service.snapshotQuarter(founder, { quarterId: "q1" }),
      () => service.computeAllocations(founder, { quarterId: "q1" }),
      () =>
        service.recordDisbursement(founder, {
          allocationId: "a1",
          amountCents: 5000,
          disbursedOn: "2027-01-15",
          method: "ach",
        }),
      () =>
        service.publishQuarterReport(founder, {
          quarterId: "q1",
          content: {},
          renderedBody: "body",
          disclosureVersion: "v1",
        }),
      () =>
        service.appendReportCorrection(founder, {
          entryId: "e1",
          text: "correction",
          reason: "typo",
        }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(CauseGivingDisabledError);
    }
  });
});

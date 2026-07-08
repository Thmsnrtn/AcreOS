// ============================================================================
// SHARED/SCHEMA/AUTOPILOT-IMMUNE.TS
// ----------------------------------------------------------------------------
// Founder Autopilot — immune-system run reports (step-away gap #4).
//
// One append-only row per daily immune-response run: the parsed npm-audit
// shape, the gated repair plan (auto / witnessed / skip counts + items), and
// what the motor half actually did (self-patch attempt result, founder ask).
// This is the surface the board report + Control door read — the immune
// system's honesty ledger. Without it the planner's output evaporated at
// process exit, which is why the audit graded "maintains itself" a D.
//
// Mirror in scripts/migrate.mjs (migration 0185).
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const autopilotImmuneReports = pgTable(
  "autopilot_immune_reports",
  {
    id: serial("id").primaryKey(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    // Parsed audit shape (dependencyAudit.AuditSummary counts).
    advisoriesTotal: integer("advisories_total").notNull().default(0),
    bySeverity: jsonb("by_severity").$type<Record<string, number>>().notNull().default({}),
    // The gated plan (immuneSystem.planSecurityResponse).
    autoCount: integer("auto_count").notNull().default(0),
    witnessedCount: integer("witnessed_count").notNull().default(0),
    skipCount: integer("skip_count").notNull().default(0),
    planItems: jsonb("plan_items")
      .$type<Array<{ name: string; severity: string; action: string; reason: string }>>()
      .notNull()
      .default([]),
    // The one-line status the board report / Letter renders verbatim.
    line: text("line").notNull(),
    // Whether the security ladder (ops domain) had earned safe-class auto-PR
    // at run time — recorded so the plan's routing is auditable later.
    autoMergeEarned: boolean("auto_merge_earned").notNull().default(false),
    // Motor half — what actually happened (selfPatch.runGatedSelfPatch).
    selfPatchRan: boolean("self_patch_ran").notNull().default(false),
    selfPatchReason: text("self_patch_reason"),
    selfPatchPrUrl: text("self_patch_pr_url"),
    // Whether this run raised (or found an already-open) founder ask for the
    // witnessed items.
    askCreated: boolean("ask_created").notNull().default(false),
  },
  (t) => [index("autopilot_immune_reports_ran_idx").on(t.ranAt)],
);

export type AutopilotImmuneReportRow = typeof autopilotImmuneReports.$inferSelect;
export type InsertAutopilotImmuneReportRow = typeof autopilotImmuneReports.$inferInsert;

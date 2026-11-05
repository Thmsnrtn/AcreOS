// ============================================================================
// SHARED/SCHEMA/SUBDIVISION-SCREEN-RUNS.TS — the buildability screen's record.
// ----------------------------------------------------------------------------
// Subdivision V1, Leg 1 (package 2026-11-05 §3.3); migration 0301.
// Founder decision 2026-11-05 (~07:39 EST, Tom): +1 table, approved — the
// §9.1 fence lifted for this table only. Step 0 showed no existing store could
// hold a screen run honestly (scenarios are numeric economics; decision
// snapshots take only decision kinds; evidence claims hold observations, not
// derived verdicts; subdivision_plans exist only once a plan does).
//
// APPEND-ONLY. One row per screen run on a parent parcel: the run's full
// input snapshot (facts as recorded, with source and as-of; thresholds as
// stated; the lot-yield inputs and estimate), the per-trigger verdicts, the
// rule version, the actor and the time. Re-running after facts change INSERTS
// a new row; a verdict that changes between runs shows both — the
// disagreement record is the point (Tom's rationale on record). There is no
// UPDATE path in the store, and migration 0301 refuses UPDATE in the database.
// DELETE is left to organization erasure (deleteOrganization sweeps every
// organization_id table); no product path deletes a run.
//
// The subject is NOT a foreign key, for the decision_snapshots reason: a
// screen run must survive its parcel — the record of why a parcel failed is
// the one worth keeping. Tenant deletion still cascades via organization_id.
// ============================================================================

import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { organizations } from "../schema";

export const subdivisionScreenRuns = pgTable(
  "subdivision_screen_runs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    /** properties.id of the parent parcel. Deliberately not a foreign key. */
    parentParcelId: integer("parent_parcel_id").notNull(),
    /** "buildability-screen v1" — the rule set that produced the verdicts. */
    ruleVersion: text("rule_version").notNull(),
    /** The verbatim run input: { facts, thresholds, yieldInputs }. */
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
    /** The lot-yield estimate the sub-minimum-yield trigger read (lot-yield v1). */
    yieldEstimate: jsonb("yield_estimate").$type<Record<string, unknown>>().notNull(),
    /** The ScreenResult: verdicts, triggered / not-determinable ids, headline. */
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    triggeredCount: integer("triggered_count").notNull(),
    notDeterminableCount: integer("not_determinable_count").notNull(),
    /** The user who ran it. */
    actorRef: text("actor_ref").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // "This parcel's screen history, newest first" — org-LEADING.
    index("subdivision_screen_runs_org_parent_idx").on(table.organizationId, table.parentParcelId, table.createdAt),
  ],
);

export type SubdivisionScreenRun = typeof subdivisionScreenRuns.$inferSelect;

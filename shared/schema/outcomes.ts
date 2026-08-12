// ============================================================================
// SHARED/SCHEMA/OUTCOMES.TS — the learning layer's one table.
// ----------------------------------------------------------------------------
// An Outcome records what ACTUALLY happened, referencing the DecisionSnapshot
// it resulted from. It closes the canonical loop (BI1): REALITY → EVIDENCE →
// ECONOMICS → DECISION → PLAN → ACTION → WORKFLOW → OUTCOME → LEARNING.
//
// LAW 9 IS THE DESIGN CONSTRAINT
// ------------------------------
// "Outcomes append learning; they do not rewrite history." This table
// REFERENCES decision_snapshots; nothing here edits one. Variance between the
// forecast and the result is deliberately NOT a column — it is computed as a
// pure projection in shared/outcomes/outcome.ts over the scenario references
// the decision already froze. A stored variance would be a third number that
// can drift from the two it derives from, and "improving" it later would
// silently restate how good a past decision looked.
//
// WHY decision_snapshot_id IS A REAL FOREIGN KEY
// ----------------------------------------------
// Unlike evidence_claims.subject_id, decision_snapshots.subject_id and
// scenarios.subject_id — all deliberately unconstrained so the record survives
// its subject — an outcome without its decision is MEANINGLESS. There is
// nothing to compare it against and nothing it can teach. The FK is correct
// here for exactly the reason it was wrong there.
//
// NOT REUSING `outcome_telemetry`
// -------------------------------
// That table is org-scoped but shaped around AGENT performance
// (contributingFactors: agentActions, messagesSent, responseTime) and carries
// no decision reference. `outcome_calibrations` is keyed by agent codename.
// Both are the agent/founder learning loop. BI76 is explicit that audit events,
// decision snapshots, action receipts and outcomes are different things that
// must not collapse into one log — and an investment outcome that cannot point
// at the decision it graded is not the canonical Outcome at all.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import { decisionSnapshots } from "./decision-snapshots";
import type { ActualMetric, OutcomeKind } from "../outcomes/outcome";
import type { DecisionSubjectType } from "../decisions/snapshot";

export const outcomes = pgTable(
  "outcomes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    shapeVersion: integer("shape_version").notNull().default(1),

    /** The decision this outcome graded. A real FK — see the header. */
    decisionSnapshotId: integer("decision_snapshot_id")
      .references(() => decisionSnapshots.id, { onDelete: "cascade" })
      .notNull(),

    subjectType: text("subject_type").$type<DecisionSubjectType>().notNull(),
    subjectId: integer("subject_id").notNull(),

    kind: text("kind").$type<OutcomeKind>().notNull(),
    /** What happened, in the customer's words. */
    summary: text("summary").notNull(),

    /**
     * Measured results, in the SAME metric vocabulary a scenario predicts in.
     * A null value means NOT MEASURED; it never means zero.
     */
    actuals: jsonb("actuals").$type<ActualMetric[]>().notNull().default([]),

    /** When the outcome was OBSERVED, which is not when it was recorded. */
    observedAt: timestamp("observed_at").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    // "This decision's outcomes" — the calibration read.
    index("outcomes_org_decision_idx").on(
      table.organizationId,
      table.decisionSnapshotId,
      table.observedAt,
    ),
    // "This property's outcomes, newest first".
    index("outcomes_org_subject_idx").on(
      table.organizationId,
      table.subjectType,
      table.subjectId,
      table.observedAt,
    ),
  ],
);

export type OutcomeRow = typeof outcomes.$inferSelect;
export type InsertOutcomeRow = typeof outcomes.$inferInsert;

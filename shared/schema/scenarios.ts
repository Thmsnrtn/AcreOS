// ============================================================================
// SHARED/SCHEMA/SCENARIOS.TS — the economics layer's one table.
// ----------------------------------------------------------------------------
// A Scenario is a versioned, deterministic economic hypothesis (BI12, BK24).
// One row per computed hypothesis, carrying the ENGINE that produced it, that
// engine's VERSION, the VERBATIM inputs, and the outputs.
//
// WHY IT IS NEEDED
// ----------------
// `decision_snapshots` freezes what was KNOWN (evidence) and what was ASSUMED
// (assumptions), but had nowhere to point for the ECONOMICS that justified the
// choice. A snapshot could record "offer $42,000" while the arithmetic behind
// the number lived nowhere — so a year later you can reconstruct what the
// investor believed about the parcel, and not what they believed about the deal.
//
// THE PATTERN THIS COPIES RATHER THAN REINVENTS
// ---------------------------------------------
// `note_payoff_quotes` already persists `engine_version` (NOT NULL),
// `day_count_convention` and `engine_input_json` — "the verbatim input snapshot
// so the number can be recomputed and defended years later"
// (server/services/notePaymentMath.ts). That is BK23's deterministic economics
// contract, already exemplary in one vertical. This generalises it; it does not
// invent a second mechanism.
//
// IMMUTABLE BY CONTRACT
// ---------------------
// No updatedAt column and no UPDATE path in the store. Re-running the maths
// INSERTs a new scenario; a stored one never changes. Canonical law 4 requires
// versioned financial truth, and a mutable scenario would let improving a
// formula silently rewrite the meaning of every number the old one produced —
// the economics equivalent of the mutable-decision failure law 6 forbids.
//
// NOT REUSING `scenario_simulations` / `scenario_outcome_comparisons`
// ------------------------------------------------------------------
// Those are FOUNDER-plane autopilot tables (LLM war-gaming of company
// decisions), not customer investment economics. Reusing one would make Founder
// OS the owner of customer financial truth, which BI5 forbids.
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
import type {
  ScenarioAssumption,
  ScenarioMetric,
  ScenarioSubjectType,
} from "../economics/scenario";

export const scenarios = pgTable(
  "scenarios",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    /** Envelope shape version — distinct from the engine's own version. */
    shapeVersion: integer("shape_version").notNull().default(1),

    subjectType: text("subject_type").$type<ScenarioSubjectType>().notNull(),
    /**
     * No foreign key, for the same reason decision_snapshots has none: a
     * scenario must survive its subject. The economics of a deal you walked
     * away from are exactly the ones worth still being able to read.
     */
    subjectId: integer("subject_id").notNull(),

    /** Human name — "Base case", "Slow sale", "Cash offer". */
    label: text("label").notNull(),

    // ── Which arithmetic produced this, and which version of it ──────────
    engineId: text("engine_id").notNull(),
    /** NOT NULL, deliberately: an unversioned number cannot be defended. */
    engineVersion: text("engine_version").notNull(),

    strategyPackId: text("strategy_pack_id"),
    strategyPackVersion: text("strategy_pack_version"),

    /** The verbatim inputs the engine consumed. The defence of the number. */
    inputs: jsonb("inputs").$type<Record<string, number>>().notNull(),
    assumptions: jsonb("assumptions").$type<ScenarioAssumption[]>().notNull().default([]),
    /** Computed outputs. A null value means UNDEFINED, never zero. */
    metrics: jsonb("metrics").$type<ScenarioMetric[]>().notNull().default([]),

    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (table) => [
    // "This property's scenarios, newest first" — org-LEADING per the
    // shard-readiness invariant (scripts/check-org-leading-index.mjs).
    index("scenarios_org_subject_idx").on(
      table.organizationId,
      table.subjectType,
      table.subjectId,
      table.computedAt,
    ),
    // "Every scenario an engine version produced" — the read a formula change
    // needs in order to find what it would have altered.
    index("scenarios_org_engine_idx").on(
      table.organizationId,
      table.engineId,
      table.engineVersion,
    ),
  ],
);

export type ScenarioRow = typeof scenarios.$inferSelect;
export type InsertScenarioRow = typeof scenarios.$inferInsert;

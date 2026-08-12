// ============================================================================
// SHARED/SCHEMA/DECISION-SNAPSHOTS.TS — Decision Memory's one table.
// ----------------------------------------------------------------------------
// A DecisionSnapshot is the durable boundary of the canonical loop (BI20): when
// a consequential investment decision is made, this freezes WHAT WAS KNOWN —
// the resolved evidence and the claim ids behind it, the assumptions in force,
// the alternatives considered, the unknowns accepted, who decided under what
// authority, and which Strategy Pack version shaped the criteria.
//
// IMMUTABLE BY CONTRACT
// ---------------------
// There is no updatedAt column and no UPDATE path in the store. Later evidence
// and later outcomes APPEND context (an Outcome row references a snapshot; it
// never edits one). That is canonical law 6 — historical decisions preserve
// what was known and assumed at the time — and law 9 — outcomes append
// learning, they do not rewrite history.
//
// WHY THE CUSTOMER PLANE NEEDED ITS OWN
// -------------------------------------
// The repo already had FOURTEEN decision-shaped tables — board_decisions,
// ceo_decision_replays, decisions_inbox_items, decision_patterns,
// solene_decisions, solene_decision_traces and the rest. Every one of them is
// FOUNDER/autopilot control-plane state: queues of things needing the founder,
// traces of the autopilot's own reasoning. None of them records a CUSTOMER's
// investment decision, and none freezes its inputs. Reusing one would have made
// Founder OS the owner of customer investment truth, which BI5 forbids
// explicitly ("Founder OS is a control plane, not a second product database").
//
// WHY NOT A JSONB COLUMN ON `deals`
// ---------------------------------
// Because a decision is not always about a deal. A `pass` — the most
// under-recorded and most valuable decision an investor makes — happens when no
// deal exists and never will. Hanging Decision Memory off `deals` would lose
// exactly the decisions worth remembering.
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
  DecisionActorType,
  DecisionKind,
  DecisionSubjectType,
  FrozenAlternative,
  FrozenAssumption,
  FrozenFact,
  FrozenUnknown,
} from "../decisions/snapshot";
import type { FrozenScenarioRef } from "../economics/scenario";

export const decisionSnapshots = pgTable(
  "decision_snapshots",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    /** Shape version of the frozen body, so old rows stay readable as written. */
    snapshotVersion: integer("snapshot_version").notNull().default(1),

    // ── What the decision was about ──────────────────────────────────────
    subjectType: text("subject_type").$type<DecisionSubjectType>().notNull(),
    /**
     * Deliberately NOT a foreign key. A snapshot must survive its subject: an
     * investor who passed on a property and later deleted it still needs the
     * record of WHY they passed, and a cascade delete would erase precisely the
     * decisions worth keeping. Tenant deletion still cascades via
     * organization_id, so customer-data deletion stays complete.
     */
    subjectId: integer("subject_id").notNull(),

    // ── The decision ─────────────────────────────────────────────────────
    kind: text("kind").$type<DecisionKind>().notNull(),
    choice: text("choice").notNull(),
    rationale: text("rationale").notNull(),

    // ── Who, and under what authority (BI72) ─────────────────────────────
    actorType: text("actor_type").$type<DecisionActorType>().notNull(),
    actorRef: text("actor_ref").notNull(),
    /**
     * How this was authorised. For automation it must name the capability
     * grant that permitted it — never a global "autonomous mode" flag.
     */
    authority: text("authority").notNull(),

    // ── Which rules shaped it (BI91) ─────────────────────────────────────
    strategyPackId: text("strategy_pack_id"),
    strategyPackVersion: text("strategy_pack_version"),

    // ── The frozen epistemic state ───────────────────────────────────────
    /** The moment evidence was resolved AT. Replaying resolution with this
     *  date and resolution_policy_version must reproduce `evidence`. */
    evidenceAsOf: timestamp("evidence_as_of").notNull(),
    resolutionPolicyVersion: integer("resolution_policy_version").notNull(),

    /** Resolved facts as they stood, each carrying the claim ids behind it. */
    evidence: jsonb("evidence").$type<FrozenFact[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<FrozenAssumption[]>().notNull().default([]),
    alternatives: jsonb("alternatives")
      .$type<FrozenAlternative[]>()
      .notNull()
      .default([]),
    /**
     * What was NOT known. Derived automatically from evidence that resolved to
     * unknown or conflict, plus any the caller adds. This is the field that
     * carries law 3 forward into Decision Memory: an unknown at decision time
     * stays an unknown in the record and cannot be retroactively filled in.
     */
    unknowns: jsonb("unknowns").$type<FrozenUnknown[]>().notNull().default([]),
    /**
     * The economics that justified the choice. Each reference carries the
     * engine VERSION and the headline metrics, so the record stays readable
     * even if the scenario row later becomes unreachable. An empty list is a
     * valid and common state — many decisions (a `pass` on a parcel that failed
     * a hard filter) are made without running economics at all, and recording
     * an empty list says exactly that.
     */
    scenarios: jsonb("scenarios").$type<FrozenScenarioRef[]>().notNull().default([]),

    decidedAt: timestamp("decided_at").notNull().defaultNow(),
  },
  (table) => [
    // Dominant read: "this property's decision history, newest first" —
    // org-LEADING per the shard-readiness invariant.
    index("decision_snapshots_org_subject_idx").on(
      table.organizationId,
      table.subjectType,
      table.subjectId,
      table.decidedAt,
    ),
    // "Everything we decided lately", and the calibration loop's scan.
    index("decision_snapshots_org_decided_idx").on(
      table.organizationId,
      table.decidedAt,
    ),
    // "Every pass we made this quarter" — the decision-quality read.
    index("decision_snapshots_org_kind_idx").on(
      table.organizationId,
      table.kind,
      table.decidedAt,
    ),
  ],
);

export type DecisionSnapshotRow = typeof decisionSnapshots.$inferSelect;
export type InsertDecisionSnapshotRow = typeof decisionSnapshots.$inferInsert;

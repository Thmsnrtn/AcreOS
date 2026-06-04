// ============================================================================
// SHARED/SCHEMA/SOLENE-SESSION-TASKS.TS
// ----------------------------------------------------------------------------
// Phase 1 of the AcreOS-Solene migration: persisted replacement for the
// in-memory TaskCreate/TaskUpdate task list so both CLI Claude Code and
// AcreOS Solene chat see the same task queue.
//
// blocked_by (int[]) preserves the dependency graph between tasks.
// conversation_id is nullable so a task can be cross-thread (or
// system-initiated).
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// ENUMS
// ============================================
export const SESSION_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "deleted",
] as const;
export type SessionTaskStatus = (typeof SESSION_TASK_STATUSES)[number];

// ============================================
// solene_session_tasks
// ============================================
export const soleneSessionTasks = pgTable(
  "solene_session_tasks",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // FK (logical) to solene_conversations.id — nullable so a task can be
    // cross-thread or system-initiated.
    conversationId: integer("conversation_id"),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    // pending | in_progress | completed | deleted
    status: text("status").notNull().default("pending"),
    // Spinner-friendly present-continuous form (e.g., "Writing the migration").
    activeForm: text("active_form"),
    // Agent id or codename owning the task.
    owner: text("owner"),
    // Dependency graph: list of task ids that must complete first.
    blockedBy: integer("blocked_by")
      .array()
      .notNull()
      .default([] as number[]),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index("solene_session_tasks_status_created_idx").on(
      t.status,
      t.createdAt,
    ),
    index("solene_session_tasks_conversation_status_idx").on(
      t.conversationId,
      t.status,
    ),
    index("solene_session_tasks_owner_status_idx").on(t.owner, t.status),
  ],
);

export type SoleneSessionTaskRow = typeof soleneSessionTasks.$inferSelect;
export type InsertSoleneSessionTaskRow =
  typeof soleneSessionTasks.$inferInsert;

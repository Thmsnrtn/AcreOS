/**
 * VA tasks and the org's SOP library — the persistence layer that was declared
 * and never written.
 *
 * WHAT WAS THERE
 * ──────────────
 * `server/services/vaManagement.ts` declared its storage as two string
 * constants and stopped:
 *
 *     // IN-MEMORY STORE (replace with DB tables when schema migration is run)
 *     const VA_TASKS_KEY = "va_tasks";
 *     const SOP_LIBRARY_KEY = "sop_library";
 *
 * Neither constant was ever read. `createTask` was a pure function that stamped
 * an id onto its input and returned it; `POST /api/va/tasks` answered 200 with
 * that object, and nothing stored it. `GET /api/va/metrics` and
 * `/api/va/audit-trail` computed over `organizations.settings.va_tasks` — an
 * array with no creator anywhere in the repository — so they returned zeros and
 * an empty trail that READ as measurements. `POST /api/va/tasks/:id/verify`
 * read-modify-wrote that same array and could never find a task in it.
 *
 * Unit 49 turned the two endpoints that CLAIMED a save into honest 501s and
 * recorded the rest as BLOCKERS B9, because building the layer or deleting the
 * subsystem is a founder call. The founder ruled on 2026-08-13: build it.
 *
 * WHY TWO TABLES AND NOT A SETTINGS BLOB
 * ──────────────────────────────────────
 * The blob was the design that failed, and it would have failed further:
 * `organizations.settings` is read on nearly every org-scoped request, so an
 * unbounded task history inside it grows the hot path for every user forever,
 * and concurrent writers clobber each other (the verify handler already carries
 * a `jsonb_set` comment recording exactly that bug being fixed once). Tasks are
 * a queryable, filterable, paginated collection with per-row lifecycle — the
 * thing a table is.
 *
 * SOPs ARE SEPARATE FROM THE DEFAULTS
 * ───────────────────────────────────
 * `vaManagement.DEFAULT_SOPS` stays a code constant, served by
 * `GET /api/va/sops/defaults`. It is AcreOS's own procedure catalogue, versioned
 * with the code that references it — not customer data. `va_sops` holds what an
 * ORG writes: its own procedures, or an edited copy of a default. Merging the
 * two would make a code change look like a customer edit.
 *
 * MONEY POSTURE (founder ruling "be the rail, not the provider"): nothing here
 * moves, holds, collects or charges a cent.
 */

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  boolean,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { organizations, users, leads, properties, deals } from "../schema";

/** Task lifecycle. Mirrors `TaskStatus` in services/vaManagement.ts. */
export type VaTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "cancelled";

/** Mirrors `TaskPriority`. */
export type VaTaskPriority = "low" | "medium" | "high" | "urgent";

/** Mirrors `TaskCategory`. */
export type VaTaskCategory =
  | "research"
  | "outreach"
  | "data_entry"
  | "document_prep"
  | "follow_up"
  | "marketing"
  | "admin"
  | "other";

/** One step of a stored procedure. */
export interface VaSopStep {
  stepNumber: number;
  instruction: string;
  videoUrl?: string;
}

export const vaTasks = pgTable(
  "va_tasks",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    // ── Assignment ───────────────────────────────────────────────────────
    //
    // `varchar`, NOT integer. `users.id` is a varchar (Clerk-linked), and this
    // module's original `VaTask` interface declared `assignedToUserId: number`
    // — part of the persistence layer that was never written, so nothing ever
    // proved the type against a real column. An integer column here would have
    // failed at CREATE TABLE with "Key columns are of incompatible types",
    // which is exactly the "schema shipped with no migration would have 500'd
    // on deploy" class CLAUDE.md names.
    assignedToUserId: varchar("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedByUserId: varchar("assigned_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // ── The work ─────────────────────────────────────────────────────────
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").$type<VaTaskCategory>().notNull().default("other"),
    priority: text("priority").$type<VaTaskPriority>().notNull().default("medium"),
    status: text("status").$type<VaTaskStatus>().notNull().default("pending"),

    /**
     * Context links, all optional and all `set null` on delete: a completed
     * task is a record of work done, and it stays true after the lead it was
     * about is deleted. Losing the task would lose the VA's hours with it.
     */
    leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
    propertyId: integer("property_id").references(() => properties.id, {
      onDelete: "set null",
    }),
    dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
    /**
     * Deliberately NOT a foreign key: there are two live note families in this
     * repo (`notes` and `acquired_notes`) and which one is canonical is an open
     * founder decision (BLOCKERS B10). A constraint pointing at the wrong one
     * would have to be dropped when that is answered.
     */
    noteId: integer("note_id"),

    /** References `va_sops.id` when set, or a DEFAULT_SOPS id when it names one. */
    sopId: text("sop_id"),

    // ── Time ─────────────────────────────────────────────────────────────
    dueDate: timestamp("due_date"),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // ── Results ──────────────────────────────────────────────────────────
    completionNotes: text("completion_notes"),
    attachmentUrls: jsonb("attachment_urls").$type<string[]>().notNull().default([]),
    loomUrl: text("loom_url"),

    // ── Verification (POST /api/va/tasks/:id/verify) ─────────────────────
    /**
     * Null means "not reviewed", which is different from `false` ("reviewed and
     * rejected"). The endpoint could previously express neither, because there
     * was no row to write it on.
     */
    verified: boolean("verified"),
    verifiedAt: timestamp("verified_at"),
    verifiedByUserId: varchar("verified_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verificationNotes: text("verification_notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // "This VA's queue, newest first" — the task-list read. Org-LEADING per the
    // shard-readiness invariant (scripts/check-org-leading-index.mjs).
    index("va_tasks_org_assignee_idx").on(
      table.organizationId,
      table.assignedToUserId,
      table.createdAt,
    ),
    // "This org's tasks in this state" — the metrics and audit-trail reads.
    index("va_tasks_org_status_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const vaSops = pgTable(
  "va_sops",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    title: text("title").notNull(),
    category: text("category").$type<VaTaskCategory>().notNull().default("other"),
    description: text("description").notNull().default(""),
    steps: jsonb("steps").$type<VaSopStep[]>().notNull().default([]),
    estimatedMinutes: integer("estimated_minutes").notNull().default(0),

    /**
     * Set when this SOP started life as one of `vaManagement.DEFAULT_SOPS`, so
     * the UI can say "customised from the AcreOS default" rather than showing
     * two similar procedures with no relationship between them.
     */
    derivedFromDefaultTitle: text("derived_from_default_title"),

    createdByUserId: varchar("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("va_sops_org_category_idx").on(
      table.organizationId,
      table.category,
      table.title,
    ),
  ],
);

export type VaTaskRow = typeof vaTasks.$inferSelect;
export type InsertVaTaskRow = typeof vaTasks.$inferInsert;
export type VaSopRow = typeof vaSops.$inferSelect;
export type InsertVaSopRow = typeof vaSops.$inferInsert;

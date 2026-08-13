/**
 * Virtual Assistant (VA) Management Service
 *
 * PERSISTENCE, ADDED 2026-08-13 (BLOCKERS B9, founder ruling). This module used
 * to declare its storage as two string constants and stop there:
 *
 *     // IN-MEMORY STORE (replace with DB tables when schema migration is run)
 *     const VA_TASKS_KEY = "va_tasks";
 *     const SOP_LIBRARY_KEY = "sop_library";
 *
 * Neither was ever read. `createTask` was a PURE FUNCTION that stamped an id
 * onto its input and returned it, so `POST /api/va/tasks` answered 200 with a
 * task-shaped object that existed only in that response; the metrics and
 * audit-trail endpoints computed over `organizations.settings.va_tasks`, an
 * array with no creator anywhere in the repository, and returned zeros that read
 * as measurements. Unit 49 replaced the two endpoints that CLAIMED a save with
 * honest 501s and recorded the rest as B9. The founder ruled: build it.
 *
 * The shape of this file after that ruling:
 *
 *   - **Pure functions stay pure.** `calculateVaMetrics` and
 *     `generateStandupDigest` take an array of tasks and compute over it. They
 *     are unit-testable without a database and are used by both the stored path
 *     and the `POST /api/va/metrics` "compute over these tasks I am handing you"
 *     endpoint.
 *   - **Everything that persists is org-scoped and takes `organizationId` as a
 *     required parameter**, never as an optional one and never inferred. A
 *     `VaTaskNotInOrgError` is raised rather than returning null so a caller
 *     cannot mistake "not yours" for "not found" and act on the difference —
 *     the route renders it as 404, which is this repo's convention for
 *     withholding existence.
 *   - **Ids are serial integers now.** `generateTaskId()` minted
 *     `task_<ts>_<random>` strings because there was no database to allocate
 *     one; with a real table that function was a fabricated identifier.
 *
 * Enables real estate professionals to manage their VA team:
 * - Assign tasks to specific VAs from lead/property/deal context
 * - VA task queue: focused view showing only assigned work
 * - Daily standup digest: what each VA did yesterday
 * - VA performance metrics: tasks completed, leads touched, response time
 * - SOP (Standard Operating Procedure) library: VAs reference per task type
 * - Time tracking per task for billing/oversight
 */

import { db } from "../db";
import { vaTasks, vaSops } from "@shared/schema";
import type {
  VaTaskRow,
  VaSopRow,
  VaTaskCategory,
  VaTaskPriority,
  VaTaskStatus,
  VaSopStep,
} from "@shared/schema/va-tasks";
import { and, desc, eq } from "drizzle-orm";
import { startOfDay, endOfDay, subDays, format } from "date-fns";

// ============================================
// TYPES — Task assignment system
// ============================================

/**
 * The three unions are the table's column types, re-exported under this
 * module's historical names. One definition, so a category that compiles here
 * is a category the database accepts.
 */
export type TaskPriority = VaTaskPriority;
export type TaskStatus = VaTaskStatus;
export type TaskCategory = VaTaskCategory;

export interface VaTask {
  /** Serial, allocated by the database. Was a minted `task_<ts>_<rand>` string. */
  id: number;
  organizationId: number;
  /**
   * `users.id`, which is a VARCHAR (Clerk-linked) — not a number. The old
   * interface said `number`, and nothing ever contradicted it because there was
   * no column to check it against. An integer column would have failed at
   * CREATE TABLE against `users("id")`.
   */
  assignedToUserId: string | null;
  assignedByUserId: string | null;

  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;

  // Context links
  leadId?: number;
  propertyId?: number;
  dealId?: number;
  noteId?: number;

  // SOP reference
  sopId?: string;

  // Due date and time tracking
  dueDate?: string; // ISO date
  estimatedMinutes?: number;
  actualMinutes?: number;
  startedAt?: string;
  completedAt?: string;

  // Results
  completionNotes?: string;
  attachmentUrls?: string[];
  loomUrl?: string; // Screen recording link

  createdAt: string;
  updatedAt: string;
}

export interface Sop {
  id: number;
  organizationId: number;
  title: string;
  category: TaskCategory;
  description: string;
  steps: VaSopStep[];
  estimatedMinutes: number;
  createdAt: string;
}

export interface DailyStandupDigest {
  date: string;
  va: { userId: string; name: string };
  tasksCompleted: number;
  tasksInProgress: number;
  leadsContacted: number;
  propertiesResearched: number;
  hoursLogged: number;
  highlights: string[];
  blockers: string[];
}

// ============================================
// TASK MANAGEMENT — persisted in `va_tasks`
// ============================================

/**
 * A task exists but belongs to another organization, or does not exist at all.
 *
 * One error for both cases, deliberately: distinguishing them tells a caller
 * that a row with that id exists somewhere, which is exactly what tenant
 * isolation withholds. Routes render this as 404 for the same reason.
 */
export class VaTaskNotInOrgError extends Error {
  constructor(taskId: number) {
    super(`VA task ${taskId} is not in this organization`);
    this.name = "VaTaskNotInOrgError";
  }
}

const iso = (d: Date | null | undefined): string | undefined =>
  d ? d.toISOString() : undefined;

/** A stored row in this module's `VaTask` shape. */
export function toVaTask(row: VaTaskRow): VaTask {
  return {
    id: row.id,
    organizationId: row.organizationId,
    assignedToUserId: row.assignedToUserId,
    assignedByUserId: row.assignedByUserId,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    leadId: row.leadId ?? undefined,
    propertyId: row.propertyId ?? undefined,
    dealId: row.dealId ?? undefined,
    noteId: row.noteId ?? undefined,
    sopId: row.sopId ?? undefined,
    dueDate: iso(row.dueDate),
    estimatedMinutes: row.estimatedMinutes ?? undefined,
    actualMinutes: row.actualMinutes ?? undefined,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    completionNotes: row.completionNotes ?? undefined,
    attachmentUrls: row.attachmentUrls,
    loomUrl: row.loomUrl ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateVaTaskInput {
  title: string;
  description?: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedToUserId?: string;
  assignedByUserId?: string;
  leadId?: number;
  propertyId?: number;
  dealId?: number;
  noteId?: number;
  sopId?: string;
  dueDate?: string;
  estimatedMinutes?: number;
}

/** Create a task. The organization is a parameter, never inferred. */
export async function createTask(
  organizationId: number,
  input: CreateVaTaskInput,
): Promise<VaTask> {
  const [row] = await db
    .insert(vaTasks)
    .values({
      organizationId,
      title: input.title,
      description: input.description ?? "",
      category: input.category ?? "other",
      priority: input.priority ?? "medium",
      status: input.status ?? "pending",
      assignedToUserId: input.assignedToUserId ?? null,
      assignedByUserId: input.assignedByUserId ?? null,
      leadId: input.leadId ?? null,
      propertyId: input.propertyId ?? null,
      dealId: input.dealId ?? null,
      noteId: input.noteId ?? null,
      sopId: input.sopId ?? null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      // A task created as already-started or already-done carries the stamp its
      // status implies, so the metrics below are not computing over a null.
      startedAt: input.status === "in_progress" ? new Date() : null,
      completedAt: input.status === "completed" ? new Date() : null,
    })
    .returning();
  return toVaTask(row);
}

/** One task, within the organization. Throws rather than returning null. */
export async function getTask(organizationId: number, taskId: number): Promise<VaTask> {
  const [row] = await db
    .select()
    .from(vaTasks)
    .where(and(eq(vaTasks.id, taskId), eq(vaTasks.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new VaTaskNotInOrgError(taskId);
  return toVaTask(row);
}

export interface ListVaTasksFilter {
  assignedToUserId?: string;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

export async function listTasks(
  organizationId: number,
  filter: ListVaTasksFilter = {},
): Promise<VaTask[]> {
  const where = [eq(vaTasks.organizationId, organizationId)];
  if (filter.assignedToUserId != null) {
    where.push(eq(vaTasks.assignedToUserId, filter.assignedToUserId));
  }
  if (filter.status) where.push(eq(vaTasks.status, filter.status));

  const rows = await db
    .select()
    .from(vaTasks)
    .where(and(...where))
    .orderBy(desc(vaTasks.createdAt))
    .limit(Math.min(filter.limit ?? 100, 500))
    .offset(filter.offset ?? 0);
  return rows.map(toVaTask);
}

export interface UpdateVaTaskInput {
  title?: string;
  description?: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedToUserId?: string;
  dueDate?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  completionNotes?: string;
  attachmentUrls?: string[];
  loomUrl?: string;
}

/**
 * Update a task within the organization.
 *
 * The lifecycle stamps are derived here rather than accepted from the caller:
 * `startedAt` on the first move to `in_progress`, `completedAt` on the first
 * move to `completed`, and neither is ever overwritten. A caller-supplied
 * `completedAt` is how a "task completed" metric becomes a number someone typed.
 */
export async function updateTask(
  organizationId: number,
  taskId: number,
  updates: UpdateVaTaskInput,
): Promise<VaTask> {
  const current = await getTask(organizationId, taskId);

  const patch: Partial<typeof vaTasks.$inferInsert> = { updatedAt: new Date() };
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.category !== undefined) patch.category = updates.category;
  if (updates.priority !== undefined) patch.priority = updates.priority;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.assignedToUserId !== undefined) {
    patch.assignedToUserId = updates.assignedToUserId;
  }
  if (updates.dueDate !== undefined) patch.dueDate = new Date(updates.dueDate);
  if (updates.estimatedMinutes !== undefined) {
    patch.estimatedMinutes = updates.estimatedMinutes;
  }
  if (updates.actualMinutes !== undefined) patch.actualMinutes = updates.actualMinutes;
  if (updates.completionNotes !== undefined) {
    patch.completionNotes = updates.completionNotes;
  }
  if (updates.attachmentUrls !== undefined) patch.attachmentUrls = updates.attachmentUrls;
  if (updates.loomUrl !== undefined) patch.loomUrl = updates.loomUrl;

  if (updates.status === "in_progress" && !current.startedAt) patch.startedAt = new Date();
  if (updates.status === "completed" && !current.completedAt) patch.completedAt = new Date();

  const [row] = await db
    .update(vaTasks)
    .set(patch)
    .where(and(eq(vaTasks.id, taskId), eq(vaTasks.organizationId, organizationId)))
    .returning();
  if (!row) throw new VaTaskNotInOrgError(taskId);
  return toVaTask(row);
}

export interface VerifyVaTaskInput {
  verified: boolean;
  notes?: string;
  verifiedByUserId?: string;
}

/**
 * Record a supervisor's review of a completed task.
 *
 * `verified` is nullable in the table on purpose: null means "not reviewed",
 * false means "reviewed and rejected". The previous implementation could express
 * neither — it read-modify-wrote a settings array that nothing ever populated,
 * so it could never find a task to review in the first place.
 */
export async function verifyTask(
  organizationId: number,
  taskId: number,
  input: VerifyVaTaskInput,
): Promise<VaTask> {
  const [row] = await db
    .update(vaTasks)
    .set({
      verified: input.verified,
      verifiedAt: new Date(),
      verifiedByUserId: input.verifiedByUserId ?? null,
      verificationNotes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(vaTasks.id, taskId), eq(vaTasks.organizationId, organizationId)))
    .returning();
  if (!row) throw new VaTaskNotInOrgError(taskId);
  return toVaTask(row);
}

// ============================================
// SOP LIBRARY — persisted in `va_sops`
// ============================================

/** A stored SOP row in this module's `Sop` shape. */
export function toSop(row: VaSopRow): Sop {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    category: row.category,
    description: row.description,
    steps: row.steps,
    estimatedMinutes: row.estimatedMinutes,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSops(organizationId: number): Promise<Sop[]> {
  const rows = await db
    .select()
    .from(vaSops)
    .where(eq(vaSops.organizationId, organizationId))
    .orderBy(vaSops.category, vaSops.title);
  return rows.map(toSop);
}

export interface CreateSopInput {
  title: string;
  category?: TaskCategory;
  description?: string;
  steps?: VaSopStep[];
  estimatedMinutes?: number;
  /** Set when this SOP started as one of DEFAULT_SOPS, so the UI can say so. */
  derivedFromDefaultTitle?: string;
  createdByUserId?: string;
}

export async function createSop(
  organizationId: number,
  input: CreateSopInput,
): Promise<Sop> {
  const [row] = await db
    .insert(vaSops)
    .values({
      organizationId,
      title: input.title,
      category: input.category ?? "other",
      description: input.description ?? "",
      steps: input.steps ?? [],
      estimatedMinutes: input.estimatedMinutes ?? 0,
      derivedFromDefaultTitle: input.derivedFromDefaultTitle ?? null,
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();
  return toSop(row);
}

// ============================================
// PERFORMANCE METRICS
// ============================================

export interface VaPerformanceMetrics {
  userId: string;
  period: "today" | "week" | "month";
  tasksCompleted: number;
  tasksAssigned: number;
  completionRate: number; // %
  avgCompletionHours: number;
  hoursLogged: number;
  leadsContacted: number;
  topCategories: { category: TaskCategory; count: number }[];
}

export function calculateVaMetrics(
  tasks: VaTask[],
  userId: string,
  period: "today" | "week" | "month"
): VaPerformanceMetrics {
  const now = new Date();
  const periodStart =
    period === "today"
      ? startOfDay(now)
      : period === "week"
      ? subDays(now, 7)
      : subDays(now, 30);

  const periodTasks = tasks.filter(
    (t) =>
      t.assignedToUserId === userId &&
      new Date(t.createdAt) >= periodStart
  );

  const completed = periodTasks.filter((t) => t.status === "completed");
  const hoursLogged = periodTasks.reduce(
    (sum, t) => sum + (t.actualMinutes || 0) / 60,
    0
  );

  const avgCompletionMinutes =
    completed.length > 0
      ? completed.reduce((sum, t) => {
          if (t.startedAt && t.completedAt) {
            return (
              sum +
              (new Date(t.completedAt).getTime() -
                new Date(t.startedAt).getTime()) /
                1000 /
                60
            );
          }
          return sum + (t.actualMinutes || 0);
        }, 0) / completed.length
      : 0;

  // Count by category
  const catCounts = new Map<TaskCategory, number>();
  for (const t of completed) {
    catCounts.set(t.category, (catCounts.get(t.category) || 0) + 1);
  }

  const topCategories = Array.from(catCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    userId,
    period,
    tasksCompleted: completed.length,
    tasksAssigned: periodTasks.length,
    completionRate:
      periodTasks.length > 0
        ? Math.round((completed.length / periodTasks.length) * 100)
        : 0,
    avgCompletionHours: Math.round((avgCompletionMinutes / 60) * 10) / 10,
    hoursLogged: Math.round(hoursLogged * 10) / 10,
    leadsContacted: completed.filter((t) => t.category === "outreach" && t.leadId)
      .length,
    topCategories,
  };
}

// ============================================
// DAILY STANDUP DIGEST GENERATION
// ============================================

export function generateStandupDigest(
  tasks: VaTask[],
  userId: string,
  vaName: string,
  date: Date = new Date()
): DailyStandupDigest {
  const dayStart = startOfDay(subDays(date, 1)); // Yesterday
  const dayEnd = endOfDay(subDays(date, 1));

  const yesterdayTasks = tasks.filter(
    (t) =>
      t.assignedToUserId === userId &&
      t.completedAt &&
      new Date(t.completedAt) >= dayStart &&
      new Date(t.completedAt) <= dayEnd
  );

  const inProgress = tasks.filter(
    (t) => t.assignedToUserId === userId && t.status === "in_progress"
  );

  const highlights: string[] = [];
  const blockers: string[] = [];

  for (const t of yesterdayTasks) {
    if (t.category === "research") {
      highlights.push(`✓ Researched: ${t.title}`);
    } else if (t.category === "outreach") {
      highlights.push(`✓ Contacted leads: ${t.title}`);
    } else if (t.category === "data_entry") {
      highlights.push(`✓ Data entry: ${t.title}`);
    } else {
      highlights.push(`✓ Completed: ${t.title}`);
    }
    if (t.completionNotes) highlights.push(`  → ${t.completionNotes}`);
  }

  for (const t of inProgress) {
    blockers.push(`⏳ In progress: ${t.title}${t.status === "blocked" ? " — BLOCKED" : ""}`);
  }

  const hoursLogged =
    yesterdayTasks.reduce((sum, t) => sum + (t.actualMinutes || 0), 0) / 60;

  return {
    date: format(dayStart, "yyyy-MM-dd"),
    va: { userId, name: vaName },
    tasksCompleted: yesterdayTasks.length,
    tasksInProgress: inProgress.length,
    leadsContacted: yesterdayTasks.filter((t) => t.category === "outreach").length,
    propertiesResearched: yesterdayTasks.filter((t) => t.category === "research").length,
    hoursLogged: Math.round(hoursLogged * 10) / 10,
    highlights,
    blockers,
  };
}

// ============================================
// DEFAULT SOP LIBRARY
// ============================================

export const DEFAULT_SOPS: Omit<Sop, "id" | "organizationId" | "createdAt">[] = [
  {
    title: "Research a Property (Due Diligence)",
    category: "research",
    description: "Complete due diligence checklist for a land parcel before making an offer.",
    estimatedMinutes: 45,
    steps: [
      { stepNumber: 1, instruction: "Enter APN in AcreOS → Properties → Run Due Diligence. Note flood zone, wetlands, and road access results." },
      { stepNumber: 2, instruction: "Look up county assessor website. Find assessed value, current tax amount, and any delinquent taxes." },
      { stepNumber: 3, instruction: "Check county GIS for zoning designation. Confirm land use type (residential, agricultural, commercial, etc.)." },
      { stepNumber: 4, instruction: "Search for the APN on Google Maps Satellite view. Screenshot the parcel and surrounding area. Note road access visually." },
      { stepNumber: 5, instruction: "Check county recorder for any recorded liens, easements, or encumbrances against the parcel." },
      { stepNumber: 6, instruction: "Update AcreOS property record with all findings. Attach screenshots. Set due diligence status to 'Complete'." },
      { stepNumber: 7, instruction: "Flag any red flags in the notes field. Tag property appropriately (flood risk, landlocked, back taxes, etc.)." },
    ],
  },
  {
    title: "Call a Seller Lead",
    category: "outreach",
    description: "Script and procedure for calling motivated seller leads.",
    estimatedMinutes: 15,
    steps: [
      { stepNumber: 1, instruction: "Pull up the lead record in AcreOS. Review property details, previous contact history, and any notes." },
      { stepNumber: 2, instruction: "Introduction: 'Hi, is this [Name]? My name is [Name] from [Company]. I'm calling about the land you own at [Address/APN]. Did you receive our letter?'" },
      { stepNumber: 3, instruction: "If interested: Ask 'Would you consider selling? We buy land in cash quickly.' Note their motivation level (1-10 scale)." },
      { stepNumber: 4, instruction: "Ask about back taxes, any liens, or encumbrances. Ask their asking price if they mention one." },
      { stepNumber: 5, instruction: "If motivated: 'Great, we could send you a formal written offer this week. Is email or mail best for you?'" },
      { stepNumber: 6, instruction: "Log the call in AcreOS Activity. Update lead status: hot/warm/cold/not interested. Schedule follow-up if applicable." },
    ],
  },
  {
    title: "Enter Leads from County Tax List",
    category: "data_entry",
    description: "Import tax delinquent property owners into AcreOS as leads.",
    estimatedMinutes: 60,
    steps: [
      { stepNumber: 1, instruction: "Download the county tax delinquent list as CSV. Remove any duplicate APNs." },
      { stepNumber: 2, instruction: "Clean the CSV: ensure columns match AcreOS import format (First Name, Last Name, Address, City, State, ZIP, APN, Tax Amount)." },
      { stepNumber: 3, instruction: "In AcreOS → Leads → Import, upload the CSV. Preview the first 10 rows to verify column mapping." },
      { stepNumber: 4, instruction: "Set source to 'Tax Delinquent List' and tag with county name and list date." },
      { stepNumber: 5, instruction: "After import, verify lead count matches CSV row count. Spot-check 5 random leads for accuracy." },
    ],
  },
  {
    title: "Post Property to Facebook Marketplace",
    category: "marketing",
    description: "Create a Facebook Marketplace listing for a land property.",
    estimatedMinutes: 20,
    steps: [
      { stepNumber: 1, instruction: "Go to AcreOS → Listings → select property → click 'Syndicate'. Check Facebook Marketplace." },
      { stepNumber: 2, instruction: "If Facebook Marketplace integration is not connected, go to Facebook Marketplace manually at facebook.com/marketplace/create/land." },
      { stepNumber: 3, instruction: "Use the pre-formatted listing text from AcreOS (click 'Generate Listing Text'). Copy title, description, and photos." },
      { stepNumber: 4, instruction: "Set price, acreage, and location. Upload all photos (min 5, max 20). Select category: Real Estate > Land." },
      { stepNumber: 5, instruction: "In the listing notes, mention seller financing terms if available. Add AcreOS listing URL in description." },
      { stepNumber: 6, instruction: "Save the Facebook Marketplace listing URL in AcreOS property notes." },
    ],
  },
  {
    title: "Send Weekly Digest to Investor",
    category: "admin",
    description: "Compile and send weekly activity report to the investor.",
    estimatedMinutes: 30,
    steps: [
      { stepNumber: 1, instruction: "Go to AcreOS → Team → Your Profile → Export weekly tasks completed." },
      { stepNumber: 2, instruction: "List all leads contacted this week and their response status (interested, not interested, follow up)." },
      { stepNumber: 3, instruction: "List all properties researched and any notable findings (red flags, good deals, pass)." },
      { stepNumber: 4, instruction: "Note any blockers, questions, or items needing investor decision." },
      { stepNumber: 5, instruction: "Send digest via email or post to team Slack channel before end of day Friday." },
    ],
  },
];

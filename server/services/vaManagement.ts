/**
 * Virtual Assistant (VA) Management Service
 *
 * Enables land investors to manage their VA team:
 * - Assign tasks to specific VAs from lead/property/deal context
 * - VA task queue: focused view showing only assigned work
 * - Daily standup digest: what each VA did yesterday
 * - VA performance metrics: tasks completed, leads touched, response time
 * - SOP (Standard Operating Procedure) library: VAs reference per task type
 * - Time tracking per task for billing/oversight
 */

import { db } from "../db";
import { leads, properties } from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { startOfDay, endOfDay, subDays, format } from "date-fns";

// ============================================
// TYPES — Task assignment system
// ============================================

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
export type TaskCategory =
  | "research" // Due diligence, county research
  | "outreach" // Calling, texting, emailing sellers
  | "data_entry" // Entering leads, updating records
  | "document_prep" // Preparing/organizing documents
  | "follow_up" // Following up on open items
  | "marketing" // Campaign setup, posting listings
  | "admin" // Scheduling, bookkeeping support
  | "other";

export interface VaTask {
  id: string;
  organizationId: number;
  assignedToUserId: number;
  assignedByUserId: number;

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
  id: string;
  organizationId: number;
  title: string;
  category: TaskCategory;
  description: string;
  steps: { stepNumber: number; instruction: string; videoUrl?: string }[];
  estimatedMinutes: number;
  createdAt: string;
}

export interface DailyStandupDigest {
  date: string;
  va: { userId: number; name: string };
  tasksCompleted: number;
  tasksInProgress: number;
  leadsContacted: number;
  propertiesResearched: number;
  hoursLogged: number;
  highlights: string[];
  blockers: string[];
}

// ============================================
// IN-MEMORY STORE (replace with DB tables when schema migration is run)
// These are "virtual" tables backed by organization settings JSON
// until the proper migration adds them
// ============================================

// In production these would be actual DB tables.
// For now, use organization's settings JSON as storage.
const VA_TASKS_KEY = "va_tasks";
const SOP_LIBRARY_KEY = "sop_library";

// ============================================
// TASK MANAGEMENT
// ============================================

export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function generateSopId(): string {
  return `sop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTask(
  input: Omit<VaTask, "id" | "createdAt" | "updatedAt">
): VaTask {
  const now = new Date().toISOString();
  return {
    ...input,
    id: generateTaskId(),
    status: input.status || "pending",
    priority: input.priority || "medium",
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTask(
  task: VaTask,
  updates: Partial<VaTask>
): VaTask {
  return {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
    completedAt:
      updates.status === "completed" && !task.completedAt
        ? new Date().toISOString()
        : task.completedAt,
    startedAt:
      updates.status === "in_progress" && !task.startedAt
        ? new Date().toISOString()
        : task.startedAt,
  };
}

// ============================================
// PERFORMANCE METRICS
// ============================================

export interface VaPerformanceMetrics {
  userId: number;
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
  userId: number,
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
  userId: number,
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

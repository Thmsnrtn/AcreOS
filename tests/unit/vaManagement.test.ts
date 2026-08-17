/**
 * The VA management service's pure layer — tested by CALLING it.
 *
 * WHAT THIS FILE USED TO BE. 232 lines that imported nothing from the service
 * and re-implemented it locally: its `VaTask` interface, `generateTaskId`,
 * `createTask`, `updateTask`, plus four helpers (`calculateCompletionRate`,
 * `filterTasksByCategory`, `getOverdueTasks`, `estimateTotalHours`) that **never
 * existed in the service at all**. Every test passed against a copy. It could
 * not have caught a defect in the shipped code, and it did not notice when that
 * code turned out to store nothing.
 *
 * That is the same shape as `tests/unit/negotiationCopilot.test.ts`, deleted the
 * same day for the same reason. This one is rewritten rather than deleted
 * because the service DOES have a pure layer worth pinning — it just wasn't the
 * one being tested.
 *
 * WHAT IS PURE AND WHAT IS NOT, after the 2026-08-13 persistence work
 * (BLOCKERS B9): `calculateVaMetrics`, `generateStandupDigest` and `toVaTask`
 * are pure and live here. `createTask` / `getTask` / `listTasks` / `updateTask`
 * / `verifyTask` now reach the database, and their invariants — org scoping,
 * derived lifecycle stamps, 404-not-403 on another org's row — are asserted
 * structurally in `vaTaskPersistence.test.ts`, since exercising them needs a
 * Postgres this environment does not have (BLOCKERS B1).
 */

import { describe, it, expect } from "vitest";
import {
  calculateVaMetrics,
  generateStandupDigest,
  toVaTask,
  DEFAULT_SOPS,
  type VaTask,
} from "../../server/services/vaManagement";
import type { VaTaskRow } from "../../shared/schema/va-tasks";

const VA = "user_va_1";
const BOSS = "user_owner_1";

/** A stored task, in the shape the service returns. */
function task(over: Partial<VaTask> = {}): VaTask {
  return {
    id: 1,
    organizationId: 1,
    assignedToUserId: VA,
    assignedByUserId: BOSS,
    title: "Research property in Travis County",
    description: "Look up owner info and tax records",
    category: "research",
    priority: "medium",
    status: "pending",
    attachmentUrls: [],
    estimatedMinutes: 30,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe("calculateVaMetrics", () => {
  it("counts only the named VA's tasks", () => {
    // The parameter exists to answer "how did THIS assistant do". A metric that
    // silently included everyone's work would read as a personal number.
    const metrics = calculateVaMetrics(
      [
        task({ id: 1, assignedToUserId: VA, status: "completed" }),
        task({ id: 2, assignedToUserId: "user_va_2", status: "completed" }),
      ],
      VA,
      "week",
    );
    expect(metrics.tasksAssigned).toBe(1);
    expect(metrics.tasksCompleted).toBe(1);
  });

  it("counts only tasks inside the period", () => {
    const metrics = calculateVaMetrics(
      [
        task({ id: 1, status: "completed", createdAt: hoursAgo(2) }),
        task({ id: 2, status: "completed", createdAt: daysAgo(40) }),
      ],
      VA,
      "week",
    );
    expect(metrics.tasksAssigned).toBe(1);
  });

  it("reports 0% rather than dividing by zero when nothing was assigned", () => {
    const metrics = calculateVaMetrics([], VA, "week");
    expect(metrics.completionRate).toBe(0);
    expect(metrics.avgCompletionHours).toBe(0);
    expect(metrics.hoursLogged).toBe(0);
    expect(metrics.topCategories).toEqual([]);
  });

  it("computes the completion rate over assigned, not over completed", () => {
    const metrics = calculateVaMetrics(
      [
        task({ id: 1, status: "completed" }),
        task({ id: 2, status: "completed" }),
        task({ id: 3, status: "pending" }),
        task({ id: 4, status: "in_progress" }),
      ],
      VA,
      "week",
    );
    expect(metrics.completionRate).toBe(50);
  });

  it("prefers the measured elapsed time over the logged minutes", () => {
    // startedAt→completedAt is what actually happened; actualMinutes is what
    // someone typed. When both exist the measurement wins.
    const metrics = calculateVaMetrics(
      [
        task({
          id: 1,
          status: "completed",
          startedAt: hoursAgo(2),
          completedAt: hoursAgo(0),
          actualMinutes: 5,
        }),
      ],
      VA,
      "week",
    );
    expect(metrics.avgCompletionHours).toBeCloseTo(2, 1);
  });

  it("falls back to logged minutes when the task was never timed", () => {
    const metrics = calculateVaMetrics(
      [task({ id: 1, status: "completed", actualMinutes: 90 })],
      VA,
      "week",
    );
    expect(metrics.avgCompletionHours).toBeCloseTo(1.5, 1);
  });

  it("ranks the top three categories and stops there", () => {
    const completed = (id: number, category: VaTask["category"]) =>
      task({ id, status: "completed", category });
    const metrics = calculateVaMetrics(
      [
        completed(1, "outreach"),
        completed(2, "outreach"),
        completed(3, "outreach"),
        completed(4, "research"),
        completed(5, "research"),
        completed(6, "admin"),
        completed(7, "marketing"),
      ],
      VA,
      "week",
    );
    expect(metrics.topCategories).toHaveLength(3);
    expect(metrics.topCategories[0]).toEqual({ category: "outreach", count: 3 });
    expect(metrics.topCategories[1]).toEqual({ category: "research", count: 2 });
  });

  it("counts a lead as contacted only when the task names one", () => {
    // `leadsContacted` is an outreach task WITH a leadId. Counting outreach
    // tasks with no lead attached would report contact with nobody in
    // particular.
    const metrics = calculateVaMetrics(
      [
        task({ id: 1, status: "completed", category: "outreach", leadId: 7 }),
        task({ id: 2, status: "completed", category: "outreach" }),
        task({ id: 3, status: "completed", category: "research", leadId: 9 }),
      ],
      VA,
      "week",
    );
    expect(metrics.leadsContacted).toBe(1);
  });
});

describe("generateStandupDigest", () => {
  const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };

  it("reports YESTERDAY's completions, not today's", () => {
    // A standup that included this morning's work would double-count it
    // tomorrow.
    const digest = generateStandupDigest(
      [
        task({ id: 1, status: "completed", completedAt: yesterday() }),
        task({ id: 2, status: "completed", completedAt: new Date().toISOString() }),
      ],
      VA,
      "Dana",
    );
    expect(digest.tasksCompleted).toBe(1);
  });

  it("names the assistant it is about", () => {
    const digest = generateStandupDigest([], VA, "Dana");
    expect(digest.va).toEqual({ userId: VA, name: "Dana" });
  });

  it("lists in-progress work as a blocker line, whoever's it is not", () => {
    const digest = generateStandupDigest(
      [
        task({ id: 1, status: "in_progress", title: "Call the Nevada owner" }),
        task({ id: 2, status: "in_progress", assignedToUserId: "user_va_2" }),
      ],
      VA,
      "Dana",
    );
    expect(digest.tasksInProgress).toBe(1);
    expect(digest.blockers.join(" ")).toContain("Call the Nevada owner");
  });

  it("carries the completion note through verbatim when there is one", () => {
    const digest = generateStandupDigest(
      [
        task({
          id: 1,
          status: "completed",
          completedAt: yesterday(),
          title: "Travis County research",
          completionNotes: "Parcel is landlocked — flagged",
        }),
      ],
      VA,
      "Dana",
    );
    expect(digest.highlights.join(" ")).toContain("Parcel is landlocked — flagged");
  });

  it("says nothing at all when there is nothing to say", () => {
    // An empty digest is the honest output for a day with no completed work.
    // The thing to guard against is a filler sentence standing in for one.
    const digest = generateStandupDigest([], VA, "Dana");
    expect(digest.highlights).toEqual([]);
    expect(digest.tasksCompleted).toBe(0);
    expect(digest.hoursLogged).toBe(0);
  });
});

describe("toVaTask maps a stored row without inventing anything", () => {
  const row = (over: Partial<VaTaskRow> = {}): VaTaskRow =>
    ({
      id: 42,
      organizationId: 7,
      assignedToUserId: VA,
      assignedByUserId: BOSS,
      title: "Call the seller",
      description: "",
      category: "outreach",
      priority: "high",
      status: "pending",
      leadId: null,
      propertyId: null,
      dealId: null,
      noteId: null,
      sopId: null,
      dueDate: null,
      estimatedMinutes: null,
      actualMinutes: null,
      startedAt: null,
      completedAt: null,
      completionNotes: null,
      attachmentUrls: [],
      loomUrl: null,
      verified: null,
      verifiedAt: null,
      verifiedByUserId: null,
      verificationNotes: null,
      createdAt: new Date("2026-08-01T09:00:00Z"),
      updatedAt: new Date("2026-08-01T09:00:00Z"),
      ...over,
    }) as VaTaskRow;

  it("keeps an unset optional UNSET rather than defaulting it", () => {
    // A null estimate that arrives as 0 is a forecast nobody made, and it
    // silently changes `estimateTotalHours`-style sums downstream.
    const t = toVaTask(row());
    expect(t.estimatedMinutes).toBeUndefined();
    expect(t.actualMinutes).toBeUndefined();
    expect(t.completedAt).toBeUndefined();
    expect(t.leadId).toBeUndefined();
  });

  it("keeps an unassigned task unassigned", () => {
    // The first draft of the mapper wrote `row.assignedToUserId ?? 0` — user id
    // zero, which is nobody, presented as somebody.
    const t = toVaTask(row({ assignedToUserId: null, assignedByUserId: null }));
    expect(t.assignedToUserId).toBeNull();
    expect(t.assignedByUserId).toBeNull();
  });

  it("renders timestamps as ISO strings", () => {
    const t = toVaTask(row({ completedAt: new Date("2026-08-02T10:30:00Z") }));
    expect(t.createdAt).toBe("2026-08-01T09:00:00.000Z");
    expect(t.completedAt).toBe("2026-08-02T10:30:00.000Z");
  });

  it("carries the id and organization through unchanged", () => {
    const t = toVaTask(row());
    expect(t.id).toBe(42);
    expect(t.organizationId).toBe(7);
  });
});

describe("DEFAULT_SOPS is AcreOS's own catalogue, not customer data", () => {
  it("every default is complete enough to follow", () => {
    // Served by GET /api/va/sops/defaults. A procedure with no steps is a title
    // pretending to be a procedure.
    expect(DEFAULT_SOPS.length).toBeGreaterThan(0);
    for (const sop of DEFAULT_SOPS) {
      expect(sop.title.length, `${sop.title} has no title`).toBeGreaterThan(0);
      expect(sop.steps.length, `${sop.title} has no steps`).toBeGreaterThan(0);
      expect(sop.estimatedMinutes, `${sop.title} has no estimate`).toBeGreaterThan(0);
      for (const step of sop.steps) {
        expect(step.instruction.length, `${sop.title} has an empty step`).toBeGreaterThan(0);
      }
    }
  });

  it("steps are numbered from 1, in order", () => {
    for (const sop of DEFAULT_SOPS) {
      expect(
        sop.steps.map((s) => s.stepNumber),
        `${sop.title} has out-of-order or duplicate step numbers`,
      ).toEqual(sop.steps.map((_, i) => i + 1));
    }
  });
});

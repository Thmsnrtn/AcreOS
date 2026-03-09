/**
 * T283 — VA Management Service Tests
 * Tests task creation, update, and performance metrics calculation.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type TaskPriority = "low" | "medium" | "high" | "urgent";
type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
type TaskCategory = "research" | "outreach" | "data_entry" | "document_prep" | "follow_up" | "marketing" | "admin" | "other";

interface VaTask {
  id: string;
  organizationId: number;
  assignedToUserId: number;
  assignedByUserId: number;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  leadId?: number;
  propertyId?: number;
  dueDate?: string;
  estimatedMinutes?: number;
  actualMinutes?: number;
  startedAt?: string;
  completedAt?: string;
  completionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTask(input: Omit<VaTask, "id" | "createdAt" | "updatedAt">): VaTask {
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

function updateTask(task: VaTask, updates: Partial<VaTask>): VaTask {
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

function calculateCompletionRate(tasks: VaTask[]): number {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter(t => t.status === "completed").length;
  return Math.round((completed / tasks.length) * 100);
}

function filterTasksByCategory(tasks: VaTask[], category: TaskCategory): VaTask[] {
  return tasks.filter(t => t.category === category);
}

function getOverdueTasks(tasks: VaTask[], asOf: Date = new Date()): VaTask[] {
  return tasks.filter(t => {
    if (!t.dueDate || t.status === "completed" || t.status === "cancelled") return false;
    return new Date(t.dueDate) < asOf;
  });
}

function estimateTotalHours(tasks: VaTask[]): number {
  const totalMinutes = tasks.reduce((sum, t) => sum + (t.actualMinutes || t.estimatedMinutes || 0), 0);
  return Math.round((totalMinutes / 60) * 10) / 10;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const baseTaskInput: Omit<VaTask, "id" | "createdAt" | "updatedAt"> = {
  organizationId: 1,
  assignedToUserId: 10,
  assignedByUserId: 5,
  title: "Research property in Travis County",
  description: "Look up owner info and tax records",
  category: "research",
  priority: "medium",
  status: "pending",
  estimatedMinutes: 30,
};

describe("generateTaskId", () => {
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId()));
    expect(ids.size).toBe(100);
  });

  it("prefixes with task_", () => {
    expect(generateTaskId().startsWith("task_")).toBe(true);
  });
});

describe("createTask", () => {
  it("creates a task with generated ID and timestamps", () => {
    const task = createTask(baseTaskInput);
    expect(task.id).toBeTruthy();
    expect(task.id.startsWith("task_")).toBe(true);
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
  });

  it("defaults status to pending", () => {
    const task = createTask({ ...baseTaskInput, status: undefined as any });
    expect(task.status).toBe("pending");
  });

  it("defaults priority to medium", () => {
    const task = createTask({ ...baseTaskInput, priority: undefined as any });
    expect(task.priority).toBe("medium");
  });

  it("preserves all input fields", () => {
    const task = createTask(baseTaskInput);
    expect(task.title).toBe(baseTaskInput.title);
    expect(task.category).toBe("research");
    expect(task.estimatedMinutes).toBe(30);
  });
});

describe("updateTask", () => {
  it("updates specified fields", () => {
    const task = createTask(baseTaskInput);
    const updated = updateTask(task, { title: "Updated title" });
    expect(updated.title).toBe("Updated title");
    expect(updated.category).toBe(task.category); // unchanged
  });

  it("sets startedAt when status changes to in_progress", () => {
    const task = createTask(baseTaskInput);
    expect(task.startedAt).toBeUndefined();
    const updated = updateTask(task, { status: "in_progress" });
    expect(updated.startedAt).toBeTruthy();
  });

  it("sets completedAt when status changes to completed", () => {
    const task = createTask({ ...baseTaskInput, status: "in_progress" });
    const updated = updateTask(task, { status: "completed" });
    expect(updated.completedAt).toBeTruthy();
  });

  it("does not overwrite existing completedAt", () => {
    const task = createTask({ ...baseTaskInput, status: "completed", completedAt: "2024-01-01T10:00:00Z" });
    const updated = updateTask(task, { status: "completed", completionNotes: "Done" });
    expect(updated.completedAt).toBe("2024-01-01T10:00:00Z");
  });

  it("updates the updatedAt timestamp", () => {
    const task = createTask(baseTaskInput);
    const before = task.updatedAt;
    const updated = updateTask(task, { title: "New" });
    // updatedAt should be a valid ISO date
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});

describe("calculateCompletionRate", () => {
  it("returns 0 for empty array", () => {
    expect(calculateCompletionRate([])).toBe(0);
  });

  it("calculates correct percentage", () => {
    const tasks = [
      createTask({ ...baseTaskInput, status: "completed" }),
      createTask({ ...baseTaskInput, status: "completed" }),
      createTask({ ...baseTaskInput, status: "pending" }),
      createTask({ ...baseTaskInput, status: "in_progress" }),
    ];
    expect(calculateCompletionRate(tasks)).toBe(50);
  });

  it("returns 100 when all completed", () => {
    const tasks = Array.from({ length: 3 }, () =>
      createTask({ ...baseTaskInput, status: "completed" })
    );
    expect(calculateCompletionRate(tasks)).toBe(100);
  });
});

describe("getOverdueTasks", () => {
  it("returns tasks past due date", () => {
    const overdue = createTask({ ...baseTaskInput, dueDate: "2023-01-01", status: "pending" });
    const future = createTask({ ...baseTaskInput, dueDate: "2099-01-01", status: "pending" });
    const result = getOverdueTasks([overdue, future]);
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe("2023-01-01");
  });

  it("does not include completed tasks", () => {
    const task = createTask({ ...baseTaskInput, dueDate: "2023-01-01", status: "completed" });
    expect(getOverdueTasks([task])).toHaveLength(0);
  });
});

describe("estimateTotalHours", () => {
  it("sums actual minutes when available", () => {
    const tasks = [
      createTask({ ...baseTaskInput, actualMinutes: 60 }),
      createTask({ ...baseTaskInput, actualMinutes: 90 }),
    ];
    expect(estimateTotalHours(tasks)).toBe(2.5);
  });

  it("falls back to estimated minutes", () => {
    const tasks = [
      createTask({ ...baseTaskInput, estimatedMinutes: 30, actualMinutes: undefined }),
    ];
    expect(estimateTotalHours(tasks)).toBe(0.5);
  });
});

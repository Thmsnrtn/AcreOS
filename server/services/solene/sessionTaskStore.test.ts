/**
 * Tests for Solene sessionTaskStore (Phase 1 / shared-persistence layer).
 *
 * Coverage:
 *  - createTask validates subject + description + blockedBy shape
 *  - createTask inserts a row + returns id
 *  - updateTask validates status + blockedBy shape
 *  - updateTask partial patch only touches the specified fields
 *  - updateTask no-op on empty patch
 *  - listTasks filters by status / owner / conversationId
 *  - listTasks returns rows in createdAt asc
 *  - getTask returns null on miss + row on hit
 *  - blockedBy round-trips as an int array
 *
 * The DB is stubbed in-memory; no Postgres required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface TaskRow {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  conversationId: number | null;
  subject: string;
  description: string;
  status: string;
  activeForm: string | null;
  owner: string | null;
  blockedBy: number[];
  metadata: Record<string, unknown>;
}

const TASKS: TaskRow[] = [];
let nextId = 1;

type Pred = (row: any) => boolean;
interface ClauseEq {
  __kind: "eq";
  column: string;
  value: unknown;
}
interface ClauseAnd {
  __kind: "and";
  parts: Clause[];
}
type Clause = ClauseEq | ClauseAnd;

function colName(col: any): string {
  if (typeof col === "string") return col;
  if (col && typeof col === "object") {
    if (typeof col.__col === "string") return col.__col;
    if (typeof col.name === "string") return col.name;
  }
  return "";
}

function clauseToPred(c: Clause | undefined | null): Pred {
  if (!c) return () => true;
  switch (c.__kind) {
    case "eq":
      return (row) => row[c.column] === c.value;
    case "and": {
      const preds = c.parts.map(clauseToPred);
      return (row) => preds.every((p) => p(row));
    }
    default:
      return () => true;
  }
}

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, value: unknown): Clause => ({
      __kind: "eq",
      column: colName(col),
      value,
    }),
    and: (...parts: Clause[]): Clause => ({
      __kind: "and",
      parts: parts.filter((p) => !!p),
    }),
    asc: (col: any) => ({ __order: "asc", column: colName(col) }),
    desc: (col: any) => ({ __order: "desc", column: colName(col) }),
  };
});

vi.mock("@shared/schema/solene-session-tasks", async () => {
  const real = await vi.importActual<
    typeof import("@shared/schema/solene-session-tasks")
  >("@shared/schema/solene-session-tasks");
  const cols = [
    "id",
    "createdAt",
    "updatedAt",
    "conversationId",
    "subject",
    "description",
    "status",
    "activeForm",
    "owner",
    "blockedBy",
    "metadata",
  ];
  const table: any = { __table: "tasks" };
  for (const c of cols) {
    table[c] = { __col: c, name: c };
  }
  return {
    ...real,
    soleneSessionTasks: table,
  };
});

vi.mock("../../db", () => {
  function chainSelect() {
    let pred: Pred = () => true;
    let orderField: string | null = null;
    let orderDir: "asc" | "desc" = "asc";
    let limitN: number | null = null;
    const obj: any = {
      from(_t: any) {
        return obj;
      },
      where(clause: any) {
        pred = clauseToPred(clause);
        return obj;
      },
      orderBy(spec: any) {
        if (spec && typeof spec === "object" && "__order" in spec) {
          orderDir = spec.__order === "desc" ? "desc" : "asc";
          orderField = spec.column;
        }
        return obj;
      },
      limit(n: number) {
        limitN = n;
        return run();
      },
      then(resolve: any, reject: any) {
        return run().then(resolve, reject);
      },
    };
    function run() {
      let out = TASKS.filter(pred);
      if (orderField) {
        out = [...out].sort((a, b) => {
          const av = (a as any)[orderField!];
          const bv = (b as any)[orderField!];
          if (av instanceof Date && bv instanceof Date) {
            return orderDir === "desc"
              ? bv.getTime() - av.getTime()
              : av.getTime() - bv.getTime();
          }
          if (typeof av === "number" && typeof bv === "number") {
            return orderDir === "desc" ? bv - av : av - bv;
          }
          return 0;
        });
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return Promise.resolve(out.map((r) => ({ ...r })));
    }
    return obj;
  }

  function chainInsert() {
    let row: any = null;
    const obj: any = {
      values(r: any) {
        row = r;
        return obj;
      },
      returning(_c: any) {
        const inserted: TaskRow = {
          id: nextId++,
          createdAt: new Date(),
          updatedAt: new Date(),
          conversationId: row.conversationId ?? null,
          subject: row.subject,
          description: row.description,
          status: row.status ?? "pending",
          activeForm: row.activeForm ?? null,
          owner: row.owner ?? null,
          blockedBy: row.blockedBy ?? [],
          metadata: row.metadata ?? {},
        };
        TASKS.push(inserted);
        return Promise.resolve([{ id: inserted.id }]);
      },
    };
    return obj;
  }

  function chainUpdate() {
    let patch: any = null;
    const obj: any = {
      set(p: any) {
        patch = p;
        return obj;
      },
      where(clause: any) {
        const pred = clauseToPred(clause);
        for (const row of TASKS) {
          if (pred(row)) {
            for (const [k, v] of Object.entries(patch)) {
              (row as any)[k] = v;
            }
          }
        }
        return Promise.resolve();
      },
    };
    return obj;
  }

  const db = {
    insert: (_t: any) => chainInsert(),
    select: () => chainSelect(),
    update: (_t: any) => chainUpdate(),
  };
  return { db };
});

beforeEach(() => {
  TASKS.length = 0;
  nextId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// createTask
// ============================================================================

describe("sessionTaskStore.createTask", () => {
  it("rejects empty subject", async () => {
    const { createTask } = await import("./sessionTaskStore");
    await expect(
      createTask({ subject: "  ", description: "x" }),
    ).rejects.toThrow(/subject must be non-empty/);
  });

  it("rejects empty description", async () => {
    const { createTask } = await import("./sessionTaskStore");
    await expect(
      createTask({ subject: "x", description: "" }),
    ).rejects.toThrow(/description must be non-empty/);
  });

  it("rejects bad blockedBy ids", async () => {
    const { createTask } = await import("./sessionTaskStore");
    await expect(
      createTask({
        subject: "x",
        description: "y",
        blockedBy: [1, 0],
      }),
    ).rejects.toThrow(/positive integers/);
  });

  it("inserts a row with defaults + returns id", async () => {
    const { createTask } = await import("./sessionTaskStore");
    const { taskId } = await createTask({
      subject: "Ship phase 1",
      description: "Land schemas + stores + sync script",
      activeForm: "Shipping phase 1",
    });
    expect(taskId).toBe(1);
    expect(TASKS[0].status).toBe("pending");
    expect(TASKS[0].blockedBy).toEqual([]);
  });

  it("persists blockedBy as an int[]", async () => {
    const { createTask } = await import("./sessionTaskStore");
    await createTask({
      subject: "a",
      description: "b",
      blockedBy: [1, 2, 3],
    });
    expect(TASKS[0].blockedBy).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// updateTask
// ============================================================================

describe("sessionTaskStore.updateTask", () => {
  it("rejects invalid status", async () => {
    const { updateTask } = await import("./sessionTaskStore");
    await expect(
      // @ts-expect-error — intentional bad input
      updateTask(1, { status: "abandoned" }),
    ).rejects.toThrow(/invalid status/);
  });

  it("applies a partial patch only to the specified fields", async () => {
    const { createTask, updateTask, getTask } = await import(
      "./sessionTaskStore"
    );
    const { taskId } = await createTask({
      subject: "Original",
      description: "Untouched description",
      owner: "iris",
    });
    await updateTask(taskId, { status: "in_progress" });
    const row = await getTask(taskId);
    expect(row?.status).toBe("in_progress");
    expect(row?.subject).toBe("Original");
    expect(row?.description).toBe("Untouched description");
    expect(row?.owner).toBe("iris");
  });

  it("is a no-op on empty patch", async () => {
    const { createTask, updateTask, getTask } = await import(
      "./sessionTaskStore"
    );
    const { taskId } = await createTask({
      subject: "Subj",
      description: "Desc",
    });
    const before = await getTask(taskId);
    await updateTask(taskId, {});
    const after = await getTask(taskId);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("updates blockedBy array", async () => {
    const { createTask, updateTask, getTask } = await import(
      "./sessionTaskStore"
    );
    const { taskId } = await createTask({
      subject: "x",
      description: "y",
      blockedBy: [1],
    });
    await updateTask(taskId, { blockedBy: [5, 6] });
    const row = await getTask(taskId);
    expect(row?.blockedBy).toEqual([5, 6]);
  });
});

// ============================================================================
// listTasks
// ============================================================================

describe("sessionTaskStore.listTasks", () => {
  it("filters by status", async () => {
    const { createTask, updateTask, listTasks } = await import(
      "./sessionTaskStore"
    );
    const t1 = await createTask({ subject: "a", description: "a" });
    await createTask({ subject: "b", description: "b" });
    await updateTask(t1.taskId, { status: "completed" });

    const pending = await listTasks({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].subject).toBe("b");

    const completed = await listTasks({ status: "completed" });
    expect(completed).toHaveLength(1);
    expect(completed[0].subject).toBe("a");
  });

  it("filters by owner + conversationId", async () => {
    const { createTask, listTasks } = await import("./sessionTaskStore");
    await createTask({
      subject: "iris-task",
      description: "x",
      owner: "iris",
      conversationId: 10,
    });
    await createTask({
      subject: "soren-task",
      description: "x",
      owner: "soren",
      conversationId: 10,
    });
    await createTask({
      subject: "other-iris",
      description: "x",
      owner: "iris",
      conversationId: 11,
    });

    const irisIn10 = await listTasks({ owner: "iris", conversationId: 10 });
    expect(irisIn10).toHaveLength(1);
    expect(irisIn10[0].subject).toBe("iris-task");
  });
});

// ============================================================================
// getTask
// ============================================================================

describe("sessionTaskStore.getTask", () => {
  it("returns null on miss", async () => {
    const { getTask } = await import("./sessionTaskStore");
    expect(await getTask(999)).toBeNull();
  });
});

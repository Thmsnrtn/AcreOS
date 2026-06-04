/**
 * Tests for Solene memoryFileStore (Phase 1 / shared-persistence layer).
 *
 * Coverage:
 *  - computeBodyHash: deterministic across identical inputs
 *  - parseMemoryFrontmatter: missing frontmatter → unknown
 *  - parseMemoryFrontmatter: each of the 5 type values (user/feedback/project/
 *    reference/unknown) is preserved
 *  - upsertMemoryFile happy path: inserts a new row + sets last_synced_from_local_at
 *  - upsertMemoryFile no-write when hash matches (created=false bodyChanged=false)
 *  - upsertMemoryFile updates when body changes (bodyChanged=true)
 *  - upsertMemoryFile validates slug + type
 *  - deleteMemoryFile removes the row
 *  - listMemoryFiles filters by type
 *  - getMemoryFile + getMemoryFileByBasename
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

interface FileRow {
  id: number;
  slug: string;
  fileBasename: string;
  type: string;
  description: string | null;
  body: string;
  bodySha256: string;
  updatedAt: Date;
  lastSyncedFromLocalAt: Date | null;
  lastSyncedToLocalAt: Date | null;
  metadata: Record<string, unknown>;
}

const FILES: FileRow[] = [];
let nextId = 1;

type Pred = (row: any) => boolean;
interface ClauseEq {
  __kind: "eq";
  column: string;
  value: unknown;
}
type Clause = ClauseEq;

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
  return (row) => row[c.column] === c.value;
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
    and: (...parts: any[]) => parts[0],
    desc: (col: any) => ({ __order: "desc", column: colName(col) }),
    asc: (col: any) => ({ __order: "asc", column: colName(col) }),
  };
});

vi.mock("@shared/schema/solene-memory-files", async () => {
  const real = await vi.importActual<
    typeof import("@shared/schema/solene-memory-files")
  >("@shared/schema/solene-memory-files");
  const cols = [
    "id",
    "slug",
    "fileBasename",
    "type",
    "description",
    "body",
    "bodySha256",
    "updatedAt",
    "lastSyncedFromLocalAt",
    "lastSyncedToLocalAt",
    "metadata",
  ];
  const table: any = { __table: "memory_files" };
  for (const c of cols) {
    table[c] = { __col: c, name: c };
  }
  return {
    ...real,
    soleneMemoryFiles: table,
  };
});

vi.mock("../../db", () => {
  function chainSelect(projection?: any) {
    let pred: Pred = () => true;
    let limitN: number | null = null;
    let orderField: string | null = null;
    let orderDir: "asc" | "desc" = "asc";
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
      let out = FILES.filter(pred);
      if (orderField) {
        out = [...out].sort((a, b) => {
          const av = (a as any)[orderField!];
          const bv = (b as any)[orderField!];
          if (av instanceof Date && bv instanceof Date) {
            return orderDir === "desc"
              ? bv.getTime() - av.getTime()
              : av.getTime() - bv.getTime();
          }
          return 0;
        });
      }
      if (limitN !== null) out = out.slice(0, limitN);
      const projected =
        projection && typeof projection === "object"
          ? out.map((r) => {
              const o: any = {};
              for (const k of Object.keys(projection)) o[k] = (r as any)[k];
              return o;
            })
          : out.map((r) => ({ ...r }));
      return Promise.resolve(projected);
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
      returning(_cols: any) {
        const inserted: FileRow = {
          id: nextId++,
          slug: row.slug,
          fileBasename: row.fileBasename,
          type: row.type,
          description: row.description ?? null,
          body: row.body,
          bodySha256: row.bodySha256,
          updatedAt: row.updatedAt ?? new Date(),
          lastSyncedFromLocalAt: row.lastSyncedFromLocalAt ?? null,
          lastSyncedToLocalAt: row.lastSyncedToLocalAt ?? null,
          metadata: row.metadata ?? {},
        };
        FILES.push(inserted);
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
        for (const row of FILES) {
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

  function chainDelete() {
    const obj: any = {
      where(clause: any) {
        const pred = clauseToPred(clause);
        for (let i = FILES.length - 1; i >= 0; i--) {
          if (pred(FILES[i])) FILES.splice(i, 1);
        }
        return Promise.resolve();
      },
    };
    return obj;
  }

  const db = {
    insert: (_t: any) => chainInsert(),
    select: (projection?: any) => chainSelect(projection),
    update: (_t: any) => chainUpdate(),
    delete: (_t: any) => chainDelete(),
  };
  return { db };
});

beforeEach(() => {
  FILES.length = 0;
  nextId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// computeBodyHash
// ============================================================================

describe("memoryFileStore.computeBodyHash", () => {
  it("is deterministic", async () => {
    const { computeBodyHash } = await import("./memoryFileStore");
    const a = computeBodyHash("hello world");
    const b = computeBodyHash("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes on body change", async () => {
    const { computeBodyHash } = await import("./memoryFileStore");
    expect(computeBodyHash("a")).not.toBe(computeBodyHash("b"));
  });
});

// ============================================================================
// parseMemoryFrontmatter
// ============================================================================

describe("memoryFileStore.parseMemoryFrontmatter", () => {
  it("returns unknown when no frontmatter", async () => {
    const { parseMemoryFrontmatter } = await import("./memoryFileStore");
    expect(parseMemoryFrontmatter("just a body, no frontmatter")).toEqual({
      slug: null,
      description: null,
      type: "unknown",
    });
  });

  it("extracts slug + description + type=user", async () => {
    const { parseMemoryFrontmatter } = await import("./memoryFileStore");
    const body = `---\nname: thomas-norton\ndescription: AcreOS founder\ntype: user\n---\nBody here.`;
    expect(parseMemoryFrontmatter(body)).toEqual({
      slug: "thomas-norton",
      description: "AcreOS founder",
      type: "user",
    });
  });

  it("handles type=feedback", async () => {
    const { parseMemoryFrontmatter } = await import("./memoryFileStore");
    const body = `---\nname: feedback-elite\ntype: feedback\n---\nbody`;
    expect(parseMemoryFrontmatter(body).type).toBe("feedback");
  });

  it("handles type=project", async () => {
    const { parseMemoryFrontmatter } = await import("./memoryFileStore");
    const body = `---\nname: project-x\ntype: project\n---\nbody`;
    expect(parseMemoryFrontmatter(body).type).toBe("project");
  });

  it("handles type=reference", async () => {
    const { parseMemoryFrontmatter } = await import("./memoryFileStore");
    const body = `---\nname: ref-x\ntype: reference\n---\nbody`;
    expect(parseMemoryFrontmatter(body).type).toBe("reference");
  });

  it("falls back to unknown for an unrecognized type", async () => {
    const { parseMemoryFrontmatter } = await import("./memoryFileStore");
    const body = `---\nname: x\ntype: ghost\n---\nbody`;
    expect(parseMemoryFrontmatter(body).type).toBe("unknown");
  });
});

// ============================================================================
// upsertMemoryFile
// ============================================================================

describe("memoryFileStore.upsertMemoryFile", () => {
  it("rejects empty slug", async () => {
    const { upsertMemoryFile } = await import("./memoryFileStore");
    await expect(
      upsertMemoryFile({
        slug: "",
        fileBasename: "x.md",
        type: "user",
        body: "x",
      }),
    ).rejects.toThrow(/slug must be non-empty/);
  });

  it("rejects invalid type", async () => {
    const { upsertMemoryFile } = await import("./memoryFileStore");
    await expect(
      upsertMemoryFile({
        slug: "x",
        fileBasename: "x.md",
        // @ts-expect-error — intentional bad input
        type: "ghost",
        body: "x",
      }),
    ).rejects.toThrow(/invalid type/);
  });

  it("inserts a new row + reports created=true bodyChanged=true", async () => {
    const { upsertMemoryFile } = await import("./memoryFileStore");
    const res = await upsertMemoryFile({
      slug: "team-iris",
      fileBasename: "team_iris.md",
      type: "user",
      description: "CTO",
      body: "# Iris\nCTO.",
    });
    expect(res.created).toBe(true);
    expect(res.bodyChanged).toBe(true);
    expect(FILES).toHaveLength(1);
    expect(FILES[0].lastSyncedFromLocalAt).not.toBeNull();
  });

  it("no-write when hash matches — created=false bodyChanged=false", async () => {
    const { upsertMemoryFile } = await import("./memoryFileStore");
    await upsertMemoryFile({
      slug: "team-iris",
      fileBasename: "team_iris.md",
      type: "user",
      body: "same body",
    });
    const firstUpdatedAt = FILES[0].updatedAt;
    // Force a tick so we'd notice an accidental write.
    await new Promise((r) => setTimeout(r, 5));
    const res = await upsertMemoryFile({
      slug: "team-iris",
      fileBasename: "team_iris.md",
      type: "user",
      body: "same body",
    });
    expect(res.created).toBe(false);
    expect(res.bodyChanged).toBe(false);
    expect(FILES[0].updatedAt).toBe(firstUpdatedAt);
  });

  it("updates when body changes — bodyChanged=true", async () => {
    const { upsertMemoryFile } = await import("./memoryFileStore");
    await upsertMemoryFile({
      slug: "team-iris",
      fileBasename: "team_iris.md",
      type: "user",
      body: "old",
    });
    const res = await upsertMemoryFile({
      slug: "team-iris",
      fileBasename: "team_iris.md",
      type: "user",
      body: "new",
    });
    expect(res.created).toBe(false);
    expect(res.bodyChanged).toBe(true);
    expect(FILES[0].body).toBe("new");
  });
});

// ============================================================================
// delete + list + get
// ============================================================================

describe("memoryFileStore — delete + list + get", () => {
  it("deleteMemoryFile removes the row", async () => {
    const { upsertMemoryFile, deleteMemoryFile, getMemoryFile } = await import(
      "./memoryFileStore"
    );
    await upsertMemoryFile({
      slug: "doomed",
      fileBasename: "doomed.md",
      type: "feedback",
      body: "x",
    });
    expect(await getMemoryFile("doomed")).not.toBeNull();
    await deleteMemoryFile("doomed");
    expect(await getMemoryFile("doomed")).toBeNull();
  });

  it("listMemoryFiles filters by type", async () => {
    const { upsertMemoryFile, listMemoryFiles } = await import(
      "./memoryFileStore"
    );
    await upsertMemoryFile({
      slug: "a",
      fileBasename: "a.md",
      type: "user",
      body: "a",
    });
    await upsertMemoryFile({
      slug: "b",
      fileBasename: "b.md",
      type: "feedback",
      body: "b",
    });
    const users = await listMemoryFiles({ type: "user" });
    expect(users).toHaveLength(1);
    expect(users[0].slug).toBe("a");
  });

  it("getMemoryFileByBasename looks up by filename", async () => {
    const { upsertMemoryFile, getMemoryFileByBasename } = await import(
      "./memoryFileStore"
    );
    await upsertMemoryFile({
      slug: "x",
      fileBasename: "x.md",
      type: "project",
      body: "x",
    });
    const row = await getMemoryFileByBasename("x.md");
    expect(row?.slug).toBe("x");
  });
});

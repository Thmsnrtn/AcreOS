/**
 * db_query_write pre-execution guard (Beatrice security hardening).
 *
 * Mirrors the parseSqlSafety suite, but for the WHERE + organization_id
 * scope guard that runs INSIDE runDestructiveQuery before any write.
 *
 * Verifies:
 *   - DELETE / UPDATE with NO WHERE clause is rejected (would wipe a table)
 *   - org-scoped UPDATE / DELETE on an org-scoped table is ALLOWED
 *   - a write on an org-scoped table whose WHERE does NOT mention
 *     organization_id is rejected (cross-org blast radius)
 *   - an unrecognizable shape (no parseable single table) is rejected
 *   - platform_wide:true waives the guard (allowed) and is surfaced as a
 *     distinct, audited path
 *   - INSERT is unaffected by the WHERE/org guard
 *   - the guard never reaches the actual write when it rejects
 *
 * The db module is mocked so `execute` (a) answers the information_schema
 * column probe used to detect organization_id and (b) records the final
 * mutating statement so we can assert the write did / did not happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A controllable execute() that branches on the SQL text. Hoisted so the
// vi.mock factory (which is itself hoisted) can reference it safely.
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../server/db", () => {
  const fakeDb = { execute: executeMock };
  return { db: fakeDb, dbReplica: null };
});

import {
  DbOpsError,
  runDestructiveQuery,
} from "../../server/services/founder-chat/providers/db-ops";

/**
 * Configure executeMock for a target table that either has or doesn't
 * have an organization_id column. Snapshot selects and the final write
 * resolve to empty results. We record every statement string.
 */
const executed: string[] = [];

function sqlString(arg: unknown): string {
  // db-ops calls db.execute(sql.raw(finalSql)) for the dynamic paths and
  // sql`...` for getTableSchema. Both produce a drizzle SQL object whose
  // `queryChunks` is an array of StringChunk nodes; each StringChunk's
  // `.value` is a string[] (drizzle internals). Join them to reconstruct
  // enough of the statement to branch on (information_schema vs. write).
  const a = arg as { queryChunks?: Array<{ value?: unknown }> };
  if (Array.isArray(a?.queryChunks)) {
    return a.queryChunks
      .map((c) => {
        const v = (c as { value?: unknown }).value;
        if (Array.isArray(v)) return v.join("");
        if (typeof v === "string") return v;
        return "";
      })
      .join(" ");
  }
  return JSON.stringify(arg);
}

function configureTable(hasOrgColumn: boolean) {
  executed.length = 0;
  executeMock.mockReset();
  executeMock.mockImplementation(async (arg: unknown) => {
    const s = sqlString(arg);
    executed.push(s);
    if (/information_schema\.columns/i.test(s)) {
      const rows = hasOrgColumn
        ? [
            { column_name: "id", data_type: "integer", is_nullable: "NO" },
            { column_name: "organization_id", data_type: "integer", is_nullable: "NO" },
            { column_name: "name", data_type: "text", is_nullable: "YES" },
          ]
        : [
            { column_name: "id", data_type: "integer", is_nullable: "NO" },
            { column_name: "name", data_type: "text", is_nullable: "YES" },
          ];
      return { rows, rowCount: rows.length };
    }
    // snapshot SELECT or the final write
    return { rows: [], rowCount: 1 };
  });
}

const didWrite = (): boolean =>
  executed.some((s) => /^\s*(DELETE|UPDATE|INSERT)\b/i.test(s.trim()));

beforeEach(() => {
  configureTable(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("db_query_write guard — no-WHERE rejection", () => {
  it("rejects a DELETE with no WHERE clause and never writes", async () => {
    configureTable(true);
    await expect(
      runDestructiveQuery("DELETE FROM leads"),
    ).rejects.toMatchObject({ kind: "safety" });
    expect(didWrite()).toBe(false);
  });

  it("rejects an UPDATE with no WHERE clause and never writes", async () => {
    configureTable(true);
    await expect(
      runDestructiveQuery("UPDATE leads SET name = 'x'"),
    ).rejects.toBeInstanceOf(DbOpsError);
    expect(didWrite()).toBe(false);
  });
});

describe("db_query_write guard — org scope on org-scoped tables", () => {
  it("ALLOWS an org-scoped UPDATE on a table with organization_id", async () => {
    configureTable(true);
    const r = await runDestructiveQuery(
      "UPDATE leads SET name = 'x' WHERE organization_id = 7 AND id = 3",
    );
    expect(r.rowCount).toBe(1);
    expect(didWrite()).toBe(true);
  });

  it("ALLOWS an org-scoped DELETE (IN form) on a table with organization_id", async () => {
    configureTable(true);
    const r = await runDestructiveQuery(
      "DELETE FROM leads WHERE organization_id IN (7) AND id = 9",
    );
    expect(r.rowCount).toBe(1);
    expect(didWrite()).toBe(true);
  });

  it("rejects a WHERE that does NOT constrain organization_id on an org-scoped table", async () => {
    configureTable(true);
    await expect(
      runDestructiveQuery("DELETE FROM leads WHERE id = 3"),
    ).rejects.toMatchObject({ kind: "safety" });
    expect(didWrite()).toBe(false);
  });

  it("does NOT require organization_id on a table that has no such column", async () => {
    configureTable(false);
    const r = await runDestructiveQuery(
      "DELETE FROM system_flags WHERE id = 3",
    );
    expect(r.rowCount).toBe(1);
    expect(didWrite()).toBe(true);
  });
});

describe("db_query_write guard — unrecognizable shapes", () => {
  it("rejects a multi-table / unparseable DELETE shape without platform_wide", async () => {
    configureTable(true);
    await expect(
      runDestructiveQuery(
        "DELETE FROM leads USING orgs WHERE leads.org_id = orgs.id",
      ),
    ).rejects.toMatchObject({ kind: "safety" });
    expect(didWrite()).toBe(false);
  });
});

describe("db_query_write guard — platform_wide escape hatch", () => {
  it("ALLOWS a no-WHERE DELETE when platform_wide:true", async () => {
    configureTable(true);
    const r = await runDestructiveQuery("DELETE FROM leads", {
      platformWide: true,
    });
    expect(r.rowCount).toBe(1);
    expect(didWrite()).toBe(true);
  });

  it("ALLOWS a cross-org UPDATE (no org filter) when platform_wide:true", async () => {
    configureTable(true);
    const r = await runDestructiveQuery(
      "UPDATE leads SET status = 'archived' WHERE created_at < '2020-01-01'",
      { platformWide: true },
    );
    expect(r.rowCount).toBe(1);
    expect(didWrite()).toBe(true);
  });

  it("defaults to guarded (platform_wide omitted) — same as false", async () => {
    configureTable(true);
    await expect(
      runDestructiveQuery("DELETE FROM leads", {}),
    ).rejects.toMatchObject({ kind: "safety" });
    expect(didWrite()).toBe(false);
  });
});

describe("db_query_write guard — INSERT is out of scope", () => {
  it("ALLOWS an INSERT with no WHERE (INSERT adds rows, not unbounded mutation)", async () => {
    configureTable(true);
    const r = await runDestructiveQuery(
      "INSERT INTO leads (organization_id, name) VALUES (7, 'x')",
    );
    expect(r.rowCount).toBe(1);
    expect(didWrite()).toBe(true);
  });
});

describe("db_query_write guard — read-only statements still refused here", () => {
  it("refuses a SELECT (must use runReadOnlyQuery)", async () => {
    configureTable(true);
    await expect(
      runDestructiveQuery("SELECT * FROM leads"),
    ).rejects.toMatchObject({ kind: "safety" });
    expect(didWrite()).toBe(false);
  });
});

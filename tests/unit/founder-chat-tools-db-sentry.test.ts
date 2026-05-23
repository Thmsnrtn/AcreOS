/**
 * Phase I batch 1 — DB + Sentry read-only operational tools.
 *
 * Verifies:
 *   - parseSqlSafety rejects every dangerous keyword + multi-statement input
 *   - parseSqlSafety accepts pure SELECT / EXPLAIN / SHOW
 *   - db_query refuses destructive SQL WITHOUT touching the DB at all
 *   - All 6 tools register + resolve via their slash aliases
 *   - Sentry missing-token degrades gracefully (text artifact, never throws)
 *
 * Pattern: beforeAll reset + import operations.ts once so the registry
 * side-effects run against a clean Map.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRegistryForTests,
  getTool,
  getToolBySlashAlias,
} from "../../server/services/founder-chat/tool-registry";
import {
  parseSqlSafety,
} from "../../server/services/founder-chat/providers/db-ops";

let realFetch: typeof globalThis.fetch;
const SAVED_ENV: Record<string, string | undefined> = {};

beforeAll(async () => {
  __resetRegistryForTests();
  await import("../../server/services/founder-chat/tools/operations");
});

afterAll(() => {
  __resetRegistryForTests();
});

beforeEach(() => {
  realFetch = globalThis.fetch;
  for (const k of [
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "FLY_API_TOKEN",
  ]) {
    SAVED_ENV[k] = process.env[k];
  }
  process.env.FLY_API_TOKEN = "test_token";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

const FAKE_CTX = {
  founderUserId: "user_test",
  organizationId: 1,
  threadId: 1,
  recentMentions: [],
  auditLog: async () => {},
} as const;

// ──────────────────────────────────────────────────────────────────────────────
// parseSqlSafety
// ──────────────────────────────────────────────────────────────────────────────

describe("parseSqlSafety", () => {
  const DANGEROUS = [
    "INSERT INTO users (id) VALUES (1)",
    "UPDATE users SET name = 'x'",
    "DELETE FROM users",
    "DROP TABLE users",
    "ALTER TABLE users ADD COLUMN x int",
    "CREATE TABLE foo (id int)",
    "TRUNCATE users",
    "GRANT ALL ON users TO public",
    "REVOKE ALL ON users FROM public",
    "VACUUM users",
    "REINDEX TABLE users",
    "CLUSTER users",
    "COPY users FROM '/tmp/x.csv'",
  ];

  it.each(DANGEROUS)("rejects %s", (sql) => {
    const r = parseSqlSafety(sql);
    expect(r.isReadOnly).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("accepts pure SELECT", () => {
    expect(parseSqlSafety("SELECT 1").isReadOnly).toBe(true);
    expect(parseSqlSafety("select * from users where id = 1").isReadOnly).toBe(true);
  });

  it("accepts EXPLAIN", () => {
    expect(parseSqlSafety("EXPLAIN SELECT 1").isReadOnly).toBe(true);
  });

  it("accepts SHOW", () => {
    expect(parseSqlSafety("SHOW search_path").isReadOnly).toBe(true);
  });

  it("accepts a WITH/CTE that wraps a SELECT", () => {
    expect(
      parseSqlSafety("WITH x AS (SELECT 1 AS a) SELECT * FROM x").isReadOnly,
    ).toBe(true);
  });

  it("rejects a CTE that wraps a DELETE", () => {
    const r = parseSqlSafety(
      "WITH d AS (DELETE FROM users RETURNING id) SELECT * FROM d",
    );
    expect(r.isReadOnly).toBe(false);
    expect(r.reason).toMatch(/DELETE/);
  });

  it("rejects multi-statement SQL (SELECT 1; DROP TABLE x)", () => {
    const r = parseSqlSafety("SELECT 1; DROP TABLE x");
    expect(r.isReadOnly).toBe(false);
    expect(r.reason).toMatch(/Multi-statement/i);
  });

  it("permits a trailing semicolon on a single SELECT", () => {
    expect(parseSqlSafety("SELECT 1;").isReadOnly).toBe(true);
  });

  it("does not get fooled by a semicolon inside a string literal", () => {
    expect(parseSqlSafety("SELECT ';'").isReadOnly).toBe(true);
    expect(parseSqlSafety("SELECT ';' AS x").isReadOnly).toBe(true);
  });

  it("rejects empty / whitespace SQL", () => {
    expect(parseSqlSafety("").isReadOnly).toBe(false);
    expect(parseSqlSafety("   \n  ").isReadOnly).toBe(false);
  });

  it("strips comments before parsing", () => {
    expect(parseSqlSafety("-- DROP TABLE users\nSELECT 1").isReadOnly).toBe(true);
    expect(parseSqlSafety("/* DELETE */ SELECT 1").isReadOnly).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tool registration
// ──────────────────────────────────────────────────────────────────────────────

describe("DB + Sentry tools registration", () => {
  it("registers all 6 new tools", () => {
    expect(getTool("db_query")?.name).toBe("db_query");
    expect(getTool("db_list_tables")?.name).toBe("db_list_tables");
    expect(getTool("db_table_schema")?.name).toBe("db_table_schema");
    expect(getTool("db_recent_rows")?.name).toBe("db_recent_rows");
    expect(getTool("sentry_recent_issues")?.name).toBe("sentry_recent_issues");
    expect(getTool("sentry_event")?.name).toBe("sentry_event");
  });

  it("resolves every tool via its slash aliases", () => {
    expect(getToolBySlashAlias("query")?.name).toBe("db_query");
    expect(getToolBySlashAlias("sql")?.name).toBe("db_query");
    expect(getToolBySlashAlias("tables")?.name).toBe("db_list_tables");
    expect(getToolBySlashAlias("schema")?.name).toBe("db_table_schema");
    expect(getToolBySlashAlias("describe")?.name).toBe("db_table_schema");
    expect(getToolBySlashAlias("recent")?.name).toBe("db_recent_rows");
    expect(getToolBySlashAlias("errors")?.name).toBe("sentry_recent_issues");
    expect(getToolBySlashAlias("sentry")?.name).toBe("sentry_recent_issues");
    expect(getToolBySlashAlias("error")?.name).toBe("sentry_event");
  });

  it("every new tool is Tier 1, inquiry, non-destructive, text artifact", () => {
    const NAMES = [
      "db_query",
      "db_list_tables",
      "db_table_schema",
      "db_recent_rows",
      "sentry_recent_issues",
      "sentry_event",
    ];
    for (const name of NAMES) {
      const t = getTool(name)!;
      expect(t.tier).toBe(1);
      expect(t.category).toBe("inquiry");
      expect(t.destructive).toBe(false);
      expect(t.artifactType).toBe("text");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// db_query safety — must NEVER call the DB on destructive SQL
// ──────────────────────────────────────────────────────────────────────────────

describe("db_query safety gate", () => {
  it("refuses destructive SQL with a 'not read-only' message and does not call the DB", async () => {
    const tool = getTool("db_query")!;

    // Spy on the underlying db.execute via the provider — if anything
    // tries to query, this throws and we'd see a different error.
    const dbOps = await import(
      "../../server/services/founder-chat/providers/db-ops"
    );
    const runSpy = vi.spyOn(dbOps, "runReadOnlyQuery");

    const result = await tool.handler(
      { sql: "DROP TABLE users" },
      FAKE_CTX,
    );

    expect(runSpy).not.toHaveBeenCalled();
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/not read-only/i);
      expect(result.artifact.markdown).toMatch(/DROP/);
    }
  });

  it("refuses multi-statement SQL without calling the DB", async () => {
    const tool = getTool("db_query")!;
    const dbOps = await import(
      "../../server/services/founder-chat/providers/db-ops"
    );
    const runSpy = vi.spyOn(dbOps, "runReadOnlyQuery");

    const result = await tool.handler(
      { sql: "SELECT 1; DROP TABLE x" },
      FAKE_CTX,
    );

    expect(runSpy).not.toHaveBeenCalled();
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/not read-only/i);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Sentry — graceful degradation when SENTRY_AUTH_TOKEN is missing
// ──────────────────────────────────────────────────────────────────────────────

describe("Sentry tools missing-token degradation", () => {
  it("sentry_recent_issues returns a text artifact (no throw) when token is unset", async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;

    const tool = getTool("sentry_recent_issues")!;
    const result = await tool.handler({}, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/Sentry unavailable/i);
    }
  });

  it("sentry_event returns a text artifact (no throw) when token is unset", async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;

    const tool = getTool("sentry_event")!;
    const result = await tool.handler({ issueId: "12345" }, FAKE_CTX);
    expect(result.artifact.type).toBe("text");
    if (result.artifact.type === "text") {
      expect(result.artifact.markdown).toMatch(/Sentry unavailable/i);
    }
  });
});

/**
 * Tahoe L12 + L13 — runtime tests for the `app_role` connection brand
 * and the replica-boundary assertion.
 *
 * Verifies:
 *   1. APP_ROLES constants are stable strings.
 *   2. assertRoleAtBoundary() throws when the observed role disagrees
 *      with the expected role.
 *   3. asReadOnlyDb() is an identity cast at runtime.
 *   4. The replica boundary probe (`assertReplicaRoleAtBoundary`):
 *      - returns a soft "no replica configured" pass when
 *        DATABASE_REPLICA_URL is unset.
 *      - warns (does not throw) when the probe reports the connection
 *        is writable and DB_REPLICA_RO_ENFORCED is unset.
 *      - throws when the probe reports writable AND
 *        DB_REPLICA_RO_ENFORCED=1.
 *
 * The pool is mocked so the test runs without a live Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  APP_ROLES,
  isPrimary,
  isReplicaRo,
  type DbRole,
} from "../../shared/db/roles";
import {
  asReadOnlyDb,
  assertRoleAtBoundary,
} from "../../shared/db/read-only";

describe("APP_ROLES", () => {
  it("exposes the two canonical roles", () => {
    expect(APP_ROLES.primary).toBe("primary");
    expect(APP_ROLES.replica_ro).toBe("replica_ro");
  });

  it("type guards correctly classify each role", () => {
    expect(isPrimary(APP_ROLES.primary)).toBe(true);
    expect(isPrimary(APP_ROLES.replica_ro)).toBe(false);
    expect(isReplicaRo(APP_ROLES.replica_ro)).toBe(true);
    expect(isReplicaRo(APP_ROLES.primary)).toBe(false);
  });
});

describe("assertRoleAtBoundary", () => {
  it("passes when actual matches expected", () => {
    expect(() =>
      assertRoleAtBoundary(APP_ROLES.replica_ro, APP_ROLES.replica_ro, "test"),
    ).not.toThrow();
  });

  it("throws when actual disagrees with expected", () => {
    expect(() =>
      assertRoleAtBoundary(
        APP_ROLES.primary,
        APP_ROLES.replica_ro,
        "test-context",
      ),
    ).toThrow(/test-context/);
  });

  it("throws when actual is undefined", () => {
    expect(() =>
      assertRoleAtBoundary(undefined, APP_ROLES.replica_ro, "no-role"),
    ).toThrow(/no-role/);
  });
});

describe("asReadOnlyDb", () => {
  it("is an identity cast at runtime", () => {
    const sentinel = { __tag: "sentinel-drizzle" } as unknown as Parameters<
      typeof asReadOnlyDb
    >[0];
    expect(asReadOnlyDb(sentinel)).toBe(sentinel);
  });
});

// ── assertReplicaRoleAtBoundary ────────────────────────────────────────────
//
// Mock the replica pool's `query()` so the test can flip
// `transaction_read_only` between `on` and `off` without a real Postgres.

const mockReplicaQuery = vi.fn();

vi.mock("pg", () => {
  class Pool {
    on() {
      /* noop */
    }
    query(...args: unknown[]) {
      return mockReplicaQuery(...args);
    }
  }
  return { default: { Pool }, Pool };
});

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({
    __tag: "drizzle-mock",
    select: () => {},
    insert: () => {},
    update: () => {},
    delete: () => {},
    execute: () => {},
    transaction: async (fn: any) => fn({}),
  }),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  requestLoggingMiddleware: vi.fn(),
  errorLoggingMiddleware: vi.fn(),
}));

describe("assertReplicaRoleAtBoundary", () => {
  beforeEach(() => {
    vi.resetModules();
    mockReplicaQuery.mockReset();
    process.env.DATABASE_URL = "postgres://test/primary";
    delete process.env.DB_REPLICA_RO_ENFORCED;
  });

  it("returns a soft pass when no replica is configured", async () => {
    delete process.env.DATABASE_REPLICA_URL;
    const { assertReplicaRoleAtBoundary } = await import("../../server/db");
    const out = await assertReplicaRoleAtBoundary();
    expect(out).toEqual({ reported: null, matches: true });
    expect(mockReplicaQuery).not.toHaveBeenCalled();
  });

  it("matches=true when transaction_read_only=on", async () => {
    process.env.DATABASE_REPLICA_URL = "postgres://test/replica";
    mockReplicaQuery.mockResolvedValue({
      rows: [{ transaction_read_only: "on" }],
    });
    const { assertReplicaRoleAtBoundary } = await import("../../server/db");
    const out = await assertReplicaRoleAtBoundary();
    expect(out).toEqual({ reported: "on", matches: true });
  });

  it("warns (no throw) when read_only=off and enforcement is off", async () => {
    process.env.DATABASE_REPLICA_URL = "postgres://test/replica";
    mockReplicaQuery.mockResolvedValue({
      rows: [{ transaction_read_only: "off" }],
    });
    const { assertReplicaRoleAtBoundary } = await import("../../server/db");
    const out = await assertReplicaRoleAtBoundary({ enforce: false });
    expect(out).toEqual({ reported: "off", matches: false });
  });

  it("throws when read_only=off and enforcement is on", async () => {
    process.env.DATABASE_REPLICA_URL = "postgres://test/replica";
    mockReplicaQuery.mockResolvedValue({
      rows: [{ transaction_read_only: "off" }],
    });
    const { assertReplicaRoleAtBoundary } = await import("../../server/db");
    await expect(
      assertReplicaRoleAtBoundary({ enforce: true }),
    ).rejects.toThrow(/transaction_read_only=off/);
  });

  it("DB_REPLICA_RO_ENFORCED=1 env var triggers enforcement", async () => {
    process.env.DATABASE_REPLICA_URL = "postgres://test/replica";
    process.env.DB_REPLICA_RO_ENFORCED = "1";
    mockReplicaQuery.mockResolvedValue({
      rows: [{ transaction_read_only: "off" }],
    });
    const { assertReplicaRoleAtBoundary } = await import("../../server/db");
    await expect(assertReplicaRoleAtBoundary()).rejects.toThrow();
  });

  it("treats a probe failure as matches=false (and returns null reported)", async () => {
    process.env.DATABASE_REPLICA_URL = "postgres://test/replica";
    mockReplicaQuery.mockRejectedValue(new Error("connection refused"));
    const { assertReplicaRoleAtBoundary } = await import("../../server/db");
    const out = await assertReplicaRoleAtBoundary({ enforce: false });
    expect(out).toEqual({ reported: null, matches: false });
  });
});

describe("DbRole — type-level guard rails (compile-time)", () => {
  it("DbRole union covers every APP_ROLES value", () => {
    // Exhaustiveness: every value in APP_ROLES is a valid DbRole.
    const roles: DbRole[] = Object.values(APP_ROLES);
    expect(roles).toContain(APP_ROLES.primary);
    expect(roles).toContain(APP_ROLES.replica_ro);
    expect(roles).toHaveLength(2);
  });
});

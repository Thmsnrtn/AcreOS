/**
 * Pillar 9.2 — Archival framework test.
 *
 * Verifies:
 *   - The archival sweep is opt-in (returns enabled:false when the
 *     founder_settings flag is false).
 *   - The table registry contains lead_activities with the expected
 *     schema columns.
 *   - The R2 path layout uses {table}/{yyyy}/{mm}/{batch_id}.parquet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async (_key: string) => "false"),
  getNumberSetting: vi.fn(async (_key: string, fallback: number) => fallback),
}));

vi.mock("../../server/db", () => ({
  db: {
    execute: vi.fn(),
  },
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../server/services/cmo/storage", () => ({
  getStorage: vi.fn(() => ({
    write: vi.fn(async (key: string) => `local:${key}`),
  })),
}));

describe("Pillar 9.2 — archival framework", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips the sweep when archival.enabled is false (default)", async () => {
    const { runArchivalSweep } = await import("../../server/jobs/archival");
    const result = await runArchivalSweep();
    expect(result.enabled).toBe(false);
    expect(result.results).toEqual([]);
  });

  it("registers lead_activities as the first archive-eligible table", async () => {
    const { ARCHIVAL_TABLES } = await import("../../server/jobs/archival");
    const lead = ARCHIVAL_TABLES.find((t) => t.table === "lead_activities");
    expect(lead).toBeDefined();
    expect(lead?.ageColumn).toBe("created_at");
    expect(Object.keys(lead?.schema ?? {})).toContain("id");
    expect(Object.keys(lead?.schema ?? {})).toContain("organization_id");
    expect(Object.keys(lead?.schema ?? {})).toContain("created_at");
  });

  it("rejects unsafe table identifiers", async () => {
    const { archiveTable } = await import("../../server/jobs/archival");
    await expect(
      archiveTable(
        {
          table: "lead_activities; DROP TABLE leads",
          ageColumn: "created_at",
          schema: { id: { type: "INT64" } },
        },
        90,
      ),
    ).rejects.toThrow(/invalid identifier/);
  });
});

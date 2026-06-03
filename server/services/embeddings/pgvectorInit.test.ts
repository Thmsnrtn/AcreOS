// ============================================================================
// SERVER/SERVICES/EMBEDDINGS/PGVECTORINIT.TEST.TS
// ----------------------------------------------------------------------------
// Tests for the pgvector availability check + boot-time reporter.
//
// Coverage
// ────────
//   - checkPgvectorStatus → all-true shape when every probe returns rows
//   - checkPgvectorStatus → all-false fields when every probe throws
//   - checkPgvectorStatus → partial: extension installed but table missing
//   - reportPgvectorStatusOnBoot → logs info when available
//   - reportPgvectorStatusOnBoot → logs warn when unavailable
//   - reportPgvectorStatusOnBoot → swallows errors (never throws)
//   - buildHnswIndexName → returns `<table>_<column>_hnsw_idx`
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks — db.execute is the only external dependency. We program a tiny
// router that matches the inbound SQL fragment against three known probes
// (pg_extension / information_schema.tables / pg_indexes) and returns
// either rows or throws.
// ============================================================================

interface ProbeState {
  extensionRow: { extname: string; extversion: string } | null;
  extensionThrow: Error | null;
  tableRow: { table_name: string } | null;
  tableThrow: Error | null;
  indexRow: { indexname: string } | null;
  indexThrow: Error | null;
}

const STATE: ProbeState = {
  extensionRow: null,
  extensionThrow: null,
  tableRow: null,
  tableThrow: null,
  indexRow: null,
  indexThrow: null,
};

function resetState(): void {
  STATE.extensionRow = null;
  STATE.extensionThrow = null;
  STATE.tableRow = null;
  STATE.tableThrow = null;
  STATE.indexRow = null;
  STATE.indexThrow = null;
}

// Walk the drizzle SQL object — it exposes a `.queryChunks` array of
// strings and params. We concatenate the string chunks and use simple
// substring matches to route to the right probe.
function sqlToString(query: any): string {
  if (!query) return "";
  const chunks = query.queryChunks ?? query.chunks ?? [];
  return chunks
    .map((c: any) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object") {
        if (typeof c.value === "string") return c.value;
        if (Array.isArray(c.value)) return c.value.join("");
      }
      return "";
    })
    .join(" ");
}

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn(async (query: any) => {
      const sqlText = sqlToString(query);
      if (sqlText.includes("pg_extension")) {
        if (STATE.extensionThrow) throw STATE.extensionThrow;
        return { rows: STATE.extensionRow ? [STATE.extensionRow] : [] };
      }
      if (sqlText.includes("information_schema.tables")) {
        if (STATE.tableThrow) throw STATE.tableThrow;
        return { rows: STATE.tableRow ? [STATE.tableRow] : [] };
      }
      if (sqlText.includes("pg_indexes")) {
        if (STATE.indexThrow) throw STATE.indexThrow;
        return { rows: STATE.indexRow ? [STATE.indexRow] : [] };
      }
      return { rows: [] };
    }),
  },
}));

const warnSpy = vi.fn();
const infoSpy = vi.fn();
vi.mock("../../utils/logger", () => ({
  logger: {
    info: (...args: unknown[]) => infoSpy(...args),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// System under test
// ============================================================================

import {
  buildHnswIndexName,
  checkPgvectorStatus,
  reportPgvectorStatusOnBoot,
} from "./pgvectorInit";

beforeEach(() => {
  resetState();
  warnSpy.mockReset();
  infoSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// buildHnswIndexName
// ============================================================================

describe("buildHnswIndexName", () => {
  it("returns <table>_<column>_hnsw_idx", () => {
    expect(buildHnswIndexName("solene_embedded_records", "embedding")).toBe(
      "solene_embedded_records_embedding_hnsw_idx",
    );
  });

  it("preserves arbitrary table + column names", () => {
    expect(buildHnswIndexName("foo", "bar")).toBe("foo_bar_hnsw_idx");
  });
});

// ============================================================================
// checkPgvectorStatus
// ============================================================================

describe("checkPgvectorStatus", () => {
  it("returns all-true shape when every probe finds a row", async () => {
    STATE.extensionRow = { extname: "vector", extversion: "0.7.0" };
    STATE.tableRow = { table_name: "solene_embedded_records" };
    STATE.indexRow = {
      indexname: "solene_embedded_records_embedding_hnsw_idx",
    };

    const status = await checkPgvectorStatus();

    expect(status).toEqual({
      available: true,
      extensionInstalled: true,
      tableExists: true,
      indexExists: true,
      detectedVersion: "0.7.0",
    });
  });

  it("returns false fields when every probe throws", async () => {
    STATE.extensionThrow = new Error("boom-ext");
    STATE.tableThrow = new Error("boom-table");
    STATE.indexThrow = new Error("boom-index");

    const status = await checkPgvectorStatus();

    expect(status).toEqual({
      available: false,
      extensionInstalled: false,
      tableExists: false,
      indexExists: false,
      detectedVersion: null,
    });
    // Each probe failure logs its own warn line.
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("treats partial availability as unavailable", async () => {
    STATE.extensionRow = { extname: "vector", extversion: "0.7.0" };
    // table + index missing.

    const status = await checkPgvectorStatus();

    expect(status.available).toBe(false);
    expect(status.extensionInstalled).toBe(true);
    expect(status.tableExists).toBe(false);
    expect(status.indexExists).toBe(false);
    expect(status.detectedVersion).toBe("0.7.0");
  });

  it("handles extension row with null extversion", async () => {
    STATE.extensionRow = { extname: "vector", extversion: null as any };
    STATE.tableRow = { table_name: "solene_embedded_records" };
    STATE.indexRow = {
      indexname: "solene_embedded_records_embedding_hnsw_idx",
    };

    const status = await checkPgvectorStatus();

    expect(status.detectedVersion).toBeNull();
    expect(status.available).toBe(true);
  });
});

// ============================================================================
// reportPgvectorStatusOnBoot
// ============================================================================

describe("reportPgvectorStatusOnBoot", () => {
  it("logs info when pgvector is fully available", async () => {
    STATE.extensionRow = { extname: "vector", extversion: "0.7.0" };
    STATE.tableRow = { table_name: "solene_embedded_records" };
    STATE.indexRow = {
      indexname: "solene_embedded_records_embedding_hnsw_idx",
    };

    await reportPgvectorStatusOnBoot();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toContain("ready");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs warn when pgvector is not fully available", async () => {
    // Extension present, table missing → not available.
    STATE.extensionRow = { extname: "vector", extversion: "0.7.0" };

    await reportPgvectorStatusOnBoot();

    // The warn from the missing-table path is informational (not the
    // probe-failure warn) — assert at least one warn fires.
    expect(warnSpy).toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.find((c) =>
      String(c[0] ?? "").includes("NOT fully available"),
    );
    expect(warnArgs).toBeTruthy();
  });

  it("swallows errors and never throws", async () => {
    // Force every probe to throw — reporter still resolves cleanly.
    STATE.extensionThrow = new Error("boom-ext");
    STATE.tableThrow = new Error("boom-table");
    STATE.indexThrow = new Error("boom-index");

    await expect(reportPgvectorStatusOnBoot()).resolves.toBeUndefined();
    // At minimum the "not fully available" warn fires (plus the per-
    // probe warns from checkPgvectorStatus).
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

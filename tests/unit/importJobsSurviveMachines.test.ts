/**
 * DEFECT-0130 — an import job does not depend on the machine that took the upload.
 *
 * createImportJob wrote the file to the /tmp of the app machine that received
 * it, and stored that path. Fly runs a separate worker machine that also ticks
 * the migration jobs, so the job could be claimed where the file did not
 * exist — it failed after the customer had been told it was queued. A job
 * whose worker died mid-run stayed "running" forever.
 *
 * Now the upload lives in the row, the worker reads it from there, a stale
 * running job is failed with the rows it reached, the API never returns the
 * bytes, and the worker stages lead.created durably.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  executed: [] as string[],
  claimRow: null as Record<string, unknown> | null,
  selectProjection: undefined as unknown,
  importLeads: vi.fn(async (..._args: unknown[]) => ({ totalRows: 1, successCount: 1, errorCount: 0, duplicatesSkipped: 0, errors: [] })),
  readFile: vi.fn(async () => Buffer.from("")),
}));

vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined), readFile: h.readFile },
}));

vi.mock("../../server/db", () => {
  const sqlText = (q: unknown) => {
    const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
    return chunks.map((c) => (typeof c === "object" && c && "value" in c ? (c as { value: string[] }).value.join("") : "?")).join("");
  };
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit"]) c[k] = () => c;
    const p = Promise.resolve([]);
    c.then = p.then.bind(p);
    return c;
  };
  return {
    db: {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          h.inserted.push(v);
          return { returning: async () => [{ id: 5, ...v }] };
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      select: (projection?: unknown) => {
        h.selectProjection = projection;
        return chain();
      },
      execute: async (q: unknown) => {
        const text = sqlText(q);
        h.executed.push(text);
        if (text.includes("SET status = 'running'")) return { rows: h.claimRow ? [h.claimRow] : [] };
        return { rows: [] };
      },
    },
  };
});
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/importExport", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importLeads: h.importLeads,
}));
vi.mock("../../server/services/solene/verifyQueue", () => ({ enqueueImportVerify: vi.fn(), buildImportVerifyCriteria: vi.fn() }));

import { createImportJob, runMigrationJobsTick, getImportJob } from "../../server/services/migrationJobs";

beforeEach(() => {
  h.inserted.length = 0;
  h.executed.length = 0;
  h.claimRow = null;
  h.importLeads.mockClear();
  h.readFile.mockClear();
});

const CSV = Buffer.from("first_name,last_name,email\nAda,Lovelace,ada@example.com\n");

describe("DEFECT-0130 — import jobs survive a different machine claiming them", () => {
  it("the upload is stored on the job row, not in this machine's /tmp", async () => {
    await createImportJob({ organizationId: 7, userId: "u1", kind: "leads", payload: CSV });
    expect(h.inserted).toHaveLength(1);
    expect(Buffer.isBuffer(h.inserted[0].payloadBytes)).toBe(true);
    expect(String(h.inserted[0].payloadRef)).toMatch(/^db:/);
  });

  it("a claimed job runs from the row's bytes, with durable lead events, and never touches disk", async () => {
    h.claimRow = {
      id: 5, organization_id: 7, user_id: "u1", kind: "leads", status: "running",
      payload_ref: "db:import_jobs.payload_bytes", payload_bytes: CSV, field_map: null,
      total_rows: 1, processed_count: 0, success_count: 0, error_count: 0, duplicates_skipped: 0, errors: [],
    };
    const n = await runMigrationJobsTick();
    expect(n).toBe(1);
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.importLeads).toHaveBeenCalledTimes(1);
    expect(h.importLeads.mock.calls[0][2]).toMatchObject({ durableEvents: true });
  });

  it("each tick first fails running jobs whose worker went quiet", async () => {
    await runMigrationJobsTick();
    const sweep = h.executed.find((t) => t.includes("status = 'failed'"));
    expect(sweep, "stale sweep did not run").toBeDefined();
    expect(sweep).toMatch(/status = 'running'/);
    expect(sweep).toMatch(/heartbeat_at/);
    expect(h.executed.indexOf(sweep!)).toBeLessThan(h.executed.findIndex((t) => t.includes("SET status = 'running'")));
  });

  it("the API read never selects the uploaded bytes", async () => {
    await getImportJob(7, 5);
    const projection = h.selectProjection as Record<string, unknown> | undefined;
    expect(projection, "select() with no projection returns every column").toBeDefined();
    expect(Object.keys(projection!)).not.toContain("payloadBytes");
    expect(Object.keys(projection!)).toContain("status");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("DEFECT-0130 — the upload screens report what happened", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

  it("onboarding branches on 202 vs counts and never reads a shape the server does not send", () => {
    const src = read("client/src/pages/onboarding-v2.tsx");
    expect(src).not.toMatch(/result\.imported \?\? result\.count/);
    expect(src).not.toMatch(/Leads imported successfully\./);
    expect(src).toMatch(/status === 202 && body\?\.jobId/);
    expect(src).toMatch(/body\?\.successCount/);
  });

  it("the data-import page only says 'queued' for a queued job", () => {
    const src = read("client/src/pages/data-import.tsx");
    expect(src).toMatch(/if \(status === 202\)\s*\{\s*toast\(\{ title: "Import queued"/);
  });
});

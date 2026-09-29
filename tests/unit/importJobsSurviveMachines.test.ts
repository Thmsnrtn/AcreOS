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
 *
 * DEFECT-0143 (below): an imported DOCUMENT's bytes go to the org's S3
 * namespace, or the file is refused — never to the worker's /tmp.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  executed: [] as string[],
  claimRow: null as Record<string, unknown> | null,
  selectProjection: undefined as unknown,
  importLeads: vi.fn(async (..._args: unknown[]) => ({ totalRows: 1, successCount: 1, errorCount: 0, duplicatesSkipped: 0, errors: [] })),
  readFile: vi.fn(async () => Buffer.from("")),
  sets: [] as Array<Record<string, unknown>>,
  noLongerRunning: false,
  exportClaim: null as Record<string, unknown> | null,
  selectRows: [] as unknown[][],
  writeFile: vi.fn(async () => undefined),
  docStoreConfigured: false,
  putOrgObject: vi.fn(async (orgId: number, key: string, _b: Buffer) => `s3://acre-docs/org/${orgId}/${key}`),
  getOrgObject: vi.fn(async (_orgId: number, _ref: string) => Buffer.from("stored-bytes")),
}));

vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn(async () => undefined), writeFile: h.writeFile, readFile: h.readFile },
}));

vi.mock("../../server/db", () => {
  const sqlText = (q: unknown) => {
    const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
    return chunks.map((c) => (typeof c === "object" && c && "value" in c ? (c as { value: string[] }).value.join("") : "?")).join("");
  };
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const k of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin", "groupBy"]) c[k] = () => c;
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(h.selectRows.shift() ?? []).then(f, r);
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
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => {
            h.sets.push(patch);
            const p = Promise.resolve(undefined);
            return { returning: async () => (h.noLongerRunning ? [] : [{ id: 5 }]), then: p.then.bind(p) };
          },
        }),
      }),
      select: (projection?: unknown) => {
        h.selectProjection = projection;
        return chain();
      },
      execute: async (q: unknown) => {
        const text = sqlText(q);
        h.executed.push(text);
        if (text.includes("UPDATE export_jobs") && text.includes("SET status = 'running'")) return { rows: h.exportClaim ? [h.exportClaim] : [] };
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
vi.mock("../../server/services/documentStore", () => ({
  documentStoreConfigured: () => h.docStoreConfigured,
  putOrgObject: h.putOrgObject,
  getOrgObject: h.getOrgObject,
}));

import {
  buildZipArchive,
  createImportJob,
  runMigrationJobsTick,
  getImportJob,
  getExportJob,
  readExportArchive,
} from "../../server/services/migrationJobs";

beforeEach(() => {
  h.inserted.length = 0;
  h.executed.length = 0;
  h.claimRow = null;
  h.sets.length = 0;
  h.noLongerRunning = false;
  h.exportClaim = null;
  h.selectRows.length = 0;
  h.writeFile.mockClear();
  h.importLeads.mockClear();
  h.readFile.mockReset();
  h.readFile.mockResolvedValue(Buffer.from(""));
  h.docStoreConfigured = false;
  h.putOrgObject.mockClear();
  h.getOrgObject.mockClear();
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

  it("a job swept while still working stops, and never flips to completed", async () => {
    h.claimRow = {
      id: 5, organization_id: 7, user_id: "u1", kind: "leads", status: "running",
      payload_ref: "db:import_jobs.payload_bytes", payload_bytes: CSV, field_map: null,
      total_rows: 1, processed_count: 0, success_count: 0, error_count: 0, duplicates_skipped: 0, errors: [],
    };
    h.noLongerRunning = true; // the stale sweep failed it between chunks
    await runMigrationJobsTick();
    expect(h.sets.some((p) => p.status === "completed")).toBe(false);
    expect(h.sets.some((p) => "heartbeatAt" in p)).toBe(true);
  });

  it("DEFECT-0142: a built export archive is stored on the row, not in this machine's /tmp", async () => {
    h.exportClaim = {
      id: 9, organization_id: 7, user_id: "u1", kind: "everything", status: "running",
      params: { entityTypes: ["audit-log"], includeAttachments: false }, archive_path: null, archive_bytes: null,
    };
    await runMigrationJobsTick();
    const done = h.sets.find((p) => p.status === "completed");
    expect(done, `export did not complete: ${JSON.stringify(h.sets.map((p) => p.errorMessage ?? p.status))}`).toBeDefined();
    expect(Buffer.isBuffer(done!.archiveBytes)).toBe(true);
    expect(String(done!.archivePath)).toMatch(/^db:/);
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it("DEFECT-0142: the download reads the row's bytes, and refuses an expired archive", async () => {
    const zip = Buffer.from("PK-zip");
    h.selectRows.push([{ archiveBytes: zip, archivePath: "db:export_jobs.archive_bytes", expiresAt: new Date(Date.now() + 60_000) }]);
    expect(await readExportArchive(9, 7)).toEqual(zip);
    h.selectRows.push([{ archiveBytes: zip, archivePath: "db:export_jobs.archive_bytes", expiresAt: new Date(Date.now() - 60_000) }]);
    expect(await readExportArchive(9, 7)).toBeNull();
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it("DEFECT-0142: the export API read never selects the archive bytes", async () => {
    await getExportJob(7, 9);
    const projection = h.selectProjection as Record<string, unknown> | undefined;
    expect(projection).toBeDefined();
    expect(Object.keys(projection!)).not.toContain("archiveBytes");
    expect(Object.keys(projection!)).toContain("status");
  });

  it("the API read never selects the uploaded bytes", async () => {
    await getImportJob(7, 5);
    const projection = h.selectProjection as Record<string, unknown> | undefined;
    expect(projection, "select() with no projection returns every column").toBeDefined();
    expect(Object.keys(projection!)).not.toContain("payloadBytes");
    expect(Object.keys(projection!)).toContain("status");
  });
});

// ── DEFECT-0143 / founder ruling 2026-09-29 #1 ──────────────────────────────
// A documents import wrote each file to the worker's /tmp and counted it
// imported; the next deploy lost it, and the export re-pack skipped the gap
// silently. Now the bytes go to the org's S3 namespace before the record, or
// the file is refused with a reason.
describe("DEFECT-0143 — imported documents are kept in the document store, or refused", () => {
  async function documentsJob() {
    const zip = await buildZipArchive([{ name: "lead_ada@example.com.pdf", data: Buffer.from("%PDF-deed") }]);
    h.claimRow = {
      id: 5, organization_id: 7, user_id: "u1", kind: "documents", status: "running",
      payload_ref: "db:import_jobs.payload_bytes", payload_bytes: zip, field_map: null,
      total_rows: 1, processed_count: 0, success_count: 0, error_count: 0, duplicates_skipped: 0, errors: [],
    };
    h.selectRows.push([{ id: 11 }]); // the lead the filename names, in org 7
  }
  const activityRows = () => h.inserted.filter((v) => v.action === "document_imported");

  it("storage not configured: the file is refused with a reason, nothing is recorded, nothing touches /tmp", async () => {
    await documentsJob();
    await runMigrationJobsTick();
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.putOrgObject).not.toHaveBeenCalled();
    expect(activityRows()).toEqual([]);
    const done = h.sets.find((p) => p.status === "completed");
    expect(done).toMatchObject({ successCount: 0, errorCount: 1 });
    expect(JSON.stringify(done!.errors)).toMatch(/Document storage isn't connected, so lead_ada@example.com.pdf was not kept/);
  });

  it("storage configured: the bytes go to the org's namespace first and the record carries the reference", async () => {
    h.docStoreConfigured = true;
    await documentsJob();
    await runMigrationJobsTick();
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.putOrgObject).toHaveBeenCalledTimes(1);
    const [orgId, key, bytes] = h.putOrgObject.mock.calls[0];
    expect(orgId).toBe(7);
    expect(key).toBe("imports/5/0-lead_ada@example.com.pdf");
    expect(bytes.toString()).toBe("%PDF-deed");
    const [row] = activityRows();
    expect(row).toMatchObject({ organizationId: 7, entityType: "lead", entityId: 11 });
    expect(row.metadata).toEqual({
      filename: "lead_ada@example.com.pdf",
      sizeBytes: 9,
      ref: "s3://acre-docs/org/7/imports/5/0-lead_ada@example.com.pdf",
    });
    expect(h.sets.find((p) => p.status === "completed")).toMatchObject({ successCount: 1, errorCount: 0 });
  });

  it("the export re-packs stored documents from the org's namespace and COUNTS the ones it could not include", async () => {
    h.exportClaim = {
      id: 9, organization_id: 7, user_id: "u1", kind: "everything", status: "running",
      params: { entityTypes: [], includeAttachments: true }, archive_path: null, archive_bytes: null,
    };
    h.readFile.mockRejectedValue(new Error("ENOENT")); // the legacy /tmp file is gone
    h.selectRows.push([
      { entityType: "lead", entityId: 11, metadata: { filename: "a.pdf", ref: "s3://acre-docs/org/7/imports/5/0-a.pdf" } },
      { entityType: "lead", entityId: 12, metadata: { filename: "b.pdf", path: "/tmp/acreos-migration-jobs/doc-4-0-b.pdf" } },
    ]);
    await runMigrationJobsTick();
    expect(h.getOrgObject).toHaveBeenCalledWith(7, "s3://acre-docs/org/7/imports/5/0-a.pdf");
    const done = h.sets.find((p) => p.status === "completed");
    expect(done, `export did not complete: ${JSON.stringify(h.sets.map((p) => p.errorMessage ?? p.status))}`).toBeDefined();
    expect(done!.entityCounts).toMatchObject({ attachments: 1, attachmentsMissing: 1 });
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

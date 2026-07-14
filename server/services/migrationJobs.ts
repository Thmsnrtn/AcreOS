/**
 * Phase 4 Week 15-16 — Migration In/Out Parity worker
 *
 * Magdalena §1 (import) + Tobiah §1 (export consolidation).
 *
 * Two job kinds backed by `import_jobs` / `export_jobs`:
 *
 *   IMPORT
 *     - kind=leads|properties|deals|notes  → CSV body, chunked at 500 rows
 *     - kind=communications                → CSV with leadEmail,channel,body,…
 *     - kind=documents                     → ZIP whose entries are matched to
 *                                            leads/properties by filename
 *
 *   EXPORT
 *     - kind=everything                    → single ZIP with leads.csv,
 *                                            properties.csv, deals.csv,
 *                                            communications.csv, notes.csv,
 *                                            audit-log.csv, attachments/,
 *                                            schema.json, README.md
 *
 * Workers run on a self-rescheduling tick driven by the existing scheduler.
 * Caps:
 *   - 50,000 rows per import (fail-fast above this)
 *   - 500 rows processed per chunk (yields between chunks)
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { eq, and, asc, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import {
  importJobs,
  exportJobs,
  leads,
  properties,
  deals,
  conversations,
  messages,
  teamMembers,
  activityLog,
  type ImportJob,
  type ExportJob,
} from "@shared/schema";
import { logger } from "../utils/logger";
import {
  parseCSV,
  importLeads,
  importProperties,
  importDeals,
  importNotesFromCSV,
  exportLeadsToCSV,
  exportPropertiesToCSV,
  exportDealsToCSV,
  exportNotesToCSV,
} from "./importExport";

const deflateRaw = promisify(zlib.deflateRaw);

export const MAX_IMPORT_ROWS = 50_000;
export const IMPORT_CHUNK_SIZE = 500;

// Where intermediate CSV/ZIP payloads live. /tmp is fine for dev + Fly.io
// (ephemeral but cleaned up on each deploy).
const STORAGE_DIR = path.join(os.tmpdir(), "acreos-migration-jobs");

async function ensureStorageDir(): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

// ─── Tiny pure-JS ZIP writer/reader ──────────────────────────────────────────
// We can't add new deps mid-task, so we ship a minimal ZIP encoder that
// supports DEFLATE compression. Good enough for export archives that are
// dominated by CSV text — the format is the standard PKZIP format that
// any unzip tool understands.
//
// We only implement what we need:
//   - Local file headers + central directory + EOCD
//   - DEFLATE compression (zlib.deflateRaw)
//   - CRC32 (precomputed table)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

export async function buildZipArchive(entries: ZipEntry[]): Promise<Buffer> {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = await deflateRaw(entry.data);
    const crc = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // bit flag — UTF-8 names
    localHeader.writeUInt16LE(8, 8); // compression = deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localChunks.push(localHeader, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // bit flag
    central.writeUInt16LE(8, 10); // compression
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // offset of local header

    centralChunks.push(central, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

/**
 * Read a ZIP buffer and return the list of (name, data) entries.
 * Supports stored (compression=0) and deflated (compression=8).
 */
export function readZipArchive(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break; // first non-local signals end of file headers
    const compression = buf.readUInt16LE(i + 8);
    const compressedSize = buf.readUInt32LE(i + 18);
    const uncompressedSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = buf.slice(nameStart, nameStart + nameLen).toString("utf8");
    const compressed = buf.slice(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (compression === 0) {
      data = compressed;
    } else if (compression === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${compression}`);
    }
    if (data.length !== uncompressedSize) {
      // tolerate but warn — some encoders don't write sizes correctly
      logger.warn("[migrationJobs] ZIP entry size mismatch", {
        name,
        declared: uncompressedSize,
        actual: data.length,
      });
    }
    entries.push({ name, data });
    i = dataStart + compressedSize;
  }
  return entries;
}

// ─── Job lifecycle helpers ───────────────────────────────────────────────────

export async function createImportJob(input: {
  organizationId: number;
  userId: string;
  kind: ImportJob["kind"];
  filename?: string;
  payload: Buffer;
  fieldMap?: Record<string, string>;
}): Promise<ImportJob> {
  await ensureStorageDir();

  // Pre-scan CSV for total rows and reject too-large uploads early.
  let totalRows = 0;
  if (input.kind !== "documents") {
    const csvString = input.payload.toString("utf8");
    const parsed = parseCSV(csvString);
    if (parsed.length > MAX_IMPORT_ROWS) {
      throw new Error(
        `CSV file exceeds maximum of ${MAX_IMPORT_ROWS.toLocaleString()} rows. ` +
          `Got ${parsed.length.toLocaleString()}. Please split into smaller files.`
      );
    }
    totalRows = parsed.length;
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: input.kind,
      status: "queued",
      filename: input.filename ?? null,
      fieldMap: input.fieldMap ?? null,
      totalRows,
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      duplicatesSkipped: 0,
      errors: [],
    })
    .returning();

  // Stash payload to disk now that we have an ID. (S3 in production; tmpdir
  // here keeps the worker self-contained for dev.)
  const payloadPath = path.join(STORAGE_DIR, `import-${job.id}.bin`);
  await fs.writeFile(payloadPath, input.payload);
  await db
    .update(importJobs)
    .set({ payloadRef: payloadPath })
    .where(eq(importJobs.id, job.id));

  return { ...job, payloadRef: payloadPath };
}

export async function createExportJob(input: {
  organizationId: number;
  userId: string;
  params: ExportJob["params"];
}): Promise<ExportJob> {
  await ensureStorageDir();
  const [job] = await db
    .insert(exportJobs)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      kind: "everything",
      status: "queued",
      params: input.params,
    })
    .returning();
  return job;
}

export async function getImportJob(orgId: number, jobId: number): Promise<ImportJob | null> {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, jobId), eq(importJobs.organizationId, orgId)))
    .limit(1);
  return job ?? null;
}

export async function getExportJob(orgId: number, jobId: number): Promise<ExportJob | null> {
  const [job] = await db
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.id, jobId), eq(exportJobs.organizationId, orgId)))
    .limit(1);
  return job ?? null;
}

export async function listImportJobs(orgId: number, limit = 25): Promise<ImportJob[]> {
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.organizationId, orgId))
    .orderBy(sql`${importJobs.createdAt} DESC`)
    .limit(limit);
}

export async function listExportJobs(orgId: number, limit = 25): Promise<ExportJob[]> {
  return db
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.organizationId, orgId))
    .orderBy(sql`${exportJobs.createdAt} DESC`)
    .limit(limit);
}

// ─── Worker tick ─────────────────────────────────────────────────────────────

/**
 * Pick up the oldest queued import or export job and run it to completion.
 * Returns the count of jobs processed (0 or 1) so the scheduler can report
 * `recordsProcessed`.
 */
export async function runMigrationJobsTick(): Promise<number> {
  const importJob = await claimNextImportJob();
  if (importJob) {
    await runImportJob(importJob);
    return 1;
  }
  const exportJob = await claimNextExportJob();
  if (exportJob) {
    await runExportJob(exportJob);
    return 1;
  }
  return 0;
}

async function claimNextImportJob(): Promise<ImportJob | null> {
  // Atomic claim: SET status=running WHERE status=queued, returning row.
  const result = await db.execute(sql`
    UPDATE import_jobs
       SET status = 'running', started_at = now()
     WHERE id = (
       SELECT id FROM import_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *
  `);
  const row = (result as { rows?: any[] }).rows?.[0];
  if (!row) return null;
  return mapImportJobRow(row);
}

async function claimNextExportJob(): Promise<ExportJob | null> {
  const result = await db.execute(sql`
    UPDATE export_jobs
       SET status = 'running', started_at = now()
     WHERE id = (
       SELECT id FROM export_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *
  `);
  const row = (result as { rows?: any[] }).rows?.[0];
  if (!row) return null;
  return mapExportJobRow(row);
}

function mapImportJobRow(row: any): ImportJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    filename: row.filename,
    payloadRef: row.payload_ref,
    fieldMap: row.field_map,
    totalRows: row.total_rows,
    processedCount: row.processed_count,
    successCount: row.success_count,
    errorCount: row.error_count,
    duplicatesSkipped: row.duplicates_skipped,
    errors: row.errors ?? [],
    result: row.result,
    errorMessage: row.error_message,
    verifyStatus: row.verify_status ?? null,
    verifyFindings: row.verify_findings ?? null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapExportJobRow(row: any): ExportJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    kind: row.kind,
    status: row.status,
    params: row.params ?? {},
    archivePath: row.archive_path,
    archiveSizeBytes: row.archive_size_bytes,
    entityCounts: row.entity_counts,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
}

// ─── Import worker ───────────────────────────────────────────────────────────

async function runImportJob(job: ImportJob): Promise<void> {
  try {
    if (!job.payloadRef) throw new Error("Import job missing payload reference");
    const payload = await fs.readFile(job.payloadRef);

    if (job.kind === "documents") {
      const result = await processDocumentImport(job, payload);
      await markImportComplete(job, result);
      return;
    }

    if (job.kind === "communications") {
      const result = await processCommunicationsImport(job, payload);
      await markImportComplete(job, result);
      return;
    }

    // CSV-shaped imports: leads / properties / deals / notes
    const csvData = parseCSV(payload.toString("utf8"));
    const total = csvData.length;
    let success = 0;
    let errorCount = 0;
    let dupes = 0;
    const errorSamples: Array<{ row: number; error: string }> = [];

    for (let offset = 0; offset < total; offset += IMPORT_CHUNK_SIZE) {
      const chunk = csvData.slice(offset, offset + IMPORT_CHUNK_SIZE);
      const chunkResult = await runImportChunk(job, chunk);
      success += chunkResult.successCount;
      errorCount += chunkResult.errorCount;
      dupes += chunkResult.duplicatesSkipped;
      for (const e of chunkResult.errors) {
        if (errorSamples.length < 100) {
          errorSamples.push({ row: offset + e.row, error: e.error });
        }
      }
      await db
        .update(importJobs)
        .set({
          processedCount: offset + chunk.length,
          successCount: success,
          errorCount,
          duplicatesSkipped: dupes,
          errors: errorSamples,
        })
        .where(eq(importJobs.id, job.id));
    }

    await markImportComplete(job, {
      totalRows: total,
      successCount: success,
      errorCount,
      duplicatesSkipped: dupes,
      errors: errorSamples,
    });
  } catch (err) {
    logger.error("[migrationJobs] Import job failed", { jobId: job.id, error: err });
    await db
      .update(importJobs)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      })
      .where(eq(importJobs.id, job.id));
  }
}

async function runImportChunk(
  job: ImportJob,
  chunk: Array<Record<string, string>>
): Promise<{
  successCount: number;
  errorCount: number;
  duplicatesSkipped: number;
  errors: Array<{ row: number; error: string }>;
}> {
  if (job.kind === "leads") {
    const r = await importLeads(chunk, job.organizationId, {
      fieldMap: job.fieldMap,
    });
    return {
      successCount: r.successCount,
      errorCount: r.errorCount,
      duplicatesSkipped: r.duplicatesSkipped,
      errors: r.errors.map((e) => ({ row: e.row, error: e.error })),
    };
  }
  if (job.kind === "properties") {
    const r = await importProperties(chunk, job.organizationId);
    return {
      successCount: r.successCount,
      errorCount: r.errorCount,
      duplicatesSkipped: r.duplicatesSkipped,
      errors: r.errors.map((e) => ({ row: e.row, error: e.error })),
    };
  }
  if (job.kind === "deals") {
    const r = await importDeals(chunk, job.organizationId);
    return {
      successCount: r.successCount,
      errorCount: r.errorCount,
      duplicatesSkipped: r.duplicatesSkipped,
      errors: r.errors.map((e) => ({ row: e.row, error: e.error })),
    };
  }
  if (job.kind === "notes") {
    const r = await importNotesFromCSV(chunk, job.organizationId, job.fieldMap ?? undefined);
    return {
      successCount: r.successCount,
      errorCount: r.errorCount,
      duplicatesSkipped: r.duplicatesSkipped,
      errors: r.errors.map((e) => ({ row: e.row, error: e.error })),
    };
  }
  throw new Error(`Unsupported import kind for chunked CSV: ${job.kind}`);
}

async function processCommunicationsImport(
  job: ImportJob,
  payload: Buffer
): Promise<{
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicatesSkipped: number;
  errors: Array<{ row: number; error: string }>;
}> {
  const rows = parseCSV(payload.toString("utf8"));
  let success = 0;
  let errorCount = 0;
  const errorSamples: Array<{ row: number; error: string }> = [];

  // Cache lead lookups by email so a 1K-row import doesn't fire 1K queries.
  const leadByEmail = new Map<string, number>();

  for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      const rowNumber = i + j + 2; // +2 for 1-based + header row
      try {
        const email = (row.leadEmail || row.email || "").trim().toLowerCase();
        const channel = (row.channel || "email").trim().toLowerCase();
        const body = (row.body || row.content || "").trim();
        const direction = (row.direction || "inbound").trim().toLowerCase();
        const sentAtRaw = row.sentAt || row.timestamp || row.createdAt;
        if (!email) throw new Error("leadEmail is required");
        if (!body) throw new Error("body is required");

        let leadId = leadByEmail.get(email);
        if (!leadId) {
          const [match] = await db
            .select({ id: leads.id })
            .from(leads)
            .where(and(eq(leads.organizationId, job.organizationId), eq(leads.email, email)))
            .limit(1);
          if (!match) throw new Error(`No lead found with email ${email}`);
          leadId = match.id;
          leadByEmail.set(email, leadId);
        }

        const sentAt = sentAtRaw ? new Date(sentAtRaw) : new Date();
        if (isNaN(sentAt.getTime())) throw new Error("Invalid sentAt timestamp");

        // Find-or-create a conversation per lead+channel.
        let [convo] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, job.organizationId),
              eq(conversations.leadId, leadId),
              eq(conversations.channel, channel)
            )
          )
          .limit(1);
        if (!convo) {
          [convo] = await db
            .insert(conversations)
            .values({
              organizationId: job.organizationId,
              leadId,
              channel,
              status: "active",
            })
            .returning();
        }

        await db.insert(messages).values({
          conversationId: convo.id,
          organizationId: job.organizationId,
          direction: direction === "outbound" ? "outbound" : "inbound",
          sender: direction === "outbound" ? "human" : "lead",
          content: body,
          status: "delivered",
          createdAt: sentAt,
          metadata: { importedFrom: "migration", originalRow: rowNumber },
        });

        success++;
      } catch (err) {
        errorCount++;
        if (errorSamples.length < 100) {
          errorSamples.push({
            row: rowNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await db
      .update(importJobs)
      .set({
        processedCount: Math.min(i + chunk.length, rows.length),
        successCount: success,
        errorCount,
        errors: errorSamples,
      })
      .where(eq(importJobs.id, job.id));
  }

  return {
    totalRows: rows.length,
    successCount: success,
    errorCount,
    duplicatesSkipped: 0,
    errors: errorSamples,
  };
}

async function processDocumentImport(
  job: ImportJob,
  payload: Buffer
): Promise<{
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicatesSkipped: number;
  errors: Array<{ row: number; error: string }>;
}> {
  // ZIP signature check ("PK\x03\x04")
  if (payload.length < 4 || payload.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Documents import expects a ZIP file");
  }
  const entries = readZipArchive(payload);

  let success = 0;
  let errorCount = 0;
  const errorSamples: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const base = path.basename(entry.name);
      // Filename pattern: lead_{email}.* or property_{apn}.*
      const leadMatch = base.match(/^lead[_-](.+?)\.[^.]+$/i);
      const propMatch = base.match(/^property[_-](.+?)\.[^.]+$/i);
      if (leadMatch) {
        const email = leadMatch[1].toLowerCase();
        const [lead] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.organizationId, job.organizationId), eq(leads.email, email)))
          .limit(1);
        if (!lead) throw new Error(`No lead with email ${email}`);
        // Persist as activity-log entry referencing the file (stored on disk).
        const filePath = path.join(STORAGE_DIR, `doc-${job.id}-${i}-${base}`);
        await fs.writeFile(filePath, entry.data);
        await db.insert(activityLog).values({
          organizationId: job.organizationId,
          action: "document_imported",
          entityType: "lead",
          entityId: lead.id,
          description: `Imported document: ${base}`,
          metadata: { filename: base, sizeBytes: entry.data.length, path: filePath },
        });
        success++;
      } else if (propMatch) {
        const apn = propMatch[1];
        const [prop] = await db
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.organizationId, job.organizationId), eq(properties.apn, apn)))
          .limit(1);
        if (!prop) throw new Error(`No property with APN ${apn}`);
        const filePath = path.join(STORAGE_DIR, `doc-${job.id}-${i}-${base}`);
        await fs.writeFile(filePath, entry.data);
        await db.insert(activityLog).values({
          organizationId: job.organizationId,
          action: "document_imported",
          entityType: "property",
          entityId: prop.id,
          description: `Imported document: ${base}`,
          metadata: { filename: base, sizeBytes: entry.data.length, path: filePath },
        });
        success++;
      } else {
        throw new Error(
          `Filename ${base} did not match lead_{email}.* or property_{apn}.* pattern`
        );
      }
    } catch (err) {
      errorCount++;
      if (errorSamples.length < 100) {
        errorSamples.push({
          row: i + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await db
      .update(importJobs)
      .set({
        totalRows: entries.length,
        processedCount: i + 1,
        successCount: success,
        errorCount,
        errors: errorSamples,
      })
      .where(eq(importJobs.id, job.id));
  }

  return {
    totalRows: entries.length,
    successCount: success,
    errorCount,
    duplicatesSkipped: 0,
    errors: errorSamples,
  };
}

async function markImportComplete(
  job: Pick<ImportJob, "id" | "organizationId" | "kind">,
  result: {
    totalRows: number;
    successCount: number;
    errorCount: number;
    duplicatesSkipped: number;
    errors: Array<{ row: number; error: string }>;
  }
): Promise<void> {
  await db
    .update(importJobs)
    .set({
      status: "completed",
      totalRows: result.totalRows,
      processedCount: result.totalRows,
      successCount: result.successCount,
      errorCount: result.errorCount,
      duplicatesSkipped: result.duplicatesSkipped,
      errors: result.errors,
      result: result as any,
      completedAt: new Date(),
    })
    .where(eq(importJobs.id, job.id));

  // CP2 of Jarvis Phase 1 (Verified Act-and-Confirm) — the IMPORTS workflow
  // is the first verify-gated seam. Fire-and-forget: verification is a
  // READ-ONLY observer in CP2 and must NEVER fail or delay the import
  // (blocking / act-and-confirm binding is CP3). enqueueImportVerification
  // catches everything internally.
  void enqueueImportVerification(job, result);
}

/**
 * Enqueue a read-only `verify` dispatch for a just-completed import job,
 * with criteria derived from the job's own record (row accounting, error
 * rate, org-scoping sanity — see verifyQueue.buildImportVerifyCriteria for
 * the honest limits of each). Exported for tests. Never throws.
 */
export async function enqueueImportVerification(
  job: Pick<ImportJob, "id" | "organizationId" | "kind">,
  result: {
    totalRows: number;
    successCount: number;
    errorCount: number;
    duplicatesSkipped: number;
  }
): Promise<void> {
  try {
    const { enqueueVerifyDispatch, buildImportVerifyCriteria } = await import(
      "./solene/verifyQueue"
    );
    const criteria = buildImportVerifyCriteria({
      jobId: job.id,
      organizationId: job.organizationId,
      kind: job.kind,
      totalRows: result.totalRows,
      successCount: result.successCount,
      errorCount: result.errorCount,
      duplicatesSkipped: result.duplicatesSkipped,
    });
    await enqueueVerifyDispatch({
      targetKind: "import",
      targetId: job.id,
      criteria,
      context:
        `Import job #${job.id} (kind=${job.kind}, organization=${job.organizationId}) ` +
        `just completed reporting totalRows=${result.totalRows}, ` +
        `successCount=${result.successCount}, errorCount=${result.errorCount}, ` +
        `duplicatesSkipped=${result.duplicatesSkipped}.`,
    });
  } catch (err) {
    logger.warn("[migrationJobs] import verification enqueue failed", {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Export worker ───────────────────────────────────────────────────────────

const README_TEMPLATE = `# AcreOS Data Export

This archive contains a snapshot of your organization's data. The format is
designed to be portable to other CRMs.

## Files

- \`leads.csv\`            — all leads (sellers + buyers)
- \`properties.csv\`       — properties + parcels
- \`deals.csv\`            — acquisition / disposition deals
- \`communications.csv\`   — email/SMS history (one row per message)
- \`notes.csv\`            — CRM notes
- \`audit-log.csv\`        — audit-event timeline
- \`attachments/\`         — original files keyed by entity type + ID
- \`schema.json\`          — export schema version + entity counts

## Importing into another CRM

1. Most CRMs accept the \`leads.csv\` shape directly. Map columns by header.
2. \`communications.csv\` can be replayed via your destination CRM's
   communications-history import flow. Use \`leadEmail\` to match leads.
3. \`attachments/\` is laid out as \`/attachments/{entityType}/{entityId}/{filename}\`.
   Walk the directory and re-upload via your CRM's attachment API.

Generated: {timestamp}
Organization ID: {orgId}
Schema version: 1
`;

async function runExportJob(job: ExportJob): Promise<void> {
  try {
    const params = job.params ?? {};
    const includeAttachments = params.includeAttachments ?? true;
    const requestedTypes = new Set(
      params.entityTypes ?? ["leads", "properties", "deals", "communications", "notes", "audit-log"]
    );

    const orgId = job.organizationId;
    const counts: Record<string, number> = {};
    const archiveEntries: ZipEntry[] = [];

    if (requestedTypes.has("leads")) {
      const csv = await exportLeadsToCSV(orgId);
      archiveEntries.push({ name: "leads.csv", data: Buffer.from(csv, "utf8") });
      counts.leads = csv.split("\n").length - 1;
    }
    if (requestedTypes.has("properties")) {
      const csv = await exportPropertiesToCSV(orgId);
      archiveEntries.push({ name: "properties.csv", data: Buffer.from(csv, "utf8") });
      counts.properties = csv.split("\n").length - 1;
    }
    if (requestedTypes.has("deals")) {
      const csv = await exportDealsToCSV(orgId);
      archiveEntries.push({ name: "deals.csv", data: Buffer.from(csv, "utf8") });
      counts.deals = csv.split("\n").length - 1;
    }
    if (requestedTypes.has("notes")) {
      const csv = await exportNotesToCSV(orgId);
      archiveEntries.push({ name: "notes.csv", data: Buffer.from(csv, "utf8") });
      counts.notes = csv.split("\n").length - 1;
    }
    if (requestedTypes.has("communications")) {
      const csv = await buildCommunicationsCsv(orgId);
      archiveEntries.push({ name: "communications.csv", data: Buffer.from(csv, "utf8") });
      counts.communications = csv.split("\n").length - 1;
    }
    if (requestedTypes.has("audit-log")) {
      const csv = await buildAuditLogCsv(orgId);
      archiveEntries.push({ name: "audit-log.csv", data: Buffer.from(csv, "utf8") });
      counts.auditLog = csv.split("\n").length - 1;
    }

    if (includeAttachments) {
      // Walk activity_log for document_imported entries and re-pack them.
      const docRows = await db
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.organizationId, orgId), eq(activityLog.action, "document_imported"))
        );
      let attachmentCount = 0;
      for (const row of docRows) {
        const meta = (row.metadata as { filename?: string; path?: string } | null) ?? null;
        if (!meta?.path) continue;
        try {
          const data = await fs.readFile(meta.path);
          const safeName = (meta.filename ?? "file").replace(/[^A-Za-z0-9._-]/g, "_");
          archiveEntries.push({
            name: `attachments/${row.entityType}/${row.entityId}/${safeName}`,
            data,
          });
          attachmentCount++;
        } catch {
          // attachment file gone — skip silently
        }
      }
      counts.attachments = attachmentCount;
    }

    const schemaJson = {
      schemaVersion: 1,
      organizationId: orgId,
      generatedAt: new Date().toISOString(),
      counts,
      params,
    };
    archiveEntries.push({
      name: "schema.json",
      data: Buffer.from(JSON.stringify(schemaJson, null, 2), "utf8"),
    });
    archiveEntries.push({
      name: "README.md",
      data: Buffer.from(
        README_TEMPLATE.replace("{timestamp}", new Date().toISOString()).replace(
          "{orgId}",
          String(orgId)
        ),
        "utf8"
      ),
    });

    const zipBuf = await buildZipArchive(archiveEntries);
    await ensureStorageDir();
    const archivePath = path.join(STORAGE_DIR, `export-${job.id}.zip`);
    await fs.writeFile(archivePath, zipBuf);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(exportJobs)
      .set({
        status: "completed",
        archivePath,
        archiveSizeBytes: zipBuf.length,
        entityCounts: counts,
        completedAt: new Date(),
        expiresAt,
      })
      .where(eq(exportJobs.id, job.id));
  } catch (err) {
    logger.error("[migrationJobs] Export job failed", { jobId: job.id, error: err });
    await db
      .update(exportJobs)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      })
      .where(eq(exportJobs.id, job.id));
  }
}

async function buildCommunicationsCsv(orgId: number): Promise<string> {
  const rows = await db
    .select({
      messageId: messages.id,
      conversationId: messages.conversationId,
      leadId: conversations.leadId,
      channel: conversations.channel,
      direction: messages.direction,
      sender: messages.sender,
      content: messages.content,
      status: messages.status,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(messages.organizationId, orgId))
    .orderBy(asc(messages.createdAt));

  const headers = [
    "messageId",
    "conversationId",
    "leadId",
    "channel",
    "direction",
    "sender",
    "content",
    "status",
    "createdAt",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.messageId,
        r.conversationId,
        r.leadId,
        r.channel,
        r.direction,
        r.sender,
        csvEscape(r.content),
        r.status,
        r.createdAt?.toISOString() ?? "",
      ].join(",")
    );
  }
  return lines.join("\n");
}

async function buildAuditLogCsv(orgId: number): Promise<string> {
  const rows = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.organizationId, orgId))
    .orderBy(asc(activityLog.id));
  const headers = ["id", "userId", "action", "entityType", "entityId", "description", "createdAt"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.userId ?? "",
        r.action,
        r.entityType,
        r.entityId,
        csvEscape(r.description ?? ""),
        r.createdAt?.toISOString() ?? "",
      ].join(",")
    );
  }
  return lines.join("\n");
}

function csvEscape(v: string): string {
  if (v == null) return "";
  if (/[",\n\r]/.test(v)) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

export async function readExportArchive(jobId: number, orgId: number): Promise<Buffer | null> {
  const job = await getExportJob(orgId, jobId);
  if (!job || !job.archivePath) return null;
  try {
    return await fs.readFile(job.archivePath);
  } catch {
    return null;
  }
}

// Suppress unused-import lint on `teamMembers` — referenced by future
// assignedTo email→userId resolution work in importLeads.
void teamMembers;

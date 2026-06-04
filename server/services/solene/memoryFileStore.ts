/**
 * SOLENE — memory-file persistence (Phase 1 / shared-persistence layer).
 *
 * DB mirror of the local /memory/*.md files so AcreOS Solene chat can
 * read/write the same memory that CLI Claude Code edits on disk.
 *
 * SHA-256 body hash on every row lets the sync script + the in-app editor
 * detect drift cheaply. upsertMemoryFile is a no-write when the hash
 * matches (preserving updated_at for an honest mtime semantics).
 */

import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneMemoryFiles,
  MEMORY_FILE_TYPES,
  type MemoryFileType,
  type SoleneMemoryFileRow,
} from "@shared/schema/solene-memory-files";
import { logger } from "../../utils/logger";

// ============================================
// Types
// ============================================

export interface UpsertMemoryFileInput {
  slug: string;
  fileBasename: string;
  type: MemoryFileType;
  description?: string;
  body: string;
  metadata?: Record<string, unknown>;
  /**
   * If true (the default), set last_synced_from_local_at = now() on writes.
   * Disk-mirror callers (sync script) leave the default; pure-DB-edit
   * callers should pass false.
   */
  markedSyncedFromLocal?: boolean;
}

export interface UpsertMemoryFileResult {
  memoryFileId: number;
  created: boolean;
  bodyChanged: boolean;
}

export interface ListMemoryFilesOpts {
  type?: MemoryFileType;
}

// ============================================
// Helpers
// ============================================

function isKnownType(t: string): t is MemoryFileType {
  return (MEMORY_FILE_TYPES as readonly string[]).includes(t);
}

/**
 * Compute SHA-256 hex of a body — exported for testability + sync logic.
 */
export function computeBodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Parse frontmatter from a memory body — extracts name + description +
 * metadata.type (in that order of precedence for the type field).
 *
 * Matches the simple `name: ...` + `description: ...` + `type: ...`
 * regex pattern used in scripts/ingest-feedback-memories.mjs.
 */
export function parseMemoryFrontmatter(body: string): {
  slug: string | null;
  description: string | null;
  type: MemoryFileType;
} {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    return { slug: null, description: null, type: "unknown" };
  }
  const fmBlock = m[1];
  const fm: Record<string, string> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  const rawType = (fm.type ?? "").toLowerCase();
  const type: MemoryFileType = isKnownType(rawType) ? rawType : "unknown";
  return {
    slug: fm.name ?? null,
    description: fm.description ?? null,
    type,
  };
}

// ============================================
// upsertMemoryFile
// ============================================

export async function upsertMemoryFile(
  input: UpsertMemoryFileInput,
): Promise<UpsertMemoryFileResult> {
  if (!input.slug || input.slug.trim().length === 0) {
    throw new Error("upsertMemoryFile: slug must be non-empty");
  }
  if (!input.fileBasename || input.fileBasename.trim().length === 0) {
    throw new Error("upsertMemoryFile: fileBasename must be non-empty");
  }
  if (!isKnownType(input.type)) {
    throw new Error(`upsertMemoryFile: invalid type=${String(input.type)}`);
  }
  if (typeof input.body !== "string") {
    throw new Error("upsertMemoryFile: body must be a string");
  }

  const bodySha256 = computeBodyHash(input.body);
  const now = new Date();
  const markFromLocal = input.markedSyncedFromLocal ?? true;

  const existing = await db
    .select({
      id: soleneMemoryFiles.id,
      bodySha256: soleneMemoryFiles.bodySha256,
    })
    .from(soleneMemoryFiles)
    .where(eq(soleneMemoryFiles.slug, input.slug))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    if (row.bodySha256 === bodySha256) {
      // No-write — already up to date. Bump last_synced_from_local_at iff
      // the caller explicitly requested it (so disk-sync callers can record
      // "we saw the file" without dirtying updated_at).
      if (markFromLocal) {
        try {
          await db
            .update(soleneMemoryFiles)
            .set({ lastSyncedFromLocalAt: now })
            .where(eq(soleneMemoryFiles.id, row.id));
        } catch (err) {
          logger.warn(
            `[memoryFileStore] last_synced_from_local_at bump failed slug=${input.slug}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      return {
        memoryFileId: row.id,
        created: false,
        bodyChanged: false,
      };
    }

    // Hash differs — body changed, write.
    await db
      .update(soleneMemoryFiles)
      .set({
        fileBasename: input.fileBasename,
        type: input.type,
        description: input.description ?? null,
        body: input.body,
        bodySha256,
        updatedAt: now,
        ...(markFromLocal ? { lastSyncedFromLocalAt: now } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      })
      .where(eq(soleneMemoryFiles.id, row.id));

    return {
      memoryFileId: row.id,
      created: false,
      bodyChanged: true,
    };
  }

  // New row.
  const [inserted] = await db
    .insert(soleneMemoryFiles)
    .values({
      slug: input.slug,
      fileBasename: input.fileBasename,
      type: input.type,
      description: input.description ?? null,
      body: input.body,
      bodySha256,
      updatedAt: now,
      lastSyncedFromLocalAt: markFromLocal ? now : null,
      metadata: input.metadata ?? {},
    })
    .returning({ id: soleneMemoryFiles.id });

  if (!inserted) {
    throw new Error("upsertMemoryFile: insert returned no id");
  }
  return {
    memoryFileId: inserted.id,
    created: true,
    bodyChanged: true,
  };
}

// ============================================
// deleteMemoryFile
// ============================================

export async function deleteMemoryFile(slug: string): Promise<void> {
  if (!slug || slug.trim().length === 0) {
    throw new Error("deleteMemoryFile: slug must be non-empty");
  }
  await db
    .delete(soleneMemoryFiles)
    .where(eq(soleneMemoryFiles.slug, slug));
}

// ============================================
// listMemoryFiles
// ============================================

export async function listMemoryFiles(
  opts: ListMemoryFilesOpts = {},
): Promise<SoleneMemoryFileRow[]> {
  if (opts.type !== undefined && !isKnownType(opts.type)) {
    throw new Error(`listMemoryFiles: invalid type=${String(opts.type)}`);
  }
  const q = db.select().from(soleneMemoryFiles);
  const rows = await (opts.type !== undefined
    ? q.where(eq(soleneMemoryFiles.type, opts.type))
    : q
  ).orderBy(desc(soleneMemoryFiles.updatedAt));
  return rows;
}

// ============================================
// getMemoryFile
// ============================================

export async function getMemoryFile(
  slug: string,
): Promise<SoleneMemoryFileRow | null> {
  if (!slug || slug.trim().length === 0) {
    throw new Error("getMemoryFile: slug must be non-empty");
  }
  const [row] = await db
    .select()
    .from(soleneMemoryFiles)
    .where(eq(soleneMemoryFiles.slug, slug))
    .limit(1);
  return row ?? null;
}

// ============================================
// getMemoryFileByBasename
// ============================================

export async function getMemoryFileByBasename(
  basename: string,
): Promise<SoleneMemoryFileRow | null> {
  if (!basename || basename.trim().length === 0) {
    throw new Error("getMemoryFileByBasename: basename must be non-empty");
  }
  const [row] = await db
    .select()
    .from(soleneMemoryFiles)
    .where(eq(soleneMemoryFiles.fileBasename, basename))
    .limit(1);
  return row ?? null;
}

// Silence unused-import warning for `and` (kept for future combined filters).
void and;

export type { SoleneMemoryFileRow };

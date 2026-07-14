/**
 * SOLENE — doctrine corpus ingestion + auditable completeness (Horizon A5).
 *
 * Walks the repo's PLATFORM doctrine directories, embeds every markdown file
 * (plus sovereign-protocol/immutables.json) into the `doctrine` namespace of
 * solene_embedded_records, and answers — auditable, disk-vs-store — the
 * question "is every doctrine doc actually in memory?".
 *
 * Corpus (repo-relative, PLATFORM docs only — organization_id IS NULL):
 *   docs/company/**, docs/internal/**, docs/adr/**, docs/architecture/**,
 *   docs/policies/**, docs/strategy/**, sovereign-protocol/** (*.md)
 *   + sovereign-protocol/immutables.json.
 *
 * OUT OF SCOPE by design: the external feedback-memory dir
 * (~/.claude/.../memory/feedback_*.md) is externally managed — it is
 * ingested by its own L3.10 pipeline under the `feedback_memory` namespace
 * and lives outside the repo, so the disk walk here deliberately does not
 * touch it. corpusCompleteness() names it as externally-managed rather than
 * pretending it was walked.
 *
 * Upsert contract (mirrors founderPrecedent.ts): natural key is
 * (organization_id IS NULL, namespace='doctrine', source_ref=<repo-relative
 * path>); content_hash is the sha256 of the FULL file text, and an unchanged
 * hash skips the re-embed + write entirely. Postgres treats NULL as distinct
 * in unique indexes, so the upsert is select-then-update-or-insert, never
 * ON CONFLICT.
 *
 * HONEST LIMITATION — no chunker yet. Files longer than
 * EMBEDDED_SNIPPET_MAX_CHARS (4000) store a head snippet only, and the
 * embedding covers the text we embed (the full text is passed to the
 * embedder, but a single vector over a 40 KB doc dilutes; retrieval quality
 * for long docs is head-weighted). A proper chunking pass is a follow-up;
 * this module says so instead of pretending coverage it doesn't have.
 *
 * Fail-open per file: one unreadable/unembeddable file logs a warning,
 * counts as `failed`, and NEVER stops the walk. Scheduled daily at 03:00 UTC
 * (server/jobs/runScheduledJobs.ts, job 'doctrine_ingest_daily') — the daily
 * job IS the auto-queue for missing docs: anything corpusCompleteness()
 * reports as missing or stale is picked up on the next run.
 */

import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import {
  soleneEmbeddedRecords,
  EMBEDDED_SNIPPET_MAX_CHARS,
  EMBEDDED_SNIPPET_TRUNCATION_SUFFIX,
} from "@shared/schema/solene-embeddings";
import { embedDocumentTextFailOpen } from "./learningLoop";

// ============================================================================
// Constants
// ============================================================================

export const DOCTRINE_NAMESPACE = "doctrine";

/**
 * Repo-relative directories walked for *.md doctrine docs. sovereign-protocol
 * additionally contributes immutables.json (the machine-readable
 * constitution) via DOCTRINE_EXTRA_FILES.
 */
export const DOCTRINE_WALK_DIRS = [
  "docs/company",
  "docs/internal",
  "docs/adr",
  "docs/architecture",
  "docs/policies",
  "docs/strategy",
  "sovereign-protocol",
] as const;

/** Non-markdown files that are doctrine anyway. Repo-relative. */
export const DOCTRINE_EXTRA_FILES = ["sovereign-protocol/immutables.json"] as const;

/**
 * Externally-managed corpora deliberately NOT walked here — named in the
 * completeness report so the report is honest about what it did not check.
 */
export const DOCTRINE_EXTERNALLY_MANAGED = [
  "~/.claude/.../memory/feedback_*.md (feedback_memory namespace — ingested by its own L3.10 pipeline, lives outside the repo)",
] as const;

/**
 * Repo root resolution. Deploy runs the server with CWD at the repo root
 * (the same assumption dispatchRunner's team-state preamble and
 * dispatchToolExecutor's PROJECT_ROOT make); SOLENE_DISPATCH_PROJECT_ROOT
 * overrides for worker processes started elsewhere.
 */
const REPO_ROOT = process.env.SOLENE_DISPATCH_PROJECT_ROOT
  ? path.resolve(process.env.SOLENE_DISPATCH_PROJECT_ROOT)
  : process.cwd();

/** Skip pathologically large files rather than embedding megabytes. */
const DOCTRINE_FILE_BYTE_CAP = 1_000_000;

// ============================================================================
// Disk walk
// ============================================================================

function toRepoRelative(abs: string, rootDir: string): string {
  return path.relative(rootDir, abs).split(path.sep).join("/");
}

async function walkDirForMarkdown(absDir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    // Missing dir — fine; the caller records which dirs were actually walked.
    return;
  }
  for (const e of entries) {
    const child = path.join(absDir, e.name);
    if (e.isDirectory()) {
      await walkDirForMarkdown(child, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(child);
    }
  }
}

export interface DoctrineDiskWalk {
  /** Dirs (repo-relative) that existed and were walked. */
  walkedDirs: string[];
  /** Repo-relative file paths found on disk, sorted. */
  files: string[];
}

/**
 * Walk DOCTRINE_WALK_DIRS for *.md + DOCTRINE_EXTRA_FILES. `rootDir` is
 * injectable for tests; defaults to the resolved repo root.
 */
export async function walkDoctrineFiles(rootDir: string = REPO_ROOT): Promise<DoctrineDiskWalk> {
  const walkedDirs: string[] = [];
  const absFiles: string[] = [];
  for (const rel of DOCTRINE_WALK_DIRS) {
    const absDir = path.join(rootDir, rel);
    try {
      const stat = await fs.stat(absDir);
      if (!stat.isDirectory()) continue;
    } catch {
      continue; // dir absent in this checkout — recorded by omission
    }
    walkedDirs.push(rel);
    await walkDirForMarkdown(absDir, absFiles);
  }
  const files = absFiles.map((f) => toRepoRelative(f, rootDir));
  for (const extra of DOCTRINE_EXTRA_FILES) {
    try {
      const stat = await fs.stat(path.join(rootDir, extra));
      if (stat.isFile()) files.push(extra);
    } catch {
      // absent — omitted (and will show as neither on-disk nor missing)
    }
  }
  files.sort();
  return { walkedDirs, files };
}

// ============================================================================
// Ingest
// ============================================================================

function truncateSnippet(text: string): string {
  if (text.length <= EMBEDDED_SNIPPET_MAX_CHARS) return text;
  return (
    text.slice(0, EMBEDDED_SNIPPET_MAX_CHARS) + EMBEDDED_SNIPPET_TRUNCATION_SUFFIX
  );
}

export interface DoctrineIngestResult {
  /** Files found on disk and attempted. */
  walked: number;
  /** Files newly inserted or updated (content changed). */
  ingested: number;
  /** Files skipped because the stored content_hash already matches. */
  skippedUnchanged: number;
  /** Files that errored (read / embed / write) — walk continued past each. */
  failed: number;
}

/**
 * Ingest one doctrine file. Exported for tests. Never throws — returns the
 * per-file outcome so ingestDoctrineCorpus can count honestly.
 */
export async function ingestDoctrineFile(
  relPath: string,
  rootDir: string = REPO_ROOT,
): Promise<"ingested" | "skipped_unchanged" | "failed"> {
  try {
    const abs = path.join(rootDir, relPath);
    // Size-check and read through ONE file handle so the file can't be
    // swapped between check and use (CodeQL js/file-system-race on the
    // previous stat-then-readFile shape).
    const handle = await fs.open(abs, "r");
    let fullText: string;
    let byteSize: number;
    try {
      const stat = await handle.stat();
      byteSize = stat.size;
      if (byteSize > DOCTRINE_FILE_BYTE_CAP) {
        logger.warn("doctrineIngest.file_too_large", {
          metadata: { relPath, bytes: byteSize },
        });
        return "failed";
      }
      fullText = (await handle.readFile()).toString("utf8");
    } finally {
      await handle.close();
    }
    const contentHash = crypto.createHash("sha256").update(fullText, "utf8").digest("hex");

    const existing = await db
      .select({
        id: soleneEmbeddedRecords.id,
        contentHash: soleneEmbeddedRecords.contentHash,
      })
      .from(soleneEmbeddedRecords)
      .where(
        and(
          isNull(soleneEmbeddedRecords.organizationId),
          eq(soleneEmbeddedRecords.namespace, DOCTRINE_NAMESPACE),
          eq(soleneEmbeddedRecords.sourceRef, relPath),
        ),
      )
      .limit(1);

    if (existing[0] && existing[0].contentHash === contentHash) {
      return "skipped_unchanged";
    }

    const { vector, model } = await embedDocumentTextFailOpen(fullText);
    const rowValues = {
      contentSnippet: truncateSnippet(fullText),
      contentHash,
      embeddingModel: model,
      embeddingDim: vector.length,
      embedding: vector,
      metadata: {
        source: "doctrineIngest",
        bytes: byteSize,
        // Honest chunking note — see module doc: long docs are snippet-head
        // + single-vector only until a chunker lands.
        truncated: fullText.length > EMBEDDED_SNIPPET_MAX_CHARS,
      },
    };

    if (existing[0]) {
      await db
        .update(soleneEmbeddedRecords)
        .set(rowValues)
        .where(eq(soleneEmbeddedRecords.id, existing[0].id));
    } else {
      await db.insert(soleneEmbeddedRecords).values({
        organizationId: null,
        namespace: DOCTRINE_NAMESPACE,
        sourceRef: relPath,
        ...rowValues,
      });
    }
    return "ingested";
  } catch (err) {
    logger.warn("doctrineIngest.file_failed", {
      metadata: {
        relPath,
        err: err instanceof Error ? err.message : String(err),
      },
    });
    return "failed";
  }
}

/**
 * Walk the doctrine dirs and upsert every file. Fail-open per file — one bad
 * file never stops the walk. Returns honest counts.
 */
export async function ingestDoctrineCorpus(opts?: {
  rootDir?: string;
}): Promise<DoctrineIngestResult> {
  const rootDir = opts?.rootDir ?? REPO_ROOT;
  const { files } = await walkDoctrineFiles(rootDir);
  const result: DoctrineIngestResult = {
    walked: files.length,
    ingested: 0,
    skippedUnchanged: 0,
    failed: 0,
  };
  for (const relPath of files) {
    const outcome = await ingestDoctrineFile(relPath, rootDir);
    if (outcome === "ingested") result.ingested += 1;
    else if (outcome === "skipped_unchanged") result.skippedUnchanged += 1;
    else result.failed += 1;
  }
  logger.info("doctrineIngest.run_complete", {
    metadata: { ...result },
  });
  return result;
}

// ============================================================================
// Completeness — disk vs store, directly.
// ============================================================================

export interface DoctrineCompleteness {
  /** Repo-relative dirs that existed and were walked — exactly what was checked. */
  walkedDirs: string[];
  /** Count of doctrine files found on disk. */
  filesOnDisk: number;
  /** Count of DISTINCT doctrine sourceRefs in solene_embedded_records (org NULL). */
  inStore: number;
  /** On disk but absent from the store — the daily ingest job picks these up. */
  missing: string[];
  /** In the store but the on-disk content hash differs — pending re-embed. */
  staleHash: string[];
  /** In the store but no longer on disk (deleted/renamed docs). */
  extraInStore: string[];
  /** Corpora deliberately NOT walked — named so the report is honest. */
  externallyManaged: string[];
}

/**
 * Compare disk vs store DIRECTLY (counts distinct solene_embedded_records
 * rows in the doctrine namespace, NOT the under-reporting
 * solene_memory_corpus_status ledger). Hashes every on-disk file so
 * staleHash is a real drift signal, not a guess.
 */
export async function corpusCompleteness(opts?: {
  rootDir?: string;
}): Promise<DoctrineCompleteness> {
  const rootDir = opts?.rootDir ?? REPO_ROOT;
  const { walkedDirs, files } = await walkDoctrineFiles(rootDir);

  // Hash disk files (fail-open per file: unreadable disk files are treated
  // as on-disk-but-unhashable → they can still be reported missing/stale).
  const diskHash = new Map<string, string | null>();
  for (const relPath of files) {
    try {
      const fullText = await fs.readFile(path.join(rootDir, relPath), "utf8");
      diskHash.set(
        relPath,
        crypto.createHash("sha256").update(fullText, "utf8").digest("hex"),
      );
    } catch (err) {
      logger.warn("doctrineIngest.completeness_read_failed", {
        metadata: {
          relPath,
          err: err instanceof Error ? err.message : String(err),
        },
      });
      diskHash.set(relPath, null);
    }
  }

  // Store side — direct read of the embedded-records registry.
  const storeRows = await db
    .select({
      sourceRef: soleneEmbeddedRecords.sourceRef,
      contentHash: soleneEmbeddedRecords.contentHash,
    })
    .from(soleneEmbeddedRecords)
    .where(
      and(
        isNull(soleneEmbeddedRecords.organizationId),
        eq(soleneEmbeddedRecords.namespace, DOCTRINE_NAMESPACE),
      ),
    );
  const storeHash = new Map<string, string>();
  for (const row of storeRows) storeHash.set(row.sourceRef, row.contentHash);

  const missing: string[] = [];
  const staleHash: string[] = [];
  for (const [relPath, hash] of diskHash) {
    const stored = storeHash.get(relPath);
    if (stored === undefined) missing.push(relPath);
    else if (hash !== null && stored !== hash) staleHash.push(relPath);
  }
  const extraInStore = [...storeHash.keys()].filter((ref) => !diskHash.has(ref)).sort();
  missing.sort();
  staleHash.sort();

  return {
    walkedDirs,
    filesOnDisk: files.length,
    inStore: storeHash.size,
    missing,
    staleHash,
    extraInStore,
    externallyManaged: [...DOCTRINE_EXTERNALLY_MANAGED],
  };
}

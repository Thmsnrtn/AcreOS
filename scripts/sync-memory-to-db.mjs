#!/usr/bin/env node
/**
 * scripts/sync-memory-to-db.mjs
 *
 * Phase 1 of the AcreOS-Solene migration — sync the local /memory/*.md
 * corpus to the solene_memory_files table so AcreOS Solene chat reads
 * the same memory that CLI Claude Code edits on disk.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/sync-memory-to-db.mjs sync
 *   DATABASE_URL=... node scripts/sync-memory-to-db.mjs --dry-run
 *   DATABASE_URL=... node scripts/sync-memory-to-db.mjs --status
 *   node scripts/sync-memory-to-db.mjs --help
 *
 * Env:
 *   DATABASE_URL          Postgres connection string (required for sync + --status).
 *   SOLENE_MEMORY_DIR     Override the memory directory.
 *                         Default: $HOME/.claude/projects/-Users-user-AcreOS-AcreOS/memory
 *
 * Algorithm:
 *   1. Walk *.md files in the memory dir.
 *   2. Parse frontmatter (name/description/type). Files without a `name:`
 *      fall back to the file basename as the slug.
 *   3. Compute SHA-256 of the full body.
 *   4. UPSERT into solene_memory_files by slug.
 *   5. On change, bump updated_at + set last_synced_from_local_at = now().
 *   6. Print scanned / inserted / updated / unchanged / skipped / errors.
 *
 * --dry-run walks + reports but doesn't write.
 * --status reads the DB + reports per-file last_synced_from_local_at +
 *   body-hash match against local.
 *
 * Self-contained ESM — no project imports. Uses `pg` directly.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MEMORY_DIR = path.join(
  process.env.HOME ?? "",
  ".claude/projects/-Users-user-AcreOS-AcreOS/memory",
);

const KNOWN_TYPES = new Set([
  "user",
  "feedback",
  "project",
  "reference",
  "unknown",
]);

// ============================================================================
// Frontmatter parser — inlined, matches scripts/ingest-feedback-memories.mjs
// ============================================================================

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fmBlock = m[1];
  const body = m[2];
  const fm = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body };
}

function inferTypeFromBasename(basename) {
  // Conventional: user_*.md -> user; feedback_*.md -> feedback;
  // project_*.md -> project; reference_*.md -> reference. team_* + others
  // fall back to "unknown" (will be reclassified by frontmatter when present).
  if (basename.startsWith("user_")) return "user";
  if (basename.startsWith("feedback_")) return "feedback";
  if (basename.startsWith("project_")) return "project";
  if (basename.startsWith("reference_")) return "reference";
  if (basename.startsWith("team_")) return "user";
  return "unknown";
}

function resolveType(fmType, basename) {
  const fromFm = (fmType ?? "").toLowerCase();
  if (KNOWN_TYPES.has(fromFm)) return fromFm;
  return inferTypeFromBasename(basename);
}

function computeBodyHash(body) {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex");
}

// ============================================================================
// CLI
// ============================================================================

function printHelp() {
  console.log(`scripts/sync-memory-to-db.mjs — local memory → DB sync

Usage:
  DATABASE_URL=... node scripts/sync-memory-to-db.mjs sync         (local → DB)
  DATABASE_URL=... node scripts/sync-memory-to-db.mjs --dry-run    (no writes)
  DATABASE_URL=... node scripts/sync-memory-to-db.mjs --status     (DB vs local)
  node scripts/sync-memory-to-db.mjs --help

Env:
  DATABASE_URL          Postgres connection string (required for sync + --status).
  SOLENE_MEMORY_DIR     Override the memory directory.
                        Default: $HOME/.claude/projects/-Users-user-AcreOS-AcreOS/memory

Algorithm:
  Walk *.md files in the memory dir → parse frontmatter (name/description/type)
  → compute SHA-256 → UPSERT into solene_memory_files by slug. No-write when
  the hash already matches.
`);
}

function parseArgs(argv) {
  const args = {
    mode: "sync",
    dryRun: false,
    status: false,
    help: false,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--status") args.status = true;
    else if (raw === "sync") args.mode = "sync";
  }
  return args;
}

// ============================================================================
// sync mode
// ============================================================================

async function runSync({ dryRun, memoryDir }) {
  if (!fs.existsSync(memoryDir)) {
    console.error(`ERROR: memory dir does not exist: ${memoryDir}`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(memoryDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  console.log(
    `[sync] memoryDir=${memoryDir} files=${files.length} dryRun=${dryRun}`,
  );

  let pool = null;
  if (!dryRun) {
    if (!process.env.DATABASE_URL) {
      console.error("ERROR: DATABASE_URL is required (or pass --dry-run).");
      process.exit(2);
    }
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
    });
  }

  const counts = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    errored: 0,
  };

  try {
    for (const file of files) {
      counts.scanned += 1;
      const fullPath = path.join(memoryDir, file);
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const { fm } = parseFrontmatter(raw);
        const slug = fm.name && fm.name.length > 0 ? fm.name : file.replace(/\.md$/, "");
        const description = fm.description ?? null;
        const type = resolveType(fm.type, file);
        const bodyHash = computeBodyHash(raw);

        if (dryRun) {
          console.log(
            `[dry] ${file} → slug=${slug} type=${type} hash=${bodyHash.slice(0, 12)}…`,
          );
          counts.inserted += 1;
          continue;
        }

        const existing = await pool.query(
          `SELECT id, body_sha256 FROM solene_memory_files WHERE slug = $1`,
          [slug],
        );

        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          if (row.body_sha256 === bodyHash) {
            // No-write: same content. Bump last_synced_from_local_at so the
            // operator can see we observed the file.
            await pool.query(
              `UPDATE solene_memory_files
                  SET last_synced_from_local_at = now()
                WHERE id = $1`,
              [row.id],
            );
            counts.unchanged += 1;
            continue;
          }
          await pool.query(
            `UPDATE solene_memory_files
                SET file_basename = $1,
                    type = $2,
                    description = $3,
                    body = $4,
                    body_sha256 = $5,
                    updated_at = now(),
                    last_synced_from_local_at = now()
              WHERE id = $6`,
            [file, type, description, raw, bodyHash, row.id],
          );
          counts.updated += 1;
        } else {
          await pool.query(
            `INSERT INTO solene_memory_files
               (slug, file_basename, type, description, body, body_sha256,
                updated_at, last_synced_from_local_at, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, now(), now(), '{}'::jsonb)`,
            [slug, file, type, description, raw, bodyHash],
          );
          counts.inserted += 1;
        }
      } catch (err) {
        console.error(
          `[error] ${file}: ${err instanceof Error ? err.message : String(err)}`,
        );
        counts.errored += 1;
      }
    }
  } finally {
    if (pool) await pool.end().catch(() => {});
  }

  console.log(
    `[sync] done scanned=${counts.scanned} inserted=${counts.inserted} ` +
      `updated=${counts.updated} unchanged=${counts.unchanged} ` +
      `skipped=${counts.skipped} errored=${counts.errored}`,
  );
}

// ============================================================================
// status mode
// ============================================================================

async function runStatus({ memoryDir }) {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required for --status.");
    process.exit(2);
  }
  if (!fs.existsSync(memoryDir)) {
    console.error(`ERROR: memory dir does not exist: ${memoryDir}`);
    process.exit(2);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
  });

  try {
    const dbRows = await pool.query(
      `SELECT slug, file_basename, body_sha256, last_synced_from_local_at
         FROM solene_memory_files
         ORDER BY file_basename ASC`,
    );
    const dbBySlug = new Map(dbRows.rows.map((r) => [r.slug, r]));

    const files = fs
      .readdirSync(memoryDir)
      .filter((f) => f.endsWith(".md"))
      .sort();

    console.log(`[status] dbRows=${dbRows.rows.length} localFiles=${files.length}`);

    let inSync = 0;
    let drifted = 0;
    let onlyLocal = 0;
    let onlyDb = 0;

    const seenSlugs = new Set();

    for (const file of files) {
      const fullPath = path.join(memoryDir, file);
      const raw = fs.readFileSync(fullPath, "utf8");
      const { fm } = parseFrontmatter(raw);
      const slug = fm.name && fm.name.length > 0 ? fm.name : file.replace(/\.md$/, "");
      seenSlugs.add(slug);
      const dbRow = dbBySlug.get(slug);
      const localHash = computeBodyHash(raw);
      if (!dbRow) {
        console.log(`[only-local]  ${file} slug=${slug}`);
        onlyLocal += 1;
        continue;
      }
      if (dbRow.body_sha256 === localHash) {
        inSync += 1;
      } else {
        console.log(
          `[drift]       ${file} slug=${slug} lastSynced=${dbRow.last_synced_from_local_at ?? "never"}`,
        );
        drifted += 1;
      }
    }

    for (const row of dbRows.rows) {
      if (!seenSlugs.has(row.slug)) {
        console.log(`[only-db]     ${row.file_basename} slug=${row.slug}`);
        onlyDb += 1;
      }
    }

    console.log(
      `[status] done inSync=${inSync} drifted=${drifted} onlyLocal=${onlyLocal} onlyDb=${onlyDb}`,
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

// ============================================================================
// main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const memoryDir = process.env.SOLENE_MEMORY_DIR || DEFAULT_MEMORY_DIR;

  if (args.status) {
    await runStatus({ memoryDir });
    return;
  }
  await runSync({ dryRun: args.dryRun, memoryDir });
}

main().catch((err) => {
  console.error(
    `[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
  );
  process.exit(1);
});

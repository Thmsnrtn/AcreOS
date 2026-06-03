#!/usr/bin/env node
/**
 * scripts/ingest-feedback-memories.mjs
 *
 * Phase B L3.10 — Walk the feedback_*.md memory corpus, compute a placeholder
 * embedding for each, UPSERT into `solene_embedded_records` so the L3.10
 * learning-loop service has something to retrieve.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/ingest-feedback-memories.mjs ingest
 *   DATABASE_URL=... node scripts/ingest-feedback-memories.mjs --dry-run
 *
 * Override the memory dir via SOLENE_MEMORY_DIR (defaults to
 * $HOME/.claude/projects/-Users-user-AcreOS-AcreOS/memory).
 *
 * Phase 0 placeholder embedding: deterministic feature-hash → 1024-dim,
 * L2-normalized. The same algorithm lives in
 *   server/services/solene/learningLoop.ts :: placeholderEmbedding
 * so the ingestion + query paths produce comparable vectors without sharing
 * a runtime. When a real embeddings provider key (Voyage / Cohere /
 * Anthropic) is available, swap both sites + re-run ingest --force.
 *
 * Behavior:
 *   - parse `name:` and `description:` from frontmatter (simple regex)
 *   - skip files without `name:` (warn)
 *   - content_hash = sha256 of full body; UPSERT skips when hash matches
 *   - --dry-run computes embeddings but writes nothing
 *   - prints summary: scanned / inserted / updated / skipped / errored
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

// ============================================================================
// Constants — keep in sync with shared/schema/solene-embeddings.ts
// ============================================================================

const EMBEDDING_DIM = (() => {
  const raw = process.env.EMBEDDING_DIM;
  if (!raw) return 1024;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 1024;
  return n;
})();

const EMBEDDED_SNIPPET_MAX_CHARS = 4000;
const EMBEDDED_SNIPPET_TRUNCATION_SUFFIX = "… [truncated]";
const NAMESPACE = "feedback_memory";
const EMBEDDING_MODEL = "placeholder-feature-hash-v1";

const DEFAULT_MEMORY_DIR = path.join(
  process.env.HOME ?? "",
  ".claude/projects/-Users-user-AcreOS-AcreOS/memory",
);

// ============================================================================
// Placeholder embedding — duplicated from learningLoop.ts on purpose
// ============================================================================
function placeholderEmbedding(text, dim = EMBEDDING_DIM) {
  const vec = new Array(dim).fill(0);
  const tokens = text.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  for (const tok of tokens) {
    const h = crypto.createHash("md5").update(tok).digest();
    for (let i = 0; i < dim; i++) {
      vec[i] += h[i % h.length] / 255 - 0.5;
    }
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

function vectorToPgLiteral(vec) {
  return "[" + vec.join(",") + "]";
}

function truncateSnippet(text) {
  if (text.length <= EMBEDDED_SNIPPET_MAX_CHARS) return text;
  return (
    text.slice(0, EMBEDDED_SNIPPET_MAX_CHARS) +
    EMBEDDED_SNIPPET_TRUNCATION_SUFFIX
  );
}

// ============================================================================
// Frontmatter parser — minimal, no external dep
// ============================================================================
function parseFrontmatter(raw) {
  // Match a leading `---\n...frontmatter...\n---\n` block.
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fmBlock = m[1];
  const body = m[2];
  const fm = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    // Stop at the first nested key (we only need name + description).
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const memoryDir = process.env.SOLENE_MEMORY_DIR || DEFAULT_MEMORY_DIR;

  if (!process.env.DATABASE_URL && !dryRun) {
    console.error("ERROR: DATABASE_URL is required (or pass --dry-run).");
    process.exit(2);
  }

  if (!fs.existsSync(memoryDir)) {
    console.error(`ERROR: memory dir does not exist: ${memoryDir}`);
    process.exit(2);
  }

  const files = fs
    .readdirSync(memoryDir)
    .filter((f) => f.startsWith("feedback_") && f.endsWith(".md"))
    .sort();

  console.log(
    `[ingest] memoryDir=${memoryDir} files=${files.length} dryRun=${dryRun} dim=${EMBEDDING_DIM}`,
  );

  const counts = { scanned: 0, inserted: 0, updated: 0, skipped: 0, errored: 0 };
  let pool = null;
  if (!dryRun) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }

  try {
    for (const file of files) {
      counts.scanned += 1;
      const fullPath = path.join(memoryDir, file);
      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const { fm, body } = parseFrontmatter(raw);
        if (!fm.name) {
          console.warn(`[warn] ${file}: missing frontmatter name — skipping`);
          counts.skipped += 1;
          continue;
        }
        const slug = fm.name;
        const description = fm.description ?? "";
        // Embed body + description so the retrieval has more signal than the
        // title-only path.
        const embeddingInput = `${slug}\n${description}\n${body}`;
        const contentHash = crypto
          .createHash("sha256")
          .update(raw, "utf8")
          .digest("hex");
        const snippet = truncateSnippet(`${description}\n\n${body}`);
        const vec = placeholderEmbedding(embeddingInput, EMBEDDING_DIM);

        if (dryRun) {
          console.log(
            `[dry] ${file} → slug=${slug} hash=${contentHash.slice(0, 12)}… dim=${vec.length}`,
          );
          counts.inserted += 1; // pretend
          continue;
        }

        // Look up existing row for this (namespace, slug) to decide
        // insert vs update vs skip.
        const existing = await pool.query(
          `SELECT id, content_hash FROM solene_embedded_records
           WHERE namespace = $1 AND source_ref = $2`,
          [NAMESPACE, slug],
        );

        if (existing.rows.length > 0) {
          if (existing.rows[0].content_hash === contentHash) {
            counts.skipped += 1;
            continue;
          }
          await pool.query(
            `UPDATE solene_embedded_records
               SET content_snippet = $1,
                   content_hash = $2,
                   embedding_model = $3,
                   embedding_dim = $4,
                   embedding = $5::vector,
                   metadata = $6
             WHERE id = $7`,
            [
              snippet,
              contentHash,
              EMBEDDING_MODEL,
              EMBEDDING_DIM,
              vectorToPgLiteral(vec),
              JSON.stringify({ description, file }),
              existing.rows[0].id,
            ],
          );
          counts.updated += 1;
          console.log(`[update] ${slug}`);
        } else {
          await pool.query(
            `INSERT INTO solene_embedded_records
               (namespace, source_ref, content_snippet, content_hash,
                embedding_model, embedding_dim, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)`,
            [
              NAMESPACE,
              slug,
              snippet,
              contentHash,
              EMBEDDING_MODEL,
              EMBEDDING_DIM,
              vectorToPgLiteral(vec),
              JSON.stringify({ description, file }),
            ],
          );
          counts.inserted += 1;
          console.log(`[insert] ${slug}`);
        }
      } catch (err) {
        counts.errored += 1;
        console.error(`[error] ${file}: ${err?.message ?? err}`);
      }
    }
  } finally {
    if (pool) await pool.end();
  }

  console.log("[ingest] summary:", counts);
  if (counts.errored > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

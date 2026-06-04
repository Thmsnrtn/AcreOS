#!/usr/bin/env node
/**
 * scripts/ingest-feedback-memories.mjs
 *
 * Phase B L3.10 — Walk the feedback_*.md memory corpus, compute embeddings
 * (Voyage AI by default; placeholder fallback), and UPSERT into
 * `solene_embedded_records` so the L3.10 learning-loop service has
 * something to retrieve.
 *
 * Usage:
 *   DATABASE_URL=... VOYAGE_API_KEY=... node scripts/ingest-feedback-memories.mjs
 *   DATABASE_URL=... node scripts/ingest-feedback-memories.mjs --provider=placeholder
 *   DATABASE_URL=... node scripts/ingest-feedback-memories.mjs --re-embed-all
 *   DATABASE_URL=... node scripts/ingest-feedback-memories.mjs --dry-run
 *   node scripts/ingest-feedback-memories.mjs --help
 *
 * Flags:
 *   --provider=voyage|placeholder
 *       Embedding provider. Default: voyage if VOYAGE_API_KEY is set, else
 *       placeholder. The Voyage path produces voyage-3-large (1024-dim)
 *       vectors; the placeholder produces the deterministic feature-hash
 *       vectors shipped during Phase 0.
 *   --re-embed-all
 *       Force re-embedding of every row regardless of content_hash drift.
 *       Used after a provider swap to refresh the entire corpus. Additionally
 *       (without this flag) any row whose stored `embedding_model` doesn't
 *       match the current target model is re-embedded.
 *   --dry-run
 *       Compute embeddings + log the plan but write nothing.
 *   --help
 *       Print this help text.
 *
 * Override the memory dir via SOLENE_MEMORY_DIR (defaults to
 * $HOME/.claude/projects/-Users-user-AcreOS-AcreOS/memory).
 *
 * Voyage credential discipline:
 *   - VOYAGE_API_KEY is read at run-time + NEVER printed (only its length).
 *   - Each text is sanitized for credential-shaped substrings before being
 *     sent to Voyage (same pattern set as server/services/embeddings/
 *     voyageClient.ts).
 *   - Per-chunk failure → fall back to placeholder for that row + continue.
 *
 * Summary output includes rows-via-voyage, rows-via-placeholder, total
 * voyage cost estimate, and the count of Voyage errors observed.
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

const PLACEHOLDER_MODEL = "placeholder-feature-hash-v1";
const VOYAGE_MODEL =
  process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3-large";
const VOYAGE_API_BASE =
  process.env.VOYAGE_API_BASE ?? "https://api.voyageai.com/v1";
const VOYAGE_TIMEOUT_MS = (() => {
  const raw = process.env.VOYAGE_TIMEOUT_MS;
  if (!raw) return 30_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
})();
const VOYAGE_PRICE_PER_M_TOKENS = (() => {
  const raw = process.env.VOYAGE_PRICE_PER_M_TOKENS;
  if (!raw) return 0.18;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.18;
})();

const DEFAULT_MEMORY_DIR = path.join(
  process.env.HOME ?? "",
  ".claude/projects/-Users-user-AcreOS-AcreOS/memory",
);

// ============================================================================
// Credential-shaped substring sanitizer — mirrors voyageClient.ts
// ============================================================================
const CREDENTIAL_PATTERNS = [
  /\bsk_[A-Za-z0-9_-]{8,}/g,
  /\bpk_[A-Za-z0-9_-]{8,}/g,
  /\bphc_[A-Za-z0-9_-]{8,}/g,
  /\bphx_[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9_\-.=]{8,}/g,
  /\bAKIA[A-Z0-9]{12,}/g,
  /\bASIA[A-Z0-9]{12,}/g,
];
const REDACTED_MARKER = "[redacted-credential]";

function sanitizeForVoyage(text) {
  let out = text;
  for (const pat of CREDENTIAL_PATTERNS) out = out.replace(pat, REDACTED_MARKER);
  return out;
}

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
// Voyage helper — self-contained, no project imports
// ============================================================================

function estimateVoyageCost(tokens) {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const usd = (tokens / 1_000_000) * VOYAGE_PRICE_PER_M_TOKENS;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

async function embedDocumentsViaVoyage(texts) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");
  const sanitized = texts.map(sanitizeForVoyage);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: sanitized,
        input_type: "document",
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw new Error(`voyage timeout after ${VOYAGE_TIMEOUT_MS}ms`);
    }
    throw new Error(`voyage network error: ${err?.message ?? err}`);
  }
  clearTimeout(timer);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`voyage HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  const json = await response.json();
  const data = json?.data;
  if (!Array.isArray(data)) throw new Error("voyage response missing data[]");
  if (data.length !== sanitized.length) {
    throw new Error(
      `voyage response length mismatch: expected ${sanitized.length} got ${data.length}`,
    );
  }
  const embeddings = [];
  for (let i = 0; i < data.length; i++) {
    const vec = data[i]?.embedding;
    if (!Array.isArray(vec)) throw new Error(`voyage data[${i}].embedding missing`);
    if (vec.length !== EMBEDDING_DIM) {
      throw new Error(
        `voyage dim mismatch at data[${i}]: expected ${EMBEDDING_DIM} got ${vec.length}`,
      );
    }
    embeddings.push(vec);
  }
  const tokens = json?.usage?.total_tokens ?? 0;
  return { embeddings, tokens, cost: estimateVoyageCost(tokens) };
}

// ============================================================================
// Frontmatter parser — minimal, no external dep
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

// ============================================================================
// CLI
// ============================================================================

function printHelp() {
  console.log(`scripts/ingest-feedback-memories.mjs — feedback-memory ingest

Flags:
  --provider=voyage|placeholder
      Embedding provider. Default: voyage if VOYAGE_API_KEY is set, else placeholder.
  --re-embed-all
      Force re-embed of every row regardless of content_hash. Used after a
      provider swap to refresh the entire corpus. Also: without this flag,
      rows whose embedding_model column doesn't match the current target
      model are re-embedded automatically.
  --dry-run
      Compute embeddings + log the plan but write nothing to the database.
  --help
      Print this help text.

Env:
  DATABASE_URL                Postgres connection string (required unless --dry-run).
  VOYAGE_API_KEY              Voyage AI key (required for --provider=voyage).
  VOYAGE_EMBEDDING_MODEL      Override the model id (default: voyage-3-large).
  VOYAGE_API_BASE             Override the API base URL (default: https://api.voyageai.com/v1).
  VOYAGE_TIMEOUT_MS           Override the per-call timeout (default: 30000).
  VOYAGE_PRICE_PER_M_TOKENS   Override the cost estimate rate (default: 0.18).
  SOLENE_MEMORY_DIR           Override the memory directory.
`);
}

function parseArgs(argv) {
  const args = { dryRun: false, reEmbedAll: false, provider: null, help: false };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--re-embed-all") args.reEmbedAll = true;
    else if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw.startsWith("--provider=")) {
      args.provider = raw.slice("--provider=".length);
    }
  }
  return args;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  // Resolve provider: explicit flag wins; else auto-detect from VOYAGE_API_KEY.
  let provider = args.provider;
  if (!provider) {
    provider = process.env.VOYAGE_API_KEY ? "voyage" : "placeholder";
  }
  if (provider !== "voyage" && provider !== "placeholder") {
    console.error(
      `ERROR: --provider=${provider} not in {voyage, placeholder}`,
    );
    process.exit(2);
  }
  if (provider === "voyage" && !process.env.VOYAGE_API_KEY) {
    console.error(
      "ERROR: --provider=voyage requires VOYAGE_API_KEY to be set.",
    );
    process.exit(2);
  }

  const targetModel = provider === "voyage" ? VOYAGE_MODEL : PLACEHOLDER_MODEL;
  const apiKeyLen = process.env.VOYAGE_API_KEY?.length ?? 0;

  const memoryDir = process.env.SOLENE_MEMORY_DIR || DEFAULT_MEMORY_DIR;

  if (!process.env.DATABASE_URL && !args.dryRun) {
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
    `[ingest] memoryDir=${memoryDir} files=${files.length} ` +
      `dryRun=${args.dryRun} dim=${EMBEDDING_DIM} ` +
      `provider=${provider} targetModel=${targetModel} ` +
      `reEmbedAll=${args.reEmbedAll}` +
      (provider === "voyage" ? ` voyageKeyLen=${apiKeyLen}` : ""),
  );

  const counts = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errored: 0,
    viaVoyage: 0,
    viaPlaceholder: 0,
    voyageErrors: 0,
    voyageTokens: 0,
    voyageCostUsd: 0,
  };

  let pool = null;
  if (!args.dryRun) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  }

  // Per-row embedder with per-call fallback to placeholder.
  async function embedRowText(text) {
    if (provider === "placeholder") {
      return {
        vec: placeholderEmbedding(text, EMBEDDING_DIM),
        usedModel: PLACEHOLDER_MODEL,
      };
    }
    try {
      const result = await embedDocumentsViaVoyage([text]);
      counts.viaVoyage += 1;
      counts.voyageTokens += result.tokens;
      counts.voyageCostUsd += result.cost;
      return { vec: result.embeddings[0], usedModel: VOYAGE_MODEL };
    } catch (err) {
      counts.voyageErrors += 1;
      counts.viaPlaceholder += 1;
      console.warn(
        `[voyage-fallback] using placeholder for chunk: ${err?.message ?? err}`,
      );
      return {
        vec: placeholderEmbedding(text, EMBEDDING_DIM),
        usedModel: PLACEHOLDER_MODEL,
      };
    }
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
        const embeddingInput = `${slug}\n${description}\n${body}`;
        const contentHash = crypto
          .createHash("sha256")
          .update(raw, "utf8")
          .digest("hex");
        const snippet = truncateSnippet(`${description}\n\n${body}`);

        if (args.dryRun) {
          console.log(
            `[dry] ${file} → slug=${slug} hash=${contentHash.slice(0, 12)}… ` +
              `provider=${provider} targetModel=${targetModel}`,
          );
          counts.inserted += 1;
          if (provider === "placeholder") counts.viaPlaceholder += 1;
          continue;
        }

        const existing = await pool.query(
          `SELECT id, content_hash, embedding_model FROM solene_embedded_records
           WHERE namespace = $1 AND source_ref = $2`,
          [NAMESPACE, slug],
        );

        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          const hashMatches = row.content_hash === contentHash;
          const modelMatches = row.embedding_model === targetModel;
          if (hashMatches && modelMatches && !args.reEmbedAll) {
            counts.skipped += 1;
            continue;
          }
          const { vec, usedModel } = await embedRowText(embeddingInput);
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
              usedModel,
              EMBEDDING_DIM,
              vectorToPgLiteral(vec),
              JSON.stringify({ description, file }),
              row.id,
            ],
          );
          counts.updated += 1;
          console.log(`[update] ${slug} model=${usedModel}`);
        } else {
          const { vec, usedModel } = await embedRowText(embeddingInput);
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
              usedModel,
              EMBEDDING_DIM,
              vectorToPgLiteral(vec),
              JSON.stringify({ description, file }),
            ],
          );
          counts.inserted += 1;
          console.log(`[insert] ${slug} model=${usedModel}`);
        }
      } catch (err) {
        counts.errored += 1;
        console.error(`[error] ${file}: ${err?.message ?? err}`);
      }
    }
  } finally {
    if (pool) await pool.end();
  }

  console.log("[ingest] summary:", {
    ...counts,
    voyageCostUsd: Math.round(counts.voyageCostUsd * 1_000_000) / 1_000_000,
  });
  if (counts.errored > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

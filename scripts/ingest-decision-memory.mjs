#!/usr/bin/env node
/**
 * scripts/ingest-decision-memory.mjs
 *
 * Phase B L3.14 — Walk the DB-row source tables (solene_dispatch_queue,
 * solene_agent_identity_decisions, solene_decision_traces,
 * solene_audit_findings), compute a placeholder embedding for each row, and
 * UPSERT into `solene_embedded_records` under the appropriate namespace so
 * the L3.14 cross-namespace retrieval service has something to retrieve.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs ingest [--namespace=<ns>]
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs --dry-run [--namespace=<ns>]
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs --status
 *
 * Namespaces handled (default: all):
 *   dispatch_summary       solene_dispatch_queue (status='completed')
 *   agent_decision         solene_agent_identity_decisions
 *   decision_trace_step    solene_decision_traces
 *   audit_finding          solene_audit_findings (skipped if table missing)
 *
 * Incremental via solene_memory_corpus_status.last_ingested_source_id —
 * each pass resumes from `id > <high_water_mark>` per namespace and writes
 * the new high-water-mark back when finished.
 *
 * Phase 0 placeholder embedding: deterministic feature-hash → 1024-dim,
 * L2-normalized. Same algorithm lives in:
 *   server/services/solene/memoryRetrieval.ts :: placeholderEmbedding
 *   server/services/solene/learningLoop.ts :: placeholderEmbedding
 *   scripts/ingest-feedback-memories.mjs
 * Production embeddings swap MUST update all four sites.
 */

import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

// ============================================================================
// Constants
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
const EMBEDDING_MODEL = "placeholder-feature-hash-v1";

const NAMESPACES = [
  "dispatch_summary",
  "agent_decision",
  "decision_trace_step",
  "audit_finding",
];

const PROMPT_TEXT_PREVIEW_MAX = 500;
const RESULT_SUMMARY_PREVIEW_MAX = 500;

const PER_NAMESPACE_BATCH_LIMIT = 500;

// ============================================================================
// Placeholder embedding
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

function clip(text, max) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function contentHash(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ============================================================================
// CLI parsing
// ============================================================================

function parseArgs(argv) {
  const args = { dryRun: false, status: false, namespace: null };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--status") args.status = true;
    else if (raw.startsWith("--namespace=")) {
      args.namespace = raw.slice("--namespace=".length);
    }
  }
  return args;
}

// ============================================================================
// Status-table helpers
// ============================================================================

async function getCorpusStatusRow(pool, namespace) {
  const res = await pool.query(
    `SELECT id, last_ingested_at, last_ingested_source_id, rows_ingested,
            rows_skipped_unchanged, rows_failed, last_run_summary
       FROM solene_memory_corpus_status
      WHERE namespace = $1`,
    [namespace],
  );
  return res.rows[0] ?? null;
}

async function upsertCorpusStatus(pool, namespace, patch) {
  const existing = await getCorpusStatusRow(pool, namespace);
  if (existing) {
    await pool.query(
      `UPDATE solene_memory_corpus_status
          SET last_ingested_at = COALESCE($2, last_ingested_at),
              last_ingested_source_id = COALESCE($3, last_ingested_source_id),
              rows_ingested = rows_ingested + $4,
              rows_skipped_unchanged = rows_skipped_unchanged + $5,
              rows_failed = rows_failed + $6,
              last_run_summary = $7
        WHERE namespace = $1`,
      [
        namespace,
        patch.lastIngestedAt,
        patch.lastIngestedSourceId,
        patch.rowsIngested ?? 0,
        patch.rowsSkippedUnchanged ?? 0,
        patch.rowsFailed ?? 0,
        patch.lastRunSummary,
      ],
    );
  } else {
    await pool.query(
      `INSERT INTO solene_memory_corpus_status
         (namespace, last_ingested_at, last_ingested_source_id,
          rows_ingested, rows_skipped_unchanged, rows_failed, last_run_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        namespace,
        patch.lastIngestedAt,
        patch.lastIngestedSourceId,
        patch.rowsIngested ?? 0,
        patch.rowsSkippedUnchanged ?? 0,
        patch.rowsFailed ?? 0,
        patch.lastRunSummary,
      ],
    );
  }
}

// ============================================================================
// Embed + UPSERT helper
// ============================================================================

async function upsertEmbeddedRow(pool, ns, sourceRef, fullText, metadata) {
  const snippet = truncateSnippet(fullText);
  const hash = contentHash(fullText);
  const existing = await pool.query(
    `SELECT id, content_hash FROM solene_embedded_records
      WHERE namespace = $1 AND source_ref = $2`,
    [ns, sourceRef],
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].content_hash === hash) return "skipped";
    const vec = placeholderEmbedding(fullText, EMBEDDING_DIM);
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
        hash,
        EMBEDDING_MODEL,
        EMBEDDING_DIM,
        vectorToPgLiteral(vec),
        JSON.stringify(metadata),
        existing.rows[0].id,
      ],
    );
    return "updated";
  }
  const vec = placeholderEmbedding(fullText, EMBEDDING_DIM);
  await pool.query(
    `INSERT INTO solene_embedded_records
       (namespace, source_ref, content_snippet, content_hash,
        embedding_model, embedding_dim, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)`,
    [
      ns,
      sourceRef,
      snippet,
      hash,
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      vectorToPgLiteral(vec),
      JSON.stringify(metadata),
    ],
  );
  return "inserted";
}

// ============================================================================
// Per-namespace ingest handlers
// ============================================================================

async function ingestDispatchSummary(pool, dryRun) {
  const ns = "dispatch_summary";
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = status?.last_ingested_source_id ?? 0;
  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: watermark };
  const res = await pool.query(
    `SELECT id, agent_role, prompt_text, completed_at, result_summary
       FROM solene_dispatch_queue
      WHERE status = 'completed' AND id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [watermark, PER_NAMESPACE_BATCH_LIMIT],
  );
  for (const row of res.rows) {
    const sourceRef = `dispatch:${row.id}`;
    const resultPreview = clip(row.result_summary ?? "", RESULT_SUMMARY_PREVIEW_MAX);
    const promptPreview = clip(row.prompt_text ?? "", PROMPT_TEXT_PREVIEW_MAX);
    const fullText = `${row.agent_role}: ${resultPreview}\n\n[prompt preview] ${promptPreview}`;
    try {
      if (dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c)`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(pool, ns, sourceRef, fullText, {
          agent_role: row.agent_role,
          completed_at: row.completed_at,
        });
        counts[r] = (counts[r] ?? 0) + 1;
      }
      if (row.id > counts.maxId) counts.maxId = row.id;
    } catch (err) {
      counts.failed += 1;
      console.error(`[error] ${ns} ${sourceRef}: ${err?.message ?? err}`);
    }
  }
  return counts;
}

async function ingestAgentDecision(pool, dryRun) {
  const ns = "agent_decision";
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = status?.last_ingested_source_id ?? 0;
  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: watermark };
  const res = await pool.query(
    `SELECT id, agent_role, summary, rationale
       FROM solene_agent_identity_decisions
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [watermark, PER_NAMESPACE_BATCH_LIMIT],
  );
  for (const row of res.rows) {
    const sourceRef = `decision:${row.id}`;
    const fullText = `${row.summary}\n\n${row.rationale}`;
    try {
      if (dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c)`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(pool, ns, sourceRef, fullText, {
          agent_role: row.agent_role,
        });
        counts[r] = (counts[r] ?? 0) + 1;
      }
      if (row.id > counts.maxId) counts.maxId = row.id;
    } catch (err) {
      counts.failed += 1;
      console.error(`[error] ${ns} ${sourceRef}: ${err?.message ?? err}`);
    }
  }
  return counts;
}

async function ingestDecisionTraceStep(pool, dryRun) {
  const ns = "decision_trace_step";
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = status?.last_ingested_source_id ?? 0;
  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: watermark };
  const res = await pool.query(
    `SELECT id, decision_id, step_kind, step_text
       FROM solene_decision_traces
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [watermark, PER_NAMESPACE_BATCH_LIMIT],
  );
  for (const row of res.rows) {
    const sourceRef = `trace:${row.decision_id}:${row.id}`;
    const fullText = `[${row.step_kind}] ${row.step_text}`;
    try {
      if (dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c)`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(pool, ns, sourceRef, fullText, {
          decision_id: row.decision_id,
          step_kind: row.step_kind,
        });
        counts[r] = (counts[r] ?? 0) + 1;
      }
      if (row.id > counts.maxId) counts.maxId = row.id;
    } catch (err) {
      counts.failed += 1;
      console.error(`[error] ${ns} ${sourceRef}: ${err?.message ?? err}`);
    }
  }
  return counts;
}

async function ingestAuditFinding(pool, dryRun) {
  const ns = "audit_finding";
  // Check table presence — solene_audit_findings is shipped but the
  // detector is opt-in; treat absence as "nothing to ingest, not a fail".
  const check = await pool.query(`SELECT to_regclass('solene_audit_findings') AS reg`);
  if (!check.rows[0]?.reg) {
    console.log(`[skip] ${ns}: solene_audit_findings table not present`);
    return { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: 0, missing: true };
  }
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = status?.last_ingested_source_id ?? 0;
  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: watermark };
  // The shipped schema uses `pattern` (detector name) + `excerpt` (finding text).
  const res = await pool.query(
    `SELECT id, pattern, excerpt, severity
       FROM solene_audit_findings
      WHERE id > $1
      ORDER BY id ASC
      LIMIT $2`,
    [watermark, PER_NAMESPACE_BATCH_LIMIT],
  );
  for (const row of res.rows) {
    const sourceRef = `audit:${row.id}`;
    const fullText = `[${row.severity}] ${row.pattern}: ${row.excerpt}`;
    try {
      if (dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c)`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(pool, ns, sourceRef, fullText, {
          severity: row.severity,
          pattern: row.pattern,
        });
        counts[r] = (counts[r] ?? 0) + 1;
      }
      if (row.id > counts.maxId) counts.maxId = row.id;
    } catch (err) {
      counts.failed += 1;
      console.error(`[error] ${ns} ${sourceRef}: ${err?.message ?? err}`);
    }
  }
  return counts;
}

const HANDLERS = {
  dispatch_summary: ingestDispatchSummary,
  agent_decision: ingestAgentDecision,
  decision_trace_step: ingestDecisionTraceStep,
  audit_finding: ingestAuditFinding,
};

// ============================================================================
// Status command
// ============================================================================

async function printStatus(pool) {
  const res = await pool.query(
    `SELECT namespace, last_ingested_at, last_ingested_source_id,
            rows_ingested, rows_skipped_unchanged, rows_failed, last_run_summary
       FROM solene_memory_corpus_status
      ORDER BY namespace ASC`,
  );
  if (res.rows.length === 0) {
    console.log("[status] no rows yet — has the ingestion job run?");
    return;
  }
  console.log("[status] per-namespace corpus state:");
  for (const row of res.rows) {
    console.log(
      `  ${row.namespace.padEnd(22)} ` +
        `ingested=${row.rows_ingested} ` +
        `skipped=${row.rows_skipped_unchanged} ` +
        `failed=${row.rows_failed} ` +
        `hwm=${row.last_ingested_source_id ?? "∅"} ` +
        `last=${row.last_ingested_at ? row.last_ingested_at.toISOString() : "∅"}`,
    );
    if (row.last_run_summary) {
      console.log(`    └─ ${row.last_run_summary}`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(2);
  }
  if (args.namespace && !NAMESPACES.includes(args.namespace)) {
    console.error(
      `ERROR: --namespace=${args.namespace} not in {${NAMESPACES.join(", ")}}`,
    );
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  let exitCode = 0;

  try {
    if (args.status) {
      await printStatus(pool);
      return;
    }

    const targets = args.namespace ? [args.namespace] : NAMESPACES;
    console.log(
      `[ingest-decision-memory] targets=[${targets.join(",")}] ` +
        `dryRun=${args.dryRun} dim=${EMBEDDING_DIM}`,
    );

    const grandTotals = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
    for (const ns of targets) {
      const handler = HANDLERS[ns];
      const t0 = Date.now();
      const counts = await handler(pool, args.dryRun);
      const elapsed = Date.now() - t0;
      const summary =
        `ingested=${counts.inserted} updated=${counts.updated} ` +
        `skipped=${counts.skipped} failed=${counts.failed} ` +
        `(${elapsed}ms)`;
      console.log(`[${ns}] ${summary}`);
      if (counts.missing) continue;

      grandTotals.inserted += counts.inserted;
      grandTotals.updated += counts.updated;
      grandTotals.skipped += counts.skipped;
      grandTotals.failed += counts.failed;

      if (counts.failed > 0) exitCode = 1;

      if (!args.dryRun) {
        await upsertCorpusStatus(pool, ns, {
          lastIngestedAt: new Date(),
          lastIngestedSourceId: counts.maxId,
          rowsIngested: counts.inserted + counts.updated,
          rowsSkippedUnchanged: counts.skipped,
          rowsFailed: counts.failed,
          lastRunSummary: summary,
        });
      }
    }

    console.log("[ingest-decision-memory] grand totals:", grandTotals);
  } finally {
    await pool.end();
  }

  if (exitCode !== 0) process.exit(exitCode);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

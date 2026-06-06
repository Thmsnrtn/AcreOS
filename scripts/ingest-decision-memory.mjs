#!/usr/bin/env node
/**
 * scripts/ingest-decision-memory.mjs
 *
 * Phase B L3.14 — Walk the DB-row source tables (solene_dispatch_queue,
 * solene_agent_identity_decisions, solene_decision_traces,
 * solene_audit_findings), compute embeddings (Voyage AI by default;
 * placeholder fallback), and UPSERT into `solene_embedded_records` under
 * the appropriate namespace so the L3.14 cross-namespace retrieval service
 * has something to retrieve.
 *
 * Usage:
 *   DATABASE_URL=... VOYAGE_API_KEY=... node scripts/ingest-decision-memory.mjs
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs --provider=placeholder
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs --re-embed-all
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs --dry-run [--namespace=<ns>]
 *   DATABASE_URL=... node scripts/ingest-decision-memory.mjs --status
 *   node scripts/ingest-decision-memory.mjs --help
 *
 * Flags:
 *   --provider=voyage|placeholder
 *       Embedding provider. Default: voyage if VOYAGE_API_KEY is set, else
 *       placeholder.
 *   --re-embed-all
 *       Force re-embedding of every row regardless of content_hash. Used
 *       after a provider swap. Without this flag, rows whose stored
 *       embedding_model doesn't match the current target are re-embedded.
 *   --namespace=<ns>
 *       Limit to a single namespace.
 *   --dry-run / --status / --help
 *       Standard.
 *
 * Namespaces handled (default: all):
 *   dispatch_summary       solene_dispatch_queue (status='completed')
 *   agent_decision         solene_agent_identity_decisions
 *   decision_trace_step    solene_decision_traces
 *   audit_finding          solene_audit_findings (skipped if table missing)
 *
 * Voyage credential discipline:
 *   - VOYAGE_API_KEY read at run-time + NEVER printed (only its length).
 *   - Texts sanitized for credential-shaped substrings before send.
 *   - Per-chunk failure → fall back to placeholder for that row + continue.
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
// Credential-shaped substring sanitizer
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
// Voyage helper
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
// CLI
// ============================================================================

function printHelp() {
  console.log(`scripts/ingest-decision-memory.mjs — decision/dispatch corpus ingest

Flags:
  --provider=voyage|placeholder
      Default: voyage if VOYAGE_API_KEY is set, else placeholder.
  --re-embed-all
      Force re-embed of every row regardless of content_hash. Without it,
      rows whose embedding_model column doesn't match the current target
      model are still re-embedded.
  --namespace=<ns>          Limit to one of dispatch_summary, agent_decision,
                            decision_trace_step, audit_finding.
  --dry-run                 Plan only; write nothing.
  --status                  Print per-namespace corpus state and exit.
  --help                    This text.
`);
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    status: false,
    namespace: null,
    provider: null,
    reEmbedAll: false,
    help: false,
  };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--status") args.status = true;
    else if (raw === "--re-embed-all") args.reEmbedAll = true;
    else if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw.startsWith("--namespace=")) {
      args.namespace = raw.slice("--namespace=".length);
    } else if (raw.startsWith("--provider=")) {
      args.provider = raw.slice("--provider=".length);
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
// Embed dispatcher with per-call fallback
// ============================================================================

function makeRowEmbedder(provider, counts) {
  return async function embedRowText(text) {
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
  };
}

// ============================================================================
// Embed + UPSERT helper
// ============================================================================

async function upsertEmbeddedRow(
  pool,
  ns,
  sourceRef,
  fullText,
  metadata,
  embedRowText,
  targetModel,
  reEmbedAll,
) {
  const snippet = truncateSnippet(fullText);
  const hash = contentHash(fullText);
  // Decision-memory rows are TEAM-INTERNAL — organization_id IS NULL.
  // The natural-key index is now (organization_id, namespace, source_ref);
  // scoping IS NULL keeps the upsert idempotent against any future
  // per-tenant rows that re-use the same (namespace, source_ref).
  const existing = await pool.query(
    `SELECT id, content_hash, embedding_model FROM solene_embedded_records
      WHERE organization_id IS NULL
        AND namespace = $1 AND source_ref = $2`,
    [ns, sourceRef],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const hashMatches = row.content_hash === hash;
    const modelMatches = row.embedding_model === targetModel;
    if (hashMatches && modelMatches && !reEmbedAll) return "skipped";
    const { vec, usedModel } = await embedRowText(fullText);
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
        usedModel,
        EMBEDDING_DIM,
        vectorToPgLiteral(vec),
        JSON.stringify(metadata),
        row.id,
      ],
    );
    return "updated";
  }
  const { vec, usedModel } = await embedRowText(fullText);
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
      usedModel,
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

async function ingestDispatchSummary(pool, ctx) {
  const ns = "dispatch_summary";
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = ctx.reEmbedAll ? 0 : status?.last_ingested_source_id ?? 0;
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
      if (ctx.dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c) provider=${ctx.provider}`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(
          pool,
          ns,
          sourceRef,
          fullText,
          { agent_role: row.agent_role, completed_at: row.completed_at },
          ctx.embedRowText,
          ctx.targetModel,
          ctx.reEmbedAll,
        );
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

async function ingestAgentDecision(pool, ctx) {
  const ns = "agent_decision";
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = ctx.reEmbedAll ? 0 : status?.last_ingested_source_id ?? 0;
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
      if (ctx.dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c) provider=${ctx.provider}`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(
          pool,
          ns,
          sourceRef,
          fullText,
          { agent_role: row.agent_role },
          ctx.embedRowText,
          ctx.targetModel,
          ctx.reEmbedAll,
        );
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

async function ingestDecisionTraceStep(pool, ctx) {
  const ns = "decision_trace_step";
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = ctx.reEmbedAll ? 0 : status?.last_ingested_source_id ?? 0;
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
      if (ctx.dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c) provider=${ctx.provider}`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(
          pool,
          ns,
          sourceRef,
          fullText,
          { decision_id: row.decision_id, step_kind: row.step_kind },
          ctx.embedRowText,
          ctx.targetModel,
          ctx.reEmbedAll,
        );
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

async function ingestAuditFinding(pool, ctx) {
  const ns = "audit_finding";
  const check = await pool.query(`SELECT to_regclass('solene_audit_findings') AS reg`);
  if (!check.rows[0]?.reg) {
    console.log(`[skip] ${ns}: solene_audit_findings table not present`);
    return { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: 0, missing: true };
  }
  const status = await getCorpusStatusRow(pool, ns);
  const watermark = ctx.reEmbedAll ? 0 : status?.last_ingested_source_id ?? 0;
  const counts = { inserted: 0, updated: 0, skipped: 0, failed: 0, maxId: watermark };
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
      if (ctx.dryRun) {
        console.log(`[dry] ${ns} ← ${sourceRef} (${fullText.length}c) provider=${ctx.provider}`);
        counts.inserted += 1;
      } else {
        const r = await upsertEmbeddedRow(
          pool,
          ns,
          sourceRef,
          fullText,
          { severity: row.severity, pattern: row.pattern },
          ctx.embedRowText,
          ctx.targetModel,
          ctx.reEmbedAll,
        );
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
  if (args.help) {
    printHelp();
    return;
  }

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
    console.error("ERROR: --provider=voyage requires VOYAGE_API_KEY.");
    process.exit(2);
  }
  const targetModel = provider === "voyage" ? VOYAGE_MODEL : PLACEHOLDER_MODEL;
  const apiKeyLen = process.env.VOYAGE_API_KEY?.length ?? 0;

  // Grand-totals counters shared with the per-row embedder.
  const grandTotals = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    viaVoyage: 0,
    viaPlaceholder: 0,
    voyageErrors: 0,
    voyageTokens: 0,
    voyageCostUsd: 0,
  };

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
        `dryRun=${args.dryRun} dim=${EMBEDDING_DIM} ` +
        `provider=${provider} targetModel=${targetModel} ` +
        `reEmbedAll=${args.reEmbedAll}` +
        (provider === "voyage" ? ` voyageKeyLen=${apiKeyLen}` : ""),
    );

    const embedRowText = makeRowEmbedder(provider, grandTotals);
    const ctx = {
      dryRun: args.dryRun,
      reEmbedAll: args.reEmbedAll,
      provider,
      targetModel,
      embedRowText,
    };

    for (const ns of targets) {
      const handler = HANDLERS[ns];
      const t0 = Date.now();
      const counts = await handler(pool, ctx);
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

    console.log("[ingest-decision-memory] grand totals:", {
      ...grandTotals,
      voyageCostUsd:
        Math.round(grandTotals.voyageCostUsd * 1_000_000) / 1_000_000,
    });
  } finally {
    await pool.end();
  }

  if (exitCode !== 0) process.exit(exitCode);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

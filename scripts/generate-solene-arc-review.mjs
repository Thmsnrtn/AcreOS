#!/usr/bin/env node
/**
 * SOLENE — quarterly arc-review generator.
 *
 * Creates `docs/company/role-development/arc/<YYYY>-Q<n>.md` for the
 * quarter that just ended (or current quarter if --current).
 *
 * Quarter mapping:
 *   Q1 = Jan/Feb/Mar
 *   Q2 = Apr/May/Jun
 *   Q3 = Jul/Aug/Sep
 *   Q4 = Oct/Nov/Dec
 *
 * Auto-pulled top (last 13 weeks):
 *   - solene_audit_findings aggregated by (pattern, severity)
 *   - solene_decisions count by decision_type
 *   - solene_capital_events total spend + breakdown by event_type
 *   - solene_page_events count by severity (best-effort; soft-fail)
 *
 * Solene-filled bottom (TODO markers — caught by selfAudit
 * checkReviewSkeletonStaleness when stale >7d):
 *   - Which discipline failures recurred + the root pattern
 *   - Which improvements compounded vs which decayed
 *   - What to memorialize in /memory
 *   - Tranche of self-development to ship next quarter
 *   - Founder-visible summary
 *
 * Idempotency: re-running on the same quarter is a no-op unless --force.
 *
 * Usage:
 *   node scripts/generate-solene-arc-review.mjs
 *   node scripts/generate-solene-arc-review.mjs --quarter=2026-Q2
 *   node scripts/generate-solene-arc-review.mjs --force
 *   node scripts/generate-solene-arc-review.mjs --dry-run
 *
 * Registered as a quarterly cron in server/jobs/runScheduledJobs.ts
 * (startQuarterlySoleneArcReviewJob).
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const ARC_DIR = resolve(REPO_ROOT, "docs/company/role-development/arc");
const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Quarter math
// ---------------------------------------------------------------------------

function argValue(name) {
  for (const arg of process.argv) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return null;
}

function chosenQuarter() {
  const cli = argValue("quarter");
  if (cli) {
    const m = cli.match(/^(\d{4})-Q([1-4])$/);
    if (!m) throw new Error(`Invalid --quarter "${cli}". Expected YYYY-Qn.`);
    const year = Number(m[1]);
    const q = Number(m[2]);
    return quarterRange(year, q);
  }
  // Default: the quarter we just finished. Cron runs on the 1st of
  // Jan/Apr/Jul/Oct at 09:00 UTC — at that moment the just-ended
  // quarter is (current month - 1) / 3 in 0-based math.
  const now = new Date();
  // Subtract one day to land in the prior quarter when this runs on a
  // boundary day.
  const ref = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const year = ref.getUTCFullYear();
  const q = Math.floor(ref.getUTCMonth() / 3) + 1;
  return quarterRange(year, q);
}

function quarterRange(year, q) {
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 1));
  return { label: `${year}-Q${q}`, start, end, year, q };
}

// ---------------------------------------------------------------------------
// DB pulls
// ---------------------------------------------------------------------------

async function withPool(fn) {
  if (!process.env.DATABASE_URL) return fn(null);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function findingsAggregate(pool, start, end) {
  if (!pool) {
    return { total: 0, byPattern: {}, bySeverity: {}, note: "DATABASE_URL unset" };
  }
  try {
    const { rows } = await pool.query(
      `SELECT pattern, severity, COUNT(*)::int AS n
         FROM solene_audit_findings
        WHERE fired_at >= $1 AND fired_at < $2
        GROUP BY pattern, severity
        ORDER BY pattern, severity`,
      [start.toISOString(), end.toISOString()],
    );
    const byPattern = {};
    const bySeverity = { info: 0, warn: 0, fail: 0, critical: 0 };
    let total = 0;
    for (const row of rows) {
      const n = Number(row.n);
      if (!byPattern[row.pattern]) byPattern[row.pattern] = {};
      byPattern[row.pattern][row.severity] = n;
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + n;
      total += n;
    }
    return { total, byPattern, bySeverity };
  } catch (err) {
    return {
      total: 0,
      byPattern: {},
      bySeverity: {},
      note: `query failed: ${err.message}`,
    };
  }
}

async function decisionsAggregate(pool, start, end) {
  if (!pool) return { total: 0, byType: {}, note: "DATABASE_URL unset" };
  try {
    const { rows } = await pool.query(
      `SELECT decision_type, COUNT(*)::int AS n
         FROM solene_decisions
        WHERE decided_at >= $1 AND decided_at < $2
        GROUP BY decision_type
        ORDER BY n DESC`,
      [start.toISOString(), end.toISOString()],
    );
    const byType = {};
    let total = 0;
    for (const row of rows) {
      byType[row.decision_type] = Number(row.n);
      total += Number(row.n);
    }
    return { total, byType };
  } catch (err) {
    return { total: 0, byType: {}, note: `query failed: ${err.message}` };
  }
}

async function capitalAggregate(pool, start, end) {
  if (!pool) return { totalUsd: 0, byType: {}, note: "DATABASE_URL unset" };
  try {
    const { rows } = await pool.query(
      `SELECT event_type, COALESCE(SUM(cost_usd), 0)::text AS total
         FROM solene_capital_events
        WHERE occurred_at >= $1 AND occurred_at < $2
        GROUP BY event_type
        ORDER BY total DESC`,
      [start.toISOString(), end.toISOString()],
    );
    const byType = {};
    let totalUsd = 0;
    for (const row of rows) {
      const t = Number(row.total);
      byType[row.event_type] = t;
      totalUsd += t;
    }
    return { totalUsd, byType };
  } catch (err) {
    return { totalUsd: 0, byType: {}, note: `query failed: ${err.message}` };
  }
}

async function pageEventsAggregate(pool, start, end) {
  if (!pool) return { available: false, note: "DATABASE_URL unset" };
  try {
    const { rows } = await pool.query(
      // `fired_at`, not `created_at` — solene_page_events has no created_at
      // column, so this statement threw on every run and the soft-fail below
      // recorded it as "unavailable". The page-event section of the arc review
      // has therefore always been empty, and looked exactly like a period with
      // no pages in it.
      `SELECT severity, COUNT(*)::int AS n
         FROM solene_page_events
        WHERE fired_at >= $1 AND fired_at < $2
        GROUP BY severity
        ORDER BY n DESC`,
      [start.toISOString(), end.toISOString()],
    );
    const bySeverity = {};
    let total = 0;
    for (const row of rows) {
      bySeverity[row.severity] = Number(row.n);
      total += Number(row.n);
    }
    return { available: true, total, bySeverity };
  } catch (err) {
    return {
      available: false,
      note: `query against solene_page_events failed (table may not exist yet): ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function fmtDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderArc(input) {
  const {
    label,
    start,
    end,
    generatedAt,
    findings,
    decisions,
    capital,
    pageEvents,
  } = input;

  const lines = [];
  lines.push("---");
  lines.push(`subject: solene`);
  lines.push(`quarter: ${label}`);
  lines.push(`period_start: ${fmtDate(start)}`);
  lines.push(`period_end: ${fmtDate(end)}`);
  lines.push(`generated_at: ${fmtDate(generatedAt)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Solene — quarterly arc review ${label}`);
  lines.push("");
  lines.push(
    `_Window: ${fmtDate(start)} → ${fmtDate(end)} (~13 weeks)_`,
  );
  lines.push("");

  // ── Auto-pulled ──────────────────────────────────────────────────────────
  lines.push("## Auto-pulled (13-week aggregates)");
  lines.push("");

  // Findings
  lines.push("### Self-audit findings");
  lines.push("");
  if (findings.note) {
    lines.push(`_${findings.note}_`);
  } else if (findings.total === 0) {
    lines.push("_No findings in window — clean quarter._");
  } else {
    lines.push(`Total findings: **${findings.total}**`);
    lines.push("");
    lines.push("Severity:");
    lines.push(`- critical: ${findings.bySeverity.critical ?? 0}`);
    lines.push(`- fail: ${findings.bySeverity.fail ?? 0}`);
    lines.push(`- warn: ${findings.bySeverity.warn ?? 0}`);
    lines.push(`- info: ${findings.bySeverity.info ?? 0}`);
    lines.push("");
    lines.push("By detector pattern:");
    for (const [pattern, sevs] of Object.entries(findings.byPattern)) {
      const parts = Object.entries(sevs).map(([s, n]) => `${s}:${n}`);
      lines.push(`- \`${pattern}\` — ${parts.join(", ")}`);
    }
  }
  lines.push("");

  // Decisions
  lines.push("### Decisions logged");
  lines.push("");
  if (decisions.note) {
    lines.push(`_${decisions.note}_`);
  } else if (decisions.total === 0) {
    lines.push("_No decisions logged in window._");
  } else {
    lines.push(`Total: **${decisions.total}**`);
    for (const [type, n] of Object.entries(decisions.byType)) {
      lines.push(`- ${type}: ${n}`);
    }
  }
  lines.push("");

  // Capital
  lines.push("### Capital spent");
  lines.push("");
  if (capital.note && capital.totalUsd === 0) {
    lines.push(`_${capital.note}_`);
  } else {
    lines.push(`Total: **$${capital.totalUsd.toFixed(2)}**`);
    for (const [type, total] of Object.entries(capital.byType)) {
      lines.push(`- ${type}: $${total.toFixed(2)}`);
    }
  }
  lines.push("");

  // Page events
  lines.push("### Pages emitted (proactive channel)");
  lines.push("");
  if (!pageEvents.available) {
    lines.push(`_${pageEvents.note ?? "no page-event surface available"}_`);
  } else if (pageEvents.total === 0) {
    lines.push("_No pages emitted in window._");
  } else {
    lines.push(`Total: **${pageEvents.total}**`);
    for (const [sev, n] of Object.entries(pageEvents.bySeverity)) {
      lines.push(`- ${sev}: ${n}`);
    }
  }
  lines.push("");

  // ── Solene-filled ────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Solene-filled (hand-edited)");
  lines.push("");
  lines.push("> All sections below carry `TODO(solene):` markers. They MUST be");
  lines.push("> filled within 7 days of generation, or the");
  lines.push("> `checkReviewSkeletonStaleness` detector in");
  lines.push("> `server/services/solene/selfAudit.ts` will fire a `warn`.");
  lines.push("");

  lines.push("### Which discipline failures recurred + the root pattern");
  lines.push("");
  lines.push("TODO(solene): look at the audit-findings breakdown above. Which detector fired repeatedly across multiple weeks? What's the *root* discipline gap that produced that pattern? (Not the symptom — the upstream habit.)");
  lines.push("");

  lines.push("### Which improvements compounded vs which decayed");
  lines.push("");
  lines.push("TODO(solene): for each tranche of self-development shipped last quarter, did it stick (compounded) or fade (decayed)? Compounding = the discipline produces ongoing signal/savings/protection without ongoing attention. Decayed = the artifact still exists but is no longer being used or maintained.");
  lines.push("");

  lines.push("### What to memorialize in /memory");
  lines.push("");
  lines.push("TODO(solene): which patterns from this quarter need to land in `/Users/user/.claude/projects/-Users-user-AcreOS-AcreOS/memory/` as new `feedback_*` files? List the proposed filenames + one-sentence summaries.");
  lines.push("");

  lines.push("### Tranche of self-development to ship next quarter");
  lines.push("");
  lines.push("TODO(solene): name 2-4 concrete deliverables for the next 13 weeks. Each one closes a remaining gap in `docs/company/role-development/elite-bars/solene.md`. Format per deliverable: \"Ship <artifact> at <path> by <month>; closes <gap>.\"");
  lines.push("");

  lines.push("### Founder-visible summary");
  lines.push("");
  lines.push("TODO(solene): one paragraph for Tom. Plain, mechanics-first, no spin. What the COO role looked like this quarter, where it got better, where it slipped, what's coming.");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("_Auto-generated by `scripts/generate-solene-arc-review.mjs` (cron-supervised in `server/jobs/runScheduledJobs.ts → startQuarterlySoleneArcReviewJob`)._");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const quarter = chosenQuarter();
  const targetPath = resolve(ARC_DIR, `${quarter.label}.md`);
  if (existsSync(targetPath) && !FORCE && !DRY_RUN) {
    console.log(
      `[generate-solene-arc-review] ${targetPath} exists — skipping (use --force to overwrite)`,
    );
    return;
  }

  const { findings, decisions, capital, pageEvents } = await withPool(
    async (pool) => {
      const [f, d, c, p] = await Promise.all([
        findingsAggregate(pool, quarter.start, quarter.end),
        decisionsAggregate(pool, quarter.start, quarter.end),
        capitalAggregate(pool, quarter.start, quarter.end),
        pageEventsAggregate(pool, quarter.start, quarter.end),
      ]);
      return { findings: f, decisions: d, capital: c, pageEvents: p };
    },
  );

  const md = renderArc({
    label: quarter.label,
    start: quarter.start,
    end: quarter.end,
    generatedAt: new Date(),
    findings,
    decisions,
    capital,
    pageEvents,
  });

  if (DRY_RUN) {
    process.stdout.write(md);
    return;
  }

  mkdirSync(ARC_DIR, { recursive: true });
  writeFileSync(targetPath, md, "utf8");
  console.log(
    `[generate-solene-arc-review] wrote ${targetPath} (findings=${findings.total} decisions=${decisions.total} capital=$${capital.totalUsd.toFixed(2)})`,
  );
}

main().catch((err) => {
  console.error("[generate-solene-arc-review] failed:", err);
  process.exit(1);
});

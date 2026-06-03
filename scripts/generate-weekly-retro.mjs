#!/usr/bin/env node
/**
 * SOLENE — weekly retrospective generator.
 *
 * Creates `docs/company/retros/<YYYY-Www>.md` for the ISO week that just
 * ended (week boundary = Monday 00:00 UTC; this script is registered as
 * a Sunday-23:00-UTC cron). The auto-pulled sections are populated with:
 *
 *   - What landed this week (git log filtered by agent identity + subject)
 *   - Tasks completed (placeholder — TaskList state changes aren't logged
 *     server-side yet; field stays "(N tasks completed)" with a 0 when no
 *     ledger exists, ready to be wired up when TaskList telemetry ships)
 *   - Dispatches Solene made (count from solene_decisions table)
 *   - Self-audit findings (count by severity from solene_audit_findings)
 *   - Capital spent (totalUsd from getSpendSummary-equivalent over 7d)
 *
 * Manual sections are left as empty prompts for Solene's edit pass:
 *   - Solene's notes — what surprised her, patterns, what she'd do differently
 *   - Founder-visible summary — one paragraph for Tom
 *
 * Idempotency: re-running on the same week is a no-op (the file is only
 * written when it doesn't already exist). Pass --force to overwrite.
 *
 * Usage:
 *   node scripts/generate-weekly-retro.mjs
 *   node scripts/generate-weekly-retro.mjs --week=2026-W23
 *   node scripts/generate-weekly-retro.mjs --force        # overwrite existing
 *   node scripts/generate-weekly-retro.mjs --dry-run      # print, don't write
 *
 * Registered as a weekly cron in server/jobs/runScheduledJobs.ts
 * (startSoleneWeeklyRetroJob).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const RETROS_DIR = resolve(REPO_ROOT, "docs/company/retros");
const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");

const AGENT_PREFIXES = [
  { agent: "Iris", prefixes: ["iris:", "reg z", "phase 0", "chat ", "chat-", "atlas"] },
  { agent: "Soren", prefixes: ["soren:", "seo", "tools", "content "] },
  { agent: "Beatrice", prefixes: ["beatrice:"] },
  { agent: "Krieger", prefixes: ["krieger:"] },
  { agent: "Solene", prefixes: ["solene:"] },
];

function identifyAgent(subject) {
  const s = subject.toLowerCase();
  for (const { agent, prefixes } of AGENT_PREFIXES) {
    for (const p of prefixes) {
      if (s.startsWith(p)) return agent;
    }
  }
  return "unattributed";
}

// ---------------------------------------------------------------------------
// ISO week math
// ---------------------------------------------------------------------------

/**
 * Return the ISO week label (YYYY-Www) + the [start, end) UTC instant pair
 * for the ISO week that contains `referenceDate`. ISO week starts Monday.
 */
function isoWeekRange(referenceDate) {
  // Find the Monday of the ISO week.
  const d = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ));
  const dayOfWeek = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1...Sun=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dayOfWeek - 1));
  monday.setUTCHours(0, 0, 0, 0);
  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);

  // ISO week number (Thursday rule)
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const label = `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;

  return { label, start: monday, end: nextMonday };
}

/** Parse --week=YYYY-Www arg if present. */
function explicitWeekArg() {
  for (const arg of process.argv) {
    if (arg.startsWith("--week=")) {
      const v = arg.slice("--week=".length);
      const m = v.match(/^(\d{4})-W(\d{2})$/);
      if (!m) {
        throw new Error(`Invalid --week format: ${v}. Expected YYYY-Www.`);
      }
      const year = Number(m[1]);
      const week = Number(m[2]);
      // Find the Thursday of the ISO week (defines the year).
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const jan4DoW = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() - (jan4DoW - 1));
      const monday = new Date(week1Monday);
      monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
      const noon = new Date(monday);
      noon.setUTCHours(12, 0, 0, 0);
      return isoWeekRange(noon);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Git pulls
// ---------------------------------------------------------------------------

function gitOk(args) {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" });
  } catch {
    return "";
  }
}

/**
 * Commits in [start, end), parsed and grouped by agent identity.
 * @returns {{ byAgent: Record<string, Array<{sha:string, subject:string, ts:Date}>>, total: number }}
 */
function commitsForWindow(start, end) {
  const sinceIso = start.toISOString();
  const untilIso = end.toISOString();
  const raw = gitOk(`log --since="${sinceIso}" --until="${untilIso}" --pretty=format:%H%x09%ct%x09%s`);
  const byAgent = {};
  let total = 0;
  if (!raw.trim()) return { byAgent, total };
  for (const line of raw.split("\n")) {
    const [sha, ts, ...rest] = line.split("\t");
    if (!sha) continue;
    const subject = rest.join("\t");
    const agent = identifyAgent(subject);
    const entry = {
      sha: sha.slice(0, 8),
      subject,
      ts: new Date(Number(ts) * 1000),
    };
    if (!byAgent[agent]) byAgent[agent] = [];
    byAgent[agent].push(entry);
    total += 1;
  }
  return { byAgent, total };
}

// ---------------------------------------------------------------------------
// DB pulls — Solene decisions / audit findings / capital spend
// ---------------------------------------------------------------------------

async function withPool(fn) {
  if (!process.env.DATABASE_URL) {
    return fn(null);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Count dispatches Solene made in the window. */
async function dispatchSummary(pool, start, end) {
  if (!pool) return { total: 0, byType: {}, note: "DATABASE_URL unset — count unavailable" };
  try {
    const { rows } = await pool.query(
      `SELECT decision_type, COUNT(*)::int AS n
         FROM solene_decisions
        WHERE decided_at >= $1 AND decided_at < $2
        GROUP BY decision_type`,
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

async function auditFindingSummary(pool, start, end) {
  if (!pool) return { total: 0, bySeverity: {}, note: "DATABASE_URL unset — count unavailable" };
  try {
    const { rows } = await pool.query(
      `SELECT severity, COUNT(*)::int AS n
         FROM solene_audit_findings
        WHERE fired_at >= $1 AND fired_at < $2
        GROUP BY severity`,
      [start.toISOString(), end.toISOString()],
    );
    const bySeverity = { info: 0, warn: 0, fail: 0, critical: 0 };
    let total = 0;
    for (const row of rows) {
      bySeverity[row.severity] = Number(row.n);
      total += Number(row.n);
    }
    return { total, bySeverity };
  } catch (err) {
    return { total: 0, bySeverity: {}, note: `query failed: ${err.message}` };
  }
}

async function capitalSummary(pool, start, end) {
  if (!pool) return { totalUsd: 0, byType: {}, note: "DATABASE_URL unset — total unavailable" };
  try {
    const { rows } = await pool.query(
      `SELECT event_type, COALESCE(SUM(cost_usd), 0) AS total
         FROM solene_capital_events
        WHERE occurred_at >= $1 AND occurred_at < $2
        GROUP BY event_type`,
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

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function fmtDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderRetro({ weekLabel, start, end, commits, dispatches, findings, capital }) {
  const lines = [];
  lines.push(`# Weekly retro — ${weekLabel}`);
  lines.push("");
  lines.push(`_Window: ${fmtDate(start)} → ${fmtDate(end)} (UTC, Monday 00:00 → next Monday 00:00)_`);
  lines.push("");

  // What landed
  lines.push("## What landed this week");
  lines.push("");
  if (commits.total === 0) {
    lines.push("_No commits in this window._");
  } else {
    lines.push(`Total commits: **${commits.total}**`);
    lines.push("");
    for (const agent of ["Iris", "Soren", "Beatrice", "Krieger", "Solene", "unattributed"]) {
      const entries = commits.byAgent[agent];
      if (!entries || entries.length === 0) continue;
      lines.push(`### ${agent} (${entries.length})`);
      lines.push("");
      for (const e of entries) {
        lines.push(`- \`${e.sha}\` ${e.subject}`);
      }
      lines.push("");
    }
  }

  // Tasks completed
  lines.push("## Tasks completed this week");
  lines.push("");
  lines.push("- _(TaskList telemetry not yet wired server-side — placeholder until a tasks_changelog table or similar exists)_");
  lines.push("");

  // Dispatches
  lines.push("## Dispatches Solene made this week");
  lines.push("");
  if (dispatches.total === 0) {
    if (dispatches.note) {
      lines.push(`_${dispatches.note}_`);
    } else {
      lines.push("_No dispatches recorded in solene_decisions for this window._");
    }
  } else {
    lines.push(`Total: **${dispatches.total}**`);
    for (const [type, n] of Object.entries(dispatches.byType)) {
      lines.push(`- ${type}: ${n}`);
    }
  }
  lines.push("");

  // Self-audit
  lines.push("## Self-audit findings this week");
  lines.push("");
  if (findings.total === 0) {
    if (findings.note) {
      lines.push(`_${findings.note}_`);
    } else {
      lines.push("_No audit findings in this window — clean week._");
    }
  } else {
    lines.push(`Total findings: **${findings.total}**`);
    const sev = findings.bySeverity;
    lines.push(`- critical: ${sev.critical ?? 0}`);
    lines.push(`- fail: ${sev.fail ?? 0}`);
    lines.push(`- warn: ${sev.warn ?? 0}`);
    lines.push(`- info: ${sev.info ?? 0}`);
  }
  lines.push("");

  // Capital
  lines.push("## Capital spent this week");
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

  // Manual sections
  lines.push("---");
  lines.push("");
  lines.push("## Solene's notes");
  lines.push("");
  lines.push("_What surprised me, what patterns I noticed, what I'd do differently. Hand-edited during end-of-week digest._");
  lines.push("");
  lines.push("- ");
  lines.push("");
  lines.push("## Founder-visible summary");
  lines.push("");
  lines.push("_One paragraph for Tom. Plain. Mechanics-first. No spin._");
  lines.push("");
  lines.push("> ");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_Auto-generated by `scripts/generate-weekly-retro.mjs` (cron-supervised in `server/jobs/runScheduledJobs.ts → startSoleneWeeklyRetroJob`). The Solene's-notes + Founder-visible-summary sections are hand-edited._");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Default: the week that just ended. Cron runs Sunday 23:00 UTC; "the
  // week that just ended" is the ISO week containing today (Sunday is the
  // last day of the ISO week). Use reference = now minus a few hours so we
  // anchor inside that week even if cron skews into the next minute.
  const fallbackRef = new Date(Date.now() - 60 * 60 * 1000);
  const range = explicitWeekArg() ?? isoWeekRange(fallbackRef);

  const targetPath = resolve(RETROS_DIR, `${range.label}.md`);
  if (existsSync(targetPath) && !FORCE && !DRY_RUN) {
    console.log(`[generate-weekly-retro] ${targetPath} exists — skipping (use --force to overwrite)`);
    return;
  }

  const commits = commitsForWindow(range.start, range.end);

  const { dispatches, findings, capital } = await withPool(async (pool) => {
    const [d, f, c] = await Promise.all([
      dispatchSummary(pool, range.start, range.end),
      auditFindingSummary(pool, range.start, range.end),
      capitalSummary(pool, range.start, range.end),
    ]);
    return { dispatches: d, findings: f, capital: c };
  });

  const md = renderRetro({
    weekLabel: range.label,
    start: range.start,
    end: range.end,
    commits,
    dispatches,
    findings,
    capital,
  });

  if (DRY_RUN) {
    process.stdout.write(md);
    return;
  }

  mkdirSync(RETROS_DIR, { recursive: true });
  writeFileSync(targetPath, md, "utf8");
  console.log(
    `[generate-weekly-retro] wrote ${targetPath} (commits=${commits.total} dispatches=${dispatches.total} findings=${findings.total} capital=$${capital.totalUsd.toFixed(2)})`,
  );
}

main().catch((err) => {
  console.error("[generate-weekly-retro] failed:", err);
  process.exit(1);
});

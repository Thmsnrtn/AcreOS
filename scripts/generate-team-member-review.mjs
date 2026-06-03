#!/usr/bin/env node
/**
 * SOLENE — monthly team-member review generator.
 *
 * Creates `docs/company/role-development/reviews/<YYYY-MM>-<member>.md`
 * for the current month. Member is selected by rotation: month % 4 →
 * 0=Iris, 1=Soren, 2=Beatrice, 3=Krieger. Override via the
 * TEAM_MEMBER_REVIEW_OVERRIDE env (for ad-hoc reviews) or --member CLI.
 *
 * Auto-pulled top:
 *   - Commits authored by the member in the trailing 30 days
 *     (heuristic on commit-message prefixes, same shape as
 *     scripts/generate-weekly-retro.mjs).
 *   - Solene dispatches in solene_decisions whose rationale mentions
 *     the member's name (last 30 days).
 *   - Audit findings tagged to the member's surface where the surface
 *     exists (best-effort; Beatrice → pax_audit_findings; Iris →
 *     iris_perf_findings).
 *   - Capital impact attributable to the member's dispatches
 *     (rationale-text match against the member name).
 *   - Current elite-bar snapshot (verbatim copy of the
 *     docs/company/role-development/elite-bars/<member>.md content).
 *   - Since-last-review entry (the most recent block of the
 *     docs/company/role-development/evolution/<member>.md ledger).
 *
 * Solene-filled bottom (left as TODO markers — these are flagged stale
 * by the selfAudit.checkReviewSkeletonStaleness detector if untouched
 * for >7 days):
 *   - What's working — observed strengths this period
 *   - What's regressing — observed drift or weakening
 *   - Next-priority gap to close
 *   - Tranche-N deliverable to dispatch this month
 *   - Elite-bar movement — what level closed, what's next
 *   - Founder-visible summary (one paragraph for Tom)
 *
 * Idempotency: re-running on the same (month, member) is a no-op
 * unless --force.
 *
 * Usage:
 *   node scripts/generate-team-member-review.mjs
 *   node scripts/generate-team-member-review.mjs --member=iris
 *   node scripts/generate-team-member-review.mjs --month=2026-06
 *   node scripts/generate-team-member-review.mjs --force
 *   node scripts/generate-team-member-review.mjs --dry-run
 *   TEAM_MEMBER_REVIEW_OVERRIDE=beatrice node scripts/generate-team-member-review.mjs
 *
 * Registered as a monthly cron in server/jobs/runScheduledJobs.ts
 * (startMonthlyTeamMemberReviewJob).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const REVIEWS_DIR = resolve(REPO_ROOT, "docs/company/role-development/reviews");
const ELITE_BARS_DIR = resolve(REPO_ROOT, "docs/company/role-development/elite-bars");
const EVOLUTION_DIR = resolve(REPO_ROOT, "docs/company/role-development/evolution");
const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");

const ROTATION = ["iris", "soren", "beatrice", "krieger"];

const AGENT_PREFIXES = {
  iris: ["iris:", "reg z", "phase 0", "chat ", "chat-", "atlas"],
  soren: ["soren:", "seo", "tools", "content "],
  beatrice: ["beatrice:"],
  krieger: ["krieger:"],
};

const MEMBER_DISPLAY = {
  iris: "Iris (CTO)",
  soren: "Soren (CGO)",
  beatrice: "Beatrice (CRO)",
  krieger: "Krieger (Mobile-feel)",
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function argValue(name) {
  for (const arg of process.argv) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  return null;
}

function chosenMember(targetMonth) {
  const cli = argValue("member");
  const envOverride = process.env.TEAM_MEMBER_REVIEW_OVERRIDE;
  const choice = (cli ?? envOverride ?? "").toLowerCase().trim();
  if (choice) {
    if (!ROTATION.includes(choice)) {
      throw new Error(
        `Unknown member "${choice}". Valid: ${ROTATION.join(", ")}.`,
      );
    }
    return choice;
  }
  // Rotation by month-of-year. JS getUTCMonth() is 0-based, which is what
  // we want (January → index 0 → Iris, etc.).
  const idx = targetMonth.getUTCMonth() % ROTATION.length;
  return ROTATION[idx];
}

function chosenMonth() {
  const cli = argValue("month");
  if (cli) {
    const m = cli.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error(`Invalid --month format "${cli}". Expected YYYY-MM.`);
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function monthLabel(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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

function commitsForMember(member, start, end) {
  const sinceIso = start.toISOString();
  const untilIso = end.toISOString();
  const raw = gitOk(
    `log --since="${sinceIso}" --until="${untilIso}" --pretty=format:%H%x09%ct%x09%s`,
  );
  if (!raw.trim()) return [];
  const prefixes = AGENT_PREFIXES[member] ?? [];
  const out = [];
  for (const line of raw.split("\n")) {
    const [sha, ts, ...rest] = line.split("\t");
    if (!sha) continue;
    const subject = rest.join("\t");
    const lower = subject.toLowerCase();
    if (!prefixes.some((p) => lower.startsWith(p))) continue;
    out.push({
      sha: sha.slice(0, 8),
      subject,
      ts: new Date(Number(ts) * 1000),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB pulls — Solene dispatches + audit findings + capital
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

async function dispatchesForMember(pool, member, start, end) {
  if (!pool) {
    return { total: 0, byType: {}, capitalUsd: 0, note: "DATABASE_URL unset" };
  }
  try {
    const namePattern = `%${member}%`;
    const { rows } = await pool.query(
      `SELECT decision_type,
              COUNT(*)::int                                    AS n,
              COALESCE(SUM(capital_impact_usd::numeric), 0)::text AS capital
         FROM solene_decisions
        WHERE decided_at >= $1 AND decided_at < $2
          AND rationale ILIKE $3
        GROUP BY decision_type`,
      [start.toISOString(), end.toISOString(), namePattern],
    );
    const byType = {};
    let total = 0;
    let capitalUsd = 0;
    for (const row of rows) {
      byType[row.decision_type] = Number(row.n);
      total += Number(row.n);
      capitalUsd += Number(row.capital ?? 0);
    }
    return { total, byType, capitalUsd };
  } catch (err) {
    return {
      total: 0,
      byType: {},
      capitalUsd: 0,
      note: `query failed: ${err.message}`,
    };
  }
}

async function memberAuditFindings(pool, member, start, end) {
  if (!pool) return { available: false, note: "DATABASE_URL unset" };
  // Surface-specific best-effort. Tables may not exist on this DB
  // depending on tranche-1 progress; gracefully degrade.
  const tableForMember = {
    beatrice: "pax_audit_findings",
    iris: "iris_perf_findings",
  };
  const table = tableForMember[member];
  if (!table) return { available: false, note: "no surface mapped" };
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM ${table}
        WHERE fired_at >= $1 AND fired_at < $2`,
      [start.toISOString(), end.toISOString()],
    );
    return { available: true, total: Number(rows[0]?.n ?? 0), table };
  } catch (err) {
    return {
      available: false,
      note: `query against ${table} failed (table may not exist yet): ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// File pulls — elite-bar snapshot + most-recent evolution entry
// ---------------------------------------------------------------------------

function readEliteBar(member) {
  const path = resolve(ELITE_BARS_DIR, `${member}.md`);
  if (!existsSync(path)) {
    return `_(No elite-bar tracker yet at ${path}. Seed it before the next review.)_`;
  }
  return readFileSync(path, "utf8").trim();
}

function readLastEvolutionEntry(member) {
  const path = resolve(EVOLUTION_DIR, `${member}.md`);
  if (!existsSync(path)) {
    return `_(No evolution log yet at ${path}. Seed it before the next review.)_`;
  }
  const body = readFileSync(path, "utf8");
  // Most-recent entry = first "## " heading block after the file title.
  const lines = body.split("\n");
  let started = false;
  const collected = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (!started) {
        started = true;
        collected.push(line);
        continue;
      }
      // hit the next entry — stop.
      break;
    }
    if (started) collected.push(line);
  }
  return collected.join("\n").trim() || "_(Log present but no dated entries yet.)_";
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function fmtDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderReview(input) {
  const {
    member,
    monthStr,
    periodStart,
    periodEnd,
    generatedAt,
    commits,
    dispatches,
    findings,
    eliteBar,
    lastEvolution,
  } = input;

  const lines = [];
  lines.push("---");
  lines.push(`member: ${member}`);
  lines.push(`period_start: ${fmtDate(periodStart)}`);
  lines.push(`period_end: ${fmtDate(periodEnd)}`);
  lines.push(`generated_at: ${fmtDate(generatedAt)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${MEMBER_DISPLAY[member] ?? member} — monthly review ${monthStr}`);
  lines.push("");
  lines.push(
    `_Window: ${fmtDate(periodStart)} → ${fmtDate(periodEnd)} (30 days)_`,
  );
  lines.push("");

  // ── Auto-pulled ──────────────────────────────────────────────────────────
  lines.push("## Auto-pulled (last 30 days)");
  lines.push("");

  lines.push("### Commits authored");
  lines.push("");
  if (commits.length === 0) {
    lines.push("_No commits matched this member's prefix heuristics in window._");
  } else {
    lines.push(`Total: **${commits.length}**`);
    lines.push("");
    for (const c of commits) {
      lines.push(`- \`${c.sha}\` ${c.subject}`);
    }
  }
  lines.push("");

  lines.push("### Solene dispatches involving this member");
  lines.push("");
  if (dispatches.note) {
    lines.push(`_${dispatches.note}_`);
  } else if (dispatches.total === 0) {
    lines.push("_No dispatches with this member's name in rationale this window._");
  } else {
    lines.push(`Total: **${dispatches.total}**`);
    for (const [type, n] of Object.entries(dispatches.byType)) {
      lines.push(`- ${type}: ${n}`);
    }
  }
  lines.push("");

  lines.push("### Capital impact attributable");
  lines.push("");
  if (dispatches.note) {
    lines.push(`_${dispatches.note}_`);
  } else {
    lines.push(`Total: **$${dispatches.capitalUsd.toFixed(2)}**`);
  }
  lines.push("");

  lines.push("### Audit findings on this member's surface");
  lines.push("");
  if (!findings.available) {
    lines.push(`_${findings.note ?? "no surface available"}_`);
  } else {
    lines.push(`Source table: \`${findings.table}\` — total: **${findings.total}**`);
  }
  lines.push("");

  lines.push("### Current elite bar (snapshot)");
  lines.push("");
  lines.push("<details><summary>Verbatim copy of `elite-bars/" + member + ".md` at generation time</summary>");
  lines.push("");
  lines.push(eliteBar);
  lines.push("");
  lines.push("</details>");
  lines.push("");

  lines.push("### Since the last review");
  lines.push("");
  lines.push(lastEvolution);
  lines.push("");

  // ── Solene-filled ────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Solene-filled (hand-edited)");
  lines.push("");
  lines.push("> All sections below carry `TODO(solene):` markers. They MUST be");
  lines.push("> filled within 7 days of generation, or the");
  lines.push("> `checkReviewSkeletonStaleness` detector in");
  lines.push("> `server/services/solene/selfAudit.ts` will fire a `warn` finding.");
  lines.push("");

  lines.push("### What's working — observed strengths this period");
  lines.push("");
  lines.push("TODO(solene): name the 2-3 things this member shipped or sustained at the elite bar this period. Be specific — file:line, commit SHA, or named discipline kept consistently.");
  lines.push("");

  lines.push("### What's regressing — observed drift or weakening");
  lines.push("");
  lines.push("TODO(solene): name the drift signals (audit findings, missed checklists, blind spots that showed up). Empty = a clean month, but write \"clean — no drift observed\" rather than leaving blank.");
  lines.push("");

  lines.push("### Next-priority gap to close");
  lines.push("");
  lines.push("TODO(solene): pick the single highest-leverage gap from the member's elite-bar tracker's \"Remaining gaps\" section. One gap, not three.");
  lines.push("");

  lines.push("### Tranche-N deliverable to dispatch this month");
  lines.push("");
  lines.push("TODO(solene): the concrete deliverable that closes the gap above. Format: \"Dispatch <agent> to ship <artifact> at <path> by <date>.\"");
  lines.push("");

  lines.push("### Elite-bar movement");
  lines.push("");
  lines.push("TODO(solene): what bar closed this month (move it from \"Remaining gaps\" to \"Closed this period\" in `elite-bars/" + member + ".md`); what is the next bar this month's tranche-N targets.");
  lines.push("");

  lines.push("### Founder-visible summary");
  lines.push("");
  lines.push("TODO(solene): one paragraph for Tom. Plain, mechanics-first, no spin. What this member did this month, what they're doing next, where Tom should pay attention.");
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("_Auto-generated by `scripts/generate-team-member-review.mjs` (cron-supervised in `server/jobs/runScheduledJobs.ts → startMonthlyTeamMemberReviewJob`)._");
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const monthDate = chosenMonth();
  const member = chosenMember(monthDate);
  const monthStr = monthLabel(monthDate);

  // Window = last 30 days ending at monthDate start (which is the 1st-of-
  // month 00:00 UTC). On the 1st-of-month cron run, that's the prior
  // month. Slightly fuzzy on month length but predictable + auditable.
  const periodEnd = monthDate;
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const targetPath = resolve(REVIEWS_DIR, `${monthStr}-${member}.md`);
  if (existsSync(targetPath) && !FORCE && !DRY_RUN) {
    console.log(
      `[generate-team-member-review] ${targetPath} exists — skipping (use --force to overwrite)`,
    );
    return;
  }

  const commits = commitsForMember(member, periodStart, periodEnd);
  const { dispatches, findings } = await withPool(async (pool) => {
    const [d, f] = await Promise.all([
      dispatchesForMember(pool, member, periodStart, periodEnd),
      memberAuditFindings(pool, member, periodStart, periodEnd),
    ]);
    return { dispatches: d, findings: f };
  });

  const eliteBar = readEliteBar(member);
  const lastEvolution = readLastEvolutionEntry(member);

  const md = renderReview({
    member,
    monthStr,
    periodStart,
    periodEnd,
    generatedAt: new Date(),
    commits,
    dispatches,
    findings,
    eliteBar,
    lastEvolution,
  });

  if (DRY_RUN) {
    process.stdout.write(md);
    return;
  }

  mkdirSync(REVIEWS_DIR, { recursive: true });
  writeFileSync(targetPath, md, "utf8");
  console.log(
    `[generate-team-member-review] wrote ${targetPath} (member=${member} commits=${commits.length} dispatches=${dispatches.total ?? 0} capital=$${(dispatches.capitalUsd ?? 0).toFixed(2)})`,
  );
}

main().catch((err) => {
  console.error("[generate-team-member-review] failed:", err);
  process.exit(1);
});

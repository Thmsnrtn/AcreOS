#!/usr/bin/env node
/**
 * SOLENE — team-state map regenerator.
 *
 * Writes the AUTO-GENERATED section of docs/internal/solene-team-state.md so
 * Solene can load a fresh picture of "who is working on what right now" on
 * every session start (per the session-start protocol in team_solene.md).
 *
 * The bottom of the file is Solene-maintained (queued next, blocked pending
 * founder, awaiting agent report). This script PRESERVES anything between
 * the `<!-- AUTO -->` ... `<!-- /AUTO -->` markers (regenerates it) and
 * leaves the rest untouched.
 *
 * Heuristics for "agent identity" — git commit message prefixes that the
 * team uses by convention:
 *   - "iris:"           → Iris (CTO)
 *   - "reg z"           → Iris (CTO sub-stream)
 *   - "phase 0"         → Iris (hardening sub-stream)
 *   - "krieger:"        → Krieger (mobile/UX swat)
 *   - "soren:" / "seo"  → Soren (CGO)
 *   - "beatrice:"       → Beatrice (CRO)
 *   - "solene:"         → Solene (COO)
 *   - "chat"            → Iris (chat-infra sub-stream)
 *   - "atlas"           → Iris (atlas sub-stream)
 *   - "tools"           → Soren (acquisition tools)
 *   - default           → unattributed
 *
 * Cron-friendly: no external deps beyond node + git. Exit non-zero only on
 * genuine errors (file write fail, git absent); soft-fail on the prod
 * health check so a transient outage never breaks the regeneration.
 *
 * Usage:
 *   node scripts/regenerate-team-state.mjs
 *   node scripts/regenerate-team-state.mjs --dry-run    # print, don't write
 *
 * Registered as a 15-minute cron in server/jobs/runScheduledJobs.ts
 * (startSoleneTeamStateRegeneratorJob).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TARGET_PATH = resolve(REPO_ROOT, "docs/internal/solene-team-state.md");
const AUTO_BEGIN = "<!-- AUTO -->";
const AUTO_END = "<!-- /AUTO -->";
const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Agent identity heuristics
// ---------------------------------------------------------------------------

const AGENTS = ["Iris", "Soren", "Beatrice", "Krieger", "Solene"];

/**
 * @param {string} subject commit message subject line
 * @returns {string} agent identity or "unattributed"
 */
function identifyAgent(subject) {
  const s = subject.toLowerCase();
  if (s.startsWith("solene:")) return "Solene";
  if (s.startsWith("beatrice:")) return "Beatrice";
  if (s.startsWith("krieger:")) return "Krieger";
  if (s.startsWith("soren:")) return "Soren";
  if (s.startsWith("iris:")) return "Iris";
  if (s.startsWith("reg z")) return "Iris";
  if (s.startsWith("phase 0")) return "Iris";
  if (s.startsWith("chat ")) return "Iris";
  if (s.startsWith("chat-")) return "Iris";
  if (s.startsWith("atlas")) return "Iris";
  if (s.startsWith("seo")) return "Soren";
  if (s.startsWith("tools")) return "Soren";
  if (s.startsWith("content ")) return "Soren";
  return "unattributed";
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: "utf8" });
  } catch (err) {
    return "";
  }
}

/** Working-tree modified file set (staged + unstaged + untracked). */
function workingTreeFiles() {
  const out = git("status --porcelain=v1");
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Two-char status flag + space + path. Rename lines look like
      // "R  old -> new"; take the new path.
      const path = line.slice(3);
      if (path.includes(" -> ")) {
        return path.split(" -> ")[1].trim();
      }
      return path.trim();
    });
}

/**
 * Commits from the trailing 30 minutes, parsed into {sha, ts, subject, agent}.
 * Used to derive "active agents currently writing to the working tree" — an
 * agent who pushed a commit in the last 30 minutes is considered in-flight.
 */
function recentCommits(sinceMinutes) {
  const out = git(`log --since="${sinceMinutes} minutes ago" --pretty=format:%H%x09%ct%x09%s`);
  if (!out.trim()) return [];
  return out
    .split("\n")
    .map((line) => {
      const [sha, ts, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      return {
        sha: sha.slice(0, 8),
        timestamp: new Date(Number(ts) * 1000),
        subject,
        agent: identifyAgent(subject),
      };
    });
}

/**
 * Last commit per agent identity over the trailing 30 days. Returns a map
 * keyed by agent name. Agents without a recent commit map to null.
 */
function lastCommitByAgent() {
  const out = git(`log --since="30 days ago" --pretty=format:%H%x09%ct%x09%s`);
  /** @type {Record<string, {sha: string, timestamp: Date, subject: string} | null>} */
  const map = Object.fromEntries(AGENTS.map((a) => [a, null]));
  if (!out.trim()) return map;
  for (const line of out.split("\n")) {
    const [sha, ts, ...rest] = line.split("\t");
    const subject = rest.join("\t");
    const agent = identifyAgent(subject);
    if (agent === "unattributed") continue;
    if (map[agent] !== null) continue; // already have the most recent
    map[agent] = {
      sha: sha.slice(0, 8),
      timestamp: new Date(Number(ts) * 1000),
      subject,
    };
  }
  return map;
}

/**
 * Build a file-surface map keyed by agent. Today: the working tree is
 * authored by Solene/orchestrator (no per-author working-tree attribution
 * exists). The honest derivation: list working-tree files under "uncommitted"
 * + cite the last in-flight agent (most recent commit in the 30m window) as
 * the most-likely current author. When the tree is clean, the map is empty.
 */
function fileSurfaceMap(workingFiles, inFlight) {
  if (workingFiles.length === 0) return {};
  // Most recent in-flight agent (or "unattributed") gets attribution for the
  // current working tree.
  const attributedAgent = inFlight.length > 0 ? inFlight[0].agent : "unattributed";
  /** @type {Record<string, string[]>} */
  const map = {};
  map[attributedAgent] = workingFiles;
  return map;
}

/**
 * Latest deployed image SHA. Best-effort via `flyctl status --json`; falls
 * back to "(unavailable)" so a missing flyctl never breaks the regeneration.
 */
function latestDeployedImage() {
  try {
    const out = execSync("flyctl status --json --app acreos", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const parsed = JSON.parse(out);
    const release = parsed?.LatestDeploy?.Image || parsed?.ImageRef?.Tag;
    if (release) return String(release);
    return "(no LatestDeploy in fly status)";
  } catch {
    return "(flyctl unavailable in current shell)";
  }
}

/**
 * Production health-check result via /api/health. Returns the HTTP status as
 * a string + a short label. Soft-fails to "(unreachable)".
 */
async function productionHealth() {
  if (process.env.SOLENE_TEAM_STATE_SKIP_HEALTHCHECK === "1") {
    return "(skipped via env)";
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://acreos.io/api/health", {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return `HTTP ${res.status}`;
  } catch (err) {
    return "(unreachable)";
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function fmt(date) {
  if (!(date instanceof Date)) return "n/a";
  // ISO without the millisecond noise; UTC for unambiguous cross-machine reads.
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderAutoSection({
  generatedAt,
  inFlight,
  lastByAgent,
  surfaceMap,
  workingFiles,
  deployedImage,
  healthCheck,
}) {
  const lines = [];
  lines.push(AUTO_BEGIN);
  lines.push(`<!-- generated by scripts/regenerate-team-state.mjs at ${fmt(generatedAt)} -->`);
  lines.push("");
  lines.push("## Auto-generated team state");
  lines.push("");
  lines.push(`_Last regenerated: ${fmt(generatedAt)} (UTC). Cron: every 15 minutes._`);
  lines.push("");

  // Production state header
  lines.push("### Production state");
  lines.push("");
  lines.push(`- Latest deployed image: \`${deployedImage}\``);
  lines.push(`- Last health check: ${healthCheck}`);
  lines.push("");

  // Active agents
  lines.push("### Active agents (commits in last 30 minutes)");
  lines.push("");
  if (inFlight.length === 0) {
    lines.push("- _none — working tree is at rest_");
  } else {
    for (const c of inFlight) {
      lines.push(`- **${c.agent}** — ${c.sha} · ${fmt(c.timestamp)} · ${c.subject}`);
    }
  }
  lines.push("");

  // Last commit by agent
  lines.push("### Last commit by agent identity (30-day window)");
  lines.push("");
  for (const agent of AGENTS) {
    const entry = lastByAgent[agent];
    if (entry) {
      lines.push(`- **${agent}** — ${entry.sha} · ${fmt(entry.timestamp)} · ${entry.subject}`);
    } else {
      lines.push(`- **${agent}** — _no commit in last 30 days_`);
    }
  }
  lines.push("");

  // File-surface map
  lines.push("### Working-tree file-surface map");
  lines.push("");
  if (workingFiles.length === 0) {
    lines.push("- _working tree is clean — no in-flight file surfaces_");
  } else {
    for (const [agent, files] of Object.entries(surfaceMap)) {
      lines.push(`- **${agent}** has working-tree modifications:`);
      for (const f of files) {
        lines.push(`  - \`${f}\``);
      }
    }
  }
  lines.push("");

  lines.push(AUTO_END);
  return lines.join("\n");
}

const DEFAULT_TEMPLATE = `# Solene — Team State Map

Continuously-updated picture of where the team is. Solene loads this on
session start (per the session-start protocol in \`team_solene.md\`).

The TOP of this file is **auto-generated** every 15 minutes by
\`scripts/regenerate-team-state.mjs\` (cron-supervised in
\`server/jobs/runScheduledJobs.ts\`). The BOTTOM is **Solene-maintained** —
hand-edited as work flows.

${AUTO_BEGIN}
${AUTO_END}

## Solene-maintained sections

### Queued next

_Things Solene plans to dispatch after current work lands. Single decisions
per moment — pick one and run; mention the next two as queued._

- _none queued — add items as they emerge_

### Blocked pending founder

_Items waiting on Tom (constitutional / strategic-only). Each item names the
gate that's blocking it._

- _none blocked_

### Awaiting agent report

_Agents currently in flight Solene expects responses from. Updated as
dispatches launch / land._

- _none in flight_

---

_See also: \`feedback_solene_self_development.md\` (team-state map directive),
\`feedback_coo_authority.md\` (single-decision-per-moment discipline)._
`;

// ---------------------------------------------------------------------------
// File I/O — preserve the Solene-maintained section, replace AUTO section
// ---------------------------------------------------------------------------

function loadOrSeed(path) {
  if (!existsSync(path)) {
    return DEFAULT_TEMPLATE;
  }
  return readFileSync(path, "utf8");
}

function spliceAutoSection(existing, autoBlock) {
  const beginIdx = existing.indexOf(AUTO_BEGIN);
  const endIdx = existing.indexOf(AUTO_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    // Malformed or first-run — drop the auto block at the top of the body
    // (just below the H1 + intro paragraph if present).
    return DEFAULT_TEMPLATE.replace(`${AUTO_BEGIN}\n${AUTO_END}`, autoBlock);
  }
  const before = existing.slice(0, beginIdx);
  const after = existing.slice(endIdx + AUTO_END.length);
  return `${before}${autoBlock}${after}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const generatedAt = new Date();
  const workingFiles = workingTreeFiles();
  const inFlight = recentCommits(30);
  const lastByAgent = lastCommitByAgent();
  const surfaceMap = fileSurfaceMap(workingFiles, inFlight);
  const deployedImage = latestDeployedImage();
  const healthCheck = await productionHealth();

  const autoBlock = renderAutoSection({
    generatedAt,
    inFlight,
    lastByAgent,
    surfaceMap,
    workingFiles,
    deployedImage,
    healthCheck,
  });

  const existing = loadOrSeed(TARGET_PATH);
  const next = spliceAutoSection(existing, autoBlock);

  if (DRY_RUN) {
    process.stdout.write(next);
    return;
  }

  mkdirSync(dirname(TARGET_PATH), { recursive: true });
  writeFileSync(TARGET_PATH, next, "utf8");
  console.log(
    `[regenerate-team-state] wrote ${TARGET_PATH} (working files: ${workingFiles.length}, in-flight commits: ${inFlight.length})`,
  );
}

main().catch((err) => {
  console.error("[regenerate-team-state] failed:", err);
  process.exit(1);
});

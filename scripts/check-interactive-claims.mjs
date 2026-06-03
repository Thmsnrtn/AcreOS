#!/usr/bin/env node
// ============================================================================
// scripts/check-interactive-claims.mjs
// ----------------------------------------------------------------------------
// L1.5 — Filesystem-lock primitive for the INTERACTIVE Agent-tool dispatch
// path. Sibling to scripts/check-agent-claims.mjs (which guards the
// autonomous-worker DB-backed path via solene_agent_claims).
//
// The interactive Agent-tool path runs in parallel sub-sessions of the same
// Claude Code conversation. Those sub-sessions share a working tree, have no
// live Postgres in the local sandbox, and can't see each other's prompt-
// level DO-NOT-TOUCH lists. Hand-enforcement breaks when stage-and-commit
// timing overlaps within seconds (failure-mode 0003 manifested three times
// in the 2026-06-03 wave).
//
// Lock format: .solene-locks/<agent-id>.json files in the repo root
// (gitignored). Each carries: agentId, agentRole, claimedAt, ttlMinutes,
// fileSurfacePatterns, note. Same semantics as solene_agent_claims, no DB.
//
// Behaviour:
//   - Reads .solene-locks/*.json from the repo root.
//   - Filters out expired locks (now > claimedAt + ttlMinutes).
//   - Reads staged files from stdin (one per line) — same protocol as
//     check-agent-claims.mjs. If stdin is empty, falls back to
//     `git diff --cached --name-only` so the script is also useful for
//     manual invocation.
//   - For each staged file, checks every active lock's patterns.
//   - The CURRENT agent (env SOLENE_AGENT_ID) is allowed to touch its own
//     claim. Files claimed by ANOTHER agent → block + exit 1.
//
// Bypass: SOLENE_BYPASS_INTERACTIVE_CLAIMS=1 (mirrors K2 pattern).
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// ── Bypass env (defense-in-depth — hook also checks this) ──────────────────
if (process.env.SOLENE_BYPASS_INTERACTIVE_CLAIMS === "1") {
  process.exit(0);
}

// ── Resolve repo root ───────────────────────────────────────────────────────
// Default: walk up from this script's location until we find .git or
// .solene-locks. Override via SOLENE_REPO_ROOT (used by tests for isolation).
function resolveRepoRoot() {
  if (process.env.SOLENE_REPO_ROOT) {
    return resolve(process.env.SOLENE_REPO_ROOT);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  let cur = here;
  while (cur !== "/" && cur.length > 0) {
    if (existsSync(join(cur, ".git")) || existsSync(join(cur, ".solene-locks"))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return process.cwd();
}

const REPO_ROOT = resolveRepoRoot();
const LOCKS_DIR = join(REPO_ROOT, ".solene-locks");

// ── Read staged files (stdin first, then git diff --cached) ─────────────────
function readStagedFiles() {
  // Try stdin (matches the K2 check-agent-claims.mjs protocol).
  let raw = "";
  try {
    raw = readFileSync(0, "utf-8");
  } catch {
    raw = "";
  }
  const fromStdin = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (fromStdin.length > 0) return fromStdin;

  // Fallback: ask git directly. Useful for manual invocation.
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

// ── Load active (non-expired) locks ─────────────────────────────────────────
export function loadActiveLocks(locksDir = LOCKS_DIR, now = new Date()) {
  if (!existsSync(locksDir)) return [];
  let entries = [];
  try {
    entries = readdirSync(locksDir);
  } catch {
    return [];
  }
  const active = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(locksDir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
      // Malformed lock file — warn but don't fail-closed.
      console.warn(
        `[check-interactive-claims] skipping malformed lock ${name}: ${err.message}`,
      );
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const claimedAtMs = Date.parse(parsed.claimedAt);
    if (Number.isNaN(claimedAtMs)) {
      console.warn(
        `[check-interactive-claims] skipping lock ${name}: invalid claimedAt`,
      );
      continue;
    }
    const ttlMin = Number(parsed.ttlMinutes);
    if (!Number.isFinite(ttlMin) || ttlMin <= 0) {
      console.warn(
        `[check-interactive-claims] skipping lock ${name}: invalid ttlMinutes`,
      );
      continue;
    }
    const expiresAt = claimedAtMs + ttlMin * 60_000;
    if (now.getTime() >= expiresAt) continue; // expired — ignore
    active.push({
      ...parsed,
      _file: name,
      _expiresAt: new Date(expiresAt).toISOString(),
    });
  }
  return active;
}

// ── Glob matcher: prefer minimatch (already in tree via transitive dep),
// fall back to a small embedded matcher if minimatch can't load. ────────────
let minimatchFn = null;
try {
  // eslint-disable-next-line no-unused-vars
  const mod = await import("minimatch");
  minimatchFn = mod.minimatch ?? mod.default;
} catch {
  minimatchFn = null;
}

function globToRegex(glob) {
  // Tiny embedded matcher: supports `**`, `*`, `?`. Sufficient for the
  // path patterns we put in lock files (e.g. `server/**/*.ts`,
  // `client/src/pages/founder/dispatches.tsx`).
  let re = "^";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // ** — zero-or-more path segments
      re += ".*";
      i += 2;
      // swallow following slash so `a/**/b` matches `a/b`
      if (glob[i] === "/") i += 1;
    } else if (c === "*") {
      re += "[^/]*";
      i += 1;
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (".+^$()|{}[]\\".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function matchesPattern(file, pattern) {
  if (file === pattern) return true;
  if (minimatchFn) {
    try {
      return minimatchFn(file, pattern, { dot: true });
    } catch {
      // fall through to embedded matcher
    }
  }
  try {
    return globToRegex(pattern).test(file);
  } catch {
    return false;
  }
}

// ── Core decision function (pure — drives the test suite) ───────────────────
export function findConflicts({ stagedFiles, locks, currentAgentId }) {
  const conflicts = [];
  for (const file of stagedFiles) {
    for (const lock of locks) {
      if (currentAgentId && lock.agentId === currentAgentId) continue;
      const patterns = Array.isArray(lock.fileSurfacePatterns)
        ? lock.fileSurfacePatterns
        : [];
      for (const pattern of patterns) {
        if (matchesPattern(file, pattern)) {
          conflicts.push({
            file,
            agentId: lock.agentId,
            agentRole: lock.agentRole,
            pattern,
            claimedAt: lock.claimedAt,
            note: lock.note,
          });
          break;
        }
      }
    }
  }
  return conflicts;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
function isMainModule() {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const stagedFiles = readStagedFiles();
  if (stagedFiles.length === 0) process.exit(0);

  const locks = loadActiveLocks();
  if (locks.length === 0) process.exit(0);

  const currentAgentId = process.env.SOLENE_AGENT_ID || null;
  const conflicts = findConflicts({ stagedFiles, locks, currentAgentId });

  if (conflicts.length === 0) process.exit(0);

  console.error("");
  console.error("  ⚠ Interactive-agent claim conflict detected (L1.5):");
  console.error("  ──────────────────────────────────────");
  for (const c of conflicts) {
    const noteLine = c.note ? ` — ${c.note}` : "";
    console.error(
      `  - ${c.file}\n      claimed by ${c.agentRole} (${c.agentId})${noteLine}\n      via pattern ${c.pattern}`,
    );
  }
  console.error("  ──────────────────────────────────────");
  console.error("  This file is under another interactive agent's active lock.");
  console.error("  Coordinate before committing:");
  console.error("    - wait for the other agent to release its lock");
  console.error("    - or run: node scripts/solene-lock.mjs sweep");
  console.error("    - or emergency bypass: SOLENE_BYPASS_INTERACTIVE_CLAIMS=1 git commit ...");
  console.error("");
  process.exit(1);
}

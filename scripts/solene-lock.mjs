#!/usr/bin/env node
// ============================================================================
// scripts/solene-lock.mjs
// ----------------------------------------------------------------------------
// CLI for managing L1.5 interactive-agent filesystem locks. Sibling
// primitive to K2 solene_agent_claims, but lives entirely on the
// filesystem (no DB required) so it works in the local sandbox where
// Postgres is unavailable.
//
// Usage:
//   node scripts/solene-lock.mjs claim \
//     --agent-id <id> --role <role> \
//     --patterns "a.ts,b.ts" --ttl-min 30 --note "..."
//
//   node scripts/solene-lock.mjs release --agent-id <id>
//   node scripts/solene-lock.mjs list
//   node scripts/solene-lock.mjs sweep
//
// Lock files: .solene-locks/<agent-id>.json
// ============================================================================

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveRepoRoot() {
  if (process.env.SOLENE_REPO_ROOT) return resolve(process.env.SOLENE_REPO_ROOT);
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

function ensureLocksDir() {
  if (!existsSync(LOCKS_DIR)) mkdirSync(LOCKS_DIR, { recursive: true });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function safeAgentIdToFilename(agentId) {
  // Agent IDs in our system are uuid-shaped or human-prefixed like
  // "iris-2026-06-03-uuid". Restrict filename to safe chars.
  if (!/^[A-Za-z0-9._-]+$/.test(agentId)) {
    throw new Error(
      `Invalid agentId "${agentId}" — only A-Za-z0-9._- allowed (used as filename).`,
    );
  }
  return `${agentId}.json`;
}

function readLockFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function isExpired(lock, now = new Date()) {
  const claimedAtMs = Date.parse(lock.claimedAt);
  if (Number.isNaN(claimedAtMs)) return true;
  const ttl = Number(lock.ttlMinutes);
  if (!Number.isFinite(ttl) || ttl <= 0) return true;
  return now.getTime() >= claimedAtMs + ttl * 60_000;
}

function cmdClaim(args) {
  const agentId = args["agent-id"];
  const role = args.role;
  const patternsRaw = args.patterns;
  const ttlMin = args["ttl-min"];
  const note = args.note ?? "";

  if (!agentId || agentId === true) throw new Error("--agent-id is required");
  if (!role || role === true) throw new Error("--role is required");
  if (!patternsRaw || patternsRaw === true) throw new Error("--patterns is required");
  if (!ttlMin || ttlMin === true) throw new Error("--ttl-min is required");

  const ttlNum = Number(ttlMin);
  if (!Number.isFinite(ttlNum) || ttlNum <= 0) {
    throw new Error(`--ttl-min must be a positive number (got ${ttlMin})`);
  }

  const patterns = String(patternsRaw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (patterns.length === 0) {
    throw new Error("--patterns must contain at least one comma-separated pattern");
  }

  ensureLocksDir();
  const filename = safeAgentIdToFilename(agentId);
  const path = join(LOCKS_DIR, filename);

  const lock = {
    agentId,
    agentRole: role,
    claimedAt: new Date().toISOString(),
    ttlMinutes: ttlNum,
    fileSurfacePatterns: patterns,
    note: typeof note === "string" ? note : "",
  };

  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", "utf-8");
  console.log(`Claimed: ${path}`);
  console.log(`  role:     ${role}`);
  console.log(`  ttl:      ${ttlNum} min`);
  console.log(`  patterns: ${patterns.join(", ")}`);
  if (note) console.log(`  note:     ${note}`);
}

function cmdRelease(args) {
  const agentId = args["agent-id"];
  if (!agentId || agentId === true) throw new Error("--agent-id is required");
  const filename = safeAgentIdToFilename(agentId);
  const path = join(LOCKS_DIR, filename);
  if (!existsSync(path)) {
    console.log(`No active lock for ${agentId} (nothing to release).`);
    return;
  }
  unlinkSync(path);
  console.log(`Released: ${path}`);
}

function loadAllLocks() {
  if (!existsSync(LOCKS_DIR)) return [];
  const out = [];
  for (const name of readdirSync(LOCKS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const path = join(LOCKS_DIR, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const parsed = readLockFile(path);
    if (!parsed) continue;
    out.push({ ...parsed, _file: name, _path: path });
  }
  return out;
}

function cmdList() {
  const locks = loadAllLocks();
  if (locks.length === 0) {
    console.log("No active locks.");
    return;
  }
  const now = new Date();
  console.log("");
  console.log("  Active interactive-agent locks:");
  console.log("  ──────────────────────────────────────");
  for (const lock of locks) {
    const expired = isExpired(lock, now);
    const claimedMs = Date.parse(lock.claimedAt);
    const expiresAt = Number.isNaN(claimedMs)
      ? "(unknown)"
      : new Date(claimedMs + Number(lock.ttlMinutes) * 60_000).toISOString();
    const status = expired ? "EXPIRED" : "active";
    console.log(`  [${status}] ${lock.agentId}`);
    console.log(`        role:     ${lock.agentRole ?? "(none)"}`);
    console.log(`        claimed:  ${lock.claimedAt}`);
    console.log(`        expires:  ${expiresAt}`);
    console.log(
      `        patterns: ${(lock.fileSurfacePatterns ?? []).join(", ") || "(none)"}`,
    );
    if (lock.note) console.log(`        note:     ${lock.note}`);
    console.log("");
  }
}

function cmdSweep() {
  const locks = loadAllLocks();
  if (locks.length === 0) {
    console.log("No locks present.");
    return;
  }
  const now = new Date();
  let removed = 0;
  for (const lock of locks) {
    if (isExpired(lock, now)) {
      try {
        unlinkSync(lock._path);
        console.log(`Removed expired: ${lock._file} (agent ${lock.agentId})`);
        removed += 1;
      } catch (err) {
        console.warn(`Failed to remove ${lock._file}: ${err.message}`);
      }
    }
  }
  console.log(`Sweep complete — removed ${removed} expired lock(s).`);
}

function usage() {
  console.log("Usage:");
  console.log("  node scripts/solene-lock.mjs claim --agent-id <id> --role <role> --patterns \"a.ts,b.ts\" --ttl-min 30 [--note \"...\"]");
  console.log("  node scripts/solene-lock.mjs release --agent-id <id>");
  console.log("  node scripts/solene-lock.mjs list");
  console.log("  node scripts/solene-lock.mjs sweep");
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

try {
  switch (subcommand) {
    case "claim":
      cmdClaim(args);
      break;
    case "release":
      cmdRelease(args);
      break;
    case "list":
      cmdList();
      break;
    case "sweep":
      cmdSweep();
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      usage();
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

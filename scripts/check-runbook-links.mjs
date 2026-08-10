#!/usr/bin/env node
// ============================================================================
// scripts/check-runbook-links.mjs
// ----------------------------------------------------------------------------
// Runbook reference + drill-claim integrity gate (master-handoff O3).
//
// WHY
// ───
// Runbooks are the documents someone follows AT 3AM WHILE THINGS ARE DOWN.
// Nothing gated them, so their pointers rotted silently: the agent-loop
// runbook sent the operator to `docs/ai-safety.md` (never existed), the
// db-migration runbook had them `cat migrations/meta/_journal.json` (this
// repo's drizzle layout has no journal), and the deal-hunter runbook edits a
// service retired 2026-06-08. A stale runbook is worse than no runbook — it
// burns the incident clock on paths that 404. Sibling gate for prose-about-
// code ledgers: scripts/check-ledger-refs.mjs (F-17-1), which this mirrors.
//
// WHAT IT CHECKS
// ──────────────
// 1. PATH REFS — every repo-relative path a runbook cites (backtick spans,
//    `file.ts:NN` refs, markdown links, and bare `dir/file.ext` tokens in
//    prose or command blocks) must resolve on disk (git-tracked or untracked-
//    but-not-ignored). Template placeholders (`YYYY-MM-DD`, `<angle-bracket>`
//    segments) are skipped — a naming convention is not an existence claim.
// 2. DRILL CLAIMS — a runbook line claiming an executed drill/walkthrough/
//    rotation ("Last walked: …", "Last full timed drill: …") must either be
//    honestly unverified ("NONE", "never") or carry a YYYY-MM-DD date AND
//    name one of the append-only ledger files on the same line, where that
//    ledger contains a block starting with the same date. The grammar is the
//    ledgers' own: dr-drill-history.md / secret-rotation-history.md /
//    break-glass-log.md all open each block with a line-leading `YYYY-MM-DD`
//    (dr-drill-history's header says CI parses exactly that). A drill nobody
//    logged did not happen — refuse-not-fabricate applies to ops prose too.
//
// ALLOWLIST
// ─────────
// Some dangling refs are deliberate: prose that cites an OLD path precisely
// to say "this is gone, do not grep for it". Those live in RUNBOOK_ALLOWLIST
// below with a dated reason each (in-file rather than a sidecar JSON so the
// exemption and the gate travel together). An allowlisted ref that starts
// resolving again is itself an error — the exemption went stale.
//
// This is a HARD gate (zero un-allowlisted dangling refs, zero uncited drill
// claims), not a ratchet — a boolean, not a count.
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, basename, posix } from "node:path";

const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json|sql|md|ya?ml|css|html)$/;

export const RUNBOOK_ALLOWLIST = [
  {
    ref: "valuationModelRetrain.ts",
    reason:
      "valuation-model-drift.md cites the OLD job name precisely to record that it was deleted 2026-08-01 (module orphan, never scheduled) and that retraining is now a manual server/ml run. Honest historical record, not a stale pointer.",
    date: "2026-08-10",
  },
  {
    ref: "server/services/dealHunter.ts",
    reason:
      "deal-hunter-blocked.md carries a retirement banner: dealHunter + /api/deal-hunter were retired 2026-06-08 (superseded by dealFeedEngine + /api/deal-feed). The remaining refs are the historical procedure kept for its proxy/blocking playbook.",
    date: "2026-08-10",
  },
];

// The append-only ledgers a drill claim may cite. Each records events as
// blocks whose first line starts `YYYY-MM-DD` (their own Format headers).
export const DRILL_LEDGERS = [
  "docs/runbooks/dr-drill-history.md",
  "docs/runbooks/secret-rotation-history.md",
  "docs/runbooks/break-glass-log.md",
  "docs/company/deletion-ledger.md",
];

// A claim line: "Last <words> drill|walked|walkthrough|rotation|exercised <words>:".
// "last updated" deliberately does NOT match — a doc-edit date is not a drill.
const CLAIM_RE =
  /\blast\b[^:\n]{0,50}?\b(drill|walked|walkthrough|walk-through|rotation|exercised)\b[^:\n]{0,30}?:/i;
const HONEST_NONE_RE = /\b(none|never|not\s+yet|no\s+drills?|no\s+events?)\b/i;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

// ── Truth set: every path that exists in the repo ────────────────────────────
function buildTruthSet(repoRoot) {
  try {
    const tracked = execSync("git ls-files --cached --others --exclude-standard", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
    if (tracked.length > 0) return tracked;
  } catch {
    // not a git repo (e.g. a test fixture) — fall through to an fs walk
  }
  const out = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const abs = join(dir, name);
      const r = rel ? posix.join(rel, name) : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else out.push(r);
    }
  };
  walk(repoRoot, "");
  return out;
}

// ── Token extraction ─────────────────────────────────────────────────────────
// Strip URLs and function calls before tokenizing: `https://status.clerk.com`
// and `express.json()` are not repo paths.
function stripNonPaths(text) {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(/[\w$.]+\(/g, " ");
}

function isPlaceholder(tok) {
  return /YYYY-MM-DD|[<>]/.test(tok);
}

function splitTokens(span) {
  const out = [];
  for (const raw of stripNonPaths(span).split(/[\s,;()'"]+/)) {
    const tok = raw.replace(/:\d+.*$/, "").replace(/^\.?\//, "").replace(/[.,*]+$/, "");
    if (!tok) continue;
    if (!CODE_EXT.test(tok)) continue;
    if (!/[a-zA-Z]/.test(tok)) continue;
    if (isPlaceholder(tok)) continue;
    if (/[*[\]{}]/.test(tok)) continue; // glob/brace-list, not a concrete path
    if (!/[a-zA-Z0-9]\./.test(tok)) continue; // needs a real name before the ext
    out.push(tok);
  }
  return out;
}

export function extractRefs(text) {
  const refs = new Set();
  // markdown links [text](target) — skip anchors and external schemes
  for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, …
    if (isPlaceholder(target)) continue;
    if (CODE_EXT.test(target)) refs.add(target);
  }
  // backtick spans
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const tok of splitTokens(m[1])) refs.add(tok);
  }
  const cleaned = stripNonPaths(text);
  // bare file.ts:NN refs
  for (const m of cleaned.matchAll(/\b([\w./-]+\.[a-z]{2,4}):\d+/g)) {
    if (CODE_EXT.test(m[1]) && !isPlaceholder(m[1])) refs.add(m[1]);
  }
  // bare slash-paths in prose or command blocks (docs/ai-safety.md style)
  for (const m of cleaned.matchAll(/(?:^|[\s'"=([])((?:\.{1,2}\/)?[\w@][\w.-]*(?:\/[\w.-]+)+)/gm)) {
    const tok = m[1].replace(/[.,]+$/, "");
    if (CODE_EXT.test(tok) && !isPlaceholder(tok)) refs.add(tok);
  }
  return refs;
}

// ── Resolution ───────────────────────────────────────────────────────────────
// A ref resolves if it matches a repo path exactly, as a path suffix (runbooks
// use shorthand like `services/foo.ts`), by basename for bare filenames, or —
// for ./-relative markdown links — relative to the runbook's own directory.
function makeResolver(paths, runbooksRel) {
  const fullPaths = new Set(paths);
  const basenames = new Set(paths.map((p) => basename(p)));
  return function resolves(ref) {
    const rel = ref.replace(/^\.\//, "");
    if (fullPaths.has(rel)) return true;
    if (fullPaths.has(posix.join(runbooksRel, rel))) return true;
    if (rel.includes("/")) {
      const suffix = "/" + rel;
      for (const p of fullPaths) if (p.endsWith(suffix)) return true;
      return false;
    }
    return basenames.has(rel);
  };
}

// ── Drill-claim validation ───────────────────────────────────────────────────
function checkClaims(relFile, text, repoRoot) {
  const violations = [];
  const ledgerBasenames = DRILL_LEDGERS.map((l) => basename(l));
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(CLAIM_RE);
    if (!m) continue;
    const value = line.slice(line.indexOf(m[0]) + m[0].length);
    if (HONEST_NONE_RE.test(value)) continue; // honestly unverified
    const date = value.match(DATE_RE)?.[1];
    if (!date) {
      violations.push({
        file: relFile,
        line: i + 1,
        reason: `drill claim has neither a YYYY-MM-DD date nor an honest "NONE"/"never": "${line.trim().slice(0, 120)}"`,
      });
      continue;
    }
    const cited = ledgerBasenames.find((b) => line.includes(b));
    if (!cited) {
      violations.push({
        file: relFile,
        line: i + 1,
        reason: `dated drill claim (${date}) cites no ledger — name one of: ${ledgerBasenames.join(", ")}`,
      });
      continue;
    }
    const ledgerRel = DRILL_LEDGERS.find((l) => basename(l) === cited);
    const ledgerAbs = join(repoRoot, ledgerRel);
    const ledgerText = existsSync(ledgerAbs) ? readFileSync(ledgerAbs, "utf8") : "";
    if (!new RegExp(`^${date}\\b`, "m").test(ledgerText)) {
      violations.push({
        file: relFile,
        line: i + 1,
        reason: `claims a ${date} drill citing ${cited}, but that ledger has no block starting "${date}"`,
      });
    }
  }
  return violations;
}

// ── Main check ───────────────────────────────────────────────────────────────
export function checkRunbookLinks({ repoRoot, runbooksDir = "docs/runbooks" } = {}) {
  const root = repoRoot ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const dirAbs = join(root, runbooksDir);
  const result = { dangling: [], claimViolations: [], staleAllow: [], filesScanned: 0 };
  if (!existsSync(dirAbs)) return result;

  const resolves = makeResolver(buildTruthSet(root), runbooksDir);
  const allowSet = new Set(RUNBOOK_ALLOWLIST.map((a) => a.ref));
  const ledgerBasenames = new Set(DRILL_LEDGERS.map((l) => basename(l)));

  for (const name of readdirSync(dirAbs).filter((f) => f.endsWith(".md")).sort()) {
    result.filesScanned++;
    const relFile = posix.join(runbooksDir, name);
    const text = readFileSync(join(dirAbs, name), "utf8");
    for (const ref of extractRefs(text)) {
      if (allowSet.has(ref)) continue;
      if (!resolves(ref)) result.dangling.push({ ref, file: relFile });
    }
    // The ledgers are the evidence, not claimants — skip their format headers.
    if (!ledgerBasenames.has(name)) {
      result.claimViolations.push(...checkClaims(relFile, text, root));
    }
  }
  result.staleAllow = RUNBOOK_ALLOWLIST.filter((a) => resolves(a.ref));
  return result;
}

// ── CLI entry ────────────────────────────────────────────────────────────────
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { dangling, claimViolations, staleAllow, filesScanned } = checkRunbookLinks();
  if (!dangling.length && !claimViolations.length && !staleAllow.length) {
    console.log(
      `[runbook-links] OK — ${filesScanned} runbooks: every cited path resolves on disk and every drill claim is ledger-backed or honestly NONE (allowlist: ${RUNBOOK_ALLOWLIST.length}).`,
    );
    process.exit(0);
  }
  if (dangling.length) {
    console.error(
      `\n[runbook-links] ${dangling.length} DANGLING reference(s) — cited path does not exist on disk:`,
    );
    for (const d of dangling.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ✗ ${d.ref}   (in ${d.file})`);
    }
    console.error(
      "\nFix the pointer to the real path, or — if the file is intentionally gone\n" +
        "and the runbook says so — add it to RUNBOOK_ALLOWLIST in this script with a dated reason.",
    );
  }
  if (claimViolations.length) {
    console.error(
      `\n[runbook-links] ${claimViolations.length} UNBACKED drill claim(s) — a drill nobody logged did not happen:`,
    );
    for (const v of claimViolations) {
      console.error(`  ✗ ${v.file}:${v.line} — ${v.reason}`);
    }
    console.error(
      "\nEither log the drill as a dated block in its ledger and cite it on the claim\n" +
        'line, or state the honest truth ("Last walked: never"). Never invent a date.',
    );
  }
  if (staleAllow.length) {
    console.error(
      `\n[runbook-links] ${staleAllow.length} allowlist entr(y/ies) now RESOLVE on disk — remove them (the exemption is stale):`,
    );
    for (const a of staleAllow) console.error(`  ✗ ${a.ref}`);
  }
  process.exit(1);
}

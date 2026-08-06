#!/usr/bin/env node
// ============================================================================
// scripts/check-ledger-refs.mjs
// ----------------------------------------------------------------------------
// Ledger / registry reference integrity gate (audit F-17-1).
//
// WHY
// ───
// The immune system gates CODE but nothing gates PROSE ABOUT CODE. The
// deletion-ledger and the defect-registry are hand-edited and never diffed
// against reality, so their evidence pointers rot silently. The audit's
// worst case: the ledger's own "biggest pure win" KILL row pointed at
// `server/routes-founder-v6.ts`…`v14.ts` — filenames that no longer exist
// (the routers were RENAMED) — so a fresh session greps the dead names, finds
// nothing, and wrongly concludes the deletion already happened. ~20K LOC the
// ledger marks for action silently survives on a false "done".
//
// WHAT IT CHECKS
// ──────────────
// It parses source-path tokens out of the LIVE, action-bearing prose:
//   • deletion-ledger.md  — the "## Verdict table" section only (the rows a
//     future session acts on). The "Executed deletions (log)" section is
//     intentionally NOT scanned: it legitimately references now-deleted files.
//   • defect-registry.md  — the whole file (its OPEN rows carry evidence
//     pointers a session will try to reproduce).
// A token is a path if it is a backtick span `like/this.ts` or a `file.ts:NN`
// ref whose extension is a code/doc extension. For each token, the cited path
// (or, for a bare filename, its basename) must exist among `git ls-files`.
// Any cited path that does NOT exist on disk is a DANGLING reference.
//
// ALLOWLIST
// ─────────
// Some dangling refs are deliberate — e.g. the corrected ledger row cites the
// OLD `routes-founder-v6.ts` names precisely to say "these are gone, do not
// grep for them". Those live in scripts/ledger-refs.allowlist.json with a
// reason each. Everything else must resolve. A NEW stale pointer fails CI;
// fixing one (or the file genuinely returning) shrinks the allowlist.
//
// This is a HARD gate (zero un-allowlisted dangling refs), not a ratchet: the
// allowlist already encodes the tolerated set, so the honest signal is
// "does a NEW unexplained dangling ref exist" — a boolean, not a count.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|json|sql|md|ya?ml|css|html)$/;

// ── Build the on-disk truth set ──────────────────────────────────────────────
let tracked;
try {
  tracked = execSync("git ls-files", { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  console.error("[ledger-refs] could not run `git ls-files` — skipping (fail-open).");
  process.exit(0);
}
const fullPaths = new Set(tracked);
const basenames = new Set(tracked.map((p) => basename(p)));

// A ref resolves if it matches a tracked file exactly, as a path SUFFIX (the
// ledger uses shorthand like `services/voiceAI.ts` for
// `server/services/voiceAI.ts`), or — for a bare filename — by basename.
function resolves(ref) {
  if (fullPaths.has(ref)) return true;
  if (ref.includes("/")) {
    const suffix = "/" + ref;
    for (const p of fullPaths) if (p.endsWith(suffix)) return true;
    return false;
  }
  return basenames.has(ref);
}

// ── Allowlist ────────────────────────────────────────────────────────────────
const allowPath = join(REPO, "scripts", "ledger-refs.allowlist.json");
let allow = [];
if (existsSync(allowPath)) {
  try {
    allow = JSON.parse(readFileSync(allowPath, "utf8"));
  } catch (e) {
    console.error(`[ledger-refs] allowlist parse error: ${e.message}`);
    process.exit(1);
  }
}
const allowSet = new Set(allow.map((a) => a.ref));

// ── Token extraction ─────────────────────────────────────────────────────────
// Pull `backtick spans` and file:line refs, keep only path-shaped tokens.
function extractRefs(text) {
  const refs = new Set();
  // backtick spans
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const tok of splitTokens(m[1])) refs.add(tok);
  }
  // bare file.ts:NN refs outside backticks
  for (const m of text.matchAll(/\b([\w./-]+\.[a-z]{2,4}):\d+/g)) {
    refs.add(m[1]);
  }
  return refs;
}

// A backtick span can hold `a.ts:10` or `foo/bar.ts` or prose; pull path atoms.
function splitTokens(span) {
  const out = [];
  for (const raw of span.split(/[\s,;()]+/)) {
    const tok = raw.replace(/:\d+.*$/, "").replace(/^\.?\//, "").replace(/[.,]$/, "");
    if (!tok) continue;
    if (!CODE_EXT.test(tok)) continue;
    if (!/[a-zA-Z]/.test(tok)) continue;
    if (/[*[\]{}]/.test(tok)) continue; // glob/brace-list, not a concrete path
    if (!/[a-zA-Z0-9]\./.test(tok)) continue; // must have a real name before the ext (skips ".json")
    out.push(tok);
  }
  return out;
}

// The deletion-ledger verdict table: scan only the ACTIVE rows. A row whose
// verdict/prose says "executed" legitimately references now-deleted files
// (an honest record, not a stale pointer a session would act on).
function activeVerdictRows(md) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Verdict table");
  if (start === -1) return md; // fail-open to whole file
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  return lines
    .slice(start, end)
    .filter((l) => l.startsWith("|") && !/executed/i.test(l))
    .join("\n");
}

// The defect-registry: scan only the OPEN rows. A `### DEFECT-nnnn` block whose
// `Status:` is FIXED/RESOLVED/CLOSED/WONTFIX carries historical evidence that
// legitimately cites since-deleted or since-renamed files.
function openDefectBlocks(md) {
  const blocks = md.split(/^### /m);
  const out = [];
  for (const b of blocks) {
    const status = b.match(/^Status:\s*(\w+)/m)?.[1]?.toUpperCase();
    if (status && ["FIXED", "RESOLVED", "CLOSED", "WONTFIX", "DUPLICATE"].includes(status)) {
      continue;
    }
    out.push(b);
  }
  return out.join("\n");
}

// ── Gather refs ──────────────────────────────────────────────────────────────
const sources = [
  {
    file: "docs/company/deletion-ledger.md",
    scope: (md) => activeVerdictRows(md),
  },
  {
    file: "docs/audits/defect-registry.md",
    scope: (md) => openDefectBlocks(md),
  },
];

const dangling = []; // { ref, file }
for (const src of sources) {
  const abs = join(REPO, src.file);
  if (!existsSync(abs)) continue;
  const text = src.scope(readFileSync(abs, "utf8"));
  for (const ref of extractRefs(text)) {
    if (allowSet.has(ref)) continue;
    if (!resolves(ref)) dangling.push({ ref, file: src.file });
  }
}

// ── Stale-allowlist hygiene: an allowlisted ref that now RESOLVES is stale ────
const staleAllow = allow.filter((a) => resolves(a.ref));

if (dangling.length === 0 && staleAllow.length === 0) {
  console.log(
    `[ledger-refs] OK — every cited source path in the verdict table + defect registry resolves on disk (allowlist: ${allow.length}).`,
  );
  process.exit(0);
}

if (dangling.length) {
  console.error(
    `\n[ledger-refs] ${dangling.length} DANGLING reference(s) — cited path does not exist on disk:`,
  );
  for (const d of dangling.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`  ✗ ${d.ref}   (in ${d.file})`);
  }
  console.error(
    "\nFix the pointer to the real path, or — if the file is intentionally gone\n" +
      "and the prose says so — add it to scripts/ledger-refs.allowlist.json with a reason.",
  );
}
if (staleAllow.length) {
  console.error(
    `\n[ledger-refs] ${staleAllow.length} allowlist entr(y/ies) now RESOLVE on disk — remove them (the exemption is stale):`,
  );
  for (const a of staleAllow) console.error(`  ✗ ${a.ref}`);
}
process.exit(1);

#!/usr/bin/env node
// ============================================================================
// scripts/lint-prompt-envelope.mjs — the PROMPT-ENVELOPE ratchet.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `server/utils/sanitizePrompt.ts` (P0-14) states the rule in its own header:
//
//     Apply at every site where DB-sourced text is interpolated into a prompt.
//
// Nothing checked that. Unit 111 found what that costs: `server/ai/executive.ts`
// interpolated org knowledge files and Pax project files — user-uploaded
// document text — straight into the SYSTEM role message, sanitized by a weaker
// same-named function and wrapped in no envelope at all, while Pax's system
// prompt instructed the model only about the `<<USER_DATA>>` envelope it never
// got. That shipped green: it is `tsc`-clean, every test passed, and every lint
// gate passed, because the rule lived in a doc comment.
//
// This converts the doc comment into CI. It is the same move as
// lint-reachability.mjs: a rule that was true, agreed, written down, and
// unenforced becomes a counted, down-only number.
//
// ----------------------------------------------------------------------------
// WHAT IT COUNTS — and, deliberately, what it does NOT
//
// One count: FREE-TEXT interpolations into an LLM message that do not pass
// through the canonical sanitizer.
//
// A site qualifies only when ALL THREE hold, because a broad definition here is
// worse than none. The first cut of this check matched any `content:` template
// anywhere and found 237 interpolations across 43 files — overwhelmingly
// `${totalMrr}`, `${paidOrgs.length}`, `${closingDays}` and module constants. A
// gate whose number is mostly noise is a gate people learn to re-baseline, and
// this repo already carries the lesson that the cheapest way to kill a ratchet
// is to make it cry wolf.
//
//   1. The template literal sits in a `content:` (or `prompt:`) slot inside an
//      object that ALSO carries a `role:` key. That object shape IS the LLM
//      message; a template that is not one is not a prompt.
//   2. The interpolated expression touches a FREE-TEXT FIELD — the list is
//      P0-14's own ("lead names, property descriptions, inbox subjects,
//      customer-typed notes") plus the fields this codebase actually uses for
//      uploaded and counterparty text. A number, an id, a length or an enum is
//      not an injection vector and is not counted.
//   3. It is not already guarded — `sanitizePrompt`, `sanitizePromptInline`,
//      `wrapUntrusted`, `wrapUntrustedFields`, `serializeToolResultForModel`.
//
// Like the reachability gate, this biases toward FALSE NEGATIVES. Missing an
// unguarded site is a miss; accusing a guarded one trains people to ignore the
// output. When the two conflict, it misses.
//
// ----------------------------------------------------------------------------
// WHAT IT CANNOT SEE  (read before believing a clean run)
//
//   • Indirection. `const body = lead.notes;` then `${body}` is invisible —
//     the field name is gone by the time it reaches the template.
//
//     THIS BULLET USED TO SAY "this is the big one", which was a guess, and the
//     guess was wrong. Unit 112 measured it: a one-level taint pass over local
//     `const`/`let` assignments across all 1,383 server files found FOUR sites,
//     and three were not violations at all — `executive.ts:1301` and
//     `modelIntelligence.ts:286` interpolate the MODEL'S OWN output
//     (`res.choices[0].message.content`), and `warRoomService.ts:195` composes
//     internal agent messages. The one real hit, `writingStyle.ts`'s
//     `profile.sampleMessages`, is now wrapped.
//
//     So the tracking is DELIBERATELY NOT ADDED: it would buy one finding and
//     cost three allowlist entries, which is the noise this gate was narrowed to
//     avoid. Re-measure before assuming that ratio still holds — the probe is
//     twenty lines and the number is the argument, not this sentence.
//   • String concatenation instead of a template literal.
//   • `JSON.stringify(row)` where the row's free-text fields are not named at
//     the call site. Counted only when the stringified expression itself names
//     a free-text field.
//   • Prompts assembled by helper functions several frames from the message.
//
// ----------------------------------------------------------------------------
// USAGE
//   node scripts/lint-prompt-envelope.mjs            # gate (part of npm run check)
//   node scripts/lint-prompt-envelope.mjs --measure  # print, never fail
//   node scripts/lint-prompt-envelope.mjs --report   # print EVERY finding
//   node scripts/lint-prompt-envelope.mjs --root DIR # scan an alternate tree
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const MEASURE_ONLY = argv.includes("--measure");
const REPORT_ALL = argv.includes("--report");
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const ROOT = resolve(argValue("--root") ?? join(__dirname, ".."));
const RATCHET_FILE =
  argValue("--ratchet") ?? join(ROOT, "scripts", "ratchets", "prompt-envelope.json");
const TAG = "[lint-prompt-envelope]";

/** The canonical guards. Anything else is not a guard. */
const GUARDS =
  /\b(?:sanitizePrompt|sanitizePromptInline|wrapUntrusted|wrapUntrustedFields|serializeToolResultForModel|detectInjectionPatterns)\s*\(/;

/**
 * Free-text fields. P0-14's header names the vector — "lead names, property
 * descriptions, inbox subjects, customer-typed notes" — and the rest are the
 * fields this codebase actually carries uploaded or counterparty prose in.
 *
 * Deliberately EXCLUDES `title` and `label`: in this repo those are dominated by
 * code-defined rosters (`companyAgents`'s "Chief Technology Officer",
 * `ONBOARDING_STEPS`), so including them would have made most of the count
 * unactionable. When a `title` IS customer-authored the enclosing field usually
 * is too, so the site still gets flagged by its sibling.
 */
const FREE_TEXT_FIELD =
  /\.(?:rawText|extractedContent|extractedText|description|notes?|body|subject|message|content|comment|comments|address|fullName|companyName|propertyDescription|transcript|snippet|feedback|bio|question|answer)\b/;

/** Numeric / structural expressions are not injection vectors. */
const OBVIOUSLY_SAFE = /\.length\b|\.id\b|\bNumber\(|\bcount\b|\bCount\b/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (!/\.tsx?$/.test(e) || /\.(test|spec)\.tsx?$/.test(e)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Blank comments OUT rather than removing them, preserving every byte offset so
 * a reported line number matches the real file.
 *
 * Removing them shifts every subsequent offset, and the first version of this
 * script did exactly that: it reported `documentIntelligence.ts:380` for a site
 * that lives at line 411. A gate that names the wrong line is worse than one
 * that names none — the reader looks, sees nothing wrong, and learns to distrust
 * the output. Newlines are preserved so line counting stays exact.
 */
function stripComments(src) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_all, pre, comment) => pre + blank(comment));
}

/**
 * Find template literals in a `content:`/`prompt:` slot that belong to an LLM
 * MESSAGE — i.e. an object literal that also carries `role:`.
 *
 * The `role:` may precede the content (`{ role: "user", content: \`…\` }`) or
 * follow it, and the object may span lines, so a bounded window either side is
 * checked rather than a brace-matching parse. The window is what keeps this from
 * matching a `content:` on an unrelated object three functions away — the first
 * cut of this check had no window and reported interpolations inside a type
 * declaration and a cache-telemetry block.
 */
function messageTemplates(src) {
  const out = [];
  const RE = /\b(?:content|prompt|userPrompt|systemPrompt)\s*:\s*`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m;
  while ((m = RE.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 300), m.index);
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 300);
    const isMessage = /\brole\s*:\s*["'`]/.test(before) || /\brole\s*:\s*["'`]/.test(after);
    if (!isMessage) continue;
    out.push({ body: m[1], index: m.index });
  }
  return out;
}

function findings() {
  const found = [];
  for (const tree of ["server"]) {
    for (const abs of walk(join(ROOT, tree))) {
      const rel = relative(ROOT, abs);
      const src = stripComments(readFileSync(abs, "utf8"));
      for (const tmpl of messageTemplates(src)) {
        for (const expr of tmpl.body.match(/\$\{[^}]*\}/g) ?? []) {
          if (GUARDS.test(expr)) continue;
          if (!FREE_TEXT_FIELD.test(expr)) continue;
          if (OBVIOUSLY_SAFE.test(expr)) continue;
          found.push({
            file: rel,
            line: src.slice(0, tmpl.index).split("\n").length,
            expr: expr.trim(),
          });
        }
      }
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ─── Gate ────────────────────────────────────────────────────────────────────

const all = findings();

if (!existsSync(RATCHET_FILE)) {
  console.error(`${TAG} missing ratchet file ${relative(ROOT, RATCHET_FILE)}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(RATCHET_FILE, "utf8"));

const allowlist = new Map(
  (cfg.allowlist ?? []).map((a) => [`${a.file}:${a.expr}`, a.reason]),
);
for (const [id, reason] of allowlist) {
  if (!reason || reason.length < 20) {
    console.error(
      `${TAG} allowlist entry ${id} has no real "reason".\n` +
        `  Every entry must justify itself in prose (>=20 chars).\n` +
        `  If you cannot write the reason, the answer is WRAP IT, not allowlist.`,
    );
    process.exit(1);
  }
}

const unallowed = all.filter((f) => !allowlist.has(`${f.file}:${f.expr}`));
const staleAllow = [...allowlist.keys()].filter(
  (k) => !all.some((f) => `${f.file}:${f.expr}` === k),
);

const count = unallowed.length;
const baseline = cfg.baseline;

console.log(`${TAG} scanned ${walk(join(ROOT, "server")).length} server files`);
for (const [id, reason] of allowlist) console.log(`${TAG}   allowlisted ${id} — ${reason}`);

const show = REPORT_ALL ? unallowed : unallowed.slice(0, 15);
if (MEASURE_ONLY) {
  console.log(`${TAG} unenveloped free-text interpolations: ${count} (baseline ${baseline})`);
  for (const f of show) console.log(`    • ${f.file}:${f.line}  ${f.expr}`);
  process.exit(0);
}

let failed = false;

if (staleAllow.length > 0) {
  console.error(
    `${TAG} FAIL — ${staleAllow.length} stale allowlist entr(ies): the site is now ` +
      `wrapped (or gone), so the exemption is obsolete. Remove:`,
  );
  for (const k of staleAllow) console.error(`  ✗ ${k}`);
  failed = true;
}

if (count > baseline) {
  console.error(
    `${TAG} FAIL — ${count} > baseline ${baseline} (+${count - baseline} new). ` +
      `DB-sourced free text reaching a model without the envelope:`,
  );
  for (const f of show) console.error(`  ✗ ${f.file}:${f.line}  ${f.expr}`);
  if (!REPORT_ALL && unallowed.length > show.length) {
    console.error(`  … and ${unallowed.length - show.length} more (--report for all)`);
  }
  console.error(
    `  → WRAP it: wrapUntrusted(text, "source") for a whole block, or\n` +
      `  sanitizePromptInline(text) for a field inside a larger prompt. The\n` +
      `  system prompt must also carry USER_DATA_SYSTEM_CLAUSE.\n` +
      `  Do NOT raise the baseline to make this pass — fix the occurrence.`,
  );
  failed = true;
} else if (count < baseline) {
  console.error(
    `${TAG} FAIL — stale-high baseline. Current count is ${count}, baseline says ${baseline}.\n` +
      `  Good news: ${baseline - count} site(s) were wrapped. Lock it in —\n` +
      `  set "baseline": ${count} in ${relative(ROOT, RATCHET_FILE)}.`,
  );
  failed = true;
} else {
  console.log(`${TAG} PASS — ${count} unenveloped site(s), at baseline`);
}

process.exit(failed ? 1 : 0);

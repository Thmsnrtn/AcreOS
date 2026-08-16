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
//   1. The template literal REACHES a `content:` (or `prompt:`) slot inside an
//      object that ALSO carries a `role:` key. That object shape IS the LLM
//      message; a template that is not one is not a prompt.
//
//      "REACHES", not "sits in". Until unit 112's second pass this rule was
//      SITS-IN, and that made the gate blind to the exact defect it was built
//      for. `executive.ts` did not write the template in the slot; it wrote
//
//          const systemPrompt = `… ${doc.extractedText} …`;
//          messages: [{ role: "system", content: systemPrompt }]
//
//      and a slot holding a bare identifier matched nothing. The gate reported
//      zero for its own motivating defect, and hoisting a prompt one line up —
//      which is simply how this codebase writes a long prompt; 57 of the 160
//      identifier-valued message slots in `server/` are one — was a total
//      bypass. `hoistedMessageTemplates()` now resolves the identifier back to
//      its `const`/`let` template in the enclosing block and applies rules 2
//      and 3 unchanged. Measured cost: +7 findings, seven of seven confirmed by
//      hand as real. See the FREE_TEXT_FIELD comment for the field-list half of
//      the same widening (+8, eight of eight confirmed).
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
//
//     (NOTE: this is a DIFFERENT shape from the hoisted-template bypass now
//     closed above. Here the FIELD is hoisted and the template is inline; there
//     the whole TEMPLATE is hoisted and the field is still named in it. The
//     second was the executive.ts defect; only the first stays out.)
//
//   • A nested template literal EARLIER in an inline `content:` template. The
//     inline reader is one regex that stops at the first inner backtick, so
//     `content: \`… ${x ? \`a\` : ""} … ${lead.notes}\`` hides everything after
//     the ternary. Unit 112 measured the fix (a nesting-aware reader, already
//     written for the hoisted path): +4 findings, of which THREE are not
//     violations — `agentPerformanceReviews.ts:134` interpolates an in-memory
//     LLM response, and `portfolioSentinel.ts:617` (×2) interpolates
//     `portfolio_alerts.description`, whose every writer passes a code-composed
//     literal (`triggeredBy: "system"`, always). One real: `writingStyle.ts:344`
//     puts `messageContext.propertyDetails.address` in a user message unwrapped,
//     in a file that already wraps `profile.sampleMessages`. 1-real-for-3-noise
//     is the same trade the indirection bullet above rejects, so the inline
//     reader is LEFT AS IT WAS. Report writingStyle.ts:344 by hand; re-measure
//     before adopting.
//   • String concatenation instead of a template literal. MEASURED: 3 sites in
//     `server/`, ZERO of them violations — two are `systemPrompt + dataSection`
//     where both halves are code-composed, one concatenates string literals.
//     The blind spot is real and currently empty; a check for it would buy
//     nothing today.
//   • `JSON.stringify(row)` where the row's free-text fields are not named at
//     the call site. Counted only when the stringified expression itself names
//     a free-text field. MEASURED: 19 `JSON.stringify` interpolations near a
//     message, of which ~3 carry user-controlled text (`ticket.errorContext`,
//     `ticket.pageContext`, `documentIntelligence`'s `differences`) and the
//     rest are internal telemetry objects (`liveData`, `revenueData`, `scores`,
//     `votes`). 3-in-19 is worse than the ratio already rejected above.
//   • Prompts assembled by helper functions several frames from the message —
//     e.g. `bidEstimateExtractor.ts:85` builds a prompt around OCR'd contractor
//     text and hands it to `routeSimpleTask(SYSTEM_PROMPT, userPrompt)`, never
//     touching a `role:` object. Closing this needs call-graph reach, not a
//     wider regex.
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
 *
 * The two `[A-Za-z0-9_$]*(?:Notes?|Description)` branches are a deliberate move
 * AWAY from name-keying: a fixed roster of exact names is bypassed by spelling
 * the same prose field `marketNotes` instead of `notes`, and this gate's whole
 * failure mode is keying on a name. A field whose name ENDS in "Notes" or
 * "Description" is prose by construction, so the morphology carries the rule.
 * `propertyDescription` was folded into the suffix rather than kept as a
 * one-off. Measured: +3 findings, all three confirmed real.
 *
 * Every other addition here is one P0-14's own header names as the vector:
 * `firstName`/`lastName` (its "lead names" example — a lead name is typed by
 * whoever filled in the form), `subjectLine` (its "inbox subjects"), and
 * `documentName`/`fileName` (an upload's filename is attacker-chosen, which is
 * why `executive.ts` already routes `f.name` through the source-label slot).
 *
 * WHAT WAS MEASURED AND REJECTED — the numbers, so the next session re-measures
 * instead of re-arguing. Each was run against the full predicate:
 *   • `.summary`          +3 findings, 3 FALSE (`report.summary.county|state|apn`
 *                         — `summary` there is a nested OBJECT, not prose).
 *   • `.title`            +4 findings, 4 FALSE (companyAgents, ONBOARDING_STEPS,
 *                         warRoom rule titles — code rosters, as the note above
 *                         predicted; now measured, not assumed).
 *   • `.personalityPrompt` +9 findings, 9 FALSE (the agent roster's own persona
 *                         prompts — this codebase wrote them).
 *   • blanket `*Name`     +7 findings, 2 FALSE (`context.actionName` is an enum).
 *                         Rejected in favour of the four explicit names above,
 *                         which measure 4/4 real.
 *   • `.recipientName`, `*Text|*Content|*Body|*Message`, `.text|.value|.reason`
 *                         +0 findings each. A branch that buys nothing today is
 *                         noise surface tomorrow.
 */
const FREE_TEXT_FIELD =
  /\.(?:[A-Za-z0-9_$]*(?:Notes?|Description)|rawText|extractedContent|extractedText|description|notes?|body|subject|subjectLine|message|content|comment|comments|address|fullName|firstName|lastName|companyName|documentName|fileName|transcript|snippet|feedback|bio|question|answer)\b/;

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

// ─── Template-literal primitives (hoisted path only) ─────────────────────────
//
// The inline path below still uses its original single-regex reader, on
// purpose — see the header's "MEASURED AND DECLINED" note. These two helpers
// exist because a HOISTED prompt is exactly where multi-branch composition
// lives (`${x ? `a: ${x}` : ""}`), and a reader that stops at the first inner
// backtick would read a truncated body and silently find nothing.

/** Read the template literal whose opening backtick is at `i`. Nesting-aware. */
function readTemplateAt(src, i) {
  if (src[i] !== "`") return null;
  let j = i + 1;
  let depth = 0; // inside how many `${ … }` holes
  let body = "";
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { body += src.slice(j, j + 2); j += 2; continue; }
    if (depth === 0 && c === "`") return { body, end: j };
    if (c === "$" && src[j + 1] === "{") { depth++; body += "${"; j += 2; continue; }
    if (depth > 0) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "`") {
        const inner = readTemplateAt(src, j);
        if (!inner) return null; // unterminated — refuse rather than guess
        body += "`" + inner.body + "`";
        j = inner.end + 1;
        continue;
      }
    }
    body += c;
    j++;
  }
  return null; // unterminated
}

/** `${ … }` holes of a template body, brace-nesting aware. */
function interpolationsOf(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "$" && body[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") depth--;
        j++;
      }
      out.push(body.slice(i, j));
      i = j - 1;
    }
  }
  return out;
}

/**
 * Does the block that opened before `from` still enclose `to`?
 *
 * Cheap stand-in for scope analysis: walk the span, skipping string and
 * template literals, and track brace balance. If it ever goes negative the
 * declaring block closed before the use, so the `const` we resolved is NOT the
 * one in scope and we refuse the site. Refusing is the safe direction: this
 * gate misses rather than accuses.
 */
function scopeStillOpen(src, from, to) {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = src[i];
    if (c === "`") {
      const t = readTemplateAt(src, i);
      if (!t) return false;
      i = t.end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      i = j;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth < 0) return false; }
  }
  return true;
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
  const out = src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_all, pre, comment) => pre + blank(comment));
  // VACUITY GUARD (stripper integrity). A mispairing block-comment stripper
  // that blanks the very lines a scan counts reads as a clean bill of health —
  // this repo has been bitten by exactly that. The contract above is
  // byte-for-byte length preservation, so assert it rather than trust it: any
  // drift means the stripper ate real code and every count below is a lie.
  if (out.length !== src.length || countNewlines(out) !== countNewlines(src)) {
    throw new Error(
      "stripComments changed file size — it is eating code, not comments; every count below would be fiction",
    );
  }
  return out;
}

function countNewlines(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
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

/**
 * THE ORIGINAL DEFECT SHAPE. `messageTemplates` above requires the backtick to
 * sit literally in the `content:` slot — so the exact form unit 111 found in
 * `executive.ts`,
 *
 *     const systemPrompt = `… ${doc.extractedText} …`;
 *     …
 *     messages: [{ role: "system", content: systemPrompt }]
 *
 * scored ZERO. The gate could not see the defect that motivated it: hoisting
 * the template one line up was a complete bypass, and hoisting is the NORMAL
 * way this codebase writes a long prompt (57 of the 160 identifier-valued
 * message slots in `server/` resolve to one).
 *
 * So: when the slot holds a bare identifier, resolve it back to the nearest
 * preceding `const`/`let`/`var <id> = \`…\`` whose block still encloses the use,
 * then apply the SAME three rules. Nothing about the predicate is loosened —
 * only the reader's reach. Measured cost: +7 findings, all seven confirmed by
 * hand as real DB-sourced free text reaching a model unwrapped.
 */
function hoistedMessageTemplates(src) {
  const out = [];
  const SLOT =
    /\b(?:content|prompt|userPrompt|systemPrompt)\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?=[,}\n])/g;
  let m;
  while ((m = SLOT.exec(src)) !== null) {
    const id = m[1];
    if (["true", "false", "null", "undefined"].includes(id)) continue;
    const useAt = m.index;
    const before = src.slice(Math.max(0, useAt - 300), useAt);
    const after = src.slice(useAt + m[0].length, useAt + m[0].length + 300);
    if (!/\brole\s*:\s*["'`]/.test(before) && !/\brole\s*:\s*["'`]/.test(after)) continue;

    // Nearest preceding declaration of that identifier.
    const DECL = new RegExp(
      `\\b(?:const|let|var)\\s+${id.replace(/\$/g, "\\$")}\\s*(?::[^=\\n]*)?=\\s*`,
      "g",
    );
    let d;
    let decl = null;
    while ((d = DECL.exec(src)) !== null) {
      if (d.index > useAt) break;
      decl = d;
    }
    if (!decl) continue; // parameter, import, or property — not resolvable here
    const rhs = decl.index + decl[0].length;
    if (src[rhs] !== "`") continue; // not a template literal: out of reach, by design
    const t = readTemplateAt(src, rhs);
    if (!t) continue;
    if (!scopeStillOpen(src, t.end + 1, useAt)) continue; // a different `const`, elsewhere

    out.push({ body: t.body, index: rhs, via: id, useIndex: useAt });
  }
  return out;
}

function findings() {
  const found = [];
  let templatesSeen = 0;
  let filesSeen = 0;
  for (const tree of ["server"]) {
    for (const abs of walk(join(ROOT, tree))) {
      const rel = relative(ROOT, abs);
      filesSeen++;
      const src = stripComments(readFileSync(abs, "utf8"));
      const inline = messageTemplates(src).map((t) => ({
        ...t,
        exprs: t.body.match(/\$\{[^}]*\}/g) ?? [],
      }));
      const hoisted = hoistedMessageTemplates(src).map((t) => ({
        ...t,
        exprs: interpolationsOf(t.body),
      }));
      templatesSeen += inline.length + hoisted.length;
      for (const tmpl of [...inline, ...hoisted]) {
        for (const expr of tmpl.exprs) {
          if (GUARDS.test(expr)) continue;
          if (!FREE_TEXT_FIELD.test(expr)) continue;
          if (OBVIOUSLY_SAFE.test(expr)) continue;
          found.push({
            file: rel,
            line: src.slice(0, tmpl.index).split("\n").length,
            expr: expr.trim(),
            via: tmpl.via
              ? `${tmpl.via} → content: at line ${src.slice(0, tmpl.useIndex).split("\n").length}`
              : null,
          });
        }
      }
    }
  }
  found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { found, filesSeen, templatesSeen };
}

// ─── Gate ────────────────────────────────────────────────────────────────────

const scan = findings();
const all = scan.found;

if (!existsSync(RATCHET_FILE)) {
  console.error(`${TAG} missing ratchet file ${relative(ROOT, RATCHET_FILE)}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(RATCHET_FILE, "utf8"));

// ─── Vacuity guard ───────────────────────────────────────────────────────────
//
// A scan that stops SEEING must FAIL, not congratulate. "0 findings" is the
// same output whether the code is clean or the walker got a bad `--root`, the
// extension filter stopped matching, the template readers broke, or a refactor
// moved every prompt out of `server/`. Before this guard the gate printed
// `PASS — 0 unenveloped site(s), at baseline` and exited 0 against a completely
// EMPTY tree. That is the failure mode this repo keeps getting bitten by.
//
// The floors apply only to the REAL tree, detected by the presence of the very
// module this gate enforces. Fixtures (`--root` at a temp dir with three files)
// get the one rule that holds everywhere: a scan that saw no files at all is
// vacuous. Overrides may TUNE the floors — `server/` can legitimately shrink —
// but are clamped so they can never be nulled to zero, because "set the floor
// to 0" is the same move as "raise the baseline".
const REAL_TREE = existsSync(join(ROOT, "server", "utils", "sanitizePrompt.ts"));
const MIN_FILES = REAL_TREE ? Math.max(100, cfg.minScannedFiles ?? 1000) : 1;
const MIN_TEMPLATES = REAL_TREE ? Math.max(20, cfg.minMessageTemplates ?? 100) : 0;
if (scan.filesSeen < MIN_FILES || scan.templatesSeen < MIN_TEMPLATES) {
  console.error(
    `${TAG} FAIL — VACUOUS SCAN, not a clean bill of health.\n` +
      `  scanned ${scan.filesSeen} files (floor ${MIN_FILES}) and found ` +
      `${scan.templatesSeen} LLM message templates (floor ${MIN_TEMPLATES}).\n` +
      `  A count of ${all.length} means nothing when the scan is not looking at the code.\n` +
      `  Check --root, the walker's extension filter, and the template readers before\n` +
      `  touching the floors in ${relative(ROOT, RATCHET_FILE)}.`,
  );
  process.exit(1);
}

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

console.log(
  `${TAG} scanned ${scan.filesSeen} server files, ${scan.templatesSeen} LLM message templates ` +
    `(inline slots + hoisted consts)`,
);
for (const [id, reason] of allowlist) console.log(`${TAG}   allowlisted ${id} — ${reason}`);

const fmt = (f) => `${f.file}:${f.line}  ${f.expr}${f.via ? `   [hoisted: ${f.via}]` : ""}`;
const show = REPORT_ALL ? unallowed : unallowed.slice(0, 15);
if (MEASURE_ONLY) {
  console.log(`${TAG} unenveloped free-text interpolations: ${count} (baseline ${baseline})`);
  for (const f of show) console.log(`    • ${fmt(f)}`);
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
  for (const f of show) console.error(`  ✗ ${fmt(f)}`);
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

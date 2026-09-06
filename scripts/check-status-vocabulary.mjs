#!/usr/bin/env node
/**
 * Nothing may WRITE a lead or deal status the vocabulary does not contain.
 *
 * ── WHY THE WRITE SIDE, AND ONLY THE WRITE SIDE ───────────────────────────
 * shared/lifecycle/pipeline-status.ts was created from an audit of FILTERS —
 * "filters on deal status 'won' and lead status 'active' that matched NOTHING,
 * silently zeroing metrics." Reading filters tells you which values are USED.
 * It cannot tell you which values EXIST, and the difference was expensive:
 * measured 2026-09-06 by walking every write instead, the column held four
 * values the vocabulary had never heard of —
 *
 *   leads.status  <- "deleted"   leadRepo (soft delete, ×2)
 *   deals.status  <- "deleted"   dealRepo, propertyRepo
 *   leads.status  <- "archived"  crmEnhancements (90-day sweep)
 *   leads.status  <- "active"    autonomousDealMachine (Deal Hunter enrolment)
 *
 * — and pipeline-status.ts's own header asserted that `active` "is never
 * written". Every one of those made a row invisible to every projection in
 * that file. `active` is fixed at the writer (a new lead is `new`); the other
 * three are real administrative states and are enumerated there now.
 *
 * A writer is also the only place worth GATING. The read side has ~40 more
 * literals that look like statuses to a line scanner and are not — `leadType:
 * ["seller"]`, `outcome: "positive"`, a `deal_status` context key, a
 * data-classification of `"public"` — and a gate whose findings are mostly
 * false gets switched off. Separating them is the point: this reads writes,
 * with types, anchored on the table, and its finding count is exact.
 *
 * ── THE ASYMMETRY THAT IS DELIBERATE ──────────────────────────────────────
 * Writes are checked against FUNNEL ∪ ADMINISTRATIVE. Legacy values are NOT
 * writable — that is what makes them legacy. A reader may still consult them
 * (CLOSED_DEAL_STATUSES carries `closing` so historical revenue keeps
 * counting); a writer that produces one is the bug being prevented.
 */
import ts from "typescript";
import path from "node:path";
import fs from "node:fs";
import process from "node:process";

// Floors. A parse that stops matching reads exactly like a repo with no
// writes in it; these are what tell the two apart.
const WRITE_SITE_FLOOR = 30;
const VOCAB_FLOOR = 7;

const cwd = process.cwd();
const VOCAB_FILE = "shared/lifecycle/pipeline-status.ts";

/** Parse a `export const NAME = [ "a", "b" ] as const` list out of the vocabulary file. */
function listOf(src, name) {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src);
  if (!m) {
    console.error(`[status-vocabulary] FAIL — ${name} is gone from ${VOCAB_FILE}. ` +
      `The gate cannot check writes against a list it cannot find.`);
    process.exit(1);
  }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const vocabSrc = fs.readFileSync(path.join(cwd, VOCAB_FILE), "utf8");
const WRITABLE = {
  leads: new Set([...listOf(vocabSrc, "LEAD_STATUSES"), ...listOf(vocabSrc, "ADMINISTRATIVE_LEAD_STATUSES")]),
  deals: new Set([...listOf(vocabSrc, "DEAL_STATUSES"), ...listOf(vocabSrc, "ADMINISTRATIVE_DEAL_STATUSES")]),
};
const LEGACY = {
  leads: new Set(listOf(vocabSrc, "LEGACY_LEAD_STATUSES")),
  deals: new Set(["closing"]), // LEGACY_CLOSING_DEAL_STATUS, not an array literal
};

const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });

let writeSites = 0;
let unreadable = 0;
const offenders = [];

/** The table of the `.update(X)` / `.insert(X)` this `.set()`/`.values()` hangs off. */
function tableOf(call, sf) {
  const expr = call.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  let recv = expr.expression;
  for (let i = 0; i < 8 && recv; i += 1) {
    if (ts.isCallExpression(recv)) {
      const callee = recv.expression;
      if (ts.isPropertyAccessExpression(callee) &&
          (callee.name.text === "update" || callee.name.text === "insert")) {
        return recv.arguments[0]?.getText(sf) ?? null;
      }
      recv = callee;
      continue;
    }
    if (ts.isPropertyAccessExpression(recv)) { recv = recv.expression; continue; }
    return null;
  }
  return null;
}

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  const rel = path.relative(cwd, sf.fileName);
  if (rel.startsWith("node_modules") || rel.startsWith("..")) continue;
  if (!/^(server|shared|packages)[/\\]/.test(rel)) continue;
  if (/\.test\.ts$/.test(rel)) continue;

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "set" || node.expression.name.text === "values")) {
      let table = null;
      try {
        table = tableOf(node, sf);
      } catch {
        // A walker that cannot complete must COUNT the declaration, never skip
        // it — an unlogged `continue` is how a gate goes quiet over a shape it
        // stopped reading.
        unreadable += 1;
      }
      if (table === "leads" || table === "deals") {
        writeSites += 1;
        const text = node.getText(sf);
        for (const m of text.matchAll(/status:\s*["']([^"']+)["']/g)) {
          const value = m[1];
          if (WRITABLE[table].has(value)) continue;
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          offenders.push({
            file: rel, line: line + 1, table, value,
            legacy: LEGACY[table].has(value),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

console.log(
  `[status-vocabulary] scan populations: write sites=${writeSites} ` +
  `writable(leads)=${WRITABLE.leads.size} writable(deals)=${WRITABLE.deals.size} ` +
  `unreadable=${unreadable}`,
);

let failed = false;
if (unreadable > 0) {
  console.error(`[status-vocabulary] FAIL — ${unreadable} call(s) whose receiver chain could ` +
    `not be walked. That is a shape this gate stopped reading, not a clean result.`);
  failed = true;
}
if (writeSites < WRITE_SITE_FLOOR) {
  console.error(`[status-vocabulary] FAIL — only ${writeSites} lead/deal write sites found, ` +
    `floor ${WRITE_SITE_FLOOR}. A walk that stopped reads exactly like a clean repo.`);
  failed = true;
}
for (const [t, set] of Object.entries(WRITABLE)) {
  if (set.size < VOCAB_FLOOR) {
    console.error(`[status-vocabulary] FAIL — the writable ${t} vocabulary came back with ` +
      `${set.size} values, floor ${VOCAB_FLOOR}. The list parse is broken, not the code.`);
    failed = true;
  }
}

if (offenders.length > 0) {
  failed = true;
  console.error("");
  console.error(`[status-vocabulary] FAIL — ${offenders.length} write(s) of a status the ` +
    `vocabulary does not contain. A row written this way is invisible to every projection ` +
    `in ${VOCAB_FILE}:`);
  for (const o of offenders) {
    const why = o.legacy
      ? "LEGACY — readable so historical rows keep counting, never writable again"
      : "not in the funnel or administrative set";
    console.error(`    ${o.file}:${o.line}  ${o.table}.status <- "${o.value}"   [${why}]`);
  }
  console.error("");
  console.error(`  Either write a canonical value, or — if this is a real state the product ` +
    `has and the vocabulary lacks — add it to ADMINISTRATIVE_*_STATUSES in ${VOCAB_FILE} ` +
    `and say what writes it. Do NOT add it to LEAD_STATUSES/DEAL_STATUSES unless a status ` +
    `CHANGE should be able to target it: membership there is what the human and agent write ` +
    `seams validate against.`);
}

if (!failed) console.log("[status-vocabulary] OK — every lead/deal status write is in the vocabulary.");
process.exit(failed ? 1 : 0);

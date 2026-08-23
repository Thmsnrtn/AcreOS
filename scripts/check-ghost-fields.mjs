#!/usr/bin/env node
// ============================================================================
// scripts/check-ghost-fields.mjs — the GHOST FIELD ratchet.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `(row as any).someField` where `someField` is not on `row`'s type reads
// `undefined` on every row, forever. It never throws. If the expression has a
// fallback, that fallback becomes the answer — permanently, silently, and with
// `tsc` explicitly told not to look.
//
// Three live defects of exactly this shape were found by hand on 2026-08-21/23,
// each in a different file, none detectable by any other gate here:
//
//   • auditOrgUsury            `(note as any).propertyState || "TX"`
//     `notes` has no `propertyState`, so EVERY note in EVERY organization was
//     audited against Texas usury law and served as that org's compliance status.
//
//   • GET /api/seller-motivation/:leadId
//     Nine of eleven motivation signals cast onto non-existent columns, each with
//     a plausible default. The endpoint returned at most TWO distinct scores
//     across every lead in every org. `isOutOfState` could never be true.
//
//   • the campaign email and SMS senders
//     `templateContent`/`htmlContent`/`textContent`/`smsBody` are not columns of
//     `campaigns`, so both chains fell through to `campaign.name`. Every
//     recipient of every campaign received the campaign's INTERNAL NAME as the
//     message body, while `campaigns.content` — what the customer wrote — went
//     unread.
//
// A regex over casts whose variable NAME happens to match a table found 19 of
// these. The type checker finds ten times as many, because the rule was never
// about names.
//
// WHAT IS DELIBERATELY NOT COUNTED
// Augmenting a browser or Node global (`window.webkitSpeechRecognition`,
// `globalThis.__someCache`, a runtime-injected `window.__ENV__`) is a real and
// idiomatic use of this cast: the property genuinely is not in the ambient lib
// types and there is no row to read. Those are excluded BY RULE rather than
// parked in the baseline, so the number below means one thing only — a domain
// object being asked for a field it does not have.
//
// THE CHEAPEST WAY TO SATISFY THIS GATE IS TO READ THE REAL FIELD, or to delete
// the read. Widening a type to make a ghost legal is the one repair that is
// worse than the defect, because it makes `undefined` the documented contract.
// ============================================================================

import ts from "typescript";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TAG = "[check-ghost-fields]";
const RATCHET = path.join(ROOT, "scripts/ratchets/ghost-fields.json");
const REPORT = process.argv.includes("--report");

const ratchet = JSON.parse(fs.readFileSync(RATCHET, "utf8"));

const cfgPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const SCOPE = /^(server|shared|client\/src)\//;

/** Bases whose missing property is ambient-type incompleteness, not a bad read. */
const AMBIENT_BASE = /^(Window|typeof globalThis|Document|Navigator|Window & typeof globalThis)$/;

const unwrap = (n) => {
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
};

function propertyExists(type, name) {
  if (checker.getPropertyOfType(type, name)) return true;
  if (checker.getIndexInfoOfType?.(type, ts.IndexKind.String)) return true;
  if (type.isUnion?.()) return type.types.some((t) => propertyExists(t, name));
  return false;
}

const findings = [];
let inScopeCasts = 0;
let judged = 0;

for (const sf of program.getSourceFiles()) {
  const rel = path.relative(ROOT, sf.fileName);
  if (!SCOPE.test(rel) || rel.includes("node_modules")) continue;
  if (/\.(test|spec)\.tsx?$/.test(rel)) continue;

  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const target = unwrap(node.expression);
      if (ts.isAsExpression(target) && target.type.kind === ts.SyntaxKind.AnyKeyword) {
        inScopeCasts++;
        const inner = unwrap(target.expression);
        const t = checker.getTypeAtLocation(inner);
        const f = t.getFlags();
        const opaque =
          f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown || f & ts.TypeFlags.TypeParameter;
        const typeName = checker.typeToString(t);
        // A type with NO declared properties (`object`, `{}`) contradicts
        // nothing — the cast is doing the job `any` would do, and there is no
        // shape being asked for a field it lacks. Excluded so the count means
        // "a KNOWN shape is missing this field".
        const shapeless = checker.getPropertiesOfType(t).length === 0;
        if (!opaque && !shapeless && typeName !== "error" && !AMBIENT_BASE.test(typeName)) {
          judged++;
          const prop = node.name.text;
          if (!propertyExists(t, prop)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            findings.push({ file: rel, line: line + 1, prop, type: typeName.slice(0, 60) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ── VACUITY GUARDS, checked before the count means anything ─────────────────
// Every number below counts BAD THINGS FOUND, so a program that stops loading
// files finds zero and reports a reassuring PASS.
let vacuous = false;
for (const [name, actual, floor] of [
  ["castsInScope", inScopeCasts, ratchet.minima.castsInScope],
  ["judgedCasts", judged, ratchet.minima.judgedCasts],
]) {
  if (floor === undefined) {
    console.error(`${TAG} VACUITY GUARD: no minima.${name} in the ratchet file.`);
    vacuous = true;
  } else if (actual < floor) {
    console.error(
      `${TAG} VACUITY GUARD: ${name} = ${actual}, below the floor of ${floor}. ` +
        `The program stopped seeing files — suspect the tsconfig, the scope regex or ` +
        `the walk before you suspect progress.`,
    );
    vacuous = true;
  }
}

console.log(
  `${TAG} ${inScopeCasts} \`(x as any).prop\` reads in scope; ${judged} with a knowable, ` +
    `non-ambient base type; ${findings.length} read a property that type does not have`,
);

if (vacuous) {
  console.error(`${TAG} FAIL — vacuity guard tripped; the count above is not trustworthy.`);
  process.exit(1);
}

const shown = REPORT ? findings : findings.slice(0, 12);
for (const f of shown) console.log(`  • ${f.file}:${f.line}  .${f.prop}   — not on ${f.type}`);
if (!REPORT && findings.length > shown.length) {
  console.log(`  … ${findings.length - shown.length} more (run with --report)`);
}

const baseline = ratchet.baseline;
if (findings.length > baseline) {
  console.error(
    `\n${TAG} FAIL — ${findings.length} > baseline ${baseline} (+${findings.length - baseline}).\n` +
      `  A cast is reading a field its type does not have. It will be \`undefined\` on every\n` +
      `  row, forever, and any fallback beside it becomes the permanent answer.\n` +
      `  READ THE REAL FIELD, or delete the read. Do NOT widen the type to make the ghost\n` +
      `  legal — that documents \`undefined\` as the contract.`,
  );
  process.exit(1);
}
if (findings.length < baseline) {
  console.error(
    `\n${TAG} FAIL — stale-high baseline. Current count is ${findings.length}, baseline says ` +
      `${baseline}. Lower it in the commit that earned the reduction.`,
  );
  process.exit(1);
}
console.log(`${TAG} PASS — ${findings.length} (baseline ${baseline})`);

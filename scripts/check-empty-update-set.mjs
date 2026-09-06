#!/usr/bin/env node
/**
 * An UPDATE with nothing to SET is malformed SQL, not a no-op.
 *
 * Drizzle DROPS undefined values from `.set()`. A patch whose every value is
 * undefined therefore renders the identical statement as `.set({})`:
 *
 *   update "organizations" set  where "organizations"."id" = $1
 *                            ^^ nothing between SET and WHERE
 *
 * Postgres rejects it as a syntax error. In a route that is a 500 whose
 * message is about SQL grammar and names no call site; the client that sent
 * `PATCH {}` never learns that an empty body was the problem. The mechanism is
 * pinned end-to-end in tests/unit/emptyUpdateIsNotAStatement.test.ts (rendered
 * through Drizzle's own PgDialect, not asserted from memory).
 *
 * ── WHY A TYPE-AWARE PASS AND NOT A GREP ──────────────────────────────────
 * The tempting rule — "the argument's type is all-optional" — is useless here:
 * essentially every Drizzle patch type is `Partial<Insert>`, and 1,000+ of
 * this repo's writes are that shape and completely safe, because the object
 * that actually reaches `.set()` carries an unconditional `updatedAt: new
 * Date()`. A gate at the type level would report a thousand findings and be
 * switched off within a day.
 *
 * So the question this asks is the runtime one: CAN THE OBJECT THAT REACHES
 * .set() BE EMPTY OF DEFINED VALUES? It resolves the argument to the object
 * literal that produces it and looks for at least one property whose value
 * expression cannot be undefined. Spreads guarantee nothing. Conditional
 * `obj.x = …` assignments guarantee nothing. That distinction is what makes
 * the verdict actionable: measured 2026-09-05, 1,125 writes clear it and 0
 * do not.
 *
 * ── THREE VERDICTS, NOT TWO ───────────────────────────────────────────────
 * `any` is not evidence of absence. Most of it here is `req.body.x` narrowed
 * by a guard, and calling it a risk would bury the typed cases in noise. It is
 * not evidence of presence either. So it gets its own bucket: printed every
 * run, never gating. If that bucket grows, someone can look at it — which is
 * more than a silent pass would offer.
 *
 * ── THE SANCTIONED GUARD ──────────────────────────────────────────────────
 *   .set(assertWritablePatch(patch, "table.method"))   // server/utils/patch.ts
 *
 * Recognised AT THE CALL, deliberately. A guard placed at the top of the
 * function drifts away from the write it protects across a refactor; one
 * wrapped around the argument cannot.
 *
 * ── POPULATION FLOORS ─────────────────────────────────────────────────────
 * A parser that stops matching reads exactly like a repo with no writes in it,
 * so the counts below are asserted, not merely printed — and `unresolved`
 * counts every construct the walk could not classify, because a walker that
 * cannot complete must COUNT the declaration, never skip it.
 */
import ts from "typescript";
import path from "node:path";
import process from "node:process";

// Floors. Raise them when the codebase legitimately grows; never lower them to
// make a broken parse pass.
const FILE_FLOOR = 1200;
const SET_CALL_FLOOR = 1200;
const UPDATE_SET_FLOOR = 900;

const cwd = process.cwd();
const cfgPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
if (!cfgPath) {
  console.error("[empty-update-set] FAIL — no tsconfig.json found");
  process.exit(1);
}
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsedCfg = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
const program = ts.createProgram(parsedCfg.fileNames, { ...parsedCfg.options, noEmit: true });
const checker = program.getTypeChecker();

const pop = { files: 0, setCalls: 0, updateSets: 0, guarded: 0, byLiteral: 0, unresolved: 0 };
const risky = [];
const untyped = [];

const DEFINITELY_ABSENT_ABLE = (t) =>
  (t.flags & ts.TypeFlags.Undefined) !== 0 ||
  (t.isUnion?.() && t.types.some((x) => (x.flags & ts.TypeFlags.Undefined) !== 0));
const UNTYPED = (t) => (t.flags & ts.TypeFlags.Any) !== 0 || (t.flags & ts.TypeFlags.Unknown) !== 0;
const canBeUndefined = (t) => DEFINITELY_ABSENT_ABLE(t) || UNTYPED(t);

const unwrap = (n) => {
  while (n && (ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n))) {
    n = n.expression;
  }
  return n;
};

/** { prop } if some property is definitely defined; { untyped } if only `any` stops it; null otherwise. */
function guaranteedProp(objLit) {
  let sawUntyped = null;
  for (const p of objLit.properties) {
    let valueNode = null;
    if (ts.isPropertyAssignment(p)) valueNode = unwrap(p.initializer);
    else if (ts.isShorthandPropertyAssignment(p)) valueNode = p.name;
    else continue; // spread / method: guarantees nothing
    const t = checker.getTypeAtLocation(valueNode);
    if (!canBeUndefined(t)) return { prop: p.name.getText() };
    if (UNTYPED(t)) sawUntyped ??= p.name.getText();
  }
  return sawUntyped ? { untyped: sawUntyped } : null;
}

/** The table of the `.update(<table>)` this `.set(...)` hangs off, or null. */
function updateTargetOf(setCall) {
  const expr = setCall.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  let recv = expr.expression;
  for (let i = 0; i < 8 && recv; i++) {
    if (ts.isCallExpression(recv)) {
      const callee = recv.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "update") {
        return recv.arguments[0]?.getText() ?? "(unknown table)";
      }
      recv = callee;
      continue;
    }
    if (ts.isPropertyAccessExpression(recv)) { recv = recv.expression; continue; }
    return null;
  }
  return null;
}

function enclosingFunction(node) {
  let p = node.parent;
  while (p) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) ||
        ts.isMethodDeclaration(p) || ts.isConstructorDeclaration(p)) return p;
    p = p.parent;
  }
  return null;
}

/** An early return on emptiness, in the same function, counts too. */
function emptinessGuard(node, name, sf) {
  const fn = enclosingFunction(node);
  if (!fn || !name) return null;
  const text = fn.getText(sf);
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pats = [
    ["hasWritableValues", new RegExp(`hasWritableValues\\(\\s*${n}\\s*\\)`)],
    ["Object.keys().length", new RegExp(`Object\\.keys\\(\\s*${n}\\s*\\)\\s*\\.\\s*length`)],
    ["Object.entries().length", new RegExp(`Object\\.entries\\(\\s*${n}\\s*\\)\\s*\\.\\s*length`)],
    ["Object.values().length", new RegExp(`Object\\.values\\(\\s*${n}\\s*\\)\\s*\\.\\s*length`)],
    [".length compare", new RegExp(`\\b${n}\\s*\\.\\s*length\\s*(===?|!==?|<|>)`)],
  ];
  for (const [label, re] of pats) if (re.test(text)) return label;
  return null;
}

function declKind(ident) {
  const sym = checker.getSymbolAtLocation(ident);
  const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
  if (!d) return { kind: "unresolved" };
  if (ts.isVariableDeclaration(d)) return { kind: "var", decl: d };
  if (ts.isParameter(d)) return { kind: "param", decl: d };
  return { kind: ts.SyntaxKind[d.kind] };
}

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  const rel = path.relative(cwd, sf.fileName);
  if (rel.startsWith("node_modules") || rel.startsWith("..")) continue;
  if (!/^(server|shared|packages)[/\\]/.test(rel)) continue;
  if (/\.test\.ts$/.test(rel)) continue;
  pop.files += 1;

  const visit = (node) => {
    if (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "set") {
      pop.setCalls += 1;
      const table = updateTargetOf(node);
      if (table) {
        pop.updateSets += 1;
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const at = { file: rel, line: line + 1, table };
        // Unwrap casts FIRST: the guard is routinely written inside one
        // (`assertWritablePatch(set, "…") as never`), and a check that ran
        // before the unwrap would not see it.
        const arg = unwrap(node.arguments[0]);
        const guardedInline = !!(arg && ts.isCallExpression(arg) &&
          ts.isIdentifier(arg.expression) && arg.expression.text === "assertWritablePatch");

        if (guardedInline) {
          pop.guarded += 1;
        } else if (!arg) {
          pop.unresolved += 1;
          risky.push({ ...at, arg: "(no argument)", kind: "no-argument" });
        } else if (ts.isObjectLiteralExpression(arg)) {
          pop.byLiteral += 1;
          const g = guaranteedProp(arg);
          if (g?.prop) { /* safe */ }
          else if (g?.untyped) untyped.push({ ...at, prop: g.untyped });
          else risky.push({ ...at, arg: arg.getText(sf).slice(0, 80).replace(/\s+/g, " "), kind: "inline-literal" });
        } else if (ts.isIdentifier(arg)) {
          const res = declKind(arg);
          const guard = emptinessGuard(node, arg.text, sf);
          if (guard) {
            pop.guarded += 1;
          } else if (res.kind === "var" && res.decl.initializer &&
                     ts.isObjectLiteralExpression(res.decl.initializer)) {
            pop.byLiteral += 1;
            const g = guaranteedProp(res.decl.initializer);
            if (g?.prop) { /* safe */ }
            else if (g?.untyped) untyped.push({ ...at, prop: g.untyped });
            else risky.push({ ...at, arg: arg.text, kind: "variable-all-optional" });
          } else if (res.kind === "param") {
            // Interprocedural: safety is a property of every CALLER, which
            // this pass cannot see. The callee must guard.
            risky.push({ ...at, arg: arg.text, kind: "unguarded-parameter" });
          } else {
            pop.unresolved += 1;
            risky.push({ ...at, arg: arg.text, kind: `unresolved:${res.kind}` });
          }
        } else {
          pop.unresolved += 1;
          risky.push({ ...at, arg: arg.getText(sf).slice(0, 60).replace(/\s+/g, " "),
                       kind: `unresolved:${ts.SyntaxKind[arg.kind]}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const safe = pop.updateSets - risky.length - untyped.length;
console.log(
  `[empty-update-set] scan populations: files=${pop.files} .set()=${pop.setCalls} ` +
  `update-sets=${pop.updateSets} (safe=${safe} guarded=${pop.guarded} ` +
  `by-literal=${pop.byLiteral} untyped=${untyped.length} unresolved=${pop.unresolved})`,
);

let failed = false;
const floorFail = (label, got, floor) => {
  if (got < floor) {
    console.error(`[empty-update-set] FAIL — ${label} ${got} is below the floor ${floor}. ` +
      `A parse that stopped matching reads exactly like a clean repo; that is what this catches.`);
    failed = true;
  }
};
floorFail("files scanned", pop.files, FILE_FLOOR);
floorFail(".set() calls found", pop.setCalls, SET_CALL_FLOOR);
floorFail("update-set calls found", pop.updateSets, UPDATE_SET_FLOOR);

if (untyped.length > 0) {
  console.log(`[empty-update-set] ${untyped.length} write(s) rest on an \`any\`-typed value ` +
    `(reported, not gated — \`any\` is evidence of neither presence nor absence):`);
  for (const u of untyped) console.log(`    ${u.file}:${u.line}  ${u.table}  <- ${u.prop}`);
}

if (risky.length > 0) {
  failed = true;
  console.error("");
  console.error(`[empty-update-set] FAIL — ${risky.length} UPDATE(s) can reach .set() with ` +
    `nothing defined to set. Drizzle drops undefined values, so this renders ` +
    `"set  where …" and Postgres rejects it as a syntax error:`);
  for (const r of risky) {
    console.error(`    ${r.file}:${r.line}  ${r.table}  <- ${r.arg}   [${r.kind}]`);
  }
  console.error("");
  console.error("  Fix at the call, so the guard cannot drift from the write:");
  console.error('    .set(assertWritablePatch(patch, "table.method"))   // server/utils/patch.ts');
  console.error("  A route that built the patch from a request body should answer 400 instead:");
  console.error('    if (!hasWritableValues(update)) return Errors.badRequest(res, "No fields to update");');
}

if (!failed) console.log("[empty-update-set] OK — every UPDATE reaches .set() with something to set.");
process.exit(failed ? 1 : 0);

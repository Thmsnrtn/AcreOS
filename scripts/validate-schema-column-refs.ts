#!/usr/bin/env tsx
/**
 * validate-schema-column-refs — catches the schema-misalignment bug
 * class that crashed activity-timeline, /avm, /founder, agent_events
 * inserts, and others this session.
 *
 * For every TS/JS file in server/, scan for:
 *   1. `db.select({ k1: TABLE.col1, k2: TABLE.col2, ... })`
 *      → check every TABLE.colN exists on the drizzle schema.
 *   2. `db.insert(TABLE).values({ col1: ..., col2: ..., ... })`
 *      → check every key exists on TABLE.
 *
 * Why this matters: drizzle's runtime won't fail loudly when you
 * reference a missing column. The query just throws "Cannot convert
 * undefined or null to object" inside drizzle's prepare phase — see
 * the activity-timeline post-mortem in
 * docs/archive/exhaustive-completion/pillar-i-reliability-infrastructure.md.
 *
 * Usage:
 *   npx tsx scripts/validate-schema-column-refs.ts
 *   npx tsx scripts/validate-schema-column-refs.ts --staged   # only staged TS files
 *
 * Exit code:
 *   0 — no violations
 *   1 — at least one violation (build-blocking in CI)
 */

import { Project, Node } from "ts-morph";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_FILE = path.join(REPO_ROOT, "shared/schema.ts");

interface Violation {
  file: string;
  line: number;
  table: string;
  column: string;
  context: string;
}

// ── Build the table → columns index from shared/schema.ts ────────────
//
// We parse the schema source and pick up every `export const X =
// pgTable("...", { col1: ..., col2: ... })` declaration. Each
// becomes an entry in our column-name set.
function buildSchemaIndex(): Map<string, Set<string>> {
  const project = new Project({
    skipFileDependencyResolution: true,
    skipAddingFilesFromTsConfig: true,
  });
  const source = project.addSourceFileAtPath(SCHEMA_FILE);
  const tables = new Map<string, Set<string>>();

  for (const v of source.getVariableStatements()) {
    for (const decl of v.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const expr = init.getExpression().getText();
      if (expr !== "pgTable") continue;
      const args = init.getArguments();
      if (args.length < 2) continue;
      const colsArg = args[1];
      if (!Node.isObjectLiteralExpression(colsArg)) continue;
      const tableConstName = decl.getName();
      const cols = new Set<string>();
      for (const p of colsArg.getProperties()) {
        if (Node.isPropertyAssignment(p)) {
          cols.add(p.getName());
        } else if (Node.isShorthandPropertyAssignment(p)) {
          cols.add(p.getName());
        }
      }
      tables.set(tableConstName, cols);
    }
  }
  return tables;
}

// ── Discover the files to lint ───────────────────────────────────────
function discoverFiles(stagedOnly: boolean): string[] {
  if (stagedOnly) {
    try {
      const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      });
      return out
        .split("\n")
        .map((s) => s.trim())
        .filter((p) => p.endsWith(".ts") && p.startsWith("server/"))
        .map((p) => path.join(REPO_ROOT, p));
    } catch {
      return [];
    }
  }
  const files: string[] = [];
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".turbo" || e.name === "dist") continue;
        walk(p);
      } else if (e.isFile() && p.endsWith(".ts")) {
        files.push(p);
      }
    }
  }
  walk(path.join(REPO_ROOT, "server"));
  return files;
}

// ── Walk a source file's call sites ──────────────────────────────────
function scanFile(
  file: string,
  schema: Map<string, Set<string>>,
): Violation[] {
  const violations: Violation[] = [];
  const project = new Project({
    skipFileDependencyResolution: true,
    skipAddingFilesFromTsConfig: true,
  });
  const source = project.addSourceFileAtPath(file);

  source.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const exprText = node.getExpression().getText();
    const args = node.getArguments();

    // Pattern 1: db.select({ k: TABLE.col, ... })
    // Look for any callee that ends in ".select"; the first argument
    // is an object literal whose values are PropertyAccessExpressions
    // of the form TABLE.column.
    if (exprText.endsWith(".select") && args.length >= 1) {
      const arg = args[0];
      if (Node.isObjectLiteralExpression(arg)) {
        for (const prop of arg.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue;
          const init = prop.getInitializer();
          if (!init || !Node.isPropertyAccessExpression(init)) continue;
          const tableName = init.getExpression().getText();
          const colName = init.getName();
          checkColumnRef(file, init.getStartLineNumber(), tableName, colName, schema, violations);
        }
      }
    }

    // Pattern 2: db.insert(TABLE).values({ col1: ..., col2: ... })
    // The `.insert(TABLE)` first, then `.values({...})` is chained.
    // We look at every `.values(...)` call and try to find the
    // `.insert(...)` upstream.
    if (exprText.endsWith(".values") && args.length >= 1) {
      const arg = args[0];
      if (Node.isObjectLiteralExpression(arg)) {
        const tableName = findUpstreamInsertTable(node);
        if (!tableName) return;
        for (const prop of arg.getProperties()) {
          if (Node.isPropertyAssignment(prop) || Node.isShorthandPropertyAssignment(prop)) {
            const colName = prop.getName();
            checkColumnRef(file, prop.getStartLineNumber(), tableName, colName, schema, violations);
          }
        }
      }
    }
  });

  return violations;
}

function findUpstreamInsertTable(valuesCall: Node): string | null {
  // .values is chained off of .insert(TABLE). The expression of the
  // .values call expression is `EXPR.insert(TABLE)`. We walk down to
  // find the .insert(...) call and read its argument.
  let cur: Node = valuesCall;
  while (cur) {
    if (Node.isCallExpression(cur)) {
      const exprText = cur.getExpression().getText();
      if (exprText.endsWith(".insert")) {
        const args = cur.getArguments();
        if (args.length >= 1 && Node.isIdentifier(args[0])) {
          return args[0].getText();
        }
        return null;
      }
      // Descend through the call's expression (which may be a chain).
      const expr = cur.getExpression();
      if (Node.isPropertyAccessExpression(expr)) {
        cur = expr.getExpression();
        continue;
      }
    }
    if (Node.isPropertyAccessExpression(cur)) {
      cur = cur.getExpression();
      continue;
    }
    break;
  }
  return null;
}

function checkColumnRef(
  file: string,
  line: number,
  tableName: string,
  colName: string,
  schema: Map<string, Set<string>>,
  violations: Violation[],
): void {
  // Only validate when the table identifier matches one we indexed.
  // Identifiers we don't know about (subqueries, aliased CTEs,
  // imported sub-schemas) are skipped — not a false positive.
  const cols = schema.get(tableName);
  if (!cols) return;
  if (cols.has(colName)) return;
  violations.push({
    file: path.relative(REPO_ROOT, file),
    line,
    table: tableName,
    column: colName,
    context: `${tableName}.${colName}`,
  });
}

// ── Baseline support ─────────────────────────────────────────────────
//
// The codebase has ~230 pre-existing schema-misalignment violations
// (this session's audit only fixed the ones currently crashing). The
// validator stores those as a baseline so it can block ONLY new
// violations beyond it. Fix the legacy ones over time and shrink the
// baseline; new violations fail immediately. Re-baseline with
// `--update-baseline` if intentionally accepted (rare).

const BASELINE_FILE = path.join(REPO_ROOT, "scripts/schema-column-baseline.json");

function violationKey(v: Violation): string {
  return `${v.file}|${v.table}.${v.column}`;
}

function loadBaseline(): Set<string> {
  if (!fs.existsSync(BASELINE_FILE)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf-8")) as { entries: string[] };
    return new Set(raw.entries);
  } catch {
    return new Set();
  }
}

function writeBaseline(violations: Violation[]): void {
  const entries = [...new Set(violations.map(violationKey))].sort();
  const payload = {
    note:
      "Auto-generated by scripts/validate-schema-column-refs.ts. Pre-existing schema-misalignment violations the validator allows. Shrink over time. Re-generate with: npx tsx scripts/validate-schema-column-refs.ts --update-baseline",
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + "\n");
}

// ── Main ─────────────────────────────────────────────────────────────
function main() {
  const stagedOnly = process.argv.includes("--staged");
  const updateBaseline = process.argv.includes("--update-baseline");

  console.log("Building schema index from shared/schema.ts ...");
  const schema = buildSchemaIndex();
  console.log(`  found ${schema.size} tables, ${[...schema.values()].reduce((n, s) => n + s.size, 0)} columns.`);

  const files = discoverFiles(stagedOnly);
  console.log(`Scanning ${files.length} server TS file${files.length === 1 ? "" : "s"} ...`);

  const allViolations: Violation[] = [];
  for (const file of files) {
    try {
      allViolations.push(...scanFile(file, schema));
    } catch (err) {
      console.warn(`  ⚠ skipped ${path.relative(REPO_ROOT, file)}: ${(err as Error).message}`);
    }
  }

  if (updateBaseline) {
    writeBaseline(allViolations);
    console.log(`\nBaseline updated with ${allViolations.length} known violations.`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const newViolations = allViolations.filter((v) => !baseline.has(violationKey(v)));

  if (newViolations.length === 0) {
    const baselineSize = baseline.size;
    if (baselineSize > 0) {
      console.log(`\n✓ No new schema-column violations. (${baselineSize} pre-existing in baseline.)`);
    } else {
      console.log("\n✓ All schema column references valid.");
    }
    process.exit(0);
  }

  console.log(`\n✗ Found ${newViolations.length} NEW invalid column reference${newViolations.length === 1 ? "" : "s"} not in baseline:\n`);
  for (const v of newViolations) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`    ${v.context} — column "${v.column}" does not exist on table "${v.table}".`);
  }
  console.log("");
  console.log(
    "  Hint: drizzle won't fail loudly on a missing column ref. The query throws 'Cannot convert undefined or null to object' inside its prepare phase.",
  );
  console.log(
    "  If this is intentional (you renamed a column and the baseline is stale), re-baseline with: npx tsx scripts/validate-schema-column-refs.ts --update-baseline",
  );
  process.exit(1);
}

main();

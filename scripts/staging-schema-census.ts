/**
 * scripts/staging-schema-census.ts — after the staging schema reconcile, does
 * staging's database physically hold the tables this repository declares?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * 2026-10-28: `note_events` (migration 0293) never reached staging's database
 * while the deploy went green. Staging deploys apply no schema
 * (fly.staging.toml sets release_command = "true"); the only schema path was
 * the nightly Staging Schema Reconcile workflow, which last ran 77 minutes
 * before the merge. Nothing compared what staging physically held against
 * what the repo declares, so the lag was silent until a request hit it.
 *
 * The reconcile now chains after every staging deploy (staging.yml calls the
 * reconcile workflow). This census runs after it, in that workflow, and fails
 * loudly — itemized — when staging and the declarations disagree.
 *
 * ── METHOD ──────────────────────────────────────────────────────────────────
 * DECLARED: the census of record — every `pgTable(` on a non-comment line of every
 * .ts file under shared/ (tests excluded), exactly the population and line rule of
 * scripts/ratchets/table-count.json. Each occurrence must yield a literal
 * table name; one that does not is COUNTED and fails the run, never skipped.
 * That count must equal the ratchet's `baselineCount` (748 on 2026-10-30),
 * which then dedupes to the distinct declared names (746: `conversations` and
 * `messages` are declared twice, in shared/models/chat.ts and shared/schema.ts).
 * As a cross-check, every table the `shared/schema` barrel exports (what
 * check-db-column-mirror.ts reads) must be in that set — a barrel table the
 * parse did not see means the parse is wrong, and the run fails.
 *
 * PHYSICAL: every ordinary or partitioned table in staging's `public` schema
 * (pg_class relkind r/p, partitions excluded), read SELECT-only on a staging
 * machine by the workflow and handed to this script as a file of
 * `T <name> <constraints> <triggers>` lines under a `COUNT <n>` header.
 *
 * ── TOLERANCE ───────────────────────────────────────────────────────────────
 * - Declared but physically ABSENT: tolerance 0. Each one is a table whose
 *   queries 500 on staging — the 0293 defect itself.
 * - Physically present but UNDECLARED: tolerated up to
 *   UNDECLARED_RESIDUE_TOLERANCE (21, the residue measured on staging
 *   2026-10-28). Those tables are left in place: dropping them is a separate
 *   founder / deletion-ledger decision, not this script's. Every one is listed
 *   on every run; a count above the tolerance fails. Lower the tolerance as the
 *   residue is retired — never raise it to get green.
 *
 * It also prints, SELECT-only, the newest migrations/*.sql block's tables with
 * their constraint and trigger counts, and fails if a table that file creates
 * is absent or has fewer triggers than the file creates on it.
 *
 *   npx tsx scripts/staging-schema-census.ts --physical <file>
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Undeclared physical tables tolerated on staging (measured 2026-10-28). May only shrink. */
export const UNDECLARED_RESIDUE_TOLERANCE = 21;
/** A physical read below this is not an AcreOS database (or the read was truncated). */
export const PHYSICAL_TABLE_FLOOR = 650;
/** A declaration walk below this found almost nothing — a broken census, not a clean repo. */
export const DECLARED_TABLE_FLOOR = 650;

export interface PhysicalTable {
  name: string;
  constraints: number;
  triggers: number;
}

/** Parse the `COUNT n` + `T name k g` lines the workflow captures. Throws on any malformed or truncated read. */
export function parsePhysical(text: string): PhysicalTable[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const header = lines.find((l) => l.startsWith("COUNT "));
  if (!header) throw new Error("physical read has no COUNT header — the staging query did not run");
  const expected = Number(header.slice(6));
  const rows: PhysicalTable[] = [];
  for (const line of lines) {
    if (line.startsWith("COUNT ")) continue;
    const m = /^T (\S+) (\d+) (\d+)$/.exec(line);
    if (!m) throw new Error(`physical read has an unparseable line: ${JSON.stringify(line)}`);
    rows.push({ name: m[1], constraints: Number(m[2]), triggers: Number(m[3]) });
  }
  if (!Number.isInteger(expected) || rows.length !== expected) {
    throw new Error(`physical read is truncated or corrupt: header says ${header.slice(6)} tables, ${rows.length} lines parsed`);
  }
  return rows;
}

export interface CensusVerdict {
  ok: boolean;
  missing: string[];
  undeclared: string[];
  failures: string[];
}

export function censusVerdict(
  declared: Iterable<string>,
  physical: Iterable<string>,
  undeclaredTolerance = UNDECLARED_RESIDUE_TOLERANCE,
): CensusVerdict {
  const d = new Set(declared);
  const p = new Set(physical);
  const missing = [...d].filter((t) => !p.has(t)).sort();
  const undeclared = [...p].filter((t) => !d.has(t)).sort();
  const failures: string[] = [];
  if (d.size < DECLARED_TABLE_FLOOR) failures.push(`only ${d.size} declared tables read (floor ${DECLARED_TABLE_FLOOR})`);
  if (p.size < PHYSICAL_TABLE_FLOOR) failures.push(`staging returned only ${p.size} tables (floor ${PHYSICAL_TABLE_FLOOR})`);
  if (missing.length > 0) failures.push(`${missing.length} declared table(s) absent from staging (tolerance 0)`);
  if (undeclared.length > undeclaredTolerance) {
    failures.push(`${undeclared.length} undeclared table(s) on staging, above the tolerance of ${undeclaredTolerance}`);
  }
  return { ok: failures.length === 0, missing, undeclared, failures };
}

/** Tables the newest migrations/NNNN_*.sql file creates, with the triggers it creates on each. */
export function newestMigrationBlock(dir = path.join(ROOT, "migrations")): {
  file: string;
  tables: Map<string, number>;
} {
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const file = files[files.length - 1];
  const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
  const tables = new Map<string, number>();
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/gi)) tables.set(m[1], 0);
  for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?TRIGGER \S+\s+(?:BEFORE|AFTER|INSTEAD OF)[^;]*?\bON\s+"?([a-z0-9_]+)"?/gi)) {
    if (tables.has(m[1])) tables.set(m[1], (tables.get(m[1]) ?? 0) + 1);
  }
  return { file, tables };
}

export interface DeclarationCensus {
  /** `pgTable(` occurrences on non-comment lines — the ratchet's count. */
  occurrences: number;
  /** Distinct literal table names those occurrences declare. */
  names: Set<string>;
  /** `file:line` of each occurrence that yielded no literal name. */
  unparsed: string[];
}

/** The table-count ratchet's population and line rule, with the declared name of each occurrence. */
export function declarationCensus(root = ROOT): DeclarationCensus {
  const shared = path.join(root, "shared");
  const files = (fs.readdirSync(shared, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f))
    .sort();
  const names = new Set<string>();
  const unparsed: string[] = [];
  let occurrences = 0;
  for (const rel of files) {
    const text = fs.readFileSync(path.join(shared, rel), "utf8");
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trimStart();
      if (!t.startsWith("//") && !t.startsWith("*")) {
        for (const m of line.matchAll(/pgTable\(/g)) {
          occurrences++;
          const after = text.slice(offset + (m.index ?? 0) + "pgTable(".length);
          const name = /^\s*["'`]([a-z0-9_]+)["'`]/.exec(after);
          if (name) names.add(name[1]);
          else unparsed.push(`shared/${rel}:${i + 1}`);
        }
      }
      offset += line.length + 1;
    }
  }
  return { occurrences, names, unparsed };
}

/** Tables the shared/schema barrel exports — check-db-column-mirror.ts's population. */
async function barrelTableNames(): Promise<string[]> {
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const schema = await import("../shared/schema");
  const names = new Set<string>();
  for (const value of Object.values(schema)) {
    try {
      names.add(getTableConfig(value as never).name);
    } catch {
      // not a pgTable — enums, relations, zod schemas
    }
  }
  return [...names];
}

async function main() {
  const i = process.argv.indexOf("--physical");
  const file = i > -1 ? process.argv[i + 1] : undefined;
  if (!file) {
    console.error("[census] usage: --physical <file>");
    process.exit(1);
  }
  const physical = parsePhysical(fs.readFileSync(file, "utf8"));
  const census = declarationCensus();
  const barrel = await barrelTableNames();
  const ratchet = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/ratchets/table-count.json"), "utf8"));
  const verdict = censusVerdict(census.names, physical.map((t) => t.name));

  console.log(
    `[census] declared: ${census.occurrences} pgTable( occurrence(s) across shared/ ` +
      `(ratchet baseline ${ratchet.baselineCount}) = ${census.names.size} distinct table name(s); ` +
      `shared/schema barrel exports ${barrel.length}; physical on staging: ${physical.length}`,
  );
  console.log(`[census] tolerance: declared-but-absent 0; undeclared ${UNDECLARED_RESIDUE_TOLERANCE}`);
  const fail = (msg: string) => {
    verdict.ok = false;
    verdict.failures.push(msg);
  };
  if (census.unparsed.length > 0) {
    fail(`${census.unparsed.length} pgTable( occurrence(s) have no literal table name: ${census.unparsed.join(", ")}`);
  }
  if (census.occurrences !== ratchet.baselineCount) {
    fail(`declaration census read ${census.occurrences} occurrences but the table-count ratchet says ${ratchet.baselineCount} — the census itself is in question`);
  }
  const unseen = barrel.filter((t) => !census.names.has(t));
  if (unseen.length > 0) fail(`shared/schema exports table(s) the declaration parse did not see: ${unseen.join(", ")}`);

  if (verdict.missing.length > 0) {
    console.log(`\n[census] DECLARED but ABSENT on staging (${verdict.missing.length}):`);
    for (const t of verdict.missing) console.log(`  - ${t}`);
  }
  console.log(`\n[census] on staging but UNDECLARED (${verdict.undeclared.length}; left in place — dropping is a founder/deletion-ledger decision):`);
  for (const t of verdict.undeclared) console.log(`  + ${t}`);

  const block = newestMigrationBlock();
  const byName = new Map(physical.map((t) => [t.name, t]));
  console.log(`\n[census] newest migration block ${block.file}:`);
  if (block.tables.size === 0) console.log("  (creates no table)");
  for (const [t, triggersInFile] of block.tables) {
    const row = byName.get(t);
    if (!row) {
      console.log(`  ${t}: ABSENT`);
      verdict.ok = false;
      verdict.failures.push(`${block.file} creates ${t}, which staging does not have`);
      continue;
    }
    console.log(`  ${t}: present, ${row.constraints} constraint(s), ${row.triggers} trigger(s) (file creates ${triggersInFile})`);
    if (row.triggers < triggersInFile) {
      verdict.ok = false;
      verdict.failures.push(`${t} has ${row.triggers} trigger(s) on staging; ${block.file} creates ${triggersInFile}`);
    }
  }

  if (!verdict.ok) {
    console.error(`\n::error::Staging schema census FAILED:\n  ${verdict.failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\n[census] OK — staging holds every declared table, undeclared residue within tolerance.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`::error::Staging schema census could not run: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

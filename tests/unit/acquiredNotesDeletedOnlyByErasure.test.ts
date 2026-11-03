/**
 * ACQUIRED NOTES ARE DELETED ONLY BY ORG ERASURE.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 * note_field_observations.note_id and note_events.note_id both reference
 * acquired_notes(id) ON DELETE CASCADE (pg_constraint, G11 fidelity re-run
 * 2026-11-01). The two ledgers refuse UPDATE and TRUNCATE, but a DELETE of the
 * note row silently takes the note's whole provenance and calendar history
 * with it.
 *
 * The 2026-11-03 delete-path sweep found that NO product path deletes an
 * acquired note today:
 *   - DELETE /api/notes/:id (routes-finance) and the Finance page's delete
 *     button act on the legacy integer `notes` table; a uuid id is a 400.
 *   - Settings "Clear data" (orgDataClear.clearOrganizationRecords) deletes
 *     only tables that BLOCK its roots via NO ACTION/RESTRICT; acquired_notes'
 *     FKs to properties/leads are SET NULL, so it is never in that closure.
 *     The .realdb half of this test proves that by running it.
 * The only code that reaches the cascade is org erasure (deleteOrganization,
 * D2/#412), which must stay a hard delete — total erasure including the
 * ledgers is its legal purpose.
 *
 * Tom chose soft-delete for acquired notes (2026-11-03). With no deletion
 * surface to convert, the working-session decision the same day was: no
 * schema change and no unused soft-delete service — only this guard. When a
 * product deletion of an acquired note is built, it must be a soft delete;
 * this test is what makes a hard one fail first.
 *
 * ── WHAT IT FORBIDS, AND WHERE ───────────────────────────────────────────
 * Every non-test source file under the roots below (TS/JS/MJS/SQL; comments
 * stripped with the repo's shared strippers — stripComments for code,
 * stripSqlComments for .sql):
 *   1. a literal SQL DELETE FROM / TRUNCATE naming acquired_notes;
 *   2. a Drizzle `.delete(<acquiredNotes>)`, including import / const aliases
 *      and `schema.acquiredNotes`;
 *   3. deleting an `organizations` row (SQL or Drizzle) — the parent FK
 *      cascades into acquired_notes — outside ORG_ROW_DELETERS;
 *   4. TRUNCATE … CASCADE outside TRUNCATE_CASCADE_SITES;
 *   5. a DELETE FROM / TRUNCATE whose table name is not a literal (an
 *      interpolation, a concatenation, %I) outside DYNAMIC_DELETERS — each
 *      registered one states why it cannot reach acquired_notes, and the ones
 *      whose table set is a literal list in the file must never name it.
 * Every register entry must still be DETECTED by the scanner in its file, so a
 * scanner that silently stops reading a shape — or an exemption that outlives
 * its code — goes red rather than green.
 *
 * ── WHAT IT DOES NOT SEE (stated, not hidden) ────────────────────────────
 * A Drizzle `.delete(t)` where `t` comes out of an array that holds
 * acquiredNotes is not resolved. No such site exists today (sweep 2026-11-03).
 * Test code (tests/, *.test.*) is outside the population: fixture teardown is
 * not a product path.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { stripSqlComments } from "../helpers/stripSqlComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const REPO = join(__dirname, "..", "..");

/** The population: every directory server-side code or DDL lives in. */
const ROOTS = ["server", "shared", "scripts", "packages", "apps", "migrations"] as const;
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|sql)$/;
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".turbo", "tests", "__tests__"]);
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;

/**
 * Floors, measured 2026-11-03: 2,318 files — server 1,571, shared 281, scripts 164,
 * packages 1, apps 4, migrations 297. A walk that reads far fewer has gone blind.
 */
const MIN_FILES = 2200;
const MIN_FILES_PER_ROOT: Record<(typeof ROOTS)[number], number> = {
  server: 1500,
  shared: 260,
  scripts: 150,
  packages: 1,
  apps: 4,
  migrations: 290,
};

/** The only code allowed to delete an `organizations` row (which cascades into acquired_notes). */
const ORG_ROW_DELETERS: Record<string, string> = {
  "server/services/orgDeletion.ts":
    "Org erasure (D2/#412). Must stay a hard delete: total erasure including the note ledgers is its legal purpose.",
  "scripts/seed-test-borrower.mjs":
    "Dev fixture teardown: removes only the fixed test-borrower fixture org, selected by its slug.",
  "scripts/founder-autonomy/reset-cohort.ts":
    "Simulation teardown: only sim-* orgs with settings.simulationMode; refuses to run without SIMULATION_MODE=true.",
};

/** The only TRUNCATE … CASCADE allowed (it would empty every referencing table). */
const TRUNCATE_CASCADE_SITES: Record<string, string> = {
  "migrations/0020_clerk_migration.sql":
    "Base-layer migration: migrations/*.sql run only in an empty-database build, where 0020 precedes 0073 (which creates acquired_notes); deploys run scripts/migrate.mjs and staging runs migrate.mjs --ddl-only. Also guarded on no Clerk users existing.",
};

/**
 * DELETE/TRUNCATE sites whose table name is computed. `literalTables: true`
 * means the file's own literal list is the whole table set, so the file must
 * never name acquired_notes / acquiredNotes at all.
 */
const DYNAMIC_DELETERS: Record<string, { reason: string; literalTables: boolean }> = {
  "server/services/orgDeletion.ts": {
    reason: "Org erasure: tenant-key sweep over every org-scoped table, acquired_notes included, by design.",
    literalTables: false,
  },
  "server/services/orgDataClear.ts": {
    reason:
      "Settings 'Clear data': closure of NO ACTION/RESTRICT blockers of CLEAR_ROOT_TABLES. acquired_notes' FKs to properties/leads are SET NULL, so it is outside the closure — proven by acquiredNotesDeletedOnlyByErasure.realdb.test.ts.",
    literalTables: false,
  },
  "server/jobs/dataRetention.ts": { reason: "Retention rules are a literal table list in the file.", literalTables: true },
  "server/jobs/archival.ts": { reason: "ARCHIVAL_TABLES is a literal table list in the file.", literalTables: true },
  "scripts/data/delete-orphan-photo-and-vision-rows.ts": {
    reason: "One-off cleanup over a literal table list in the file.",
    literalTables: true,
  },
};

type Kind = "sql-delete-acquired-notes" | "drizzle-delete-acquired-notes" | "org-row-delete" | "truncate-cascade" | "dynamic-delete";
interface Finding {
  kind: Kind;
  excerpt: string;
}

const Q = `["\`]?`; // an optional identifier quote (or a template backtick around the name)
const SCHEMA = `(?:${Q}public${Q}\\s*\\.\\s*)?`;
const DELETE_VERB = `(?:DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+(?:ONLY\\s+)?`;
const SQL_DELETE_NOTES = new RegExp(`\\b${DELETE_VERB}${SCHEMA}${Q}acquired_notes${Q}(?![\\w])`, "gi");
/** A TRUNCATE statement's table list: identifiers (optionally quoted / schema-qualified) separated by commas. */
const TRUNCATE_HEAD = `\\bTRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?`;
const TABLE_NAME = `[\\w."\`]+`;
const SQL_TRUNCATE_LIST_NOTES = new RegExp(`${TRUNCATE_HEAD}(?:${TABLE_NAME}\\s*,\\s*)+${SCHEMA}${Q}acquired_notes${Q}(?![\\w])`, "gi");
const SQL_DELETE_ORGS = new RegExp(`\\b${DELETE_VERB}${SCHEMA}${Q}organizations${Q}(?![\\w])`, "gi");
const SQL_TRUNCATE_CASCADE = new RegExp(
  `${TRUNCATE_HEAD}${TABLE_NAME}(?:\\s*,\\s*${TABLE_NAME})*(?:\\s+(?:RESTART|CONTINUE)\\s+IDENTITY)?\\s+CASCADE\\b`,
  "gi",
);
/** Table name is not a literal: `${…}`, a closing quote then `+` / `||`, or a format placeholder. */
const SQL_DYNAMIC_DELETE = new RegExp(`\\b${DELETE_VERB}(?:["\`]?\\$\\{|["'\`]\\s*(?:\\+|\\|\\|)|%[IsL]\\b)`, "gi");
const DRIZZLE_DELETE = /\.delete\(\s*([^()]*?)\s*\)/g;

function aliasesOf(src: string, symbol: string): Set<string> {
  const names = new Set([symbol]);
  for (const m of src.matchAll(new RegExp(`\\b${symbol}\\s+as\\s+(\\w+)`, "g"))) names.add(m[1]);
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*(?::[^=;]+)?=\\s*(?:[\\w$]+\\.)*${symbol}\\b(?![\\w(])`, "g"))) {
    names.add(m[1]);
  }
  return names;
}

function drizzleDeletesOf(src: string, symbol: string): string[] {
  const names = aliasesOf(src, symbol);
  const hits: string[] = [];
  for (const m of src.matchAll(DRIZZLE_DELETE)) {
    const arg = m[1];
    const last = arg.split(".").pop()?.trim() ?? "";
    if (names.has(last) || new RegExp(`\\[\\s*["'\`]${symbol}["'\`]\\s*\\]`).test(arg)) hits.push(m[0]);
  }
  return hits;
}

/** Every finding in one (comment-stripped) source text. Exported shape is exercised by the canaries below. */
function scanSource(code: string): Finding[] {
  const out: Finding[] = [];
  const push = (kind: Kind, re: RegExp) => {
    for (const m of code.matchAll(re)) out.push({ kind, excerpt: m[0].slice(0, 120) });
  };
  push("sql-delete-acquired-notes", SQL_DELETE_NOTES);
  push("sql-delete-acquired-notes", SQL_TRUNCATE_LIST_NOTES);
  for (const e of drizzleDeletesOf(code, "acquiredNotes")) out.push({ kind: "drizzle-delete-acquired-notes", excerpt: e });
  push("org-row-delete", SQL_DELETE_ORGS);
  for (const e of drizzleDeletesOf(code, "organizations")) out.push({ kind: "org-row-delete", excerpt: e });
  push("truncate-cascade", SQL_TRUNCATE_CASCADE);
  push("dynamic-delete", SQL_DYNAMIC_DELETE);
  return out;
}

function stripFor(path: string, src: string): string {
  return path.endsWith(".sql") ? stripSqlComments(src) : stripComments(src);
}

function walk(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (SOURCE_EXT.test(name) && !TEST_FILE.test(name)) acc.push(full);
  }
}

interface FileScan {
  file: string;
  code: string;
  findings: Finding[];
}

let cached: FileScan[] | null = null;
function scanRepo(): FileScan[] {
  if (cached) return cached;
  const files: string[] = [];
  for (const root of ROOTS) walk(join(REPO, root), files);
  cached = files.map((full) => {
    const file = relative(REPO, full).split("\\").join("/");
    const code = stripFor(file, readFileSync(full, "utf8"));
    return { file, code, findings: scanSource(code) };
  });
  return cached;
}

describe("the scanner catches every shape it relies on (canaries)", () => {
  const kinds = (code: string) => scanSource(code).map((f) => f.kind);

  it.each([
    ["DELETE FROM acquired_notes WHERE id = $1", "sql-delete-acquired-notes"],
    ['await db.execute(sql`DELETE FROM "acquired_notes" WHERE id = ${id}`)', "sql-delete-acquired-notes"],
    ["delete from public.acquired_notes where true", "sql-delete-acquired-notes"],
    ['DELETE FROM "public"."acquired_notes"', "sql-delete-acquired-notes"],
    ["TRUNCATE acquired_notes", "sql-delete-acquired-notes"],
    ["TRUNCATE TABLE note_payments, acquired_notes", "sql-delete-acquired-notes"],
    ["await db.delete(acquiredNotes).where(eq(acquiredNotes.id, id))", "drizzle-delete-acquired-notes"],
    ["await tx.delete(schema.acquiredNotes).where(x)", "drizzle-delete-acquired-notes"],
    ['import { acquiredNotes as an } from "@shared/schema";\nawait db.delete(an).where(x);', "drizzle-delete-acquired-notes"],
    ["const t = acquiredNotes;\nawait db.delete(t);", "drizzle-delete-acquired-notes"],
    ['await db.delete(schema["acquiredNotes"])', "drizzle-delete-acquired-notes"],
    ["DELETE FROM organizations WHERE id = $1", "org-row-delete"],
    ["await db.delete(organizations).where(eq(organizations.id, id))", "org-row-delete"],
    ["TRUNCATE TABLE users CASCADE", "truncate-cascade"],
    ['TRUNCATE "a", public.b RESTART IDENTITY CASCADE', "truncate-cascade"],
    ['sql.raw(`DELETE FROM "${table}" WHERE x`)', "dynamic-delete"],
    ["sql.raw(`DELETE FROM ${ident(t)} WHERE x`)", "dynamic-delete"],
    ['client.query("DELETE FROM " + table)', "dynamic-delete"],
    ["EXECUTE 'DELETE FROM ' || tbl", "dynamic-delete"],
    ["EXECUTE format('DELETE FROM %I WHERE x', t)", "dynamic-delete"],
  ] as const)("flags %s", (code, kind) => {
    expect(kinds(code)).toContain(kind);
  });

  it.each([
    "note_id uuid NOT NULL REFERENCES acquired_notes(id) ON DELETE CASCADE",
    "await db.select().from(acquiredNotes).where(x)",
    "await db.delete(noteOwnershipSplits).where(x)",
    "remaining.delete(table)",
    "DELETE FROM acquired_notes_archive WHERE x",
    "DELETE FROM note_events WHERE note_id = $1",
    "DELETE FROM organizations_settings WHERE x",
    // migrate.mjs trigger text: TRUNCATE as a word, not a statement, later followed by an FK's CASCADE.
    "RAISE EXCEPTION '% is append-only (UPDATE/DELETE/TRUNCATE denied)', TG_TABLE_NAME;\n\"note_id\" uuid REFERENCES \"acquired_notes\"(\"id\") ON DELETE CASCADE",
    'CREATE TRIGGER note_events_no_truncate BEFORE TRUNCATE ON "note_events"',
  ])("does not flag %s", (code) => {
    expect(scanSource(code)).toEqual([]);
  });

  it("strips comments before matching — a comment naming the forbidden statement is not the statement", () => {
    expect(scanSource(stripComments("// we never DELETE FROM acquired_notes here\nconst x = 1;"))).toEqual([]);
    expect(scanSource(stripSqlComments("-- DELETE FROM acquired_notes\nSELECT 1;"))).toEqual([]);
    // …and a live statement after an apostrophe-bearing comment is still read.
    expect(kinds(stripComments("// the note's ledger\nawait db.delete(acquiredNotes);"))).toContain("drizzle-delete-acquired-notes");
  });
});

describe("acquired notes are deleted only by org erasure — repo population", () => {
  it("reads the whole population (vacuity floors)", () => {
    const scans = scanRepo();
    expect(scans.length).toBeGreaterThanOrEqual(MIN_FILES);
    for (const root of ROOTS) {
      const n = scans.filter((s) => s.file.startsWith(`${root}/`)).length;
      expect(n, `files read under ${root}/`).toBeGreaterThanOrEqual(MIN_FILES_PER_ROOT[root]);
    }
    // The files whose shapes this test exists for are actually in the population.
    for (const f of [...Object.keys(ORG_ROW_DELETERS), ...Object.keys(DYNAMIC_DELETERS), ...Object.keys(TRUNCATE_CASCADE_SITES)]) {
      expect(scans.some((s) => s.file === f), `${f} is in the scanned population`).toBe(true);
    }
  });

  it("no code deletes or truncates acquired_notes directly (SQL or Drizzle)", () => {
    const offenders = scanRepo().flatMap((s) =>
      s.findings
        .filter((f) => f.kind === "sql-delete-acquired-notes" || f.kind === "drizzle-delete-acquired-notes")
        .map((f) => `${s.file}: ${f.excerpt}`),
    );
    expect(
      offenders,
      "A hard delete of an acquired note cascades away its note_field_observations and note_events. Product deletion of an acquired note must be a soft delete (Tom, 2026-11-03).",
    ).toEqual([]);
  });

  it("only registered code deletes an organizations row (its FK cascades into acquired_notes)", () => {
    const deleters = scanRepo().filter((s) => s.findings.some((f) => f.kind === "org-row-delete"));
    const unregistered = deleters.map((s) => s.file).filter((f) => !(f in ORG_ROW_DELETERS));
    expect(unregistered, "deleting an org row cascades into acquired_notes and both note ledgers").toEqual([]);
    // No stale exemption: each registered deleter is still detected where it is registered.
    for (const f of Object.keys(ORG_ROW_DELETERS)) {
      expect(deleters.some((s) => s.file === f), `${f} still deletes an org row (else remove it from ORG_ROW_DELETERS)`).toBe(true);
    }
  });

  it("only registered sites TRUNCATE … CASCADE", () => {
    const sites = scanRepo().filter((s) => s.findings.some((f) => f.kind === "truncate-cascade"));
    expect(sites.map((s) => s.file).filter((f) => !(f in TRUNCATE_CASCADE_SITES))).toEqual([]);
    for (const f of Object.keys(TRUNCATE_CASCADE_SITES)) expect(sites.some((s) => s.file === f), f).toBe(true);
  });

  it("only registered code deletes from a computed table name, and literal-list deleters never name acquired_notes", () => {
    const sites = scanRepo().filter((s) => s.findings.some((f) => f.kind === "dynamic-delete"));
    const unregistered = sites
      .filter((s) => !(s.file in DYNAMIC_DELETERS))
      .map((s) => `${s.file}: ${s.findings.find((f) => f.kind === "dynamic-delete")?.excerpt}`);
    expect(unregistered, "a computed-table DELETE could reach acquired_notes; register it with why it cannot").toEqual([]);
    for (const [f, { literalTables }] of Object.entries(DYNAMIC_DELETERS)) {
      const scan = sites.find((s) => s.file === f);
      expect(scan, `${f} still deletes from a computed table name (else remove it from DYNAMIC_DELETERS)`).toBeDefined();
      if (literalTables) {
        expect(/acquired_notes|acquiredNotes/.test(scan!.code), `${f}'s literal table list must not include acquired_notes`).toBe(false);
      }
    }
  });

  it("the Settings 'Clear data' roots do not include acquired_notes", () => {
    const scan = scanRepo().find((s) => s.file === "server/services/orgDataClear.ts")!;
    const roots = scan.code.match(/CLEAR_ROOT_TABLES\s*=\s*\[([^\]]*)\]/);
    expect(roots, "CLEAR_ROOT_TABLES literal located").not.toBeNull();
    const names = [...roots![1].matchAll(/["'`](\w+)["'`]/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("acquired_notes");
  });
});

/**
 * A column named inside a raw `sql` fragment must exist on the table it runs against.
 *
 * `sql\`…\`` is the one hatch that leaves Drizzle's type system entirely. Inside
 * it a column is just text: `tsc` sees a template literal, the ghost-field lint
 * sees no property access, and the query is only wrong at runtime — where a
 * `try/catch` or `Promise.allSettled` usually turns "this statement cannot run"
 * into a plausible number.
 *
 * FOUR LIVE DEFECTS, all found by writing this, all invisible to every other
 * gate in the repo:
 *
 *   agentDataResolvers (×2)   `sql\`status_code >= 500\`` and `>= 400` over
 *                             `api_usage_logs`, which records service / action /
 *                             count / cost and has no status column. Every run
 *                             threw; `Promise.allSettled` swallowed it and the
 *                             `: 0` fallback told the agent ZERO SERVER ERRORS
 *                             IN 24 HOURS. It also meant the one alarm reading
 *                             that value (`apiErrorsLast24h > 10`) could never
 *                             fire.
 *
 *   referralReward (×3)       `SELECT id FROM users WHERE organization_id = …`,
 *                             `JOIN users u ON u.organization_id = o.id`, and
 *                             `SELECT organization_id FROM users WHERE id = …`.
 *                             A user's org lives in `team_members`; `users` has
 *                             no `organization_id`. So the referee credit, the
 *                             maturity conversion and the referrer credit all
 *                             threw into their catches — a reward program with
 *                             $49 a side, $98 annual and $100/$250 milestones
 *                             that had never once paid out.
 *
 *   routes-deal-rooms         the same ghost, so referral attribution on every
 *                             shared deal room read as "no code" rather than
 *                             "the lookup failed".
 *
 * ── WHAT THIS HAD TO GET RIGHT ──────────────────────────────────────────────
 *
 * THE UNIT IS THE OUTERMOST TEMPLATE. Fragments nest:
 * `sql\`… WHERE (${cond ? sql\`TRUE\` : sql\`(enrichment_status IS NULL)\`})\``.
 * Read as three separate templates, the inner two lose the `FROM properties`
 * that gives their columns meaning — and the first draft duly reported both as
 * ghosts on whatever table it found earlier in the file. They were fine.
 *
 * COMMENTS ARE STRIPPED, because the fix for a ghost column leaves a comment
 * NAMING the ghost — this file's own header does it seven times. A scan that
 * reads its own documentation as the defect is the failure mode CLAUDE.md
 * records, and the probe that found these defects hit it on its first run.
 *
 * UNRESOLVED IS COUNTED, NOT SKIPPED. A template whose table cannot be found
 * (a `pg_stat_*` system view, a CTE, a bare `db.execute` with no Drizzle chain)
 * is not a pass — it is a template this test did not read, and the count is
 * asserted so the readable population cannot quietly shrink to nothing.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
/**
 * THE POPULATION, and why it is three roots rather than one.
 *
 * This started as `server/` alone, and on 2026-09-05 that omission cost three
 * red CI workflows. `scripts/seed-test-borrower.mjs` inserted into a `stage`
 * column that `leads` does not have; the statement threw, the borrower-cookie
 * E2E could not seed, and the workflow had been red for it. A gate that reads
 * only production code proves nothing about the fixtures CI runs FIRST — and a
 * fixture that cannot run takes every test behind it with it.
 */
const ROOTS = ["server", "scripts", "tests"].map((d) => path.join(ROOT, d));

/** Baselines, measured 2026-09-05. Down-only for ghosts; floors for population. */
const MAX_GHOSTS = 0;
// 69 → 70 (2026-09-28, DEFECT-0151): the quoted-identifier arm widened the
// population, admitting sophiePrivacyGuard.meetsKAnonymity's
// `COUNT(DISTINCT "orgHash") FROM sophie_cross_org_learnings` — a table the
// schema does not model. It has no callers and fails closed (catch → false);
// it is not newly unread code, it is newly READ code this gate cannot resolve.
// 70 → 69 (2026-09-29, ruling #11): that query is gone — sophiePrivacyGuard's
// k-anonymity check and purge were rewritten, consent now read at publication.
// 69 → 49 (2026-10-07): TABLE_REF read `DO UPDATE SET` and `FOR UPDATE SKIP
// LOCKED` as table references to tables named `set` and `skip`, so every raw
// upsert and every row-locking claim query was counted unresolved and never
// read. Twenty templates entered the readable population; one held a real
// ghost (`organization_integrations.is_active` — the column is `is_enabled`).
// The column name is corrected in server/routes-platform-features.ts in the
// same change. Those two upserts still fail at runtime: their conflict target
// (organization_id, provider) has no unique index in a database built from
// this repository. That is a separate defect, tracked in the ON CONFLICT
// ratchet on the payments-transaction-id-constraint branch, not fixed here.
const MAX_UNRESOLVED = 49;
const MIN_TEMPLATES = 800;
const MIN_WITH_COLUMNS = 150;

/** Identifiers that look like columns but are not: Postgres settings, CTE names. */
const NOT_COLUMNS = new Set(["session_replication_role", "search_path", "statement_timeout"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(ts|mjs|js)$/.test(f) && !f.endsWith(".d.ts")) out.push(f);
  }
  return out;
}

/**
 * Outermost `sql` templates. A nested template inside `${…}` is part of its
 * parent's query, not a query of its own.
 */
function outermostSqlTemplates(src: string) {
  const out: Array<{ start: number; text: string }> = [];
  // `sql` tagged templates AND raw templates handed to a driver's query()/
  // execute(). The second is not a footnote: EVERY database fixture in
  // scripts/ and tests/ is `client.query(`INSERT INTO …`)`, so a gate that
  // reads only the `sql` tag scans production code and none of the seeds CI
  // runs before it. That is how `INSERT INTO leads (… stage)` — a column
  // `leads` does not have — sat in a seeded workflow uncaught.
  const re = /\b(?:sql(?:\.raw)?|\.\s*(?:query|execute|unsafe))\s*\(?\s*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let i = open + 1, depth = 0, closed = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "$" && src[i + 1] === "{") { depth++; i += 2; continue; }
      if (c === "}" && depth > 0) { depth--; i++; continue; }
      if (c === "`" && depth === 0) { closed = i; break; }
      i++;
    }
    if (closed < 0) continue;
    out.push({ start: m.index, text: src.slice(open + 1, closed) });
    re.lastIndex = closed + 1;
  }
  return out;
}

const BARE = /(?<![$.\w"])\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b\s*(?:>=|<=|>|<|=|!=|\bIS\b)/gi;
const QUALIFIED = /\b([a-z][a-z0-9_]*)\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/gi;
/**
 * `INSERT INTO <table> (col, col, …)`.
 *
 * A column list is NOT a comparison, so `BARE` — which requires an operator
 * after the identifier — never sees it. That is the shape every database
 * fixture is written in, and the shape the defect that prompted this arm took:
 * `INSERT INTO leads (… , stage)` against a table with no `stage` column. The
 * first draft of this gate went green on that mutation, which is the only
 * reason the gap is known.
 */
const INSERT_COLUMNS = /\binsert\s+into\s+"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)/gi;
/**
 * `FROM organizations o`, `JOIN users u ON …`, `UPDATE referrals SET …`.
 *
 * `UPDATE` is a table reference only as a statement. Two clauses spell the same
 * keyword without naming a table after it, and until 2026-10-07 both were read
 * as one:
 *
 *   · an upsert's `ON CONFLICT (…) DO UPDATE SET col = …` captured `SET` as the
 *     table, which no schema declares — so every raw upsert counted as
 *     unresolved and none of its columns were ever checked;
 *   · a row lock, `FOR UPDATE SKIP LOCKED` / `FOR NO KEY UPDATE`, captured
 *     `SKIP` the same way, taking every claim-queue read with it.
 *
 * `JOIN LATERAL` names a subquery or set-returning function, not a table; the
 * subquery's own FROM is read where it occurs.
 */
const TABLE_REF = /\b(?:from|join|into|(?<!\b(?:do|for|key)\s+)update)\s+(?!lateral\b|set\b|skip\b|nowait\b|of\b)"?([a-z_][a-z0-9_]*)"?(?:\s+(?:as\s+)?(?!on\b|set\b|where\b|values\b|select\b|using\b)([a-z][a-z0-9_]*))?/gi;
/** `ON CONFLICT … DO UPDATE SET` — the assignments that follow belong to the INSERT's table. */
const UPSERT_SET = /\bdo\s+update\s+set\b/gi;

/**
 * The column names assigned in an upsert's `DO UPDATE SET a = …, "b" = …` list.
 * Split at depth-0 commas so `COALESCE(x, y)` on a right-hand side is one
 * assignment; stops at the clause's own WHERE / RETURNING.
 */
function upsertAssignedColumns(lit: string): string[] {
  const out: string[] = [];
  for (const m of lit.matchAll(UPSERT_SET)) {
    let i = (m.index ?? 0) + m[0].length;
    let depth = 0, start = i;
    const parts: string[] = [];
    while (i <= lit.length) {
      const c = lit[i];
      if (i === lit.length || (depth === 0 && /^\s(?:where|returning)\b/i.test(lit.slice(i, i + 11)))) {
        parts.push(lit.slice(start, i));
        break;
      }
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) { parts.push(lit.slice(start, i)); break; } depth--; }
      else if (c === "," && depth === 0) { parts.push(lit.slice(start, i)); start = i + 1; }
      i++;
    }
    for (const part of parts) {
      const a = /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=/.exec(part);
      if (a) out.push(a[1]);
    }
  }
  return out;
}
const CHAIN = /(?:\.from\(\s*([A-Za-z_$][\w$]*)|\b(?:db|tx)\.(?:update|insert|delete)\(\s*([A-Za-z_$][\w$]*)|\b(?:db|tx)\.query\.([A-Za-z_$][\w$]*))/g;

const byIdent = new Map<string, Set<string>>();
const bySqlName = new Map<string, Set<string>>();
for (const [name, v] of Object.entries(schema as Record<string, unknown>)) {
  if (v && is(v, PgTable)) {
    const columns = getTableColumns(v) as Record<string, { name: string }>;
    const cols = new Set(Object.values(columns).map((c) => c.name));
    byIdent.set(name, cols);
    const sqlName = (v as unknown as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] as
      | string
      | undefined;
    if (sqlName) bySqlName.set(sqlName, cols);
  }
}

interface Finding { file: string; column: string; where: string }

interface ScanResult { templates: number; withColumns: number; unresolved: number; ghosts: Finding[] }

function scan(): ScanResult {
  const acc: ScanResult = { templates: 0, withColumns: 0, unresolved: 0, ghosts: [] };
  for (const f of ROOTS.flatMap((r) => walk(r))) {
    scanSource(stripComments(fs.readFileSync(f, "utf8")), path.relative(ROOT, f), acc);
  }
  return acc;
}

/** One (comment-stripped) source file. Exported shape for the canaries below. */
function scanSource(src: string, rel: string, acc: ScanResult): ScanResult {
  const ghosts = acc.ghosts;
  {
    for (const t of outermostSqlTemplates(src)) {
      acc.templates++;
      const lit = t.text.replace(/\$\{[^{}]*\}/g, " @ ");

      const bare = [...new Set([...lit.matchAll(BARE)].map((b) => b[1].toLowerCase()))]
        .filter((n) => !NOT_COLUMNS.has(n));
      const qualified = [...lit.matchAll(QUALIFIED)]
        .map((q) => [q[1].toLowerCase(), q[2].toLowerCase()] as const);
      // Column lists resolve against the table the INSERT names, directly —
      // never the union, since an INSERT touches exactly one table.
      const inserted: Array<readonly [string, string]> = [];
      for (const ins of lit.matchAll(INSERT_COLUMNS)) {
        const table = ins[1].toLowerCase();
        for (const raw of ins[2].split(",")) {
          const col = raw.trim().replace(/^"|"$/g, "").toLowerCase();
          if (/^[a-z][a-z0-9_]*$/.test(col)) inserted.push([table, col] as const);
        }
      }
      // QUOTED camelCase identifiers. `BARE` requires snake_case, so
      // `WHERE "organizationId" = …` and `"firstName" ILIKE …` — the ORM's
      // property names, not the columns — were outside this gate entirely. The
      // ⌘K search fallback queried exactly those and threw on every call
      // (DEFECT-0151). SQL string literals are blanked first (a JSON key in
      // '{"simulationMode": true}' is data), and an alias the template defines
      // (`AS "firstName"`) is a name it may reuse, not a column.
      const noStrings = lit.replace(/'(?:[^']|'')*'/g, "''");
      const definedAliases = new Set([...noStrings.matchAll(/\bAS\s+"([A-Za-z_][A-Za-z0-9_]*)"/gi)].map((a) => a[1]));
      const quoted = [...noStrings.matchAll(/(?<!\bAS\s{0,4})"([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)"/g)]
        .map((q) => q[1])
        .filter((n) => !definedAliases.has(n));
      // An upsert's `DO UPDATE SET` targets are the INSERT's columns, and
      // `EXCLUDED.col` is the row the INSERT proposed. Both resolve against the
      // one table the INSERT names — never the union, since an INSERT that
      // also SELECTs from other tables still writes only its own.
      const insertTables = [...new Set([...lit.matchAll(/\binsert\s+into\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase()))];
      const upsertTable = insertTables.length === 1 ? insertTables[0] : null;
      const upserted = upsertTable ? upsertAssignedColumns(lit).map((c) => [upsertTable, c.toLowerCase()] as const) : [];
      if (!bare.length && !qualified.length && !inserted.length && !quoted.length && !upserted.length) continue;
      acc.withColumns++;

      // Tables named by the template itself, with their aliases.
      const aliases = new Map<string, Set<string>>();
      const named: Array<Set<string>> = [];
      let anyUnknown = false;
      const refs = [...lit.matchAll(TABLE_REF)];
      for (const r of refs) {
        const cols = bySqlName.get(r[1].toLowerCase());
        if (!cols) { anyUnknown = true; continue; }
        named.push(cols);
        aliases.set(r[1].toLowerCase(), cols);
        if (r[2]) aliases.set(r[2].toLowerCase(), cols);
      }

      let union: Set<string> | null = null;
      if (refs.length) {
        if (anyUnknown) { acc.unresolved++; continue; }
        union = new Set(named.flatMap((s) => [...s]));
      } else {
        // Spliced into a Drizzle chain — resolve against the chain's table,
        // searched only within the enclosing statement.
        const from = Math.max(
          src.lastIndexOf(";", t.start), src.lastIndexOf("{", t.start), src.lastIndexOf("}", t.start),
        );
        let ident: string | undefined;
        for (const c of src.slice(from + 1, t.start).matchAll(CHAIN)) {
          ident = c[1] ?? c[2] ?? c[3];
        }
        if (!ident || !byIdent.has(ident)) { acc.unresolved++; continue; }
        union = byIdent.get(ident)!;
        aliases.set("", union);
      }

      if (upsertTable && bySqlName.has(upsertTable)) aliases.set("excluded", bySqlName.get(upsertTable)!);
      const excerpt = lit.split("\n").join(" ").replace(/\s+/g, " ").trim().slice(0, 70);
      for (const n of quoted) {
        if (!union.has(n)) ghosts.push({ file: rel, column: `"${n}"`, where: excerpt });
      }
      for (const n of bare) {
        if (!union.has(n)) ghosts.push({ file: rel, column: n, where: excerpt });
      }
      for (const [table, col] of inserted) {
        const cols = bySqlName.get(table);
        if (!cols) continue; // not a table this schema declares
        if (!cols.has(col)) {
          ghosts.push({ file: rel, column: `${table}.${col}`, where: excerpt });
        }
      }
      // A qualified reference resolves against ITS OWN table, which is what a
      // union over joined tables hides: `u.organization_id` passed while
      // `organizations` had the column and `users` did not.
      for (const [alias, col] of qualified) {
        const cols = aliases.get(alias);
        if (!cols) continue; // alias from a CTE or subquery — not resolvable here
        if (!cols.has(col)) ghosts.push({ file: rel, column: `${alias}.${col}`, where: excerpt });
      }
      for (const [table, col] of upserted) {
        const cols = bySqlName.get(table);
        if (!cols) continue;
        if (!cols.has(col)) ghosts.push({ file: rel, column: `${table}.${col}`, where: excerpt });
      }
    }
  }
  return acc;
}

describe("raw SQL fragments name columns that exist", () => {
  const result = scan();

  it("read the raw-SQL population (vacuity floors)", () => {
    // If an extractor silently stops matching, zero ghosts is what that looks
    // like — so the population it walked is asserted, not assumed.
    expect(result.templates).toBeGreaterThanOrEqual(MIN_TEMPLATES);
    expect(result.withColumns).toBeGreaterThanOrEqual(MIN_WITH_COLUMNS);
  });

  it("names no column that does not exist on the table it queries", () => {
    const lines = result.ghosts.map((g) => `  ${g.file}  ${g.column}  ::  ${g.where}`);
    expect(lines.join("\n") || "(none)").toBe("(none)");
    expect(result.ghosts.length).toBeLessThanOrEqual(MAX_GHOSTS);
  });

  it("holds the count of templates whose table could not be resolved", () => {
    // NOT a pass list — these are templates this test did not read (system
    // views, CTEs, bare db.execute with no chain). The number is held so the
    // unreadable share cannot grow quietly — and, since it is a ratchet, it
    // cannot sit above the measured count either: a stale-high ceiling is
    // headroom for templates to stop being read without anything going red.
    expect(result.unresolved).toBeLessThanOrEqual(MAX_UNRESOLVED);
    expect(
      result.unresolved,
      `the unresolved count fell to ${result.unresolved}; lower MAX_UNRESOLVED to it in the same change`,
    ).toBe(MAX_UNRESOLVED);
  });
});

/**
 * Canaries, one per statement shape the resolver relies on. Each hides a ghost
 * column inside the shape and asserts the scan both RESOLVES the template (it
 * is read, not counted unresolved) and REPORTS the ghost. The tagged template
 * is assembled at runtime so this file's own fixtures are not part of the
 * repository population the real scan reads.
 */
describe("raw SQL resolver canaries", () => {
  const tagged = (body: string) => "const q = " + "sq" + "l`" + body + "`;";
  const run = (body: string) =>
    scanSource(tagged(body), "fixture.ts", { templates: 0, withColumns: 0, unresolved: 0, ghosts: [] });

  it("an upsert's DO UPDATE SET resolves to the INSERT's table", () => {
    const r = run(
      "INSERT INTO organization_integrations (organization_id, provider) VALUES (1, 'x') " +
        "ON CONFLICT (organization_id, provider) DO UPDATE SET is_active = true",
    );
    expect(r.unresolved, "the upsert was counted unresolved — DO UPDATE read as a table reference").toBe(0);
    expect(r.ghosts.map((g) => g.column)).toContain("organization_integrations.is_active");
  });

  it("an upsert's INSERT column list is checked, not skipped with the template", () => {
    const r = run(
      "INSERT INTO organization_integrations (organization_id, provider, is_active) VALUES (1, 'x', true) " +
        "ON CONFLICT (organization_id, provider) DO UPDATE SET credentials = EXCLUDED.credentials",
    );
    expect(r.unresolved).toBe(0);
    expect(r.ghosts.map((g) => g.column)).toEqual(["organization_integrations.is_active"]);
  });

  it("EXCLUDED.<col> resolves against the INSERT's table", () => {
    const r = run(
      "INSERT INTO organization_integrations (organization_id, provider) VALUES (1, 'x') " +
        "ON CONFLICT (organization_id, provider) DO UPDATE SET settings = EXCLUDED.validation_errs",
    );
    expect(r.unresolved).toBe(0);
    expect(r.ghosts.map((g) => g.column)).toContain("excluded.validation_errs");
  });

  it("a clean upsert reads clean", () => {
    const r = run(
      "INSERT INTO organization_integrations (organization_id, provider, is_enabled) VALUES (1, 'x', true) " +
        "ON CONFLICT (organization_id, provider) DO UPDATE SET credentials = COALESCE(EXCLUDED.credentials, '{}'), " +
        "is_enabled = true, last_validated_at = NOW() WHERE organization_integrations.is_enabled = false",
    );
    expect(r).toMatchObject({ templates: 1, withColumns: 1, unresolved: 0 });
    expect(r.ghosts).toEqual([]);
  });

  it("FOR UPDATE SKIP LOCKED is a row lock, not a table reference", () => {
    const r = run("SELECT id FROM leads WHERE ghost_status_col = 'new' FOR UPDATE SKIP LOCKED");
    expect(r.unresolved).toBe(0);
    expect(r.ghosts.map((g) => g.column)).toContain("ghost_status_col");
  });

  it("a statement UPDATE is still a table reference", () => {
    const r = run("UPDATE leads SET status = 'x' WHERE ghost_status_col = 1");
    expect(r.unresolved).toBe(0);
    expect(r.ghosts.map((g) => g.column)).toContain("ghost_status_col");
  });

  it("an unknown table is still counted unresolved, never passed", () => {
    const r = run("SELECT 1 FROM not_a_declared_table WHERE some_col = 1");
    expect(r.unresolved).toBe(1);
    expect(r.ghosts).toEqual([]);
  });
});

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
const MAX_UNRESOLVED = 69;
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
/** `FROM organizations o`, `JOIN users u ON …`, `UPDATE referrals SET …`. */
const TABLE_REF = /\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?(?:\s+(?:as\s+)?(?!on\b|set\b|where\b|values\b|select\b|using\b)([a-z][a-z0-9_]*))?/gi;
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

function scan() {
  let templates = 0, withColumns = 0, unresolved = 0;
  const ghosts: Finding[] = [];

  for (const f of ROOTS.flatMap((r) => walk(r))) {
    const src = stripComments(fs.readFileSync(f, "utf8"));
    for (const t of outermostSqlTemplates(src)) {
      templates++;
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
      if (!bare.length && !qualified.length && !inserted.length) continue;
      withColumns++;

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
        if (anyUnknown) { unresolved++; continue; }
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
        if (!ident || !byIdent.has(ident)) { unresolved++; continue; }
        union = byIdent.get(ident)!;
        aliases.set("", union);
      }

      const rel = path.relative(ROOT, f);
      const excerpt = lit.split("\n").join(" ").replace(/\s+/g, " ").trim().slice(0, 70);
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
    }
  }
  return { templates, withColumns, unresolved, ghosts };
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
    // unreadable share cannot grow quietly.
    expect(result.unresolved).toBeLessThanOrEqual(MAX_UNRESOLVED);
  });
});

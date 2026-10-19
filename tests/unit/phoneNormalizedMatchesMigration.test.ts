/**
 * leads.phone_normalized is ONE generated column, wherever the schema comes from.
 *
 * Migration 0051 (and its scripts/migrate.mjs mirror, which production's
 * release command runs) creates `phone_normalized` as GENERATED ALWAYS AS
 * (digits of phone) STORED. shared/schema.ts declared it as a plain text
 * column, so a database built by `drizzle-kit push` — CI's E2E database, local
 * simulation databases — got a column nothing ever filled. Inbound-SMS STOP
 * matching reads that column (findLeadsByPhoneLast10), so in those databases a
 * STOP reply matched no lead and opted nobody out (lifecycle sim, 2026-10-12).
 * Pushing that schema at a migration-built database also emitted
 * `ALTER COLUMN "phone_normalized" DROP EXPRESSION`.
 *
 * Held here by PARSING all three declarations, not by scanning their text:
 *   - the schema's expression is read from the Drizzle column config and
 *     rendered by Drizzle's own Postgres dialect;
 *   - the migration's and migrate.mjs's expressions are extracted by a SQL
 *     reader that skips comments and respects string literals, from the
 *     statement that adds the column;
 * and all three must be the same expression, STORED, on the same column.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { leads, insertLeadSchema } from "../../shared/schema";
import { stripSqlComments } from "../helpers/stripSqlComments";

const ROOT = process.cwd();
const EXPECTED = "regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')";

/** Whitespace collapsed and keywords lower-cased OUTSIDE string literals. */
function normalize(expr: string): string {
  let out = "";
  for (let i = 0; i < expr.length; ) {
    if (expr[i] === "'") {
      let j = i + 1;
      for (; j < expr.length; j++) {
        if (expr[j] === "'" && expr[j + 1] === "'") j++;
        else if (expr[j] === "'") break;
      }
      out += expr.slice(i, j + 1);
      i = j + 1;
    } else {
      out += /\s/.test(expr[i]) ? " " : expr[i].toLowerCase();
      i++;
    }
  }
  return out.replace(/ +/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ ,/g, ",").trim();
}

/**
 * From comment-free SQL, the GENERATED expression of the statement that adds
 * `<table>.phone_normalized`: the balanced, quote-aware span after
 * GENERATED ALWAYS AS ( … ), plus whether STORED follows it.
 */
function generatedExpr(sql: string, table: string): { expr: string; stored: boolean } | null {
  const statements: string[] = [];
  let cur = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] === "'" && sql[j + 1] === "'") j++;
        else if (sql[j] === "'") break;
      }
      cur += sql.slice(i, j + 1);
      i = j;
    } else if (c === ";") {
      statements.push(cur);
      cur = "";
    } else cur += c;
  }
  statements.push(cur);
  for (const st of statements) {
    const head = new RegExp(`^\\s*alter\\s+table\\s+(if\\s+exists\\s+)?"?${table}"?\\s+add\\s+column\\s+(if\\s+not\\s+exists\\s+)?"?phone_normalized"?\\s+text\\s+generated\\s+always\\s+as\\s*\\(`, "i");
    const m = head.exec(st);
    if (!m) continue;
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    for (; j < st.length && depth > 0; j++) {
      if (st[j] === "'") {
        // Skip the literal; '' is an escaped quote inside it.
        for (j++; j < st.length; j++) {
          if (st[j] === "'" && st[j + 1] === "'") j++;
          else if (st[j] === "'") break;
        }
      } else if (st[j] === "(") depth++;
      else if (st[j] === ")") depth--;
    }
    return { expr: st.slice(start, j - 1), stored: /^\s*stored\b/i.test(st.slice(j)) };
  }
  return null;
}

/** Every string / template literal in migrate.mjs, parsed with TypeScript. */
function migrateMjsLiterals(): string[] {
  const src = readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
  const sf = ts.createSourceFile("migrate.mjs", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("leads.phone_normalized: schema, migration 0051 and migrate.mjs agree", () => {
  const column = getTableConfig(leads).columns.find((c) => c.name === "phone_normalized");

  it("the schema declares it as a STORED generated column", () => {
    expect(column, "leads.phone_normalized column").toBeDefined();
    const gen = (column as unknown as { generated?: { as: unknown; type: string } }).generated;
    expect(gen, "generatedAlwaysAs config").toBeDefined();
    expect(gen!.type).toBe("always");
  });

  const schemaExpr = (() => {
    const gen = (column as unknown as { generated?: { as: SQL } }).generated;
    return gen ? new PgDialect().sqlToQuery(gen.as).sql : "";
  })();
  const migration = generatedExpr(stripSqlComments(readFileSync(path.join(ROOT, "migrations/0051_phone_normalized.sql"), "utf8")), "leads");
  const mirror = migrateMjsLiterals()
    .map((lit) => generatedExpr(stripSqlComments(lit), "leads"))
    .filter((x): x is { expr: string; stored: boolean } => x !== null);

  it("vacuity: each source yields exactly one expression", () => {
    expect(schemaExpr.length).toBeGreaterThan(0);
    expect(migration, "migration 0051 statement").not.toBeNull();
    expect(mirror, "migrate.mjs statements adding leads.phone_normalized").toHaveLength(1);
  });

  it("all three are the same expression, and the migrations say STORED", () => {
    expect(normalize(schemaExpr)).toBe(normalize(EXPECTED));
    expect(normalize(migration!.expr)).toBe(normalize(EXPECTED));
    expect(normalize(mirror[0].expr)).toBe(normalize(EXPECTED));
    expect(migration!.stored).toBe(true);
    expect(mirror[0].stored).toBe(true);
  });

  it("no lead writer can set it: the insert schema has no such field", () => {
    expect(Object.keys(insertLeadSchema.shape)).not.toContain("phoneNormalized");
  });
});

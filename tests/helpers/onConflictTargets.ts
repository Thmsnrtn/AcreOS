/**
 * ON CONFLICT targets, and the unique indexes a database built from this
 * repository actually has to satisfy them.
 *
 * Postgres resolves `INSERT … ON CONFLICT (cols) DO …` by INFERENCE: it looks
 * for a unique index whose key columns are exactly `cols`. A PARTIAL unique
 * index (`CREATE UNIQUE INDEX … WHERE …`) is only inferred when the statement
 * repeats a predicate that implies the index's own; with no predicate the
 * insert fails with "there is no unique or exclusion constraint matching the
 * ON CONFLICT specification". Every time, not just under a race.
 *
 * Two halves, shared by the static gate
 * (tests/unit/onConflictTargetsAreFullUniqueConstraints.test.ts) and the
 * real-database cross-check (tests/integration/paymentsTransactionIdConflict.db.test.ts):
 *
 *   1. `collectConflictSites` — every `onConflictDoNothing(...)` /
 *      `onConflictDoUpdate(...)` call and every raw-SQL `ON CONFLICT (…)` in
 *      server/, found with TypeScript's parser (so a comment is never a site)
 *      and resolved to (table, columns, target predicate) through the real
 *      Drizzle table objects. A site that cannot be resolved is RETURNED with
 *      the reason, never dropped.
 *
 *   2. `buildShippedUniqueModel` — the unique indexes and constraints a
 *      database ends up with when it is built the way a deploy builds it:
 *      migrations/*.sql in byte order, then the string literals of
 *      scripts/migrate.mjs in source order. Statements are replayed in that
 *      order with Postgres's own rules for the cases that decide the answer —
 *      the first CREATE of a name wins, `CREATE TABLE IF NOT EXISTS` on an
 *      existing table applies none of its inline constraints, DROP INDEX
 *      cannot drop a constraint's index, DROP COLUMN takes its indexes with it.
 *
 * shared/schema.ts's `.unique()` / `uniqueIndex()` declarations are NOT a
 * source here. Nothing in the deploy applies them (there is no `db:push` in the
 * release path), so a declaration with no DDL behind it is a description of a
 * database that does not exist — which is how payments.transaction_id was
 * declared `.unique()` while the built database held only a partial index.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "./stripComments";

export const REPO_ROOT = path.resolve(__dirname, "../..");

// ─────────────────────────────────────────────────────────────────────────────
// SQL text: comments out, string contents masked, offsets preserved
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns two same-length views of `sql`: `code` with comments blanked, and
 * `masked`, which additionally fills single-quoted string CONTENTS with `_`
 * (so a keyword inside a string, e.g. a RAISE NOTICE message, is never read
 * as DDL). Dollar-quote delimiters are blanked and their bodies kept as code:
 * a DO block's statements are statements.
 */
export function sqlViews(sql: string): { code: string; masked: string } {
  const code = sql.split("");
  const masked = sql.split("");
  const n = sql.length;
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      if (sql[k] !== "\n") {
        code[k] = " ";
        masked[k] = " ";
      }
    }
  };
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      let j = i;
      while (j < n && sql[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'") {
      const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/\w/.test(sql[i - 2]));
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      for (let k = i + 1; k < j && k < n; k += 1) if (sql[k] !== "\n") masked[k] = "_";
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const end = sql.indexOf('"', i + 1);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m && !(i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1]))) {
        blank(i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  return { code: code.join(""), masked: masked.join("") };
}

// ─────────────────────────────────────────────────────────────────────────────
// The shipped DDL, in the order a build applies it
// ─────────────────────────────────────────────────────────────────────────────

export interface DdlSource {
  /** `migrations/0023_payment_race_condition.sql`, or `scripts/migrate.mjs:<line>`. */
  label: string;
  sql: string;
}

/** migrations/*.sql in byte order (scripts/ci/build-schema-from-repo.sh: LC_ALL=C sort). */
export function migrationSources(root = REPO_ROOT): DdlSource[] {
  const dir = path.join(root, "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0))
    .map((f) => ({ label: `migrations/${f}`, sql: fs.readFileSync(path.join(dir, f), "utf8") }));
}

const TEMPLATE_HOLE = "__TPL_HOLE__";

/**
 * Every string-valued literal in a JS/TS source, in source order, with
 * template holes replaced by a sentinel identifier and `+`-concatenations
 * joined. Read from the AST, so a comment is never a literal.
 */
export function stringLiteralsOf(source: string, fileName: string): Array<{ text: string; line: number; node: ts.Node; sf: ts.SourceFile }> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Array<{ text: string; line: number; node: ts.Node; sf: ts.SourceFile }> = [];
  const textOf = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      let s = node.head.text;
      for (const span of node.templateSpans) s += TEMPLATE_HOLE + span.literal.text;
      return s;
    }
    if (ts.isParenthesizedExpression(node)) return textOf(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = textOf(node.left);
      const r = textOf(node.right);
      if (l === null && r === null) return null;
      return (l ?? TEMPLATE_HOLE) + (r ?? TEMPLATE_HOLE);
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    const isConcat = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;
    const parentIsConcat =
      node.parent && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken;
    if ((isConcat || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !parentIsConcat) {
      const t = textOf(node);
      if (t !== null) {
        out.push({ text: t, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, node, sf });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** scripts/migrate.mjs, one source per string literal, in source order. */
export function migrateMjsSources(root = REPO_ROOT): DdlSource[] {
  const file = path.join(root, "scripts", "migrate.mjs");
  const src = fs.readFileSync(file, "utf8");
  return stringLiteralsOf(src, "migrate.mjs").map((l) => ({ label: `scripts/migrate.mjs:${l.line}`, sql: l.text }));
}

/** Everything a build from this repository applies, in order. */
export function shippedDdlSources(root = REPO_ROOT): DdlSource[] {
  return [...migrationSources(root), ...migrateMjsSources(root)];
}

export interface UniqueRelation {
  name: string;
  table: string;
  /** Key columns; null when any key element is an expression (never inferable from a column list). */
  columns: string[] | null;
  /** The index predicate as written, or null for a full index. */
  predicate: string | null;
  unique: boolean;
  /** Backed by a UNIQUE / PRIMARY KEY constraint (cannot be dropped with DROP INDEX). */
  constraint: boolean;
  deferrable: boolean;
  source: string;
}

export interface ShippedModel {
  tables: Map<string, Set<string>>;
  relations: Map<string, UniqueRelation>;
  /** DDL statements that touch an identifier the text cannot name (a template hole). */
  notModelled: string[];
  statementsRead: number;
}

const MISSING_TABLE = Symbol("missing-table");
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;

function unquote(id: string): string {
  const parts = id.split(/\s*\.\s*(?=(?:"|[A-Za-z_]))/);
  const last = parts[parts.length - 1].trim();
  return last.startsWith('"') ? last.slice(1, -1) : last.toLowerCase();
}

function splitTopLevel(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  let inQuote = false;
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `("a", b DESC, lower(c))` element list → column names, or null if any element is an expression. */
function keyColumns(list: string): string[] | null {
  const cols: string[] = [];
  for (const raw of splitTopLevel(list)) {
    const el = raw.trim();
    if (!el) continue;
    const m = new RegExp(String.raw`^(${IDENT})((?:\s+(?:${IDENT}))*)$`).exec(el);
    if (!m) return null;
    const rest = m[2].trim().split(/\s+/).filter(Boolean).map((w) => w.toUpperCase());
    // COLLATE / opclass / ASC / DESC / NULLS FIRST|LAST are allowed decorations.
    if (rest.some((w) => w === "(")) return null;
    cols.push(unquote(m[1]));
  }
  return cols;
}

/** Normalised predicate text for equality comparison. */
export function normalizePredicate(p: string): string {
  return p
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/\bpublic\./g, "")
    .replace(/::[a-z_ ]+(\[\])?/g, "")
    .replace(/[()\s]/g, "");
}

function isDeferrable(text: string): boolean {
  return /\bDEFERRABLE\b/i.test(text) && !/\bNOT\s+DEFERRABLE\b/i.test(text);
}

/**
 * Replays the shipped DDL and returns the relations it leaves behind. `omit`
 * removes sources (the gate's own mutation canary uses it to rebuild the model
 * without the migration that fixed payments).
 */
export function buildShippedUniqueModel(sources: DdlSource[]): ShippedModel {
  const tables = new Map<string, Set<string>>();
  const relations = new Map<string, UniqueRelation>();
  const notModelled: string[] = [];
  let statementsRead = 0;
  const retry: Array<{ sm: string; sc: string; label: string }> = [];

  const autoName = (base: string): string => {
    let name = base.slice(0, 63);
    let k = 1;
    while (relations.has(name)) name = `${base.slice(0, 60)}${k++}`;
    return name;
  };

  const relationsOf = (table: string) => [...relations.values()].filter((r) => r.table === table);

  for (const source of sources) {
    const { code, masked } = sqlViews(source.sql);
    // Split at ';' in the masked view (a ';' inside a string is masked away).
    const pieces: Array<{ code: string; masked: string }> = [];
    let start = 0;
    for (let i = 0; i <= masked.length; i += 1) {
      if (i === masked.length || masked[i] === ";") {
        pieces.push({ code: code.slice(start, i), masked: masked.slice(start, i) });
        start = i + 1;
      }
    }
    for (const piece of pieces) {
      const ddlRe =
        /\b(CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE|ALTER\s+TABLE|ALTER\s+INDEX|DROP\s+INDEX|DROP\s+TABLE)\b/gi;
      const starts: number[] = [];
      let m: RegExpExecArray | null;
      while ((m = ddlRe.exec(piece.masked)) !== null) starts.push(m.index);
      for (let s = 0; s < starts.length; s += 1) {
        const end = s + 1 < starts.length ? starts[s + 1] : piece.masked.length;
        const stmtMasked = piece.masked.slice(starts[s], end).trim();
        const stmtCode = piece.code.slice(starts[s], end).trim();
        statementsRead += 1;
        if (stmtMasked.includes(TEMPLATE_HOLE)) {
          // A table or index named by a JS expression; no text can say which.
          if (/\b(UNIQUE|PRIMARY\s+KEY|DROP\s+(INDEX|TABLE|CONSTRAINT|COLUMN))\b/i.test(stmtMasked)) {
            notModelled.push(`${source.label}: ${stmtMasked.replace(/\s+/g, " ").slice(0, 160)}`);
          }
          continue;
        }
        if (applyStatement(stmtMasked, stmtCode, source.label) === MISSING_TABLE && source.label.startsWith("scripts/migrate.mjs")) {
          retry.push({ sm: stmtMasked, sc: stmtCode, label: source.label });
        }
      }
    }
  }

  function applyStatement(sm: string, sc: string, label: string): typeof MISSING_TABLE | void {
    let m: RegExpExecArray | null;

    // ── CREATE TABLE ──
    if ((m = new RegExp(String.raw`^CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED})\s*`, "i").exec(sm))) {
      const table = unquote(m[2]);
      if (tables.has(table)) return; // IF NOT EXISTS → notice; without → error. Either way nothing applies.
      const open = m[0].length;
      if (sm[open] !== "(") {
        tables.set(table, new Set()); // CREATE TABLE … AS / PARTITION OF: no inline constraints modelled
        return;
      }
      const close = matchParen(sm, open);
      if (close === -1) return;
      const body = sm.slice(open + 1, close);
      const bodyCode = sc.slice(open + 1, close);
      const cols = new Set<string>();
      const pending: Array<UniqueRelation & { explicit: boolean }> = [];
      const elems = splitTopLevel(body);
      let offset = 0;
      const codeElems: string[] = [];
      for (const e of elems) {
        codeElems.push(bodyCode.slice(offset, offset + e.length));
        offset += e.length + 1;
      }
      elems.forEach((rawEl) => {
        const el = rawEl.trim();
        if (!el) return;
        let name: string | null = null;
        let rest = el;
        const cn = new RegExp(String.raw`^CONSTRAINT\s+(${IDENT})\s+`, "i").exec(rest);
        if (cn) {
          name = unquote(cn[1]);
          rest = rest.slice(cn[0].length);
        }
        const tl = /^(PRIMARY\s+KEY|UNIQUE)\s*(?:NULLS\s+(?:NOT\s+)?DISTINCT\s*)?\(/i.exec(rest);
        if (tl) {
          const o = tl[0].length - 1;
          const c = matchParen(rest, o);
          const keys = keyColumns(rest.slice(o + 1, c));
          const pk = /^PRIMARY/i.test(tl[1]);
          pending.push({
            explicit: name !== null,
            name: name ?? (pk ? `${table}_pkey` : `${table}_${(keys ?? ["expr"]).join("_")}_key`),
            table,
            columns: keys,
            predicate: null,
            unique: true,
            constraint: true,
            deferrable: isDeferrable(rest.slice(c + 1)),
            source: label,
          });
          return;
        }
        if (/^(FOREIGN\s+KEY|CHECK|EXCLUDE|LIKE)\b/i.test(rest) || cn) return;
        const col = new RegExp(String.raw`^(${IDENT})\s+`).exec(el);
        if (!col) return;
        const colName = unquote(col[1]);
        cols.add(colName);
        const def = el.slice(col[0].length);
        const inlineName = new RegExp(String.raw`\bCONSTRAINT\s+(${IDENT})\s+(?:PRIMARY\s+KEY|UNIQUE)\b`, "i").exec(def);
        if (/\bPRIMARY\s+KEY\b/i.test(def)) {
          pending.push({ explicit: Boolean(inlineName), name: inlineName ? unquote(inlineName[1]) : `${table}_pkey`, table, columns: [colName], predicate: null, unique: true, constraint: true, deferrable: isDeferrable(def), source: label });
        } else if (/\bUNIQUE\b/i.test(def)) {
          pending.push({ explicit: Boolean(inlineName), name: inlineName ? unquote(inlineName[1]) : `${table}_${colName}_key`, table, columns: [colName], predicate: null, unique: true, constraint: true, deferrable: isDeferrable(def), source: label });
        }
      });
      // An explicit name that collides fails the whole CREATE TABLE; an
      // implicit one is renamed by Postgres until it is free.
      if (pending.some((p) => p.explicit && relations.has(p.name))) return;
      tables.set(table, cols);
      for (const { explicit: _explicit, ...p } of pending) {
        const name = relations.has(p.name) ? autoName(p.name) : p.name;
        relations.set(name, { ...p, name });
      }
      return;
    }

    // ── CREATE [UNIQUE] INDEX ──
    if (
      (m = new RegExp(
        String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?(?:(${IDENT})\s+)?ON\s+(?:ONLY\s+)?(${QUALIFIED})\s*(?:USING\s+(${IDENT})\s*)?\(`,
        "i",
      ).exec(sm))
    ) {
      const unique = Boolean(m[1]);
      const table = unquote(m[4]);
      if (!tables.has(table)) return MISSING_TABLE; // relation does not exist → error
      const open = m[0].length - 1;
      const close = matchParen(sm, open);
      if (close === -1) return;
      const keys = keyColumns(sm.slice(open + 1, close));
      const tail = sm.slice(close + 1);
      const where = /\bWHERE\b/i.exec(tail);
      const predicate = where ? sc.slice(close + 1 + where.index + where[0].length).trim() : null;
      const explicit = m[3] && !/^ON$/i.test(m[3]) ? unquote(m[3]) : null;
      const name = explicit ?? autoName(`${table}_${(keys ?? ["expr"]).join("_")}_idx`);
      if (relations.has(name)) return; // IF NOT EXISTS → skip; otherwise error. The first one stands.
      if ((m[5] ?? "btree").toLowerCase() !== "btree" && unique) {
        // Only btree supports unique indexes; anything else errors.
        return;
      }
      relations.set(name, { name, table, columns: keys, predicate, unique, constraint: false, deferrable: false, source: label });
      return;
    }

    // ── ALTER INDEX … RENAME TO ──
    if ((m = new RegExp(String.raw`^ALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?(${QUALIFIED})\s+RENAME\s+TO\s+(${IDENT})`, "i").exec(sm))) {
      const from = unquote(m[1]);
      const to = unquote(m[2]);
      const rel = relations.get(from);
      if (!rel || relations.has(to)) return;
      relations.delete(from);
      relations.set(to, { ...rel, name: to });
      return;
    }

    // ── DROP INDEX ──
    if ((m = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\s\S]*)$/i.exec(sm))) {
      const names = m[1].replace(/\b(CASCADE|RESTRICT)\b/gi, "").split(",").map((x) => x.trim()).filter(Boolean);
      for (const n of names) {
        const rel = relations.get(unquote(n));
        if (rel && !rel.constraint) relations.delete(rel.name); // a constraint's index cannot be dropped this way
      }
      return;
    }

    // ── DROP TABLE ──
    if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]*)$/i.exec(sm))) {
      const names = m[1].replace(/\b(CASCADE|RESTRICT)\b/gi, "").split(",").map((x) => x.trim()).filter(Boolean);
      for (const n of names) {
        const t = unquote(n);
        tables.delete(t);
        for (const r of relationsOf(t)) relations.delete(r.name);
      }
      return;
    }

    // ── ALTER TABLE ──
    if ((m = new RegExp(String.raw`^ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED})\s+`, "i").exec(sm))) {
      let table = unquote(m[2]);
      if (!tables.has(table)) return m[1] ? undefined : MISSING_TABLE;
      // Statement-level atomicity: any failing action rolls back the lot.
      const snapCols = new Set(tables.get(table));
      const snapRels = relationsOf(table).map((r) => ({ ...r }));
      const rollback = () => {
        for (const r of relationsOf(table)) relations.delete(r.name);
        for (const r of snapRels) relations.set(r.name, r);
        tables.set(table, snapCols);
      };
      const actionsMasked = splitTopLevel(sm.slice(m[0].length));
      for (const raw of actionsMasked) {
        const a = raw.trim();
        let am: RegExpExecArray | null;
        if (
          (am = new RegExp(String.raw`^ADD\s+(?:CONSTRAINT\s+(${IDENT})\s+)?(PRIMARY\s+KEY|UNIQUE)\s+USING\s+INDEX\s+(${IDENT})`, "i").exec(a))
        ) {
          const idx = relations.get(unquote(am[3]));
          if (!idx || idx.predicate !== null || idx.columns === null) return rollback();
          const name = am[1] ? unquote(am[1]) : idx.name;
          relations.delete(idx.name);
          relations.set(name, { ...idx, name, unique: true, constraint: true, deferrable: isDeferrable(a), source: label });
          continue;
        }
        if ((am = new RegExp(String.raw`^ADD\s+(?:CONSTRAINT\s+(${IDENT})\s+)?(PRIMARY\s+KEY|UNIQUE)\s*(?:NULLS\s+(?:NOT\s+)?DISTINCT\s*)?\(`, "i").exec(a))) {
          const o = am[0].length - 1;
          const c = matchParen(a, o);
          const keys = keyColumns(a.slice(o + 1, c));
          const pk = /^PRIMARY/i.test(am[2]);
          if (pk && relationsOf(table).some((r) => r.constraint && r.name.endsWith("_pkey"))) return rollback();
          const explicit = am[1] ? unquote(am[1]) : null;
          if (explicit && relations.has(explicit)) return rollback();
          if (keys && keys.some((k) => !tables.get(table)!.has(k)) && tables.get(table)!.size > 0) return rollback();
          const name = explicit ?? autoName(pk ? `${table}_pkey` : `${table}_${(keys ?? ["expr"]).join("_")}_key`);
          relations.set(name, { name, table, columns: keys, predicate: null, unique: true, constraint: true, deferrable: isDeferrable(a.slice(c + 1)), source: label });
          continue;
        }
        if ((am = new RegExp(String.raw`^DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?(${IDENT})`, "i").exec(a))) {
          const rel = relations.get(unquote(am[2]));
          if (rel && rel.table === table && rel.constraint) relations.delete(rel.name);
          else if (!am[1] && !rel) return rollback();
          continue;
        }
        if ((am = new RegExp(String.raw`^RENAME\s+CONSTRAINT\s+(${IDENT})\s+TO\s+(${IDENT})`, "i").exec(a))) {
          const rel = relations.get(unquote(am[1]));
          if (rel && rel.table === table) {
            relations.delete(rel.name);
            relations.set(unquote(am[2]), { ...rel, name: unquote(am[2]) });
          }
          continue;
        }
        if ((am = new RegExp(String.raw`^RENAME\s+TO\s+(${IDENT})`, "i").exec(a))) {
          const to = unquote(am[1]);
          if (tables.has(to)) return rollback();
          tables.set(to, tables.get(table)!);
          tables.delete(table);
          for (const r of relationsOf(table)) relations.set(r.name, { ...r, table: to });
          table = to;
          continue;
        }
        if ((am = new RegExp(String.raw`^RENAME\s+(?:COLUMN\s+)?(${IDENT})\s+TO\s+(${IDENT})`, "i").exec(a))) {
          const from = unquote(am[1]);
          const to = unquote(am[2]);
          const cols = tables.get(table)!;
          cols.delete(from);
          cols.add(to);
          for (const r of relationsOf(table)) {
            if (r.columns) relations.set(r.name, { ...r, columns: r.columns.map((c) => (c === from ? to : c)) });
          }
          continue;
        }
        if ((am = new RegExp(String.raw`^DROP\s+(?:COLUMN\s+)?(IF\s+EXISTS\s+)?(${IDENT})`, "i").exec(a)) && !/^DROP\s+(CONSTRAINT)\b/i.test(a)) {
          const col = unquote(am[2]);
          tables.get(table)!.delete(col);
          for (const r of relationsOf(table)) if (r.columns?.includes(col)) relations.delete(r.name);
          continue;
        }
        if (
          (am = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?(${IDENT})\s+`, "i").exec(a)) &&
          !/^ADD\s+(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i.test(a)
        ) {
          const col = unquote(am[2]);
          const cols = tables.get(table)!;
          if (cols.has(col)) {
            if (am[1]) continue; // IF NOT EXISTS on an existing column: the whole definition, UNIQUE included, is skipped
            return rollback();
          }
          cols.add(col);
          const def = a.slice(am[0].length);
          const inlineName = new RegExp(String.raw`\bCONSTRAINT\s+(${IDENT})\s+(?:PRIMARY\s+KEY|UNIQUE)\b`, "i").exec(def);
          if (/\bPRIMARY\s+KEY\b/i.test(def) || /\bUNIQUE\b/i.test(def)) {
            const pk = /\bPRIMARY\s+KEY\b/i.test(def);
            const name = inlineName ? unquote(inlineName[1]) : autoName(pk ? `${table}_pkey` : `${table}_${col}_key`);
            if (relations.has(name)) return rollback();
            relations.set(name, { name, table, columns: [col], predicate: null, unique: true, constraint: true, deferrable: isDeferrable(def), source: label });
          }
          continue;
        }
        // Other actions (ALTER COLUMN, ADD FOREIGN KEY, ENABLE RLS, …) do not
        // touch unique relations.
      }
    }
  }

  // scripts/migrate.mjs's RETRY PASS: a statement that failed because its
  // table did not exist yet is run once more after the whole list, so an index
  // whose CREATE TABLE sits later in the file still lands.
  for (const r of retry) applyStatement(r.sm, r.sc, `${r.label} (retry pass)`);

  return { tables, relations, notModelled, statementsRead };
}

// ─────────────────────────────────────────────────────────────────────────────
// Arbiter inference
// ─────────────────────────────────────────────────────────────────────────────

export interface UniqueIndexFact {
  name: string;
  columns: string[] | null;
  predicate: string | null;
  deferrable: boolean;
}

/**
 * Postgres's inference rule over a set of unique indexes: key columns equal to
 * the target set, not deferrable, and either full or with a predicate the
 * statement's own target predicate repeats. (Postgres accepts any predicate
 * the statement's IMPLIES; equality after normalisation is the subset a
 * static check can prove.)
 */
export function inferArbiters(indexes: UniqueIndexFact[], columns: string[], targetWhere: string | null): UniqueIndexFact[] {
  const want = [...new Set(columns)].sort().join(",");
  return indexes.filter((ix) => {
    if (!ix.columns || ix.deferrable) return false;
    if ([...new Set(ix.columns)].sort().join(",") !== want) return false;
    if (ix.predicate === null) return true;
    return targetWhere !== null && normalizePredicate(targetWhere) === normalizePredicate(ix.predicate);
  });
}

export function uniqueIndexesOf(model: ShippedModel, table: string): UniqueIndexFact[] {
  return [...model.relations.values()].filter((r) => r.table === table && r.unique);
}

// ─────────────────────────────────────────────────────────────────────────────
// ON CONFLICT sites in server/
// ─────────────────────────────────────────────────────────────────────────────

export type SiteKind = "onConflictDoNothing" | "onConflictDoUpdate" | "raw-sql";

export interface ConflictSite {
  file: string;
  line: number;
  kind: SiteKind;
  /** The target as written, for messages. */
  targetText: string;
  /** false: `onConflictDoNothing()` with no target — any constraint arbitrates; nothing to infer. */
  targeted: boolean;
  table?: string;
  columns?: string[];
  /** Target predicate, rendered as SQL text; null when there is none. */
  targetWhere?: string | null;
  /** `ON CONFLICT ON CONSTRAINT name`. */
  constraintName?: string;
  /** Set when the target could not be resolved — the gate fails on it. */
  unresolved?: string;
}

/** Every .ts under server/, excluding tests (which hold mocks, not inserts). */
export function serverSourceFiles(root = REPO_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  };
  walk(path.join(root, "server"));
  return out.sort();
}

type TableLike = Record<string, unknown>;

export interface TableResolver {
  /** `(file, localName)` → the Drizzle table it is bound to, or a reason it is not one. */
  table(file: string, local: string, sf: ts.SourceFile): Promise<{ table: TableLike; sqlName: string } | { error: string }>;
  column(table: TableLike, prop: string): string | null;
  /**
   * `(file, localName)` → the SQL text of a Drizzle `sql` constant exported
   * from shared/ (e.g. a partial index's predicate, declared once and shared by
   * the index and every conflict target that must repeat it), or null when the
   * identifier is not bound to one.
   */
  sqlConstant(file: string, local: string, sf: ts.SourceFile): Promise<string | null>;
}

/**
 * Resolves identifiers through the file's own import declarations to the real
 * exported Drizzle objects in shared/. A table bound any other way (a local
 * variable, a function parameter, a server-side module) is an error, not a
 * guess.
 */
export async function makeTableResolver(root = REPO_ROOT): Promise<TableResolver> {
  const { getTableName, is } = await import("drizzle-orm");
  const { PgTable, PgColumn, PgDialect } = await import("drizzle-orm/pg-core");
  const { SQL } = await import("drizzle-orm");
  const dialect = new PgDialect();
  const modCache = new Map<string, Record<string, unknown>>();
  const resolveModule = (fromFile: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@shared/")) base = path.join(root, "shared", spec.slice("@shared/".length));
    else if (spec === "@shared") base = path.join(root, "shared");
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
    else return null;
    for (const cand of [base, `${base}.ts`, path.join(base, "index.ts")]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return null;
  };
  const loadShared = async (abs: string): Promise<Record<string, unknown> | null> => {
    if (!abs.startsWith(path.join(root, "shared") + path.sep)) return null;
    if (!modCache.has(abs)) modCache.set(abs, (await import(abs)) as Record<string, unknown>);
    return modCache.get(abs)!;
  };
  // Every binding of `local` to an export: static `import { a as local }`
  // and `const { a: local } = await import("…")` anywhere in the file.
  const bindingsOf = (local: string, sf: ts.SourceFile): Array<{ spec: string; exported: string }> => {
    const bindings: Array<{ spec: string; exported: string }> = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (el.name.text === local) bindings.push({ spec: st.moduleSpecifier.text, exported: (el.propertyName ?? el.name).text });
        }
      }
    }
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
        let init: ts.Expression = node.initializer;
        while (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
        if (
          ts.isCallExpression(init) &&
          init.expression.kind === ts.SyntaxKind.ImportKeyword &&
          init.arguments[0] &&
          ts.isStringLiteral(init.arguments[0])
        ) {
          for (const el of node.name.elements) {
            if (ts.isIdentifier(el.name) && el.name.text === local) {
              const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
              bindings.push({ spec: (init.arguments[0] as ts.StringLiteral).text, exported: prop });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return bindings;
  };
  return {
    async table(file, local, sf) {
      // Every binding of `local` to an export: static `import { a as local }`
      // and `const { a: local } = await import("…")` anywhere in the file.
      // They must all name the same table, or the reference is ambiguous.
      const bindings = bindingsOf(local, sf);
      if (bindings.length === 0) return { error: `"${local}" is not bound by an import in this file` };
      const resolved: Array<{ table: TableLike; sqlName: string }> = [];
      for (const b of bindings) {
        const abs = resolveModule(file, b.spec);
        if (!abs) return { error: `imported from "${b.spec}", which is not a module under shared/` };
        const mod = await loadShared(abs);
        if (!mod) return { error: `imported from "${b.spec}" (${path.relative(root, abs)}), outside shared/` };
        const t = mod[b.exported];
        if (!t || !is(t, PgTable)) return { error: `"${b.exported}" from "${b.spec}" is not a Drizzle pgTable` };
        resolved.push({ table: t as unknown as TableLike, sqlName: getTableName(t) });
      }
      if (new Set(resolved.map((r) => r.sqlName)).size > 1) {
        return { error: `"${local}" is bound to more than one table in this file (${resolved.map((r) => r.sqlName).join(", ")})` };
      }
      return resolved[0];
    },
    column(table, prop) {
      const c = table[prop];
      return c && is(c, PgColumn) ? (c as unknown as { name: string }).name : null;
    },
    async sqlConstant(file, local, sf) {
      const bindings = bindingsOf(local, sf);
      if (bindings.length !== 1) return null;
      const abs = resolveModule(file, bindings[0].spec);
      if (!abs) return null;
      const mod = await loadShared(abs);
      const v = mod?.[bindings[0].exported];
      if (!v || !is(v, SQL)) return null;
      return dialect.sqlToQuery(v as InstanceType<typeof SQL>).sql;
    },
  };
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** `T.col` → [T, col] (also `ns.T.col` for a namespace import is reported unresolved). */
function columnRef(expr: ts.Expression): { table: string; prop: string } | null {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return { table: e.expression.text, prop: e.name.text };
  return null;
}

async function renderPredicate(
  expr: ts.Expression,
  file: string,
  sf: ts.SourceFile,
  resolver: TableResolver,
): Promise<string> {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  const colName = async (x: ts.Expression): Promise<string> => {
    const ref = columnRef(x);
    if (!ref) return "<?>";
    const t = await resolver.table(file, ref.table, sf);
    if ("error" in t) return "<?>";
    return resolver.column(t.table, ref.prop) ?? "<?>";
  };
  if (ts.isTaggedTemplateExpression(e) && ts.isIdentifier(e.tag) && e.tag.text === "sql") {
    const tpl = e.template;
    if (ts.isNoSubstitutionTemplateLiteral(tpl)) return tpl.text;
    let s = tpl.head.text;
    for (const span of tpl.templateSpans) s += (await colName(span.expression)) + span.literal.text;
    return s;
  }
  // A predicate constant imported from shared/ (the partial index declares the
  // same constant, so the two cannot drift): render the SQL it holds.
  if (ts.isIdentifier(e)) {
    const text = await resolver.sqlConstant(file, e.text, sf);
    if (text !== null) return text;
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const fn = e.expression.text;
    if (fn === "isNotNull" && e.arguments[0]) return `${await colName(e.arguments[0])} IS NOT NULL`;
    if (fn === "isNull" && e.arguments[0]) return `${await colName(e.arguments[0])} IS NULL`;
    if (fn === "and") return (await Promise.all(e.arguments.map((a) => renderPredicate(a, file, sf, resolver)))).join(" AND ");
  }
  return "<unparsed predicate>";
}

/**
 * The sites in one source text. Exported so the gate's canaries can feed it a
 * fixture through exactly the code path the repository's files take.
 */
export async function sitesInSource(
  file: string,
  rawSource: string,
  resolver: TableResolver,
  root = REPO_ROOT,
): Promise<ConflictSite[]> {
  const source = stripComments(rawSource);
  const rel = path.relative(root, file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: ConflictSite[] = [];
  const pendingCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === "onConflictDoNothing" || node.expression.name.text === "onConflictDoUpdate")
    ) {
      pendingCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const call of pendingCalls) {
    const kind = (call.expression as ts.PropertyAccessExpression).name.text as SiteKind;
    const line = lineOf(sf, call);
    let arg: ts.Expression | undefined = call.arguments[0];
    while (arg && (ts.isAsExpression(arg) || ts.isSatisfiesExpression(arg) || ts.isParenthesizedExpression(arg) || ts.isNonNullExpression(arg))) {
      arg = arg.expression;
    }
    if (!arg) {
      sites.push({ file: rel, line, kind, targetText: "(none)", targeted: kind === "onConflictDoUpdate", ...(kind === "onConflictDoUpdate" ? { unresolved: "onConflictDoUpdate with no config" } : {}) });
      continue;
    }
    if (!ts.isObjectLiteralExpression(arg)) {
      sites.push({ file: rel, line, kind, targetText: arg.getText(sf), targeted: true, unresolved: "config is not an object literal" });
      continue;
    }
    const prop = (name: string) =>
      arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name);
    const target = prop("target");
    if (!target) {
      if (arg.properties.some((p) => ts.isSpreadAssignment(p) || ts.isShorthandPropertyAssignment(p))) {
        sites.push({ file: rel, line, kind, targetText: arg.getText(sf), targeted: true, unresolved: "target supplied by a spread/shorthand" });
      } else {
        sites.push({ file: rel, line, kind, targetText: "(none)", targeted: kind === "onConflictDoUpdate", ...(kind === "onConflictDoUpdate" ? { unresolved: "onConflictDoUpdate with no target" } : {}) });
      }
      continue;
    }
    const targetText = target.initializer.getText(sf).replace(/\s+/g, " ");
    const elems: ts.Expression[] = ts.isArrayLiteralExpression(target.initializer) ? [...target.initializer.elements] : [target.initializer];
    let table: string | undefined;
    const columns: string[] = [];
    let unresolved: string | undefined;
    for (const el of elems) {
      const ref = columnRef(el);
      if (!ref) {
        unresolved = `target element \`${el.getText(sf)}\` is not a <table>.<column> reference`;
        break;
      }
      const t = await resolver.table(file, ref.table, sf);
      if ("error" in t) {
        unresolved = `\`${ref.table}\`: ${t.error}`;
        break;
      }
      const col = resolver.column(t.table, ref.prop);
      if (!col) {
        unresolved = `\`${ref.table}.${ref.prop}\` is not a column of ${t.sqlName}`;
        break;
      }
      if (table && table !== t.sqlName) {
        unresolved = `target spans two tables (${table}, ${t.sqlName})`;
        break;
      }
      table = t.sqlName;
      columns.push(col);
    }
    // onConflictDoNothing's `where` is the TARGET predicate; onConflictDoUpdate's
    // `where` is the deprecated SET predicate (it renders after DO UPDATE SET).
    const predProp = kind === "onConflictDoNothing" ? prop("where") : prop("targetWhere");
    const targetWhere = predProp ? await renderPredicate(predProp.initializer, file, sf, resolver) : null;
    sites.push({ file: rel, line, kind, targetText, targeted: true, table, columns, targetWhere, ...(unresolved ? { unresolved } : {}) });
  }

  // Raw SQL: string literals and templates (incl. sql`…`) carrying ON CONFLICT.
  for (const lit of stringLiteralsOfNodes(sf)) {
    if (!/\bON\s+CONFLICT\b/i.test(lit.text)) continue;
    // Holes that are a bare imported table identifier become that table's name.
    let text = "";
    for (const part of lit.parts) {
      if (typeof part === "string") text += part;
      else {
        let tname = TEMPLATE_HOLE;
        if (ts.isIdentifier(part)) {
          const t = await resolver.table(file, part.text, sf);
          if (!("error" in t)) tname = `"${t.sqlName}"`;
        }
        text += tname;
      }
    }
    const { masked, code } = sqlViews(text);
    const re = /\bON\s+CONFLICT\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const line = lit.line + (text.slice(0, m.index).match(/\n/g)?.length ?? 0);
      const before = masked.slice(0, m.index);
      const ins = [...before.matchAll(new RegExp(String.raw`\bINSERT\s+INTO\s+(${QUALIFIED})`, "gi"))].pop();
      const after = masked.slice(m.index + m[0].length);
      const afterCode = code.slice(m.index + m[0].length);
      const targetText = afterCode.slice(0, Math.max(0, afterCode.search(/\bDO\b/i))).replace(/\s+/g, " ").trim();
      const onConstraint = new RegExp(String.raw`^\s*ON\s+CONSTRAINT\s+(${IDENT})`, "i").exec(after);
      const base: ConflictSite = { file: rel, line, kind: "raw-sql", targetText, targeted: true };
      if (/^\s*DO\b/i.test(after)) {
        sites.push({ ...base, targetText: "(none)", targeted: false });
        continue;
      }
      if (!ins || ins[1].includes(TEMPLATE_HOLE)) {
        sites.push({ ...base, unresolved: "no INSERT INTO <table> naming the table in the same literal" });
        continue;
      }
      const table = unquote(ins[1]);
      if (onConstraint) {
        sites.push({ ...base, table, constraintName: unquote(onConstraint[1]) });
        continue;
      }
      const open = after.search(/\S/);
      if (after[open] !== "(") {
        sites.push({ ...base, table, unresolved: "ON CONFLICT not followed by a column list" });
        continue;
      }
      const close = matchParen(after, open);
      const cols = close === -1 ? null : keyColumns(after.slice(open + 1, close));
      if (!cols) {
        sites.push({ ...base, table, unresolved: "conflict target is an expression, not a column list" });
        continue;
      }
      const tail = after.slice(close + 1);
      const w = /^\s*WHERE\b/i.exec(tail);
      let targetWhere: string | null = null;
      if (w) {
        const doAt = tail.search(/\bDO\b/i);
        targetWhere = afterCode.slice(close + 1 + w[0].length, close + 1 + (doAt === -1 ? tail.length : doAt)).trim();
      }
      sites.push({ ...base, table, columns: cols, targetWhere });
    }
  }
  return sites;
}

function stringLiteralsOfNodes(sf: ts.SourceFile): Array<{ text: string; parts: Array<string | ts.Expression>; line: number }> {
  const out: Array<{ text: string; parts: Array<string | ts.Expression>; line: number }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({ text: node.text, parts: [node.text], line: lineOf(sf, node) });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const parts: Array<string | ts.Expression> = [node.head.text];
      let text = node.head.text;
      for (const span of node.templateSpans) {
        parts.push(span.expression, span.literal.text);
        text += TEMPLATE_HOLE + span.literal.text;
      }
      out.push({ text, parts, line: lineOf(sf, node) });
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface SiteCollection {
  filesScanned: number;
  sites: ConflictSite[];
}

export async function collectConflictSites(root = REPO_ROOT, resolver?: TableResolver): Promise<SiteCollection> {
  const r = resolver ?? (await makeTableResolver(root));
  const files = serverSourceFiles(root);
  const sites: ConflictSite[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (!/onConflictDo|ON\s+CONFLICT/i.test(src)) continue;
    sites.push(...(await sitesInSource(f, src, r, root)));
  }
  return { filesScanned: files.length, sites };
}

/** `file:line kind target` — the key the known-mismatch register uses. */
export function siteKey(s: ConflictSite): string {
  return `${s.file} ${s.kind} ${s.table ?? "?"}(${(s.columns ?? []).join(",")})${s.constraintName ? ` ON CONSTRAINT ${s.constraintName}` : ""}`;
}

/** Verdict for one resolved, targeted site against a set of unique indexes. */
export function siteVerdict(site: ConflictSite, indexes: UniqueIndexFact[]): { ok: true } | { ok: false; why: string } {
  if (site.unresolved) return { ok: false, why: `unresolved: ${site.unresolved}` };
  if (!site.targeted) return { ok: true };
  if (site.constraintName) {
    const c = indexes.find((i) => i.name === site.constraintName);
    return c ? { ok: true } : { ok: false, why: `no constraint named ${site.constraintName} on ${site.table}` };
  }
  const arbiters = inferArbiters(indexes, site.columns ?? [], site.targetWhere ?? null);
  if (arbiters.length > 0) return { ok: true };
  const sameCols = indexes.filter(
    (i) => i.columns && [...i.columns].sort().join(",") === [...(site.columns ?? [])].sort().join(","),
  );
  if (sameCols.length === 0) return { ok: false, why: `no unique index on ${site.table}(${(site.columns ?? []).join(", ")})` };
  const desc = sameCols
    .map((i) => `${i.name}${i.predicate ? ` WHERE ${i.predicate.replace(/\s+/g, " ")}` : ""}${i.deferrable ? " DEFERRABLE" : ""}`)
    .join("; ");
  return {
    ok: false,
    why: `only ${desc} covers ${site.table}(${(site.columns ?? []).join(", ")}) and the target ${site.targetWhere ? `predicate \`${site.targetWhere}\` does not repeat it` : "has no predicate"}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The same facts, read from a real database
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every unique index in `public`, as Postgres's inference sees it: key columns
 * only (not INCLUDE), null for an expression key, the predicate as Postgres
 * deparses it, and deferrable when the index is not immediate.
 */
export const DB_UNIQUE_INDEXES_SQL = `
  SELECT c.relname AS table_name,
         i.relname AS index_name,
         ARRAY(
           SELECT COALESCE(a.attname::text, '')
             FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
             LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum AND k.attnum > 0
            WHERE k.ord <= ix.indnkeyatts
            ORDER BY k.ord
         )::text[] AS columns,
         ix.indexprs IS NOT NULL AS has_expression,
         pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
         NOT ix.indimmediate AS deferrable,
         ix.indisvalid AS valid
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class c ON c.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE ix.indisunique AND n.nspname = 'public'`;

export interface DbUniqueIndexRow {
  table_name: string;
  index_name: string;
  columns: string[];
  has_expression: boolean;
  predicate: string | null;
  deferrable: boolean;
  valid: boolean;
}

export function dbIndexesByTable(rows: DbUniqueIndexRow[]): Map<string, UniqueIndexFact[]> {
  const out = new Map<string, UniqueIndexFact[]>();
  for (const r of rows) {
    if (!r.valid) continue;
    const fact: UniqueIndexFact = {
      name: r.index_name,
      columns: r.has_expression || r.columns.some((c) => c === "") ? null : r.columns,
      predicate: r.predicate,
      deferrable: r.deferrable,
    };
    out.set(r.table_name, [...(out.get(r.table_name) ?? []), fact]);
  }
  return out;
}

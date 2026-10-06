/**
 * W10.4 — the census of every deal writer in server/.
 *
 * A deal's status is written in ONE place (server/storage/dealRepo.ts), which
 * holds the state machine, the race guard (StaleDealWriteError), the creation
 * rule (DealCreationRefusedError) and the close hook. That is only true over
 * the population that actually reaches the repository, so this file
 * enumerates the population from the source and classifies every member:
 *
 *  (a) NO file outside server/storage/ writes the `deals` table directly —
 *      Drizzle `.insert/.update/.delete` on ANY binding of the table (a named
 *      import, an alias, a namespace import, a dynamic-import destructure or
 *      namespace) and raw SQL `INSERT INTO deals` / `UPDATE deals` /
 *      `DELETE FROM deals` in any string or template. The older evidence gate
 *      (dealTransitionEvidenceEverywhere) reads updates and deletes, and a raw
 *      UPDATE only when it names `status`; an INSERT was outside its
 *      population, and an insert is exactly how a deal is born closed.
 *
 *  (b) EVERY `createDeal(` call outside the repository either takes the
 *      default ("opening") path or names its `creation` as a string literal —
 *      and every non-opening creation is REGISTERED below with its reason. A
 *      registered entry nothing matches is stale and fails.
 *
 *  (c) EVERY call that writes a deal's status or creates one
 *      (`updateDeal` / `bulkUpdateDeals` with a status — or a payload the
 *      parser cannot see into — and every `createDeal`) is either inside a
 *      route handler that maps the repository's typed refusals through
 *      `sendDealWriteError`, or is a REGISTERED non-route writer whose reason
 *      says how its refusals surface. Starting from the WRITE, not from the
 *      routes, means a handler declared elsewhere, wrapped, or nested inside
 *      a transaction callback cannot fall outside the population: a write
 *      that is in no inline handler must be registered.
 *
 * It PARSES (TypeScript's own parser) rather than scanning text: the parser
 * never visits a comment, so a comment recording a removed writer is not a
 * writer, and a string is a string. A file whose parse reports errors is
 * COUNTED, never skipped. Canaries below hide each shape in a fixture and
 * prove the census goes red on it; vacuity floors prove it read the repo.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        out.push(p);
      }
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

function parse(src: string, name: string): ts.SourceFile {
  return ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const parseErrors = (sf: ts.SourceFile) => ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length;

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e;
  for (;;) {
    if (
      ts.isAwaitExpression(x) ||
      ts.isParenthesizedExpression(x) ||
      ts.isAsExpression(x) ||
      ts.isNonNullExpression(x) ||
      ts.isSatisfiesExpression(x) ||
      ts.isTypeAssertionExpression(x)
    )
      x = x.expression;
    else return x;
  }
};

// ── (a) direct writes to the deals table ─────────────────────────────────────

const SCHEMA_SPECIFIER = /(^@shared\/schema|(^|\/)shared\/schema)(\/|$|\.ts$)/;

/**
 * Every name the `deals` table is bound to in a file, every namespace that
 * carries it, and every name bound to ANOTHER schema export (so an
 * interpolated `${leads}` resolves to "not deals" rather than "unknown").
 */
function dealsBindings(sf: ts.SourceFile): { names: Set<string>; namespaces: Set<string>; otherSchema: Set<string> } {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const otherSchema = new Set<string>();
  const isSchemaImportCall = (e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    const x = unwrap(e);
    return (
      ts.isCallExpression(x) &&
      x.expression.kind === ts.SyntaxKind.ImportKeyword &&
      x.arguments.length > 0 &&
      ts.isStringLiteralLike(x.arguments[0]) &&
      SCHEMA_SPECIFIER.test(x.arguments[0].text)
    );
  };
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && SCHEMA_SPECIFIER.test(n.moduleSpecifier.text)) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamespaceImport(b)) namespaces.add(b.name.text);
      if (b && ts.isNamedImports(b)) {
        for (const el of b.elements) {
          if ((el.propertyName ?? el.name).text === "deals") names.add(el.name.text);
          else otherSchema.add(el.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(n) && isSchemaImportCall(n.initializer)) {
      if (ts.isIdentifier(n.name)) namespaces.add(n.name.text);
      else if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
          if (key === "deals" && ts.isIdentifier(el.name)) names.add(el.name.text);
          else if (ts.isIdentifier(el.name)) otherSchema.add(el.name.text);
        }
      }
    }
  });
  // A namespace destructured (`const { deals } = schema`) or indexed
  // (`schema["deals"]`), and a plain alias (`const t = deals`), are the table
  // too — followed to a fixpoint so an alias of an alias is (W10.4 re-audit).
  const refersToDeals = (e: ts.Expression): boolean => {
    const x = unwrap(e);
    if (ts.isIdentifier(x)) return names.has(x.text);
    // `flag ? deals : leads` may be the table; `alias(deals, "d")` IS it —
    // Drizzle updates through an alias (W10.4 re-audit 3).
    if (ts.isConditionalExpression(x)) return refersToDeals(x.whenTrue) || refersToDeals(x.whenFalse);
    if (ts.isCallExpression(x) && memberName(x.expression) === "alias" && x.arguments[0]) return refersToDeals(x.arguments[0]);
    if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && names.has(`${x.expression.text}.${x.name.text}`)) return true;
    if (ts.isPropertyAccessExpression(x)) return x.name.text === "deals" && ts.isIdentifier(x.expression) && namespaces.has(x.expression.text);
    if (ts.isElementAccessExpression(x)) {
      const k = unwrap(x.argumentExpression);
      return ts.isStringLiteralLike(k) && k.text === "deals" && ts.isIdentifier(unwrap(x.expression)) && namespaces.has((unwrap(x.expression) as ts.Identifier).text);
    }
    return false;
  };
  for (let grew = true; grew; ) {
    grew = false;
    walk(sf, (n) => {
      // `let t; t = deals` — an assignment binds the name as surely as a declaration.
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
        if (!names.has(n.left.text) && refersToDeals(n.right)) {
          names.add(n.left.text);
          grew = true;
        }
        return;
      }
      if (!ts.isVariableDeclaration(n) || !n.initializer) return;
      const lit = unwrap(n.initializer);
      // `const [t] = [deals]`: the element at the table's position.
      if (ts.isArrayBindingPattern(n.name) && ts.isArrayLiteralExpression(lit)) {
        n.name.elements.forEach((el, i) => {
          const v = lit.elements[i];
          if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name) && v && !ts.isSpreadElement(v) && refersToDeals(v) && !names.has(el.name.text)) {
            names.add(el.name.text);
            grew = true;
          }
        });
        return;
      }
      // `const T = { deals }` / `{ d: deals }`: `T.deals` / `T.d` is the table.
      if (ts.isIdentifier(n.name) && ts.isObjectLiteralExpression(lit)) {
        for (const p of lit.properties) {
          const key =
            ts.isShorthandPropertyAssignment(p) && names.has(p.name.text)
              ? p.name.text
              : ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && refersToDeals(p.initializer)
                ? p.name.text
                : null;
          if (key !== null && !names.has(`${n.name.text}.${key}`)) {
            names.add(`${n.name.text}.${key}`);
            grew = true;
          }
        }
        return;
      }
      const init = unwrap(n.initializer);
      if (ts.isIdentifier(n.name) && !names.has(n.name.text) && refersToDeals(init)) {
        names.add(n.name.text);
        grew = true;
      } else if (ts.isIdentifier(n.name) && !namespaces.has(n.name.text) && ts.isIdentifier(init) && namespaces.has(init.text)) {
        namespaces.add(n.name.text);
        grew = true;
      } else if (ts.isObjectBindingPattern(n.name) && ts.isIdentifier(init) && namespaces.has(init.text)) {
        for (const el of n.name.elements) {
          const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
          if (!ts.isIdentifier(el.name)) continue;
          if (key === "deals" && !names.has(el.name.text)) {
            names.add(el.name.text);
            grew = true;
          } else if (key !== "deals") otherSchema.add(el.name.text);
        }
      }
    });
  }
  return { names, namespaces, otherSchema };
}

/**
 * A SQL write to the table, not prose about one: `INSERT INTO deals`,
 * `UPDATE [ONLY] deals … SET`, `DELETE FROM [ONLY] deals`, with the table
 * bare, quoted, or schema-qualified (`"public"."deals"`). ("Bulk stage update
 * deals error" is a log line.) The SET clause's columns are captured so an
 * exempted write can be held to what it may touch.
 */
const TABLE = String.raw`(?:"?public"?\s*\.\s*)?"?deals"?`;
const RAW_DEALS_WRITE = new RegExp(
  String.raw`\b(?:insert\s+into\s+${TABLE}(?=[\s(;]|$)|delete\s+from\s+(?:only\s+)?${TABLE}(?=[\s;]|$)|update\s+(?:only\s+)?${TABLE}\s+(?:as\s+\w+\s+|\w+\s+)?set\b` +
    // MERGE, TRUNCATE and COPY … FROM write the table too (W10.4 re-audit).
    // An UPDATE whose SET clause is spliced in (`UPDATE deals ${setClause}`).
    String.raw`|update\s+(?:only\s+)?${TABLE}\s+\$x\d+` +
    String.raw`|merge\s+into\s+${TABLE}(?=[\s;]|$)|truncate\s+(?:table\s+)?(?:only\s+)?(?:[\w".]+\s*,\s*)*${TABLE}(?=[\s;,]|$)|copy\s+${TABLE}\s*(?:\([^)]*\)\s*)?from\b)`,
  "i",
);
/**
 * SQL comments, blanked before any verb is read: `UPDATE deals /* x *\/ SET`
 * is an UPDATE. A scan, not a regex: `--` inside a quoted SQL string
 * (`SET note = '--'`) is data, and blanking from it hid the statement after
 * it (W10.4 re-audit 2).
 */
function stripSqlComments(t: string): string {
  let out = "";
  for (let i = 0; i < t.length; ) {
    const c = t[i];
    if (c === "'" || c === '"') {
      // A string, or a quoted identifier (`AS "don't"`), runs to its own quote.
      // In an E'…' string a backslash escapes the next character.
      const escapes = c === "'" && i > 0 && /[eE]/.test(t[i - 1]) && !/\w/.test(t[i - 2] ?? "");
      let j = i + 1;
      while (j < t.length && t[j] !== c) j += escapes && t[j] === "\\" ? 2 : 1;
      const end = Math.min(j + 1, t.length);
      out += t.slice(i, end);
      i = end; // '' (an escaped quote) is two adjacent strings, read the same way
    } else if (c === "-" && t[i + 1] === "-") {
      const nl = t.indexOf("\n", i);
      out += " ";
      i = nl < 0 ? t.length : nl;
    } else if (c === "/" && t[i + 1] === "*") {
      const close = t.indexOf("*/", i + 2);
      out += " ";
      i = close < 0 ? t.length : close + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
/**
 * A write verb whose TABLE is an interpolation (`UPDATE ${t} SET`,
 * `DELETE FROM ${ident(table)}`): `$x<n>` is span n of the template.
 */
const INTERPOLATED_WRITE = /\b(?:insert\s+into|delete\s+from(?:\s+only)?|update(?:\s+only)?|merge\s+into|truncate(?:\s+table)?(?:\s+only)?|copy)\s+\$x(\d+)\b(?:\s+(?:as\s+\w+\s+|\w+\s+)?set\b)?/gi;
const SET_COLUMNS = /\bset\s+([\s\S]*?)(?:\bwhere\b|\bfrom\b|\breturning\b|$)/i;

/** The keys a `.set({...})` literal names, and its `status` value when that is a string literal. */
function setLiteral(update: ts.CallExpression): { keys: string[]; status: string | null; opaque: boolean } | null {
  const access = update.parent;
  if (!access || !ts.isPropertyAccessExpression(access) || access.name.text !== "set") return null;
  const call = access.parent;
  if (!call || !ts.isCallExpression(call) || call.expression !== access || call.arguments.length === 0) return null;
  const arg = unwrap(call.arguments[0]);
  if (!ts.isObjectLiteralExpression(arg)) return { keys: [], status: null, opaque: true };
  const keys: string[] = [];
  let status: string | null = null;
  let opaque = false;
  for (const p of arg.properties) {
    const key = propertyKey(p);
    if (key === null) {
      opaque = true;
      continue;
    }
    keys.push(key);
    if (key === "status" && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(unwrap(p.initializer))) {
      status = (unwrap(p.initializer) as ts.StringLiteralLike).text;
    }
  }
  return { keys, status, opaque };
}

/**
 * Calls that only READ a table handed to them: the select builder's from and
 * joins, Drizzle's name/column/config lookups, `alias()`, `$count`. Anything
 * else that receives the deals table is counted as a write path.
 */
const TABLE_READ_CALLS = new Set([
  "from",
  "innerJoin",
  "leftJoin",
  "rightJoin",
  "fullJoin",
  "crossJoin",
  "getTableName",
  "getTableColumns",
  "getTableConfig",
  "alias",
  "$count",
]);

/** A `+` operand of an enclosing `+` (only the outermost chain is read). */
const isPlusOperand = (n: ts.Node): boolean => {
  let p = n.parent;
  while (p && ts.isParenthesizedExpression(p)) p = p.parent; // `a + (b + c)` is one chain
  return !!p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken;
};
/**
 * A `+` chain read as ONE statement: string and template leaves as text, any
 * other leaf (`status`, `t`) as a numbered placeholder exactly like a
 * template's `${…}` — so `"UPDATE deals " + "SET status = '" + s + "'"` and
 * `` `UPDATE ${t} ` + "SET …" `` read as the writes they are. Null when no
 * leaf is text (W10.4 re-audit 2). `leaves` collects the text leaves, which
 * the walker then does not read again on their own.
 */
function concatChain(e: ts.Expression, exprs: ts.Expression[], leaves: ts.Node[]): string | null {
  const parts: string[] = [];
  let anyText = false;
  const visit = (node: ts.Expression) => {
    const x = ts.isParenthesizedExpression(node) ? node.expression : node;
    if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      visit(x.left);
      visit(x.right);
    } else if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
      anyText = true;
      leaves.push(x);
      parts.push(x.text);
    } else if (ts.isTemplateExpression(x)) {
      anyText = true;
      leaves.push(x);
      parts.push(x.head.text + x.templateSpans.map((sp) => ` $x${exprs.push(sp.expression) - 1} ${sp.literal.text}`).join(""));
    } else {
      parts.push(` $x${exprs.push(x) - 1} `);
    }
  };
  visit(e);
  return anyText ? parts.join("") : null;
}

/** Every direct write to the deals table in a parsed file. */
function directDealsWrites(sf: ts.SourceFile): Array<{ line: number; shape: string; setColumns?: string[] }> {
  const { names, namespaces, otherSchema } = dealsBindings(sf);
  const out: Array<{ line: number; shape: string; setColumns?: string[] }> = [];
  const isDealsRef = (e: ts.Expression): boolean => {
    const x = unwrap(e);
    if (ts.isIdentifier(x)) return names.has(x.text);
    if (ts.isConditionalExpression(x)) return isDealsRef(x.whenTrue) || isDealsRef(x.whenFalse);
    if (ts.isCallExpression(x) && memberName(x.expression) === "alias" && x.arguments[0]) return isDealsRef(x.arguments[0]);
    if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && names.has(`${x.expression.text}.${x.name.text}`)) return true;
    if (ts.isPropertyAccessExpression(x)) return x.name.text === "deals" && ts.isIdentifier(x.expression) && namespaces.has(x.expression.text);
    if (ts.isElementAccessExpression(x)) {
      const k = unwrap(x.argumentExpression);
      const o = unwrap(x.expression);
      return ts.isStringLiteralLike(k) && k.text === "deals" && ts.isIdentifier(o) && namespaces.has(o.text);
    }
    return false;
  };
  /** An interpolated table we can name as some OTHER schema table. */
  const isOtherTableRef = (e: ts.Expression): boolean => {
    const x = unwrap(e);
    if (ts.isIdentifier(x)) return otherSchema.has(x.text);
    if (ts.isPropertyAccessExpression(x)) return x.name.text !== "deals" && ts.isIdentifier(x.expression) && namespaces.has(x.expression.text);
    return false;
  };
  /** Text leaves already read as part of an enclosing `+` chain. */
  const consumed = new Set<ts.Node>();
  walk(sf, (n) => {
    if (ts.isCallExpression(n)) {
      // The table handed to anything but a read (`.from`, a join, a
      // name/column lookup) — `orgScopedDb.updateById(deals, id, patch)`, a
      // local helper — may be written through it (W10.4 re-audit 2).
      const callee = memberName(n.expression) ?? "";
      if (!["insert", "update", "delete"].includes(callee) && !TABLE_READ_CALLS.has(callee)) {
        for (const a of n.arguments) {
          if (isDealsRef(a)) out.push({ line: lineOf(sf, n), shape: `deals passed to ${callee || "<call>"}()` });
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const verb = n.expression.name.text;
      if ((verb === "insert" || verb === "update" || verb === "delete") && n.arguments.length > 0 && isDealsRef(n.arguments[0])) {
        // A Drizzle update whose SET is exactly the soft delete (status →
        // "deleted", plus the timestamp) is its own shape, so a registered
        // cascade cannot quietly start writing a live status.
        const set = verb === "update" ? setLiteral(n) : null;
        const softDelete =
          set !== null && !set.opaque && set.status === "deleted" && set.keys.every((k) => k === "status" || k === "updatedAt");
        out.push({ line: lineOf(sf, n), shape: softDelete ? ".update(deals) soft-delete" : `.${verb}(deals)` });
      }
    }
    // Raw SQL: the text of every string / template literal (interpolations
    // read as a numbered placeholder), so a tagged sql`…`, a sql.raw("…") and
    // a db.execute("…") are all the same population.
    if (consumed.has(n)) return;
    let text: string | null = null;
    let exprs: ts.Expression[] = [];
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateExpression(n)) {
      exprs = n.templateSpans.map((sp) => sp.expression);
      text = n.head.text + n.templateSpans.map((sp, i) => ` $x${i} ${sp.literal.text}`).join("");
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && !isPlusOperand(n)) {
      const leaves: ts.Node[] = [];
      text = concatChain(n, exprs, leaves);
      if (text !== null) for (const l of leaves) consumed.add(l);
    }
    if (text === null) return;
    text = stripSqlComments(text);
    if (RAW_DEALS_WRITE.test(text)) {
      const m = /^\s*update\b/i.test(text.slice(text.search(RAW_DEALS_WRITE))) ? SET_COLUMNS.exec(text) : null;
      const setColumns = m ? [...m[1].matchAll(/"?(\w+)"?\s*=/g)].map((c) => c[1].toLowerCase()) : undefined;
      out.push({ line: lineOf(sf, n), shape: "raw SQL", setColumns });
      return;
    }
    // The table is an interpolation. `${deals}` (any binding) IS a deals
    // write; `${leads}` is provably another table; anything else — an
    // `ident(table)`, a `rule.table` — cannot be resolved, so it is an
    // offender until registered.
    for (const m of text.matchAll(INTERPOLATED_WRITE)) {
      if (/^update/i.test(m[0]) && !/\bset$/i.test(m[0])) continue; // "update ${n} deal(s)" is prose
      const expr = exprs[Number(m[1])];
      if (!expr) continue;
      if (isDealsRef(expr)) {
        const rest = text.slice((m.index ?? 0) + m[0].length - (/\bset$/i.test(m[0]) ? 3 : 0));
        const sm = /^\s*set\b/i.test(rest) ? SET_COLUMNS.exec(rest) : null;
        const setColumns = sm ? [...sm[1].matchAll(/"?(\w+)"?\s*=/g)].map((c) => c[1].toLowerCase()) : undefined;
        out.push({ line: lineOf(sf, n), shape: "raw SQL", setColumns });
      } else if (!isOtherTableRef(expr)) {
        out.push({ line: lineOf(sf, n), shape: "raw SQL (unresolved table)" });
      }
    }
  });
  return out;
}

/**
 * Direct writes outside the repository that are NOT status writes, each held
 * to an exact count and to the columns its SET may name.
 */
const DIRECT_WRITE_EXEMPTIONS: Record<string, { count: number; columns: string[]; reason: string }> = {
  "server/services/paxLearning.ts": {
    count: 1,
    columns: ["property_id"],
    reason: "orphaned_deals repair: nulls a property link that points at no property of this org — no status, no tenant key",
  },
};

/**
 * The ONE file that writes the deals table freely is the deal repository.
 * Every other direct write — the property cascades, the retention purge, the
 * workspace clear, and any raw write whose table the parser cannot resolve —
 * is registered here by its exact SHAPE and count, with what it writes.
 */
const DEAL_REPO = "server/storage/dealRepo.ts";
const REGISTERED_DIRECT_WRITES: Record<string, Array<{ shape: string; count: number; reason: string }>> = {
  "server/storage/propertyRepo.ts": [
    {
      shape: ".update(deals) soft-delete",
      count: 2,
      reason: "deleteProperty / bulkDeleteProperties cascade: a deleted parcel's deals are soft-deleted (status → \"deleted\" only, org-scoped) and a closed one's comp is retracted via recordDealTransitionEvidence",
    },
  ],
  "server/storage/auditRepo.ts": [
    {
      shape: ".delete(deals)",
      count: 1,
      reason: "purgeOldDeals: the retention purge HARD-deletes an org's deals of one status older than a date, skipped under a legal hold — a removal, never a status write",
    },
  ],
  "server/services/orgDataClear.ts": [
    {
      shape: "raw SQL (unresolved table)",
      count: 2,
      reason: "Settings → Clear data (owner-only, canDeleteOrg): `DELETE FROM ${ident(table)}` over the FK closure of CLEAR_ROOT_TABLES, which includes deals — a hard delete of the whole org book, never a status write",
    },
  ],
  "server/services/paxHallucinationGuard.ts": [
    {
      shape: "deals passed to checkEntitiesExist()",
      count: 1,
      reason: "a READ: checkEntitiesExist selects the ids of the table it is handed, org-scoped, to confirm the deal ids Pax cited exist in this org — it never writes",
    },
  ],
  "server/jobs/dataRetention.ts": [
    {
      shape: "raw SQL (unresolved table)",
      count: 1,
      reason: "retention sweep: `DELETE FROM ${rule.table}` over a literal list of telemetry/log tables (job_health_logs, agent_events, activity_log, …) — deals is not among them",
    },
  ],
};

// ── (b) and (c) the repository's write calls ─────────────────────────────────

const WRITE_METHODS = new Set(["createDeal", "updateDeal", "bulkUpdateDeals"]);
const ROUTE_VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);

type WriteSite = {
  file: string;
  line: number;
  method: string;
  /** createDeal only: the creation kind, "opening" for the default path, null when not a literal. */
  creation: string | null;
  /** update calls: false only when the payload is an object literal with no `status` and no spread. */
  writesStatus: boolean;
  /** The enclosing inline route handler, if any, and whether it maps through sendDealWriteError. */
  handler: { route: string; maps: boolean } | null;
  /** file::function#case — the registry key for a non-route writer. */
  key: string;
};

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

/** The route a function is the handler of: it is an argument (or inside a wrapper argument) of `x.verb("/path", …)`. */
function routeOf(fn: ts.Node): string | null {
  let child: ts.Node = fn;
  let p: ts.Node | undefined = fn.parent;
  // Climb through wrappers — `asyncHandler(async (req, res) => …)`, `wrap(fn)` —
  // but never out through another function body.
  while (p && ts.isCallExpression(p) && !isRouteCall(p) && p.arguments.includes(child as ts.Expression)) {
    child = p;
    p = p.parent;
  }
  if (p && ts.isCallExpression(p) && isRouteCall(p) && p.arguments.indexOf(child as ts.Expression) > 0) {
    return (p.arguments[0] as ts.StringLiteralLike).text;
  }
  return null;
}
function isRouteCall(c: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(c.expression) &&
    ROUTE_VERBS.has(c.expression.name.text) &&
    c.arguments.length >= 2 &&
    ts.isStringLiteralLike(c.arguments[0]) &&
    c.arguments[0].text.startsWith("/")
  );
}
function callsName(node: ts.Node, name: string): boolean {
  let found = false;
  walk(node, (n) => {
    if (found || !ts.isCallExpression(n)) return;
    const e = n.expression;
    if ((ts.isIdentifier(e) && e.text === name) || (ts.isPropertyAccessExpression(e) && e.name.text === name)) found = true;
  });
  return found;
}
function nameOfFunction(fn: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return p.name.getText().replace(/^["']|["']$/g, "");
  return null;
}

/** The name a member access calls: `x.m`, `x["m"]`; null when computed. */
function memberName(e: ts.Expression): string | null {
  const x = unwrap(e);
  if (ts.isPropertyAccessExpression(x)) return x.name.text;
  if (ts.isElementAccessExpression(x) && ts.isStringLiteralLike(unwrap(x.argumentExpression))) {
    return (unwrap(x.argumentExpression) as ts.StringLiteralLike).text;
  }
  if (ts.isIdentifier(x)) return x.text;
  return null;
}

/**
 * Which repository write a call is, and where its arguments start:
 * `s.updateDeal(…)`, `s["updateDeal"](…)`, `s.updateDeal.call(thisArg, …)`;
 * `.apply(thisArg, args)` hides its arguments (`args: null` — unresolved).
 */
function writeCall(n: ts.CallExpression): { method: string; args: readonly ts.Expression[] | null } | null {
  const direct = memberName(n.expression);
  if (direct && WRITE_METHODS.has(direct)) return { method: direct, args: n.arguments };
  const callee = unwrap(n.expression);
  const via = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  if (via === "call" || via === "apply") {
    const target = memberName((callee as ts.PropertyAccessExpression).expression);
    if (target && WRITE_METHODS.has(target)) return { method: target, args: via === "call" ? n.arguments.slice(1) : null };
  }
  return null;
}

/** A property's key when it is statically known (`a`, `"a"`, `["a"]`); null for a spread or a computed key. */
function propertyKey(p: ts.ObjectLiteralElementLike): string | null {
  if (ts.isSpreadAssignment(p)) return null;
  const name = p.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(unwrap(name.expression))) return (unwrap(name.expression) as ts.StringLiteralLike).text;
  return null;
}

/** The nearest TryStatement whose TRY block holds `n` (not its catch/finally), up to `stop`. */
function nearestTry(n: ts.Node, stop: ts.Node | null): ts.TryStatement | null {
  let child: ts.Node = n;
  for (let p: ts.Node | undefined = n.parent; p; child = p, p = p.parent) {
    if (ts.isTryStatement(p) && p.tryBlock === child) return p;
    if (p === stop) return null;
  }
  return null;
}

/**
 * A write method named but NOT called in place — `storage.updateDeal.bind(s)`,
 * `const fn = storage.updateDeal`, `Reflect.apply(storage.updateDeal, …)` —
 * so its call (and its arguments) cannot be read. It counts as a write whose
 * payload is unknown (W10.4 re-audit). A type position (`typeof
 * storage.updateDeal`) is not a reference to the function value.
 */
function detachedWriteReference(n: ts.Node): string | null {
  if (!ts.isPropertyAccessExpression(n) && !ts.isElementAccessExpression(n)) return null;
  const name = memberName(n);
  if (!name || !WRITE_METHODS.has(name)) return null;
  const parent = n.parent;
  if (ts.isCallExpression(parent) && parent.expression === n) return null; // called in place
  if (
    ts.isPropertyAccessExpression(parent) &&
    (parent.name.text === "call" || parent.name.text === "apply") &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  )
    return null; // .call / .apply — read by writeCall
  for (let p: ts.Node | undefined = parent; p; p = p.parent) if (ts.isTypeNode(p)) return null;
  return name;
}

function writeSites(sf: ts.SourceFile, file: string): WriteSite[] {
  const out: WriteSite[] = [];
  walk(sf, (n) => {
    const detached = detachedWriteReference(n);
    const wc = ts.isCallExpression(n) ? writeCall(n) : detached ? { method: detached, args: null } : null;
    if (!wc) return;
    const { method, args } = wc;

    let creation: string | null = null;
    let writesStatus = true;
    if (method === "createDeal") {
      const opts = args ? args[2] : undefined;
      if (args && !opts) creation = "opening";
      else if (opts) {
        const o = unwrap(opts);
        if (ts.isObjectLiteralExpression(o)) {
          // A spread or a computed key could carry `creation`: unresolved.
          const unresolved = o.properties.some((p) => propertyKey(p) === null);
          const prop = o.properties.find((p) => propertyKey(p) === "creation");
          if (unresolved) creation = null;
          else if (!prop) creation = "opening";
          else if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(unwrap(prop.initializer))) {
            creation = (unwrap(prop.initializer) as ts.StringLiteralLike).text;
          }
        }
      }
    } else {
      const payload = args ? args[method === "updateDeal" ? 1 : 2] : undefined;
      const o = payload ? unwrap(payload) : undefined;
      if (o && ts.isObjectLiteralExpression(o)) {
        // A spread or a computed key may be `status`; only a literal
        // object of statically-named keys without it is a non-status write.
        writesStatus = o.properties.some((p) => {
          const key = propertyKey(p);
          return key === null || key === "status";
        });
      }
    }

    // The innermost function that is a route handler, walking out from the
    // call. "Maps" means the write's NEAREST enclosing try (within the
    // handler) catches through sendDealWriteError — not that the mapper is
    // called somewhere in the handler: a second try/catch that maps cannot
    // vouch for a write whose own catch answers 500.
    let handler: WriteSite["handler"] = null;
    let fnName: string | null = null;
    let caseLabel: string | null = null;
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (!caseLabel && ts.isCaseClause(p) && ts.isStringLiteralLike(p.expression)) caseLabel = p.expression.text;
      if (isFunctionLike(p)) {
        const route = routeOf(p);
        if (route && !handler) {
          const t = nearestTry(n, p);
          // sendDealWriteError answers the request; dealWriteErrorCode is its
          // per-item twin for a batch that answers 207 per deal (same file,
          // same three refusals). Either, in the write's own catch.
          const c = t?.catchClause;
          handler = { route, maps: !!c && (callsName(c, "sendDealWriteError") || callsName(c, "dealWriteErrorCode")) };
        }
        if (!fnName) fnName = nameOfFunction(p);
      }
    }
    const key = `${file}::${fnName ?? "<anonymous>"}${caseLabel ? `#${caseLabel}` : ""}`;
    out.push({ file, line: lineOf(sf, n), method, creation, writesStatus, handler, key });
  });
  return out;
}

/**
 * Non-opening creations, by file. A deal born past an opening stage carries
 * history — never an AcreOS-observed sale — so the repository runs no close
 * effects for it; each kind must say why it is one.
 */
const NON_OPENING_CREATIONS: Record<string, { creation: "import" | "sample"; reason: string }> = {
  "server/services/importExport.ts": {
    creation: "import",
    reason: "the CSV deal import carries the customer's history — a row may already be closed; a word that is not a deal status is refused and counted, never defaulted",
  },
  "server/services/onboarding/sampleSeeder.ts": {
    creation: "sample",
    reason: "the onboarding sample book shows a closed and an in-escrow demo deal on sample parcels, which every money surface excludes",
  },
  "server/routes-admin.ts": {
    creation: "sample",
    reason: "Settings → Developer Tools seed-demo (owner/admin: canImportData) builds demo deals on SAMPLE- parcels — fixtures every money surface and the close hook treat as the sample book, never observed sales",
  },
};

/**
 * Deal status writers that are not route handlers, and how each one's
 * refusals (DealTransitionRefusedError, StaleDealWriteError,
 * DealCreationRefusedError) surface. Keyed file::function#case.
 */
const NON_ROUTE_WRITERS: Record<string, string> = {
  "server/ai/tools.ts::executeTool#create_deal": "Pax: a refused creation is returned as { success: false, error } — no receipt is written for an effect that did not happen",
  "server/ai/tools.ts::executeTool#update_deal": "Pax: a refused or stale move is returned as { success: false, error } naming why; no receipt",
  "server/ai/tools.ts::executeTool#generate_offer_letter": "Pax: the letter stands; a refused pipeline deal is reported in the result (pipelineDeal.created=false + reason), never as a deal id",
  "server/ai/tools.ts::executeTool#draft_offer": "Pax: the draft stands; the advance to offer_sent is reported as applied or not, with the refusal",
  "server/services/executionEngine.ts::advance_deal_stage": "autopilot: a refused or stale move is an ExecutionResult failure naming it — the side effect list stays empty",
  "server/services/workflow-engine.ts::executeUpdateRecord#deal": "workflow update_record: a refusal throws into the run log as a failed action, never reported as updated",
  "server/services/importExport.ts::importDeals": "CSV import: a refused row (an unknown status, or one the repository refuses) is counted in errorCount with its row number and reason — never written, never defaulted",
  "server/services/onboarding/sampleSeeder.ts::seedSampleDataForOrg": "sample seeding: fixtures are real DEAL_STATUSES members; a refusal throws out of the seeder, which reports the seed failed rather than a partial book as complete",
  "server/services/voiceCallAI.ts::applyCRMUpdates": "voice CRM: a refused or stale deal write is logged and dropped from crmUpdatesApplied — the transcript never records a status it did not apply",
};

type Census = {
  files: number;
  parseFailures: string[];
  direct: Array<{ file: string; line: number; shape: string; setColumns?: string[] }>;
  sites: WriteSite[];
};
let censusMemo: Census | null = null;
function census(): Census {
  if (censusMemo) return censusMemo;
  const c: Census = { files: 0, parseFailures: [], direct: [], sites: [] };
  for (const abs of serverFiles()) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const src = fs.readFileSync(abs, "utf8");
    c.files++;
    const sf = parse(src, abs);
    if (parseErrors(sf) > 0 && /deals|createDeal|updateDeal/.test(src)) c.parseFailures.push(rel);
    // ONE exempt file: the deal repository itself. The rest of server/storage/
    // is in the population — its cascades are registered, not assumed.
    if (rel !== DEAL_REPO) {
      for (const w of directDealsWrites(sf)) c.direct.push({ file: rel, ...w });
      c.sites.push(...writeSites(sf, rel));
    }
  }
  censusMemo = c;
  return c;
}

// ── Canaries: each shape the census relies on, hidden in a fixture ───────────

const fx = (src: string, name = "server/routes-fixture.ts") => parse(src, name);

describe("canaries — the census goes red on every shape it claims to read", () => {
  const direct = (src: string) => directDealsWrites(fx(src)).map((w) => w.shape);

  it("(a) a direct insert/update/delete by every binding of the table", () => {
    expect(direct(`import { deals } from "@shared/schema"; db.insert(deals).values(x);`)).toEqual([".insert(deals)"]);
    expect(direct(`import { deals as d } from "../shared/schema"; tx.update(d).set(x);`)).toEqual([".update(deals)"]);
    expect(direct(`import * as schema from "@shared/schema"; db.delete(schema.deals);`)).toEqual([".delete(deals)"]);
    expect(direct(`async function f(){ const { deals: dt } = await import("@shared/schema"); await db.insert(dt).values(v); }`)).toEqual([".insert(deals)"]);
    expect(direct(`async function f(){ const s = await import("@shared/schema"); await db.update(s.deals).set(v); }`)).toEqual([".update(deals)"]);
    expect(direct("db.execute(sql`INSERT INTO deals (status) VALUES (${s})`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`UPDATE deals SET property_id = ${p} WHERE id = ${id}`);")).toEqual(["raw SQL"]);
    expect(direct(`db.execute(sql.raw("delete from \\"deals\\" where id = 1"));`)).toEqual(["raw SQL"]);
  });

  it("(a) every raw spelling of the table: interpolated, ONLY, quoted and schema-qualified", () => {
    const imp = `import { deals, leads } from "@shared/schema";\n`;
    expect(direct(imp + "db.execute(sql`UPDATE ${deals} SET status = ${s} WHERE id = ${i}`);")).toEqual(["raw SQL"]);
    expect(direct(imp + "db.execute(sql`update ${deals} d set status = 'closed'`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`UPDATE ONLY deals SET status = 'closed'`);")).toEqual(["raw SQL"]);
    expect(direct('db.execute(sql`UPDATE "public"."deals" SET "status" = ${s}`);')).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`UPDATE public.deals SET status = ${s}`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`DELETE FROM ONLY deals WHERE id = ${i}`);")).toEqual(["raw SQL"]);
    expect(direct('db.execute(sql`INSERT INTO "public"."deals" (status) VALUES (${s})`);')).toEqual(["raw SQL"]);
    // An interpolated table the parser cannot name is UNRESOLVED — an offender until registered.
    expect(direct("db.execute(sql.raw(`DELETE FROM ${ident(table)} WHERE organization_id = ${o}`));")).toEqual(["raw SQL (unresolved table)"]);
    expect(direct("db.execute(sql`UPDATE ${t} SET status = ${s}`);")).toEqual(["raw SQL (unresolved table)"]);
    expect(direct("db.execute(sql`INSERT INTO ${rule.table} (a) VALUES (1)`);")).toEqual(["raw SQL (unresolved table)"]);
    // …while one provably naming ANOTHER schema table is not a deals write, and prose is prose.
    expect(direct(imp + "db.execute(sql`UPDATE ${leads} SET status = ${s}`);")).toEqual([]);
    expect(direct("const m = `This will update ${n} deal(s) to stage ${s}`;")).toEqual([]);
    expect(direct("const m = `Refusing to UPDATE ${what} with an empty patch`;")).toEqual([]);
    // The SET columns of an interpolated deals write are still read.
    expect(directDealsWrites(fx(imp + "sql`UPDATE ${deals} SET property_id = NULL, status = ${s}`")).map((w) => w.setColumns)).toEqual([["property_id", "status"]]);
  });

  it("(a) the spellings the W10.4 re-audit walked past: aliases, namespace keys, assertions, comments, verbs, concatenation", () => {
    const imp = `import { deals } from "@shared/schema";\n`;
    const ns = `import * as schema from "@shared/schema";\n`;
    expect(direct(imp + "const t = deals; db.update(t).set(v);")).toEqual([".update(deals)"]);
    expect(direct(imp + "const t = deals; const u = t; db.delete(u);")).toEqual([".delete(deals)"]);
    expect(direct(ns + "const { deals: d } = schema; db.insert(d).values(v);")).toEqual([".insert(deals)"]);
    expect(direct(ns + 'db.update(schema["deals"]).set(v);')).toEqual([".update(deals)"]);
    expect(direct(ns + "const s2 = schema; db.update(s2.deals).set(v);")).toEqual([".update(deals)"]);
    expect(direct(imp + "db.update(deals satisfies object).set(v);")).toEqual([".update(deals)"]);
    expect(direct(imp + "db.update(<any>deals).set(v);")).toEqual([".update(deals)"]);
    expect(direct("db.execute(sql`UPDATE deals /* x */ SET status = ${s}`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`UPDATE deals -- why\n SET status = ${s}`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`MERGE INTO deals d USING x ON d.id = x.id WHEN MATCHED THEN UPDATE SET status = x.s`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`TRUNCATE deals`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`TRUNCATE TABLE leads, deals CASCADE`);")).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`COPY deals (id, status) FROM STDIN`);")).toEqual(["raw SQL"]);
    expect(direct('db.execute(sql.raw("UPDATE deals " + "SET status = \'closed\'"));')).toEqual(["raw SQL"]);
    // W10.4 re-audit 2: concatenation with live values, comments inside a string, more bindings.
    expect(direct(`db.execute(sql.raw("UPDATE deals " + "SET status = '" + status + "'"));`)).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql.raw(`UPDATE deals ` + `SET status = ${s}`));")).toEqual(["raw SQL"]);
    expect(direct(imp + "db.execute(sql.raw(`UPDATE ${deals} ` + \"SET status = 'x'\"));")).toEqual(["raw SQL"]);
    expect(direct('db.execute(sql.raw("UPDATE " + t + " SET status = 1"));')).toEqual(["raw SQL (unresolved table)"]);
    expect(direct("db.execute(sql`UPDATE leads SET note = '--'; UPDATE deals SET status = 'closed'`);")).toEqual(["raw SQL"]);
    expect(direct(imp + "let t; t = deals; db.update(t).set(v);")).toEqual([".update(deals)"]);
    expect(direct(imp + "const [t] = [deals]; db.delete(t);")).toEqual([".delete(deals)"]);
    expect(direct(imp + "const T = { deals }; db.update(T.deals).set(v);")).toEqual([".update(deals)"]);
    expect(direct(imp + "const T = { d: deals }; db.insert(T.d).values(v);")).toEqual([".insert(deals)"]);
    expect(direct(imp + "await orgScopedDb.updateById(deals, id, { status: s });")).toEqual(["deals passed to updateById()"]);
    expect(direct(imp + "await writeRow(deals, patch);")).toEqual(["deals passed to writeRow()"]);
    // W10.4 re-audit 3.
    expect(direct(imp + 'const d = alias(deals, "d"); db.update(d).set({ status: "closed" });')).toEqual([".update(deals)"]);
    expect(direct(imp + "db.update(flag ? deals : leads).set(v);")).toEqual([".update(deals)"]);
    expect(direct(imp + "const T = { deals }; const t = T.deals; db.update(t).set(v);")).toEqual([".update(deals)"]);
    expect(direct('db.execute(sql.raw("UPDATE deals " + setClause + " WHERE id = " + id));')).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`UPDATE deals ${setClause} WHERE id = ${id}`);")).toEqual(["raw SQL"]);
    expect(direct(`db.execute(sql\`SELECT 1 AS "don't"; UPDATE deals /* c */ SET status = 'x'\`);`)).toEqual(["raw SQL"]);
    expect(direct("db.execute(sql`SELECT E'it\\\\'s'; UPDATE deals /* c */ SET status = 'x'`);")).toEqual(["raw SQL"]);
    expect(direct('db.execute(sql.raw("/*x*/ " + ("UPDATE deals SET status = " + v)));')).toEqual(["raw SQL"]);
    // One statement split across a chain is ONE write, not one per piece.
    expect(direct('db.execute(sql.raw("DELETE FROM deals WHERE id = 1" + ""));')).toEqual(["raw SQL"]);
    expect(direct('db.execute(sql.raw("INSERT INTO deals " + "(status) VALUES (1)"));')).toEqual(["raw SQL"]);
    // …and a READ of the handed table is not a write.
    expect(direct(imp + "db.select().from(deals).innerJoin(leads, j); getTableName(deals); alias(deals, 'd');")).toEqual([]);
    // …and still not prose, another table, or a read.
    expect(direct("db.execute(sql`COPY leads FROM STDIN`);")).toEqual([]);
    expect(direct('logger.info("merged " + "deals into one");')).toEqual([]);
    expect(direct("db.execute(sql`SELECT * FROM deals -- UPDATE deals SET x\n`);")).toEqual([]);
  });

  it("(a) a Drizzle update's SET decides its shape: only status → \"deleted\" is the soft-delete cascade", () => {
    const imp = `import { deals } from "@shared/schema";\n`;
    expect(direct(imp + `db.update(deals).set({ status: "deleted", updatedAt: new Date() }).where(w);`)).toEqual([".update(deals) soft-delete"]);
    expect(direct(imp + `db.update(deals).set({ status: "closed", updatedAt: new Date() }).where(w);`)).toEqual([".update(deals)"]);
    expect(direct(imp + `db.update(deals).set({ status: "deleted", acceptedAmount: a }).where(w);`)).toEqual([".update(deals)"]);
    expect(direct(imp + `db.update(deals).set({ ...u, status: "deleted" }).where(w);`)).toEqual([".update(deals)"]);
    expect(direct(imp + `db.update(deals).set(u).where(w);`)).toEqual([".update(deals)"]);
  });

  it("(a) a read, a comment, and a different table are not writes", () => {
    expect(direct(`import { deals } from "@shared/schema";\n// db.insert(deals) was removed\ndb.select().from(deals);`)).toEqual([]);
    expect(direct(`import { dealDocuments } from "@shared/schema"; db.insert(dealDocuments).values(x); sql\`UPDATE deal_documents SET a = 1\`;`)).toEqual([]);
    expect(direct(`/* sql\`INSERT INTO deals\` */ const x = 1;`)).toEqual([]);
    expect(direct(`logger.error("Bulk stage update deals error");`)).toEqual([]);
  });

  it("(a) a raw UPDATE's SET columns are read, so an exemption cannot cover a status write", () => {
    const cols = (src: string) => directDealsWrites(fx(src)).map((w) => w.setColumns);
    expect(cols("sql`UPDATE deals SET property_id = NULL WHERE organization_id = ${o}`")).toEqual([["property_id"]]);
    expect(cols("sql`UPDATE deals SET property_id = NULL, status = 'closed' WHERE id = ${i}`")).toEqual([["property_id", "status"]]);
    expect(cols('sql`update "deals" set "status" = ${s}`')).toEqual([["status"]]);
  });

  it("(b) a createDeal's creation is read from its third argument; a computed one is null", () => {
    const sites = writeSites(
      fx(`storage.createDeal(a); storage.createDeal(a, undefined, { creation: "import" }); storage.createDeal(a, tx); storage.createDeal(a, undefined, { creation: kind });`),
      "f.ts",
    );
    expect(sites.map((s) => s.creation)).toEqual(["opening", "import", "opening", null]);
  });

  it("(b) a spread or computed options object is unresolved (null), never the opening default", () => {
    const sites = writeSites(
      fx(`storage.createDeal(d, undefined, { ...o }); storage.createDeal(d, undefined, { [k]: "sample" }); storage.createDeal(d, undefined, { ["creation"]: "import" }); storage.createDeal(d, undefined, opts);`),
      "f.ts",
    );
    expect(sites.map((s) => s.creation)).toEqual([null, null, "import", null]);
  });

  it("(b)(c) every call spelling of a repository write is found: member, element, .call, .apply", () => {
    const sites = writeSites(
      fx(`storage["updateDeal"](1, { notes: "x" }); storage.updateDeal.call(storage, 1, { status: s }); storage["createDeal"].call(storage, d, undefined, { creation: "import" }); storage.bulkUpdateDeals.apply(storage, args); storage.createDeal.apply(storage, args);`),
      "f.ts",
    );
    expect(sites.map((s) => [s.method, s.writesStatus, s.creation])).toEqual([
      ["updateDeal", false, null],
      ["updateDeal", true, null],
      ["createDeal", true, "import"],
      ["bulkUpdateDeals", true, null], // .apply hides the payload: a status write
      ["createDeal", true, null], // …and the creation: unresolved
    ]);
  });

  /** One fixture per handler shape: the write is found inside it, and the mapper is (or is not) seen. */
  const handlerShapes: Record<string, string> = {
    inline: `router.put("/a", async (req, res) => { try { await storage.updateDeal(1, { status: s }); } catch (e) { Errors.internal(res, e); } });`,
    wrapped: `router.put("/a", asyncHandler(async (req, res) => { await storage.bulkUpdateDeals(1, ids, upd); }));`,
    nestedTx: `app.post("/a", async (req, res) => { await db.transaction(async (tx) => { await storage.createDeal(d, tx); }); });`,
    trailingComma: `app.post(\n  "/a",\n  isAuthenticated,\n  async (req, res) => { await storage.updateDeal(1, u); },\n);`,
    sync: `router.post("/a", (req, res) => { storage.updateDeal(1, { status: "x" }); res.json({}); });`,
  };
  it.each(Object.entries(handlerShapes))("(c) %s handler: the write is in it, and a missing mapper is seen", (_shape, src) => {
    const [site] = writeSites(fx(src), "f.ts");
    expect(site, "the write call was not found").toBeDefined();
    expect(site.handler?.route).toBe("/a");
    expect(site.handler?.maps).toBe(false);
    const mapped = src.replace(/(await )?storage\.(\w+)\(([^;]*)\);/, "try { $1storage.$2($3); } catch (e) { if (sendDealWriteError(res, e)) return; }");
    const [m] = writeSites(fx(mapped), "f.ts");
    expect(m.handler?.maps, mapped).toBe(true);
  });

  it("(b)(c) a write method named but not called in place is a write with an unknown payload", () => {
    const sites = writeSites(
      fx(
        "const fn = storage.updateDeal; await fn.call(storage, 1, p);\n" +
          "const g = storage.updateDeal.bind(storage);\n" +
          "Reflect.apply(storage.createDeal, storage, [d]);\n" +
          "type P = Parameters<typeof storage.updateDeal>;",
        "server/services/fixture.ts",
      ),
      "server/services/fixture.ts",
    );
    expect(sites.map((x) => `${x.method}:${x.writesStatus}:${x.creation}`)).toEqual([
      "updateDeal:true:null",
      "updateDeal:true:null",
      "createDeal:true:null",
    ]);
  });

  it("(c) a write in a named handler declared elsewhere is in NO inline handler — so it must be registered", () => {
    const [site] = writeSites(fx(`async function handleIt(req, res) { await storage.updateDeal(1, { status: s }); }\nrouter.put("/a", handleIt);`), "f.ts");
    expect(site.handler).toBeNull();
    expect(site.key).toBe("f.ts::handleIt");
  });

  it("(c) a payload without status is a non-status write; a spread or opaque payload counts as a status write", () => {
    const sites = writeSites(
      fx(`storage.updateDeal(1, { notes: "x" }); storage.updateDeal(1, { ...u }); storage.updateDeal(1, u); storage.updateDeal(1, { "status": s });`),
      "f.ts",
    );
    expect(sites.map((s) => s.writesStatus)).toEqual([false, true, true, true]);
  });

  it("(c) a computed key is read: [\"status\"] is a status write, [k] may be one", () => {
    const sites = writeSites(
      fx(`storage.updateDeal(1, { ["status"]: s }); storage.updateDeal(1, { [k]: v }); storage.updateDeal(1, { ["notes"]: n }); storage.bulkUpdateDeals(1, ids, { status });`),
      "f.ts",
    );
    expect(sites.map((s) => s.writesStatus)).toEqual([true, true, false, true]);
  });

  it("(c) 'maps' is the write's NEAREST try: a second try/catch that maps cannot vouch for a write whose catch answers 500", () => {
    const twoTries = `router.put("/a", async (req, res) => {
      try { await storage.updateDeal(1, { status: s }); } catch (e) { return Errors.internal(res, e); }
      try { await other(); } catch (e) { if (sendDealWriteError(res, e)) return; Errors.internal(res, e); }
    });`;
    const [site] = writeSites(fx(twoTries), "f.ts");
    expect(site.handler?.maps).toBe(false);
    // Swap which try maps: now the write's own catch does.
    const swapped = `router.put("/a", async (req, res) => {
      try { await storage.updateDeal(1, { status: s }); } catch (e) { if (sendDealWriteError(res, e)) return; Errors.internal(res, e); }
      try { await other(); } catch (e) { return Errors.internal(res, e); }
    });`;
    expect(writeSites(fx(swapped), "f.ts")[0].handler?.maps).toBe(true);
    // A write in a CATCH block is not protected by that try.
    const inCatch = `router.put("/a", async (req, res) => {
      try { await x(); } catch (e) { if (sendDealWriteError(res, e)) return; await storage.updateDeal(1, { status: s }); }
    });`;
    expect(writeSites(fx(inCatch), "f.ts")[0].handler?.maps).toBe(false);
    // A per-item batch (207) classifies through the mapper's per-item twin.
    const perItem = `router.post("/a", async (req, res) => {
      for (const id of ids) { try { await storage.updateDeal(id, { status: s }); } catch (e) { errors.push({ id, code: dealWriteErrorCode(e) }); } }
    });`;
    expect(writeSites(fx(perItem), "f.ts")[0].handler?.maps).toBe(true);
    // A write nested in a transaction callback is covered by the handler's try around it.
    const nested = `router.put("/a", async (req, res) => {
      try { await db.transaction(async (tx) => { await storage.createDeal(d, tx); }); } catch (e) { if (sendDealWriteError(res, e)) return; Errors.internal(res, e); }
    });`;
    expect(writeSites(fx(nested), "f.ts")[0].handler?.maps).toBe(true);
  });

  it("(c) a Pax case is keyed by its case label", () => {
    const [site] = writeSites(fx(`export async function executeTool(n){ switch(n){ case "update_deal": { await storage.updateDeal(1, d); } } }`), "server/ai/tools.ts");
    expect(site.key).toBe("server/ai/tools.ts::executeTool#update_deal");
  });
});

// ── The census over the real tree ───────────────────────────────────────────

describe("the census over every production file under server/", () => {
  it("reads the whole tree, and every file that mentions a deal write parses", () => {
    const c = census();
    expect(c.files, "vacuity: the server tree was not read").toBeGreaterThan(1000);
    expect(c.parseFailures, c.parseFailures.join("\n")).toEqual([]);
  });

  it("(a) no file but the deal repository inserts, updates or deletes deals directly, unless registered", () => {
    const c = census();
    const offenders: string[] = [];
    const exemptSeen = new Map<string, number>();
    const registeredSeen = new Map<string, number>();
    for (const w of c.direct) {
      const ex = DIRECT_WRITE_EXEMPTIONS[w.file];
      // An exemption covers a raw UPDATE whose SET names only the columns it
      // was granted — never status, never the tenant key.
      const covered =
        ex !== undefined &&
        w.shape === "raw SQL" &&
        w.setColumns !== undefined &&
        w.setColumns.length > 0 &&
        w.setColumns.every((col) => ex.columns.includes(col));
      const registered = (REGISTERED_DIRECT_WRITES[w.file] ?? []).some((r) => r.shape === w.shape);
      if (covered) exemptSeen.set(w.file, (exemptSeen.get(w.file) ?? 0) + 1);
      else if (registered) registeredSeen.set(`${w.file}|${w.shape}`, (registeredSeen.get(`${w.file}|${w.shape}`) ?? 0) + 1);
      else offenders.push(`${w.file}:${w.line} ${w.shape}${w.setColumns ? ` SET ${w.setColumns.join(", ")}` : ""}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    // Each registered shape is held to its exact count: a new cascade, or a
    // registered one that vanished, is a change to look at.
    for (const [f, regs] of Object.entries(REGISTERED_DIRECT_WRITES)) {
      for (const r of regs) {
        expect(registeredSeen.get(`${f}|${r.shape}`) ?? 0, `${f}: registered ${r.shape} writes (stale or grown)`).toBe(r.count);
        expect(r.reason.length, f).toBeGreaterThan(40);
      }
    }
    for (const [f, ex] of Object.entries(DIRECT_WRITE_EXEMPTIONS)) {
      expect(exemptSeen.get(f) ?? 0, `${f}: exempted direct writes found (stale or grown)`).toBe(ex.count);
      expect(ex.columns).not.toContain("status");
      expect(ex.columns).not.toContain("organization_id");
    }
    // Vacuity, the other half: the same detector over the repository finds
    // the repository's own writes (createDeal's insert, updateDeal, the bulk
    // update and soft delete, the property cascades, the purge).
    let repoWrites = 0;
    let repoInserts = 0;
    for (const f of fs.readdirSync(path.join(ROOT, "server/storage"))) {
      if (!f.endsWith(".ts")) continue;
      const abs = path.join(ROOT, "server/storage", f);
      const ws = directDealsWrites(parse(fs.readFileSync(abs, "utf8"), abs));
      repoWrites += ws.length;
      repoInserts += ws.filter((w) => w.shape === ".insert(deals)").length;
    }
    expect(repoWrites, "vacuity: the detector found no writes even in the repository").toBeGreaterThanOrEqual(6);
    expect(repoInserts, "vacuity: createDeal's insert was not seen").toBeGreaterThanOrEqual(1);
  });

  it("(b) every createDeal outside the repository is the opening path or a registered, literal creation", () => {
    const creates = census().sites.filter((s) => s.method === "createDeal");
    // Vacuity: Pax ×2, POST /api/deals, the CSV import, the sample seeder, seed-demo.
    expect(creates.length).toBeGreaterThanOrEqual(6);
    const offenders: string[] = [];
    const matched = new Set<string>();
    for (const s of creates) {
      if (s.creation === null) {
        offenders.push(`${s.file}:${s.line} createDeal's creation is not a string literal`);
        continue;
      }
      if (s.creation === "opening") continue;
      const reg = NON_OPENING_CREATIONS[s.file];
      if (!reg || reg.creation !== s.creation) {
        offenders.push(`${s.file}:${s.line} creates a "${s.creation}" deal and is not registered in NON_OPENING_CREATIONS`);
        continue;
      }
      matched.add(s.file);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    const stale = Object.keys(NON_OPENING_CREATIONS).filter((f) => !matched.has(f));
    expect(stale, `registered non-opening creations with no matching call: ${stale.join(", ")}`).toEqual([]);
    for (const [f, r] of Object.entries(NON_OPENING_CREATIONS)) expect(r.reason.length, f).toBeGreaterThan(40);
  });

  it("(c) every status write or creation is in a handler that maps sendDealWriteError, or is a registered non-route writer", () => {
    const sites = census().sites.filter((s) => s.method === "createDeal" || s.writesStatus);
    const inHandlers = sites.filter((s) => s.handler);
    // Vacuity: PUT /api/deals/:id, POST /api/deals, advance-stage, the stage
    // PATCH, bulk-update, bulk-stage-update, bulk-stage-undo, the bulk
    // endpoint, seed-demo — measured 2026-10-06.
    expect(inHandlers.length, "vacuity: no route-handler writes found").toBeGreaterThanOrEqual(9);
    const unmapped = inHandlers.filter((s) => !s.handler!.maps).map((s) => `${s.file}:${s.line} ${s.method} in ${s.handler!.route}`);
    expect(unmapped, `route handlers that write a deal without sendDealWriteError:\n${unmapped.join("\n")}`).toEqual([]);

    const outside = sites.filter((s) => !s.handler);
    const unregistered = outside.filter((s) => !NON_ROUTE_WRITERS[s.key]).map((s) => `${s.file}:${s.line} ${s.method} (${s.key})`);
    expect(unregistered, `deal writers outside any route handler, not registered:\n${unregistered.join("\n")}`).toEqual([]);
    const stale = Object.keys(NON_ROUTE_WRITERS).filter((k) => !outside.some((s) => s.key === k));
    expect(stale, `NON_ROUTE_WRITERS entries nothing matches: ${stale.join(", ")}`).toEqual([]);
  });

  it("(c) every route file that writes a deal imports the one mapper", () => {
    const files = new Set(census().sites.filter((s) => s.handler && (s.method === "createDeal" || s.writesStatus)).map((s) => s.file));
    expect(files.size).toBeGreaterThanOrEqual(4); // routes-deals, routes, routes-bulk, routes-admin
    const missing = [...files].filter((f) => !/(?:from\s+|import\(\s*)["'][./]*(?:server\/)?utils\/dealWriteErrors["']/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(missing, missing.join("\n")).toEqual([]);
  });
});

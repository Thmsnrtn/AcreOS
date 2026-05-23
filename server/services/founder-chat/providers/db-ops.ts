/**
 * Atlas read-only DB gateway (Phase I — operations batch 1).
 *
 * This is the prod-querying surface. Every entry point is gated through
 * `parseSqlSafety` so destructive verbs cannot execute. Anti-injection
 * for table-name parameters is enforced against the live
 * information_schema.tables list — never against a regex alone.
 *
 * Routing: uses `dbReplica` if a read replica is configured (Pillar 8.6),
 * else falls back to the primary `db`. Either way, the safety parse
 * still rejects anything that isn't a pure SELECT/EXPLAIN/SHOW.
 *
 * Destructive operations (INSERT/UPDATE/DELETE) land in Phase I batch 2
 * with sealed-paste + Tier-3 confirmation. Do not relax these checks.
 */

import { sql } from "drizzle-orm";

import { db, dbReplica } from "../../../db";
import { logger } from "../../../utils/logger";

export type DbOpsErrorKind = "safety" | "exec";

export class DbOpsError extends Error {
  kind: DbOpsErrorKind;
  constructor(message: string, kind: DbOpsErrorKind) {
    super(message);
    this.name = "DbOpsError";
    this.kind = kind;
  }
}

export interface SqlSafety {
  isReadOnly: boolean;
  reason?: string;
}

/** Verbs that mutate state. Any one as the leading keyword on any
 *  segment of the input string disqualifies the SQL. */
const DANGEROUS_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "COPY",
] as const;

const READ_ONLY_LEADERS = new Set(["SELECT", "EXPLAIN", "SHOW", "WITH"]);

/** Strip single-line and block comments so they don't fool the parser. */
function stripComments(s: string): string {
  return s
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Split on top-level (unquoted) semicolons. Tracks single/double quoted
 * literals AND dollar-quoted strings so `SELECT ';' ;` stays one
 * segment.  Trailing empty segments are ignored — a single trailing
 * `;` is fine.
 */
function splitTopLevelSemicolons(s: string): string[] {
  const segments: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    // Dollar-quoted strings ($tag$...$tag$).
    if (!inSingle && !inDouble) {
      if (dollarTag) {
        const closeIdx = s.indexOf(dollarTag, i);
        if (closeIdx === -1) {
          buf += s.slice(i);
          i = s.length;
        } else {
          buf += s.slice(i, closeIdx + dollarTag.length);
          i = closeIdx + dollarTag.length - 1;
          dollarTag = null;
        }
        continue;
      }
      if (ch === "$") {
        const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
        if (m) {
          dollarTag = m[0];
          buf += dollarTag;
          i += dollarTag.length - 1;
          continue;
        }
      }
    }

    if (ch === "'" && !inDouble && !dollarTag) {
      if (inSingle && s[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === '"' && !inSingle && !dollarTag) {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }

    if (ch === ";" && !inSingle && !inDouble && !dollarTag) {
      segments.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length) segments.push(buf);
  return segments;
}

function leadingKeyword(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return "";
  // Skip leading `(` for `(SELECT ...) UNION ...` shapes.
  const stripped = trimmed.replace(/^\(+\s*/, "");
  const m = stripped.match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Returns `{ isReadOnly, reason? }`.
 *
 * Rules:
 *   - Empty / whitespace-only → not read-only.
 *   - More than one non-empty top-level segment → not read-only
 *     (multi-statement queries can hide a DROP after a SELECT).
 *   - Leading keyword on any segment is one of DANGEROUS_KEYWORDS
 *     → not read-only.
 *   - Otherwise must lead with SELECT / EXPLAIN / SHOW / WITH.
 */
export function parseSqlSafety(rawSql: string): SqlSafety {
  if (typeof rawSql !== "string") {
    return { isReadOnly: false, reason: "SQL must be a string" };
  }
  const cleaned = stripComments(rawSql).trim();
  if (!cleaned) {
    return { isReadOnly: false, reason: "Empty SQL" };
  }
  const segments = splitTopLevelSemicolons(cleaned).filter(
    (s) => s.trim().length > 0,
  );
  if (segments.length === 0) {
    return { isReadOnly: false, reason: "Empty SQL" };
  }
  if (segments.length > 1) {
    return {
      isReadOnly: false,
      reason:
        "Multi-statement SQL is not allowed (split on unquoted ';' detected)",
    };
  }
  const seg = segments[0];
  const lead = leadingKeyword(seg);
  if (DANGEROUS_KEYWORDS.includes(lead as (typeof DANGEROUS_KEYWORDS)[number])) {
    return {
      isReadOnly: false,
      reason: `SQL starts with destructive keyword '${lead}' — read-only gateway refuses`,
    };
  }
  // Belt-and-suspenders: even if the leader is SELECT, scan the rest of
  // the segment's tokens for a dangerous keyword as a leader of an
  // unbalanced subclause. This is paranoid but cheap.
  const upper = seg.toUpperCase();
  for (const kw of DANGEROUS_KEYWORDS) {
    // Look for the keyword at the start (already covered) or after `;`
    // (already split) — so the only remaining case is the keyword as
    // a top-level statement after a no-op. We're safe here, but flag
    // CTE-wrapped writes (`WITH x AS (DELETE …)`) explicitly.
    const cteWrite = new RegExp(`\\bAS\\s*\\(\\s*${kw}\\b`, "i");
    if (cteWrite.test(seg)) {
      return {
        isReadOnly: false,
        reason: `SQL contains a CTE-wrapped ${kw} (\`WITH ... AS (${kw} ...)\`) which can mutate rows`,
      };
    }
    void upper;
  }
  if (!READ_ONLY_LEADERS.has(lead)) {
    return {
      isReadOnly: false,
      reason: `Only SELECT / EXPLAIN / SHOW / WITH queries are allowed (got '${lead || "?"}')`,
    };
  }
  return { isReadOnly: true };
}

const ROW_CAP = 1000;

/**
 * True if the segment already has a top-level LIMIT clause. We don't
 * try to parse precedence — just check for `LIMIT <int>` after any
 * ORDER BY at the tail of the trimmed string.
 */
function hasLimitClause(seg: string): boolean {
  const cleaned = stripComments(seg).trim().replace(/;$/, "");
  return /\bLIMIT\s+\d+\b/i.test(cleaned.split(/\)/).pop() ?? cleaned);
}

function appendLimit(seg: string, cap: number): string {
  const trimmed = seg.trim().replace(/;$/, "");
  return `${trimmed} LIMIT ${cap}`;
}

/** Pick the read replica if configured, else the primary. */
function reader(): typeof db {
  return (dbReplica as typeof db | null) ?? db;
}

export interface DbQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
}

/**
 * Execute a read-only query. Refuses anything `parseSqlSafety` rejects.
 * Appends `LIMIT 1000` if absent so a stray SELECT * doesn't OOM the box.
 */
export async function runReadOnlyQuery(
  rawSql: string,
): Promise<DbQueryResult> {
  const safety = parseSqlSafety(rawSql);
  if (!safety.isReadOnly) {
    throw new DbOpsError(safety.reason ?? "SQL is not read-only", "safety");
  }

  const segment = stripComments(rawSql).trim().replace(/;$/, "");
  const finalSql = hasLimitClause(segment)
    ? segment
    : appendLimit(segment, ROW_CAP);

  logger.debug({ finalSql }, "db-ops runReadOnlyQuery");

  try {
    const result = await reader().execute(sql.raw(finalSql));
    // drizzle/node-postgres execute() returns a pg QueryResult
    // (`{ rows, rowCount }`). Normalize for safety.
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const declaredCount =
      typeof (result as { rowCount?: number | null }).rowCount === "number"
        ? ((result as { rowCount: number }).rowCount)
        : rows.length;
    const truncated = rows.length >= ROW_CAP;
    return {
      rows,
      rowCount: declaredCount,
      truncated,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "db-ops query failed",
    );
    throw new DbOpsError(
      err instanceof Error ? err.message : String(err),
      "exec",
    );
  }
}

/** Public-schema table list (sorted). */
export async function getTableList(): Promise<string[]> {
  try {
    const result = await reader().execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    );
    const rows =
      (result as { rows?: Array<{ table_name?: string }> }).rows ?? [];
    return rows
      .map((r) => r.table_name)
      .filter((n): n is string => typeof n === "string");
  } catch (err) {
    throw new DbOpsError(
      err instanceof Error ? err.message : String(err),
      "exec",
    );
  }
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

export async function getTableSchema(tableName: string): Promise<ColumnInfo[]> {
  try {
    const result = await reader().execute(
      sql`SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${tableName}
          ORDER BY ordinal_position`,
    );
    return (result as { rows?: ColumnInfo[] }).rows ?? [];
  } catch (err) {
    throw new DbOpsError(
      err instanceof Error ? err.message : String(err),
      "exec",
    );
  }
}

/**
 * Last N rows of a public-schema table, ordered DESC by `id` (or the
 * first PK column if `id` isn't present).
 *
 * Anti-injection: the table name must appear in the live
 * information_schema.tables list. Regex-only validation is rejected by
 * spec — we hit information_schema first, then format the identifier
 * with double-quote escaping (`"` → `""`).
 */
export async function getRecentRows(
  tableName: string,
  limit = 10,
): Promise<DbQueryResult> {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));

  const allowed = await getTableList();
  if (!allowed.includes(tableName)) {
    throw new DbOpsError(
      `Unknown table '${tableName}'. Use db_list_tables to see the public-schema inventory.`,
      "safety",
    );
  }

  // Determine the ORDER BY column. Prefer "id" if it exists, else fall
  // back to the first PK column, else just ORDER BY 1.
  const cols = await getTableSchema(tableName);
  const colNames = new Set(cols.map((c) => c.column_name));
  let orderCol = "id";
  if (!colNames.has(orderCol)) {
    try {
      const pkResult = await reader().execute(
        sql`SELECT a.attname AS column_name
            FROM pg_index i
            JOIN pg_attribute a
              ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = ${`public.${tableName}`}::regclass
              AND i.indisprimary
            ORDER BY array_position(i.indkey, a.attnum)
            LIMIT 1`,
      );
      const pkRows =
        (pkResult as { rows?: Array<{ column_name?: string }> }).rows ?? [];
      if (pkRows[0]?.column_name) {
        orderCol = pkRows[0].column_name;
      } else {
        orderCol = ""; // signal: ORDER BY 1
      }
    } catch {
      orderCol = "";
    }
  }

  const quotedTable = `"${tableName.replace(/"/g, '""')}"`;
  const quotedOrder = orderCol
    ? `"${orderCol.replace(/"/g, '""')}"`
    : "1";
  const finalSql = `SELECT * FROM ${quotedTable} ORDER BY ${quotedOrder} DESC LIMIT ${safeLimit}`;

  // Defense in depth: still run through the safety parser.
  const safety = parseSqlSafety(finalSql);
  if (!safety.isReadOnly) {
    throw new DbOpsError(
      `Internal: generated SQL failed safety check (${safety.reason})`,
      "safety",
    );
  }

  logger.debug({ finalSql }, "db-ops getRecentRows");
  try {
    const result = await reader().execute(sql.raw(finalSql));
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    return {
      rows,
      rowCount: rows.length,
      truncated: rows.length >= safeLimit,
    };
  } catch (err) {
    throw new DbOpsError(
      err instanceof Error ? err.message : String(err),
      "exec",
    );
  }
}

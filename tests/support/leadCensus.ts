/**
 * Find every statement in a source file that reads or writes the `leads`
 * table, and say whether it carries the live-lead predicate.
 *
 * Shared by the census (tests/unit/liveLeadReadsCensus.test.ts), which runs it
 * over every production file, and its canaries, which feed it fixtures — a
 * gate that can only be run against the live tree cannot be falsified.
 *
 * THE POPULATION, stated so its limits are visible:
 *   - query-builder statements: `.from(X)`, `.update(X)`, `.delete(X)` where X
 *     is ANY local name the file binds to the schema's `leads` (a plain
 *     import, an `as` alias, or `<namespace>.leads`);
 *   - the relational API: `db.query.leads.*` / `tx.query.leads.*`;
 *   - raw SQL: `FROM leads` INSIDE a `sql\`…\`` template. Prose that says "reads
 *     threads from leads" in a UI string is not a query (a builder of this
 *     census caught the first draft counting it).
 *   - INNER joins: `.innerJoin(X, …)`. An inner join FILTERS rows by the lead,
 *     and the rows it yields feed sends (sequence emails, buyer blasts) — the
 *     W10.2a audit found both still emailing deleted leads through joins the
 *     first draft of this census excluded;
 *   NOT counted: LEFT joins. A left join attaches the lead's columns to another
 *     row without filtering it; the parent row's liveness governs.
 *
 * A statement ends at its `;` or where the next `db.`/`tx.` query begins,
 * whichever is first, so siblings in a `Promise.all` cannot lend each other a
 * predicate. Comments are stripped first (a comment naming a predicate is not
 * a predicate).
 */
import { stripComments } from "../helpers/stripComments";

export interface LeadStatement {
  kind: "builder" | "join" | "relational" | "raw" | "deliberate";
  text: string;
  live: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Local names this file binds to `leadsIncludingDeleted` (any import alias). */
function deliberateNames(src: string): string[] {
  const names = new Set<string>(["leadsIncludingDeleted"]);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*liveLeads["']/g)) {
    for (const part of m[1].split(",")) {
      const alias = part.trim().match(/^leadsIncludingDeleted\s+as\s+(\w+)$/);
      if (alias) names.add(alias[1]);
    }
  }
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["'][^"']*liveLeads["']\s*\)/g)) {
    for (const part of m[1].split(",")) {
      const alias = part.trim().match(/^leadsIncludingDeleted\s*:\s*(\w+)$/);
      if (alias) names.add(alias[1]);
    }
  }
  return [...names];
}

/** Local names this file binds to the schema's `leads` table. */
export function leadTableNames(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!/schema/.test(m[2])) continue;
    for (const part of m[1].split(",")) {
      const t = part.trim();
      const alias = t.match(/^leads\s+as\s+(\w+)$/);
      if (t === "leads") names.add("leads");
      else if (alias) names.add(alias[1]);
    }
  }
  for (const m of src.matchAll(/import\s*\*\s*as\s*(\w+)\s*from\s*["']([^"']+)["']/g)) {
    if (/schema/.test(m[2])) names.add(`${m[1]}.leads`);
  }
  // `const { leads } = await import("...schema")`
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!/schema/.test(m[2])) continue;
    for (const part of m[1].split(",")) {
      const t = part.trim();
      const alias = t.match(/^leads\s*:\s*(\w+)$/);
      if (t === "leads") names.add("leads");
      else if (alias) names.add(alias[1]);
    }
  }
  return [...names];
}

// Any handle: db, tx, trx, or a named one (drizzleDb, replicaDb …).
const NEXT_QUERY = /\b(?:db|tx|trx|\w+Db)\b\s*\.\s*(select|update|insert|delete|execute|query)\b/g;

function spanFrom(src: string, at: number): string {
  const semi = src.indexOf(";", at);
  NEXT_QUERY.lastIndex = at + 1;
  const next = NEXT_QUERY.exec(src);
  const ends = [semi, next ? next.index : -1].filter((i) => i > at);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

export function leadStatements(rawSource: string): LeadStatement[] {
  const src = stripComments(rawSource);
  const names = leadTableNames(src);
  const nameAlt = names.map(escape).join("|");
  const livePred = new RegExp(
    [
      String.raw`\bliveLead\(\s*\)`,
      String.raw`\bdeleted_at\s+IS\s+NULL`,
      ...names.map((n) => String.raw`isNull\(\s*${escape(n)}\.deletedAt\s*\)`),
      ...names.map((n) => String.raw`\$\{\s*${escape(n)}\.deletedAt\s*\}\s*IS\s+NULL`),
    ].join("|"),
    "i",
  );
  const out: LeadStatement[] = [];
  const scan = (re: RegExp, kind: LeadStatement["kind"]) => {
    for (const m of src.matchAll(re)) {
      const text = spanFrom(src, m.index!);
      out.push({ kind, text, live: kind === "deliberate" ? false : livePred.test(text) });
    }
  };
  if (nameAlt) scan(new RegExp(String.raw`\.(?:from|update|delete)\(\s*(?:${nameAlt})\s*\)`, "g"), "builder");
  if (nameAlt) scan(new RegExp(String.raw`\.innerJoin\(\s*(?:${nameAlt})\s*,`, "g"), "join");
  scan(/\b(?:db|tx)\.query\.leads\.\w+\(/g, "relational");
  // Raw SQL: only within sql`…` templates, located on the comment-stripped text.
  for (const t of src.matchAll(/\bsql(?:\.raw)?\s*`/g)) {
    const open = t.index! + t[0].length;
    let i = open;
    let depth = 0;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\\") { i++; continue; }
      if (ch === "$" && src[i + 1] === "{") { depth++; i++; continue; }
      if (ch === "}" && depth > 0) { depth--; continue; }
      if (ch === "`" && depth === 0) break;
    }
    const body = src.slice(open, i);
    for (const m of body.matchAll(/\bFROM\s+leads\b/gi)) {
      const text = spanFrom(src, open + m.index!);
      out.push({ kind: "raw", text, live: livePred.test(text) });
    }
  }
  const delAlt = deliberateNames(src).map(escape).join("|");
  scan(new RegExp(String.raw`\.(?:from|update|delete)\(\s*(?:${delAlt})\s*\)|\.innerJoin\(\s*(?:${delAlt})\s*,`, "g"), "deliberate");
  return out;
}

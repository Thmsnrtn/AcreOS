/**
 * An in-memory serviced-note ledger (notes / payments / late_fee_assessments /
 * ach_debit_attempts) that EVALUATES the Drizzle predicates it is given and
 * models the two Postgres behaviours DEFECT-0185 turns on (W10.5).
 *
 * Why not tests/helpers/fakeDealsDb.ts as-is: that fake (W10.4) evaluates
 * `=`, `in` and `is null` only, applies a transaction's writes immediately
 * (a concurrent reader sees them before commit), has no row locks and does
 * not enforce unique keys. The properties here are properties of exactly
 * those things — a due-date WINDOW (`>=`/`<`), an aggregate over the rows the
 * WHERE admits, a `SELECT … FOR UPDATE` that serializes two postings, the
 * READ COMMITTED view a second posting gets once the lock is released, and
 * `ON CONFLICT DO NOTHING` on the ledger's per-installment unique key. A mock
 * that ignored any of them would agree with any implementation of it. The
 * same discipline as fakeDealsDb: a predicate or projection shape the
 * evaluator does not know THROWS, so it can never pass silently.
 *
 * Isolation model (READ COMMITTED, simplified): every statement reads the
 * committed state at the moment it runs, plus its own transaction's writes.
 * A transaction's inserts and updates are invisible to everyone else until it
 * commits; a row lock (`FOR UPDATE`, or an UPDATE) is held to the end of the
 * transaction, and a statement that needs a locked row waits for it and then
 * reads the newest committed version. A unique key claimed by an uncommitted
 * insert makes a second inserter wait for that transaction to end.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { Column, SQL, getTableColumns, getTableName, is } from "drizzle-orm";

type Row = Record<string, unknown>;
const dialect = new PgDialect();

/** The unique keys the ledger relies on, as in the schema / migrations. */
const UNIQUE_KEYS: Record<string, string[][]> = {
  payments: [["transactionId"]],
  late_fee_assessments: [["loanId", "periodStart", "loanType"]],
};

interface TxCtx {
  id: number;
  /** committed row → pending column values */
  patches: Map<Row, Row>;
  inserts: Array<{ table: string; row: Row }>;
  locks: string[];
  claims: string[];
}

export interface LedgerFake {
  rows(table: string): Row[];
  /** Milliseconds every statement waits before it runs — lets two flows interleave. */
  tickMs: number;
  /** Every statement, rendered, in order (for "what did it read" proofs). */
  log: Array<{ ctx: number | null; kind: string; table: string; sql: string }>;
  reset(): void;
}

export function createLedgerFake(): {
  fake: LedgerFake;
  db: Record<string, unknown>;
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
} {
  const committed = new Map<string, Row[]>();
  const colMaps = new Map<string, Map<string, string>>(); // table -> db name -> ts key
  const rowLocks = new Map<string, { ctx: number; done: Promise<void> }>();
  const uniqueClaims = new Map<string, { ctx: number; done: Promise<void> }>();
  const txDone = new Map<number, Promise<void>>();
  let nextId = 1;
  let txSeq = 0;

  const fake: LedgerFake = {
    rows(table: string) {
      if (!committed.has(table)) committed.set(table, []);
      return committed.get(table)!;
    },
    tickMs: 0,
    log: [],
    reset() {
      committed.clear();
      rowLocks.clear();
      uniqueClaims.clear();
      txDone.clear();
      this.tickMs = 0;
      this.log = [];
      nextId = 1;
    },
  };

  const tick = () =>
    fake.tickMs > 0 ? new Promise<void>((r) => setTimeout(r, fake.tickMs)) : Promise.resolve();

  function register(table: unknown): string {
    const name = getTableName(table as never);
    if (!colMaps.has(name)) {
      const m = new Map<string, string>();
      for (const [key, col] of Object.entries(getTableColumns(table as never))) m.set((col as Column).name, key);
      colMaps.set(name, m);
    }
    return name;
  }
  const tsKey = (table: string, dbName: string): string => {
    const k = colMaps.get(table)?.get(dbName);
    if (!k) throw new Error(`ledgerFake: unknown column ${table}.${dbName}`);
    return k;
  };

  // ── values ────────────────────────────────────────────────────────────────
  const isoLike = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
  function cmp(a: unknown, b: unknown): number {
    if (a === null || a === undefined || b === null || b === undefined) return NaN;
    if (a instanceof Date || b instanceof Date || (isoLike(a) && isoLike(b))) {
      return new Date(a as string).getTime() - new Date(b as string).getTime();
    }
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  /** Postgres ROUND(numeric * 100) for a decimal string — exact, half away from zero. */
  function decimalToCents(v: unknown): number {
    if (v === null || v === undefined) return 0;
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(String(v).trim());
    if (!m) throw new Error(`ledgerFake: not a decimal: ${String(v)}`);
    const frac = m[3] ?? "";
    let cents = Number(BigInt((m[2] || "0") + frac.slice(0, 2).padEnd(2, "0")));
    if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1;
    return m[1] === "-" ? -cents : cents;
  }

  // ── predicates ────────────────────────────────────────────────────────────
  function tokenize(s: string): string[] {
    const out: string[] = [];
    const re = /\s*("(?:[^"]+)"(?:\."(?:[^"]+)")?|\$\d+|>=|<=|<>|=|<|>|\(|\)|,|[a-zA-Z_]+)/y;
    let i = 0;
    while (i < s.length) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) {
        if (/^\s*$/.test(s.slice(i))) break;
        throw new Error(`ledgerFake cannot tokenize at: ${s.slice(i)}`);
      }
      out.push(m[1]);
      i = re.lastIndex;
    }
    return out;
  }

  function evalWhere(w: unknown, table: string, row: Row): boolean {
    if (w === undefined || w === null) return true;
    const { sql, params } = dialect.sqlToQuery(w as SQL);
    const toks = tokenize(sql);
    let p = 0;
    const peek = () => toks[p]?.toLowerCase();
    const take = () => toks[p++];
    const fail = (): never => {
      throw new Error(`ledgerFake cannot evaluate predicate: ${sql}`);
    };
    const col = (tok: string): unknown => {
      const m = tok.match(/^"([^"]+)"(?:\."([^"]+)")?$/);
      if (!m) fail();
      const [t, c] = m![2] ? [m![1], m![2]] : [table, m![1]];
      if (t !== table) fail();
      return row[tsKey(table, c)];
    };
    const param = (tok: string): unknown => {
      const m = tok.match(/^\$(\d+)$/);
      if (!m) fail();
      return params[Number(m![1]) - 1];
    };
    function expr(): boolean {
      let v = term();
      while (peek() === "or") {
        take();
        const r = term();
        v = v || r;
      }
      return v;
    }
    function term(): boolean {
      let v = factor();
      while (peek() === "and") {
        take();
        const r = factor();
        v = v && r;
      }
      return v;
    }
    function factor(): boolean {
      if (peek() === "(") {
        take();
        const v = expr();
        if (take() !== ")") fail();
        return v;
      }
      const c = take();
      if (!c || !c.startsWith('"')) fail();
      const value = col(c);
      const op = take()?.toLowerCase();
      if (op === "=" || op === "<>" || op === "<" || op === "<=" || op === ">" || op === ">=") {
        const d = cmp(value, param(take()));
        if (Number.isNaN(d)) return false; // SQL NULL comparison
        return op === "=" ? d === 0 : op === "<>" ? d !== 0 : op === "<" ? d < 0 : op === "<=" ? d <= 0 : op === ">" ? d > 0 : d >= 0;
      }
      if (op === "is") {
        let neg = false;
        if (peek() === "not") {
          take();
          neg = true;
        }
        if (take()?.toLowerCase() !== "null") fail();
        const r = value === null || value === undefined;
        return neg ? !r : r;
      }
      let neg = false;
      let inOp = op;
      if (op === "not") {
        neg = true;
        inOp = take()?.toLowerCase();
      }
      if (inOp === "in") {
        if (take() !== "(") fail();
        const vals: unknown[] = [];
        for (;;) {
          vals.push(param(take()));
          const t = take();
          if (t === ")") break;
          if (t !== ",") fail();
        }
        const r = vals.some((v) => cmp(value, v) === 0);
        return neg ? !r : r;
      }
      return fail();
    }
    const v = expr();
    if (p !== toks.length) fail();
    return v;
  }

  // ── visibility ────────────────────────────────────────────────────────────
  /** Rows a statement in `ctx` sees: committed (+ its own pending patches) and its own inserts. */
  function visible(ctx: TxCtx | null, table: string): Array<{ base: Row; view: Row; own: boolean }> {
    const out: Array<{ base: Row; view: Row; own: boolean }> = [];
    for (const r of fake.rows(table)) {
      const patch = ctx?.patches.get(r);
      out.push({ base: r, view: patch ? { ...r, ...patch } : { ...r }, own: false });
    }
    if (ctx) for (const i of ctx.inserts) if (i.table === table) out.push({ base: i.row, view: { ...i.row }, own: true });
    return out;
  }

  async function lockRows(ctx: TxCtx | null, table: string, where: unknown): Promise<void> {
    // Wait until no matching committed row is locked by ANOTHER transaction,
    // then take the locks (held to the end of ctx; an autocommit statement
    // waits and lets go at once).
    for (;;) {
      const matching = visible(ctx, table).filter((r) => !r.own && evalWhere(where, table, r.view));
      const busy = matching
        .map((r) => rowLocks.get(`${table}:${String(r.base.id)}`))
        .find((l) => l && (!ctx || l.ctx !== ctx.id));
      if (busy) {
        await busy.done;
        continue;
      }
      if (ctx) {
        for (const r of matching) {
          const key = `${table}:${String(r.base.id)}`;
          if (!rowLocks.has(key)) {
            rowLocks.set(key, { ctx: ctx.id, done: txDone.get(ctx.id)! });
            ctx.locks.push(key);
          }
        }
      }
      return;
    }
  }

  // ── projections ───────────────────────────────────────────────────────────
  function project(table: string, rows: Row[], fields: Record<string, unknown> | undefined): Row[] {
    if (!fields) return rows.map((r) => ({ ...r }));
    const entries = Object.entries(fields);
    const aggregates = entries.filter(([, f]) => is(f, SQL));
    if (aggregates.length > 0) {
      if (aggregates.length !== entries.length) throw new Error("ledgerFake: aggregate mixed with plain columns");
      const out: Row = {};
      for (const [alias, f] of aggregates) {
        const s = dialect.sqlToQuery(f as SQL).sql;
        let m = /^COALESCE\(SUM\(ROUND\("(\w+)"\."(\w+)" \* 100\)\), 0\)$/i.exec(s);
        if (m && m[1] === table) {
          out[alias] = String(rows.reduce((n, r) => n + decimalToCents(r[tsKey(table, m![2])]), 0));
          continue;
        }
        m = /^COALESCE\(SUM\("(\w+)"\."(\w+)"\), 0\)$/i.exec(s);
        if (m && m[1] === table) {
          out[alias] = String(rows.reduce((n, r) => n + Number(r[tsKey(table, m![2])] ?? 0), 0));
          continue;
        }
        throw new Error(`ledgerFake: unknown aggregate ${s}`);
      }
      return [out];
    }
    return rows.map((r) => {
      const o: Row = {};
      for (const [alias, f] of entries) {
        if (!is(f, Column)) throw new Error(`ledgerFake: unknown projection for ${alias}`);
        const c = f as Column;
        o[alias] = r[tsKey(getTableName(c.table), c.name)];
      }
      return o;
    });
  }

  function statement<T>(run: () => Promise<T>) {
    const c: Record<string, unknown> = {};
    let p: Promise<T> | null = null;
    const go = () => (p ??= tick().then(run));
    c.then = (f: (v: T) => unknown, r?: (e: unknown) => unknown) => go().then(f, r);
    c.catch = (r: (e: unknown) => unknown) => go().catch(r);
    return c;
  }

  function makeApi(ctx: TxCtx | null): Record<string, unknown> {
    const api: Record<string, unknown> = {
      select: (fields?: Record<string, unknown>) => ({
        from: (t: unknown) => {
          const table = register(t);
          let where: unknown;
          let limit = Infinity;
          let forUpdate = false;
          const chain = statement(async () => {
            fake.log.push({ ctx: ctx?.id ?? null, kind: forUpdate ? "select-for-update" : "select", table, sql: where ? dialect.sqlToQuery(where as SQL).sql : "" });
            if (forUpdate) await lockRows(ctx, table, where);
            const rows = visible(ctx, table)
              .filter((r) => evalWhere(where, table, r.view))
              .map((r) => r.view);
            const projected = project(table, rows, fields);
            return projected.slice(0, limit);
          });
          chain.where = (w: unknown) => ((where = w), chain);
          chain.limit = (n: number) => ((limit = n), chain);
          chain.orderBy = () => chain;
          chain.for = (mode: string) => {
            if (mode !== "update") throw new Error(`ledgerFake: FOR ${mode} not modelled`);
            forUpdate = true;
            return chain;
          };
          return chain;
        },
      }),
      update: (t: unknown) => ({
        set: (values: Row) => ({
          where: (w: unknown) => {
            const table = register(t);
            let fields: Record<string, unknown> | undefined;
            const run = async () => {
              fake.log.push({ ctx: ctx?.id ?? null, kind: "update", table, sql: dialect.sqlToQuery(w as SQL).sql });
              await lockRows(ctx, table, w);
              const out: Row[] = [];
              for (const r of visible(ctx, table)) {
                if (!evalWhere(w, table, r.view)) continue;
                const clean: Row = {};
                for (const [k, v] of Object.entries(values)) if (v !== undefined) clean[k] = v;
                if (!ctx || r.own) Object.assign(r.base, clean);
                else ctx.patches.set(r.base, { ...(ctx.patches.get(r.base) ?? {}), ...clean });
                out.push({ ...r.view, ...clean });
              }
              return project(table, out, fields);
            };
            const c = statement(run);
            c.returning = (f?: Record<string, unknown>) => {
              fields = f;
              return statement(run);
            };
            return c;
          },
        }),
      }),
      insert: (t: unknown) => ({
        values: (v: Row) => {
          const table = register(t);
          let onConflict = false;
          let fields: Record<string, unknown> | undefined;
          const run = async (): Promise<Row[]> => {
            fake.log.push({ ctx: ctx?.id ?? null, kind: "insert", table, sql: "" });
            const row: Row = { id: v.id ?? nextId++, ...v };
            if (table === "late_fee_assessments" && row.status === undefined) row.status = "assessed";
            if (table === "late_fee_assessments" && row.loanType === undefined) row.loanType = "note";
            const keys = (UNIQUE_KEYS[table] ?? []).map((cols) => `${table}:${cols.map((c) => String(row[c])).join("|")}`);
            for (;;) {
              const claimedElsewhere = keys
                .map((k) => uniqueClaims.get(k))
                .find((cl) => cl && (!ctx || cl.ctx !== ctx.id));
              if (claimedElsewhere) {
                await claimedElsewhere.done;
                continue;
              }
              break;
            }
            const clash = (UNIQUE_KEYS[table] ?? []).some((cols) =>
              visible(ctx, table).some((r) => cols.every((c) => cmp(r.view[c], row[c]) === 0)),
            );
            if (clash) {
              if (onConflict) return [];
              throw new Error(`ledgerFake: duplicate key on ${table}`);
            }
            if (ctx) {
              ctx.inserts.push({ table, row });
              for (const k of keys) {
                uniqueClaims.set(k, { ctx: ctx.id, done: txDone.get(ctx.id)! });
                ctx.claims.push(k);
              }
            } else {
              fake.rows(table).push(row);
            }
            return project(table, [row], fields);
          };
          const c = statement(run);
          c.returning = (f?: Record<string, unknown>) => {
            fields = f;
            return statement(run);
          };
          c.onConflictDoNothing = () => {
            onConflict = true;
            const cc = statement(run);
            cc.returning = (f?: Record<string, unknown>) => {
              fields = f;
              return statement(run);
            };
            return cc;
          };
          return c;
        },
      }),
      execute: async () => {
        throw new Error("ledgerFake: raw execute is not modelled");
      },
    };
    api.transaction = transaction;
    return api;
  }

  async function transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const ctx: TxCtx = { id: ++txSeq, patches: new Map(), inserts: [], locks: [], claims: [] };
    let release!: () => void;
    txDone.set(ctx.id, new Promise<void>((r) => (release = r)));
    try {
      const out = await fn(makeApi(ctx));
      // COMMIT
      for (const [base, patch] of ctx.patches) Object.assign(base, patch);
      for (const i of ctx.inserts) fake.rows(i.table).push(i.row);
      return out;
    } finally {
      for (const k of ctx.locks) rowLocks.delete(k);
      for (const k of ctx.claims) uniqueClaims.delete(k);
      txDone.delete(ctx.id);
      release();
    }
  }

  const db = makeApi(null);
  return { fake, db, withTransaction: transaction };
}

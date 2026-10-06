/**
 * A small in-memory stand-in for the Drizzle primary handle that EVALUATES the
 * predicates it is given (W10.4 deal-write tests).
 *
 * Why not the usual chain mock that returns canned rows: the properties these
 * tests prove — a status write applies only while the row still has the
 * status it was decided on; a retracted training row is never un-retracted by
 * a late insert; a lock serializes two writers — are properties OF THE WHERE
 * CLAUSE. A mock that ignores the predicate agrees with any implementation of
 * it. Here every predicate is rendered to SQL by Drizzle's own PgDialect and
 * evaluated against the stored rows; a shape the evaluator does not know
 * THROWS rather than matching, so a predicate it cannot read can never pass
 * silently.
 *
 * Supported: `and` / `or` / parentheses over `col = $n`, `col is [not] null`,
 * `col is [not] true|false`, `col [not] in ($a, …)`. Columns map snake_case →
 * camelCase row keys. A transaction that throws undoes its own writes (and
 * only its own — a concurrent writer's change survives, as in Postgres), and `pg_advisory_xact_lock(hashtext(key))` is a real per-key mutex released
 * when the transaction ends.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const dialect = new PgDialect();

type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Map<string, Row[]>;
  /** Called with (tableName, rowsAboutToBeMatched) before an UPDATE applies — to inject a concurrent writer. */
  beforeUpdate: ((table: string) => void) | null;
  /** Every SQL statement `execute`d, rendered. */
  executed: Array<{ sql: string; params: unknown[] }>;
  /** Lock acquire/release order, for ordering proofs. */
  lockLog: string[];
  /** Delay (ms) every select resolves after — lets two writers both pre-read before either writes. */
  selectDelayMs: number;
  /**
   * Tables read or written through the GLOBAL `db` while some transaction
   * held an advisory lock. In production that statement needs a second pool
   * connection: a bulk close that parks every connection on the lock leaves
   * the holder waiting for one forever (W10.4 re-audit, finding 1). A
   * sequential test that sees an entry here has a lock body that leaks out.
   * Selects, inserts, updates, executes and global transactions all count.
   * (Concurrent tests legitimately open connections while another holds a
   * lock; assert this only where the calls are sequential.)
   */
  globalDbUnderLock: string[];
  nextId: number;
  reset(): void;
  rows(table: string): Row[];
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Render a Drizzle predicate exactly as Postgres would receive it. */
export function renderSql(w: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(w as SQL);
}

function tokenize(sql: string): string[] {
  const out: string[] = [];
  const re = /\s*("(?:[^"]+)"(?:\."(?:[^"]+)")?|\$\d+|\(|\)|,|=|[a-zA-Z_]+)/y;
  let i = 0;
  while (i < sql.length) {
    re.lastIndex = i;
    const m = re.exec(sql);
    if (!m) {
      if (/^\s*$/.test(sql.slice(i))) break;
      throw new Error(`fakeDealsDb cannot tokenize at: ${sql.slice(i)}`);
    }
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

/** Evaluate a rendered predicate against one row. Unknown shapes throw. */
export function evalPredicate(w: unknown, row: Row): boolean {
  if (w === undefined || w === null) return true;
  const { sql, params } = renderSql(w);
  const toks = tokenize(sql);
  let p = 0;
  const peek = () => toks[p]?.toLowerCase();
  const take = () => toks[p++];
  const fail = (): never => {
    throw new Error(`fakeDealsDb cannot evaluate predicate: ${sql}`);
  };
  const colValue = (tok: string): unknown => {
    const m = tok.match(/^"([^"]+)"(?:\."([^"]+)")?$/);
    if (!m) fail();
    return row[camel(m![2] ?? m![1])];
  };
  const param = (tok: string): unknown => {
    const m = tok.match(/^\$(\d+)$/);
    if (!m) fail();
    return params[Number(m![1]) - 1];
  };
  const same = (a: unknown, b: unknown) =>
    a instanceof Date || b instanceof Date ? new Date(a as Date).getTime() === new Date(b as Date).getTime() : a === b;

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
    const col = take();
    if (!col || !col.startsWith('"')) fail();
    const value = colValue(col);
    const op = take()?.toLowerCase();
    if (op === "=") return same(value, param(take()));
    if (op === "is") {
      let neg = false;
      if (peek() === "not") {
        take();
        neg = true;
      }
      const what = take()?.toLowerCase();
      let r: boolean;
      if (what === "null") r = value === null || value === undefined;
      else if (what === "true") r = value === true;
      else if (what === "false") r = value === false;
      else return fail();
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
      const r = vals.some((v) => same(value, v));
      return neg ? !r : r;
    }
    return fail();
  }
  const v = expr();
  if (p !== toks.length) fail();
  return v;
}

function tableName(t: unknown): string {
  return getTableName(t as Parameters<typeof getTableName>[0]);
}

export function createFakeDb(): { fake: FakeDb; db: Record<string, unknown>; withTransaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> } {
  const fake: FakeDb = {
    tables: new Map(),
    beforeUpdate: null,
    executed: [],
    lockLog: [],
    selectDelayMs: 0,
    globalDbUnderLock: [],
    nextId: 1000,
    reset() {
      this.tables = new Map();
      this.beforeUpdate = null;
      this.executed = [];
      this.lockLog = [];
      this.selectDelayMs = 0;
      this.globalDbUnderLock = [];
      this.nextId = 1000;
      locks.clear();
    },
    rows(table: string) {
      if (!this.tables.has(table)) this.tables.set(table, []);
      return this.tables.get(table)!;
    },
  };

  const locks = new Map<string, Promise<void>>();

  function thenable<T>(run: () => T | Promise<T>, delay = 0) {
    const c: Record<string, unknown> = {};
    // The statement EXECUTES when awaited; only its answer is delayed — so two
    // readers awaited together both read the same state, as two connections would.
    c.then = (f: (v: T) => unknown, r?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(run)
        .then((v) => (delay > 0 ? new Promise<T>((res) => setTimeout(() => res(v), delay)) : v))
        .then(f, r);
    c.catch = (r: (e: unknown) => unknown) => (c.then as (f: unknown, r: unknown) => unknown)((v: unknown) => v, r);
    return c;
  }

  function makeDb(
    onLock: (key: string) => Promise<void>,
    undo?: Array<() => void>,
    onUse: (table: string) => void = () => {},
  ): Record<string, unknown> {
    return {
      select: (_proj?: unknown) => ({
        from: (t: unknown) => {
          const name = tableName(t);
          onUse(name);
          let where: unknown;
          let limit = Infinity;
          const chain: Record<string, unknown> = thenable(
            () => fake.rows(name).filter((r) => evalPredicate(where, r)).slice(0, limit).map((r) => ({ ...r })),
            fake.selectDelayMs,
          );
          chain.where = (w: unknown) => ((where = w), chain);
          chain.limit = (n: number) => ((limit = n), chain);
          chain.orderBy = () => chain;
          chain.innerJoin = () => {
            throw new Error("fakeDealsDb: joins are not modelled — mock the reader instead");
          };
          return chain;
        },
      }),
      update: (t: unknown) => ({
        set: (values: Row) => ({
          where: (w: unknown) => {
            const name = tableName(t);
            onUse(name);
            const run = () => {
              fake.beforeUpdate?.(name);
              const out: Row[] = [];
              for (const r of fake.rows(name)) {
                if (!evalPredicate(w, r)) continue;
                const prior = { ...r };
                undo?.push(() => {
                  for (const k of Object.keys(r)) delete r[k];
                  Object.assign(r, prior);
                });
                for (const [k, v] of Object.entries(values)) if (v !== undefined) r[k] = v;
                out.push({ ...r });
              }
              return out;
            };
            const c: Record<string, unknown> = thenable(run);
            c.returning = () => thenable(run);
            return c;
          },
        }),
      }),
      insert: (t: unknown) => ({
        values: (v: Row) => {
          const name = tableName(t);
          onUse(name);
          const plain = () => {
            const row = { id: fake.nextId++, ...v };
            const rows = fake.rows(name);
            rows.push(row);
            undo?.push(() => {
              const i = rows.indexOf(row);
              if (i >= 0) rows.splice(i, 1);
            });
            return [{ ...row }];
          };
          const c: Record<string, unknown> = thenable(plain);
          c.returning = () => thenable(plain);
          c.onConflictDoNothing = () => ({ returning: () => thenable(plain) });
          c.onConflictDoUpdate = (cfg: { target: { name: string }; set: Row; setWhere?: unknown }) => {
            const run = () => {
              const key = camel(cfg.target.name);
              const existing = fake.rows(name).find((r) => r[key] === v[key]);
              if (!existing) return plain();
              if (cfg.setWhere !== undefined && !evalPredicate(cfg.setWhere, existing)) return [];
              const prior = { ...existing };
              undo?.push(() => Object.assign(existing, prior));
              Object.assign(existing, cfg.set);
              return [{ ...existing }];
            };
            return { returning: () => thenable(run) };
          };
          return c;
        },
      }),
      execute: async (q: unknown) => {
        onUse("execute");
        const r = renderSql(q);
        fake.executed.push(r);
        if (/pg_advisory_xact_lock/.test(r.sql)) await onLock(String(r.params[0]));
        return [];
      },
    };
  }

  async function transaction(fn: (tx: unknown) => Promise<unknown>) {
    const held: Array<{ key: string; release: () => void }> = [];
    // Rollback undoes THIS transaction's own writes only — a concurrent
    // writer's committed change survives it, as in Postgres.
    const undo: Array<() => void> = [];
    const tx = makeDb(async (key) => {
      while (locks.has(key)) await locks.get(key);
      let release!: () => void;
      locks.set(key, new Promise<void>((res) => (release = res)));
      fake.lockLog.push(`acquire ${key}`);
      held.push({ key, release });
    }, undo);
    (tx as Record<string, unknown>).transaction = transaction;
    try {
      return await fn(tx);
    } catch (err) {
      for (const u of undo.reverse()) u();
      throw err;
    } finally {
      for (const h of held) {
        locks.delete(h.key);
        fake.lockLog.push(`release ${h.key}`);
        h.release();
      }
    }
  }

  const db = makeDb(
    async () => {
      throw new Error("fakeDealsDb: an advisory xact lock outside a transaction is a no-op in Postgres — take it in a transaction");
    },
    undefined,
    (table) => {
      if (locks.size > 0) fake.globalDbUnderLock.push(table);
    },
  );
  // A transaction opened through the GLOBAL handle is a second connection too
  // (a nested `tx.transaction` is a savepoint on the same one, so it is not).
  const globalTransaction = (fn: (tx: unknown) => Promise<unknown>) => {
    if (locks.size > 0) fake.globalDbUnderLock.push("transaction");
    return transaction(fn);
  };
  db.transaction = globalTransaction;
  return { fake, db, withTransaction: globalTransaction };
}

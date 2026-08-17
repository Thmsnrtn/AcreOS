/**
 * Three by-id resolutions on money rails, and what each one could reach.
 *
 * Register unit "tenancy: resolve-by-id, batch 2". Every entry below queried a
 * table carrying `organization_id NOT NULL` with no tenant term in the
 * predicate:
 *
 *   achMandateSetup.revokeAchMandatesForNote   — an UPDATE on the ACH debit
 *       rail. `where(noteId + two status guards)`. Route-reachable twice from
 *       server/routes-borrower.ts (the session autopay toggle and the sunset
 *       token endpoint). A noteId belonging to another tenant revoked THAT
 *       tenant's live NACHA authorization — the borrower's autopay silently
 *       stops, and the servicer's record of consent is marked withdrawn.
 *
 *   wireInstructions.issueWireInstructions     — reads a title order by bare
 *       PK, decrypts the routing partner's HMAC secret, and writes the
 *       encrypted-PDF S3 key, the signature, and `wire_confirmation_phone`
 *       back by bare PK. That phone number is the ALTA Pillar 2 out-of-band
 *       control: it is the number the customer is told to call before wiring
 *       funds. Currently unreachable (no caller anywhere in the repo), which
 *       is the only reason it was not the top live item.
 *
 *   periodicStatements.computeStatementFields  — every §1026.41(d) dollar on a
 *       statutory periodic statement (cycle principal/interest/escrow/fees and
 *       the YTD sums) resolved from `payment_applications` by a `loan_id`
 *       string with no tenant term. `loan_id` is `text`, not a foreign key, so
 *       two orgs can and do hold the same value.
 *
 * HOW THIS FILE PROVES IT, AND WHY NOT WITH ASSERTION-ON-A-MOCK
 * ------------------------------------------------------------
 * A hand-written storage double that "filters by org" proves only that the
 * double filters by org — it cannot see a missing WHERE, which is exactly
 * where these three bugs lived. So the fake database here does NOT interpret
 * the caller's intent. It takes the Drizzle predicate object the production
 * code actually built, compiles it to real Postgres SQL with the real
 * `PgDialect`, and then EVALUATES that SQL string against in-memory rows with
 * a small generic expression interpreter (`=`, `<>`, `>=`, `<=`, `>`, `<`,
 * `is null`, `and`, `or`, parens). Nothing in the interpreter knows the word
 * "organization".
 *
 * The consequence is the property that matters: delete the `organizationId`
 * term from any of the three fixes and the compiled SQL loses it, the
 * interpreter stops excluding the other tenant's row, and these tests fail.
 * That was verified by reverting each fix in turn — see the report.
 *
 * The interpreter THROWS on any token it does not understand rather than
 * returning false, so a predicate shape it cannot read fails the suite loudly
 * instead of passing vacuously.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, getTableColumns, isSQLWrapper, SQL, Column } from "drizzle-orm";

const ROOT = path.resolve(__dirname, "../..");

const ORG_A = 1; // the victim
const ORG_B = 2; // the caller holding someone else's id

// ============================================================================
// A fake `db` that runs the REAL compiled SQL predicate over in-memory rows.
// ============================================================================

const dialect = new PgDialect();

/** (table_name, column_name) -> the camelCase key rows are stored under. */
const columnKey = new Map<string, string>();

function register(table: any): void {
  const tname = getTableName(table);
  for (const [key, col] of Object.entries(getTableColumns(table) as Record<string, any>)) {
    columnKey.set(`${tname}.${col.name}`, key);
  }
}

// ── tokenizer ───────────────────────────────────────────────────────────────

function tokenize(sql: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      // A quoted identifier, possibly the "tbl"."col" pair.
      let j = sql.indexOf('"', i + 1);
      if (j === -1) throw new Error(`unterminated identifier in: ${sql}`);
      let ident = sql.slice(i + 1, j);
      i = j + 1;
      if (sql[i] === "." && sql[i + 1] === '"') {
        j = sql.indexOf('"', i + 2);
        if (j === -1) throw new Error(`unterminated identifier in: ${sql}`);
        ident = `${ident}.${sql.slice(i + 2, j)}`;
        i = j + 1;
      }
      toks.push(`@${ident}`);
      continue;
    }
    if (c === "$") {
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) j++;
      toks.push(sql.slice(i, j));
      i = j;
      continue;
    }
    if (c === "'") {
      const j = sql.indexOf("'", i + 1);
      if (j === -1) throw new Error(`unterminated literal in: ${sql}`);
      toks.push(`'${sql.slice(i + 1, j)}`);
      i = j + 1;
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (two === "<>" || two === ">=" || two === "<=") { toks.push(two); i += 2; continue; }
    if ("()=<>,".includes(c)) { toks.push(c); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < sql.length && /[A-Za-z_0-9]/.test(sql[j])) j++;
      toks.push(sql.slice(i, j).toLowerCase());
      i = j;
      continue;
    }
    throw new Error(`tenancy fake db: unreadable character ${JSON.stringify(c)} in ${sql}`);
  }
  return toks;
}

/** Dates arrive as Date on rows and as ISO strings in params. Normalise. */
function scalar(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(v)) return new Date(v).getTime();
  return v;
}

function evaluate(sql: string, params: unknown[], row: Record<string, unknown>): boolean {
  const toks = tokenize(sql);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];

  const operand = (): unknown => {
    const t = take();
    if (t === undefined) throw new Error(`tenancy fake db: ran off the end of ${sql}`);
    if (t.startsWith("@")) {
      const key = columnKey.get(t.slice(1));
      if (!key) throw new Error(`tenancy fake db: unregistered column ${t.slice(1)}`);
      return row[key] ?? null;
    }
    if (t.startsWith("$")) return params[Number(t.slice(1)) - 1] ?? null;
    if (t.startsWith("'")) return t.slice(1);
    if (t === "null") return null;
    throw new Error(`tenancy fake db: not an operand: ${t} in ${sql}`);
  };

  const comparison = (): boolean => {
    const left = operand();
    const op = take();
    if (op === "is") {
      let negate = false;
      if (peek() === "not") { take(); negate = true; }
      const nul = take();
      if (nul !== "null") throw new Error(`tenancy fake db: expected NULL, got ${nul}`);
      const isNull = left === null || left === undefined;
      return negate ? !isNull : isNull;
    }
    const right = operand();
    const a = scalar(left);
    const b = scalar(right);
    switch (op) {
      case "=": return a === b;
      case "<>": return a !== b;
      case ">=": return (a as number) >= (b as number);
      case "<=": return (a as number) <= (b as number);
      case ">": return (a as number) > (b as number);
      case "<": return (a as number) < (b as number);
      default: throw new Error(`tenancy fake db: unsupported operator ${op} in ${sql}`);
    }
  };

  const primary = (): boolean => {
    if (peek() === "(") { take(); const v = or(); if (take() !== ")") throw new Error(`unbalanced ) in ${sql}`); return v; }
    if (peek() === "not") { take(); return !primary(); }
    return comparison();
  };
  const and = (): boolean => {
    let v = primary();
    while (peek() === "and") { take(); const r = primary(); v = v && r; }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (peek() === "or") { take(); const r = and(); v = v || r; }
    return v;
  };

  const result = or();
  if (p !== toks.length) throw new Error(`tenancy fake db: trailing tokens in ${sql}`);
  return result;
}

function matches(pred: unknown, row: Record<string, unknown>): boolean {
  if (pred === undefined || pred === null) return true; // no WHERE at all
  const { sql, params } = dialect.sqlToQuery(pred as SQL);
  return evaluate(sql, params as unknown[], row);
}

/** Project a Drizzle selection object over a set of matched rows. */
function project(fields: any, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!fields) return rows.map((r) => ({ ...r }));
  const aggregate = Object.values(fields).some(
    (f: any) => f instanceof SQL || (isSQLWrapper(f) && !(f instanceof Column)),
  );
  const one = (r: Record<string, unknown> | null) => {
    const out: Record<string, unknown> = {};
    for (const [key, f] of Object.entries(fields as Record<string, any>)) {
      if (f instanceof Column) {
        out[key] = r ? r[columnKey.get(`${f.table[Symbol.for("drizzle:Name")]}.${f.name}`) ?? key] : null;
        continue;
      }
      // A raw SQL fragment. The only shape the code under test uses is
      // COALESCE(SUM("tbl"."col"), 0) — computed over the matched rows.
      const { sql } = dialect.sqlToQuery(f as SQL);
      const m = /sum\(\s*"(\w+)"\.\"?(\w+)"?\s*\)/i.exec(sql);
      if (!m) throw new Error(`tenancy fake db: unsupported select expression ${sql}`);
      const key2 = columnKey.get(`${m[1]}.${m[2]}`);
      if (!key2) throw new Error(`tenancy fake db: unregistered aggregate column ${m[1]}.${m[2]}`);
      out[key] = rows.reduce((acc, rr) => acc + Number(rr[key2] ?? 0), 0);
    }
    return out;
  };
  if (aggregate) return [one(rows[0] ?? null)];
  return rows.map((r) => one(r));
}

interface Store { [table: string]: Record<string, unknown>[] }

function makeDb(store: Store) {
  const rowsOf = (table: any) => (store[getTableName(table)] ??= []);

  function selectBuilder(fields: any) {
    let table: any = null;
    let pred: unknown = undefined;
    let lim: number | null = null;
    const run = () => {
      const hits = rowsOf(table).filter((r) => matches(pred, r));
      const limited = lim === null ? hits : hits.slice(0, lim);
      return project(fields, limited);
    };
    const b: any = {
      from: (t: any) => { table = t; return b; },
      where: (w: unknown) => { pred = w; return b; },
      limit: (n: number) => { lim = n; return b; },
      orderBy: () => b,
      groupBy: () => b,
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  }

  return {
    select: (fields?: any) => selectBuilder(fields),
    update: (table: any) => ({
      set: (values: Record<string, unknown>) => {
        let pred: unknown = undefined;
        const run = () => {
          const hits = rowsOf(table).filter((r) => matches(pred, r));
          for (const r of hits) Object.assign(r, values);
          return hits;
        };
        const b: any = {
          where: (w: unknown) => { pred = w; return b; },
          returning: (sel?: any) => ({ then: (res: any, rej: any) => Promise.resolve().then(() => project(sel, run())).then(res, rej) }),
          then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
        };
        return b;
      },
    }),
    insert: (table: any) => ({
      values: (v: Record<string, unknown>) => {
        const run = () => {
          const row = { id: `row-${rowsOf(table).length + 1}`, ...v };
          rowsOf(table).push(row);
          return [row];
        };
        const b: any = {
          onConflictDoNothing: () => b,
          returning: (sel?: any) => ({ then: (res: any, rej: any) => Promise.resolve().then(() => project(sel, run())).then(res, rej) }),
          then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
        };
        return b;
      },
    }),
    delete: (table: any) => {
      let pred: unknown = undefined;
      const run = () => {
        const hits = rowsOf(table).filter((r) => matches(pred, r));
        store[getTableName(table)] = rowsOf(table).filter((r) => !hits.includes(r));
        return hits;
      };
      const b: any = {
        where: (w: unknown) => { pred = w; return b; },
        returning: (sel?: any) => ({ then: (res: any, rej: any) => Promise.resolve().then(() => project(sel, run())).then(res, rej) }),
        then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
      };
      return b;
    },
  };
}

const store: Store = {};
const fakeDb = makeDb(store);

// The factory is hoisted above this file's top-level statements, so it must
// not close over `fakeDb` directly (TDZ). It reads it off the module scope at
// call time instead, and the modules under test are imported dynamically in
// `beforeAll` — after `fakeDb` exists.
vi.mock("../../server/db", () => {
  const d = () => fakeDb;
  return {
    get db() { return d(); },
    get dbReadOnly() { return d(); },
    dbReplica: null,
    get dbReplicaUnsafe() { return d(); },
    pool: { query: async () => ({ rows: [] }) },
    replicaPool: { query: async () => ({ rows: [] }) },
    DB_ROLES: { primary: "primary", replica: "replica" },
    withTransaction: async (fn: any) => fn(d()),
    assertReplicaRoleAtBoundary: async () => undefined,
  };
});

// The HMAC secret must never be decrypted for a partner the caller does not
// own. Spying on the decryptor is how we assert that, not by inspecting a
// thrown message.
const decryptSpy = vi.fn((s: string) => `plain:${s}`);
vi.mock("../../server/services/fieldEncryption", () => ({
  decrypt: (s: string) => decryptSpy(s),
  encrypt: (s: string) => `enc:${s}`,
}));

// ============================================================================

import { achMandates } from "@shared/schema/ach-autopay";
import { titleOrders, titlePartners, notes } from "@shared/schema";
import {
  paymentApplications,
  periodicStatements as periodicStatementsTable,
  periodicStatementSkips,
} from "@shared/schema/reg-z";
import { acquiredNotes } from "@shared/schema/notes-vertical";

for (const t of [
  achMandates,
  titleOrders,
  titlePartners,
  notes,
  paymentApplications,
  periodicStatementsTable,
  periodicStatementSkips,
  acquiredNotes,
]) register(t);

// Loaded in beforeAll, not statically: a static import would pull
// `server/db` in before the fake above exists.
let revokeAchMandatesForNote: typeof import("../../server/services/achMandateSetup")["revokeAchMandatesForNote"];
let issueWireInstructions: typeof import("../../server/services/wireInstructions")["issueWireInstructions"];
let generateStatementsForCycle: typeof import("../../server/services/periodicStatements")["generateStatementsForCycle"];

beforeAll(async () => {
  ({ revokeAchMandatesForNote } = await import("../../server/services/achMandateSetup"));
  ({ issueWireInstructions } = await import("../../server/services/wireInstructions"));
  ({ generateStatementsForCycle } = await import("../../server/services/periodicStatements"));
});

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  decryptSpy.mockClear();
}

// ============================================================================
// 1. The ACH debit rail — a WRITE that withdraws a NACHA authorization.
// ============================================================================

describe("revokeAchMandatesForNote is pinned to the owning org", () => {
  const NOTE_ID = 4242;

  beforeEach(() => {
    reset();
    store[getTableName(achMandates)] = [
      {
        id: 11,
        organizationId: ORG_A,
        noteId: NOTE_ID,
        status: "active",
        revokedAt: null,
        revokedReason: null,
        updatedAt: null,
      },
    ];
  });

  it("another org's noteId revokes nothing and leaves the authorization live", async () => {
    const revoked = await revokeAchMandatesForNote({
      organizationId: ORG_B,
      noteId: NOTE_ID,
      reason: "attacker turned 'their' autopay off",
    });

    expect(revoked, "a cross-tenant noteId revoked a live ACH mandate").toBe(0);
    const row = store[getTableName(achMandates)][0];
    expect(row.status, "the victim's mandate status was mutated").toBe("active");
    expect(row.revokedAt, "the victim's mandate was stamped revoked").toBeNull();
    expect(row.revokedReason).toBeNull();
  });

  it("the owning org still revokes — the predicate is not vacuously false", async () => {
    const revoked = await revokeAchMandatesForNote({
      organizationId: ORG_A,
      noteId: NOTE_ID,
      reason: "Borrower turned autopay off in the borrower portal.",
    });

    expect(revoked).toBe(1);
    expect(store[getTableName(achMandates)][0].status).toBe("revoked");
  });

  it("already-terminal mandates are still excluded (the status guards survived)", async () => {
    store[getTableName(achMandates)].push({
      id: 12,
      organizationId: ORG_A,
      noteId: NOTE_ID,
      status: "superseded",
      revokedAt: null,
      revokedReason: null,
      updatedAt: null,
    });
    const revoked = await revokeAchMandatesForNote({
      organizationId: ORG_A,
      noteId: NOTE_ID,
      reason: "off",
    });
    expect(revoked).toBe(1);
    expect(store[getTableName(achMandates)][1].status).toBe("superseded");
  });
});

// ============================================================================
// 2. The wire rail — ALTA Pillar 2 confirmation phone + partner HMAC secret.
// ============================================================================

const WIRE_PAYLOAD = {
  bankName: "First Settlement Bank",
  routingNumber: "021000021",
  accountNumber: "000123456789",
  accountHolder: "Hartwell Title Escrow",
  reference: "Order 900",
  amount: "125000.00",
  confirmationPhone: "+1-555-0100",
};

describe("issueWireInstructions is pinned to the owning org", () => {
  beforeEach(() => {
    reset();
    store[getTableName(titleOrders)] = [
      {
        id: 900,
        organizationId: ORG_A,
        titlePartnerId: 77,
        status: "assigned",
        wireInstructionsPdfS3Key: null,
        wireInstructionsPasswordHint: null,
        wireInstructionsHmac: null,
        wireConfirmationPhone: null,
        wireInstructionsIssuedAt: null,
        updatedAt: null,
      },
      {
        id: 901,
        organizationId: ORG_B,
        titlePartnerId: 77, // a partner privately owned by ORG_A
        status: "assigned",
        wireInstructionsHmac: null,
        wireConfirmationPhone: null,
      },
      {
        id: 902,
        organizationId: ORG_B,
        titlePartnerId: 78, // the platform-default partner
        status: "assigned",
        wireInstructionsHmac: null,
        wireConfirmationPhone: null,
      },
    ];
    store[getTableName(titlePartners)] = [
      { id: 77, organizationId: ORG_A, partnerName: "Hartwell", hmacSecretEncrypted: "secret-A" },
      { id: 78, organizationId: null, partnerName: "Platform default", hmacSecretEncrypted: "secret-P" },
    ];
  });

  it("another org's orderId is not found, and nothing is written to it", async () => {
    await expect(
      issueWireInstructions(ORG_B, 900, WIRE_PAYLOAD, "+1-555-0199"),
    ).rejects.toThrow(/title_order 900 not found/);

    const victim = store[getTableName(titleOrders)][0];
    expect(
      victim.wireConfirmationPhone,
      "the ALTA out-of-band confirmation phone was overwritten cross-tenant",
    ).toBeNull();
    expect(victim.wireInstructionsHmac).toBeNull();
    expect(victim.wireInstructionsPdfS3Key).toBeNull();
    expect(victim.status).toBe("assigned");
    expect(decryptSpy, "another org's HMAC secret was decrypted").not.toHaveBeenCalled();
  });

  it("the owning org still issues — the predicate is not vacuously false", async () => {
    const issued = await issueWireInstructions(ORG_A, 900, WIRE_PAYLOAD, "+1-555-0199");

    expect(issued.password).toHaveLength(12);
    expect(issued.hmacSignature).toMatch(/^[0-9a-f]{64}$/);
    const row = store[getTableName(titleOrders)][0];
    expect(row.status).toBe("wire_instructions_issued");
    expect(row.wireConfirmationPhone).toBe("+1-555-0100");
    expect(decryptSpy).toHaveBeenCalledWith("secret-A");
  });

  it("a partner privately owned by another org is refused, secret never decrypted", async () => {
    // Order 901 IS ORG_B's, so the order lookup succeeds — but it points at
    // partner 77, which belongs to ORG_A. Signing would require decrypting
    // another tenant's shared secret.
    await expect(
      issueWireInstructions(ORG_B, 901, WIRE_PAYLOAD, "+1-555-0199"),
    ).rejects.toThrow(/partner 77 not found for order 901/);
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it("the platform-default partner (organization_id IS NULL) stays reachable", async () => {
    // Guard against over-tightening: title_partners.organization_id is
    // NULLABLE by design and NULL means "any org may route to it".
    const issued = await issueWireInstructions(ORG_B, 902, WIRE_PAYLOAD, "+1-555-0199");
    expect(issued.hmacSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptSpy).toHaveBeenCalledWith("secret-P");
  });
});

// ============================================================================
// 3. Reg-Z periodic statements — the dollars on a statutory disclosure.
// ============================================================================

describe("computeStatementFields sums only the caller's org", () => {
  // `payment_applications.loan_id` is `text` and carries no foreign key, so
  // the SAME value in two orgs is not exotic — it is the default outcome of
  // two tenants each having a loan #7.
  const SHARED_LOAN_ID = "7";

  beforeEach(() => {
    reset();
    store[getTableName(notes)] = [
      {
        id: 7,
        organizationId: ORG_A,
        status: "active",
        nextPaymentDate: "2026-09-15",
        amortizationSchedule: null,
        monthlyPayment: "1000.00",
        currentBalance: "100000.00",
        interestRate: "6.00",
        monthlyTaxEscrow: "0",
      },
    ];
    store[getTableName(acquiredNotes)] = [];
    store[getTableName(periodicStatementsTable)] = [];
    store[getTableName(paymentApplications)] = [
      {
        id: "pa-a",
        organizationId: ORG_A,
        loanId: SHARED_LOAN_ID,
        loanType: "note",
        appliedAt: new Date("2026-08-10T00:00:00.000Z"),
        appliedToPrincipalCents: 100,
        appliedToInterestCents: 200,
        appliedToEscrowCents: 300,
        appliedToFeesCents: 400,
        appliedToSuspenseCents: 0,
      },
      {
        // ORG_B's money, same loan_id, same cycle. It must not appear in
        // ORG_A's §1026.41 statement.
        id: "pa-b",
        organizationId: ORG_B,
        loanId: SHARED_LOAN_ID,
        loanType: "note",
        appliedAt: new Date("2026-08-11T00:00:00.000Z"),
        appliedToPrincipalCents: 9_000_000,
        appliedToInterestCents: 9_000_000,
        appliedToEscrowCents: 9_000_000,
        appliedToFeesCents: 9_000_000,
        appliedToSuspenseCents: 0,
      },
    ];
  });

  it("neither the cycle breakdown nor the YTD totals include the other org", async () => {
    const result = await generateStatementsForCycle(ORG_A, new Date("2026-08-16T00:00:00.000Z"));

    expect(result.errors, "generation errored — the assertions below would be vacuous").toEqual([]);
    expect(result.statementsGenerated).toBe(1);

    const [row] = store[getTableName(periodicStatementsTable)];
    expect(row, "no statement row was persisted").toBeTruthy();

    expect(row.pastPaymentBreakdown).toEqual({
      principalCents: 100,
      interestCents: 200,
      escrowCents: 300,
      feesCents: 400,
      unappliedCents: 0,
      totalReceivedCents: 1000,
    });
    expect(row.ytdPrincipalCents).toBe(100);
    expect(row.ytdInterestCents).toBe(200);
    expect(row.ytdEscrowCents).toBe(300);
    expect(row.ytdFeesCents).toBe(400);

    // The transactions array is rendered onto the borrower's statement; one
    // foreign row here is a disclosed transaction that never happened.
    expect((row.transactions as unknown[]).length).toBe(1);
  });
});

// ============================================================================
// 4. Source-level backstop: no query in the three files resolves by id alone.
// ============================================================================

function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

/**
 * The text of one top-level function. `\n}\n` — a closing brace in column
 * zero — is the terminator, because `}): Promise<T> {` (an inline parameter
 * object type, which two of these three signatures have) also begins with
 * `\n}` and would cut the body off before its first query.
 */
function body(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `${marker} is gone — renamed?`).toBeGreaterThan(-1);
  const open = src.indexOf("{", src.indexOf(")", at));
  const end = src.indexOf("\n}\n", open);
  expect(end, `${marker} has no column-zero close — the slice would be the rest of the file`).toBeGreaterThan(-1);
  return src.slice(at, end);
}

describe("the predicates carry the org in source, not only at runtime", () => {
  const ach = stripComments(fs.readFileSync(path.join(ROOT, "server/services/achMandateSetup.ts"), "utf8"));
  const wire = stripComments(fs.readFileSync(path.join(ROOT, "server/services/wireInstructions.ts"), "utf8"));
  const stmt = stripComments(fs.readFileSync(path.join(ROOT, "server/services/periodicStatements/index.ts"), "utf8"));
  const borrowerRoutes = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-borrower.ts"), "utf8"));

  it("revokeAchMandatesForNote filters on organizationId", () => {
    const fn = body(ach, "export async function revokeAchMandatesForNote");
    expect(fn).toContain("eq(achMandates.organizationId, input.organizationId)");
  });

  it("both borrower-portal callers pass the note's org", () => {
    const calls = borrowerRoutes.match(/revokeAchMandatesForNote\(\{[^}]*\}/gs) ?? [];
    expect(calls.length, "the autopay-off call sites moved").toBe(2);
    for (const c of calls) {
      expect(c, "a caller revokes mandates without an organization").toContain(
        "organizationId: note.organizationId",
      );
    }
  });

  it("issueWireInstructions scopes the order read AND the order write", () => {
    const fn = body(wire, "export async function issueWireInstructions");
    const lone = fn.match(/where\(\s*eq\(titleOrders\.id\s*,[^)]*\)\s*,?\s*\)/g) ?? [];
    expect(lone.join(" | "), "a title_orders query resolves by bare primary key").toBe("");
    expect(fn.match(/eq\(titleOrders\.organizationId, organizationId\)/g)?.length ?? 0).toBe(2);
  });

  it("computeStatementFields carries the org on BOTH payment_applications queries", () => {
    const fn = body(stmt, "async function computeStatementFields");
    const scoped = fn.match(/eq\(paymentApplications\.organizationId, organizationId\)/g) ?? [];
    const loanFilters = fn.match(/eq\(paymentApplications\.loanId,/g) ?? [];
    expect(loanFilters.length, "the loan_id predicates moved").toBe(2);
    expect(
      scoped.length,
      "fewer org predicates than loan_id predicates — one query lost its tenant term",
    ).toBe(loanFilters.length);
  });
});

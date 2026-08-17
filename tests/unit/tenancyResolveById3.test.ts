/**
 * Four more bare-primary-key sites, four tenant boundaries — proved by the SQL
 * the code actually emits.
 *
 * Each of these touched an org-scoped table with `organization_id NOT NULL`
 * and never put that column in the WHERE clause:
 *
 *   server/services/achMandateSetup.ts::getAchMandateSummary
 *       `SELECT * FROM ach_mandates WHERE note_id = $1` — returns the
 *       borrower's BANK INSTRUMENT (bank name, account last-4, the authorized
 *       ceiling, the authorization's state). Six callers in routes-borrower.ts
 *       all derive `note.id` from a validated borrower session, so it was
 *       correct by caller discipline rather than by construction. The seventh
 *       caller would have been the disclosure.
 *
 *   server/services/wireInstructions.ts::recordWireConfirmation
 *       `UPDATE title_orders SET wire_confirmed_at = now() WHERE id = $1`.
 *       This one had NO CALLER anywhere in the repo — a loaded gun with no
 *       trigger. `wire_confirmed_at` attests that a human called the number
 *       back and heard the account details read aloud; setting it on another
 *       tenant's order forges the one control standing between a title order
 *       and a misdirected wire. Fixed now so the FIRST caller cannot compile
 *       without deciding whose order it is.
 *
 *   server/services/recognitionWorker.ts::isAlreadyPosted (+ the in-transaction
 *   re-check inside postBalancedTuple)
 *       `SELECT id FROM account_ledger_entries WHERE reference_type = $1 AND
 *       reference_id = $2` — a POLYMORPHIC foreign key, unique by convention
 *       rather than by constraint. This check fails CLOSED: a cross-tenant hit
 *       does not leak a row, it SILENTLY SKIPS a real ledger posting and
 *       leaves the books short a balanced tuple with no error raised anywhere.
 *
 *   server/services/leadQualification.ts::acknowledgeAlert
 *       The live one. `POST /api/alerts/:id/acknowledge` (routes-misc.ts) took
 *       `:id` straight off the URL, and the handler's own `getOrCreateOrg` org
 *       was used for nothing. Any authenticated member of any org could
 *       acknowledge any other tenant's escalation by guessing an integer — a
 *       WRITE that stamps the caller's user id and free-text `actionTaken`
 *       onto the victim's row, both suppressing their escalation and forging a
 *       name against it.
 *
 * WHY THIS FILE USES A REAL QUERY BUILDER
 * ---------------------------------------
 * A behavioural test against a hand-written storage double cannot see a
 * missing WHERE: the double decides what "belongs to org A" means, so it
 * passes whether or not the SQL says so. That is the trap
 * `investorVerificationTenancy.test.ts` documents, and it is the documented
 * blind spot of `check-org-scoped-fetch.mjs` itself ("a method that ACCEPTS an
 * orgId but forgets to apply the predicate is not caught").
 *
 * So `db` here is a REAL Drizzle instance (the `pg-proxy` driver) building
 * REAL SQL. The fake sits one layer lower, at the wire: it parses the emitted
 * statement's WHERE clause into (column, bound-parameter) pairs and filters
 * in-memory rows by exactly those pairs. Nothing in the harness knows that
 * `organization_id` is special — an unscoped statement parses to fewer pairs,
 * the filter widens, and the other tenant's row matches.
 *
 * Drop the org predicate from any of the four queries and the "returns
 * nothing / changes nothing" expectations below fail. A test asserting the
 * shape of its own mock could not do that.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// The wire-level fake. Hoisted so it exists before any mocked import runs.
// ---------------------------------------------------------------------------

const harness = vi.hoisted(() => {
  /** table name → rows, keyed by SQL column name (snake_case). */
  const tables = new Map<string, Record<string, any>[]>();

  interface Stmt {
    kind: "select" | "update" | "delete" | "insert" | "raw";
    table: string | null;
    sql: string;
    params: any[];
    /** Equality pairs parsed out of the WHERE clause of the REAL SQL. */
    conds: Array<{ column: string; value: any }>;
    matchedIds: any[];
  }
  const calls: Stmt[] = [];

  const quoted = (s: string) => [...s.matchAll(/"([a-z0-9_]+)"/gi)].map((m) => m[1]);

  function run(rawSql: string, params: any[]): any[] {
    const s = rawSql.replace(/\s+/g, " ").trim();
    const lower = s.toLowerCase();

    let kind: Stmt["kind"] = "raw";
    let table: string | null = null;
    let selectList = "";
    let m: RegExpExecArray | null;
    if ((m = /^select (.*?) from "([a-z0-9_]+)"/i.exec(s))) {
      kind = "select";
      selectList = m[1];
      table = m[2];
    } else if ((m = /^update "([a-z0-9_]+)"/i.exec(s))) {
      kind = "update";
      table = m[1];
    } else if ((m = /^delete from "([a-z0-9_]+)"/i.exec(s))) {
      kind = "delete";
      table = m[1];
    } else if ((m = /^insert into "([a-z0-9_]+)"/i.exec(s))) {
      kind = "insert";
      table = m[1];
    }

    // ── WHERE → equality pairs, straight off the emitted statement ────────
    // The SET clause of an UPDATE is `"col" = $n` (unqualified) while a WHERE
    // predicate is `"table"."col" = $n`, so requiring the table qualifier is
    // what keeps assignments out of the predicate list. Verified against the
    // real emitted SQL for all four statements under test.
    const conds: Stmt["conds"] = [];
    const wi = lower.indexOf(" where ");
    if (wi !== -1) {
      let where = s.slice(wi + " where ".length);
      for (const stop of [" returning ", " order by ", " group by ", " limit "]) {
        const k = where.toLowerCase().indexOf(stop);
        if (k !== -1) where = where.slice(0, k);
      }
      const re = /"([a-z0-9_]+)"\."([a-z0-9_]+)" = \$(\d+)/gi;
      let c: RegExpExecArray | null;
      while ((c = re.exec(where)) !== null) {
        conds.push({ column: c[2], value: params[Number(c[3]) - 1] });
      }
    }

    const stmt: Stmt = { kind, table, sql: s, params, conds, matchedIds: [] };
    calls.push(stmt);

    if (kind === "raw") return [];
    if (kind === "insert") return [];

    const rows = tables.get(table!) ?? [];
    // No parsed predicate means an UNSCOPED statement — every row matches,
    // which is precisely how the defect behaved against a real database.
    const matched = rows.filter((r) =>
      conds.every((c) => String(r[c.column]) === String(c.value)),
    );
    stmt.matchedIds = matched.map((r) => r.id);

    // Output columns: the RETURNING list if present, else the SELECT list.
    const ri = lower.indexOf(" returning ");
    const outCols = ri !== -1 ? quoted(s.slice(ri)) : kind === "select" ? quoted(selectList) : [];

    if (kind === "select") {
      return matched.map((r) => outCols.map((col) => r[col] ?? null));
    }

    if (kind === "delete") {
      tables.set(
        table!,
        rows.filter((r) => !matched.includes(r)),
      );
      return matched.map((r) => outCols.map((col) => r[col] ?? null));
    }

    // update — apply the SET assignments so later reads see real state.
    const si = lower.indexOf(" set ");
    if (si !== -1) {
      const setText = s.slice(si + " set ".length, wi === -1 ? undefined : wi);
      for (const a of setText.matchAll(/"([a-z0-9_]+)" = \$(\d+)/g)) {
        for (const r of matched) r[a[1]] = params[Number(a[2]) - 1];
      }
    }
    return matched.map((r) => outCols.map((col) => r[col] ?? null));
  }

  return {
    tables,
    calls,
    run,
    reset() {
      tables.clear();
      calls.length = 0;
    },
    /** Statements issued against one table, in order. */
    on(table: string) {
      return calls.filter((c) => c.table === table);
    },
    rows(table: string) {
      return tables.get(table) ?? [];
    },
  };
});

vi.mock("../../server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db: any = drizzle(async (sql: string, params: any[]) => ({
    rows: harness.run(sql, params),
  }));
  // The pg-proxy driver refuses `.transaction()` outright ("Transactions are
  // not supported by the Postgres Proxy driver"). postBalancedTuple does its
  // authoritative existence re-check inside one, so we run the callback
  // against the same real builder — the inner statement still emits real SQL
  // through the harness, which is the whole point of asserting on it.
  db.transaction = async (fn: any) => fn(db);
  return {
    db,
    dbReadOnly: db,
    dbReplica: null,
    dbReplicaUnsafe: db,
    pool: { query: async () => ({ rows: [] }) },
    withTransaction: async (fn: any) => fn(db),
  };
});

// Boundaries that are not the thing under test.
vi.mock("../../server/services/aiRouter", () => ({
  generateWithAutoRouting: vi.fn(async () => ({ content: "{}" })),
  routeAITask: vi.fn(async () => ({ content: "neutral" })),
  TaskComplexity: { SIMPLE: "simple", MODERATE: "moderate", COMPLEX: "complex" },
}));
vi.mock("../../server/services/fieldEncryption", () => ({
  decrypt: vi.fn(() => "decrypted-secret"),
  encrypt: vi.fn((v: string) => v),
}));

import { getAchMandateSummary } from "../../server/services/achMandateSetup";
import { recordWireConfirmation } from "../../server/services/wireInstructions";
import { recordStripeInvoicePaid } from "../../server/services/recognitionWorker";
import { acknowledgeAlert } from "../../server/services/leadQualification";

const ORG_A = 1;
const ORG_B = 2;

/** Every equality column the emitted WHERE of a statement constrained. */
const predicateColumns = (stmt: { conds: Array<{ column: string }> }) =>
  stmt.conds.map((c) => c.column);

const orgTerm = (stmt: { conds: Array<{ column: string; value: any }> }) =>
  stmt.conds.find((c) => c.column === "organization_id");

beforeEach(() => {
  harness.reset();
  vi.clearAllMocks();
});

// ===========================================================================
// 1. achMandateSetup.getAchMandateSummary — the borrower's bank instrument
// ===========================================================================

describe("getAchMandateSummary refuses another org's mandate", () => {
  const seed = () => {
    harness.tables.set("ach_mandates", [
      {
        id: 10,
        organization_id: ORG_A,
        note_id: 900,
        status: "active",
        bank_name: "Org A Savings & Loan",
        account_last4: "1111",
        max_amount_cents: 50_000,
        schedule_description: "Monthly on the 1st",
        // Postgres wire format for `timestamp` (space-separated, no zone) —
        // Drizzle's mapFromDriverValue appends "+0000" to it.
        agreed_at: "2026-05-01 00:00:00",
        authorization_text_version: "v3",
        processor_payment_method_id: "pm_a",
        processor_customer_id: "cus_a",
        processor_account_id: "acct_a",
      },
      {
        id: 11,
        organization_id: ORG_B,
        note_id: 901,
        status: "active",
        bank_name: "Org B Credit Union",
        account_last4: "9999",
        max_amount_cents: 250_000,
        schedule_description: "Monthly on the 15th",
        agreed_at: "2026-06-01 00:00:00",
        authorization_text_version: "v3",
        processor_payment_method_id: "pm_b",
        processor_customer_id: "cus_b",
        processor_account_id: "acct_b",
      },
    ]);
  };

  it("discloses NOTHING about a note belonging to another org", async () => {
    seed();
    const summary = await getAchMandateSummary(ORG_A, 901);

    expect(
      summary.bankName,
      "org A was handed org B's BANK NAME — this is the borrower's bank instrument",
    ).toBeNull();
    expect(summary.accountLast4, "org A was handed org B's account last-4").toBeNull();
    expect(summary.maxAmountCents, "org A was handed org B's authorized debit ceiling").toBeNull();
    expect(summary.status, "a stranger's note must be indistinguishable from no mandate").toBe(
      "none",
    );
    expect(summary.armed).toBe(false);
  });

  it("emits organization_id in the SELECT predicate (not a post-fetch compare)", async () => {
    seed();
    await getAchMandateSummary(ORG_A, 901);

    const stmts = harness.on("ach_mandates");
    expect(stmts.length, "no statement reached ach_mandates at all").toBe(1);
    expect(stmts[0].kind).toBe("select");
    expect(
      predicateColumns(stmts[0]),
      "the SELECT resolves mandates by note_id alone",
    ).toEqual(expect.arrayContaining(["organization_id", "note_id"]));
    expect(orgTerm(stmts[0])!.value).toBe(ORG_A);
  });

  it("still returns the caller's OWN mandate in full", async () => {
    seed();
    const summary = await getAchMandateSummary(ORG_A, 900);

    expect(summary.armed, "the org predicate broke the legitimate read").toBe(true);
    expect(summary.bankName).toBe("Org A Savings & Loan");
    expect(summary.accountLast4).toBe("1111");
    expect(summary.maxAmountCents).toBe(50_000);
    expect(summary.status).toBe("active");
  });
});

// ===========================================================================
// 2. wireInstructions.recordWireConfirmation — the wire-callback attestation
// ===========================================================================

describe("recordWireConfirmation refuses another org's title order", () => {
  const seed = () => {
    harness.tables.set("title_orders", [
      { id: 700, organization_id: ORG_A, wire_confirmed_at: null, updated_at: null },
      { id: 701, organization_id: ORG_B, wire_confirmed_at: null, updated_at: null },
    ]);
  };

  it("does NOT stamp a confirmation on another org's order", async () => {
    seed();
    await recordWireConfirmation(ORG_A, 701);

    const victim = harness.rows("title_orders").find((r) => r.id === 701)!;
    expect(
      victim.wire_confirmed_at,
      "an org-A caller forged the out-of-band wire confirmation on org B's title " +
        "order — the single control between a title order and a misdirected wire",
    ).toBeNull();
  });

  it("emits organization_id in the UPDATE predicate", async () => {
    seed();
    await recordWireConfirmation(ORG_A, 701);

    const stmts = harness.on("title_orders");
    expect(stmts.length, "no statement reached title_orders at all").toBe(1);
    expect(stmts[0].kind).toBe("update");
    expect(
      predicateColumns(stmts[0]),
      "the UPDATE resolves the order by bare primary key",
    ).toEqual(expect.arrayContaining(["id", "organization_id"]));
    expect(orgTerm(stmts[0])!.value).toBe(ORG_A);
    expect(stmts[0].matchedIds, "the cross-tenant UPDATE matched a row").toEqual([]);
  });

  it("still confirms the caller's OWN order", async () => {
    seed();
    await recordWireConfirmation(ORG_A, 700);

    const own = harness.rows("title_orders").find((r) => r.id === 700)!;
    expect(own.wire_confirmed_at, "the org predicate broke the legitimate write").not.toBeNull();
  });
});

// ===========================================================================
// 3. recognitionWorker.isAlreadyPosted — the idempotency check that fails CLOSED
// ===========================================================================

describe("recognitionWorker idempotency does not collide across orgs", () => {
  const REF_ID = "invoice.paid:in_collide";

  const seedAccounts = () => {
    harness.tables.set("chart_of_accounts", [
      { id: "coa-a-cash", organization_id: ORG_A, account_number: "1000" },
      { id: "coa-a-rev", organization_id: ORG_A, account_number: "4000" },
      { id: "coa-a-def", organization_id: ORG_A, account_number: "2050" },
    ]);
  };

  const invoice = {
    id: "in_collide",
    customerId: "cus_a",
    organizationId: ORG_A,
    amountPaidCents: 12_900,
    paidAt: "2026-08-01T00:00:00.000Z",
    periodStartIso: "2026-08-01T00:00:00.000Z",
    periodEndIso: "2026-09-01T00:00:00.000Z",
  };

  it("posts org A's ledger tuple even when ANOTHER org holds the same reference id", async () => {
    seedAccounts();
    // Org B already booked something under the identical polymorphic reference.
    harness.tables.set("account_ledger_entries", [
      {
        id: "led-b-1",
        organization_id: ORG_B,
        reference_type: "stripe_event",
        reference_id: REF_ID,
      },
    ]);

    const result = await recordStripeInvoicePaid(invoice);

    expect(
      result.posted,
      "org B's ledger row silently suppressed org A's posting — this check fails " +
        "CLOSED, so the books end up short a balanced tuple with no error raised",
    ).toBe(true);
    expect(result.legs).toBe(2);
  });

  it("emits organization_id on BOTH the pre-check and the in-transaction re-check", async () => {
    seedAccounts();
    harness.tables.set("account_ledger_entries", []);

    await recordStripeInvoicePaid(invoice);

    const existenceChecks = harness
      .on("account_ledger_entries")
      .filter((c) => c.kind === "select");
    expect(
      existenceChecks.length,
      "expected the cheap pre-check AND the authoritative in-transaction re-check",
    ).toBe(2);

    for (const [i, stmt] of existenceChecks.entries()) {
      expect(
        predicateColumns(stmt),
        `existence check #${i + 1} matches on the polymorphic FK alone — the ` +
          `in-transaction one is the guard that actually decides the insert`,
      ).toEqual(expect.arrayContaining(["organization_id", "reference_type", "reference_id"]));
      expect(orgTerm(stmt)!.value).toBe(ORG_A);
    }
  });

  it("still short-circuits on the caller's OWN duplicate (idempotency preserved)", async () => {
    seedAccounts();
    harness.tables.set("account_ledger_entries", [
      {
        id: "led-a-1",
        organization_id: ORG_A,
        reference_type: "stripe_event",
        reference_id: REF_ID,
      },
    ]);

    const result = await recordStripeInvoicePaid(invoice);

    expect(
      result.posted,
      "the org predicate broke same-org idempotency — a Stripe redelivery would " +
        "now double-post",
    ).toBe(false);
    expect(result.legs).toBe(0);
  });
});

// ===========================================================================
// 4. leadQualification.acknowledgeAlert — the live unguarded write
// ===========================================================================

describe("acknowledgeAlert refuses another org's escalation", () => {
  const seed = () => {
    harness.tables.set("escalation_alerts", [
      {
        id: 300,
        organization_id: ORG_A,
        status: "pending",
        acknowledged_at: null,
        acknowledged_by: null,
        action_taken: null,
      },
      {
        id: 301,
        organization_id: ORG_B,
        status: "pending",
        acknowledged_at: null,
        acknowledged_by: null,
        action_taken: null,
      },
    ]);
  };

  it("does NOT suppress or sign another org's alert", async () => {
    seed();
    await acknowledgeAlert(ORG_A, 301, "user-from-org-a", "marked handled");

    const victim = harness.rows("escalation_alerts").find((r) => r.id === 301)!;
    expect(
      victim.status,
      "an org-A user acknowledged org B's escalation via POST /api/alerts/:id/acknowledge",
    ).toBe("pending");
    expect(
      victim.acknowledged_by,
      "the attacker's user id was stamped onto another tenant's alert",
    ).toBeNull();
    expect(victim.acknowledged_at).toBeNull();
  });

  it("emits organization_id in the UPDATE predicate", async () => {
    seed();
    await acknowledgeAlert(ORG_A, 301, "user-from-org-a", "marked handled");

    const stmts = harness.on("escalation_alerts");
    expect(stmts.length, "no statement reached escalation_alerts at all").toBe(1);
    expect(stmts[0].kind).toBe("update");
    expect(
      predicateColumns(stmts[0]),
      "the UPDATE resolves the alert by bare primary key straight off the URL",
    ).toEqual(expect.arrayContaining(["id", "organization_id"]));
    expect(orgTerm(stmts[0])!.value).toBe(ORG_A);
    expect(stmts[0].matchedIds, "the cross-tenant UPDATE matched a row").toEqual([]);
  });

  it("still acknowledges the caller's OWN alert", async () => {
    seed();
    await acknowledgeAlert(ORG_A, 300, "user-from-org-a", "marked handled");

    const own = harness.rows("escalation_alerts").find((r) => r.id === 300)!;
    expect(own.status, "the org predicate broke the legitimate acknowledgement").toBe("actioned");
    expect(own.acknowledged_by).toBe("user-from-org-a");
  });
});

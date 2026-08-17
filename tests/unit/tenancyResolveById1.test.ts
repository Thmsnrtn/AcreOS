/**
 * Four bare-primary-key sites, four tenant boundaries — proved by the SQL the
 * code actually emits.
 *
 * Each of these resolved an org-scoped table by an id it was handed and never
 * put `organization_id` in the WHERE clause:
 *
 *   server/services/writingStyle.ts::deleteStyleProfile
 *       `DELETE FROM writing_style_profiles WHERE id = $1`, reached by
 *       `DELETE /api/writing-styles/:id` (routes-va-engine.ts) with NO org
 *       comparison anywhere in the handler. Any authenticated member of any
 *       org could destroy another org's profile by guessing an integer.
 *
 *   server/services/form1099Batch.ts::getForm1099BatchStatus
 *       A tax batch — recipient names, TINs, per-note interest, the FIRE file
 *       — resolved from a UUID off a URL segment. Guarded only by a
 *       hand-written `row.organizationId !== org.id` compare in the one route
 *       that called it, i.e. at the caller rather than by construction.
 *
 *   server/services/mail/mailFlusher.ts::flushOne
 *       A shipment id drove a real Lob send, a piece-status writeback, a
 *       refund and a COGS booking with no org predicate. Safe only because
 *       its ONE caller claims rows itself.
 *
 *   server/services/outcomeVerificationV12.ts::verifyPaymentStatus
 *       `verificationConfig.dealId` — an unvalidated blob from a request body
 *       — reached `where(eq(deals.id, …))`, reading any tenant's deal status.
 *
 * WHY THIS FILE USES A REAL QUERY BUILDER
 * ---------------------------------------
 * A behavioural test against a hand-written storage double cannot see a
 * missing WHERE: the double decides what "belongs to org A" means, so it
 * passes whether or not the SQL says so. That is the exact trap
 * `investorVerificationTenancy.test.ts` documents.
 *
 * So `db` here is a REAL Drizzle instance (the `pg-proxy` driver), which
 * builds REAL SQL. The fake sits one layer lower, at the wire: it parses the
 * emitted statement's WHERE clause into (column, bound-parameter) pairs and
 * filters the in-memory rows by exactly those pairs. Nothing in the harness
 * knows that `organization_id` is special.
 *
 * That inversion is what makes the assertions load-bearing. Drop the org
 * predicate from any of these queries and the emitted WHERE loses a pair, the
 * filter widens, the other tenant's row matches — and the "returns nothing /
 * changes nothing" expectations below fail. A test that asserted the shape of
 * its own mock could not do that.
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

  /** Set by a test when a statement is raw SQL the generic path can't model. */
  let rawRows: Record<string, any>[] = [];

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
    // what keeps assignments out of the predicate list.
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

    if (kind === "raw") return rawRows;
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
    setRawRows(rows: Record<string, any>[]) {
      rawRows = rows;
    },
    reset() {
      tables.clear();
      calls.length = 0;
      rawRows = [];
    },
    /** Statements issued against one table, in order. */
    on(table: string) {
      return calls.filter((c) => c.table === table);
    },
    rows(table: string) {
      return harnessRows(tables, table);
    },
  };

  function harnessRows(t: Map<string, Record<string, any>[]>, name: string) {
    return t.get(name) ?? [];
  }
});

vi.mock("../../server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db = drizzle(async (sql: string, params: any[]) => ({
    rows: harness.run(sql, params),
  }));
  return {
    db,
    dbReadOnly: db,
    dbReplica: null,
    dbReplicaUnsafe: db,
    pool: { query: async () => ({ rows: [] }) },
    withTransaction: async (fn: any) => fn(db),
  };
});

// Boundaries that are not the thing under test: the AI router, the mail
// provider, the credit pool, the outreach stop-loss and the verify queue.
vi.mock("../../server/services/aiRouter", () => ({
  routeAITask: vi.fn(async () => ({ content: "neutral" })),
  TaskComplexity: { SIMPLE: "simple", MODERATE: "moderate", COMPLEX: "complex" },
}));
vi.mock("../../server/routes-notes", () => ({
  aggregateAcquiredNoteInterestForYear: vi.fn(async () => []),
}));

const routeMock = vi.hoisted(() => ({
  fn: vi.fn(async () => ({
    chosenProvider: "lob",
    result: { pieces: [{ providerPieceId: "lob_piece_1" }] },
  })),
}));
vi.mock("../../server/services/mail/router", () => ({
  MailRouter: class {
    route = routeMock.fn;
  },
}));
const refundMock = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }));
vi.mock("../../server/services/creditPool", () => ({ refundPoolDebit: refundMock.fn }));
vi.mock("../../server/services/outreachStopLoss", () => ({
  getOutreachStopLossStatus: vi.fn(async () => ({ paused: false })),
  notifyOutreachPausedOnce: vi.fn(),
}));
vi.mock("../../server/services/solene/verifyQueue", () => ({
  enqueueMailShipmentVerify: vi.fn(async () => undefined),
}));

import { deleteStyleProfile } from "../../server/services/writingStyle";
import { getForm1099BatchStatus } from "../../server/services/form1099Batch";
import { flushDueMailShipments } from "../../server/services/mail/mailFlusher";
import { outcomeVerificationService } from "../../server/services/outcomeVerificationV12";

const ORG_A = 1;
const ORG_B = 2;

/** Every equality column the emitted WHERE of a statement constrained. */
const predicateColumns = (stmt: { conds: Array<{ column: string }> }) =>
  stmt.conds.map((c) => c.column);

beforeEach(() => {
  harness.reset();
  vi.clearAllMocks();
});

// ===========================================================================
// 1. writingStyle.deleteStyleProfile — the bare-PK DELETE
// ===========================================================================

describe("deleteStyleProfile refuses another org's profile", () => {
  const seed = () => {
    harness.tables.set("writing_style_profiles", [
      { id: 501, organization_id: ORG_A, user_id: "u-a", name: "A style" },
      { id: 502, organization_id: ORG_B, user_id: "u-b", name: "B style" },
    ]);
  };

  it("deletes NOTHING when the id belongs to another org", async () => {
    seed();
    const deleted = await deleteStyleProfile(ORG_A, 502);

    expect(deleted, "org A was told it deleted org B's profile").toBe(false);
    expect(
      harness.rows("writing_style_profiles").map((r) => r.id),
      "org B's writing-style profile was destroyed by an org-A caller — this is " +
        "the live, unguarded DELETE /api/writing-styles/:id path",
    ).toEqual([501, 502]);
  });

  it("emits organization_id in the DELETE predicate (not a post-fetch compare)", async () => {
    seed();
    await deleteStyleProfile(ORG_A, 502);

    const stmts = harness.on("writing_style_profiles");
    expect(stmts.length, "no statement reached writing_style_profiles at all").toBe(1);
    expect(stmts[0].kind).toBe("delete");
    expect(
      predicateColumns(stmts[0]),
      "the DELETE resolves the row by id alone",
    ).toEqual(expect.arrayContaining(["id", "organization_id"]));
    expect(stmts[0].conds.find((c) => c.column === "organization_id")!.value).toBe(ORG_A);
  });

  it("still deletes the caller's OWN profile", async () => {
    seed();
    const deleted = await deleteStyleProfile(ORG_A, 501);

    expect(deleted, "the org predicate broke the legitimate delete").toBe(true);
    expect(harness.rows("writing_style_profiles").map((r) => r.id)).toEqual([502]);
  });
});

// ===========================================================================
// 2. form1099Batch.getForm1099BatchStatus — tax batch on the money rail
// ===========================================================================

describe("getForm1099BatchStatus refuses another org's tax batch", () => {
  const seed = () => {
    harness.tables.set("form_1099_batches", [
      { id: "job-a", organization_id: ORG_A, tax_year: 2025, status: "success", form_count: 3 },
      { id: "job-b", organization_id: ORG_B, tax_year: 2025, status: "success", form_count: 9 },
    ]);
  };

  it("returns null for a jobId owned by another org", async () => {
    seed();
    const row = await getForm1099BatchStatus(ORG_A, "job-b");

    expect(
      row,
      "org A read org B's 1099 batch — the row carries recipient names, TINs and " +
        "the FIRE file",
    ).toBeNull();
  });

  it("emits organization_id in the SELECT predicate", async () => {
    seed();
    await getForm1099BatchStatus(ORG_A, "job-b");

    const stmts = harness.on("form_1099_batches");
    expect(stmts.length, "no statement reached form_1099_batches").toBe(1);
    expect(predicateColumns(stmts[0])).toEqual(
      expect.arrayContaining(["id", "organization_id"]),
    );
    expect(stmts[0].matchedIds, "the cross-tenant row was still read").toEqual([]);
  });

  it("still returns the caller's OWN batch", async () => {
    seed();
    const row = await getForm1099BatchStatus(ORG_A, "job-a");

    expect(row).not.toBeNull();
    expect(row!.id).toBe("job-a");
    expect(row!.organizationId).toBe(ORG_A);
    expect(row!.formCount).toBe(3);
  });
});

// ===========================================================================
// 3. mailFlusher.flushOne — send / writeback / refund on the money rail
// ===========================================================================

describe("flushOne cannot send or write back across a tenant boundary", () => {
  const seed = () => {
    harness.tables.set("organizations", [{ id: ORG_A, subscription_tier: "pro" }]);
    harness.tables.set("mail_shipments", [
      {
        id: 900,
        organization_id: ORG_A,
        status: "queued",
        piece_type: "postcard_4x6",
        speed: "standard",
        copy_snapshot: "<h1>Cash offer</h1>",
        total_cents: 500,
        debit_event_key: "mail:queue:1:900:1",
        debited_cents: 500,
        sent_at: null,
        provider: null,
      },
    ]);
    harness.tables.set("mail_shipment_pieces", [
      {
        id: 9001,
        shipment_id: 900,
        organization_id: ORG_A,
        status: "pending",
        recipient_name: "Jane Q Public",
        address_line1: "100 Ranch Rd",
        city: "Austin",
        state: "TX",
        zip: "78701",
        qr_code: null,
        provider_piece_id: null,
      },
    ]);
  };

  /**
   * The claim row is what `flushOne` is handed. Stamping org B on org A's
   * shipment id is exactly the "second caller hands a hand-built
   * FlushShipment" case the register named — the case the single claiming
   * caller used to be the only thing standing in front of.
   */
  it("a shipment row stamped with the wrong org sends nothing and writes nothing", async () => {
    seed();
    harness.setRawRows([
      {
        id: 900,
        organization_id: ORG_B,
        piece_type: "postcard_4x6",
        speed: "standard",
        copy_snapshot: "<h1>Cash offer</h1>",
        debit_event_key: "mail:queue:1:900:1",
        debited_cents: 500,
      },
    ]);

    await flushDueMailShipments(new Date(), 50);

    const pieceSelect = harness.on("mail_shipment_pieces").find((c) => c.kind === "select")!;
    expect(pieceSelect, "the pieces were never selected").toBeTruthy();
    expect(predicateColumns(pieceSelect)).toEqual(
      expect.arrayContaining(["shipment_id", "organization_id"]),
    );
    expect(
      pieceSelect.matchedIds,
      "org A's mail pieces were read (and would have been physically MAILED) " +
        "for an org-B shipment row",
    ).toEqual([]);

    expect(routeMock.fn, "a cross-tenant shipment reached the mail provider").not.toHaveBeenCalled();

    const piece = harness.rows("mail_shipment_pieces")[0];
    expect(piece.status, "org A's piece status was written by an org-B flush").toBe("pending");
    expect(piece.provider_piece_id).toBeNull();

    const shipment = harness.rows("mail_shipments")[0];
    expect(shipment.status, "org A's shipment was marked sent by an org-B flush").toBe("queued");
    expect(shipment.sent_at).toBeNull();
  });

  it("every mail_shipments write carries organization_id", async () => {
    seed();
    harness.setRawRows([
      {
        id: 900,
        organization_id: ORG_B,
        piece_type: "postcard_4x6",
        speed: "standard",
        copy_snapshot: "x",
        debit_event_key: null,
        debited_cents: null,
      },
    ]);

    await flushDueMailShipments(new Date(), 50);

    const writes = harness.on("mail_shipments").filter((c) => c.kind === "update");
    expect(writes.length, "no shipment write was issued at all").toBeGreaterThan(0);
    for (const w of writes) {
      expect(
        predicateColumns(w),
        `a mail_shipments UPDATE resolves the row by id alone: ${w.sql}`,
      ).toContain("organization_id");
    }
  });

  it("still sends and writes back for the shipment's OWN org", async () => {
    seed();
    harness.setRawRows([
      {
        id: 900,
        organization_id: ORG_A,
        piece_type: "postcard_4x6",
        speed: "standard",
        copy_snapshot: "<h1>Cash offer</h1>",
        debit_event_key: "mail:queue:1:900:1",
        debited_cents: 500,
      },
    ]);

    const summary = await flushDueMailShipments(new Date(), 50);

    expect(summary, "the org predicate broke the legitimate send").toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
    });
    expect(routeMock.fn).toHaveBeenCalledTimes(1);
    expect(refundMock.fn, "a successful send triggered a refund").not.toHaveBeenCalled();

    const piece = harness.rows("mail_shipment_pieces")[0];
    expect(piece.status).toBe("sent");
    expect(piece.provider_piece_id).toBe("lob_piece_1");

    const shipment = harness.rows("mail_shipments")[0];
    expect(shipment.status).toBe("sent");
    expect(shipment.provider).toBe("lob");
  });
});

// ===========================================================================
// 4. outcomeVerificationV12.verifyPaymentStatus — deal status by stored config
// ===========================================================================

describe("verifyPaymentStatus reads only the contract's own tenant", () => {
  const contract = (over: Record<string, any> = {}) => ({
    id: 1,
    action_id: "act-1",
    agent_codename: "atlas",
    action_type: "payment",
    action_description: "collected the payment",
    claimed_outcome: "deal closed",
    claimed_success: true,
    verification_method: "payment_status",
    verification_config: { dealId: 77, expectedStatus: "closed" },
    verify_after_minutes: 5,
    verify_stages: [{ stage: "immediate", minutes: 5 }],
    current_stage: "immediate",
    verified_outcome: null,
    verified_success: null,
    discrepancy_detected: false,
    discrepancy_details: null,
    org_id: ORG_A,
    created_at: null,
    next_verification_at: null,
    completed_at: null,
    ...over,
  });

  it("does not resolve a dealId belonging to another org", async () => {
    harness.tables.set("outcome_verification_contracts", [contract()]);
    // Deal 77 is org B's. The dealId came from `verificationConfig`, which is
    // an unvalidated request body.
    harness.tables.set("deals", [{ id: 77, organization_id: ORG_B, status: "closed" }]);

    await outcomeVerificationService.verify(1);

    const dealReads = harness.on("deals");
    expect(dealReads.length, "the deal was never queried — test is vacuous").toBe(1);
    expect(predicateColumns(dealReads[0])).toEqual(
      expect.arrayContaining(["id", "organization_id"]),
    );
    expect(dealReads[0].conds.find((c) => c.column === "organization_id")!.value).toBe(ORG_A);
    expect(
      dealReads[0].matchedIds,
      "org B's deal status was read through a stored verification config",
    ).toEqual([]);

    const row = harness.rows("outcome_verification_contracts")[0];
    expect(row.verified_success, "an unreadable cross-tenant deal was recorded as verified").toBe(
      false,
    );
    expect(String(row.verified_outcome)).toContain("unconfirmed");
  });

  it("refuses to read any deal when the contract carries no org", async () => {
    harness.tables.set("outcome_verification_contracts", [contract({ org_id: null })]);
    harness.tables.set("deals", [{ id: 77, organization_id: ORG_B, status: "closed" }]);

    await outcomeVerificationService.verify(1);

    expect(
      harness.on("deals"),
      "a contract with no tenant still issued a deals query — with no org to " +
        "pin it to, that read is always SOME tenant's deal",
    ).toEqual([]);

    const row = harness.rows("outcome_verification_contracts")[0];
    expect(row.verified_success).toBe(false);
    expect(String(row.verified_outcome)).toContain("no organization");
  });

  it("still reads a deal that belongs to the contract's own org", async () => {
    harness.tables.set("outcome_verification_contracts", [contract()]);
    harness.tables.set("deals", [{ id: 77, organization_id: ORG_A, status: "closed" }]);

    await outcomeVerificationService.verify(1);

    const dealReads = harness.on("deals");
    expect(dealReads[0].matchedIds, "the org predicate broke the legitimate read").toEqual([77]);

    const row = harness.rows("outcome_verification_contracts")[0];
    expect(row.verified_success).toBe(true);
    expect(String(row.verified_outcome)).toContain("closed");
  });
});

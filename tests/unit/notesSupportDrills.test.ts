/**
 * Notes N9 — the support drill set, deterministic legs (drills 2 and 4).
 *
 * The N9 record (docs/evidence/2026-11-23/notes-support-drills.md) drills six
 * scenarios on the support path. Drills 1 and 3 go through the LLM resolver
 * and are staging-only (the record is their battery). Drills 5 (1099-INT,
 * DEFECT-0101) and 6 (S-1 borrower erasure) are already pinned where they
 * live: `bookkeeping1099.test.ts` (the refusal middleware, incl. fail-closed)
 * and `dsarDrill.realdb.test.ts` assertion 9 (RETENTION_REQUIRED_LOAN_RECORDS
 * against a real DB). This file pins the two legs that had no drill-shaped
 * pin — the tape-import legs a support ticket actually hits:
 *
 *   Drill 2 (stuck moment — tape import blocked): a tape whose second row
 *   carries a non-calendar origination date is refused row-exactly — the
 *   rejection names the file row, the field, the column it was read from,
 *   the offending value and the fix; the good row stays valid; and
 *   `assertNoRowLost` proves every row read is accounted for. The support
 *   path can therefore name the refusing row/reason from the preview
 *   response — it never has to claim "I fixed it".
 *
 *   Drill 4 (data-wrong — tape preview mapping): with the due-day and term
 *   columns swapped in the mapping (the classic off-by-one-column error),
 *   the preview does NOT assert the wrong number as fact — it refuses the
 *   row and the refusal names the field AND the column the value was
 *   actually read from ("Term", value "120"), so the mis-map is visible in
 *   the preview itself. The suggested mapping is also pinned correct, so
 *   the swap is provably the operator's, not the suggester's.
 *
 * Fixtures are synthetic (`SYNTHETIC Borrower …`, loan numbers `N9-*`).
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertNoRowLost,
  readNoteTape,
  suggestNoteTapeMapping,
  validateNoteTape,
} from "../../server/services/notes/noteTapeImport";

// ── Drills 1 + 3 (N9-DEF-1 cure) fixtures ───────────────────────────────────
// The support resolver's notes/ladder reads run through the REAL
// executeSupportTool switch. Only the two data sources underneath it are
// mocked: `storage` (serviced book + leads) and `db` (the acquired book and
// the ladder's note-events read, both plain selects). The acquired note is
// 32 days past due — drill 1's seeded state.
const ACQUIRED_ID = "9b1c0000-0000-4000-8000-0000000000d1";
const daysAgoIso = (days: number) => {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};
const mocks = vi.hoisted(() => {
  const acquiredRow = {
    id: "9b1c0000-0000-4000-8000-0000000000d1",
    organizationId: 77,
    noteNumber: "N9-D1",
    borrowerId: 501,
    payerName: "SYNTHETIC Borrower D1",
    payerAddress: { phone: "555-0150" },
    status: "performing",
    delinquencyStatus: "delinquent",
    daysDelinquent: 32,
    originalPrincipalCents: 5000000,
    currentBalanceCents: 4000000,
    paymentAmountCents: 65000,
    interestRateBps: 950,
    nextPaymentDate: null as string | null,
    paidThroughDate: null as string | null,
    acquisitionDate: "2026-09-15",
  };
  return { acquiredRow };
});
vi.mock("../../server/db", async () => {
  const schema = await import("../../shared/schema");
  const makeChain = (): any => {
    const chain: any = {
      _table: null as unknown,
      from(t: unknown) { chain._table = t; return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      async limit() { return chain._table === schema.acquiredNotes ? [mocks.acquiredRow] : []; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        const rows = chain._table === schema.acquiredNotes ? [mocks.acquiredRow] : [];
        return Promise.resolve(rows).then(res, rej);
      },
    };
    return chain;
  };
  return { db: { select: () => makeChain() } };
});
vi.mock("../../server/storage", () => ({
  storage: {
    getNotes: async () => [{
      id: 42, propertyId: 7, borrowerId: 500,
      originalPrincipal: 60000, currentBalance: 55000, interestRate: 9,
      monthlyPayment: 700, termMonths: 120, status: "active",
      startDate: "2025-01-15", nextPaymentDate: "2026-12-01",
    }],
    getLeads: async () => [
      { id: 500, firstName: "SYNTHETIC", lastName: "Serviced Borrower", email: "serviced@example.test", phone: "555-0142" },
      { id: 501, firstName: "SYNTHETIC", lastName: "Borrower D1", email: "d1@example.test", phone: "555-0151" },
    ],
  },
}));

import { executeSupportTool, PAUSE_SAFE_SUPPORT_TOOLS, supportToolDefinitions } from "../../server/ai/supportAgent";
import { ladderStageFor } from "@shared/notes/delinquency";
import fs from "node:fs";
import path from "node:path";

// The resolver subset is not exported (an export with no production consumer
// fails the reachability ratchet); pin it from source, the
// paxPauseSupportGate.test.ts pattern for exactly this shape.
const RESOLVER_TOOL_NAMES: string[] = (() => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../server/ai/paxSupportResolver.ts"), "utf8");
  const m = /const RESOLVER_TOOL_NAMES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error("RESOLVER_TOOL_NAMES literal not found in paxSupportResolver.ts");
  return [...m[1].matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]);
})();

const SUPPORT_ORG = { id: 77, isFounder: false } as never;

const HEADER =
  "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Original Note,Mortgage/DOT,Assignments";
const GOOD =
  "N9-A,SYNTHETIC Borrower A,50000,40000,9.5,120,650.00,1,2020-01-15,2030-01-15,2026-09-15,30000,performing,yes,yes,yes";
const BAD_DATE =
  "N9-B,SYNTHETIC Borrower B,50000,40000,9.5,120,650.00,1,2020-02-30,2030-01-15,2026-09-15,30000,performing,yes,yes,yes";

describe("N9 drill 2 — tape import blocked: the refusing row and reason are named, no row lost", () => {
  const { sheet } = readNoteTape(`${HEADER}\n${GOOD}\n${BAD_DATE}\n`);
  const { mapping } = suggestNoteTapeMapping(sheet.headers);
  const out = validateNoteTape({ sheet, mapping });

  it("accounts for every row: 1 valid + 1 rejected of 2 read, assertNoRowLost holds", () => {
    expect(out.summary).toMatchObject({ totalRows: 2, validCount: 1, rejectedCount: 1 });
    expect(() => assertNoRowLost(out)).not.toThrow();
  });

  it("the good row is untouched by the bad row's refusal", () => {
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0]).toMatchObject({ fileRow: 2, noteNumber: "N9-A" });
  });

  it("the rejection names the row, field, source column, offending value and the fix", () => {
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].fileRow).toBe(3);
    expect(out.rejected[0].errors).toEqual([
      expect.objectContaining({
        field: "originationDate",
        column: "Note Date",
        value: "2020-02-30",
        fix: expect.stringMatching(/date/),
      }),
    ]);
    expect(out.rejected[0].errors[0].message).toMatch(/not a real calendar date/);
  });
});

describe("N9 drill 4 — tape preview with due-day/term columns swapped: the mis-map is named, never asserted", () => {
  const { sheet } = readNoteTape(`${HEADER}\n${GOOD}\n`);
  const suggested = suggestNoteTapeMapping(sheet.headers).mapping;

  it("the suggested mapping is correct, so a swap is the operator's error, not the suggester's", () => {
    expect(sheet.headers[suggested.termMonths as number]).toBe("Term");
    expect(sheet.headers[suggested.paymentDueDay as number]).toBe("Due Day");
  });

  it("the swapped mapping is refused at preview, naming the field and the column actually read", () => {
    const idx = (h: string) => sheet.headers.indexOf(h);
    const swapped = { ...suggested, termMonths: idx("Due Day"), paymentDueDay: idx("Term") };
    const out = validateNoteTape({ sheet, mapping: swapped });
    expect(out.summary).toMatchObject({ totalRows: 1, validCount: 0, rejectedCount: 1 });
    expect(() => assertNoRowLost(out)).not.toThrow();
    // The term value (120) read as a due day is refused AS a due day, from
    // the "Term" column — the preview never presents 120 (or the due day 1
    // read as a term) as an asserted fact about the note.
    expect(out.rejected[0].errors).toEqual([
      expect.objectContaining({
        field: "paymentDueDay",
        column: "Term",
        value: "120",
        fix: expect.stringMatching(/day of the month/),
      }),
    ]);
    expect(out.rejected[0].errors[0].message).toMatch(/outside 1–31/);
  });

  it("under the correct mapping the same row previews with provenance: each stated value names its column", () => {
    const out = validateNoteTape({ sheet, mapping: suggested });
    expect(out.valid).toHaveLength(1);
    expect(out.valid[0].termMonths).toBe(120);
    expect(out.valid[0].stated.termMonths?.source).toMatchObject({ column: "Term", raw: "120" });
    expect(out.valid[0].paymentDueDay).toBe(1);
    expect(out.valid[0].stated.paymentDueDay?.source).toMatchObject({ column: "Due Day", raw: "1" });
  });
});

describe("N9-DEF-1 cure — the support resolver's subset now carries the notes/ladder reads", () => {
  it("the resolver subset is exactly the prior read subset plus the two notes reads — no write/send power added", () => {
    expect([...RESOLVER_TOOL_NAMES].sort()).toEqual([
      "check_data_integrity", "diagnose_account", "draft_customer_response",
      "escalate_to_human", "estimate_resolution_confidence", "get_account_summary",
      "get_note_delinquency_ladder", "get_notes_book", "get_similar_resolutions",
      "get_troubleshooting_steps", "get_user_activity", "query_user_data",
      "recall_user_memory", "search_knowledge_base", "search_resolved_tickets",
    ].sort());
  });

  it("every resolver tool has a support-catalog definition, and both notes reads are pause-safe (read-only)", () => {
    for (const name of RESOLVER_TOOL_NAMES) {
      expect((supportToolDefinitions as Record<string, unknown>)[name], name).toBeTruthy();
    }
    expect(PAUSE_SAFE_SUPPORT_TOOLS.has("get_notes_book")).toBe(true);
    expect(PAUSE_SAFE_SUPPORT_TOOLS.has("get_note_delinquency_ladder")).toBe(true);
  });
});

describe("N9 drill 3 — 'Pax told me X': the support path now reads BOTH books with the coverage statement", () => {
  it("get_notes_book returns the serviced AND acquired books, labelled, with counts and lead-resolved borrower contact", async () => {
    const out = await executeSupportTool("get_notes_book", {}, SUPPORT_ORG, undefined, { userId: "user-1" });
    expect(out.success).toBe(true);
    const data = (out as { data: Record<string, any> }).data;
    expect(data.coverage).toContain("BOTH note books");
    expect(data.coverage).toContain("serviced book (notes this account originated and services: 1)");
    expect(data.coverage).toContain("acquired book (notes this account bought: 1)");
    expect(data.serviced).toHaveLength(1);
    expect(data.serviced[0]).toMatchObject({ book: "serviced", id: 42 });
    expect(data.serviced[0].borrowerContact).toMatchObject({ email: "serviced@example.test", source: "linked_lead" });
    expect(data.acquired).toHaveLength(1);
    expect(data.acquired[0]).toMatchObject({ book: "acquired", noteNumber: "N9-D1" });
    expect(data.acquired[0].borrowerContact).toMatchObject({ email: "d1@example.test", source: "linked_lead" });
  });
});

describe("N9 drill 1 — money moment: the support path reads the ladder for a note 32 days past due", () => {
  it("get_note_delinquency_ladder derives the current stage live from the next payment date", async () => {
    mocks.acquiredRow.nextPaymentDate = daysAgoIso(32);
    const out = await executeSupportTool("get_note_delinquency_ladder", { note_id: ACQUIRED_ID }, SUPPORT_ORG, undefined, { userId: "user-1" });
    expect(out.success).toBe(true);
    const data = (out as { data: Record<string, any> }).data;
    expect(data.noteId).toBe(ACQUIRED_ID);
    expect(data.onLadder).toBe(true);
    expect(data.current.daysDelinquent).toBe(32);
    expect(data.current.stage).toBe(ladderStageFor(32));
    expect(data.reason).toBeNull();
  });

  it("the same state is visible in the book read: the acquired note carries its delinquency state, labelled by book", async () => {
    const out = await executeSupportTool("get_notes_book", {}, SUPPORT_ORG, undefined, { userId: "user-1" });
    const data = (out as { data: Record<string, any> }).data;
    expect(data.acquired[0]).toMatchObject({ delinquencyStatus: "delinquent", daysDelinquent: 32 });
  });
});

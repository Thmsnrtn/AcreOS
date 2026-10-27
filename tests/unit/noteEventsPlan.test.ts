/**
 * V-Notes-1 N3 — outcome and forward-calendar hooks from an imported tape row.
 * The golden tape through the real reader and validator, then the real planner:
 *   - every row records one outcome (the performance the tape reports);
 *   - maturity is always registered; a balloon only when the tape states one;
 *   - NO next payment date is registered when the tape does not state one —
 *     never derived from the due day;
 *   - a stated next due date registers monthly through maturity, a stated rate
 *     adjustment registers, and an operator-corrected date says so;
 *   - a dated term after maturity refuses its row.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readNoteTape, suggestNoteTapeMapping, validateNoteTape } from "../../server/services/notes/noteTapeImport";
import { planNoteEvents } from "../../server/services/notes/noteEventsPlan";

const golden = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
const ctx = { fileName: "golden.csv", fileSha256: "sha", asOf: "2026-09-30", importDate: "2026-10-27" };

function validate(csv: string, overrides?: Parameters<typeof validateNoteTape>[0]["overrides"]) {
  const { sheet } = readNoteTape(csv);
  return validateNoteTape({ sheet, mapping: suggestNoteTapeMapping(sheet.headers).mapping, overrides });
}
const HEAD = "Loan #,Borrower,Orig Balance,UPB,Note Rate,Term,P&I,Due Day,Note Date,Maturity,Purchase Date,Purchase Price,Loan Status,Next Due,Next Rate Change,Original Note,Mortgage/DOT,Assignments";
const ROW = (next: string, adj: string) => `SYNTH-3001,SYNTHETIC Borrower,"10,000","9,000",9,120,126.68,5,2020-01-05,2030-01-05,2026-09-01,"6,000",Performing,${next},${adj},Yes,Yes,Yes`;

describe("note events from the golden tape", () => {
  const out = validate(golden);

  it("one outcome per row, dated by the tape's as-of, carrying status, paid-through and balance", () => {
    for (const n of out.valid) {
      const outcomes = planNoteEvents(n, ctx).filter((e) => e.category === "outcome");
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ eventType: "performance_reported", eventDate: "2026-09-30", detail: { status: n.status, paidThroughDate: n.paidThroughDate, currentBalanceCents: n.currentBalanceCents, dateBasis: "the tape's as-of date" } });
    }
    const n1001 = planNoteEvents(out.valid.find((n) => n.noteNumber === "SYNTH-1001")!, ctx)[0];
    expect(n1001.sourceRef).toMatchObject({ fileRow: 2, cells: { status: { column: "Loan Status", raw: "Performing" }, paidThroughDate: { column: "Paid Thru" } } });
  });

  it("with no as-of stated, the outcome is dated by the import and says so", () => {
    const e = planNoteEvents(out.valid[0], { ...ctx, asOf: null })[0];
    expect(e).toMatchObject({ eventDate: "2026-10-27", detail: { dateBasis: "the tape states no as-of date; dated by the import" } });
  });

  it("maturity always, a balloon only when stated, and no next payment date the tape does not state", () => {
    const types = (num: string) => planNoteEvents(out.valid.find((n) => n.noteNumber === num)!, ctx).filter((e) => e.category === "calendar").map((e) => e.eventType);
    expect(types("SYNTH-1001")).toEqual(["maturity"]);
    expect(types("SYNTH-1002")).toEqual(["maturity", "balloon"]);
    const balloon = planNoteEvents(out.valid.find((n) => n.noteNumber === "SYNTH-1002")!, ctx).find((e) => e.eventType === "balloon")!;
    expect(balloon).toMatchObject({ eventDate: "2029-03-15", detail: { balloonAmountCents: 2000000 } });
    // The golden tape has a due day on every row and no next-due column: nothing is derived from the due day.
    for (const n of out.valid) expect(planNoteEvents(n, ctx).some((e) => e.eventType === "payment_due")).toBe(false);
  });
});

describe("stated dated terms", () => {
  it("a stated next due date registers monthly through maturity; a stated rate adjustment registers", () => {
    const v = validate(`${HEAD}\n${ROW("2026-11-05", "2027-01-05")}\n`);
    expect(v.rejected).toEqual([]);
    const cal = planNoteEvents(v.valid[0], ctx).filter((e) => e.category === "calendar");
    expect(cal.find((e) => e.eventType === "payment_due")).toMatchObject({ eventDate: "2026-11-05", recurrence: "monthly", recurrenceUntil: "2030-01-05", detail: { dueDay: 5, paymentAmountCents: 12668 }, source: "note_tape" });
    expect(cal.find((e) => e.eventType === "rate_adjustment")).toMatchObject({ eventDate: "2027-01-05", sourceRef: { cells: { rateAdjustmentDate: { column: "Next Rate Change", raw: "2027-01-05" } } } });
  });

  it("an operator-corrected date carries the correction's origin", () => {
    const v = validate(`${HEAD}\n${ROW("not a date", "")}\n`, { 2: { nextPaymentDate: "2026-12-05" } });
    expect(v.rejected).toEqual([]);
    expect(planNoteEvents(v.valid[0], ctx).find((e) => e.eventType === "payment_due")).toMatchObject({ eventDate: "2026-12-05", source: "operator_correction" });
  });

  it("a next due, balloon or rate-adjustment date after maturity refuses the row, naming the cell", () => {
    const v = validate(`${HEAD}\n${ROW("2031-01-05", "2032-01-05")}\n`);
    expect(v.valid).toEqual([]);
    expect(v.rejected[0].errors.map((e) => [e.field, e.column])).toEqual([["nextPaymentDate", "Next Due"], ["rateAdjustmentDate", "Next Rate Change"]]);
    expect(v.rejected[0].errors[0].message).toMatch(/after maturity 2030-01-05/);
  });
});

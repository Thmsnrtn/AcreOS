// @vitest-environment jsdom
/**
 * V-Notes-1 N2 — the note page's record panels.
 *   1. every shown value carries a provenance chip; a value with no recorded
 *      source says "no source recorded" instead;
 *   2. matched collateral shows its value and source, and liens / tax status /
 *      hazards read "not searched" — never a clean blank;
 *   3. an incomplete document set says what is missing, by name;
 *   4. unmatched and never-searched collateral are two different empty
 *      states, each with the action attached;
 *   6. (N4) sources that disagree are shown side by side with every source,
 *      the book value marked and nothing picked; a field blank on a tape that
 *      had the column reads differently from one no import ever stated.
 *   5. (N3) registered dates show with their recurrence, an unregistered one
 *      says why, and reported performance lists every report.
 * Mounted via react-dom/client with the app's real default query function
 * and a fetch stub (repo pattern — no @testing-library).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn } from "../../client/src/lib/queryClient";
import { NoteRecordPanels } from "../../client/src/components/notes/NoteRecordPanels";

const tape = (row: number, column: string, raw: string) => ({ value: null, kind: "value", source: "note_tape", sourceRef: { fileName: "tape.csv", fileRow: row, column, raw }, asOf: "2026-09-30", confidence: "medium", basis: "stated on the seller's tape", decayClass: "months", observedAt: "2026-10-27T12:00:00.000Z" });
const rv = (field: string, label: string, value: unknown, provenance: unknown, extra: Record<string, unknown> = {}) => ({ field, label, value, provenance, observations: provenance ? [provenance] : [], absence: value === null ? { status: "never_stated" } : null, disagreement: null, ...extra });

const ev = (eventType: string, eventDate: string, extra: Record<string, unknown> = {}) => ({ eventType, eventDate, recurrence: null, recurrenceUntil: null, detail: {}, source: "note_tape", recordedAt: "2026-10-27T12:00:00.000Z", ...extra });
const CALENDAR = [
  { eventType: "payment_due", label: "Next payment due", event: ev("payment_due", "2026-11-05", { recurrence: "monthly", recurrenceUntil: "2030-01-05" }), reason: null },
  { eventType: "maturity", label: "Maturity", event: ev("maturity", "2030-01-05"), reason: null },
  { eventType: "balloon", label: "Balloon", event: null, reason: "no import stated a balloon date" },
  { eventType: "rate_adjustment", label: "Next rate adjustment", event: null, reason: "no import stated a rate adjustment date (a fixed-rate note has none)" },
];
const OUTCOMES = [
  ev("performance_reported", "2026-09-30", { detail: { status: "performing", paidThroughDate: "2026-09-05", dateBasis: "the tape's as-of date" } }),
  ev("performance_reported", "2026-10-27", { detail: { status: "late", paidThroughDate: null, dateBasis: "the tape states no as-of date; dated by the import" } }),
];

const DEFAULT_TERMS = [rv("currentBalance", "Unpaid principal balance", 8425000, tape(2, "UPB", "$84,250.00")), rv("interestRate", "Interest rate (%)", 850, null)];
const DEFAULT_YIELD = [rv("balloonAmount", "Balloon amount", null, null)];

function record(collateral: unknown, documentsComplete: boolean, outcomes: unknown[] = OUTCOMES, terms: unknown[] = DEFAULT_TERMS, yieldFields: unknown[] = DEFAULT_YIELD) {
  return {
    noteId: "n1",
    terms,
    yieldFields,
    investmentToValue: { status: "not_on_record", reason: "no collateral value is on record for this note" },
    documents: {
      entries: [{ field: "docAssignmentChain", label: "Assignment chain", critical: true, state: documentsComplete ? "present" : "exception", provenance: null }],
      exceptionNote: documentsComplete ? null : "AOM unrecorded",
      complete: documentsComplete,
      gaps: documentsComplete ? [] : ["Assignment chain: exception"],
    },
    collateral,
    outcomes,
    calendar: CALENDAR,
  };
}
const MATCHED = {
  status: "matched",
  searchedFor: { state: "NC", county: "Wake", apn: "SYNTH-1" },
  reason: "matched",
  parcel: {
    parcelKey: "pk",
    apid: null,
    apidReason: "no county FIPS reference for NC, so no APID can be resolved",
    source: { name: "SYNTHETIC county roll", retrievedAt: "2026-10-01T00:00:00.000Z" },
    value: { marketValueCents: 15000000, assessedValueCents: null },
    tax: { taxAmountCents: null, taxYear: null, delinquency: { status: "never_searched", reason: "delinquency has not been checked" } },
    seniorLiens: { status: "never_searched", reason: "no lien search has been performed" },
    hazards: { status: "never_searched", reason: "no hazard lookup has been run" },
  },
};

let body: unknown;
let root: Root;
let host: HTMLDivElement;

async function mount() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "throw" }) } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(NoteRecordPanels, { noteId: "n1" })));
  });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("note record panels", () => {
  it("each value has a provenance chip; a sourceless value says so; a never-stated yield field says no import stated it", async () => {
    body = record(MATCHED, true);
    await mount();
    const bal = host.querySelector('[data-testid="note-record-currentBalance"]')!;
    expect(bal.textContent).toMatch(/\$84,250\.00/);
    expect(bal.querySelector('[data-testid="provenance-chip"]')?.getAttribute("aria-label")).toBe("Where Unpaid principal balance came from");
    // Rendered by the canonical DataProvenanceChip, which shows a recent as-of
    // as the house date and an older one as its year — either names the tape's date.
    const chip = bal.querySelector('[data-testid="data-provenance-chip"]')!;
    expect(chip.getAttribute("aria-label")).toMatch(/^Source: Seller's note tape, as of (Sep 30, 2026|2026)$/);
    expect(bal.textContent).not.toMatch(/medium/);
    expect(host.querySelector('[data-testid="note-record-interestRate"]')!.textContent).toMatch(/no source recorded/);
    expect(host.querySelector('[data-testid="note-record-balloonAmount"]')!.textContent).toMatch(/no import has stated this/);
  });

  it("matched collateral shows value and source; liens, tax status and hazards read 'not searched'", async () => {
    body = record(MATCHED, true);
    await mount();
    const c = host.querySelector('[data-testid="note-record-collateral"]')!;
    expect(c.textContent).toMatch(/\$150,000\.00 market/);
    expect(c.textContent).toMatch(/SYNTHETIC county roll/);
    expect(c.textContent).toMatch(/no county FIPS reference/);
    expect((c.textContent!.match(/not searched/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(c.textContent).toMatch(/not a clean result/);
  });

  it("an incomplete document set names the gap and the recorded exception", async () => {
    body = record(MATCHED, false);
    await mount();
    const d = host.querySelector('[data-testid="note-record-documents"]')!;
    expect(d.textContent).toMatch(/incomplete/);
    expect(d.textContent).toMatch(/Not serviceable as-is: Assignment chain: exception/);
    expect(d.textContent).toMatch(/AOM unrecorded/);
  });

  it("unmatched and never-searched collateral are different empty states, each with its action", async () => {
    body = record({ status: "unmatched", searchedFor: { state: "NC", county: "Wake", apn: "SYNTH-5" }, reason: "no AcreOS-held public-record parcel has this county parcel id", parcel: null }, true);
    await mount();
    const u = host.querySelector('[data-testid="note-collateral-unmatched"]')!;
    expect(u.textContent).toMatch(/Searched — no matching parcel/);
    expect(u.textContent).toMatch(/APN SYNTH-5 in Wake County, NC/);
    expect(u.textContent).toMatch(/Import a corrected tape/);
    act(() => root.unmount());
    host.remove();

    body = record({ status: "not_searched", searchedFor: null, reason: "no APN", parcel: null }, true);
    await mount();
    const n = host.querySelector('[data-testid="note-collateral-not-searched"]')!;
    expect(n.textContent).toMatch(/No parcel to look up yet/);
    expect(n.textContent).toMatch(/has not searched/);
    expect(host.querySelector('[data-testid="note-collateral-unmatched"]')).toBeNull();
  });

  it("registered dates show with their recurrence; an unregistered date says why; every performance report is listed", async () => {
    body = record(MATCHED, true);
    await mount();
    expect(host.querySelector('[data-testid="note-calendar-payment_due"]')!.textContent).toMatch(/2026-11-05 · then monthly through 2030-01-05/);
    expect(host.querySelector('[data-testid="note-calendar-maturity"]')!.textContent).toMatch(/2030-01-05/);
    expect(host.querySelector('[data-testid="note-calendar-balloon"]')!.textContent).toMatch(/no import stated a balloon date/);
    const o = host.querySelector('[data-testid="note-outcomes"]')!;
    expect(o.querySelectorAll("li")).toHaveLength(2);
    expect(o.textContent).toMatch(/2026-09-30: performing, paid through 2026-09-05/);
    expect(o.textContent).toMatch(/2026-10-27: late, paid-through date not stated.*dated by the import/);
    expect(host.querySelector('[data-testid="note-record-events"]')!.textContent).toMatch(/nothing is scheduled or sent/);
    act(() => root.unmount());
    host.remove();

    body = record(MATCHED, true, []);
    await mount();
    expect(host.querySelector('[data-testid="note-outcomes-none"]')!.textContent).toMatch(/No import has reported/);
  });

  it("disagreeing sources are shown side by side with every source and the book value marked; nothing is picked", async () => {
    const first = tape(2, "UPB", "$84,250.00");
    const later = { ...tape(7, "Current UPB", "$83,900.00"), sourceRef: { fileName: "tape-oct.csv", fileRow: 7, column: "Current UPB", raw: "$83,900.00" } };
    const bal = rv("currentBalance", "Unpaid principal balance", 8425000, first, { observations: [first, later], disagreement: { values: [{ value: 8425000, observations: [first] }, { value: 8390000, observations: [later] }], bookValueIs: 0 } });
    body = record(MATCHED, true, OUTCOMES, [bal]);
    await mount();
    const panel = host.querySelector('[data-testid="note-record-disagreements"]')!;
    expect(panel.textContent).toMatch(/Sources disagree on 1 term/);
    expect(panel.textContent).toMatch(/has not picked one/);
    const rows = panel.querySelectorAll('[data-testid="note-disagreement-currentBalance"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/\$84,250\.00/);
    expect(rows[0].textContent).toMatch(/on the book/);
    expect(rows[1].textContent).toMatch(/\$83,900\.00/);
    expect(rows[1].textContent).not.toMatch(/on the book/);
    expect(rows[1].querySelector('[data-testid="provenance-chip"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="note-record-currentBalance"] [data-testid="note-record-disagrees"]')).not.toBeNull();
    act(() => root.unmount());
    host.remove();

    body = record(MATCHED, true);
    await mount();
    expect(host.querySelector('[data-testid="note-record-disagreements"]')).toBeNull();
  });

  it("blank on a tape that had the column reads differently from never stated", async () => {
    const blank = rv("balloonAmount", "Balloon amount", null, null, { absence: { status: "blank_on_source", column: "Balloon", fileName: "tape.csv" } });
    const never = rv("balloonDate", "Balloon date", null, null);
    body = record(MATCHED, true, OUTCOMES, DEFAULT_TERMS, [blank, never]);
    await mount();
    expect(host.querySelector('[data-testid="note-record-balloonAmount"]')!.textContent).toMatch(/blank on the tape \(column “Balloon”\) — asked, nothing stated/);
    expect(host.querySelector('[data-testid="note-record-balloonDate"]')!.textContent).toMatch(/no import has stated this/);
  });
});

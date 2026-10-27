// @vitest-environment jsdom
/**
 * V-Notes-1 N2 — the note page's record panels.
 *   1. every shown value carries a provenance chip; a value with no recorded
 *      source says "no source recorded" instead;
 *   2. matched collateral shows its value and source, and liens / tax status /
 *      hazards read "not searched" — never a clean blank;
 *   3. an incomplete document set says what is missing, by name;
 *   4. unmatched and never-searched collateral are two different empty
 *      states, each with the action attached.
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
const rv = (field: string, label: string, value: unknown, provenance: unknown) => ({ field, label, value, provenance, observations: provenance ? [provenance] : [] });

function record(collateral: unknown, documentsComplete: boolean) {
  return {
    noteId: "n1",
    terms: [rv("currentBalance", "Unpaid principal balance", 8425000, tape(2, "UPB", "$84,250.00")), rv("interestRate", "Interest rate (%)", 850, null)],
    yieldFields: [rv("balloonAmount", "Balloon amount", null, null)],
    investmentToValue: { status: "not_on_record", reason: "no collateral value is on record for this note" },
    documents: {
      entries: [{ field: "docAssignmentChain", label: "Assignment chain", critical: true, state: documentsComplete ? "present" : "exception", provenance: null }],
      exceptionNote: documentsComplete ? null : "AOM unrecorded",
      complete: documentsComplete,
      gaps: documentsComplete ? [] : ["Assignment chain: exception"],
    },
    collateral,
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
  it("each value has a provenance chip; a sourceless value says so; a blank yield field reads 'not on the tape'", async () => {
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
    expect(host.querySelector('[data-testid="note-record-balloonAmount"]')!.textContent).toMatch(/not on the tape/);
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
});

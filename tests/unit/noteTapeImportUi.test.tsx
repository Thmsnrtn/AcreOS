// @vitest-environment jsdom
/**
 * V-Notes-1 N1 — the note-tape import UI.
 *
 * apiRequest is answered by the REAL validator (the same functions the route
 * calls), so the component is driven by realistic previews:
 *   1. rejected rows show the field, the cell, the problem and the fix, and
 *      Import is disabled while any row is unresolved;
 *   2. excluding the rejected rows enables Import, and the commit carries
 *      exactly those exclusions;
 *   3. a single cell of a single row is corrected in place (an override) and
 *      the row turns valid without touching the others;
 *   4. a tape with required columns unmapped is refused with the fields
 *      named, and no preview of rows is shown.
 * Mounted via react-dom/client (repo pattern — no @testing-library).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

const calls: Array<{ url: string; body: any }> = [];

vi.mock("@/lib/queryClient", async () => {
  const { readNoteTape, suggestNoteTapeMapping, validateNoteTape } = await import("../../server/services/notes/noteTapeImport");
  return {
    apiRequest: async (_method: string, url: string, body: any) => {
      calls.push({ url, body });
      if (url.endsWith("/preview")) {
        const { sheet, sha256 } = readNoteTape(body.csv);
        const suggestion = suggestNoteTapeMapping(sheet.headers);
        const mapping = body.mapping ?? suggestion.mapping;
        const overrides: Record<number, any> = {};
        for (const [k, v] of Object.entries(body.overrides ?? {})) overrides[Number(k)] = v;
        const validation = validateNoteTape({ sheet, mapping, overrides });
        return new Response(JSON.stringify({ headers: sheet.headers, fileSha256: sha256, mapping, mappingWasSuggested: !body.mapping, unmatchedHeaders: suggestion.unmatchedHeaders, validation }));
      }
      return new Response(JSON.stringify({ status: "committed", importId: "i", created: 3, appendedToExisting: 0, excludedRows: body.excludeRows, notes: [] }));
    },
  };
});

import { NoteTapeImport } from "../../client/src/components/notes/NoteTapeImport";

const golden = readFileSync(path.join(__dirname, "../../shared/notes/golden/note-tape-golden.csv"), "utf8");
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  calls.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(React.createElement(NoteTapeImport)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function chooseFile(text: string) {
  const input = host.querySelector<HTMLInputElement>('[data-testid="note-tape-file"]')!;
  const file = new File([text], "tape.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}

const commitButton = () => host.querySelector<HTMLButtonElement>('[data-testid="note-tape-commit"]')!;

describe("note-tape import UI", () => {
  it("lists each rejected row with field, cell, problem and fix — and keeps Import disabled", async () => {
    await chooseFile(golden);
    const rejected = host.querySelector('[data-testid="note-tape-rejected"]')!;
    expect(rejected.textContent).toMatch(/Row 4/);
    expect(rejected.textContent).toMatch(/Interest rate \(%\) is blank/);
    expect(rejected.textContent).toMatch(/Fix: an annual percentage/);
    expect(rejected.textContent).toMatch(/Row 5/);
    expect(rejected.textContent).toMatch(/cell “2020-02-30”/);
    expect(commitButton().disabled).toBe(true);
    expect(host.textContent).toMatch(/nothing is imported partially/);
  });

  it("leaving the rejected rows out enables Import, and the commit carries exactly those rows", async () => {
    await chooseFile(golden);
    const boxes = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(boxes.length).toBe(2);
    for (const b of Array.from(boxes)) await act(async () => { b.click(); });
    expect(commitButton().disabled).toBe(false);
    await act(async () => { commitButton().click(); });
    await flush();
    const commit = calls.find((c) => c.url.endsWith("/commit"))!;
    expect(commit.body.excludeRows.sort()).toEqual([4, 5]);
    expect(host.querySelector('[data-testid="note-tape-committed"]')).not.toBeNull();
  });

  it("corrects one cell of one row in place; that row turns valid and the others are untouched", async () => {
    await chooseFile(golden);
    const fix = host.querySelector<HTMLInputElement>('input[id="fix-4:interestRate"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(fix, "7.75"); fix.dispatchEvent(new Event("input", { bubbles: true })); });
    const apply = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Apply to row 4")!;
    await act(async () => { apply.click(); });
    await flush();
    const lastPreview = calls.filter((c) => c.url.endsWith("/preview")).at(-1)!;
    expect(lastPreview.body.overrides).toEqual({ 4: { interestRate: "7.75" } });
    const rejected = host.querySelector('[data-testid="note-tape-rejected"]')!;
    expect(rejected.textContent).not.toMatch(/Row 4/);
    expect(rejected.textContent).toMatch(/Row 5/);
  });

  it("a tape missing required columns is refused with the fields named, and no rows are previewed", async () => {
    await chooseFile("Loan #,Borrower,UPB\nX-1,SYNTHETIC,100\n");
    const alert = host.querySelector('[data-testid="note-tape-unmapped"]')!;
    expect(alert.textContent).toMatch(/Map every required column/);
    expect(alert.textContent).toMatch(/Interest rate \(%\)/);
    expect(alert.textContent).toMatch(/Assignment chain/);
    expect(host.querySelector('[data-testid="note-tape-commit"]')).toBeNull();
  });
});

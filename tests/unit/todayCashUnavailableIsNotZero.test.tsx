// @vitest-environment jsdom
/**
 * A book that could not be read is not an empty book.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * GET /api/today splits the customer's real deals/notes from the onboarding
 * sample parcels before it sums anything. When the sample-parcel read fails,
 * the server can no longer tell the two apart, so it sends `null` for every
 * figure it would have computed from that split — cashOnHand, openDealsValue,
 * openDealsCount, pendingPayments30, lateCount — plus `unavailableReason`
 * (tests/unit/todaySampleReadFailureIsUnavailable.test.ts pins the server
 * half).
 *
 * The client then coerced every one of them with `?? 0`, so an unreadable book
 * rendered as "0 active" on the Cash strip and, on the persona lede, as "$0 due
 * across your book this month" / "Every note current" / "No deals in flight
 * yet" — a confident claim about a book nobody read. That is fabrication by
 * default value (CLAUDE.md: refuse-not-fabricate).
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *  1. CashStrip with null figures renders an explicit unavailable state and a
 *     reason line — never "0 active", never "$0".
 *  2. CashStrip with REAL zeros still renders the zero rendering it always
 *     did (a real zero is a real zero) and no unavailable state.
 *  3. Every persona lede that reads a figure claims nothing about it when the
 *     figure is null. Which ledes read figures is DERIVED (render with zeros
 *     vs. render with non-zeros and compare), not named, so a lede that starts
 *     reading a figure joins the population on its own. The persona list is a
 *     `Record<Persona, …>`, so a tenth persona fails the type-check here until
 *     it is added.
 *  4. today.tsx passes the nulls through: no `?? 0` / `|| 0` on any of the
 *     five fields in comment-stripped source (defence in depth beside 1-3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import type { Persona } from "../../shared/models/auth";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href ?? "#"}>{children}</a>
  ),
  useLocation: () => ["/today", () => {}],
}));

import { CashStrip } from "../../client/src/components/today/CashStrip";
import { getTodayLayout, type TodayLedeData } from "../../client/src/components/today/TodayLayout";

let queryClient: QueryClient;
let mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  // CashStrip reads its sparkline histories off the cached /api/today
  // payload. Seed it so no fetch is attempted.
  queryClient.setQueryData(["/api/today"], {
    cash: { cashHistory: [], openDealsValueHistory: [], pendingPayments30History: [], lateCountHistory: [] },
  });
});

afterEach(() => {
  act(() => mounted.forEach((m) => m.root.unmount()));
  mounted.forEach((m) => m.container.remove());
  mounted = [];
  queryClient.clear();
});

async function render(node: React.ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
  return container;
}

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
// Leaf-ish text runs: each <p>'s own text, so adjacent tiles do not run
// together ("…—0 activePending…") and defeat a word boundary.
const paragraphs = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>("p")).map(text);

// ── 1 + 2: CashStrip ─────────────────────────────────────────────────────────

describe("CashStrip — an unread figure is unavailable, never zero", () => {
  it("all-null figures render the unavailable state and the reason, no '0 active' / '$0'", async () => {
    const c = await render(
      <CashStrip
        isLoading={false}
        cashOnHand={null}
        openDealsValue={null}
        openDealsCount={null}
        pendingPayments30={null}
        lateCount={null}
        unavailableReason="sample_parcels_unreadable"
      />,
    );
    const t = text(c);
    expect(t).not.toContain("0 active");
    expect(t).not.toContain("$0");
    expect(t).not.toContain("0 late");
    expect(t).not.toMatch(/null|undefined|NaN/);

    // Every null figure is marked unavailable, each with an accessible name.
    const marks = Array.from(c.querySelectorAll<HTMLElement>('[data-cash-figure-state="unavailable"]'));
    const figures = marks.map((m) => m.getAttribute("data-cash-figure")).sort();
    expect(figures).toEqual(["cashOnHand", "openDealsCount", "openDealsValue", "pendingPayments30"]);
    for (const m of marks) {
      expect(text(m), `${m.getAttribute("data-cash-figure")} carries an accessible 'unavailable'`).toMatch(
        /unavailable/i,
      );
    }

    // One reason line, in words — not the raw machine code.
    const reason = c.querySelector<HTMLElement>('[data-testid="cash-strip-unavailable"]');
    expect(reason).not.toBeNull();
    expect(reason!.getAttribute("role")).toBe("status");
    expect(text(reason!)).toMatch(/sample/i);
    expect(text(reason!)).not.toContain("sample_parcels_unreadable");
  });

  it("null figures with no reason still say they are unavailable (generic copy)", async () => {
    const c = await render(
      <CashStrip
        isLoading={false}
        cashOnHand={null}
        openDealsValue={null}
        openDealsCount={null}
        pendingPayments30={null}
        lateCount={null}
        unavailableReason={null}
      />,
    );
    expect(text(c)).not.toContain("0 active");
    const reason = c.querySelector<HTMLElement>('[data-testid="cash-strip-unavailable"]');
    expect(reason).not.toBeNull();
    expect(text(reason!)).toMatch(/couldn.t be read/i);
  });

  it("real zeros render the zero rendering, with no unavailable state", async () => {
    const c = await render(
      <CashStrip
        isLoading={false}
        cashOnHand={0}
        openDealsValue={0}
        openDealsCount={0}
        pendingPayments30={0}
        lateCount={0}
        unavailableReason={null}
      />,
    );
    const t = text(c);
    expect(paragraphs(c)).toContain("0 active");
    expect(t).not.toMatch(/unavailable/i);
    expect(c.querySelector('[data-cash-figure-state="unavailable"]')).toBeNull();
    expect(c.querySelector('[data-testid="cash-strip-unavailable"]')).toBeNull();
  });

  it("real non-zero figures render exactly as before", async () => {
    const c = await render(
      <CashStrip
        isLoading={false}
        cashOnHand={4200}
        openDealsValue={125000}
        openDealsCount={3}
        pendingPayments30={900}
        lateCount={2}
        unavailableReason={null}
      />,
    );
    const t = text(c);
    expect(t).toContain("$4,200");
    expect(t).toContain("$125.0K");
    expect(paragraphs(c)).toContain("3 active");
    expect(t).toContain("$900");
    expect(t).toContain("2 late");
    expect(t).not.toMatch(/unavailable/i);
  });
});

// ── 3: persona ledes ─────────────────────────────────────────────────────────

// Record<Persona, …> — adding a persona without adding it here fails tsc.
const PERSONA_SET: Record<Persona, true> = {
  land_investor: true,
  note_investor: true,
  note_originator: true,
  note_servicer: true,
  tax_delinquent: true,
  wholesaler: true,
  subdivider: true,
  fix_flipper: true,
  landlord: true,
};
const PERSONAS = Object.keys(PERSONA_SET) as Persona[];

const ZEROS: TodayLedeData = {
  pendingPayments30: 0,
  lateCount: 0,
  openDealsCount: 0,
  openDealsValue: 0,
  unavailableReason: null,
};
const SOME: TodayLedeData = {
  pendingPayments30: 1234,
  lateCount: 2,
  openDealsCount: 3,
  openDealsValue: 56789,
  unavailableReason: null,
};
const NULLS: TodayLedeData = {
  pendingPayments30: null,
  lateCount: null,
  openDealsCount: null,
  openDealsValue: null,
  unavailableReason: "sample_parcels_unreadable",
};

// Words an empty-book lede uses to describe a book it read. None of them is
// true of a book it could not read.
const EMPTY_BOOK_CLAIMS = /\b(no|nothing|none|quiet|clear|current|every|yet)\b/i;

async function renderLede(persona: Persona, data: TodayLedeData): Promise<string> {
  const { Lede } = getTodayLayout(persona);
  if (!Lede) throw new Error(`${persona} has no lede`);
  return text(await render(<Lede data={data} />));
}

describe("persona ledes — a null figure is never described", () => {
  it("every persona resolves to a lede (population floor)", () => {
    expect(PERSONAS.length).toBe(9);
    for (const p of PERSONAS) expect(getTodayLayout(p).Lede, p).not.toBeNull();
  });

  it("each lede that reads a figure claims nothing about it when it is null", async () => {
    let figureReaders = 0;
    for (const p of PERSONAS) {
      const zero = await renderLede(p, ZEROS);
      const some = await renderLede(p, SOME);
      const nul = await renderLede(p, NULLS);
      if (zero === some) {
        // Reads no figure (the redemption-clock lede): null must change nothing.
        expect(nul, `${p} reads no figure, so null must render identically`).toBe(zero);
        continue;
      }
      figureReaders++;
      expect(nul, `${p}: no digit may describe an unread book`).not.toMatch(/\d/);
      expect(nul, `${p}: no dollar figure`).not.toContain("$");
      expect(nul, `${p}: no empty-book claim`).not.toMatch(EMPTY_BOOK_CLAIMS);
      expect(nul, `${p}: says the figures are unavailable`).toMatch(/unavailable/i);
      expect(nul, `${p}: no raw reason code`).not.toContain("sample_parcels_unreadable");
      // And it must not render the zero copy under another name.
      expect(nul, `${p}: null must not render as the zero lede`).not.toBe(zero);
    }
    // Vacuity: eight of the nine ledes read figures today.
    expect(figureReaders).toBe(8);
  });

  it("a real zero still renders the honest empty copy (unchanged)", async () => {
    expect(await renderLede("land_investor", ZEROS)).toContain("No deals in flight yet");
    expect(await renderLede("note_investor", ZEROS)).toContain("$0 due across your book this month");
    expect(await renderLede("note_investor", ZEROS)).toContain("Every note current");
    expect(await renderLede("note_servicer", ZEROS)).toContain("Servicing queue is clear");
    expect(await renderLede("note_originator", ZEROS)).toContain("No deals queued to originate");
    expect(await renderLede("wholesaler", ZEROS)).toContain("No contracts to assign yet");
  });

  it("a known count with an unknown value keeps the count and drops only the value clause", async () => {
    const t = await renderLede("land_investor", { ...SOME, openDealsValue: null });
    expect(t).toContain("3 deals in flight");
    expect(t).not.toContain("on the table");
    expect(t).not.toContain("$");
  });
});

// ── 4: today.tsx passes nulls through ────────────────────────────────────────

describe("today.tsx — the five cash figures are passed through, not defaulted to 0", () => {
  const FIELDS = ["cashOnHand", "openDealsValue", "openDealsCount", "pendingPayments30", "lateCount"] as const;
  const src = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/today.tsx"), "utf8"),
  );

  it.each(FIELDS)("%s is never coerced to 0", (field) => {
    // Vacuity: the field is still read off the payload at all.
    const reads = src.match(new RegExp(`\\bcash\\??\\.${field}\\b`, "g")) ?? [];
    expect(reads.length, `${field} must still be read from cash`).toBeGreaterThan(0);
    expect(src).not.toMatch(new RegExp(`\\b${field}\\s*(\\?\\?|\\|\\|)\\s*0\\b`));
    // And the payload type admits null for it.
    expect(src).toMatch(new RegExp(`\\b${field}\\s*:\\s*number\\s*\\|\\s*null\\b`));
  });

  it("unavailableReason reaches the cash strip", () => {
    expect(src).toMatch(/unavailableReason=\{\s*cash\?\.unavailableReason/);
  });
});

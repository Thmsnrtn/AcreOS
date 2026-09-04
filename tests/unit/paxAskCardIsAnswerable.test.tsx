// @vitest-environment jsdom
/**
 * The approval card must be readable, reachable and announced.
 *
 * Four confirmed findings, one surface. They share a cause: every one of them
 * is the card doing its job for the eye and not for the rest of the ways a
 * person uses software.
 *
 *   1. THE DECISION WAS THE LAST THING YOU COULD REACH. The frozen-text
 *      blockquote capped its height only in `compact` mode, and DecisionQueue
 *      mounts this card WITHOUT compact — so on Today a 400-word draft rendered
 *      at full length and pushed Approve / Reject / Edit below several screens
 *      of its own quoted text.
 *   2. APPROVING ANNOUNCED NOTHING. The status flips "Waiting for your tap" ->
 *      "Working…" -> "Approved and sent" and the whole button row unmounts.
 *      There was no live region anywhere on the card, so a screen-reader user
 *      was told none of it.
 *   3. AND IT DESTROYED FOCUS. The Approve button was the focused element when
 *      it unmounted, so focus fell to <body> and the user lost their place in
 *      the queue — right after the most consequential action in the product.
 *   4. THE DIFF SPOKE DATABASE. `key.replace(/_/g, " ")` unpacks snake_case and
 *      leaves camelCase untouched, so `sellerFinancingApr` was shown verbatim,
 *      and any non-primitive fell through to `JSON.stringify`. This is the one
 *      branch the customer must read most carefully — they are authorising a
 *      change to their own data.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaxAskCard, { fieldLabel, readableValue } from "../../client/src/components/pax/PaxAskCard";
import type { PaxAskItem } from "../../client/src/hooks/usePaxNeedsYou";

const LONG = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");

const baseAsk = {
  id: "ask-1",
  verb: "Send the follow-up",
  group: "sends",
  to: "buyer@example.com",
  text: LONG,
  status: "pending",
  expired: false,
} as unknown as PaxAskItem;

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ask: PaxAskItem, props: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(PaxAskCard, {
          ask,
          onApprove: () => undefined,
          onReject: () => undefined,
          onRevise: async () => ({ ok: true }) as const,
          ...props,
        } as never),
      ),
    );
  });
  const el = container.querySelector<HTMLElement>("[data-testid^='pax-ask-card-']");
  if (!el) throw new Error("card did not render");
  return el;
}

describe("the quoted text cannot push the decision off screen", () => {
  it("caps its height in the NON-compact mode DecisionQueue actually uses", () => {
    const card = render(baseAsk);
    const quote = card.querySelector<HTMLElement>("[data-testid^='pax-ask-text-']");
    expect(quote, "the frozen text did not render").not.toBeNull();
    const cls = quote!.className;
    expect(
      /\bmax-h-\d+\b/.test(cls),
      "the non-compact card renders its quoted text unbounded. DecisionQueue " +
        "mounts this card without `compact`, so a long draft pushes Approve " +
        "below several screens of its own text.",
    ).toBe(true);
    expect(cls, "a height cap with no scroll just clips the text").toContain("overflow-y-auto");
  });

  it("still caps in compact mode, and more tightly", () => {
    const compact = render(baseAsk, { compact: true });
    const quote = compact.querySelector<HTMLElement>("[data-testid^='pax-ask-text-']")!;
    expect(quote.className).toMatch(/\bmax-h-40\b/);
  });

  it("the buttons render after the text, so the cap is what keeps them reachable", () => {
    // If the row ever moved above the quote this test's premise changes; a
    // reader should find that out here rather than assume.
    const card = render(baseAsk);
    const quote = card.querySelector("[data-testid^='pax-ask-text-']")!;
    const approve = card.querySelector("[data-testid^='pax-ask-approve-']")!;
    expect(approve, "no Approve button on a pending ask").not.toBeNull();
    expect(quote.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the outcome is announced", () => {
  it("the status line is a polite, atomic live region", () => {
    const card = render(baseAsk);
    const status = card.querySelector<HTMLElement>("[data-testid^='pax-ask-status-']");
    expect(status, "the status line is gone").not.toBeNull();
    expect(
      status!.getAttribute("aria-live"),
      "approving the most consequential action in the product announces nothing",
    ).toBe("polite");
    expect(
      status!.getAttribute("aria-atomic"),
      "without atomic the reader hears only the changed words, not the sentence",
    ).toBe("true");
  });

  it("the card is programmatically focusable, so focus has somewhere to go", () => {
    // The Approve button unmounts on a decision. Without this the browser
    // drops focus to <body> and the user loses their place in the queue.
    const card = render(baseAsk);
    expect(card.getAttribute("tabindex")).toBe("-1");
    expect(card.getAttribute("role")).toBe("group");
    expect(card.getAttribute("aria-label"), "focus would land somewhere unnamed").toBeTruthy();
  });
});

describe("the record diff speaks the customer's language", () => {
  it("unpacks camelCase, not only snake_case", () => {
    expect(fieldLabel("sellerFinancingApr")).toBe("Seller financing APR");
    expect(fieldLabel("seller_financing_apr")).toBe("Seller financing APR");
    expect(fieldLabel("propertyId")).toBe("Property ID");
    expect(fieldLabel("ltvRatio")).toBe("LTV ratio");
  });

  it("keeps initialisms upper-case rather than title-casing them into words", () => {
    // "Apr" reads as the month. This is the difference between a label and a
    // label that is wrong.
    expect(fieldLabel("apr")).toBe("APR");
    expect(fieldLabel("noi")).toBe("NOI");
    expect(fieldLabel("hoaDues")).toBe("HOA dues");
  });

  it("never renders raw JSON to the customer", () => {
    for (const value of [
      { a: 1, b: 2, c: 3, d: 4 },
      [{ x: 1 }, { y: 2 }],
      { nested: { deep: true } },
    ]) {
      const out = readableValue(value);
      expect(out, `raw JSON reached the card: ${out}`).not.toMatch(/[{}[\]"]/);
    }
  });

  it("renders absent values as an em dash, not \"null\" or \"\"", () => {
    for (const empty of [null, undefined, "", [], {}]) {
      expect(readableValue(empty)).toBe("—");
    }
  });

  it("renders the ordinary cases the way a person would write them", () => {
    expect(readableValue(true)).toBe("Yes");
    expect(readableValue(false)).toBe("No");
    expect(readableValue(42)).toBe("42");
    expect(readableValue(["a", "b"])).toBe("a, b");
    expect(readableValue({ city: "Austin", state: "TX" })).toBe("City: Austin, State: TX");
    expect(readableValue({ a: 1, b: 2, c: 3, d: 4 })).toBe("4 fields");
  });

  it("the card actually uses them (adoption, not just availability)", () => {
    // A helper with authoritative semantics and no call site is not canonical.
    const ask = {
      ...baseAsk,
      text: undefined,
      change: { before: { sellerFinancingApr: 7.5 }, after: { sellerFinancingApr: 6.25 } },
    } as unknown as PaxAskItem;
    const card = render(ask);
    const dl = card.querySelector("[data-testid^='pax-ask-change-']");
    expect(dl, "the change diff did not render").not.toBeNull();
    expect(dl!.textContent).toContain("Seller financing APR");
    expect(dl!.textContent).not.toContain("sellerFinancingApr");
  });
});

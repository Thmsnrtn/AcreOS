// @vitest-environment jsdom
/**
 * On the approval surface, "this needs you" and "this broke" may not look the
 * same.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * PaxAskCard's container className was a three-arm ternary: executed → pos,
 * {rejected|expired|revised} → muted, else → `border-acr-warn/40
 * bg-acr-warn-soft/40`. "Else" was pending, deciding AND failed. The status
 * icon was the same AlertCircle in the same amber for all three.
 *
 * So an ask Pax tried to execute and could not complete was pixel-identical to
 * one nobody had tapped yet — same border, same fill, same icon, same icon
 * colour — separated only by a 12px status string. Those are the two states on
 * this surface that must never be confused.
 *
 * It also spent the warn semantic at rest: a queue of six untouched asks was a
 * solid wall of amber, leaving nothing louder available for the state that
 * actually warrants alarm.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The assertions are DERIVED — they compare the rendered classes of the states
 * against each other rather than naming the palette. A restyle is free; a
 * restyle that collapses two states back into one identical rendering is not.
 * That matters because the original defect was not a wrong colour, it was two
 * states sharing one.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PaxAskCard, { type PaxAskCardStatus } from "../../client/src/components/pax/PaxAskCard";
import type { PaxAskItem } from "../../client/src/hooks/usePaxNeedsYou";

const ask = {
  id: "ask-1",
  verb: "Send the follow-up",
  group: "sends",
  to: "buyer@example.com",
  text: "Following up on the offer.",
  status: "pending",
  expired: false,
} as unknown as PaxAskItem;

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // The card reads the Pax pause state through a query hook; without a client
  // it throws before rendering anything, and every assertion below would fail
  // for a reason that has nothing to do with what they measure.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/**
 * Drive the card into one status through its REAL state machine.
 *
 * There is no `status` prop — the component derives it from `ask` plus the
 * outcome of the handler the host returns. Forcing it any other way would test
 * a code path the product does not have; this way the test also proves the
 * transitions still land where the component says they do.
 */
async function renderAs(status: PaxAskCardStatus): Promise<HTMLElement> {
  // `deciding` is the in-flight window, so its handler never settles.
  const pending = new Promise<never>(() => {});
  const approve =
    status === "executed"
      ? async () => ({ ok: true }) as const
      : status === "failed"
        ? async () => ({ ok: false, note: "Rail refused the send." }) as const
        : status === "deciding"
          ? () => pending
          : async () => undefined;
  const reject = status === "rejected" ? async () => ({ ok: true }) as const : async () => undefined;

  // Fresh root per render. The card holds its decision in local state, so
  // re-rendering the same tree leaves the PREVIOUS status in place and a test
  // silently measures whatever the last one left behind. The data-status
  // assertion at the end is what caught that; this is the fix.
  await act(async () => {
    root.unmount();
  });
  container.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(PaxAskCard, {
        ask: status === "expired" ? ({ ...ask, expired: true } as PaxAskItem) : ask,
        onApprove: approve,
        onReject: reject,
          onRevise: async () => ({ ok: true }) as const,
        } as never),
      ),
    );
  });

  if (status !== "pending" && status !== "expired") {
    const testid = status === "rejected" ? "pax-ask-reject" : "pax-ask-approve";
    const button = container.querySelector<HTMLButtonElement>(`[data-testid^='${testid}']`);
    if (!button) throw new Error(`no ${testid} button to drive "${status}"`);
    await act(async () => {
      button.click();
    });
  }

  const el = container.querySelector<HTMLElement>("[data-testid^='pax-ask-card-']");
  if (!el) throw new Error(`card did not render for status "${status}"`);
  if (el.getAttribute("data-status") !== status) {
    throw new Error(
      `wanted "${status}" but the card is "${el.getAttribute("data-status")}" — the ` +
        "state machine moved, so this test is measuring the wrong thing",
    );
  }
  return el;
}

/** The card's own classes, order-independent. */
const classesOf = (el: HTMLElement) => new Set(el.className.split(/\s+/).filter(Boolean));

/** The status icon's classes — the second half of "looks the same". */
function iconClassesOf(el: HTMLElement): Set<string> {
  const svg = el.querySelector("svg");
  if (!svg) throw new Error("no status icon rendered");
  return new Set(String(svg.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
}

describe("the card renders at all (vacuity guard)", () => {
  it("mounts and exposes its status", async () => {
    // Without this, every "these differ" assertion below could pass over two
    // empty sets.
    const el = await renderAs("pending");
    expect(el.getAttribute("data-status")).toBe("pending");
    expect(classesOf(el).size).toBeGreaterThan(3);
    expect(iconClassesOf(el).size).toBeGreaterThan(1);
  });
});

describe("no two consequential states render identically", () => {
  // Every pair that a person has to tell apart at a glance in a queue.
  const PAIRS: Array<[PaxAskCardStatus, PaxAskCardStatus]> = [
    ["pending", "failed"],
    ["pending", "deciding"],
    ["pending", "executed"],
    ["failed", "executed"],
    ["failed", "deciding"],
    ["failed", "rejected"],
  ];

  for (const [a, b] of PAIRS) {
    it(`"${a}" and "${b}" do not look the same`, async () => {
      const ea = await renderAs(a);
      const ca = classesOf(ea);
      const ia = iconClassesOf(ea);
      const eb = await renderAs(b);
      const cb = classesOf(eb);
      const ib = iconClassesOf(eb);
      const sameContainer = ca.size === cb.size && [...ca].every((c) => cb.has(c));
      const sameIcon = ia.size === ib.size && [...ia].every((c) => ib.has(c));
      expect(
        sameContainer && sameIcon,
        `"${a}" and "${b}" render with identical container AND icon classes. On the ` +
          "approval surface these are states a person has to tell apart at a glance; " +
          "a 12px status string is not a difference. Give the state its own arm.",
      ).toBe(false);
    });
  }

  it("failed and pending differ in the CONTAINER, not only the icon", async () => {
    // A distinct icon alone is too quiet for "this broke" in a scrolled queue.
    const ca = classesOf(await renderAs("pending"));
    const cb = classesOf(await renderAs("failed"));
    const same = ca.size === cb.size && [...ca].every((c) => cb.has(c));
    expect(same, "failed borrows pending's card treatment").toBe(false);
  });

  it("failed and pending use different status icons", async () => {
    const iconName = async (s: PaxAskCardStatus) => {
      const svg = (await renderAs(s)).querySelector("svg");
      return String(svg?.getAttribute("class") ?? "");
    };
    expect(await iconName("failed")).not.toBe(await iconName("pending"));
  });
});

describe("pending does not spend the alarm colour at rest", () => {
  it("an untapped ask is a neutral card, not a filled warning", async () => {
    // Six pending asks used to be a solid wall of amber, which leaves nothing
    // louder for the state that actually warrants it. The amber survives as an
    // edge accent; the fill does not.
    const c = classesOf(await renderAs("pending"));
    expect(
      [...c].some((x) => x.startsWith("bg-acr-warn")),
      "pending is filled with the warn tint again",
    ).toBe(false);
    expect(
      [...c].some((x) => x.includes("acr-warn")),
      "pending lost its amber accent entirely — it should still read as needing a tap",
    ).toBe(true);
  });

  it("failed is allowed the louder treatment pending gave up", async () => {
    const c = classesOf(await renderAs("failed"));
    expect([...c].some((x) => x.includes("acr-neg"))).toBe(true);
  });
});

describe("deciding reads as in-flight", () => {
  it("carries a motion-safe spin, so a still frame is not the only cue", async () => {
    const icon = iconClassesOf(await renderAs("deciding"));
    expect([...icon].some((c) => c.includes("animate-spin"))).toBe(true);
    // Guarded, so prefers-reduced-motion still gets the icon and the label.
    expect([...icon].some((c) => c.startsWith("motion-safe:"))).toBe(true);
  });

  it("dims the body, so the cue survives a paused animation", async () => {
    const c = classesOf(await renderAs("deciding"));
    expect(
      [...c].some((x) => x.startsWith("opacity-")),
      "with reduced motion the spin is frozen, so the only remaining difference " +
        "from pending would be the label",
    ).toBe(true);
  });
});

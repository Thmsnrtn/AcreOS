// @vitest-environment jsdom
/**
 * The blast composer's half of Leg 3: when the preview carries a state-rule
 * WARN for a property under an assignable contract, Send stays disabled until
 * the operator acknowledges it, and the acknowledgement travels with the send
 * (the server records it). Without a warning nothing changes. FALSIFYING: on
 * pre-leg code there is no warning, no checkbox, and no ack in the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  useRoute: () => [false, null],
  useLocation: () => ["/", () => undefined],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
}));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { BuyerBlastsPanel } from "../../client/src/pages/buyer-blasts";

let container: HTMLDivElement;
let root: Root;
const posts: Array<Record<string, unknown>> = [];
let previewCompliance: unknown = null;
const realFetch = globalThis.fetch;

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const byId = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
const previewBtn = () => Array.from(document.querySelectorAll("button")).find((b) => /Preview/.test(b.textContent ?? "")) as HTMLButtonElement;
const sendBtn = () => q("confirm-send-blast") as HTMLButtonElement;

async function composeAndPreview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(BuyerBlastsPanel)));
  });
  await settle();
  act(() => q("new-blast-button")!.click());
  await settle();
  setValue(byId("bb-property"), "7");
  setValue(byId("bb-subject"), "New deal");
  setValue(byId("bb-body"), "<p>Cash buyers</p>");
  act(() => previewBtn().click());
  await settle();
}

beforeEach(() => {
  posts.length = 0;
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    if (String(url).includes("/blast-buyers")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      posts.push(body);
      const json = body.dryRun
        ? { dryRun: true, recipientCount: 1, recipients: [{ buyerProfileId: 1, name: "Bea", email: "b@x.test", matchScore: 90 }], suppressedCount: 0, compliance: previewCompliance }
        : { blast: { id: 1 }, recipientCount: 1 };
      return new Response(JSON.stringify(json), { status: body.dryRun ? 200 : 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ blasts: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
});

describe("blast composer — state-rule warning needs an acknowledgement", () => {
  it("with a warning: Send is disabled until acknowledged, and the ack is sent", async () => {
    previewCompliance = { error: "wholesaler_compliance_warn", message: "Marketing a property you do not own is restricted.", citation: "Cal. B&P §10131" };
    await composeAndPreview();
    expect(q("blast-compliance-warning")?.textContent).toMatch(/restricted/);
    expect(sendBtn().disabled).toBe(true);
    act(() => (q("blast-compliance-ack") as HTMLInputElement).click());
    expect(sendBtn().disabled).toBe(false);
    await act(async () => {
      sendBtn().click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(posts.find((p) => p.dryRun === false)?.ackComplianceWarning).toBe(true);
  });

  it("without a warning: no checkbox, Send is enabled, and no ack is claimed", async () => {
    previewCompliance = null;
    await composeAndPreview();
    expect(q("blast-compliance-warning")).toBeNull();
    expect(sendBtn().disabled).toBe(false);
    await act(async () => {
      sendBtn().click();
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(posts.find((p) => p.dryRun === false)?.ackComplianceWarning).toBe(false);
  });
});

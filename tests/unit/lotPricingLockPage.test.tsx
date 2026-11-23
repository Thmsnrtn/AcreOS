// @vitest-environment jsdom
/**
 * /lot-pricing — the lock's review-date input and the no-decision notice
 * (subdivider item 1, founder call B-4 P1).
 *
 *   - the operator must ANSWER "when will you know?": a date, or "No set date".
 *     There is no default, and Lock stays disabled until one is given;
 *   - the answer goes to the server verbatim (a date as an ISO instant, "no set
 *     date" as null) — never a manufactured one;
 *   - when the server saved prices but recorded no decision (no feasibility
 *     scenario on file) the page says so, in the server's own words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", async (orig) => ({ ...(await orig<object>()), useLocation: () => ["/lot-pricing?parcelId=1049", () => {}] }));
vi.mock("@/hooks/use-document-title", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: any) => <div>{children}</div> }));

import LotPricingPage from "../../client/src/pages/lot-pricing";

const posts: Array<{ url: string; body: any }> = [];
let lockResponse: Record<string, unknown>;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  posts.length = 0;
  lockResponse = { lockedGrid: [{}, {}], decisionSnapshotId: 9, decisionRecorded: true, decisionWhy: null };
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(init.body as string) });
      return { ok: true, json: async () => lockResponse } as unknown as Response;
    }
    return {
      ok: true,
      json: async () => ({ rules: { id: "11", name: "Standard rural", basePriceSource: "fixed_per_acre", fixedPerAcreCents: 1_000_000, rules: [], lockedGrid: null, lockedAt: null } }),
    } as unknown as Response;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const tick = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const render = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LotPricingPage />
      </QueryClientProvider>,
    );
  });
  await tick();
};
const lockButton = () => [...host.querySelectorAll("button")].find((b) => /Lock grid/.test(b.textContent ?? ""))! as HTMLButtonElement;
const setDate = (v: string) => {
  const el = host.querySelector<HTMLInputElement>("#lot-lock-review-date")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const tomorrowPlus = (days: number) => {
  const t = new Date();
  t.setDate(t.getDate() + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

describe("lot pricing page — the lock asks for a review date", () => {
  it("has a labelled review-date input and a labelled 'No set date' choice, both UNANSWERED at first, and Lock is disabled", async () => {
    await render();
    const input = host.querySelector<HTMLInputElement>("#lot-lock-review-date")!;
    expect(input, "no review-date input").not.toBeNull();
    expect(host.querySelector('label[for="lot-lock-review-date"]')?.textContent).toBe("Review date");
    expect(host.querySelector('label[for="lot-lock-no-review-date"]')?.textContent).toBe("No set date");
    expect(input.value, "the review date must have no default").toBe("");
    expect(host.querySelector('#lot-lock-no-review-date')?.getAttribute("aria-checked")).toBe("false");
    expect(lockButton().disabled).toBe(true);
  });

  it("a future date unlocks Lock and is sent as the operator's own instant; a past/today date does not", async () => {
    await render();
    setDate(tomorrowPlus(0));
    expect(lockButton().disabled, "today is not in the future").toBe(true);
    setDate(tomorrowPlus(30));
    expect(lockButton().disabled).toBe(false);
    await act(async () => { lockButton().click(); });
    await tick();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/parcels/1049/pricing-rules/lock");
    expect(typeof posts[0].body.reviewDueAt).toBe("string");
    expect(new Date(posts[0].body.reviewDueAt).getTime()).toBeGreaterThan(Date.now());
    expect(host.querySelector('[data-testid="lot-lock-notice"]'), "a recorded decision shows no notice").toBeNull();
  });

  it("'No set date' is an answer: it unlocks Lock and sends null", async () => {
    await render();
    await act(async () => { host.querySelector<HTMLElement>("#lot-lock-no-review-date")!.click(); });
    expect(lockButton().disabled).toBe(false);
    await act(async () => { lockButton().click(); });
    await tick();
    expect(posts[0].body).toHaveProperty("reviewDueAt", null);
  });

  it("when prices saved but no decision was recorded, the page says so in the server's words", async () => {
    lockResponse = {
      lockedGrid: [{}],
      decisionSnapshotId: null,
      decisionRecorded: false,
      decisionWhy: "No feasibility scenario is on file for this parcel, so prices were saved and no decision was recorded.",
    };
    await render();
    await act(async () => { host.querySelector<HTMLElement>("#lot-lock-no-review-date")!.click(); });
    await act(async () => { lockButton().click(); });
    await tick();
    const notice = host.querySelector('[data-testid="lot-lock-notice"]')!;
    expect(notice, "no notice after a lock that recorded no decision").not.toBeNull();
    expect(notice.textContent).toContain("Prices saved — no decision recorded");
    expect(notice.textContent).toContain("No feasibility scenario is on file for this parcel");
  });
});

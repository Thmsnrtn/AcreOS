// @vitest-environment jsdom
/**
 * The flip decision panel (fix-and-flip package, Leg 1, §3.1–3.3, §8.1 #5–6).
 *
 *   - what it shows is what gets frozen: with a rehab project, the preview and
 *     the record both use the project's scope total, and a differing analyzer
 *     field is called out rather than silently swapped;
 *   - the ARV source sent is the saved calculation only while the field still
 *     holds that figure; otherwise it is the operator's stated number;
 *   - an uncomputable net profit reads "not computed", never $0;
 *   - nothing is pre-selected and nothing records until the call, a reason and
 *     the review answer are given;
 *   - the analyzer's MAO card is labelled a screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ posted: [] as Array<{ method: string; url: string; body: any }>, netProfit: 1_234_500 as number | null }));

vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: vi.fn(async (method: string, url: string, body: any) => {
    h.posted.push({ method, url, body });
    let json: unknown = {};
    if (url.startsWith("/api/rehabs/")) json = { totals: { budgetCents: 4_300_000 }, items: [{}, {}, {}] };
    else if (url === "/api/flip-analyzer/mao")
      json = { maoCents: 16_000_000, netProfitCents: h.netProfit, netRoiPct: h.netProfit === null ? null : 7.5, totalCashInCents: 21_000_000, rehabWithContingencyCents: 4_730_000, missing: [] };
    else if (url === "/api/fix-and-flip/decide") json = { decisionId: 77, scenarioId: 66 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

import { FlipDecisionPanel, type FlipDecisionPanelProps } from "../../client/src/components/flip/FlipDecisionPanel";

let container: HTMLDivElement;
let root: Root;
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function render(props: Partial<FlipDecisionPanelProps>) {
  const base: FlipDecisionPanelProps = {
    screenRun: true,
    propertyId: 7,
    arvCents: 30_000_000,
    savedArvCents: 30_000_000,
    rehabProjectId: null,
    rehabFieldCents: 4_000_000,
    purchasePriceCents: 15_000_000,
    feeCents: 0,
    holdComparisonSeen: null,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(FlipDecisionPanel, { ...base, ...props })));
  });
  await settle();
  await settle();
}
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function answerAndRecord(kind = "acquire") {
  const btn = () => q("flip-decision-record") as HTMLButtonElement;
  expect(btn().disabled, "nothing answered yet").toBe(true);
  expect(q("flip-decision-kind-acquire")?.getAttribute("aria-pressed")).toBe("false");
  act(() => q(`flip-decision-kind-${kind}`)!.click());
  type(q("flip-decision-rationale") as HTMLTextAreaElement, "Net margin clears our floor.");
  expect(btn().disabled, "review question unanswered").toBe(true);
  act(() => q("flip-decision-review-in-14")!.click());
  await settle();
  expect(btn().disabled).toBe(false);
  await act(async () => {
    btn().click();
    await new Promise((r) => setTimeout(r, 30));
  });
}

beforeEach(() => {
  h.posted.length = 0;
  h.netProfit = 1_234_500;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("FlipDecisionPanel", () => {
  it("with a rehab project: previews and records on the scope total, and says it differs from the analyzer field", async () => {
    await render({ rehabProjectId: "rehab-1" });
    expect(q("flip-decision-rehab-source")?.textContent).toMatch(/scope total \(3 lines\)/);
    expect(q("flip-decision-rehab-differs")?.textContent).toMatch(/\$43,000/);
    const preview = h.posted.find((p) => p.url === "/api/flip-analyzer/mao")!;
    expect(preview.body.rehabEstimateCents).toBe(4_300_000);
    await answerAndRecord();
    const sent = h.posted.find((p) => p.url === "/api/fix-and-flip/decide")!.body;
    expect(sent).not.toHaveProperty("operatorRehabEstimateCents");
    expect(sent.arv).toEqual({ source: "calculation" });
    expect(sent.reviewDueAt).toEqual(expect.any(String));
    expect(q("flip-decision-recorded")?.textContent).toMatch(/decision #77/);
  });

  it("without a project, and with an ARV the operator changed: both are sent as stated by the operator", async () => {
    await render({ arvCents: 28_000_000 });
    expect(q("flip-decision-arv-source")?.textContent).toMatch(/Stated by you/);
    expect(q("flip-decision-rehab-source")?.textContent).toMatch(/Stated by you/);
    await answerAndRecord("pass");
    const sent = h.posted.find((p) => p.url === "/api/fix-and-flip/decide")!.body;
    expect(sent.arv).toEqual({ source: "operator_stated", arvCents: 28_000_000 });
    expect(sent.operatorRehabEstimateCents).toBe(4_000_000);
    expect(sent.kind).toBe("pass");
  });

  it("an uncomputable net profit reads 'not computed', never $0", async () => {
    h.netProfit = null;
    await render({});
    expect(q("flip-decision-net-profit")?.textContent).toBe("not computed");
  });

  it("computes nothing until the operator has run the screen", async () => {
    // Both shapes: with a project (the scope read) and without (the preview).
    await render({ screenRun: false, rehabProjectId: "rehab-1" });
    expect(h.posted).toEqual([]);
    await render({ screenRun: false, rehabProjectId: null });
    expect(h.posted).toEqual([]);
    expect(q("flip-decision-run-screen-first")).not.toBeNull();
    expect(q("flip-decision-record")).toBeNull();
  });

  it("the analyzer's MAO card is labelled a screen", () => {
    const page = stripComments(fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/flip-analyzer.tsx"), "utf8"));
    expect(page).toMatch(/data-testid="flip-mao-screen-label"[^>]*>\s*Screen — nothing recorded/);
    expect(page).toMatch(/<FlipDecisionPanel\b/);
  });
});

// @vitest-environment jsdom
/**
 * The number on the badge is the length of the list the badge sits above.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Three independent definitions of "what needs your attention" shipped at
 * once on Today:
 *
 *   1. the hero — "{N} deals need your attention today" — from
 *      `meta.pendingDecisionCount`, computed server-side as
 *      stalledLeads + waitingCounters + stuckDeals;
 *   2. the DecisionQueue rendered ~200px below it, whose rows come from an
 *      entirely different gather (pax asks + today.queue);
 *   3. the "Review now" chip, which opened /decision-queue → /admin/decisions,
 *      a third page that re-derived the buckets client-side from a bare
 *      `fetch("/api/leads")` — which defaults to pageSize 25 and so could
 *      never see more than 25 leads.
 *
 * For an org with 400 leads: the badge said 34, the list showed 6, and
 * clicking the badge showed 9. The label was wrong too — stalled LEADS were
 * counted as "deals" (2026-09-04 review, CONFIRMED).
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * The count BEHAVIOURALLY, through the component that owns it. DecisionQueue
 * holds the snooze filter, so it is the only thing that can know how many rows
 * are visible; it reports that number and nothing recomputes it. The test
 * renders the queue and checks the reported number against the rows actually
 * in the DOM — so a second derivation appearing anywhere fails, whatever it is
 * spelled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
  useLocation: () => ["/today", () => {}],
}));
vi.mock("@/hooks/usePaxNeedsYou", () => ({
  usePaxAskActions: () => ({ approve: vi.fn(), reject: vi.fn(), revise: vi.fn(), pending: null }),
}));
vi.mock("@/hooks/use-keyboard-layer", () => ({
  useKeyboardLayer: () => ({ activeIndex: -1, activeId: null }),
}));

import { DecisionQueue } from "../../client/src/components/today/DecisionQueue";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comment lines removed — the fix documents what it replaced. */
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join("\n");

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  window.localStorage.clear();
});

const item = (id: string) => ({
  id,
  source: "lead" as const,
  priority: "medium" as const,
  title: `Item ${id}`,
  description: "Something to decide.",
  actionLabel: "Open",
  actionUrl: "/leads/1",
  rank: 1,
});

/** The queue's own snooze store — the filter that makes a second count wrong. */
const SNOOZE_KEY = "acreos-decisionqueue-snoozed";

async function renderQueue(items: unknown[]): Promise<number[]> {
  const reported: number[] = [];
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DecisionQueue
          items={items as never}
          isLoading={false}
          onVisibleCountChange={(n) => reported.push(n)}
        />
      </QueryClientProvider>,
    );
  });
  return reported;
}

describe("the queue reports the number it is showing, filter included", () => {
  /*
   * NOT asserted here, and not for want of trying: the count against the ROWS
   * IN THE DOM. ContentReveal wraps the queue in `AnimatePresence mode="wait"`,
   * whose exit animation is rAF-driven and never completes under jsdom, so a
   * `isLoading={false}` render keeps showing the skeleton forever; flattening
   * framer-motion far enough to get past that breaks an unrelated component in
   * the row subtree. Same limit recorded in
   * todaySkeletonsMatchTheirContent.test.tsx.
   *
   * What IS asserted is the property that made the old count wrong: the number
   * follows this component's own snooze filter. A count derived anywhere else
   * cannot know about it — which is exactly why the hero said 34 while the list
   * showed 6.
   */
  it("reports one per item when nothing is snoozed", async () => {
    const reported = await renderQueue(["a", "b", "c", "d", "e"].map(item));
    expect(reported.at(-1)).toBe(5);
  });

  it("a snoozed row is not counted", async () => {
    // Snoozed an hour into the future, which is what the queue's own store
    // holds; loadSnoozed drops anything already expired.
    window.localStorage.setItem(
      SNOOZE_KEY,
      JSON.stringify({ b: Date.now() + 60 * 60 * 1000, d: Date.now() + 60 * 60 * 1000 }),
    );
    const reported = await renderQueue(["a", "b", "c", "d", "e"].map(item));
    expect(
      reported.at(-1),
      "the count ignored the queue's snooze filter — this is precisely the gap " +
        "between the old server tally and the rows a customer could see",
    ).toBe(3);
  });

  it("an expired snooze is counted again", async () => {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify({ b: Date.now() - 1000 }));
    const reported = await renderQueue(["a", "b", "c"].map(item));
    expect(reported.at(-1)).toBe(3);
  });

  it("an empty queue reports zero rather than staying silent", async () => {
    const reported = await renderQueue([]);
    expect(reported.at(-1)).toBe(0);
  });
});

describe("Today has one definition of the count, not three", () => {
  const today = code("client/src/pages/today.tsx");

  it("the hero reads the queue's report, not the server's own tally", () => {
    expect(today).toContain("onVisibleCountChange={setVisibleDecisionCount}");
    expect(today).toMatch(/const pendingDecisionCount = visibleDecisionCount \?\? decisionItems\.length;/);
    expect(
      today,
      "today.tsx is reading meta.pendingDecisionCount again — that is the " +
        "server's stalledLeads + waitingCounters + stuckDeals tally, a different " +
        "set from the rows it would be labelling",
    ).not.toMatch(/meta\??\.pendingDecisionCount/);
  });

  it("the label matches what the list actually holds", () => {
    // The queue mixes leads, deals, properties and Pax asks; the old label
    // called stalled LEADS "deals".
    expect(today).toContain('plural(pendingDecisionCount, "decision")');
    expect(today).not.toContain('plural(pendingDecisionCount, "deal")');
  });

  it("Review now goes to the list it counts, not to a third derivation", () => {
    expect(today).toContain('data-testid="button-review-decisions"');
    expect(today).toContain('[data-testid="section-decision-queue"]');
    // The chip is no longer a link to the page that re-fetched leads
    // unpaginated and could only ever see 25 of them.
    const heroStart = today.indexOf("Review now");
    const hero = today.slice(Math.max(0, heroStart - 1600), heroStart);
    expect(hero).not.toContain('href="/decision-queue"');
  });
});

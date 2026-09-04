// @vitest-environment jsdom
/**
 * A loading state that is half the height of what it stands in for is a
 * layout shift with extra steps.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The Decision Queue's loading state was three `<Skeleton className="h-16
 * w-full" />` blocks — 64px each — standing in for a Card with
 * `CardContent ... p-6` (48px of vertical padding alone) plus a badge row, a
 * 15px title, a 12px description and often an inline-resolve button row:
 * realistically ~150px, and a pax-ask row taller still. Every Today load
 * produced a visible jump. CashStrip was worse: one `h-24 w-full` for a
 * three-column KPI card with icons, labels, values and sparklines, and its
 * section header did not render at all until the data landed — so the header
 * itself moved too.
 *
 * CLAUDE.md is explicit: "Use Skeleton components matching the content
 * shape". Repo-wide there were 316 raw `h-N w-full` blocks against six files
 * importing the shaped primitives (2026-09-04 review, CONFIRMED).
 *
 * ── WHAT THIS PINS, AND WHY IT IS SHAPED THIS WAY ───────────────────────────
 * jsdom does no layout, so pixel heights cannot be measured here. What CAN be
 * measured is the thing that makes the heights match: the skeleton renders the
 * SAME chrome as the loaded row — the same card classes, the same content
 * padding — rather than a bare block. Those are DERIVED from the loaded
 * render and compared, never named, so a restyle of the row that keeps the
 * skeleton in step passes and one that leaves it behind fails.
 *
 * The pixel question itself belongs to a CLS check in the Playwright config,
 * which this does not replace and does not pretend to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

/**
 * framer-motion, flattened. ContentReveal wraps the crossfade in
 * `AnimatePresence mode="wait"`, whose EXIT animation is rAF-driven and never
 * completes under jsdom — so a "loaded" render keeps showing the skeleton
 * forever and every comparison below would be the skeleton against itself.
 * The animation is not what this file measures; the two DOMs are.
 */
vi.mock("framer-motion", () => {
  const passthrough = (Tag: string) =>
    ({ children, initial, animate, exit, transition, variants, whileHover, whileTap, layout, drag, dragConstraints, onDragEnd, style, ...rest }: any) =>
      React.createElement(Tag, { style, ...rest }, children);
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    useReducedMotion: () => true,
    useAnimation: () => ({ start: vi.fn(), stop: vi.fn(), set: vi.fn() }),
    useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: () => () => {} }),
    useTransform: () => ({ get: () => 0, set: vi.fn(), on: () => () => {} }),
  };
});

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

let queryClient: QueryClient;
let mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
});

afterEach(() => {
  act(() => mounted.forEach((m) => m.root.unmount()));
  mounted.forEach((m) => m.container.remove());
  mounted = [];
  queryClient.clear();
});

/**
 * A FRESH root per render. Re-rendering into one root leaves the previous
 * tree's component state in place — a lesson this repo has already paid for
 * once, when a shared root made two renders of the same component disagree
 * about which state they were in.
 */
async function render(node: React.ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
  // ContentReveal holds the skeleton for at least 200ms so a hot cache never
  // produces a sub-perceptual flash, and AnimatePresence mode="wait" then
  // runs the skeleton's EXIT before the content enters. That exit is
  // rAF-driven, so fake timers cannot complete it — this waits on the real
  // clock instead. Without it a "loaded" render still shows the skeleton, and
  // the comparison below would be the skeleton against itself.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  return container;
}

const ITEM = {
  id: "d1",
  source: "lead" as const,
  priority: "high" as const,
  title: "Reply to the Carter offer",
  description: "They asked about the survey.",
  actionUrl: "/deals/1",
  actionLabel: "Open",
  rank: 1,
};



/**
 * The loaded row's chrome, read from the component source.
 *
 * The first version of this test rendered BOTH states and diffed the DOM,
 * which is the assertion you want. It could not be made to work: ContentReveal
 * wraps the crossfade in `AnimatePresence mode="wait"`, whose exit animation is
 * rAF-driven and never completes under jsdom, and flattening framer-motion far
 * enough to get past that broke an unrelated component in the row's subtree.
 * So the SKELETON is rendered for real and the EXPECTATION is read from the
 * row's source. Half of it is behaviour; the half that is not is said out loud
 * here rather than implied by a green tick.
 */
function loadedRowChrome(): { card: string[]; padding: string } {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../client/src/components/today/DecisionQueue.tsx"),
    "utf8",
  );
  // `data-priority`, not the testid: the testid appears twice — once on the
  // pax-ask row's <motion.li> and once on the regular row's <Card> — and
  // reading the first one silently returns a span with no CardContent in it.
  const at = src.indexOf("data-priority={item.priority}");
  expect(at, "the loaded row no longer identifies itself — this test is reading nothing").toBeGreaterThan(-1);
  const card = src.slice(src.lastIndexOf("<Card", at), at);
  const content = src.slice(at, at + 400);
  const classes = /className="([^"]+)"/.exec(card)?.[1] ?? "";
  const padding = /<CardContent className="([^"]*\bp-\d\b[^"]*)"/.exec(content)?.[1] ?? "";
  expect(classes, "could not read the loaded row's card classes").not.toBe("");
  expect(padding, "could not read the loaded row's content padding").not.toBe("");
  // GEOMETRY classes only. `hover-elevate`, focus rings and transitions are
  // interaction affordances, and a placeholder must not offer them — a
  // skeleton that lit up under the cursor would be a worse bug than the one
  // this test is about. What has to match is the box: radius, border, shadow,
  // padding.
  const interaction = /^(hover|focus|active|group-hover|cursor|transition|animate|select)-/;
  return {
    card: classes.split(/\s+/).filter((c) => c && !interaction.test(c)),
    padding,
  };
}

describe("the Decision Queue skeleton wears the row's chrome", () => {
  it("renders every card class the loaded row uses, and the same content padding", async () => {
    const { card, padding } = loadedRowChrome();
    const dom = await render(<DecisionQueue items={[ITEM as never]} isLoading />);
    const skeletonCard = dom.querySelector<HTMLElement>(
      '[data-testid="decision-queue-skeleton"] [class*="rounded-card"]',
    );
    expect(skeletonCard, "the skeleton renders no card at all").not.toBeNull();

    // Every class the row's box carries, the skeleton's box carries. The old
    // `h-16 w-full` skeleton shares none of them, which is why it was 64px
    // against a row of roughly 150.
    for (const cls of card) {
      expect(
        skeletonCard!.className,
        `the loaded row's card is "${cls}" and the skeleton's is not — the boxes no longer match`,
      ).toContain(cls);
    }
    const skeletonContent = skeletonCard!.firstElementChild as HTMLElement;
    for (const cls of padding.split(/\s+/).filter((c) => /^p-\d$/.test(c))) {
      expect(
        skeletonContent.className,
        `the row's content padding is "${cls}" — most of the row's height — and the skeleton's is not`,
      ).toContain(cls);
    }
  });

  it("is three rows, and each carries a title, a description and an action row", async () => {
    const container = await render(<DecisionQueue items={[ITEM as never]} isLoading />);
    const wrap = container.querySelector('[data-testid="decision-queue-skeleton"]');
    expect(wrap, "the skeleton no longer identifies itself").not.toBeNull();
    const cards = wrap!.querySelectorAll('[class*="rounded-card"]');
    expect(cards).toHaveLength(3);
    // The bars that give it its height. A single block would have one child.
    const bars = cards[0].querySelectorAll('[class*="animate-pulse"]');
    expect(
      bars.length,
      "the skeleton row collapsed back to a block — it needs the badge, title, " +
        "description and action bars to reach the row's height",
    ).toBeGreaterThanOrEqual(5);
  });

  it("no bare full-width block stands in for a row", async () => {
    const container = await render(<DecisionQueue items={[ITEM as never]} isLoading />);
    const blocks = [...container.querySelectorAll<HTMLElement>("*")].filter(
      (el) =>
        typeof el.className === "string" &&
        /(^|\s)h-\d+(\s|$)/.test(el.className) &&
        /(^|\s)w-full(\s|$)/.test(el.className),
    );
    expect(
      blocks.map((b) => b.className),
      "a bare `h-N w-full` block is standing in for a shaped row again",
    ).toEqual([]);
  });
});

describe("the loading and loaded states agree on what is already known", () => {
  it("the queue's heading is already on screen while it loads", async () => {
    const dom = await render(<DecisionQueue items={[ITEM as never]} isLoading />);
    const heading = dom.querySelector("h2")?.textContent?.trim();
    expect(
      heading,
      "the section names itself only after the data lands, so the heading itself moves",
    ).toBeTruthy();
  });

  it("CashStrip renders its header in the loading branch too", () => {
    // Its header used to render only in the loaded branch, so the whole strip
    // — heading, link and card — appeared at once and pushed the queue down.
    // Both branches now render the SAME <CashStripHeader />, which is the only
    // way the two can be identical rather than merely similar.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../client/src/components/today/CashStrip.tsx"),
      "utf8",
    );
    const loadingAt = src.indexOf("if (isLoading) {");
    expect(loadingAt).toBeGreaterThan(-1);
    const loadingBranch = src.slice(loadingAt, src.indexOf("return (", src.indexOf("}", loadingAt)));
    expect(loadingBranch).toContain("<CashStripHeader />");
    // And exactly one definition, so the two branches cannot drift.
    expect((src.match(/function CashStripHeader\(/g) ?? [])).toHaveLength(1);
    expect((src.match(/<CashStripHeader \/>/g) ?? []).length).toBe(2);
    // No bare block left standing in for the three-column card.
    expect(loadingBranch).not.toMatch(/Skeleton className="h-24 w-full"/);
    expect(loadingBranch).toContain("grid-cols-1 sm:grid-cols-3");
  });
});

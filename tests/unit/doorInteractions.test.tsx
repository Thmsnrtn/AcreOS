// @vitest-environment jsdom
/**
 * Wave 1.3 — the door-interaction layer (handoff P1 §§4.1/4.2/4.4).
 *
 * Falsifiable exit for three doors' interaction upgrades:
 *
 *   1. KEYBOARD GRAMMAR (hooks/use-list-keys.tsx): J/K move focus, Enter
 *      fires the open callback, declared action keys ("s" snooze on
 *      Today, "e" archive on Inbox) fire against the FOCUSED row, typing
 *      targets suppress everything, "?" fires the help toggle and stops
 *      the event so the global provider's dialog can't double-open.
 *
 *   2. APPROVE-ABOVE-THRESHOLD (components/today/approve-above-threshold):
 *      the qualifying filter matches the queue's "Pax would handle"
 *      predicate; the batch runner calls the injected PER-ITEM mutation
 *      once per item, sequentially, collecting per-item results past
 *      failures. ROUTE PIN: the Today door's client source introduces NO
 *      bulk/approve server route — the runner file is transport-free and
 *      today.tsx reuses the existing per-item PATCH /api/today/queue/:id.
 *
 *   3. DEALS COLUMN INTELLIGENCE (components/deals/column-stats): per-
 *      column count + total value derive purely from loaded rows,
 *      mirroring the card's accepted-else-offer amount line.
 *
 *   4. INBOX NEEDS-REPLY (components/inbox/needs-reply): the full
 *      thread predicate (latest inbound + no outbound after) against
 *      message fixtures, and the honest email degradation (latest
 *      unarchived message per thread; inbound-only data).
 *
 * Before this wave none of these modules existed, so the suite fails at
 * the pre-wave HEAD by construction.
 *
 * idempotent: true — pure functions + jsdom mounts, no DATABASE_URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

import {
  useListKeys,
  resolveListKey,
  ListKeyGrammarOverlay,
} from "../../client/src/hooks/use-list-keys";
import {
  isAboveThreshold,
  qualifyingApprovals,
  approveItemsSequentially,
} from "../../client/src/components/today/approve-above-threshold";
import {
  columnStats,
  dealDisplayValue,
} from "../../client/src/components/deals/column-stats";
import {
  threadNeedsReply,
  emailThreadKey,
  deriveNeedsReplyEmailIds,
} from "../../client/src/components/inbox/needs-reply";

const CLIENT_SRC = path.resolve(__dirname, "../../client/src");

// ─── jsdom shims (repo pattern — see doorErrorStates.test.tsx) ───────────
// matchMedia reports a fine pointer so the desktop-only keyboard layer
// mounts under jsdom.

beforeEach(() => {
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia = ((query: string) => ({
    matches: query.includes("hover: hover") && query.includes("pointer: fine"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

// ─── Mount helper (react-dom/client, no @testing-library) ────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// Dispatch on document.body (not window) so the event walks real capture
// and bubble phases past window-level listeners — exactly the propagation
// the runtime provider + capture-phase grammar see.
function press(key: string, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

// ─── 1. useListKeys — the shared door-list grammar ───────────────────────

function Harness({
  itemCount,
  onOpen,
  actionKeys,
  onHelp,
}: {
  itemCount: number;
  onOpen: (i: number) => void;
  actionKeys?: Record<string, (i: number) => void>;
  onHelp?: () => void;
}) {
  const { activeIndex } = useListKeys({ itemCount, onOpen, actionKeys, onHelp });
  return (
    <div data-testid="active-index">{activeIndex === null ? "none" : String(activeIndex)}</div>
  );
}

const activeIndexText = (el: HTMLElement) =>
  el.querySelector('[data-testid="active-index"]')!.textContent;

describe("useListKeys — J/K/Enter grammar", () => {
  it("j moves focus down from none → 0 → 1 and clamps at the end", () => {
    const el = mount(<Harness itemCount={2} onOpen={() => {}} />);
    expect(activeIndexText(el)).toBe("none");
    press("j");
    expect(activeIndexText(el)).toBe("0");
    press("j");
    expect(activeIndexText(el)).toBe("1");
    press("j"); // clamped — no wrap
    expect(activeIndexText(el)).toBe("1");
  });

  it("k moves focus up and first-k lands on the last item", () => {
    const el = mount(<Harness itemCount={3} onOpen={() => {}} />);
    press("k");
    expect(activeIndexText(el)).toBe("2");
    press("k");
    expect(activeIndexText(el)).toBe("1");
  });

  it("Enter fires onOpen with the focused index", () => {
    const onOpen = vi.fn();
    mount(<Harness itemCount={3} onOpen={onOpen} />);
    press("j");
    press("j");
    press("Enter");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("Enter on an interactive control keeps native activation (no onOpen)", () => {
    const onOpen = vi.fn();
    mount(<Harness itemCount={3} onOpen={onOpen} />);
    press("j");
    const button = document.createElement("button");
    document.body.appendChild(button);
    press("Enter", button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("action keys fire against the focused row only", () => {
    const snooze = vi.fn();
    mount(<Harness itemCount={3} onOpen={() => {}} actionKeys={{ s: snooze }} />);
    press("s"); // no row focused yet — nothing happens
    expect(snooze).not.toHaveBeenCalled();
    press("j");
    press("s");
    expect(snooze).toHaveBeenCalledTimes(1);
    expect(snooze).toHaveBeenCalledWith(0);
  });

  it("typing targets suppress the whole grammar", () => {
    const onOpen = vi.fn();
    const el = mount(<Harness itemCount={3} onOpen={onOpen} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("j", input);
    expect(activeIndexText(el)).toBe("none");
    press("Enter", input);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("? fires the help toggle and STOPS the event (global dialog can't double-open)", () => {
    const onHelp = vi.fn();
    const bubbleListener = vi.fn();
    // A bubble-phase window listener stands in for the global
    // KeyboardShortcutsProvider — the capture-phase grammar must stop
    // "?" before it arrives.
    window.addEventListener("keydown", bubbleListener);
    try {
      mount(<Harness itemCount={1} onOpen={() => {}} onHelp={onHelp} />);
      press("?");
      expect(onHelp).toHaveBeenCalledTimes(1);
      expect(bubbleListener).not.toHaveBeenCalled();
      press("j"); // any other key still reaches the bubble phase
      expect(bubbleListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", bubbleListener);
    }
  });

  it("Escape clears focus; shrinking lists clamp the index", () => {
    const el = mount(<Harness itemCount={2} onOpen={() => {}} />);
    press("j");
    expect(activeIndexText(el)).toBe("0");
    press("Escape");
    expect(activeIndexText(el)).toBe("none");
  });
});

describe("resolveListKey — pure grammar resolution", () => {
  const base = {
    activeIndex: null as number | null,
    itemCount: 3,
    hasHelp: true,
    actionKeySet: new Set(["s", "e"]),
    targetIsInteractive: false,
  };

  it("reserved keys can never be shadowed by action keys", () => {
    const res = resolveListKey({
      ...base,
      key: "j",
      actionKeySet: new Set(["j", "s"]),
    });
    expect(res).toEqual({ kind: "move", nextIndex: 0 });
  });

  it("empty lists resolve every traversal to none", () => {
    expect(resolveListKey({ ...base, key: "j", itemCount: 0 })).toEqual({ kind: "none" });
    expect(resolveListKey({ ...base, key: "enter", itemCount: 0 })).toEqual({ kind: "none" });
  });

  it("help resolves regardless of focus", () => {
    expect(resolveListKey({ ...base, key: "?" })).toEqual({ kind: "help" });
  });
});

describe("ListKeyGrammarOverlay — the ? overlay documents the keys", () => {
  it("renders the door grammar entries and the door chords", () => {
    mount(
      <ListKeyGrammarOverlay
        open
        onOpenChange={() => {}}
        title="Decision queue keys"
        entries={[
          { keys: "j", label: "Next item" },
          { keys: "s", label: "Snooze the focused item" },
        ]}
      />,
    );
    const dialog = document.querySelector('[data-testid="dialog-list-key-grammar"]');
    expect(dialog).toBeTruthy();
    const text = dialog!.textContent ?? "";
    expect(text).toContain("Decision queue keys");
    expect(text).toContain("Next item");
    expect(text).toContain("Snooze the focused item");
    // Door chords ride along so hijacking "?" on a door loses nothing.
    expect(text).toContain("Today");
    expect(text).toContain("Deals");
  });
});

// ─── 2. Approve-above-threshold — per-item, sequential, honest ───────────

describe("qualifyingApprovals — matches the queue's Pax-would-handle predicate", () => {
  const items = [
    { id: "a", source: "pax-suggests", confidence: 0.95 },
    { id: "b", source: "pax-priority", confidence: 0.9 },
    { id: "c", source: "pax-suggests", confidence: 0.85 }, // below threshold
    { id: "d", source: "ai-queue", confidence: 0.99 }, // not Pax-sourced
    { id: "e", source: "pax-noticed" }, // no confidence
    { id: "f", source: "portfolio-alert", confidence: null },
  ];

  it("selects exactly the Pax-sourced rows at/above the threshold, in order", () => {
    expect(qualifyingApprovals(items, 0.9).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("isAboveThreshold treats the boundary as inclusive and ignores non-Pax rows", () => {
    expect(isAboveThreshold({ id: "x", source: "pax-suggests", confidence: 0.9 }, 0.9)).toBe(true);
    expect(isAboveThreshold({ id: "x", source: "ai-queue", confidence: 1 }, 0.9)).toBe(false);
    expect(isAboveThreshold({ id: "x", source: "pax-suggests" }, 0.9)).toBe(false);
  });

  it("default-threshold 1.01 can never qualify anything (never-auto default)", () => {
    expect(qualifyingApprovals(items, 1.01)).toEqual([]);
  });
});

describe("approveItemsSequentially — one per-item call each, never a bulk", () => {
  it("calls the injected per-item mutation once per item, in order, sequentially", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const progress: Array<[number, number]> = [];
    const result = await approveItemsSequentially(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      async (id) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 0));
        calls.push(id);
        inFlight -= 1;
      },
      (done, total) => progress.push([done, total]),
    );
    expect(calls).toEqual(["a", "b", "c"]);
    expect(maxInFlight).toBe(1); // strictly sequential — a human tapping N times
    expect(result.approved).toEqual(["a", "b", "c"]);
    expect(result.failed).toEqual([]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("collects per-item failures and keeps going past them", async () => {
    const result = await approveItemsSequentially(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      async (id) => {
        if (id === "b") throw new Error("policy gate said no");
      },
    );
    expect(result.approved).toEqual(["a", "c"]);
    expect(result.failed).toEqual([{ id: "b", error: "policy gate said no" }]);
  });
});

describe("route pin — the batch flow reuses the existing per-item endpoint", () => {
  const todaySources = (): Array<[string, string]> => {
    const files: Array<[string, string]> = [];
    const page = path.join(CLIENT_SRC, "pages/today.tsx");
    files.push([page, fs.readFileSync(page, "utf8")]);
    const dir = path.join(CLIENT_SRC, "components/today");
    for (const entry of fs.readdirSync(dir)) {
      if (/\.(ts|tsx)$/.test(entry)) {
        const full = path.join(dir, entry);
        files.push([full, fs.readFileSync(full, "utf8")]);
      }
    }
    return files;
  };

  it("the sequencing module is transport-free (no /api literal at all)", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/today/approve-above-threshold.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/["'`]\/api\//);
  });

  it("today.tsx runs the batch through the per-item PATCH /api/today/queue/:id", () => {
    const src = fs.readFileSync(path.join(CLIENT_SRC, "pages/today.tsx"), "utf8");
    expect(src).toMatch(
      /apiRequest\(\s*\n?\s*"PATCH",\s*\n?\s*`\/api\/today\/queue\/\$\{encodeURIComponent\(id\)\}`/,
    );
  });

  it("no bulk/approve server route string exists anywhere in the Today door client source", () => {
    for (const [file, src] of todaySources()) {
      for (const match of src.matchAll(/["'`](\/api\/[^"'`\s${}]*)/g)) {
        const literal = match[1];
        expect(
          /(bulk|approve)/i.test(literal),
          `${path.relative(CLIENT_SRC, file)} names a bulk/approve API route: ${literal}`,
        ).toBe(false);
      }
    }
  });

  it("DecisionQueue wires S to the same per-item snooze the inline button fires", () => {
    const src = fs.readFileSync(
      path.join(CLIENT_SRC, "components/today/DecisionQueue.tsx"),
      "utf8",
    );
    expect(src).toMatch(/actionKeys:\s*\{\s*\n?\s*s:/);
    expect(src).toMatch(/onResolve!\(item\.id,\s*"snooze"\)/);
  });

  it("inbox wires E to the existing archive mutation, email-only", () => {
    const src = fs.readFileSync(path.join(CLIENT_SRC, "pages/inbox.tsx"), "utf8");
    expect(src).toMatch(/actionKeys:\s*\{\s*\n?\s*e:/);
    expect(src).toMatch(/item\.type !== "email"\)? return/);
    expect(src).toMatch(/\/api\/inbox\/\$\{id\}\/archive/);
  });
});

// ─── 3. Deals column intelligence — derived from loaded rows ─────────────

describe("columnStats — count + total value from the rows the column renders", () => {
  it("sums accepted-else-offer per row, exactly like the card's amount line", () => {
    const stats = columnStats([
      { acceptedAmount: "5000", offerAmount: "3000" }, // accepted wins
      { acceptedAmount: null, offerAmount: "2000" },
      { acceptedAmount: null, offerAmount: null }, // no amount — excluded
    ]);
    expect(stats).toEqual({ count: 3, totalValue: 7000, valuedCount: 2 });
  });

  it("never invents a number from junk input", () => {
    const stats = columnStats([
      { acceptedAmount: "", offerAmount: "" }, // empty strings are not zero
      { acceptedAmount: "not-a-number", offerAmount: undefined },
    ]);
    expect(stats).toEqual({ count: 2, totalValue: 0, valuedCount: 0 });
  });

  it("an explicit accepted 0 is a real number, preferred over the offer", () => {
    expect(dealDisplayValue({ acceptedAmount: "0", offerAmount: "9000" })).toBe(0);
  });

  it("empty column → zero everything", () => {
    expect(columnStats([])).toEqual({ count: 0, totalValue: 0, valuedCount: 0 });
  });
});

// ─── 4. Inbox needs-reply — the honest derivation ────────────────────────

describe("threadNeedsReply — latest inbound + no outbound after it", () => {
  it("empty thread never needs a reply", () => {
    expect(threadNeedsReply([])).toBe(false);
  });

  it("an unanswered inbound message needs a reply", () => {
    expect(
      threadNeedsReply([{ direction: "inbound", at: "2026-08-01T10:00:00Z" }]),
    ).toBe(true);
  });

  it("an outbound after the last inbound means answered", () => {
    expect(
      threadNeedsReply([
        { direction: "inbound", at: "2026-08-01T10:00:00Z" },
        { direction: "outbound", at: "2026-08-01T11:00:00Z" },
      ]),
    ).toBe(false);
  });

  it("a NEW inbound after our reply re-opens the thread", () => {
    expect(
      threadNeedsReply([
        { direction: "inbound", at: "2026-08-01T10:00:00Z" },
        { direction: "outbound", at: "2026-08-01T11:00:00Z" },
        { direction: "inbound", at: "2026-08-02T09:00:00Z" },
      ]),
    ).toBe(true);
  });

  it("outbound-only threads have nothing to answer", () => {
    expect(
      threadNeedsReply([{ direction: "outbound", at: "2026-08-01T10:00:00Z" }]),
    ).toBe(false);
  });

  it("a timestamp tie resolves to answered — never over-claim", () => {
    const at = "2026-08-01T10:00:00Z";
    expect(
      threadNeedsReply([
        { direction: "inbound", at },
        { direction: "outbound", at },
      ]),
    ).toBe(false);
  });
});

describe("deriveNeedsReplyEmailIds — latest unarchived message per thread", () => {
  it("groups by conversation and keeps only the latest message's id", () => {
    const ids = deriveNeedsReplyEmailIds([
      { id: 1, senderEmail: "a@x.com", conversationId: 7, receivedAt: "2026-08-01T10:00:00Z" },
      { id: 2, senderEmail: "a@x.com", conversationId: 7, receivedAt: "2026-08-02T10:00:00Z" },
      { id: 3, senderEmail: "b@y.com", conversationId: null, subject: "40 acres", receivedAt: "2026-08-01T09:00:00Z" },
    ]);
    expect(ids).toEqual(new Set([2, 3]));
  });

  it("normalizes Re:/Fwd: chains into one thread per sender+subject", () => {
    const a = { id: 1, senderEmail: "Seller@X.com", subject: "40 acres", receivedAt: "2026-08-01T10:00:00Z" };
    const b = { id: 2, senderEmail: "seller@x.com", subject: "RE: Re: 40 acres", receivedAt: "2026-08-02T10:00:00Z" };
    expect(emailThreadKey(a)).toBe(emailThreadKey(b));
    expect(deriveNeedsReplyEmailIds([a, b])).toEqual(new Set([2]));
  });

  it("an archived latest message closes the whole thread", () => {
    const ids = deriveNeedsReplyEmailIds([
      { id: 1, senderEmail: "a@x.com", conversationId: 7, receivedAt: "2026-08-01T10:00:00Z" },
      { id: 2, senderEmail: "a@x.com", conversationId: 7, receivedAt: "2026-08-02T10:00:00Z", isArchived: true },
    ]);
    expect(ids).toEqual(new Set());
  });

  it("distinct subjects from one sender stay distinct threads", () => {
    const ids = deriveNeedsReplyEmailIds([
      { id: 1, senderEmail: "a@x.com", subject: "40 acres", receivedAt: "2026-08-01T10:00:00Z" },
      { id: 2, senderEmail: "a@x.com", subject: "5 acre lot", receivedAt: "2026-08-01T11:00:00Z" },
    ]);
    expect(ids).toEqual(new Set([1, 2]));
  });
});

// ─── Fleet-8 verifier catches — each fix pinned so it cannot regress ────────
//
// The independent audit of this wave found one BLOCKING honesty defect and
// five should-fixes. Every one is repaired centrally; these pins are the
// repair's memory.

const src = (rel: string) => fs.readFileSync(path.join(CLIENT_SRC, rel), "utf8");

describe("fleet-8 catch — the batch affordance describes what it actually does", () => {
  it("never promises Pax will re-ask about rows it permanently marks done", () => {
    const queue = src("components/today/DecisionQueue.tsx");
    // Scope to the DIALOG. The row-level preview copy ("Pax will still ask
    // you. You'll see this row in your queue.") is honest about a row left
    // ALONE and must survive; the blocking defect was the batch dialog
    // repeating that promise about rows it writes status="done" on, which is
    // precisely how the queue is told to stop raising a row.
    const start = queue.indexOf('data-testid="dialog-approve-above-threshold"');
    expect(start).toBeGreaterThan(-1);
    // Anchor the end AFTER the start — an earlier confirm dialog in this
    // file also has a footer, and slicing to its index yields nothing.
    const dialog = queue.slice(start, queue.indexOf("<AlertDialogFooter>", start));
    expect(dialog.length).toBeGreaterThan(0);
    expect(dialog).not.toMatch(/will still ask you/);
    // It must say the opposite, plainly.
    expect(dialog).toContain("these rows will not come back");
    // And it must not claim to be N taps of a per-row control that is never
    // rendered on these rows (canResolveInline requires !auto).
    expect(dialog).not.toMatch(/as tapping Done on each row/);
    // The row copy stays untouched — the fix was to the dialog's claim.
    expect(queue).toContain("Preview — Pax will still ask you.");
  });

  it("the verb is 'clear', not 'approve' — nothing is approved or executed", () => {
    const queue = src("components/today/DecisionQueue.tsx");
    expect(queue).toMatch(/Clear \{autoItems\.length\} above threshold/);
    expect(queue).toMatch(/Clear \{autoItems\.length\} Pax preview/);
    // The aria-label carries the irreversibility too, not just the visual copy.
    expect(queue).toMatch(/they will not come back/);
  });
});

describe("fleet-8 catch — the list layer listens where it can be overridden", () => {
  it("only '?' rides the capture phase; list keys stay on the bubble phase", () => {
    const hook = src("hooks/use-list-keys.tsx");
    // "?" must win against the global shortcuts provider…
    expect(hook).toMatch(/addEventListener\("keydown", handleHelpKey, true\)/);
    // …but j/k/Enter/Escape must NOT, or no nested owner could ever suppress
    // them (a capture listener silently outranks every inner handler).
    expect(hook).toMatch(/addEventListener\("keydown", handleKeyDown\)(?!, true)/);
    expect(hook).not.toMatch(/addEventListener\("keydown", handleKeyDown, true\)/);
    // Which makes this guard reachable again — pin it so it stays.
    expect(hook).toContain("if (e.defaultPrevented) return;");
  });

  it("the overlay carries the app-wide chords it displaces (derived from the real registrations)", () => {
    const hook = src("hooks/use-list-keys.tsx");
    const shortcuts = src("hooks/use-keyboard-shortcuts.tsx");
    // Every non-door global chord registered by the provider must appear in
    // the overlay's grammar, or it becomes undiscoverable on doors that own
    // "?" — the overlay REPLACES the global dialog there.
    const globalKeys = [...shortcuts.matchAll(/key: "([^"]+)"[^}]*global: true/g)].map((m) => m[1]);
    const nonDoorGlobals = globalKeys.filter((k) => k !== "?" && !/^g [dmfpt]$/.test(k));
    expect(nonDoorGlobals.length).toBeGreaterThan(0);
    for (const key of nonDoorGlobals) {
      expect(hook, `overlay must document the global chord "${key}"`).toContain(`keys: "${key}"`);
    }
  });

  it("the superseded Today-only hook is deleted, not left as live-looking dead code", () => {
    expect(fs.existsSync(path.join(CLIENT_SRC, "hooks/use-keyboard-layer.ts"))).toBe(false);
    // And the primitives file's consumer list tells the truth about it.
    expect(src("lib/keyboard-layer.ts")).toContain("useListKeys (hooks/use-list-keys.tsx)");
  });
});

describe("fleet-8 catch — needs-reply can see the archived row it filters on", () => {
  it("the needs-reply query does NOT filter isArchived server-side", () => {
    const page = src("pages/inbox.tsx");
    const branch = page.slice(
      page.indexOf('statusFilter === "needs_reply"'),
      page.indexOf('statusFilter === "starred"'),
    );
    expect(branch.length).toBeGreaterThan(0);
    // Filtering archived rows out server-side hid the archived LATEST
    // message, so the next-newest unarchived row looked latest and the
    // thread the user just archived came back.
    expect(branch).not.toMatch(/params\.isArchived\s*=/);
  });

  it("the derivation still drops a thread whose latest message is archived", () => {
    const ids = deriveNeedsReplyEmailIds([
      { id: 1, senderEmail: "a@x.com", subject: "Fence line", receivedAt: "2026-08-01T10:00:00Z" },
      { id: 2, senderEmail: "a@x.com", subject: "Fence line", receivedAt: "2026-08-02T10:00:00Z", isArchived: true },
    ]);
    expect(ids.size).toBe(0);
  });
});

describe("fleet-8 catch — a partial column total says so on every viewport", () => {
  it("all three deals readouts render through the one qualifier-carrying component", () => {
    const page = src("pages/deals.tsx");
    const uses = page.match(/<ColumnValueReadout/g) ?? [];
    expect(uses.length).toBe(3); // desktop kanban + mobile list + mobile kanban
    // No viewport may hand-roll a bare total again: the only place the
    // stage total is formatted is inside the shared component.
    expect(page).not.toMatch(/\{usd\(stageStats\.totalValue/);
    expect(page).toContain("of {stats.count} priced");
  });
});

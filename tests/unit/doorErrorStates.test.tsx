// @vitest-environment jsdom
/**
 * Wave 1.2 — error states + stale-while-error across the five customer
 * doors (handoff P1 §2.3).
 *
 * Two halves:
 *
 *  1. UNIT — the stale-while-error primitive
 *     (client/src/lib/stale-while-error.tsx): error over cached data
 *     keeps rendering the data with the quiet "Showing data from {time}
 *     — Retry" chip; error with NOTHING cached falls to QueryErrorState;
 *     the Retry button really triggers refetch; the chip refuses to
 *     invent a timestamp when react-query doesn't know one
 *     (dataUpdatedAt 0, i.e. placeholderData).
 *
 *  2. SOURCE PIN — derived from the REAL door model. The five customer
 *     doors come from MOBILE_DOORS + NAV_ITEM_MAP (lib/nav-items.ts),
 *     their hrefs resolve to page files through App.tsx's actual Route →
 *     React.lazy(import("@/pages/…")) wiring — nothing hardcoded that
 *     can silently go stale. Every query-bearing door page must use the
 *     stale-while-error primitive; a query-less door shell (the Finance
 *     door's tab shell, money.tsx) must lazy-mount child pages that
 *     carry the error handling instead.
 *
 * Falsifiability: before this wave the primitive file did not exist and
 * no door page referenced it, so both halves fail at the pre-wave HEAD.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

import {
  getQueryDegradation,
  staleSinceText,
  StaleDataChip,
  StaleWhileError,
  type StaleWhileErrorQuery,
} from "../../client/src/lib/stale-while-error";
import { MOBILE_DOORS, NAV_ITEM_MAP } from "../../client/src/lib/nav-items";

// ─── jsdom shims (repo pattern — see waveDTaxRentSurfaces.test.tsx) ──────

beforeEach(() => {
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

// ─── Mount helper (react-dom/client, no @testing-library) ────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: ReactElement): HTMLDivElement {
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
});

function makeQuery(overrides: Partial<StaleWhileErrorQuery>): StaleWhileErrorQuery {
  return {
    data: undefined,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    refetch: () => undefined,
    isRefetching: false,
    ...overrides,
  };
}

// ─── 1. The primitive ────────────────────────────────────────────────────

describe("getQueryDegradation", () => {
  it("no error → ok (with or without data)", () => {
    expect(getQueryDegradation({ isError: false, data: undefined })).toBe("ok");
    expect(getQueryDegradation({ isError: false, data: [] })).toBe("ok");
  });

  it("error over cached data → stale (cached data keeps rendering)", () => {
    expect(getQueryDegradation({ isError: true, data: { rows: [] } })).toBe("stale");
    // Cached empty payloads are still data — [] must not be treated as "nothing cached".
    expect(getQueryDegradation({ isError: true, data: [] })).toBe("stale");
  });

  it("error with nothing cached → error (full error card)", () => {
    expect(getQueryDegradation({ isError: true, data: undefined })).toBe("error");
  });
});

describe("staleSinceText — refuse-not-fabricate on timestamps", () => {
  it("names the real cache age when known", () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    expect(staleSinceText(fiveMinAgo)).toMatch(/^Showing data from .*ago$/);
  });

  it("never invents a time when react-query doesn't know one (placeholderData)", () => {
    expect(staleSinceText(0)).toBe("Showing previously loaded data");
    // No epoch-1970 fabrication either.
    expect(staleSinceText(0)).not.toMatch(/197\d/);
  });
});

describe("StaleDataChip", () => {
  it("is announced (role=status), names the data age, and Retry triggers the refetch", () => {
    const onRetry = vi.fn();
    const el = mount(
      <StaleDataChip
        dataUpdatedAt={Date.now() - 10 * 60 * 1000}
        onRetry={onRetry}
        testId="chip-under-test"
      />,
    );

    const chip = el.querySelector('[data-testid="chip-under-test"]');
    expect(chip, "chip renders").toBeTruthy();
    expect(chip!.getAttribute("role")).toBe("status");
    expect(chip!.textContent).toContain("Showing data from");
    expect(chip!.textContent).toContain("ago");

    const retry = el.querySelector<HTMLButtonElement>(
      '[data-testid="chip-under-test-retry"]',
    );
    expect(retry, "Retry is a real button").toBeTruthy();
    expect(retry!.tagName).toBe("BUTTON");
    act(() => retry!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables Retry while a retry is in flight", () => {
    const el = mount(
      <StaleDataChip dataUpdatedAt={0} onRetry={() => {}} isRetrying testId="chip-busy" />,
    );
    const retry = el.querySelector<HTMLButtonElement>('[data-testid="chip-busy-retry"]');
    expect(retry!.disabled).toBe(true);
    expect(retry!.textContent).toContain("Retrying");
  });
});

describe("StaleWhileError wrapper", () => {
  it("error + cached data → children stay rendered WITH the stale chip", () => {
    const query = makeQuery({
      isError: true,
      error: new Error("boom"),
      data: [{ id: 1 }],
      dataUpdatedAt: Date.now() - 60 * 1000,
    });
    const el = mount(
      <StaleWhileError query={query} testId="swe">
        <div data-testid="cached-content">cached rows</div>
      </StaleWhileError>,
    );
    expect(el.querySelector('[data-testid="cached-content"]'), "cached content still renders").toBeTruthy();
    expect(el.querySelector('[data-testid="swe-chip"]'), "stale chip renders").toBeTruthy();
    expect(el.querySelector('[data-testid="swe-error"]'), "no full error card").toBeNull();
  });

  it("error + NO cached data → QueryErrorState, children do not render", () => {
    const query = makeQuery({ isError: true, error: new Error("boom"), data: undefined });
    const el = mount(
      <StaleWhileError query={query} compact errorTitle="Couldn't load" testId="swe">
        <div data-testid="cached-content">cached rows</div>
      </StaleWhileError>,
    );
    expect(el.querySelector('[data-testid="swe-error"]'), "error card renders").toBeTruthy();
    expect(el.querySelector('[data-testid="cached-content"]'), "children suppressed").toBeNull();
    expect(el.textContent).toContain("Couldn't load");
  });

  it("no error → children render with no chip and no error card", () => {
    const query = makeQuery({ data: [{ id: 1 }] });
    const el = mount(
      <StaleWhileError query={query} testId="swe">
        <div data-testid="cached-content">rows</div>
      </StaleWhileError>,
    );
    expect(el.querySelector('[data-testid="cached-content"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="swe-chip"]')).toBeNull();
    expect(el.querySelector('[data-testid="swe-error"]')).toBeNull();
  });

  it("retry from both degraded states calls the query's refetch", () => {
    const refetchStale = vi.fn();
    const stale = mount(
      <StaleWhileError
        query={makeQuery({ isError: true, data: [1], refetch: refetchStale })}
        testId="swe-a"
      >
        <span />
      </StaleWhileError>,
    );
    act(() => stale.querySelector<HTMLButtonElement>('[data-testid="swe-a-chip-retry"]')!.click());
    expect(refetchStale).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    root = null;

    const refetchHard = vi.fn();
    const hard = mount(
      <StaleWhileError
        query={makeQuery({ isError: true, data: undefined, refetch: refetchHard })}
        compact
        testId="swe-b"
      >
        <span />
      </StaleWhileError>,
    );
    act(() =>
      hard
        .querySelector<HTMLButtonElement>('[data-testid="swe-b-error-retry-button"]')!
        .click(),
    );
    expect(refetchHard).toHaveBeenCalledTimes(1);
  });
});

// ─── 2. Source pin — derived from the real door routes ───────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PAGES_DIR = path.join(REPO_ROOT, "client", "src", "pages");
const APP_TSX = fs.readFileSync(path.join(REPO_ROOT, "client", "src", "App.tsx"), "utf8");

/** Resolve a door href to its page files via App.tsx's real route wiring. */
function resolveDoorPageFiles(href: string): string[] {
  const routeBlock = new RegExp(
    `<Route path="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">([\\s\\S]*?)</Route>`,
  ).exec(APP_TSX);
  expect(routeBlock, `App.tsx has a <Route path="${href}"> block`).toBeTruthy();

  const pageIds = [...routeBlock![1].matchAll(/\b([A-Z][A-Za-z0-9]*Page)\b/g)].map(
    (m) => m[1],
  );
  expect(pageIds.length, `route ${href} renders at least one *Page component`).toBeGreaterThan(0);

  const files: string[] = [];
  for (const id of new Set(pageIds)) {
    const lazy = new RegExp(
      `const\\s+${id}\\s*=\\s*React\\.lazy\\(\\(\\)\\s*=>\\s*import\\("@/pages/([^"]+)"\\)`,
    ).exec(APP_TSX);
    expect(lazy, `${id} (route ${href}) resolves to a lazy @/pages import`).toBeTruthy();
    files.push(path.join(PAGES_DIR, `${lazy![1]}.tsx`));
  }
  return files;
}

const isQueryBearing = (src: string) => src.includes("@tanstack/react-query");
const usesPrimitive = (src: string) => /["']@\/lib\/stale-while-error["']/.test(src);
const usesErrorSurface = (src: string) =>
  src.includes("QueryErrorState") || usesPrimitive(src);
/** Page-level children a query-less door shell lazy-mounts. */
const childPageImports = (src: string) =>
  [...src.matchAll(/import\("@\/pages\/([^"]+)"\)/g)].map((m) =>
    path.join(PAGES_DIR, `${m[1]}.tsx`),
  );

describe("five customer doors — stale-while-error coverage (derived pin)", () => {
  it("the door model still resolves five doors with hrefs", () => {
    expect(MOBILE_DOORS).toHaveLength(5);
    for (const id of MOBILE_DOORS) {
      expect(NAV_ITEM_MAP.get(id)?.href, `door id "${id}" resolves to an href`).toBeTruthy();
    }
  });

  for (const doorId of MOBILE_DOORS) {
    it(`door "${doorId}" degrades honestly (primitive on query-bearing pages)`, () => {
      const href = NAV_ITEM_MAP.get(doorId)!.href;
      for (const file of resolveDoorPageFiles(href)) {
        expect(fs.existsSync(file), `${file} exists`).toBe(true);
        const src = fs.readFileSync(file, "utf8");
        const rel = path.relative(REPO_ROOT, file);

        if (isQueryBearing(src)) {
          expect(
            usesPrimitive(src),
            `${rel} runs queries but never imports @/lib/stale-while-error — ` +
              `a failed refetch over cached data must degrade to the stale chip, not a blank/error swap`,
          ).toBe(true);
          expect(usesErrorSurface(src), `${rel} renders an error surface`).toBe(true);
        } else {
          // Query-less door shell (e.g. the Finance door's tab shell):
          // the pages it lazy-mounts carry the error handling.
          const children = childPageImports(src);
          expect(
            children.length,
            `${rel} has no queries and no lazy child pages — the door would have no error path at all`,
          ).toBeGreaterThan(0);
          const childSrcs = children
            .filter((f) => fs.existsSync(f))
            .map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));
          for (const child of childSrcs) {
            if (isQueryBearing(child.src)) {
              expect(
                usesErrorSurface(child.src),
                `${path.relative(REPO_ROOT, child.f)} (mounted by ${rel}) runs queries with no error surface`,
              ).toBe(true);
            }
          }
          expect(
            childSrcs.some((c) => usesPrimitive(c.src)),
            `no child page of ${rel} uses the stale-while-error primitive`,
          ).toBe(true);
        }
      }
    });
  }
});

// ─── Shared-hook honesty — the swallow-fn side door (fleet-6 verifier catch) ─
//
// The Map door's error honesty was defeated from OUTSIDE the door: shared
// hooks under the same query keys ("/api/properties", "/api/deals") swallowed
// failures into a SUCCESSFUL [] — so whichever consumer mounted first seeded
// the cache with "empty portfolio" during an outage, and the door's error
// card/stale chip never fired. Every queryFn writing a door-shared cache key
// must THROW on !res.ok, never return a fabricated empty success.
describe("shared list hooks throw on failure — no outage-as-empty-portfolio via the cache side door", () => {
  const SHARED_HOOKS = [
    "client/src/hooks/use-properties.ts",
    "client/src/hooks/use-deals.ts",
  ];
  for (const rel of SHARED_HOOKS) {
    it(`${rel} never swallows a failed response into an empty success`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      // Every !res.ok branch in the file must throw…
      const swallows = src.match(/if\s*\(!res(?:ponse)?\.ok\)\s*(?:return|\{\s*return)/g) ?? [];
      expect(
        swallows,
        `${rel} returns a value on !ok — a failed fetch must throw so isError fires on every consumer`,
      ).toHaveLength(0);
      // …and at least one throw-on-!ok exists (the file really fetches).
      expect(src).toMatch(/if\s*\(!res(?:ponse)?\.ok\)\s*(?:\{\s*)?throw/);
    });
  }
});

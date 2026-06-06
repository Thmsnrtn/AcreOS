// @vitest-environment jsdom
/**
 * Tahoe E6 — useUiState hook unit tests.
 *
 * useUiState is the server-backed successor to useLocalStorageState: state
 * follows the user across devices (org_id, user_id, key on the server) while
 * staying snappy via an optimistic localStorage cache + debounced PUT.
 *
 * The repo doesn't ship @testing-library/react, so we drive the hook through
 * a tiny harness using react-dom/client createRoot + act() (the same pattern
 * dock.test.tsx uses), with fetch + the Clerk-session detector mocked.
 *
 * Covered:
 *   1. First paint hydrates synchronously from localStorage (no flash).
 *   2. setValue updates state optimistically AND mirrors to localStorage.
 *   3. setValue debounces a single PUT carrying the final value.
 *   4. Unauthenticated → no network calls (localStorage-only fallback).
 *   5. Server hydration on mount adopts a server value when present.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";

// Mock the Clerk-session detector so we can toggle authed / unauthed.
let authed = true;
vi.mock("../../client/src/lib/clerk-session-detect", () => ({
  hasAnyClerkSession: () => authed,
}));
// Silence the client logger.
vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: () => {}, info: () => {}, error: () => {} },
}));

import { useUiState } from "../../client/src/hooks/use-ui-state";

// ── Harness ────────────────────────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;
let lastValue: unknown;
let lastSetter: ((next: unknown) => void) | null = null;

function Harness<T>({ k, initial }: { k: string; initial: T }) {
  const [value, setValue] = useUiState<T>(k, initial);
  lastValue = value;
  lastSetter = setValue as (next: unknown) => void;
  return null;
}

function mount<T>(k: string, initial: T) {
  act(() => {
    root.render(<Harness k={k} initial={initial} />);
  });
}

beforeEach(() => {
  authed = true;
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  lastValue = undefined;
  lastSetter = null;
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Tahoe E6 — useUiState", () => {
  it("hydrates first paint from localStorage", () => {
    localStorage.setItem("sidebar:collapsed", JSON.stringify(true));
    // No server roundtrip needed for the synchronous initial value.
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    mount("sidebar:collapsed", false);
    expect(lastValue).toBe(true);
  });

  it("optimistically updates state and localStorage, then PUTs once (debounced)", async () => {
    const fetchMock = vi
      .fn()
      // mount hydration GET → 404 (unset on server)
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // the debounced PUT
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    (globalThis as any).fetch = fetchMock;

    mount("pax-rail:open", false);
    expect(lastValue).toBe(false);

    act(() => {
      lastSetter!(true);
      lastSetter!(false);
      lastSetter!(true);
    });

    // Optimistic: state + localStorage update immediately, before any debounce.
    expect(lastValue).toBe(true);
    expect(JSON.parse(localStorage.getItem("pax-rail:open")!)).toBe(true);

    // Only the GET so far — PUT is still debounced.
    const putCallsBefore = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(putCallsBefore.length).toBe(0);

    // Advance past the debounce window → exactly one PUT with the final value.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const putCalls = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0]).toBe("/api/ui-state/pax-rail%3Aopen");
    expect(JSON.parse(putCalls[0][1].body)).toEqual({ value: true });
  });

  it("never hits the network when unauthenticated", async () => {
    authed = false;
    const fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;

    mount("sidebar:collapsed", false);
    act(() => {
      lastSetter!(true);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(lastValue).toBe(true);
    expect(JSON.parse(localStorage.getItem("sidebar:collapsed")!)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adopts the server value on mount when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: "sidebar:collapsed", value: true }),
    });
    (globalThis as any).fetch = fetchMock;

    mount("sidebar:collapsed", false);
    // Let the mount-effect GET resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastValue).toBe(true);
    expect(JSON.parse(localStorage.getItem("sidebar:collapsed")!)).toBe(true);
  });
});

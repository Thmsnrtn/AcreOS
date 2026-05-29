// @vitest-environment jsdom
/**
 * version-check deferred-reload behavior.
 *
 * The version-check module reads `queryClient.isMutating()` before
 * pulling the trigger on `window.location.reload()`. A reload that
 * fires during an in-flight bid POST in CourthouseMode can nuke the
 * mutation mid-air; a non-modal toast tells the user we're waiting,
 * and the reload happens the moment the mutation settles.
 *
 * We test the deferral decision directly by exercising the
 * `attemptReload`-style branch via the module's surface: install the
 * checker, stub a SHA mismatch on /api/version, simulate a mutation in
 * flight, and assert `window.location.reload` did NOT fire on the
 * immediate tick — and DID fire on the next tick once isMutating
 * returned 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mocks so the module under test sees them at import time.
const reloadSpy = vi.fn();
const toastSpy = vi.fn();
const isMutatingSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
}));

vi.mock("@/lib/clientLogger", () => ({
  clientLogger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    isMutating: () => isMutatingSpy(),
  },
}));

describe("version-check deferred reload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reloadSpy.mockReset();
    toastSpy.mockReset();
    isMutatingSpy.mockReset();

    // Stub VITE_GIT_SHA so installVersionCheck() doesn't bail early.
    (import.meta.env as Record<string, string>).VITE_GIT_SHA = "BUNDLED_SHA";

    // /api/version returns a different sha → mismatch path.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ sha: "SERVER_SHA" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    // Stub reload — jsdom's location.reload is read-only, replace the
    // location object outright (jsdom permits this via deleteProperty).
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    // Page must be visible for the check to proceed.
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("defers reload while a mutation is in flight, then reloads once it settles", async () => {
    // First arrange the mutation count: in-flight when first tick fires,
    // quiesced when the re-check fires.
    isMutatingSpy.mockReturnValueOnce(1); // first attempt: busy
    isMutatingSpy.mockReturnValue(0); // every subsequent: quiet

    // Import fresh so the mocked deps are wired up.
    const { installVersionCheck } = await import("../../client/src/lib/version-check");
    installVersionCheck();

    // First check fires 5s after install — drain microtasks so the
    // mocked fetch promise resolves inside the timer callback. This
    // sets firstMismatchAt; the next interval tick will confirm the
    // mismatch and try to reload.
    await vi.advanceTimersByTimeAsync(5_000);

    // Setup the 60s interval is now ticking. First interval fires at
    // t=60000 from install (we're at t=5000). Advance just past it so
    // attemptReload is called exactly once, but stop BEFORE the 5s
    // deferred re-check fires.
    await vi.advanceTimersByTimeAsync(55_500); // t = 60_500

    // attemptReload has fired exactly once. isMutating returned 1, so
    // reload must NOT have fired, and the toast must have surfaced.
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    const toastArg = toastSpy.mock.calls[0][0] as { title: string; description: string };
    expect(toastArg.title.toLowerCase()).toContain("new version");
    expect(toastArg.description.toLowerCase()).toContain("reload");

    // The re-check is scheduled in 5s (at t=65000). Advance past it.
    // isMutating now returns 0, so the reload should fire on that tick.
    await vi.advanceTimersByTimeAsync(5_000); // t = 65_500
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("reloads immediately when no mutation is in flight", async () => {
    isMutatingSpy.mockReturnValue(0);

    const { installVersionCheck } = await import("../../client/src/lib/version-check");
    installVersionCheck();

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

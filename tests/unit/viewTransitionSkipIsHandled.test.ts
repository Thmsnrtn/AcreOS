/**
 * A skipped view transition must not escape as an uncaught page error — and a
 * real failure inside one must still surface.
 *
 * client/src/lib/view-transitions.ts wraps every in-app navigation (patched
 * history.pushState/replaceState) in document.startViewTransition, and used to
 * discard the ViewTransition it got back. When a second navigation starts
 * before the first has animated — a <Redirect> straight after a <Link>, an
 * onboarding step that navigates twice — the browser skips the first
 * transition and rejects its `ready` promise with
 * DOMException(AbortError, "Transition was skipped"). Nobody held the promise,
 * so it was an unhandled rejection: the customer-journey audit recorded
 * "uncaught page errors during journey: Transition was skipped" on every
 * Chromium project it ran (run 39503768857, issue #359).
 *
 * The fake below follows the View Transitions spec's promise semantics, which
 * is what the fix has to be right about:
 *   - skip   → `ready` rejects with the skip reason; the update callback still
 *              runs; `updateCallbackDone` and `finished` fulfil.
 *   - throw  → the update callback's error rejects `updateCallbackDone`,
 *              `ready` and `finished` alike.
 * Each case counts two things: process-level unhandled rejections (what the
 * browser reports as an uncaught page error), and errors re-reported through
 * `reportError` (the browser's uncaught-error path the fix routes real
 * failures to, so they still reach window.onerror / Sentry / pageerror).
 * A skip must produce neither; a real failure must be reported exactly once.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type Mode = "skip-abort" | "skip-invalid-state" | "callback-throws" | "ready-times-out";

function fakeStartViewTransition(mode: Mode) {
  return (update: () => void) => {
    let updateCallbackDone: Promise<void>;
    try {
      if (mode === "callback-throws") throw new TypeError("history.pushState failed");
      update();
      updateCallbackDone = Promise.resolve();
    } catch (e) {
      updateCallbackDone = Promise.reject(e);
    }
    const ready =
      mode === "skip-abort"
        ? Promise.reject(new DOMException("Transition was skipped", "AbortError"))
        : mode === "skip-invalid-state"
          ? Promise.reject(new DOMException("Transition was aborted because of invalid state", "InvalidStateError"))
          : mode === "ready-times-out"
            ? Promise.reject(new DOMException("Transition took too long", "TimeoutError"))
            : updateCallbackDone.then(() => undefined);
    const finished = updateCallbackDone.then(() => undefined);
    return { ready, finished, updateCallbackDone };
  };
}

let unhandled: unknown[] = [];
let reported: unknown[] = [];
let savedListeners: NodeJS.UnhandledRejectionListener[] = [];
const record = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled = [];
  reported = [];
  (globalThis as any).reportError = (e: unknown) => reported.push(e);
  // Count rejections ourselves for the duration of the case (the runner's own
  // listener would fail the file on the "must surface" cases by design).
  savedListeners = process.listeners("unhandledRejection") as NodeJS.UnhandledRejectionListener[];
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", record);
  (globalThis as any).window = { matchMedia: () => ({ matches: false }) };
});

afterEach(() => {
  process.removeListener("unhandledRejection", record);
  for (const l of savedListeners) process.on("unhandledRejection", l);
  delete (globalThis as any).document;
  delete (globalThis as any).window;
  delete (globalThis as any).reportError;
});

async function settle() {
  // Unhandled-rejection detection runs after the microtask queue drains.
  await new Promise((r) => setTimeout(r, 20));
}

async function navigateUnder(mode: Mode) {
  const calls: string[] = [];
  (globalThis as any).document = { startViewTransition: fakeStartViewTransition(mode) };
  const { withViewTransition } = await import("../../client/src/lib/view-transitions");
  withViewTransition(() => calls.push("navigated"));
  await settle();
  return calls;
}

describe("view transitions — a skip is handled, a failure is not hidden", () => {
  it("a skipped transition (AbortError) produces no unhandled rejection, and the navigation still happens", async () => {
    const calls = await navigateUnder("skip-abort");
    expect(calls).toEqual(["navigated"]);
    expect(unhandled).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("Chromium's hidden-document skip (InvalidStateError) is handled the same way", async () => {
    await navigateUnder("skip-invalid-state");
    expect(unhandled).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("an error thrown by the update callback still surfaces — exactly once", async () => {
    await navigateUnder("callback-throws");
    expect(unhandled).toEqual([]);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(TypeError);
  });

  it("a non-skip rejection of `ready` (e.g. a timeout) is not swallowed", async () => {
    await navigateUnder("ready-times-out");
    expect(unhandled).toEqual([]);
    expect(reported).toHaveLength(1);
    expect((reported[0] as DOMException).name).toBe("TimeoutError");
  });

  it("the skip filter matches DOMException names only — never a plain Error that mentions a skip", async () => {
    const { isExpectedTransitionSkip } = await import("../../client/src/lib/view-transitions");
    expect(isExpectedTransitionSkip(new DOMException("Transition was skipped", "AbortError"))).toBe(true);
    expect(isExpectedTransitionSkip(new Error("Transition was skipped"))).toBe(false);
    expect(isExpectedTransitionSkip(new DOMException("x", "TimeoutError"))).toBe(false);
    expect(isExpectedTransitionSkip("AbortError")).toBe(false);
  });
});

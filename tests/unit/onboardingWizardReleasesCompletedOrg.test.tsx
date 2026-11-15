// @vitest-environment jsdom
/**
 * The onboarding wizard releases an already-completed org to /today instead
 * of stranding it on step 1 (onboarding bounce, package 2026-11-05, RC-2).
 *
 * onboarding-v2 already read GET /api/onboarding/status — but only to
 * prefill. A completed user who reached the wizard (a gate bounce, a stale
 * link, a second tab) got step 1 with no way out. It now navigates to /today
 * when that read SETTLES on completed: true.
 *
 * The release must rest on the server's answer, never on timing or on cached
 * data, so the abandonment-resume and Settings re-run paths are pinned too:
 *   - completed: false → the wizard renders step 1 and never navigates;
 *   - a cached pre-reset completed: true (Settings → "Re-run onboarding"
 *     invalidates it, but the wizard mounts before the refetch lands) whose
 *     refetch answers false → never navigates, step 1 renders.
 *
 * Rendered for real: the actual OnboardingV2 page, the app's real
 * QueryClient and default query function, and wouter's memory location
 * (recording every navigation). Only `fetch` is stubbed; the status endpoint
 * is deferred so "the read is still in flight" is a state, not a timing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import OnboardingV2 from "../../client/src/pages/onboarding-v2";
import { queryClient } from "../../client/src/lib/queryClient";
import { AI_DISCLOSURE_VERSION } from "../../client/src/components/onboarding/AiDisclosureDialog";

type Status = { completed: boolean; data?: Record<string, unknown> };

let container: HTMLDivElement;
let root: Root;
let statusWaiters: Array<(s: Status) => void>;
let statusFetches: number;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  statusWaiters = [];
  statusFetches = 0;
  queryClient.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me/ai-disclosure/status")) {
        return json({ disclosed: true, version: AI_DISCLOSURE_VERSION, at: "2026-11-01T00:00:00Z" });
      }
      if (url.includes("/api/onboarding/status")) {
        statusFetches += 1;
        return new Promise<Response>((resolve) => {
          statusWaiters.push((s) => resolve(json(s)));
        });
      }
      if (url.includes("/api/organization")) return json({ name: "Acme Land" });
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

// React Query notifies on a macrotask; fetch resolution + JSON parsing add a
// few more hops. Drain them.
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
};

async function settle(ms = 150) {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, ms));
    await flush();
  });
}

/** Poll (bounded) until `cond` holds — fails rather than hangs. */
async function until(cond: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await act(async () => {
      await flush();
    });
  }
}

// The AI-disclosure read has its own skeleton. Until it settles, step 1 is
// hidden for a reason that has nothing to do with the completion read — so
// "step 1 is not rendered while the status read is pending" only means
// something once disclosure has cleared.
const disclosureSettled = () =>
  queryClient.getQueryState(["/api/me/ai-disclosure/status"])?.status === "success";

async function mountWizard() {
  const loc = memoryLocation({ path: "/onboarding-v2", record: true });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Router hook={loc.hook}>
          <OnboardingV2 />
        </Router>
      </QueryClientProvider>,
    );
    await flush();
  });
  await until(disclosureSettled, "AI-disclosure status to settle");
  // The cache settling is not the page re-rendering: give React real time to
  // commit the post-disclosure render before anything is asserted about it.
  await settle();
  return loc;
}

async function answerStatus(s: Status) {
  const w = statusWaiters.shift();
  if (!w) throw new Error("no /api/onboarding/status read in flight");
  await act(async () => {
    w(s);
    await flush();
  });
  await settle();
}

const step1 = () => container.querySelector('[data-testid="input-org-name"]') !== null;
const wentToToday = (loc: { history?: string[] }) => (loc.history ?? []).includes("/today");

describe("onboarding-v2 — completed org is released, not stranded (RC-2)", () => {
  it("completed: true → navigated to /today; step 1 never renders", async () => {
    const loc = await mountWizard();
    expect(statusFetches).toBe(1);
    // While the read is pending the wizard holds — step 1 must not flash.
    expect(step1()).toBe(false);
    expect(wentToToday(loc)).toBe(false);

    await answerStatus({ completed: true, data: { businessType: "land_flipper" } });

    expect(wentToToday(loc)).toBe(true);
    expect(step1()).toBe(false);
  });

  it("completed: false → the wizard renders step 1 and never navigates (abandonment-resume unharmed)", async () => {
    const loc = await mountWizard();
    await answerStatus({ completed: false, data: {} });

    expect(step1()).toBe(true);
    expect(wentToToday(loc)).toBe(false);
    expect(loc.history).toEqual(["/onboarding-v2"]);
  });

  it("Settings re-run: a cached pre-reset completed: true does not release while the refetch is in flight; the refetch's false runs the wizard", async () => {
    // Settings → "Re-run onboarding": POST /reset has flipped the server flag
    // false, then the client invalidates the status query (inactive → only
    // marked stale; the cache still says completed: true) and navigates here.
    queryClient.setQueryData(["/api/onboarding/status"], { completed: true, data: {} });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    });

    const loc = await mountWizard();
    // The remount refetches; the stale true must not release this user.
    expect(statusFetches).toBe(1);
    expect(wentToToday(loc)).toBe(false);
    expect(step1()).toBe(false);

    await answerStatus({ completed: false, data: { businessType: "land_flipper" } });

    expect(wentToToday(loc)).toBe(false);
    expect(step1()).toBe(true);
  });
});

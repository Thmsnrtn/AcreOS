// @vitest-environment jsdom
/**
 * OnboardingGate must not redirect on a stale cached `needsOnboarding: true`.
 *
 * RC-1 of the onboarding bounce (package 2026-11-05). Every fresh signup's
 * first /today landing caches `{ needsOnboarding: true }`. The wizard
 * invalidates that query when it completes, but the gate is unmounted then,
 * so invalidation only marks the inactive query stale — the cached value
 * stays `true`. When the completion navigation remounts the gate, React
 * Query returns the cached `true` synchronously (data present, isLoading
 * false) while the corrective refetch is in flight, and the pre-fix gate
 * rendered <Redirect to="/onboarding-v2"> from it. A just-completed user
 * could be bounced back into the wizard by that race.
 *
 * Rendered for real: the actual OnboardingGate from App.tsx, a real
 * QueryClient, and wouter's memory location (recording every navigation).
 * Only the network is stubbed — a deferred endpoint whose answer the test
 * releases, so "the refetch is still in flight" is a state, not a timing.
 *
 * Both directions are pinned:
 *   - primed true + invalidated + endpoint now false → no redirect, ever;
 *   - endpoint true with a settled read → must redirect.
 * Plus the preserved behaviours: a fresh (non-invalidated) cached true
 * still redirects immediately, and an endpoint error renders the page.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { OnboardingGate } from "../../client/src/App";

const KEY = ["/api/me/needs-onboarding"] as const;

type Answer = { needsOnboarding: boolean };
type Pending = { resolve: (a: Answer) => void; reject: (e: Error) => void };

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let pending: Pending[];
let fetchCount: number;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Deferred endpoint: every fetch parks until the test answers it.
        queryFn: () =>
          new Promise<Answer>((resolve, reject) => {
            fetchCount += 1;
            pending.push({ resolve, reject });
          }),
      },
    },
  });
}

beforeEach(() => {
  pending = [];
  fetchCount = 0;
  client = makeClient();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
});

function mountGate() {
  const loc = memoryLocation({ path: "/today", record: true });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Router hook={loc.hook}>
          <OnboardingGate>
            <div data-testid="today-page">Today</div>
          </OnboardingGate>
        </Router>
      </QueryClientProvider>,
    );
  });
  return loc;
}

const redirected = (loc: { history?: string[] }) =>
  (loc.history ?? []).includes("/onboarding-v2");
const has = (id: string) => container.querySelector(`[data-testid="${id}"]`) !== null;

// React Query batches observer notifications onto a macrotask
// (notifyManager's default scheduler is setTimeout 0); let it drain.
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
};

async function answer(a: Answer) {
  const p = pending.shift();
  if (!p) throw new Error("no fetch in flight to answer");
  await act(async () => {
    p.resolve(a);
    await flush();
  });
}

async function fail() {
  const p = pending.shift();
  if (!p) throw new Error("no fetch in flight to fail");
  await act(async () => {
    p.reject(new Error("network down"));
    await flush();
  });
}

/** The wizard's onSuccess, run while the gate is NOT mounted. */
async function primeTrueThenInvalidateWhileUnmounted() {
  client.setQueryData(KEY, { needsOnboarding: true });
  await act(async () => {
    await client.invalidateQueries({ queryKey: KEY });
  });
  // Inactive query: invalidation marked it stale but fetched nothing, and
  // the cached value is still the old `true`. This is the RC-1 precondition.
  expect(fetchCount).toBe(0);
  expect(client.getQueryData(KEY)).toEqual({ needsOnboarding: true });
  expect(client.getQueryState(KEY)?.isInvalidated).toBe(true);
}

describe("OnboardingGate — stale cached needsOnboarding:true (RC-1)", () => {
  it("does not redirect from a stale true while the corrective refetch is in flight; renders the page once it says false", async () => {
    await primeTrueThenInvalidateWhileUnmounted();

    const loc = mountGate();

    // The remount kicked off the corrective refetch…
    expect(fetchCount).toBe(1);
    // …and while it is in flight the gate must not act on the stale true.
    expect(redirected(loc)).toBe(false);
    expect(has("app-loading")).toBe(true);
    expect(has("today-page")).toBe(false);

    await answer({ needsOnboarding: false });

    expect(redirected(loc)).toBe(false);
    expect(has("today-page")).toBe(true);
    expect(loc.history).toEqual(["/today"]);
  });

  it("still redirects when the settled read says true (genuinely incomplete org)", async () => {
    const loc = mountGate();
    expect(has("app-loading")).toBe(true);
    expect(redirected(loc)).toBe(false);

    await answer({ needsOnboarding: true });

    expect(redirected(loc)).toBe(true);
  });

  it("still redirects when a stale true is re-confirmed true by the refetch", async () => {
    await primeTrueThenInvalidateWhileUnmounted();
    const loc = mountGate();
    expect(redirected(loc)).toBe(false);

    await answer({ needsOnboarding: true });

    expect(redirected(loc)).toBe(true);
  });

  it("redirects immediately on a fresh (non-invalidated) cached true — no extra loader for the incomplete user", async () => {
    client.setQueryData(KEY, { needsOnboarding: true });
    const loc = mountGate();
    // Fresh within staleTime: no refetch, and the answer is current.
    expect(fetchCount).toBe(0);
    expect(redirected(loc)).toBe(true);
  });
});

describe("OnboardingGate — preserved behaviours", () => {
  it("renders the page (never the wizard) when the endpoint errors", async () => {
    const loc = mountGate();
    await fail();
    expect(redirected(loc)).toBe(false);
    expect(has("today-page")).toBe(true);
  });

  it("renders the page when the stale true's refetch errors (error fall-through wins over stale data)", async () => {
    await primeTrueThenInvalidateWhileUnmounted();
    const loc = mountGate();
    await fail();
    expect(redirected(loc)).toBe(false);
    expect(has("today-page")).toBe(true);
  });

  it("renders the page on a settled false (completed or founder — the server answers false for founders)", async () => {
    const loc = mountGate();
    await answer({ needsOnboarding: false });
    expect(redirected(loc)).toBe(false);
    expect(has("today-page")).toBe(true);
  });
});

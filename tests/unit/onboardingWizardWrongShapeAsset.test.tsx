// @vitest-environment jsdom
/**
 * D-2 regression: a 200 response with the WRONG SHAPE for
 * /onboarding-verticals.json must land the wizard on its visible
 * load-error (role="alert", data-testid="onboarding-verticals-load-error"),
 * never crash the render.
 *
 * Before the cure, the diet's wizard passed any truthy parsed payload to
 * getVerticalOnboarding, which dereferences data.verticals[…] — a `{}`
 * body threw `TypeError: Cannot read properties of undefined (reading
 * 'note_investor')` and white-screened onboarding (CI shard 3/3 +
 * Coverage, PR #716 audit D-2). Malformed JSON was already safe (the
 * loader rejects); a parseable-but-wrong-shape body was not.
 *
 * This suite lives in its own file on purpose: the static-data loader
 * promise-caches per URL for the page session, so the wrong-shape
 * payload must be the FIRST fetch of the asset in this module registry.
 * The harness mirrors onboardingWizardReleasesCompletedOrg.test.tsx.
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

let container: HTMLDivElement;
let root: Root;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  queryClient.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/me/ai-disclosure/status")) {
        return json({ disclosed: true, version: AI_DISCLOSURE_VERSION, at: "2026-11-01T00:00:00Z" });
      }
      if (url.includes("/api/onboarding/status")) {
        return json({ completed: false, data: {} });
      }
      if (url.includes("/api/organization")) return json({ name: "Acme Land" });
      if (url.includes("/onboarding-verticals.json")) {
        // The D-2 payload: HTTP 200, parseable JSON, wrong shape.
        return json({});
      }
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

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
};

async function until(cond: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await act(async () => {
      await flush();
    });
  }
}

const loadError = () =>
  container.querySelector('[data-testid="onboarding-verticals-load-error"]');
const step1 = () => container.querySelector('[data-testid="input-org-name"]') !== null;

describe("onboarding-v2 — wrong-shape asset 200 shows the load error, never crashes (D-2)", () => {
  it("renders role=alert load-error; step 1 never renders; no exception escapes", async () => {
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

    await until(() => loadError() !== null, "onboarding-verticals load error to render");

    expect(loadError()?.getAttribute("role")).toBe("alert");
    expect(loadError()?.textContent).toContain("couldn't load your onboarding guide");
    expect(step1()).toBe(false);
  });
});

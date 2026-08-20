// @vitest-environment jsdom
/**
 * The privacy surface may not claim an outcome the server only QUEUED.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `POST /api/privacy/export` returns **202** with a queue receipt —
 * `{ requestId, status: "queued", eta: "24h", message: "…queued. You will
 * receive an email within 24 hours when it is ready." }`. Settings → Privacy
 * called `res.blob()` on that receipt, saved it as
 * `acreOS-data-export-<date>.json`, and toasted **"Data export downloaded"**.
 * The user got a file named as their personal data that contained a queue
 * receipt — worse than an error, because it is a plausible artefact they may
 * never open.
 *
 * `POST /api/privacy/delete` returns 202 and says, in its own message, *"Your
 * account remains active until then."* The same page toasted **"Account
 * anonymized — Your personal data has been deleted"** and then signed the user
 * out three seconds later: asserting the opposite of what the server said, and
 * then removing the one way they could have checked. Nothing had been deleted —
 * `runErasureStub` in routes-dsar.ts throws and the founder-side fulfilment
 * endpoint returns 501 NOT_IMPLEMENTED, which is honest at that end and was
 * being contradicted at this one.
 *
 * ── WHY THIS TEST MOUNTS THE COMPONENT ──────────────────────────────────────
 * The defect is not a string. It is that a 202 receipt was turned into a file
 * and a completion claim, so the load-bearing assertion is behavioural:
 * `URL.createObjectURL` must never be called, and no `<a download>` may be
 * clicked. Copy is asserted too, but second.
 *
 * The honest version already existed one page over — `pages/privacy-settings.tsx`
 * reads the JSON and toasts "Export queued" / "Deletion queued". This suite
 * pins BOTH surfaces so the two cannot drift apart again, which is how one of
 * them came to be wrong in the first place.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const toasts: Array<{ title?: string; description?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: any) => { toasts.push(t); } }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return { apiRequest, queryClient: new QC() };
});

const { PrivacyDataSettings } = await import("../../client/src/pages/settings/account-sections");

/** The 202 both endpoints actually return. */
const QUEUE_RECEIPT = {
  requestId: "dsar_123",
  status: "queued",
  eta: "24h",
  slaDeadlineAt: "2026-08-21T00:00:00.000Z",
  message: "Your data export request is queued. You will receive an email within 24 hours when it is ready.",
};

let container: HTMLDivElement;
let root: Root;
let createObjectURL: ReturnType<typeof vi.fn>;
let anchorClicks: number;

function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      React.createElement(QueryClientProvider, { client: qc }, node as React.ReactElement),
    );
  });
}

beforeEach(() => {
  toasts.length = 0;
  anchorClicks = 0;
  apiRequest.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  createObjectURL = vi.fn(() => "blob:fake");
  (URL as any).createObjectURL = createObjectURL;
  (URL as any).revokeObjectURL = vi.fn();
  // Any <a> click at all is the download shape; count them rather than
  // inspecting attributes, so a rename of the download attr cannot slip past.
  HTMLAnchorElement.prototype.click = function () { anchorClicks += 1; };

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/privacy/status")) {
      return new Response(JSON.stringify({ deleted: false }), { status: 200 });
    }
    if (String(url).includes("/api/privacy/export")) {
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify(QUEUE_RECEIPT), { status: 202 });
    }
    return new Response("{}", { status: 200 });
  }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function clickTestId(id: string) {
  const el = container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  expect(el, `no element with data-testid="${id}" — the surface changed`).not.toBeNull();
  act(() => { el!.click(); });
}

describe("Settings → Privacy: export is a REQUEST, not a download", () => {
  it("never turns the 202 receipt into a file", async () => {
    mount(React.createElement(PrivacyDataSettings));
    await settle();

    clickTestId("btn-export-data");
    await settle();

    expect(
      createObjectURL,
      "the queue receipt is being saved as the user's data export — this is the defect",
    ).not.toHaveBeenCalled();
    expect(anchorClicks, "a download link was clicked for a queued request").toBe(0);
  });

  it("says the request was queued, not that anything was downloaded", async () => {
    mount(React.createElement(PrivacyDataSettings));
    await settle();
    clickTestId("btn-export-data");
    await settle();

    const said = toasts.map((t) => `${t.title ?? ""} ${t.description ?? ""}`).join(" | ");
    expect(said, `no toast fired at all:\n${said}`).not.toBe("");
    expect(said.toLowerCase()).toContain("queued");
    expect(
      said.toLowerCase(),
      "the surface claims a download that did not happen",
    ).not.toContain("downloaded");
  });

  it("vacuity: the button exists and the request actually went out", async () => {
    // Both assertions above are absence checks. If the click never reached a
    // handler they would pass over a page that does nothing.
    mount(React.createElement(PrivacyDataSettings));
    await settle();
    clickTestId("btn-export-data");
    await settle();
    const calls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes("/api/privacy/export"))).toBe(true);
  });
});

describe("both privacy surfaces agree, in source", () => {
  // The two live surfaces post to the same endpoints: Settings → Privacy
  // (pages/settings/account-sections.tsx) and the /privacy-settings page. One
  // was honest and one was not for as long as both existed, so the rule is
  // pinned across both rather than on the one that was wrong.
  const ROOT = path.resolve(__dirname, "../..");
  const SURFACES = [
    "client/src/pages/settings/account-sections.tsx",
    "client/src/pages/privacy-settings.tsx",
  ];
  // COMMENTS STRIPPED, and the first draft of this file needed it: both source
  // cases below failed on the fix's OWN comments, which quote the old strings
  // ("Account anonymized", "res.blob()") to explain what went wrong. That is
  // cross-pollination ledger 35's defect — a scanner reading prose as code —
  // reproduced by me inside a test about honesty, hours after extracting the
  // stripper that prevents it. Left recorded rather than quietly fixed.
  const read = (rel: string) =>
    stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  it("neither claims a completed deletion", () => {
    for (const rel of SURFACES) {
      const src = read(rel);
      expect(src, `${rel} still calls the privacy endpoints`).toContain("/api/privacy/delete");
      expect(
        /has been deleted|Account anonymized/i.test(src),
        `${rel} tells the user their data is deleted. The server returns 202 and ` +
          `says the account remains active; the erasure fulfiller is a stub that ` +
          `throws.`,
      ).toBe(false);
    }
  });

  it("neither downloads a blob from a privacy endpoint", () => {
    for (const rel of SURFACES) {
      const src = read(rel);
      const privacyBlock = src.slice(src.indexOf("/api/privacy/export"));
      expect(
        privacyBlock.slice(0, 1200),
        `${rel} calls res.blob() on the export endpoint, which returns a 202 receipt`,
      ).not.toContain(".blob()");
    }
  });

  it("vacuity: both files were found and both are the surfaces they claim to be", () => {
    for (const rel of SURFACES) {
      const src = read(rel);
      expect(src.length, `${rel} is empty`).toBeGreaterThan(1000);
      expect(src).toContain("/api/privacy/export");
    }
  });
});

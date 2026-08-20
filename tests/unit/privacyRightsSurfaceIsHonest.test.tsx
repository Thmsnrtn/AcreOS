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
 * reads the JSON and toasts "Export queued" / "Deletion queued".
 *
 * ── AND THEN THE COPY WAS REMOVED ───────────────────────────────────────────
 * The first fix made the two agree. On 2026-08-20 the duplicate went away
 * entirely: Settings now renders the same `PrivacyDataRights` component the
 * `/settings/privacy` route does. Two implementations of a legally consequential
 * control is the CONDITION that produced the lie, and "keep them in sync" is a
 * promise nobody keeps — the block at the bottom of this file used to be called
 * "both privacy surfaces agree, in source" and passed throughout the period one
 * of them was lying.
 *
 * The behavioural cases below still mount through `PrivacyDataSettings`, which
 * is the Settings entry point — so they now exercise the CANONICAL component
 * rather than a copy of it, and the test id they click changed from
 * `btn-export-data` to `button-export-data` for exactly that reason. Two spellings
 * of one control is what a duplicate looks like from the outside.
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
  // A FRESH Response per call, not mockResolvedValue: `res.json()` consumes the
  // body, so one shared Response makes the second call throw and the test would
  // then be asserting on an error path it never meant to exercise.
  //
  // And it resolves a REAL Response rather than a bare object, so the
  // component's own `res.ok` / `res.json()` parsing actually runs. A mock
  // resolving `undefined` — which is what this was before the canonical
  // component came into scope — makes the suite agree with any implementation,
  // including one that never reads the body at all. That exact shape is on the
  // record in CLAUDE.md as a nudger mock that certified a status it never read.
  apiRequest.mockImplementation(
    async () => new Response(JSON.stringify(QUEUE_RECEIPT), { status: 202 }),
  );
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

    clickTestId("button-export-data");
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
    clickTestId("button-export-data");
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
    //
    // Asserted on `apiRequest`, not `fetch`: the canonical component posts
    // through the shared client. The deleted duplicate used a bare `fetch` —
    // one more way the two differed while a test titled "both surfaces agree"
    // was passing.
    mount(React.createElement(PrivacyDataSettings));
    await settle();
    clickTestId("button-export-data");
    await settle();
    const posted = apiRequest.mock.calls.map((c: unknown[]) => `${c[0]} ${c[1]}`);
    expect(
      posted.some((c) => c === "POST /api/privacy/export"),
      `the export click never reached the transport. Calls seen: ${JSON.stringify(posted)}`,
    ).toBe(true);
  });
});

describe("there is ONE privacy surface, so there is nothing to keep in sync", () => {
  // ── REWRITTEN 2026-08-20, NOT DELETED ─────────────────────────────────────
  // This block was titled "both privacy surfaces agree, in source" and checked
  // that two near-identical implementations of the same GDPR controls made the
  // same claims. It passed for as long as both existed, and one of them was
  // lying the whole time — because agreeing-in-source is a CHORE, and a chore
  // fails the first time someone edits one copy.
  //
  // The duplicate is gone: `PrivacyDataSettings` now renders the same
  // `PrivacyDataRights` component the `/settings/privacy` route renders. The
  // original invariant survives, stated as a property instead of a chore —
  // there is one implementation, so the two surfaces cannot disagree.
  const ROOT = path.resolve(__dirname, "../..");
  const CANONICAL = "client/src/pages/privacy-settings.tsx";
  const SECTION = "client/src/pages/settings/account-sections.tsx";

  // COMMENTS STRIPPED, and the first draft of this file needed it: the source
  // cases below failed on the fix's OWN comments, which quote the old strings
  // ("Account anonymized", "res.blob()") to explain what went wrong. That is
  // cross-pollination ledger 35's defect — a scanner reading prose as code —
  // reproduced inside a test about honesty, hours after extracting the stripper
  // that prevents it. Left recorded rather than quietly fixed, and it matters
  // more now: the docblocks explaining this deduplication quote both strings.
  const read = (rel: string) =>
    stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  it("the canonical surface does not claim a completed deletion", () => {
    const src = read(CANONICAL);
    expect(src, "the canonical surface stopped calling the privacy endpoints").toContain(
      "/api/privacy/delete",
    );
    expect(
      /has been deleted|Account anonymized/i.test(src),
      "the canonical surface tells the user their data is deleted. The server " +
        "returns 202 and says the account remains active; the erasure fulfiller " +
        "is a stub that throws.",
    ).toBe(false);
  });

  it("the canonical surface does not download a blob from a privacy endpoint", () => {
    const src = read(CANONICAL);
    const privacyBlock = src.slice(src.indexOf("/api/privacy/export"));
    expect(
      privacyBlock.slice(0, 1200),
      "the canonical surface calls res.blob() on the export endpoint, which " +
        "returns a 202 receipt",
    ).not.toContain(".blob()");
  });

  it("Settings holds NO second implementation — it renders the canonical one", () => {
    // The property that replaced the chore. If Settings ever grows its own
    // fetch/mutation against these endpoints again, the two can disagree again,
    // and the last time they did the user got a queue receipt saved as a file
    // named after their personal data.
    const section = read(SECTION);
    expect(
      section,
      "Settings no longer renders the canonical privacy component",
    ).toContain("PrivacyDataRights");
    for (const endpoint of ["/api/privacy/export", "/api/privacy/delete", "/api/privacy/status"]) {
      expect(
        section,
        `Settings talks to ${endpoint} directly again — that is a second ` +
          `implementation of a GDPR control, which is the condition that produced ` +
          `the defect this file exists for, not the accident.`,
      ).not.toContain(endpoint);
    }
    expect(
      /useMutation|apiRequest\s*\(/.test(section),
      "Settings grew its own mutation back",
    ).toBe(false);
  });

  it("the canonical component is the one BOTH mount points use", () => {
    const canonical = read(CANONICAL);
    // Exported for reuse, and the route is a thin wrapper over it — so the page
    // and the section cannot diverge even in chrome-adjacent behaviour.
    expect(canonical).toContain("export function PrivacyDataRights");
    expect(canonical).toContain("export default function PrivacySettingsPage");
    const pageFn = canonical.slice(canonical.indexOf("export default function PrivacySettingsPage"));
    expect(
      pageFn,
      "the route stopped delegating to the shared component",
    ).toContain("<PrivacyDataRights");
  });

  it("vacuity: the canonical file is real and is the surface it claims to be", () => {
    // Every assertion above is a `not.toContain` over `account-sections.tsx` or
    // a `toContain` over one file. If the canonical file were empty or renamed,
    // several would pass for the wrong reason.
    const src = read(CANONICAL);
    expect(src.length, `${CANONICAL} is empty`).toBeGreaterThan(1000);
    expect(src).toContain("/api/privacy/export");
    expect(src).toContain("/api/privacy/delete");
    const section = read(SECTION);
    expect(section.length, `${SECTION} is empty`).toBeGreaterThan(500);
  });
});

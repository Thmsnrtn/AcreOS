// @vitest-environment jsdom
/**
 * W10.3 audit fixes 2 + 15 — the list builder's transport.
 *
 *  - Preview and commit read a county's GIS service page by page, which can
 *    outlast the app-wide 30s ceiling; they get a longer per-call timeout
 *    (`ApiRequestOptions.timeoutMs`), and every other request keeps the default.
 *  - The sheet renders 400/409/422/429 inline in the server's words, so the
 *    GLOBAL mutation-error toast (queryClient's MutationCache.onError) stays
 *    quiet for exactly those — and still fires for a 502, a network failure,
 *    or a mutation that never opted in.
 *
 * The real `queryClient` (with its real MutationCache handler) is used; only
 * `fetch` and the toast sink are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";

vi.mock("../../client/src/lib/clientLogger", () => ({
  clientLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const TOAST = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("../../client/src/hooks/use-toast", () => ({
  toast: (arg: unknown) => {
    TOAST.calls.push(arg);
    return { id: "t", dismiss: () => {}, update: () => {} };
  },
  useToast: () => ({ toast: () => {}, toasts: [], dismiss: () => {} }),
}));

import { apiRequest, queryClient } from "../../client/src/lib/queryClient";
import {
  LIST_BUILDER_INLINE_STATUSES,
  LIST_BUILDER_TIMEOUT_MS,
  useListBuilderCommit,
  useListBuilderPreview,
} from "../../client/src/hooks/use-list-builder";

const REPLY = { status: 200, body: {} as unknown, network: false };
let timeoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  TOAST.calls = [];
  REPLY.status = 200;
  REPLY.body = {};
  REPLY.network = false;
  timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  globalThis.fetch = vi.fn(async () => {
    if (REPLY.network) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(REPLY.body), { status: REPLY.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  timeoutSpy.mockRestore();
  queryClient.clear();
});

describe("per-request timeout", () => {
  it("defaults to the 30s ceiling, unchanged", async () => {
    await apiRequest("GET", "/api/anything");
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it("honours timeoutMs when a caller passes one", async () => {
    await apiRequest("POST", "/api/anything", { a: 1 }, { timeoutMs: 95_000 });
    expect(timeoutSpy).toHaveBeenCalledWith(95_000);
    expect(timeoutSpy).not.toHaveBeenCalledWith(30_000);
  });
});

// ── hooks under the real queryClient ────────────────────────────────

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

type Fire = () => void;
const HANDLE: { fire: Fire | null } = { fire: null };

function PreviewProbe() {
  const m = useListBuilderPreview();
  HANDLE.fire = () => m.mutate({ state: "AZ", county: "Coconino" });
  return null;
}
function CommitProbe() {
  const m = useListBuilderCommit();
  HANDLE.fire = () => m.mutate({ body: { state: "AZ", county: "Coconino", name: "x", expectedCount: 3 }, previewNonce: "n-1" });
  return null;
}
/** A mutation that did NOT opt in — the global toast must still fire for it. */
function PlainProbe() {
  const m = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/plain", {})).json(),
  });
  HANDLE.fire = () => m.mutate();
  return null;
}

async function fireWith(Probe: React.FC) {
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Probe)));
  });
  await act(async () => HANDLE.fire!());
  await flush();
}

const err = (status: number, error = "X") => ({ error, message: `server says ${status}`, statusCode: status });

describe("list builder calls get the longer timeout", () => {
  it.each([
    ["preview", PreviewProbe],
    ["commit", CommitProbe],
  ] as const)("%s", async (_l, Probe) => {
    REPLY.body = { listId: 1, created: 1, linkedExisting: 0, total: 1 };
    await fireWith(Probe);
    expect(LIST_BUILDER_TIMEOUT_MS).toBeGreaterThan(30_000);
    expect(timeoutSpy).toHaveBeenCalledWith(LIST_BUILDER_TIMEOUT_MS);
    expect(timeoutSpy).not.toHaveBeenCalledWith(30_000);
  });
});

describe("the global mutation-error toast", () => {
  it("is the set the sheet renders inline — no more, no less", () => {
    expect([...LIST_BUILDER_INLINE_STATUSES].sort()).toEqual([400, 403, 409, 422, 429]);
  });

  for (const [label, Probe] of [
    ["preview", PreviewProbe],
    ["commit", CommitProbe],
  ] as const) {
    // 403: a member without canImportData / deal_write — the sheet renders the
    // server's refusal inline (commit-error / preview-bad-request), so a toast
    // would say it twice (W10.3 second audit, finding 10).
    it.each([400, 403, 409, 422, 429])(`${label}: stays quiet for an inline-rendered %i`, async (status) => {
      REPLY.status = status;
      REPLY.body = err(status);
      await fireWith(Probe);
      expect(TOAST.calls).toHaveLength(0);
    });

    it(`${label}: still toasts a 502 and a network failure`, async () => {
      REPLY.status = 502;
      REPLY.body = err(502, "COUNTY_SOURCE_FAILED");
      await fireWith(Probe);
      expect(TOAST.calls.length).toBeGreaterThan(0);

      TOAST.calls = [];
      act(() => root.unmount());
      root = createRoot(container);
      REPLY.network = true;
      await fireWith(Probe);
      expect(TOAST.calls.length).toBeGreaterThan(0);
    });
  }

  it("still toasts a 409 for a mutation that did not opt in (the suppression is opt-in, not global)", async () => {
    REPLY.status = 409;
    REPLY.body = err(409);
    await fireWith(PlainProbe);
    expect(TOAST.calls.length).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom
/**
 * PKG-1 §6 — DsarSubjectActions render states (founder DSAR tab).
 *
 * Mounts the real component (react-dom/client + act, no @testing-library —
 * the repo idiom, see growthWorkspace.test.tsx) with fetch stubbed per URL.
 * Dialog content renders in a Radix portal, so queries read document.body.
 *
 * The posture statement is imported, never retyped: the assertion is that
 * the UI renders the ONE named string verbatim.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toast: vi.fn(), onChanged: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));

import { DSAR_IDENTITY_POSTURE } from "@shared/privacy/dsarIdentityPosture";
import { DsarSubjectActions } from "../../client/src/components/founder/DsarSubjectActions";

type Route = { status: number; body: unknown };
type Call = { url: string; method: string; body: any };

let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
let calls: Call[];
let routes: Record<string, Route>;

const RECORD_ID = "dsar-rec-1";
const EMAIL = "person@example.test";

function installFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const route = routes[`${method} ${url}`];
      if (!route) return new Response(JSON.stringify({ error: "NOT_FOUND", message: "unrouted" }), { status: 404 });
      return new Response(JSON.stringify(route.body), {
        status: route.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function candidates(leads: Array<{ organizationId: number; leadId: number; isBorrower: boolean; erased: boolean }>, users: any[] = []) {
  return {
    status: 200,
    body: { dsarId: RECORD_ID, requestType: "erasure", verified: true, posture: DSAR_IDENTITY_POSTURE.id, users, leads },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Radix primitives may measure elements; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  routes = {
    [`GET /api/founder/dsar/${RECORD_ID}/subject-candidates`]: candidates([
      { organizationId: 3, leadId: 7, isBorrower: false, erased: false },
    ]),
  };
  installFetch();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  qc.clear();
  container.remove();
});

async function flush() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function mount(record: { requestType: string; requesterIdentityVerified: boolean }) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <DsarSubjectActions
          record={{ id: RECORD_ID, requesterEmail: EMAIL, ...record }}
          csrf={() => ({ "Content-Type": "application/json", "x-csrf-token": "t" })}
          onChanged={h.onChanged}
        />
      </QueryClientProvider>,
    ),
  );
  await flush();
}

function q<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`);
}

async function click(el: HTMLElement | null) {
  expect(el, "element to click must exist").not.toBeNull();
  await act(async () => {
    el!.click();
  });
  await flush();
}

async function type(el: HTMLInputElement | null, value: string) {
  expect(el, "input must exist").not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openPanel() {
  await click(q(`button-dsar-subject-actions-${RECORD_ID}`));
  expect(q("dsar-subject-actions"), "panel opened").not.toBeNull();
}

async function openEraseConfirm(candidateKey: string) {
  await openPanel();
  await click(q(`radio-dsar-candidate-${candidateKey}`));
  const erase = q<HTMLButtonElement>("button-dsar-erase");
  expect(erase?.disabled, "erase enabled once verified + subject picked").toBe(false);
  await click(erase);
  expect(q("dsar-erase-confirm"), "confirm dialog opened").not.toBeNull();
}

describe("DsarSubjectActions", () => {
  it("renders the identity posture statement verbatim from the shared constant", async () => {
    await mount({ requestType: "access", requesterIdentityVerified: false });
    await openPanel();
    const statement = q("dsar-posture-statement");
    expect(statement?.textContent).toBe(DSAR_IDENTITY_POSTURE.statement);
    expect(document.body.textContent).toContain(DSAR_IDENTITY_POSTURE.statement);
  });

  it("fires no fetch on mount, and only subject-candidates when the panel opens", async () => {
    await mount({ requestType: "access", requesterIdentityVerified: false });
    expect(calls).toEqual([]);
    await openPanel();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ method: "GET", url: `/api/founder/dsar/${RECORD_ID}/subject-candidates` });
  });

  it("while unverified: shows the verify section and disables Export and Erase with the reason", async () => {
    await mount({ requestType: "erasure", requesterIdentityVerified: false });
    await openPanel();
    expect(q("dsar-verify-section")).not.toBeNull();
    // A subject is picked, so the ONLY thing blocking is verification.
    await click(q("radio-dsar-candidate-lead:3:7"));

    const exp = q<HTMLButtonElement>("button-dsar-export")!;
    const erase = q<HTMLButtonElement>("button-dsar-erase")!;
    expect(exp.disabled).toBe(true);
    expect(erase.disabled).toBe(true);
    expect(q("dsar-export-reason")?.textContent).toBe("Verify the requester's identity first.");
    expect(q("dsar-erase-reason")?.textContent).toBe("Verify the requester's identity first.");
    // The reason is tied to the control, not just nearby.
    expect(document.getElementById(erase.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Verify the requester's identity first.",
    );
    // The verify submit stays disabled until a method AND enough evidence.
    expect(q<HTMLButtonElement>("button-dsar-verify")!.disabled).toBe(true);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("shows an already-erased candidate as a disabled option", async () => {
    routes[`GET /api/founder/dsar/${RECORD_ID}/subject-candidates`] = candidates([
      { organizationId: 3, leadId: 9, isBorrower: false, erased: true },
    ]);
    await mount({ requestType: "erasure", requesterIdentityVerified: true });
    await openPanel();
    const radio = q<HTMLButtonElement>("radio-dsar-candidate-lead:3:9")!;
    expect(radio.disabled).toBe(true);
    expect(document.body.textContent).toContain("already erased");
  });

  it("keeps the erase confirm button disabled until ERASE is typed exactly", async () => {
    await mount({ requestType: "erasure", requesterIdentityVerified: true });
    await openEraseConfirm("lead:3:7");
    const confirm = () => q<HTMLButtonElement>("button-dsar-erase-confirm")!;
    const input = q<HTMLInputElement>("input-dsar-erase-confirm");
    expect(confirm().disabled).toBe(true);
    await type(input, "erase");
    expect(confirm().disabled).toBe(true);
    await type(input, "ERAS");
    expect(confirm().disabled).toBe(true);
    await type(input, "ERASE");
    expect(confirm().disabled).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/execute-erasure"))).toBe(false);
  });

  it("renders a 423 legal hold naming the caseRef", async () => {
    routes[`POST /api/founder/dsar/${RECORD_ID}/execute-erasure`] = {
      status: 423,
      body: {
        error: "LEGAL_HOLD_ACTIVE",
        message: "Legal hold CASE-2026-HOLD-42 (hold-9) prevents deletion of lead:7 for org 3.",
        details: { reason: "LEGAL_HOLD_ACTIVE", organizationId: 3, holdId: "hold-9", caseRef: "CASE-2026-HOLD-42", scope: "org_wide" },
        statusCode: 423,
      },
    };
    await mount({ requestType: "erasure", requesterIdentityVerified: true });
    await openEraseConfirm("lead:3:7");
    await type(q<HTMLInputElement>("input-dsar-erase-confirm"), "ERASE");
    await click(q("button-dsar-erase-confirm"));

    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ subject: { kind: "lead", organizationId: 3, leadId: 7 }, confirm: "ERASE" });
    const panel = q("dsar-outcome-hold");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Legal hold CASE-2026-HOLD-42 blocks erasure — release the hold first.");
    expect(h.onChanged).not.toHaveBeenCalled();
  });

  it("renders the note ids of a RETENTION_REQUIRED_LOAN_RECORDS refusal", async () => {
    routes[`GET /api/founder/dsar/${RECORD_ID}/subject-candidates`] = candidates([
      { organizationId: 3, leadId: 8, isBorrower: true, erased: false },
    ]);
    routes[`POST /api/founder/dsar/${RECORD_ID}/execute-erasure`] = {
      status: 422,
      body: {
        error: "UNPROCESSABLE",
        message: "This person is the borrower on note(s) #101, #102 — erasure is refused.",
        details: { reason: "RETENTION_REQUIRED_LOAN_RECORDS", noteIds: [101, 102] },
        statusCode: 422,
      },
    };
    await mount({ requestType: "erasure", requesterIdentityVerified: true });
    await openEraseConfirm("lead:3:8");
    // Borrower pre-warning shows before submit (S-1).
    expect(q("dsar-confirm-borrower-warning")).not.toBeNull();
    await type(q<HTMLInputElement>("input-dsar-erase-confirm"), "ERASE");
    await click(q("button-dsar-erase-confirm"));

    const panel = q("dsar-outcome-retention");
    expect(panel).not.toBeNull();
    expect(q("dsar-retention-note-ids")?.textContent).toBe("#101, #102");
    expect(q("button-dsar-export-instead")).not.toBeNull();
  });
});

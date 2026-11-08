// @vitest-environment jsdom
/**
 * The team-invite card says only what the server reported.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Creating an invite sent no email, yet the card described itself as sending
 * "an invitation by email" and the success toast pointed at a "Copy link"
 * button the pending list could never render (list rows carry no link).
 *
 * Pinned per outcome, through the real component: emailed, not configured,
 * suppressed, failed, mixed, and the "New link" / "Resend email" row actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const API = vi.hoisted(() => ({
  create: [] as Array<{ id: number; email: string; expiresAt: string; link: string; delivery: string }>,
  regen: null as null | { id: number; email: string; link: string; delivery: string | null },
  calls: [] as Array<{ method: string; url: string; body: unknown }>,
  pending: [] as Array<Record<string, unknown>>,
}));
vi.mock("../../client/src/lib/queryClient", () => {
  class ApiError extends Error {
    refusal?: unknown;
  }
  return {
    ApiError,
    apiRequest: vi.fn(async (method: string, url: string, body?: unknown) => {
      API.calls.push({ method, url, body });
      if (url.endsWith("/regenerate")) return { json: async () => ({ invitation: API.regen }) };
      if (method === "POST") return { json: async () => ({ created: API.create.length, invitations: API.create }) };
      return { json: async () => ({}) };
    }),
  };
});
const TOASTS = vi.hoisted(() => ({ list: [] as Array<{ title?: string; description?: string; variant?: string }> }));
vi.mock("../../client/src/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; description?: string }) => TOASTS.list.push(t) }),
}));

import { TeamInviteCard } from "../../client/src/components/settings/TeamInviteCard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  API.create = [];
  API.regen = null;
  API.calls = [];
  API.pending = [];
  TOASTS.list.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: Infinity },
    },
  });
  // Seed the list the card reads; the card's own query then serves it.
  client.setQueryData(["/api/organization/invitations"], { invitations: API.pending });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(TeamInviteCard)));
    for (let i = 0; i < 5; i++) await tick();
  });
}

async function invite(email: string) {
  const input = container.querySelector('[data-testid="input-invite-email"]') as HTMLInputElement;
  expect(input, "vacuity: the invite form did not render").not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    (input.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    await tick();
  });
}

const created = (id: number, email: string, delivery: string) => ({
  id,
  email,
  expiresAt: "2030-01-01T00:00:00Z",
  link: `https://app.example/auth?invite=tok${id}`,
  delivery,
});
const panel = () => container.querySelector('[data-testid="panel-share-links"]');

describe("the card's standing copy", () => {
  it("does not promise email unconditionally", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toMatch(/when email delivery is set up/);
    expect(text).toMatch(/link to send them yourself/);
    expect(text).not.toMatch(/Send an invitation by email/);
  });
});

describe("outcome after creating an invite", () => {
  it("emailed: says emailed, shows no link panel", async () => {
    API.create = [created(1, "a@example.com", "sent")];
    await mount();
    await invite("a@example.com");
    expect(TOASTS.list.at(-1)!.title).toBe("Invitation emailed");
    expect(panel()).toBeNull();
  });

  it.each([
    ["not_configured", /email delivery isn't set up on this server/],
    ["suppressed", /AcreOS can't email this address/],
    ["failed", /sending failed/],
  ])("%s: says not emailed and offers the link to copy", async (delivery, line) => {
    API.create = [created(2, "b@example.com", delivery)];
    await mount();
    await invite("b@example.com");
    const toast = TOASTS.list.at(-1)!;
    expect(toast.title).toBe("Invitation created, not emailed");
    expect(toast.title).not.toBe("Invitation emailed");
    expect(toast.description).toMatch(/send it yourself/);
    const p = panel();
    expect(p, "the link panel must appear when nothing was emailed").not.toBeNull();
    expect(p!.textContent).toMatch(line);
    expect(p!.textContent).toMatch(/Not emailed/);
    expect(p!.textContent).toContain("b@example.com");
    expect(p!.textContent).toMatch(/Copy link/);
  });

  it("mixed batch: counts both and lists only the ones not emailed", async () => {
    API.create = [created(3, "ok@example.com", "sent"), created(4, "no@example.com", "failed")];
    await mount();
    await invite("ok@example.com");
    expect(TOASTS.list.at(-1)!.title).toBe("1 emailed, 1 not emailed");
    expect(panel()!.textContent).toContain("no@example.com");
    expect(panel()!.textContent).not.toContain("ok@example.com");
  });

  it("never points at a Copy link control in the pending list", async () => {
    API.create = [created(5, "c@example.com", "sent")];
    await mount();
    await invite("c@example.com");
    expect(JSON.stringify(TOASTS.list)).not.toMatch(/pending list/);
  });
});

describe("pending row actions", () => {
  const row = { id: 9, email: "p@example.com", role: "member", status: "pending", createdAt: "2030-01-01T00:00:00Z", expiresAt: "2999-01-01T00:00:00Z" };

  it("Resend email asks the server to email, and a sent result says the old link stopped", async () => {
    API.pending = [row];
    API.regen = { id: 9, email: "p@example.com", link: "https://app.example/auth?invite=new", delivery: "sent" };
    await mount();
    const btn = container.querySelector('[data-testid="button-resend-9"]') as HTMLButtonElement;
    expect(btn, "Resend email must render for a pending invite").not.toBeNull();
    await act(async () => {
      btn.click();
      await tick();
      await tick();
    });
    const call = API.calls.find((c) => c.url.endsWith("/9/regenerate"))!;
    expect(call.body).toEqual({ sendEmail: true });
    const toast = TOASTS.list.at(-1)!;
    expect(toast.title).toBe("Email sent with a new link");
    expect(toast.description).toMatch(/previous link no longer works/);
    expect(panel()).toBeNull();
  });

  it("New link does not email, and says so", async () => {
    API.pending = [row];
    API.regen = { id: 9, email: "p@example.com", link: "https://app.example/auth?invite=new", delivery: null };
    await mount();
    await act(async () => {
      (container.querySelector('[data-testid="button-newlink-9"]') as HTMLButtonElement).click();
      await tick();
      await tick();
    });
    expect(API.calls.find((c) => c.url.endsWith("/9/regenerate"))!.body).toEqual({ sendEmail: false });
    expect(TOASTS.list.at(-1)!.title).toBe("New link ready");
    expect(panel()!.textContent).toMatch(/Nothing was emailed/);
  });

  it("Resend that could not email falls back to the link, not a success claim", async () => {
    API.pending = [row];
    API.regen = { id: 9, email: "p@example.com", link: "https://app.example/auth?invite=new", delivery: "not_configured" };
    await mount();
    await act(async () => {
      (container.querySelector('[data-testid="button-resend-9"]') as HTMLButtonElement).click();
      await tick();
      await tick();
    });
    expect(TOASTS.list.at(-1)!.title).toBe("New link ready, not emailed");
    expect(panel()!.textContent).toMatch(/Not emailed/);
  });

  it("an invite past its expiry is labelled Expired", async () => {
    API.pending = [{ ...row, expiresAt: "2000-01-01T00:00:00Z" }];
    await mount();
    expect(container.querySelector('[data-testid="row-invite-9"]')!.textContent).toMatch(/Expired/);
  });
});

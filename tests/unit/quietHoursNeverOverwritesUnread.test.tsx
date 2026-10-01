// @vitest-environment jsdom
/**
 * Roadmap W10.1 (empty-on-failure) — quiet hours are never edited from a
 * value that was not read.
 *
 * On a failed read the card showed the defaults ("off") as the user's saved
 * setting, and the first toggle PATCHed those defaults over the window they
 * had saved. Quiet hours suppress outbound contact, so that silently switched
 * a compliance preference off. Now the controls stay disabled until the read
 * succeeds, and a failed read says so with a retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const S = vi.hoisted(() => ({ prefsStatus: 500, patches: 0 }));
vi.mock("../../client/src/lib/queryClient", () => ({
  apiRequest: async () => {
    S.patches++;
    return new Response("{}", { status: 200 });
  },
}));

import { NotificationQuietHours } from "../../client/src/components/settings/notification-quiet-hours";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  S.prefsStatus = 500;
  S.patches = 0;
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ notificationQuietHours: { enabled: true, startHour: 21, endHour: 7 } }), {
      status: S.prefsStatus,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const toggle = () => host.querySelector<HTMLButtonElement>('[data-testid="switch-quiet-hours"]')!;

describe("quiet hours after a failed read", () => {
  it("shows the failure, keeps the controls disabled, and writes nothing", async () => {
    act(() => root.render(React.createElement(NotificationQuietHours)));
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/Couldn.t load your saved quiet hours/);
    expect(toggle().disabled).toBe(true);
    act(() => toggle().click());
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(S.patches).toBe(0);
  });

  it("retry reads again, and a successful read shows the saved window, editable", async () => {
    act(() => root.render(React.createElement(NotificationQuietHours)));
    await settle();
    S.prefsStatus = 200;
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="button-quiet-hours-retry"]')!.click());
    await settle();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(toggle().disabled).toBe(false);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });
});

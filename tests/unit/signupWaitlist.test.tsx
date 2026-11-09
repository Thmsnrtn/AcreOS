// @vitest-environment jsdom
/**
 * Signup trim (W1.4): the waitlist rows. Twelve rows, none of them a radio; a
 * row says "on the list" only after the server confirmed the save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Home } from "lucide-react";

const apiRequestSpy = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...a: unknown[]) => apiRequestSpy(...a) }));

import { SignupWaitlist } from "../../client/src/components/onboarding/SignupWaitlist";
import { SIGNUP_OPEN_BUSINESS_TYPES } from "@shared/business-types/signupTrim";
import { BUSINESS_TYPES } from "@shared/models/persona-mapping";
const SIGNUP_WAITLIST_BUSINESS_TYPES = BUSINESS_TYPES.filter((t) => !SIGNUP_OPEN_BUSINESS_TYPES.includes(t));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const choices = SIGNUP_WAITLIST_BUSINESS_TYPES.map((v) => ({ value: v, label: `Label ${v}`, description: "d", icon: Home }));

let root: Root; let el: HTMLElement;
beforeEach(() => {
  apiRequestSpy.mockReset();
  el = document.createElement("div"); document.body.appendChild(el);
  root = createRoot(el);
  act(() => { root.render(<SignupWaitlist choices={choices} />); });
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const click = async (id: string) => {
  await act(async () => { (el.querySelector(`[data-testid="${id}"]`) as HTMLElement).click(); });
};

describe("SignupWaitlist", () => {
  it("offers a labelled waitlist button for each of the twelve and no radio", () => {
    expect(el.querySelectorAll("li")).toHaveLength(12);
    expect(el.querySelectorAll('[role="radio"], input[type="radio"]')).toHaveLength(0);
    expect(el.querySelectorAll("button[aria-label^='Tell me when']")).toHaveLength(12);
  });
  it("confirms only after the server said ok", async () => {
    apiRequestSpy.mockResolvedValue({ ok: true });
    await click("button-waitlist-developer");
    expect(apiRequestSpy).toHaveBeenCalledWith("POST", "/api/onboarding/waitlist", { type: "developer" });
    expect(el.querySelector('[data-testid="waitlist-done-developer"]')?.textContent).toContain("We'll tell you when Label developer opens");
  });
  it("says it could not save when the server refused, and does not claim the list", async () => {
    apiRequestSpy.mockResolvedValue({ ok: false });
    await click("button-waitlist-developer");
    expect(el.querySelector('[data-testid="waitlist-error-developer"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="waitlist-done-developer"]')).toBeNull();
  });
});

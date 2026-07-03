/**
 * TTFM North-Star companion (2026-07-03): first_seller_response is the
 * funnel's magic-moment event — a seller answered the org's outreach.
 * The founder funnel pads its step list from ACTIVATION_EVENTS, so canon
 * membership IS the surface contract; this guards against accidental
 * removal during future funnel edits.
 */
import { describe, it, expect } from "vitest";
import { ACTIVATION_EVENTS } from "../../shared/schema";

describe("first_seller_response activation event", () => {
  it("is in the canonical event list (drives the founder funnel surface)", () => {
    expect(ACTIVATION_EVENTS).toContain("first_seller_response");
  });

  it("sits after the outbound-effort events so the funnel reads as a loop", () => {
    const idx = (name: string) => ACTIVATION_EVENTS.indexOf(name as (typeof ACTIVATION_EVENTS)[number]);
    expect(idx("first_seller_response")).toBeGreaterThan(idx("first_letter_sent"));
    expect(idx("first_seller_response")).toBeGreaterThan(idx("first_mailer_sent"));
  });
});

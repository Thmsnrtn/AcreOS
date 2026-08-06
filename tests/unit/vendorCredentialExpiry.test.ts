/**
 * Vendor credential expiry registry (audit F-18-1).
 *
 * A solo operator's biggest during-absence risk is a sole-source vendor key
 * that lapses on a known date with nothing watching. These tests pin the pure
 * countdown + the "only warn on configured keys, only within the window"
 * behaviour that the step-away verdict and the daily page depend on.
 */

import { describe, it, expect } from "vitest";
import {
  VENDOR_CREDENTIAL_EXPIRIES,
  credentialExpiryStatus,
  imminentCredentialExpiries,
} from "../../server/services/vendorCredentialExpiry";

describe("vendorCredentialExpiry", () => {
  it("registers the known ATTOM trial expiry", () => {
    const attom = VENDOR_CREDENTIAL_EXPIRIES.find((v) => v.vendor === "ATTOM");
    expect(attom, "ATTOM entry present").toBeTruthy();
    expect(attom!.envVar).toBe("ATTOM_API_KEY");
    expect(attom!.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("computes whole days remaining relative to the injected now", () => {
    // 10 days before the ATTOM expiry.
    const attom = VENDOR_CREDENTIAL_EXPIRIES.find((v) => v.vendor === "ATTOM")!;
    const now = new Date(`${attom.expiresOn}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 10);
    const row = credentialExpiryStatus(now).find((v) => v.vendor === "ATTOM")!;
    expect(row.daysLeft).toBe(10);
  });

  it("reports a negative daysLeft after expiry", () => {
    const attom = VENDOR_CREDENTIAL_EXPIRIES.find((v) => v.vendor === "ATTOM")!;
    const past = new Date(`${attom.expiresOn}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() + 5);
    const row = credentialExpiryStatus(past).find((v) => v.vendor === "ATTOM")!;
    expect(row.daysLeft).toBeLessThan(0);
  });

  it("imminentCredentialExpiries excludes keys that are NOT configured (already-degraded ≠ impending)", () => {
    const attom = VENDOR_CREDENTIAL_EXPIRIES.find((v) => v.vendor === "ATTOM")!;
    const now = new Date(`${attom.expiresOn}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 3); // inside the 14-day window

    const withKey = imminentCredentialExpiries(now, 14, (k) => (k === "ATTOM_API_KEY" ? "set" : undefined));
    expect(withKey.some((v) => v.vendor === "ATTOM")).toBe(true);

    const withoutKey = imminentCredentialExpiries(now, 14, () => undefined);
    expect(withoutKey.some((v) => v.vendor === "ATTOM")).toBe(false);
  });

  it("imminentCredentialExpiries excludes keys outside the window", () => {
    const attom = VENDOR_CREDENTIAL_EXPIRIES.find((v) => v.vendor === "ATTOM")!;
    const now = new Date(`${attom.expiresOn}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 100); // far before expiry
    const rows = imminentCredentialExpiries(now, 14, () => "set");
    expect(rows.some((v) => v.vendor === "ATTOM")).toBe(false);
  });
});

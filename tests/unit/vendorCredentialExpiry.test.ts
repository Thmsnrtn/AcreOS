/**
 * Vendor credential expiry registry (audit F-18-1).
 *
 * A solo operator's biggest during-absence risk is a sole-source vendor key
 * that lapses on a known date with nothing watching. These tests pin the pure
 * countdown + the "only warn on configured keys, only within the window"
 * behaviour that the step-away verdict and the daily page depend on.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  VENDOR_CREDENTIAL_EXPIRIES,
  credentialExpiryStatus,
  imminentCredentialExpiries,
} from "../../server/services/vendorCredentialExpiry";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

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

// ---------------------------------------------------------------------------
// F-18-1 "Gate it" (Master Handoff Wave 0 item 0.2) — the registry is only a
// countdown if (a) every SOLE-SOURCE provider actually has an expiry row, and
// (b) the paths that surface the countdown stay wired. The registry + paging +
// readiness check shipped in the 2026-08 continuation batch; these pins are
// the enforcement the audit's "Gate it" asked for, as derived tests rather
// than a count ratchet (a set invariant, not a number).
// ---------------------------------------------------------------------------

describe("sole-source coverage — every single-source provider has an expiry row (F-18-1 gate)", () => {
  it("every RESIDENTIAL_CAPABLE_PROVIDERS member has a registry row", () => {
    // Derived from code, not a hardcoded list: adding a sole-source provider
    // (or swapping ATTOM out) without recording its credential expiry fails
    // here. residentialComps.ts is the single-source allowlist today.
    const src = read("server/services/residentialComps.ts");
    const m = src.match(
      /RESIDENTIAL_CAPABLE_PROVIDERS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/,
    );
    expect(m, "RESIDENTIAL_CAPABLE_PROVIDERS must be extractable").toBeTruthy();
    const providers = [...m![1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    expect(providers.length, "at least one sole-source provider").toBeGreaterThan(0);
    for (const p of providers) {
      const row = VENDOR_CREDENTIAL_EXPIRIES.find(
        (v) => v.vendor.toLowerCase() === p.toLowerCase(),
      );
      expect(
        row,
        `sole-source provider "${p}" needs a VENDOR_CREDENTIAL_EXPIRIES row — ` +
          `a single-source key with no recorded expiry is exactly the F-18-1 lapse`,
      ).toBeTruthy();
      // The row must carry a real, parseable date — unknown stays unknown, but
      // a sole-source provider without even a recorded expiry date defeats the
      // registry's purpose.
      expect(row!.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(row!.expiresOn))).toBe(false);
    }
  });
});

describe("the countdown paths stay WIRED (built-but-unwired defence)", () => {
  it("sendDailyBriefing carries the milestone paging (imminent expiries → alertSpine)", () => {
    const briefing = read("server/services/founderBriefing.ts");
    expect(briefing).toContain("imminentCredentialExpiries");
    expect(briefing).toContain("EXPIRY_PAGE_THRESHOLDS");
    // Critical (≤2 days or expired) pages; earlier milestones warn.
    expect(briefing).toMatch(/severity:\s*v\.daysLeft\s*<=\s*2\s*\?\s*"critical"\s*:\s*"warning"/);
  });

  it("sendDailyBriefing is actually SCHEDULED (runScheduledJobs invokes it)", () => {
    const jobs = read("server/jobs/runScheduledJobs.ts");
    expect(jobs).toContain("sendDailyBriefing");
  });

  it("the step-away verdict carries the vendor_credentials readiness check", () => {
    const readiness = read("server/services/autopilot/stepAwayReadiness.ts");
    expect(readiness).toContain('key: "vendor_credentials"');
    expect(readiness).toContain("imminentCredentialExpiries");
    // An already-expired sole-source key must block "every system armed".
    expect(readiness).toMatch(/expired\s*\?\s*"action_needed"/);
  });
});

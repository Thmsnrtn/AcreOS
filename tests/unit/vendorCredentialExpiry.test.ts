/**
 * Vendor credential expiry invariants (audit F-18-1), pinned against the
 * generalized dated-obligations registry (master-handoff O1).
 *
 * History: F-18-1 shipped a dedicated vendorCredentialExpiry registry; O1
 * generalized it into server/services/datedObligations.ts and briefly kept a
 * thin adapter module — which had zero production consumers and tripped the
 * reachability ratchet as a module orphan. The adapter is DELETED; these are
 * the SAME original invariants (sole-source coverage, countdown math, env
 * gating, wiring pins) rewritten against the registry of record — rewritten,
 * never deleted, per CLAUDE.md wave rule 4.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  DATED_OBLIGATIONS,
  obligationStatus,
  imminentObligations,
  isVendorCredential,
} from "../../server/services/datedObligations";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

const CREDENTIALS = DATED_OBLIGATIONS.filter(isVendorCredential);

describe("vendor-credential rows in the dated-obligations registry", () => {
  it("registers the known ATTOM trial expiry", () => {
    const attom = CREDENTIALS.find((v) => v.vendor === "ATTOM");
    expect(attom, "ATTOM entry present").toBeTruthy();
    expect(attom!.envVar).toBe("ATTOM_API_KEY");
    expect(attom!.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every vendor_credential row carries vendor + envVar + soleSourceFor", () => {
    for (const v of CREDENTIALS) {
      expect(v.vendor, `${v.envVar} vendor`).toBeTruthy();
      expect(v.envVar, `${v.vendor} envVar`).toBeTruthy();
      expect(v.soleSourceFor, `${v.vendor} soleSourceFor`).toBeTruthy();
    }
  });

  it("computes whole days remaining relative to the injected now", () => {
    const attom = CREDENTIALS.find((v) => v.vendor === "ATTOM")!;
    const now = new Date(`${attom.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 10);
    const row = obligationStatus(now).find(
      (o) => isVendorCredential(o) && o.vendor === "ATTOM",
    )!;
    expect(row.daysLeft).toBe(10);
  });

  it("reports a negative daysLeft after expiry", () => {
    const attom = CREDENTIALS.find((v) => v.vendor === "ATTOM")!;
    const past = new Date(`${attom.due}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() + 5);
    const row = obligationStatus(past).find(
      (o) => isVendorCredential(o) && o.vendor === "ATTOM",
    )!;
    expect(row.daysLeft).toBeLessThan(0);
  });

  it("imminentObligations excludes credential rows whose key is NOT configured (already-degraded ≠ impending)", () => {
    const attom = CREDENTIALS.find((v) => v.vendor === "ATTOM")!;
    const now = new Date(`${attom.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 3);

    const withKey = imminentObligations(now, 14, (k) => (k === "ATTOM_API_KEY" ? "set" : undefined));
    expect(withKey.some((o) => isVendorCredential(o) && o.vendor === "ATTOM")).toBe(true);

    const withoutKey = imminentObligations(now, 14, () => undefined);
    expect(withoutKey.some((o) => isVendorCredential(o) && o.vendor === "ATTOM")).toBe(false);
  });

  it("imminentObligations excludes rows outside the window", () => {
    const attom = CREDENTIALS.find((v) => v.vendor === "ATTOM")!;
    const now = new Date(`${attom.due}T00:00:00Z`);
    now.setUTCDate(now.getUTCDate() - 100);
    const rows = imminentObligations(now, 14, () => "set");
    expect(rows.some((o) => isVendorCredential(o) && o.vendor === "ATTOM")).toBe(false);
  });

  it("the registry of record is datedObligations.ts — the adapter module stays deleted", () => {
    // A second credential registry is exactly the drift O1 removed; the thin
    // adapter was a module orphan (zero production consumers) and is gone.
    expect(fs.existsSync(path.join(ROOT, "server/services/vendorCredentialExpiry.ts"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-18-1 "Gate it" (Master Handoff Wave 0 item 0.2) — the registry is only a
// countdown if (a) every SOLE-SOURCE provider actually has an expiry row, and
// (b) the paths that surface the countdown stay wired. Derived tests, not a
// count ratchet (a set invariant, not a number).
// ---------------------------------------------------------------------------

describe("sole-source coverage — every single-source provider has an expiry row (F-18-1 gate)", () => {
  it("every RESIDENTIAL_CAPABLE_PROVIDERS member has a vendor_credential row", () => {
    const src = read("server/services/residentialComps.ts");
    const m = src.match(
      /RESIDENTIAL_CAPABLE_PROVIDERS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/,
    );
    expect(m, "RESIDENTIAL_CAPABLE_PROVIDERS must be extractable").toBeTruthy();
    const providers = [...m![1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    expect(providers.length, "at least one sole-source provider").toBeGreaterThan(0);
    for (const p of providers) {
      const row = CREDENTIALS.find((v) => v.vendor.toLowerCase() === p.toLowerCase());
      expect(
        row,
        `sole-source provider "${p}" needs a vendor_credential row in ` +
          `server/services/datedObligations.ts — a single-source key with no ` +
          `recorded expiry is exactly the F-18-1 lapse`,
      ).toBeTruthy();
      expect(row!.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(row!.due))).toBe(false);
    }
  });
});

describe("the countdown paths stay WIRED (built-but-unwired defence)", () => {
  it("sendDailyBriefing carries the milestone paging (imminent obligations → alertSpine)", () => {
    const briefing = read("server/services/founderBriefing.ts");
    expect(briefing).toContain("imminentObligations");
    expect(briefing).toContain("pageThresholdsFor");
    expect(briefing).toMatch(/severity:\s*o\.daysLeft\s*<=\s*2\s*\?\s*"critical"\s*:\s*"warning"/);
  });

  it("sendDailyBriefing is actually SCHEDULED (runScheduledJobs invokes it)", () => {
    const jobs = read("server/jobs/runScheduledJobs.ts");
    expect(jobs).toContain("sendDailyBriefing");
  });

  it("the step-away verdict carries the vendor_credentials readiness check (now obligation-general)", () => {
    const readiness = read("server/services/autopilot/stepAwayReadiness.ts");
    expect(readiness).toContain('key: "vendor_credentials"');
    expect(readiness).toContain("imminentObligations");
    expect(readiness).toMatch(/overdue\s*\?\s*"action_needed"/);
  });
});

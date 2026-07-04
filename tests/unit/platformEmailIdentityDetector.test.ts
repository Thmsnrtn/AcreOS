/**
 * Platform SES identity watchdog (2026-07 DKIM incident closure).
 *
 * Locks the paging semantics for the exact failure that reached the founder
 * only via an AWS Health email: DKIM CNAMEs missing from DNS for 72h → SES
 * flips the identity to FAILED, transactional mail degrades, nothing pages.
 *
 *   1. no AWS creds → honest green (integrationReadiness owns that signal)
 *   2. healthy identity → no findings
 *   3. FAILED + missing CNAMEs → critical, detail names the exact records
 *   4. PENDING → warn (setup in flight, not yet an incident)
 *   5. SES lookup failure with creds configured → warn (blind watchdog)
 *   6. identity absent → critical
 *   7. MAIL FROM degraded → warn; not-verified-for-sending → critical
 */

import { describe, it, expect } from "vitest";
import {
  buildPlatformEmailIdentityDetector,
  type SesIdentitySnapshot,
} from "../../server/services/audit/detectors/platformEmailIdentityDetector";

const TOKENS = ["tokaaa", "tokbbb", "tokccc"];

function deps(overrides: {
  credentialsConfigured?: boolean;
  snapshot?: SesIdentitySnapshot;
  getIdentity?: (domain: string) => Promise<SesIdentitySnapshot>;
  cnames?: Record<string, string[]>;
}) {
  return buildPlatformEmailIdentityDetector({
    domain: "acreos.io",
    credentialsConfigured: overrides.credentialsConfigured ?? true,
    getIdentity:
      overrides.getIdentity ?? (async () => overrides.snapshot ?? { found: false }),
    resolveCname: async (host: string) => overrides.cnames?.[host] ?? [],
  });
}

const HEALTHY: SesIdentitySnapshot = {
  found: true,
  dkimStatus: "SUCCESS",
  dkimTokens: TOKENS,
  mailFromDomain: "mail.acreos.io",
  mailFromStatus: "SUCCESS",
  verifiedForSending: true,
};

describe("platformEmailIdentityDetector", () => {
  it("returns no findings when AWS credentials are not configured", async () => {
    const detector = deps({ credentialsConfigured: false, snapshot: { found: false } });
    expect(await detector.run()).toEqual([]);
  });

  it("returns no findings for a fully healthy identity", async () => {
    const detector = deps({ snapshot: HEALTHY });
    expect(await detector.run()).toEqual([]);
  });

  it("pages critical on FAILED and names the exact missing CNAMEs", async () => {
    const detector = deps({
      snapshot: { ...HEALTHY, dkimStatus: "FAILED", verifiedForSending: false },
      // Only the first token's CNAME exists in DNS.
      cnames: { "tokaaa._domainkey.acreos.io": ["tokaaa.dkim.amazonses.com"] },
    });

    const findings = await detector.run();
    const dkim = findings.find((f) => f.dedupeKey === "dkim:acreos.io");
    expect(dkim?.severity).toBe("critical");
    expect(dkim?.detail).toContain("tokbbb._domainkey.acreos.io");
    expect(dkim?.detail).toContain("tokccc._domainkey.acreos.io");
    expect(dkim?.detail).not.toContain("CNAME tokaaa._domainkey");
    expect(dkim?.metadata?.missingRecords).toHaveLength(2);

    const sending = findings.find((f) => f.dedupeKey === "sending:acreos.io");
    expect(sending?.severity).toBe("critical");
  });

  it("accepts CNAME targets with a trailing dot and mixed case", async () => {
    const detector = deps({
      snapshot: { ...HEALTHY, dkimStatus: "FAILED" },
      cnames: {
        "tokaaa._domainkey.acreos.io": ["TOKAAA.dkim.amazonses.com."],
        "tokbbb._domainkey.acreos.io": ["tokbbb.dkim.amazonses.com."],
        "tokccc._domainkey.acreos.io": ["tokccc.dkim.amazonses.com"],
      },
    });
    const [dkim] = await detector.run();
    // All records present → detail points at restarting verification instead.
    expect(dkim.metadata?.missingRecords).toEqual([]);
    expect(dkim.detail).toContain("Restart verification");
  });

  it("warns (not critical) while DKIM is still PENDING", async () => {
    const detector = deps({ snapshot: { ...HEALTHY, dkimStatus: "PENDING" } });
    const [dkim] = await detector.run();
    expect(dkim.severity).toBe("warn");
    expect(dkim.dedupeKey).toBe("dkim:acreos.io");
  });

  it("emits a blind-watchdog warning when the SES lookup itself fails", async () => {
    const detector = deps({
      getIdentity: async () => {
        throw new Error("UnrecognizedClientException");
      },
    });
    const [finding] = await detector.run();
    expect(finding.severity).toBe("warn");
    expect(finding.dedupeKey).toBe("check_error:acreos.io");
    expect(finding.detail).toContain("UnrecognizedClientException");
  });

  it("pages critical when SES has no identity for the domain", async () => {
    const detector = deps({ snapshot: { found: false } });
    const [finding] = await detector.run();
    expect(finding.severity).toBe("critical");
    expect(finding.dedupeKey).toBe("dkim:acreos.io");
    expect(finding.detail).toContain("ses-setup.mjs");
  });

  it("warns on a degraded MAIL FROM without touching DKIM findings", async () => {
    const detector = deps({
      snapshot: { ...HEALTHY, mailFromStatus: "TEMPORARY_FAILURE" },
    });
    const findings = await detector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].dedupeKey).toBe("mail_from:acreos.io");
    expect(findings[0].severity).toBe("warn");
  });
});

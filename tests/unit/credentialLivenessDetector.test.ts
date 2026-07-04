/**
 * Credential liveness watchdog (2026-07-04 secrets-audit closure).
 *
 * Four configured keys were dead while presence-based readiness said "live".
 * This locks the watchdog's rules:
 *   1. unconfigured vendor → silent (integrationReadiness owns dark configs)
 *   2. configured + vendor accepts → silent
 *   3. configured + vendor rejects → finding, right severity + dedupe key
 *   4. probe network error → warn (never critical; blips age out)
 *   5. no secret VALUE ever appears in a finding
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCredentialLivenessDetector } from "../../server/services/audit/detectors/credentialLivenessDetector";

const ENV_KEYS = [
  "STRIPE_SECRET_KEY", "LOB_API_KEY", "LOB_LIVE_API_KEY", "LOB_TEST_API_KEY",
  "AI_INTEGRATIONS_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "CLERK_SECRET_KEY",
  "ANTHROPIC_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_API_KEY",
  "SENDGRID_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
  "VITE_MAPBOX_ACCESS_TOKEN", "VITE_MAPBOX_TOKEN", "MAPBOX_TOKEN", "MAPBOX_PUBLIC_TOKEN",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("credentialLivenessDetector", () => {
  it("stays silent when nothing is configured", async () => {
    const detector = buildCredentialLivenessDetector(async () => ({ ok: true, status: 200 }));
    expect(await detector.run()).toEqual([]);
  });

  it("stays silent when a configured vendor accepts the key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_test";
    const detector = buildCredentialLivenessDetector(async () => ({ ok: true, status: 200 }));
    expect(await detector.run()).toEqual([]);
  });

  it("pages critical with the right dedupe key when Stripe rejects", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_unit_test";
    const detector = buildCredentialLivenessDetector(async () => ({ ok: false, status: 401 }));
    const findings = await detector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].dedupeKey).toBe("dead:stripe");
    expect(findings[0].title).toContain("HTTP 401");
    // The secret value must never leak into the finding.
    expect(JSON.stringify(findings[0])).not.toContain("sk_test_fake_for_unit_test");
  });

  it("treats fallback-only vendors as warn, not critical", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake-for-unit-test";
    const detector = buildCredentialLivenessDetector(async () => ({ ok: false, status: 401 }));
    const [finding] = await detector.run();
    expect(finding.severity).toBe("warn");
    expect(finding.dedupeKey).toBe("dead:anthropic");
  });

  it("emits warn (never critical) when the probe itself errors", async () => {
    process.env.CLERK_SECRET_KEY = "sk_fake_for_unit_test";
    const detector = buildCredentialLivenessDetector(async () => {
      throw new Error("ETIMEDOUT");
    });
    const [finding] = await detector.run();
    expect(finding.severity).toBe("warn");
    expect(finding.dedupeKey).toBe("probe_error:clerk");
    expect(finding.detail).toContain("ETIMEDOUT");
  });

  it("requires BOTH Twilio vars before probing Twilio", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACfake";
    // no TWILIO_AUTH_TOKEN → not configured → silent
    const detector = buildCredentialLivenessDetector(async () => ({ ok: false, status: 401 }));
    expect(await detector.run()).toEqual([]);
  });

  it("probes every configured vendor independently", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_fake";
    process.env.SENDGRID_API_KEY = "SG.fake";
    const detector = buildCredentialLivenessDetector(async (url) => ({
      ok: !url.includes("sendgrid"),
      status: url.includes("sendgrid") ? 401 : 200,
    }));
    const findings = await detector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].dedupeKey).toBe("dead:sendgrid");
  });
});

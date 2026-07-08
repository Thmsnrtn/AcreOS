/**
 * DNC / litigator scrub seam (server/services/compliance/dncScrub.ts).
 *
 * The seam ships ahead of the founder's vendor decision (roadmap-2026-07
 * Founder decision #1): INERT when no provider is configured, and with a
 * hard policy contract once one is:
 *   litigator → always block; dnc_listed → block without express consent;
 *   scrub error → fail CLOSED for lead-matched marketing, OPEN for
 *   transactional; clean → allow.
 * These tests pin that contract (pure policy — no DB, no network).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateDncGate,
  fixtureDncProvider,
  getConfiguredDncProvider,
  isDncScrubConfigured,
  normalizePhoneLast10,
  type DncScrubOutcome,
} from "../../server/services/compliance/dncScrub";

const outcome = (status: DncScrubOutcome["status"]): DncScrubOutcome => ({
  status,
  provider: "fixture",
  listSource: "fixture",
});

afterEach(() => {
  delete process.env.DNC_SCRUB_PROVIDER;
});

describe("evaluateDncGate — policy contract", () => {
  it("is inert (allows, scrubbed:false) when no provider is configured", () => {
    const result = evaluateDncGate(null, { leadMatched: true, hasConsent: true });
    expect(result).toEqual({ allowed: true, scrubbed: false });
  });

  it("blocks litigator numbers even with express consent", () => {
    const result = evaluateDncGate(outcome("litigator"), {
      leadMatched: true,
      hasConsent: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.scrubbed).toBe(true);
    expect(result.reason).toMatch(/litigator/i);
  });

  it("blocks DNC-listed numbers without express consent", () => {
    const result = evaluateDncGate(outcome("dnc_listed"), {
      leadMatched: false,
      hasConsent: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/DNC-listed/i);
  });

  it("allows DNC-listed numbers WITH express consent (consent overrides registry)", () => {
    const result = evaluateDncGate(outcome("dnc_listed"), {
      leadMatched: true,
      hasConsent: true,
    });
    expect(result).toEqual({ allowed: true, scrubbed: true });
  });

  it("fails CLOSED on scrub error for lead-matched marketing sends", () => {
    const result = evaluateDncGate(outcome("error"), {
      leadMatched: true,
      hasConsent: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/fail closed/i);
  });

  it("fails OPEN on scrub error for unmatched/transactional traffic", () => {
    const result = evaluateDncGate(outcome("error"), {
      leadMatched: false,
      hasConsent: false,
    });
    expect(result.allowed).toBe(true);
  });

  it("allows clean numbers", () => {
    const result = evaluateDncGate(outcome("clean"), {
      leadMatched: true,
      hasConsent: true,
    });
    expect(result).toEqual({ allowed: true, scrubbed: true });
  });
});

describe("provider configuration", () => {
  it("reports unconfigured when DNC_SCRUB_PROVIDER is unset", () => {
    delete process.env.DNC_SCRUB_PROVIDER;
    expect(isDncScrubConfigured()).toBe(false);
    expect(getConfiguredDncProvider()).toBeNull();
  });

  it('treats "none"/"off"/unknown as unconfigured (inert seam)', () => {
    for (const v of ["none", "off", "some-unknown-vendor"]) {
      process.env.DNC_SCRUB_PROVIDER = v;
      expect(isDncScrubConfigured()).toBe(false);
    }
  });

  it("resolves the fixture provider when configured", () => {
    process.env.DNC_SCRUB_PROVIDER = "fixture";
    expect(getConfiguredDncProvider()?.name).toBe("fixture");
    expect(isDncScrubConfigured()).toBe(true);
  });
});

describe("fixture provider", () => {
  it("flags the fixture litigator and DNC ranges and clears everything else", async () => {
    await expect(fixtureDncProvider.scrub("5555550199")).resolves.toMatchObject({
      status: "litigator",
    });
    await expect(fixtureDncProvider.scrub("5555550100")).resolves.toMatchObject({
      status: "dnc_listed",
    });
    await expect(fixtureDncProvider.scrub("4805551234")).resolves.toMatchObject({
      status: "clean",
    });
  });
});

describe("normalizePhoneLast10", () => {
  it("normalizes formatted numbers to last-10 digits", () => {
    expect(normalizePhoneLast10("+1 (480) 555-1234")).toBe("4805551234");
    expect(normalizePhoneLast10("14805551234")).toBe("4805551234");
    expect(normalizePhoneLast10("")).toBe("");
  });
});

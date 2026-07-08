import { describe, it, expect } from "vitest";
import { screenClaims, summarizeClaimViolations, type RegulatoryProfile } from "../../server/services/autopilot/claimsEngine";

// A domain-agnostic toy profile — the kernel engine must screen ANY vertical's
// rules (the land profile is exercised in autopilotClaimsGate.test.ts).
const TOY: RegulatoryProfile = {
  attributionCues: ["according to"],
  determinationPatterns: [{ code: "is_safe", re: /\bis (totally )?safe\b/i, label: "a safety determination" }],
  bannedPatterns: [{ code: "guaranteed", re: /\bguaranteed\b/i, label: "a guarantee" }],
  disclosureCues: ["not advice"],
};

describe("screenClaims — domain-agnostic, profile-driven content gate", () => {
  it("passes clean content that carries the disclosure", () => {
    const r = screenClaims("Here are the facts. This is not advice.", TOY);
    expect(r.ok).toBe(true);
  });

  it("flags a bare determination, allows it when attributed nearby", () => {
    expect(screenClaims("The lot is safe. Not advice.", TOY).ok).toBe(false);
    const attributed = screenClaims("According to the report the lot is safe. Not advice.", TOY);
    expect(attributed.ok).toBe(true);
  });

  it("always blocks a banned pattern", () => {
    const r = screenClaims("Returns are guaranteed. Not advice.", TOY);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.code === "guaranteed")).toBe(true);
  });

  it("requires the disclosure footer by default; opt-out drops the requirement", () => {
    expect(screenClaims("Plain clean text.", TOY).ok).toBe(false); // missing disclosure
    expect(screenClaims("Plain clean text.", TOY, { requireDisclosure: false }).ok).toBe(true);
  });

  it("summarizes with the supplied label", () => {
    const blocked = screenClaims("guaranteed", TOY);
    expect(summarizeClaimViolations(blocked, "toy")).toMatch(/toy gate BLOCKED/);
    expect(summarizeClaimViolations({ ok: true, violations: [] }, "toy")).toBe("toy gate: clear");
  });
});

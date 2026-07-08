import { describe, it, expect } from "vitest";
import { screenLandClaims, summarizeClaimViolations } from "../../server/services/autopilot/claimsGate";

const DISCLOSURE = " This is for informational purposes only and is not legal or investment advice; verify independently.";

describe("autopilot land-claims gate — auto-published land content safety", () => {
  it("clears clean, attributed, disclosed content", () => {
    const text =
      "This 5-acre parcel in Brewster County sits along a county-maintained road, according to County GIS as of 2024." +
      DISCLOSURE;
    const r = screenLandClaims(text);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("BLOCKS bare buildability/perc/wetlands/flood/title determinations (liability)", () => {
    for (const bad of [
      "This is a buildable lot ready for your dream home.",
      "The soil will perc and septic is approved.",
      "There are no wetlands and it is flood-free.",
      "Comes with clear title, free and clear of any liens.",
      "Paved access guaranteed to the parcel.",
    ]) {
      const r = screenLandClaims(bad + DISCLOSURE);
      expect(r.ok).toBe(false);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("ALLOWS the same land facts when attributed + hedged", () => {
    const r = screenLandClaims(
      "County GIS lists the parcel as buildable, and the seller states the soil will perc." + DISCLOSURE,
    );
    // 'buildable' and 'will perc' are near attribution cues → allowed
    expect(r.violations.find((v) => v.code === "buildability")).toBeUndefined();
    expect(r.violations.find((v) => v.code === "perc_septic")).toBeUndefined();
  });

  it("NEVER allows investment/return language, even attributed", () => {
    for (const bad of [
      "According to the seller, this is a guaranteed return.",
      "Expect a 20% return within a year.",
      "This land will double your money.",
      "A smart investment you should buy now.",
    ]) {
      const r = screenLandClaims(bad + DISCLOSURE);
      expect(r.ok).toBe(false);
      expect(r.violations.some((v) => ["guaranteed_return", "return_figure", "appreciation", "advice"].includes(v.code))).toBe(true);
    }
  });

  it("blocks fair-housing steering descriptors", () => {
    for (const bad of ["Great for families and close to good schools.", "A safe neighborhood, perfect for a Christian community."]) {
      const r = screenLandClaims(bad + DISCLOSURE);
      expect(r.ok).toBe(false);
      expect(r.violations.some((v) => ["family_steering", "safety_steering", "protected_class"].includes(v.code))).toBe(true);
    }
  });

  it("requires a disclosure footer (and lets it be configured off)", () => {
    const noDisclosure = screenLandClaims("A 10-acre parcel near the river, per county records.");
    expect(noDisclosure.ok).toBe(false);
    expect(noDisclosure.violations.some((v) => v.code === "missing_disclosure")).toBe(true);

    const disabled = screenLandClaims("A 10-acre parcel near the river, per county records.", { requireDisclosure: false });
    expect(disabled.ok).toBe(true);
  });

  it("is conservative + total: empty input only trips the disclosure check, never throws", () => {
    expect(() => screenLandClaims("")).not.toThrow();
    const r = screenLandClaims("");
    expect(r.violations.map((v) => v.code)).toEqual(["missing_disclosure"]);
  });

  it("summarizes violations for logs/gate reasons", () => {
    expect(summarizeClaimViolations(screenLandClaims("clear title, free and clear" + DISCLOSURE))).toMatch(/BLOCKED: title_lien/);
    expect(summarizeClaimViolations(screenLandClaims("Nice parcel, per county records." + DISCLOSURE))).toMatch(/clear/);
  });
});

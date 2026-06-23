import { describe, it, expect } from "vitest";
import { buildIgnitionDrafts } from "../../server/services/autopilot/ignitionKit";

describe("buildIgnitionDrafts — the founder ignition pack", () => {
  it("builds a launch post + directory list pointing at the FREE tool", () => {
    const d = buildIgnitionDrafts({ baseUrl: "https://acreos.com", exampleCounty: { countyLabel: "Travis", state: "TX" } });
    expect(d.launchPost.title).toMatch(/free parcel report/i);
    expect(d.launchPost.body).toContain("https://acreos.com/tools/parcel-check");
    expect(d.launchPost.body).toMatch(/Travis County, TX/);
    expect(d.directories.length).toBeGreaterThan(3);
    expect(d.directories.every((x) => x.url.startsWith("https://"))).toBe(true);
  });

  it("normalizes a trailing slash in the base URL", () => {
    const d = buildIgnitionDrafts({ baseUrl: "https://acreos.com/", exampleCounty: null });
    expect(d.launchPost.body).toContain("https://acreos.com/tools/parcel-check");
    expect(d.launchPost.body).not.toContain("acreos.com//tools");
  });

  it("falls back to a generic example when no county is seeded", () => {
    const d = buildIgnitionDrafts({ baseUrl: "https://acreos.com", exampleCounty: null });
    expect(d.launchPost.body).toMatch(/any US county/i);
  });

  it("reminds the founder to post in his own voice (anti-spam discipline)", () => {
    const d = buildIgnitionDrafts({ baseUrl: "https://acreos.com" });
    expect(d.reminder).toMatch(/your voice|own voice|spam pattern/i);
  });
});

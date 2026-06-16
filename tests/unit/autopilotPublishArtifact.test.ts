import { describe, it, expect } from "vitest";
import { screenForPublish } from "../../server/services/autopilot/publishArtifact";

const DISCLOSURE = "<p>For informational purposes only; not legal or investment advice. Verify independently.</p>";

describe("autopilot publish gate — screenForPublish", () => {
  it("passes clean, sanitized, disclosed, internally-linked content", () => {
    const r = screenForPublish({
      subject: "Land basics in Brewster County",
      htmlBody: `<p>A 5-acre parcel along a county road, according to County GIS as of 2024. <a href="/parcel-check">Run a check</a>.</p>${DISCLOSURE}`,
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("SANITIZES: strips script, event handlers, and javascript: URLs", () => {
    const r = screenForPublish({
      subject: "x",
      htmlBody: `<p onclick="steal()">hi</p><script>evil()</script><a href="javascript:alert(1)">x</a>${DISCLOSURE}`,
    });
    expect(r.sanitizedHtml).not.toMatch(/<script/i);
    expect(r.sanitizedHtml).not.toMatch(/onclick/i);
    expect(r.sanitizedHtml).not.toMatch(/javascript:/i);
  });

  it("BLOCKS outbound links to non-AcreOS hosts; allows relative + AcreOS + mailto", () => {
    const bad = screenForPublish({ subject: "x", htmlBody: `<p><a href="https://evil.example.com">click</a></p>${DISCLOSURE}` });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.code === "external_link")).toBe(true);

    const good = screenForPublish({
      subject: "x",
      htmlBody: `<p><a href="https://acreos.com/x">a</a> <a href="/y">b</a> <a href="mailto:hi@acreos.com">c</a></p>${DISCLOSURE}`,
    });
    expect(good.violations.find((v) => v.code === "external_link")).toBeUndefined();
  });

  it("BLOCKS banned land claims even in published HTML (composes the claims gate)", () => {
    const r = screenForPublish({ subject: "Buildable lot!", htmlBody: `<p>This is a buildable lot, free and clear of liens.</p>${DISCLOSURE}` });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => ["buildability", "title_lien"].includes(v.code))).toBe(true);
  });

  it("BLOCKS when the disclosure footer is missing", () => {
    const r = screenForPublish({ subject: "x", htmlBody: `<p>A nice parcel, per county records.</p>` });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.code === "missing_disclosure")).toBe(true);
  });

  it("is total: empty/garbage input never throws", () => {
    expect(() => screenForPublish({ subject: "", htmlBody: "" })).not.toThrow();
    expect(() => screenForPublish({ subject: "x", htmlBody: "<<>not html" })).not.toThrow();
  });
});

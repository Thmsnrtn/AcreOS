import { describe, it, expect } from "vitest";
import { screenForPublish, parsePublishable, maybePublishFromDispatch } from "../../server/services/autopilot/publishArtifact";

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

describe("autopilot publish — parsePublishable (the agent-output contract)", () => {
  it("extracts subject + body from a well-formed PUBLISH block", () => {
    const out = `Here's my reasoning...\n<<<PUBLISH\nSUBJECT: Brewster County land basics\nBODY:\n<p>Hello, per county records.</p>\n>>>`;
    expect(parsePublishable(out)).toEqual({ subject: "Brewster County land basics", htmlBody: "<p>Hello, per county records.</p>" });
  });

  it("SAFE FAILURE: messy output with no block ⇒ null (won't publish reasoning)", () => {
    expect(parsePublishable("just some freeform agent reasoning, no block")).toBeNull();
    expect(parsePublishable("")).toBeNull();
    expect(parsePublishable("<<<PUBLISH\nno subject here\n>>>")).toBeNull();
  });
});

describe("autopilot publish — maybePublishFromDispatch gating", () => {
  it("only fires for a SUCCESSFUL autopilot GROWTH dispatch with a publishable block", async () => {
    // not a growth dispatch → null
    expect(await maybePublishFromDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:optimize", success: true, finalText: "<<<PUBLISH\nSUBJECT: x\nBODY:\n<p>y</p>\n>>>", dispatchId: 1 })).toBeNull();
    // failed dispatch → null
    expect(await maybePublishFromDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:grow_owned_channels", success: false, finalText: "<<<PUBLISH\nSUBJECT: x\nBODY:\n<p>y</p>\n>>>", dispatchId: 1 })).toBeNull();
    // no block → null
    expect(await maybePublishFromDispatch({ sourceType: "auto_dispatch", sourceId: "autopilot:grow_owned_channels", success: true, finalText: "no block", dispatchId: 1 })).toBeNull();
    // non-autopilot → null
    expect(await maybePublishFromDispatch({ sourceType: "founder_manual", sourceId: "x", success: true, finalText: "<<<PUBLISH\nSUBJECT: x\nBODY:\n<p>y</p>\n>>>", dispatchId: 1 })).toBeNull();
  });
});

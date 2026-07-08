import { describe, it, expect } from "vitest";
import { craftStandardPrompt, CRAFT_INVARIANT, type CraftSurface } from "../../server/services/autopilot/craftStandard";

describe("autopilot craft standard", () => {
  it("always carries the core non-negotiables (no hype/manipulation, lead with usefulness, the 'glad to receive it' test)", () => {
    const p = craftStandardPrompt();
    expect(p).toMatch(/tasteful, genuinely human, best-in-class, and\s+tactful/i);
    expect(p).toMatch(/No hype, no manipulation/i);
    expect(p).toMatch(/usefulness to the recipient, not extraction/i);
    expect(p).toMatch(/genuinely glad to have received it/i);
  });

  it("layers surface-specific guidance for each outward surface", () => {
    const surfaces: CraftSurface[] = ["marketing", "outreach", "social", "support", "content", "generic"];
    for (const s of surfaces) {
      const p = craftStandardPrompt(s);
      expect(p).toContain("For this surface:");
      expect(p.length).toBeGreaterThan(200);
    }
    // outreach must demand genuine personalization, never fake-personal blasts
    expect(craftStandardPrompt("outreach")).toMatch(/genuinely personal|unmistakably for THEM/i);
    // support must prioritize solving + honesty over over-promising
    expect(craftStandardPrompt("support")).toMatch(/never over-promise/i);
  });

  it("exposes a one-line invariant for gates/logs", () => {
    expect(CRAFT_INVARIANT).toMatch(/tasteful, human, best-in-class, and tactful/i);
  });
});

import { describe, it, expect } from "vitest";
import {
  computeSla,
  npsActionFor,
  shouldDraftKb,
  composeKbDraft,
  DEFAULT_SLA,
} from "../../server/services/autopilot/measurementLoops";

const t0 = new Date("2026-06-18T00:00:00Z");
const at = (mins: number) => new Date(t0.getTime() + mins * 60000);

describe("measurementLoops — support SLA (D2)", () => {
  it("computes first-reply + resolution minutes", () => {
    const m = computeSla({ createdAt: t0, firstReplyAt: at(30), resolvedAt: at(300), now: at(300) });
    expect(m.firstReplyMinutes).toBe(30);
    expect(m.resolutionMinutes).toBe(300);
    expect(m.firstReplyBreached).toBe(false); // 30 < 120
    expect(m.resolutionBreached).toBe(false); // 300 < 1440
  });

  it("flags an OPEN breach: unanswered past the first-reply target", () => {
    const m = computeSla({ createdAt: t0, firstReplyAt: null, resolvedAt: null, now: at(DEFAULT_SLA.firstReplyMinutes + 10) });
    expect(m.firstReplyMinutes).toBeNull();
    expect(m.firstReplyBreached).toBe(true);
  });

  it("flags an answered-late breach", () => {
    const m = computeSla({ createdAt: t0, firstReplyAt: at(200), resolvedAt: null, now: at(200) });
    expect(m.firstReplyBreached).toBe(true); // 200 > 120
  });
});

describe("measurementLoops — NPS → action (D2)", () => {
  it("maps detractor / passive / promoter to a concrete next play", () => {
    expect(npsActionFor(3)).toMatchObject({ segment: "detractor", action: "winback_outreach", lifecyclePlayId: "winback" });
    expect(npsActionFor(7)).toMatchObject({ segment: "passive", action: "check_in" });
    expect(npsActionFor(10)).toMatchObject({ segment: "promoter", action: "ask_referral", lifecyclePlayId: null });
  });

  it("boundaries: 6 is a detractor, 9 is a promoter", () => {
    expect(npsActionFor(6).segment).toBe("detractor");
    expect(npsActionFor(8).segment).toBe("passive");
    expect(npsActionFor(9).segment).toBe("promoter");
  });
});

describe("measurementLoops — KB auto-draft (D2, conservative)", () => {
  const good = { status: "resolved", aiHandled: true, confidence: 0.9, satisfaction: 5, reopened: false };

  it("drafts only from a clean, confident, well-rated AI resolution", () => {
    expect(shouldDraftKb(good)).toBe(true);
  });

  it("refuses low-confidence, reopened, unrated-low, non-resolved, or human-handled", () => {
    expect(shouldDraftKb({ ...good, confidence: 0.5 })).toBe(false);
    expect(shouldDraftKb({ ...good, reopened: true })).toBe(false);
    expect(shouldDraftKb({ ...good, satisfaction: 2 })).toBe(false);
    expect(shouldDraftKb({ ...good, status: "open" })).toBe(false);
    expect(shouldDraftKb({ ...good, aiHandled: false })).toBe(false);
  });

  it("allows a missing satisfaction rating (absence doesn't block)", () => {
    expect(shouldDraftKb({ ...good, satisfaction: null })).toBe(true);
  });

  it("composes a review-gated draft", () => {
    const d = composeKbDraft({ question: "How do I export my deals?", resolution: "Go to Deals → Export." });
    expect(d.title).toContain("export my deals");
    expect(d.body).toContain("review before publishing");
  });
});

import { describe, it, expect } from "vitest";
import {
  detectPlayProposal,
  DECLINE_STREAK,
  TRUST_STREAK,
} from "../../server/services/autopilot/policyInducer";
import type { ExperienceVote } from "../../server/services/autopilot/experienceLog";

const f: ExperienceVote = "failure";
const s: ExperienceVote = "success";
const p: ExperienceVote = "pending";

describe("autopilot policy inducer — propose durable policy from patterns", () => {
  it("proposes STOP after a streak of recent declines/failures", () => {
    const prop = detectPlayProposal("cold-outreach", Array(DECLINE_STREAK).fill(f));
    expect(prop).toMatchObject({ kind: "stop_play", playId: "cold-outreach" });
    expect(prop?.reason).toMatch(new RegExp(`${DECLINE_STREAK}`));
  });

  it("proposes TRUST after a streak of recent successes", () => {
    const prop = detectPlayProposal("county-guide", Array(TRUST_STREAK).fill(s));
    expect(prop).toMatchObject({ kind: "trust_play", playId: "county-guide" });
  });

  it("does NOT propose below the streak thresholds", () => {
    expect(detectPlayProposal("x", Array(DECLINE_STREAK - 1).fill(f))).toBeNull();
    expect(detectPlayProposal("x", Array(TRUST_STREAK - 1).fill(s))).toBeNull();
  });

  it("only the MOST RECENT votes count — an old failure doesn't block a fresh win streak", () => {
    // most-recent-first: 5 successes then an old failure → trust
    const votes = [...Array(TRUST_STREAK).fill(s), f];
    expect(detectPlayProposal("x", votes)?.kind).toBe("trust_play");
    // a recent failure breaks the streak → no proposal
    const broken = [f, ...Array(TRUST_STREAK).fill(s)];
    expect(detectPlayProposal("x", broken)?.kind).not.toBe("trust_play");
  });

  it("ignores pending votes (unresolved actions don't count toward a pattern)", () => {
    // pending interleaved; the resolved tail is still a decline streak
    const votes = [p, f, p, f, p, f];
    expect(detectPlayProposal("x", votes)?.kind).toBe("stop_play");
  });

  it("stop takes precedence over trust when both could read (defensive)", () => {
    // recent declines win even if older history had successes
    const votes = [...Array(DECLINE_STREAK).fill(f), ...Array(TRUST_STREAK).fill(s)];
    expect(detectPlayProposal("x", votes)?.kind).toBe("stop_play");
  });

  it("empty / all-pending history yields no proposal", () => {
    expect(detectPlayProposal("x", [])).toBeNull();
    expect(detectPlayProposal("x", [p, p, p, p, p])).toBeNull();
  });
});

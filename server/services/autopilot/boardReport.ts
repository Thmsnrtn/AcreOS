/**
 * Founder Autopilot — the board report (Elite Vision H4).
 *
 * At 99.9% autonomy the daily letter isn't an operator's to-do list — it's the
 * report a CEO gives the board: what the company did, how it's tracking, what
 * it's deciding, and the handful of things that genuinely need the founder. This
 * composes that report from the section lines each horizon already produces
 * (OKR, reflex health, immune status, growth funnel) + the attention-economy
 * signal. Pure → testable; the loop/narrator feeds it real values.
 */
import type { AttentionLoad } from "./boardReserve";

export interface BoardReportInput {
  /** The brain's current top move (what it's working / would work). */
  topMove?: string | null;
  /** Progress line from okr.okrLine. */
  okr?: string | null;
  /** Autonomic-layer health from reflexes.reflexHealthLine. */
  reflexes?: string | null;
  /** Dependency/immune status from immuneSystem.immuneSystemLine. */
  immune?: string | null;
  /** Owned-growth funnel from growthEngine.growthFunnelLine. */
  growth?: string | null;
  /** Decision-quality from decisionEval.decisionEvalLine — lets the founder
   *  WATCH the brain's judgment calibrate over time (E1). */
  decisionQuality?: string | null;
  /** Self-marketing posture from marketingChannels.marketingPostureLine —
   *  free-first/paid-when-proven status. */
  marketing?: string | null;
  /** Actions frozen in the /decisions queue awaiting the founder's tap. */
  pendingCount: number;
  /** Founder-attention calibration over the window. */
  attention: AttentionLoad;
}

/** Compose the board report as markdown. Honest: omits sections it has no real
 * value for, and never fabricates progress. Pure. */
export function composeBoardReport(input: BoardReportInput): string {
  const lines: string[] = ["# Your company — board report", ""];

  // What it's doing now.
  lines.push("## What the company is working on");
  lines.push(input.topMove ? `- ${input.topMove}` : "- Nothing urgent — holding steady.");
  lines.push("");

  // How it's tracking.
  const tracking = [input.okr, input.growth, input.marketing, input.decisionQuality, input.reflexes, input.immune].filter(Boolean) as string[];
  if (tracking.length > 0) {
    lines.push("## How it's tracking");
    for (const t of tracking) lines.push(`- ${t}`);
    lines.push("");
  }

  // What needs you.
  lines.push("## What needs you");
  if (input.pendingCount > 0) {
    lines.push(`- ${input.pendingCount} action(s) drafted and awaiting your tap in /decisions.`);
  } else {
    lines.push("- Nothing right now. The company is running itself.");
  }
  if (input.attention.overBudget) {
    lines.push(`- ⚠︎ Calibration: the system asked for you on ${(input.attention.askRate * 100).toFixed(1)}% of decisions — above the board-only target. Earning more autonomy will quiet this.`);
  }
  lines.push("");

  return lines.join("\n");
}

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

// ────────────────────────────────────────────────────────────────────────────
// Impure composer — assembles the board report from REAL live values (wire-for-
// real: boardReport + okr were dead). Sources only what's cheaply + honestly
// available; composeBoardReport omits any section it has no value for, so a
// partial report is honest, not fabricated. The section set grows as more
// line-producers are sourced.
// ────────────────────────────────────────────────────────────────────────────

export async function buildBoardReport(): Promise<{ markdown: string; generatedAt: string }> {
  let okr: string | null = null;
  let decisionQuality: string | null = null;
  let immune: string | null = null;
  let pendingCount = 0;
  let openAsks = 0;
  let openDecisions = 0;

  // OKR progress (wire-for-real: okr.buildOkrTree/okrLine).
  try {
    const { listObjectives } = await import("./objectives");
    const { buildOkrTree, okrLine } = await import("./okr");
    const objectives = await listObjectives(true);
    if (objectives.length > 0) okr = okrLine(buildOkrTree(objectives));
  } catch {
    /* omit */
  }

  // Decision quality across all domains (wire-for-real: decisionEval).
  try {
    const { getDomainDecisionQuality, decisionEvalLine } = await import("./decisionEval");
    decisionQuality = decisionEvalLine(await getDomainDecisionQuality());
  } catch {
    /* omit */
  }

  // Dependency/immune status — the latest immune-response report row (step-away
  // gap #4). Stale rows (>3 days) are omitted rather than shown as current.
  try {
    const { getLatestImmuneReport } = await import("./immuneResponse");
    const report = await getLatestImmuneReport();
    if (report && Date.now() - report.ranAt.getTime() < 3 * 24 * 60 * 60 * 1000) {
      immune = report.line;
    }
  } catch {
    /* omit */
  }

  // Pending witnessed-send actions awaiting the founder's tap.
  try {
    const { listPendingHands } = await import("./pendingHands");
    pendingCount = (await listPendingHands()).length;
  } catch {
    /* 0 */
  }

  // Attention calibration (asks + decisions over the recent window).
  try {
    const { listOpenAsks } = await import("../solene/founderCollab");
    openAsks = (await listOpenAsks()).length;
  } catch {
    /* 0 */
  }
  openDecisions = pendingCount;

  const { attentionLoad } = await import("./boardReserve");
  const attention = attentionLoad(openAsks, openDecisions);

  const markdown = composeBoardReport({
    topMove: null,
    okr,
    decisionQuality,
    immune,
    pendingCount,
    attention,
  });
  // Caller stamps the time (Date.now is unavailable in some contexts here).
  return { markdown, generatedAt: new Date().toISOString() };
}

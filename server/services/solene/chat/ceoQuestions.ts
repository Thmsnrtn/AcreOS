/**
 * SOLENE CHAT — the five hard CEO questions (Launch-Week WS3 exit test).
 *
 * The committed eval fixture: each question the founder is entitled to ask
 * his company, mapped to the sources that must ground the answer. The
 * founderChatContext test asserts that the context assembly for each
 * question actually contains every required source — so a regression in
 * doc retrieval or live-state injection fails CI, not the founder.
 *
 * requiredSources vocabulary:
 *   - "live_state"            → the LIVE STATE block (always injected)
 *   - any StrategyDocSpec id  → that doc must be surfaced by retrieval
 *     (e.g. "roadmap-2026-07", "cost-audit-2026-07-07")
 */

export interface CeoEvalQuestion {
  id: string;
  question: string;
  /** Sources that MUST be present in the assembled context. */
  requiredSources: readonly string[];
  /** Why these sources ground the answer — documentation for humans. */
  grounding: string;
}

export const CEO_EVAL_QUESTIONS: readonly CeoEvalQuestion[] = [
  {
    id: "runway",
    question: "What's our runway?",
    requiredSources: ["live_state", "cost-audit-2026-07-07"],
    grounding:
      "Runway weeks come from the reserve/floor/burn ledger in LIVE STATE; the cost audit gives the bounded worst-case posture.",
  },
  {
    id: "ai-spend",
    question: "What did we spend on AI this week and against what ceiling?",
    requiredSources: ["live_state", "cost-audit-2026-07-07"],
    grounding:
      "Weekly spend + monthly envelope are LIVE STATE; the daily/monthly ceilings and their rationale live in the cost audit.",
  },
  {
    id: "next-gate",
    question: "What's the next gate on the roadmap and how far are we?",
    requiredSources: ["live_state", "roadmap-2026-07", "mature-machine"],
    grounding:
      "Gates + horizons are defined in mature-machine and sequenced in the roadmap; 'how far' is the live MRR/trials in LIVE STATE.",
  },
  {
    id: "ad-budget",
    question: "What would you do with $500 of ad budget?",
    requiredSources: ["live_state", "launch-week-2026-07"],
    grounding:
      "The first campaign recipe ($5/day, witnessed, mail-first wedge) is in the launch-week plan; envelope headroom is LIVE STATE.",
  },
  {
    id: "broke-24h",
    question: "What broke in the last 24h?",
    requiredSources: ["live_state"],
    grounding:
      "Flagged dispatches, decisions waiting, and envelope status over the last 24h are LIVE STATE — absent data must be stated absent.",
  },
];

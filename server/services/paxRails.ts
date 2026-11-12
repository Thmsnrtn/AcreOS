/**
 * Pax rails — the ONE per-call decision (PX-2, register P-1).
 *
 * `decidePaxCall(state, toolName)` is consulted by BOTH dispatch switches
 * (server/ai/tools.ts:executeTool and server/ai/supportAgent.ts:
 * executeSupportTool). It composes   pause ∧ stance ∧ rail   into one answer:
 * run it, park it as an ask, hold it as a draft, or refuse it.
 *
 * THE COMPOSITION RULE — a rail may only NARROW what the stance allows
 * ─────────────────────────────────────────────────────────────────────
 * Levels, weakest → strongest (shared/pax-controls.ts PAX_RAIL_LEVELS):
 *   watch < draft < ask < act_and_report
 *
 *   cap       = what the stance (and the tool) allow:
 *                 ask_before_everything          → ask
 *                 ALWAYS_ASK_SUPPORT_TOOLS       → ask   (billing fixes etc.)
 *                 any tool in the sends group    → ask   (founder decision 1)
 *                 otherwise (ask_before_sending) → act_and_report
 *   effective = the WEAKER of (rail, cap)  — never the stronger
 *
 *   watch          → refuse, in plain words (PAX_RAIL_COPY.watchRefusal)
 *   draft          → the call is held, not executed (parked as a pending
 *                    action the customer reviews — "draft" here means the
 *                    write is prepared and parked, never applied)
 *   ask            → parked as an ask
 *   act_and_report → runs and leaves a receipt — unless the org is paused
 *
 * Asks keep accumulating while paused (an ask is not Pax acting), so pause
 * only bites the `run` outcome. This mirrors the order the switches have
 * always used: kernel (asks) → pause.
 *
 * FAIL CLOSED: controls that could not be verified → refuse. A changes_records
 * tool with no domain → ask (never run). Groups the rails do not govern
 * (looks_and_drafts, never, an unclassified name) take the pre-PX-2 rule
 * unchanged — the stance and the pause, nothing else — so a rail can neither
 * widen nor newly gate them. The `never` group's own refusal (the FCRA gate in
 * executeTool) still fires downstream of this decision.
 *
 * A state without `rails` (a hand-built object from before PX-2) reads as the
 * defaults, which equal today's behaviour.
 *
 * Pure: no database, no clock. The state comes from getPaxControls.
 */

import {
  ALWAYS_ASK_SUPPORT_TOOLS,
  PAX_RECORD_DOMAIN_LABELS,
  PAX_SENDS_RAIL_CEILING,
  clampSendsLevel,
  defaultPaxRails,
  domainForTool,
  groupForTool,
  weakerRailLevel,
  type PaxRailLevel,
} from "@shared/pax-controls";
import { PAX_RAIL_COPY } from "@shared/pax-glossary";
import type { PaxControlsState } from "./paxControls";

type PaxDecisionKind = "run" | "ask" | "draft" | "refuse";

type PaxDecisionWhy =
  /** The controls could not be verified — refuse (callers use paxControlsRefusalMessage). */
  | "check_failed"
  /** Paused — refuse (callers use paxControlsRefusalMessage). */
  | "paused"
  /** The rail is on Watch — refuse with `message`. */
  | "rail_watch"
  /** The rail (draft / ask) is what narrowed the outcome. */
  | "rail"
  /** The stance, the sends ceiling or an always-ask tool decided it; the rail did not narrow. */
  | "stance"
  /** looks_and_drafts: never gated by a rail. */
  | "ungated"
  /** A group the rails do not govern, or a name nobody classified: the pre-PX-2 rule. */
  | "not_railed"
  /** A changes_records tool with no domain: fails closed to an ask. */
  | "no_domain";

interface PaxCallDecision {
  kind: PaxDecisionKind;
  why: PaxDecisionWhy;
  /** The plain-words refusal. Present only for why === "rail_watch". */
  message?: string;
}

/**
 * The plain-words refusal a call gets when its rail is on Watch. A BUILDER (not
 * text carried on the decision) so the two dispatch switches write their error
 * by calling it and tests/unit/refusalsArePlainWords.test.ts can call it for
 * every area and judge the words. The area label is derived from the tool the
 * same way decidePaxCall derives it: sends group → the sends label, else the
 * tool's record domain. A tool with neither gets the generic "records" label
 * (decidePaxCall never reaches Watch for such a tool).
 */
export function paxRailWatchRefusalMessage(toolName: string): string {
  return PAX_RAIL_COPY.watchRefusal(railAreaLabel(toolName));
}

function railAreaLabel(toolName: string): string {
  if (groupForTool(toolName) === "sends") return PAX_RAIL_COPY.sendsLabel;
  const domain = domainForTool(toolName);
  return domain === null ? "records" : PAX_RECORD_DOMAIN_LABELS[domain];
}

/** The pre-PX-2 rule: pause ∧ stance, no rail. */
function stanceAndPauseOnly(state: PaxControlsState, why: PaxDecisionWhy): PaxCallDecision {
  if (state.stance === "ask_before_everything") return { kind: "ask", why: "stance" };
  if (state.paused) return { kind: "refuse", why: "paused" };
  return { kind: "run", why };
}

export function decidePaxCall(state: PaxControlsState, toolName: string): PaxCallDecision {
  if (state.checkFailed) return { kind: "refuse", why: "check_failed" };

  const group = groupForTool(toolName);

  if (group === "looks_and_drafts") return { kind: "run", why: "ungated" };

  if (group === null || group === "never" || group === "runs_rules") {
    return stanceAndPauseOnly(state, "not_railed");
  }

  // changes_records | sends — the two groups a rail governs.
  const rails = state.rails ?? defaultPaxRails();
  let rail: PaxRailLevel;
  if (group === "sends") {
    rail = clampSendsLevel(rails.sends);
  } else {
    const domain = domainForTool(toolName);
    if (domain === null) return { kind: "ask", why: "no_domain" };
    rail = rails.records[domain];
  }

  const cap: PaxRailLevel =
    state.stance === "ask_before_everything" ||
    group === "sends" ||
    ALWAYS_ASK_SUPPORT_TOOLS.has(toolName)
      ? PAX_SENDS_RAIL_CEILING
      : "act_and_report";

  const effective = weakerRailLevel(rail, cap);
  const narrowedByRail = effective === rail && rail !== cap;
  const why: PaxDecisionWhy = narrowedByRail ? "rail" : "stance";

  switch (effective) {
    case "watch":
      return { kind: "refuse", why: "rail_watch", message: paxRailWatchRefusalMessage(toolName) };
    case "draft":
      return { kind: "draft", why };
    case "ask":
      return { kind: "ask", why };
    case "act_and_report":
      return state.paused ? { kind: "refuse", why: "paused" } : { kind: "run", why: "stance" };
  }
}

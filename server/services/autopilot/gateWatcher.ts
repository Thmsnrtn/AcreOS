/**
 * Founder Autopilot — the Gate-Watcher (Launch-Week WS4: the self-birthing
 * roadmap).
 *
 * Condition-gated roadmap items must detect their own moment instead of
 * waiting for a human to remember them. This module machine-encodes the
 * autonomy switch schedule (docs/company/mature-machine.md §4) plus the
 * phase triggers from docs/company/launch-week-2026-07.md WS4 (Phase-1
 * runbook at $200 MRR held 30d; Sentry paid rung at $500; Telnyx migration
 * evaluation at $3k; switch eligibility at the first paying cohort of 25).
 *
 * Design, same split as decide.ts / narrate.ts:
 *  - GATES + evaluateGate() + resolveExecutionMode() + resolveFireDecision()
 *    are PURE — deterministic, exhaustively unit-testable, no DB, no clock
 *    (the clock is an input).
 *  - runGateWatch() gathers the real inputs (live MRR + paying-org count from
 *    the same source the runway model / MRR snapshot job uses; held-30d
 *    history from mrr_snapshots), evaluates every gate, and acts on newly
 *    ripened ones.
 *
 * HONESTY RULES (the whole point):
 *  - Inputs are gathered best-effort and NEVER fabricated. An unreadable
 *    input is null, and a gate that needs it stays closed with the reason
 *    logged ("MRR unknown", "insufficient history", …).
 *  - Glass-box: EVERY evaluation is logged via the structured logger, and
 *    every run persists an experience-log row (autopilot_experiences) the
 *    founder Story surface (/founder/autopilot/story) reads.
 *  - No silent flips, ever. A ripened gate becomes a one-tap founder
 *    Decision (founderCollab ask) UNLESS the studio dial (revenue.triggers)
 *    already says autoApprove for that exact action — and even then the
 *    permanent hard-stops (pricing / legal / >$500 spend / customer-data
 *    deletion) can NEVER auto-execute, regardless of any dial.
 *  - Dedup: a gate with an open ask, an answered ask, or a completed
 *    auto-execution never re-fires. State persists in the generic
 *    founder_settings key-value table (gate_watcher.state.<gateId>) — no new
 *    table needed.
 */

import { gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { founderSettings, mrrSnapshots } from "@shared/schema";
import { logger } from "../../utils/logger";

// ============================================
// Pure data — the hard-stop list and the gates
// ============================================

/**
 * The permanent hard-stops (mature-machine §1.4 + §4, final row): these
 * classes of action are NEVER autonomous, forever. Encoded as data so tests
 * can pin the list and so the ask bodies can cite it verbatim.
 */
export const HARD_STOPS = [
  "pricing_changes",
  "legal_signing",
  "spend_over_500_usd",
  "customer_data_deletion",
] as const;

/** The ">$500 spend" hard-stop, as a machine constant (USD). */
export const HARD_STOP_SPEND_LIMIT_USD = 500;

export type GateConditionSpec =
  | { kind: "mrr_at_least"; thresholdCents: number }
  | { kind: "mrr_held_at_least"; thresholdCents: number; heldDays: number }
  | { kind: "paying_orgs_at_least"; threshold: number }
  /** Permanent hard-stop rows: the condition NEVER ripens by design. */
  | { kind: "never"; note: string };

export interface GateActionSpec {
  /**
   * founder_ask     — ripening raises a one-tap founder Decision (always the
   *                   case for switch-eligibility and evaluation gates —
   *                   "no silent flips, ever").
   * studio_trigger  — the action corresponds to a revenue-trigger ladder row
   *                   in the studio dials (setting key `revenue.triggers`).
   *                   MAY auto-execute, but ONLY when that dial row already
   *                   says autoApprove — otherwise it asks like everything
   *                   else.
   */
  kind: "founder_ask" | "studio_trigger";
  /**
   * For studio_trigger: case-insensitive substring matched against the dial
   * row's action name (the two historical dial shapes name the Sentry row
   * "sentry_starter" / "Sentry team tier + alerting" — a substring survives
   * both).
   */
  dialActionPattern?: string;
  /** One-tap Decision copy (summary is the pager subject line). */
  summary: string;
  body: string;
}

export interface GateDefinition {
  id: string;
  description: string;
  /** Where this gate is ratified — the doc a reader should open. */
  source: string;
  condition: GateConditionSpec;
  action: GateActionSpec;
  /**
   * true → this gate may ONLY ever raise a founder ask; auto-execution is
   * forbidden regardless of any dial, forever (mature-machine §4 final row).
   */
  hardStop: boolean;
}

const SWITCH_ASK_FOOTER = [
  "",
  "Eligibility is NOT a flip: every promotion still requires the trust",
  "ledger's earned clean cycles plus the proof listed above",
  "(mature-machine.md §4 — the schedule is when a domain becomes eligible,",
  "not a bypass). Answer 'yes' to acknowledge eligibility and begin the",
  "proof cycle, 'no' to hold.",
].join("\n");

/**
 * The machine-encoded schedule. Every row of mature-machine §4 plus the
 * launch-week WS4 phase triggers. Customer-count thresholds come from the
 * maturity gates (§2): G1 = 25 paying, G2 = 100 paying, G3 = ~500 paying;
 * H2 begins at the G1 crossing. The G-gates are AND-conditions (revenue AND
 * reliability AND autonomy AND economics) — only the customer/MRR component
 * is machine-readable today, so each ask states the remaining human-judged
 * proof requirements instead of pretending they were checked.
 */
export const GATES: GateDefinition[] = [
  // ── Phase / infra triggers (launch-week WS4 named set) ────────────────────
  {
    id: "phase1_runbook",
    description: "Phase-1 launch runbook fires at $200 MRR held 30 consecutive days",
    source: "docs/company/phase-1-launch-runbook.md; mature-machine.md §2 (G1 row) + §3 H1",
    condition: { kind: "mrr_held_at_least", thresholdCents: 200_00, heldDays: 30 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Phase-1 runbook trigger has ripened ($200 MRR held 30 days)",
      body: [
        "MRR has held at or above $200 for 30 consecutive days (verified",
        "against mrr_snapshots history, not a point read).",
        "",
        "Per the pre-committed schedule this fires the Phase-1 launch",
        "runbook (docs/company/phase-1-launch-runbook.md). Answer 'yes' to",
        "start executing the runbook, 'no' to hold.",
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "sentry_paid_rung",
    description: "Sentry paid rung at $500 MRR (revenue-trigger ladder)",
    source: "docs/company/launch-week-2026-07.md WS4; /founder/studio/triggers ladder",
    condition: { kind: "mrr_at_least", thresholdCents: 500_00 },
    action: {
      kind: "studio_trigger",
      dialActionPattern: "sentry",
      summary: "[gate] Sentry paid rung has ripened (MRR ≥ $500)",
      body: [
        "Live MRR has reached $500. The revenue-trigger ladder's Sentry rung",
        "(paid tier + alerting, ~$26/mo) is now justified.",
        "",
        "Answer 'yes' to approve upgrading Sentry to the paid tier, 'no' to",
        "skip for now.",
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "telnyx_migration_eval",
    description: "Telnyx migration evaluation at $3,000 MRR",
    source: "docs/company/launch-week-2026-07.md WS4; /founder/studio/triggers ladder",
    condition: { kind: "mrr_at_least", thresholdCents: 3_000_00 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Telnyx migration evaluation has ripened (MRR ≥ $3,000)",
      body: [
        "Live MRR has reached $3,000 — the pre-committed point to EVALUATE",
        "migrating SMS/voice to Telnyx (A2P 10DLC economics, per-message",
        "cost, deliverability).",
        "",
        "This gate asks for an evaluation, not a migration. Answer 'yes' to",
        "commission the comparison memo, 'no' to defer.",
      ].join("\n"),
    },
    hardStop: false,
  },

  // ── Autonomy switch schedule (mature-machine §4, row by row) ──────────────
  {
    id: "switch_support_auto_resolve",
    description: "Support auto-resolve eligible at G1 cohort live (25 paying customers)",
    source: "docs/company/mature-machine.md §4 (Support auto-resolve)",
    condition: { kind: "paying_orgs_at_least", threshold: 25 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Support auto-resolve is now ELIGIBLE (first paying cohort live)",
      body: [
        "The first paying cohort (≥25 paying customers) is live, so the",
        "support auto-resolve domain is now ELIGIBLE per the §4 schedule.",
        "",
        "Proof still required before acting: 10 clean witnessed cycles on",
        "real tickets. Permanent constraints: escalation path always open;",
        "refunds remain a hard-stop.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_dunning_billing_recovery",
    description: "Dunning / billing recovery eligible at G1 (25 paying customers)",
    source: "docs/company/mature-machine.md §4 (Dunning / billing recovery)",
    condition: { kind: "paying_orgs_at_least", threshold: 25 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Dunning / billing recovery is now ELIGIBLE (G1)",
      body: [
        "The first paying cohort (≥25 paying customers) is live, so the",
        "dunning / billing-recovery domain is now ELIGIBLE per §4.",
        "",
        "Proof still required before acting: recovery ladder measured",
        "working; reversible sends only. Permanent constraint: no pricing",
        "changes, ever (pricing is a hard-stop).",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_deliverability_compliance",
    description: "Deliverability & compliance ops eligible at G1 (execute_gated)",
    source: "docs/company/mature-machine.md §4 (Deliverability & compliance ops)",
    condition: { kind: "paying_orgs_at_least", threshold: 25 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Deliverability & compliance ops now ELIGIBLE for execute_gated (G1)",
      body: [
        "The first paying cohort (≥25 paying customers) is live, so",
        "deliverability & compliance ops is now ELIGIBLE for execute_gated",
        "per §4.",
        "",
        "Proof still required: clean scrub + STOP audit trail. Permanent",
        "constraint: DNC scrub fail-closed for cold outreach.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_content_seo",
    description: "Growth content/SEO eligible at G2 (100 paying customers)",
    source: "docs/company/mature-machine.md §4 (Growth: content/SEO) + §2 G2",
    condition: { kind: "paying_orgs_at_least", threshold: 100 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Growth content/SEO now ELIGIBLE (G2 customer count reached)",
      body: [
        "Paying customers have reached 100 (the G2 customer-count",
        "component), so content/SEO acting is now ELIGIBLE per §4.",
        "",
        "G2 is an AND-gate — verify the remaining human-judged conditions",
        "(≥10 closed deals in transaction_training, 99.9% quarterly probe",
        "uptime, LOC/table ratchet) before flipping. Proof still required:",
        "brand-constitution conformance on a witnessed batch. Permanent",
        "constraint: no claims the truth-engine can't verify.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_paid_ads_gated",
    description: "Growth paid ads eligible for execute_gated at G2 (100 paying customers)",
    source: "docs/company/mature-machine.md §4 (Growth: paid ads, G2 execute_gated)",
    condition: { kind: "paying_orgs_at_least", threshold: 100 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Paid ads now ELIGIBLE for execute_gated (G2 customer count reached)",
      body: [
        "Paying customers have reached 100 (the G2 customer-count",
        "component), so paid ads execute_gated is now ELIGIBLE per §4.",
        "",
        "Proof still required: CAC truth exists; budget ramp steps earned",
        "+50% at a time. Permanent constraints: quarterly ceiling is",
        "founder-set; the panic stop halts spend.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_paid_ads_execute",
    description: "Growth paid ads eligible for full execute at G3 (~500 paying customers)",
    source: "docs/company/mature-machine.md §4 (Growth: paid ads, G3 execute)",
    condition: { kind: "paying_orgs_at_least", threshold: 500 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Paid ads now ELIGIBLE for full execute (G3 customer count reached)",
      body: [
        "Paying customers have reached ~500 (the G3 customer-count",
        "component), so paid-ads full execute (within the budget ramp) is",
        "now ELIGIBLE per §4.",
        "",
        "Verify the remaining G3 conditions (servicing GA ≥50 loans, <1",
        "founder page/week, ≥80% incidents auto-resolved, non-subscription",
        "revenue ≥30%) before flipping. Permanent constraints unchanged:",
        "founder-set quarterly ceiling; panic stop halts spend.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_self_patch_pr_mode",
    description: "Self-patch engineering eligible for PR-mode at H2 entry (25 paying customers)",
    source: "docs/company/mature-machine.md §4 (Self-patch engineering, H2 PR-mode) + §3 H2",
    condition: { kind: "paying_orgs_at_least", threshold: 25 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Self-patch PR-mode is now ELIGIBLE (H2 entered)",
      body: [
        "The first paying cohort (≥25 paying customers) is live, which",
        "enters H2 — where self-patch flips to PR-mode, aimed first at",
        "deletion work (the safest class of autonomous engineering).",
        "",
        "Proof still required: green CI + canary + clean revert path per",
        "class. Permanent constraint: PR-gated forever for all classes",
        "except deletion/green-dependency auto-merge (which waits for G3).",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_self_patch_auto_merge",
    description: "Self-patch auto-merge (deletion/dependency classes only) eligible at G3",
    source: "docs/company/mature-machine.md §4 (Self-patch engineering, G3 auto-merge)",
    condition: { kind: "paying_orgs_at_least", threshold: 500 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Self-patch auto-merge (deletion/dep classes) now ELIGIBLE (G3)",
      body: [
        "Paying customers have reached ~500 (the G3 customer-count",
        "component), so self-patch auto-merge for the deletion and",
        "green-dependency-patch classes ONLY is now ELIGIBLE per §4.",
        "",
        "Proof still required: green CI + canary + clean revert path per",
        "class. Permanent constraint: every other class stays PR-gated",
        "forever.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },
  {
    id: "switch_incident_response_ga",
    description: "Autonomous incident response GA eligible at G3 (~500 paying customers)",
    source: "docs/company/mature-machine.md §4 (Incident response, G3 GA)",
    condition: { kind: "paying_orgs_at_least", threshold: 500 },
    action: {
      kind: "founder_ask",
      summary: "[gate] Autonomous incident response GA now ELIGIBLE (G3)",
      body: [
        "Paying customers have reached ~500 (the G3 customer-count",
        "component), so autonomous incident response GA is now ELIGIBLE",
        "per §4.",
        "",
        "Proof still required: ≥80% auto-resolution on shadowed incidents.",
        "Permanent constraint: novel-class and money/legal incidents always",
        "page.",
        SWITCH_ASK_FOOTER,
      ].join("\n"),
    },
    hardStop: false,
  },

  // ── The permanent hard-stop row (never ripens; encoded so the schedule is
  //    complete and the never-auto-execute invariant is pinned by tests) ─────
  {
    id: "hard_stop_pricing_legal_spend_deletion",
    description:
      "Pricing changes, legal signing, spend >$500, customer-data deletion — never autonomous, permanent hard-stops",
    source: "docs/company/mature-machine.md §4 (final row) + §1.4",
    condition: {
      kind: "never",
      note: "Permanent hard-stops have no eligibility condition — they never ripen; the env-level panic stop stays unwritable by the machine, forever.",
    },
    action: {
      kind: "founder_ask",
      summary: "[gate] hard-stop row — this ask should never fire",
      body:
        "This gate exists only as the machine encoding of the permanent hard-stop list. Its condition never ripens.",
    },
    hardStop: true,
  },
];

// ============================================
// Pure evaluation
// ============================================

export interface MrrHistoryPoint {
  capturedAt: Date;
  mrrCents: number;
}

export interface GateInputs {
  now: Date;
  /** Live MRR in cents (same source as the runway model / snapshot job). null = unreadable, never guessed. */
  mrrCents: number | null;
  /** Live paying-org count. null = unreadable. */
  payingOrgs: number | null;
  /** mrr_snapshots history (ascending capturedAt). null = table unreadable. */
  mrrHistory: MrrHistoryPoint[] | null;
}

export interface GateEvaluation {
  gateId: string;
  ripe: boolean;
  /** Always populated — the glass-box "why" for BOTH outcomes. */
  reason: string;
  observed: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluate one gate against the gathered inputs. Pure and total: unknown
 * (null) inputs keep the gate CLOSED with the reason stated — a gate never
 * ripens off a fabricated number.
 */
export function evaluateGate(gate: GateDefinition, inputs: GateInputs): GateEvaluation {
  const cond = gate.condition;

  if (cond.kind === "never") {
    return {
      gateId: gate.id,
      ripe: false,
      reason: `permanent hard-stop row — never ripens (${cond.note})`,
      observed: { hardStops: HARD_STOPS },
    };
  }

  if (cond.kind === "paying_orgs_at_least") {
    if (inputs.payingOrgs === null) {
      return {
        gateId: gate.id,
        ripe: false,
        reason: "paying-org count unknown (input unreadable — never fabricated); gate stays closed",
        observed: { payingOrgs: null, threshold: cond.threshold },
      };
    }
    const ripe = inputs.payingOrgs >= cond.threshold;
    return {
      gateId: gate.id,
      ripe,
      reason: ripe
        ? `paying orgs ${inputs.payingOrgs} ≥ threshold ${cond.threshold}`
        : `paying orgs ${inputs.payingOrgs} < threshold ${cond.threshold}`,
      observed: { payingOrgs: inputs.payingOrgs, threshold: cond.threshold },
    };
  }

  if (cond.kind === "mrr_at_least") {
    if (inputs.mrrCents === null) {
      return {
        gateId: gate.id,
        ripe: false,
        reason: "MRR unknown (input unreadable — never fabricated); gate stays closed",
        observed: { mrrCents: null, thresholdCents: cond.thresholdCents },
      };
    }
    const ripe = inputs.mrrCents >= cond.thresholdCents;
    return {
      gateId: gate.id,
      ripe,
      reason: ripe
        ? `MRR ${inputs.mrrCents}c ≥ threshold ${cond.thresholdCents}c`
        : `MRR ${inputs.mrrCents}c < threshold ${cond.thresholdCents}c`,
      observed: { mrrCents: inputs.mrrCents, thresholdCents: cond.thresholdCents },
    };
  }

  // mrr_held_at_least — needs BOTH a live reading and real history. The rule:
  //   1. current MRR ≥ threshold;
  //   2. a snapshot exists at/older than heldDays ago whose MRR was already
  //      ≥ threshold (proof the hold STARTED at least heldDays ago);
  //   3. no snapshot inside the window dipped below threshold.
  // Insufficient history is an honest "not yet provable", not a pass.
  const observedBase = {
    thresholdCents: cond.thresholdCents,
    heldDays: cond.heldDays,
    mrrCents: inputs.mrrCents,
    historyPoints: inputs.mrrHistory?.length ?? null,
  };
  if (inputs.mrrCents === null) {
    return {
      gateId: gate.id,
      ripe: false,
      reason: "MRR unknown (input unreadable — never fabricated); gate stays closed",
      observed: observedBase,
    };
  }
  if (inputs.mrrCents < cond.thresholdCents) {
    return {
      gateId: gate.id,
      ripe: false,
      reason: `current MRR ${inputs.mrrCents}c < threshold ${cond.thresholdCents}c`,
      observed: observedBase,
    };
  }
  if (inputs.mrrHistory === null) {
    return {
      gateId: gate.id,
      ripe: false,
      reason: "mrr_snapshots history unreadable — held-window cannot be proven; gate stays closed",
      observed: observedBase,
    };
  }
  const windowStart = new Date(inputs.now.getTime() - cond.heldDays * DAY_MS);
  const atOrBeforeStart = inputs.mrrHistory.filter((p) => p.capturedAt.getTime() <= windowStart.getTime());
  const startEvidence = atOrBeforeStart.length > 0 ? atOrBeforeStart[atOrBeforeStart.length - 1] : null;
  if (!startEvidence) {
    const oldest = inputs.mrrHistory[0] ?? null;
    const oldestAgeDays = oldest
      ? Math.floor((inputs.now.getTime() - oldest.capturedAt.getTime()) / DAY_MS)
      : null;
    return {
      gateId: gate.id,
      ripe: false,
      reason:
        oldestAgeDays === null
          ? `insufficient history: no mrr_snapshots rows at all — held-${cond.heldDays}d cannot be proven yet`
          : `insufficient history: oldest snapshot is only ${oldestAgeDays}d old (need ≥${cond.heldDays}d) — held-${cond.heldDays}d cannot be proven yet`,
      observed: { ...observedBase, oldestSnapshotAgeDays: oldestAgeDays },
    };
  }
  if (startEvidence.mrrCents < cond.thresholdCents) {
    return {
      gateId: gate.id,
      ripe: false,
      reason: `MRR was ${startEvidence.mrrCents}c (< ${cond.thresholdCents}c) at the start of the ${cond.heldDays}d window — hold not yet ${cond.heldDays} days old`,
      observed: { ...observedBase, windowStartMrrCents: startEvidence.mrrCents },
    };
  }
  const dip = inputs.mrrHistory.find(
    (p) => p.capturedAt.getTime() > windowStart.getTime() && p.mrrCents < cond.thresholdCents,
  );
  if (dip) {
    return {
      gateId: gate.id,
      ripe: false,
      reason: `MRR dipped to ${dip.mrrCents}c (< ${cond.thresholdCents}c) on ${dip.capturedAt.toISOString()} — hold broken inside the ${cond.heldDays}d window`,
      observed: { ...observedBase, dipAt: dip.capturedAt.toISOString(), dipMrrCents: dip.mrrCents },
    };
  }
  return {
    gateId: gate.id,
    ripe: true,
    reason: `MRR ≥ ${cond.thresholdCents}c held for ${cond.heldDays} consecutive days (window-start evidence + no in-window dip + current reading)`,
    observed: { ...observedBase, windowStartMrrCents: startEvidence.mrrCents },
  };
}

// ============================================
// Pure execution-mode resolution (ask vs auto)
// ============================================

/**
 * A studio revenue-trigger dial row, normalized. Two shapes exist in the
 * wild: the settingsSeeder default `{ threshold(cents), action, autoApprove }`
 * and the /founder/studio shape `{ mrr(USD), action, oneTimeCost,
 * recurringCost, status, autoApprove }`. Unknown fields stay null so the
 * resolver can fail closed on them honestly.
 */
export interface NormalizedDialRow {
  action: string;
  thresholdUsd: number | null;
  autoApprove: boolean;
  status: string;
  oneTimeCostUsd: number | null;
  recurringCostUsd: number | null;
}

export function normalizeDialRows(raw: unknown): NormalizedDialRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: NormalizedDialRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const action = typeof o.action === "string" ? o.action : null;
    if (!action) continue;
    let thresholdUsd: number | null = null;
    if (typeof o.mrr === "number" && Number.isFinite(o.mrr)) {
      thresholdUsd = o.mrr; // studio shape: USD
    } else if (typeof o.threshold === "number" && Number.isFinite(o.threshold)) {
      thresholdUsd = o.threshold / 100; // seeded shape: cents
    }
    rows.push({
      action,
      thresholdUsd,
      autoApprove: o.autoApprove === true,
      status: typeof o.status === "string" ? o.status : "pending",
      oneTimeCostUsd: typeof o.oneTimeCost === "number" && Number.isFinite(o.oneTimeCost) ? o.oneTimeCost : null,
      recurringCostUsd:
        typeof o.recurringCost === "number" && Number.isFinite(o.recurringCost) ? o.recurringCost : null,
    });
  }
  return rows;
}

export interface ExecutionModeDecision {
  mode: "ask" | "auto_execute";
  reason: string;
  /** The dial row that authorized auto-execution (auto_execute only). */
  dial?: NormalizedDialRow;
}

/**
 * Decide whether a RIPENED gate may auto-execute or must ask. Pure. The
 * ordering is the safety argument:
 *   1. hardStop gates can never auto-execute, regardless of any dial.
 *   2. Only studio_trigger actions have execution machinery at all.
 *   3. The dial must be readable, matched, autoApprove=true, still pending.
 *   4. Costs must be KNOWN and under the $500 hard-stop — unknown cost
 *      fails closed to ask.
 */
export function resolveExecutionMode(
  gate: GateDefinition,
  dials: NormalizedDialRow[] | null,
): ExecutionModeDecision {
  if (gate.hardStop) {
    return {
      mode: "ask",
      reason:
        "hard-stop gate: may only ever raise a founder Decision — auto-execution forbidden regardless of any dial (mature-machine §4, permanent)",
    };
  }
  if (gate.action.kind !== "studio_trigger" || !gate.action.dialActionPattern) {
    return { mode: "ask", reason: "gate action is a founder Decision by design (no auto-execution machinery)" };
  }
  if (dials === null) {
    return { mode: "ask", reason: "studio dial (revenue.triggers) unreadable — failing closed to a founder ask" };
  }
  const pattern = gate.action.dialActionPattern.toLowerCase();
  const dial = dials.find((d) => d.action.toLowerCase().includes(pattern)) ?? null;
  if (!dial) {
    return { mode: "ask", reason: `no studio dial row matches '${gate.action.dialActionPattern}' — asking instead` };
  }
  if (!dial.autoApprove) {
    return { mode: "ask", reason: `studio dial '${dial.action}' does not say autoApprove — asking` };
  }
  if (dial.status !== "pending") {
    return { mode: "ask", reason: `studio dial '${dial.action}' status='${dial.status}' (not pending) — asking` };
  }
  if (dial.oneTimeCostUsd === null || dial.recurringCostUsd === null) {
    return {
      mode: "ask",
      reason: `studio dial '${dial.action}' carries no cost data — cannot prove the >$${HARD_STOP_SPEND_LIMIT_USD} hard-stop is respected; failing closed to a founder ask`,
    };
  }
  if (dial.oneTimeCostUsd > HARD_STOP_SPEND_LIMIT_USD || dial.recurringCostUsd > HARD_STOP_SPEND_LIMIT_USD) {
    return {
      mode: "ask",
      reason: `studio dial '${dial.action}' spend ($${dial.oneTimeCostUsd} one-time / $${dial.recurringCostUsd}/mo) exceeds the permanent >$${HARD_STOP_SPEND_LIMIT_USD} spend hard-stop — auto-execution forbidden`,
    };
  }
  return {
    mode: "auto_execute",
    reason: `studio dial '${dial.action}' says autoApprove (status pending, spend within the $${HARD_STOP_SPEND_LIMIT_USD} hard-stop)`,
    dial,
  };
}

// ============================================
// Pure dedup / fire decision
// ============================================

export interface GateState {
  status: "ask_raised" | "auto_executed";
  askId?: number | null;
  at: string;
  detail?: string;
}

export type PriorAskStatus = "open" | "answered" | "timed_out" | "superseded" | "missing";

/**
 * Decide whether a gate should fire THIS run, given its evaluation, its
 * persisted state, and (when the state points at an ask) that ask's current
 * status. Pure. Rules:
 *  - not ripe → never fires;
 *  - no prior state → fires (newly ripened);
 *  - auto_executed → never re-fires;
 *  - ask still open → waits (the escalation ladder handles re-paging);
 *  - ask answered → the founder decided; never re-fires (re-arming is a
 *    deliberate founder action: clear the gate state);
 *  - ask timed_out / superseded / missing → re-fires (the safe side of a
 *    timeout was not-acting; a still-ripe gate re-asks);
 *  - ask status UNKNOWN (read failed) → fails closed: skip.
 */
export function resolveFireDecision(args: {
  ripe: boolean;
  state: GateState | null;
  askStatus?: PriorAskStatus | null;
}): { fire: boolean; reason: string } {
  if (!args.ripe) return { fire: false, reason: "gate not ripe" };
  if (!args.state) return { fire: true, reason: "gate newly ripened — no prior action recorded" };
  if (args.state.status === "auto_executed") {
    return { fire: false, reason: `already auto-executed at ${args.state.at} — will not re-fire` };
  }
  // ask_raised
  const askStatus = args.askStatus ?? null;
  if (askStatus === null) {
    return { fire: false, reason: "prior ask status unknown (read failed) — failing closed, not re-firing" };
  }
  switch (askStatus) {
    case "open":
      return { fire: false, reason: `ask #${args.state.askId ?? "?"} still open — waiting on the founder` };
    case "answered":
      return {
        fire: false,
        reason: `founder already decided (ask #${args.state.askId ?? "?"} answered) — will not re-fire; clear gate_watcher state to re-arm`,
      };
    case "timed_out":
    case "superseded":
    case "missing":
      return {
        fire: true,
        reason: `prior ask #${args.state.askId ?? "?"} is ${askStatus} and the gate is still ripe — re-raising`,
      };
  }
}

// ============================================
// Input gathering (best-effort, honest nulls)
// ============================================

/** How far back we read mrr_snapshots — comfortably covers a 30d held-window with weekly snapshots. */
const HISTORY_WINDOW_DAYS = 60;

export async function gatherGateInputs(now = new Date()): Promise<GateInputs> {
  let mrrCents: number | null = null;
  let payingOrgs: number | null = null;
  try {
    // The exact source captureMrrSnapshot / the runway model use.
    const { liveMrrDetail } = await import("../finance/runwayModel");
    const detail = await liveMrrDetail();
    mrrCents = detail.cents;
    payingOrgs = detail.payingOrgs;
  } catch (err) {
    logger.warn("[gateWatcher] live MRR read failed — inputs stay null (gates needing them stay closed)", err instanceof Error ? err : undefined);
  }

  let mrrHistory: MrrHistoryPoint[] | null = null;
  try {
    const since = new Date(now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS);
    const rows = await db
      .select({ capturedAt: mrrSnapshots.capturedAt, mrrCents: mrrSnapshots.mrrCents })
      .from(mrrSnapshots)
      .where(gte(mrrSnapshots.capturedAt, since))
      .orderBy(mrrSnapshots.capturedAt);
    mrrHistory = rows;
  } catch (err) {
    logger.warn("[gateWatcher] mrr_snapshots history read failed — held-window gates stay closed", err instanceof Error ? err : undefined);
  }

  return { now, mrrCents, payingOrgs, mrrHistory };
}

// ============================================
// State persistence (founder_settings key-value rows)
// ============================================

export const GATE_STATE_KEY_PREFIX = "gate_watcher.state.";
const gateStateKey = (gateId: string) => `${GATE_STATE_KEY_PREFIX}${gateId}`;

async function loadGateStates(gateIds: string[]): Promise<Map<string, GateState>> {
  const states = new Map<string, GateState>();
  const rows = await db
    .select({ key: founderSettings.key, value: founderSettings.value })
    .from(founderSettings)
    .where(inArray(founderSettings.key, gateIds.map(gateStateKey)));
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as GateState;
      if (parsed && (parsed.status === "ask_raised" || parsed.status === "auto_executed")) {
        states.set(row.key.slice(GATE_STATE_KEY_PREFIX.length), parsed);
      }
    } catch {
      logger.warn("[gateWatcher] unparseable gate state row — treating as no state", {
        metadata: { key: row.key },
      });
    }
  }
  return states;
}

async function saveGateState(gate: GateDefinition, state: GateState): Promise<void> {
  const key = gateStateKey(gate.id);
  const value = JSON.stringify(state);
  await db
    .insert(founderSettings)
    .values({
      key,
      value,
      valueType: "json",
      description: `Gate-watcher state for '${gate.id}' (${gate.description})`,
      category: "general",
      updatedBy: "gate-watcher",
    })
    .onConflictDoUpdate({
      target: founderSettings.key,
      set: { value, updatedAt: new Date(), updatedBy: "gate-watcher" },
    });
}

// ============================================
// The watch run
// ============================================

export interface GateWatchResult {
  ranAt: string;
  evaluations: GateEvaluation[];
  fired: Array<{ gateId: string; mode: "ask" | "auto_execute"; askId: number | null; reason: string }>;
  skipped: Array<{ gateId: string; reason: string }>;
  /** The run-level experience-log row id (Story surface), null when the write failed. */
  experienceId: number | null;
}

/**
 * One watch tick: gather inputs → evaluate every gate (each evaluation
 * logged) → for newly-ripened gates, raise a one-tap founder Decision or
 * auto-execute where the studio dial already says autoApprove → persist
 * state + a Story-readable experience row. Total: never throws (a watcher
 * that crashes silently is the failure mode this exists to kill).
 */
export async function runGateWatch(now = new Date()): Promise<GateWatchResult> {
  const result: GateWatchResult = {
    ranAt: now.toISOString(),
    evaluations: [],
    fired: [],
    skipped: [],
    experienceId: null,
  };

  try {
    const inputs = await gatherGateInputs(now);
    const states = await loadGateStates(GATES.map((g) => g.id));

    // Studio dial (revenue.triggers) — null when unreadable so the resolver
    // fails closed to asks. No fallback defaults: the watcher only ever
    // auto-executes off a dial the founder can see in /founder/studio.
    let dials: NormalizedDialRow[] | null = null;
    try {
      const { getSetting } = await import("../settings");
      const raw = await getSetting<unknown>("revenue.triggers", null);
      dials = raw === null ? null : normalizeDialRows(raw);
    } catch (err) {
      logger.warn("[gateWatcher] revenue.triggers dial read failed — auto-approve unavailable this run", err instanceof Error ? err : undefined);
    }

    for (const gate of GATES) {
      const evaluation = evaluateGate(gate, inputs);
      result.evaluations.push(evaluation);
      // Glass-box: EVERY evaluation is a structured log line, ripe or not.
      logger.info("[gateWatcher] gate evaluated", {
        metadata: {
          gateId: gate.id,
          ripe: evaluation.ripe,
          reason: evaluation.reason,
          observed: evaluation.observed,
          hardStop: gate.hardStop,
          source: gate.source,
        },
      });

      const state = states.get(gate.id) ?? null;
      let askStatus: PriorAskStatus | null = null;
      if (evaluation.ripe && state?.status === "ask_raised" && state.askId != null) {
        try {
          const { getAsk } = await import("../solene/founderCollab");
          const ask = await getAsk(state.askId);
          askStatus = ask ? (ask.status as PriorAskStatus) : "missing";
        } catch (err) {
          askStatus = null; // read failed → resolveFireDecision fails closed
          logger.warn("[gateWatcher] prior ask read failed — failing closed for this gate", err instanceof Error ? err : undefined);
        }
      }

      const decision = resolveFireDecision({ ripe: evaluation.ripe, state, askStatus });
      if (!decision.fire) {
        result.skipped.push({ gateId: gate.id, reason: decision.reason });
        if (evaluation.ripe) {
          logger.info("[gateWatcher] ripe gate deduped", {
            metadata: { gateId: gate.id, reason: decision.reason },
          });
        }
        continue;
      }

      // The gate fires. Ask vs auto-execute, hard-stops always ask.
      const exec = resolveExecutionMode(gate, dials);
      try {
        if (exec.mode === "auto_execute" && exec.dial) {
          await autoExecuteStudioTrigger(gate, exec.dial, evaluation);
          await saveGateState(gate, {
            status: "auto_executed",
            askId: null,
            at: now.toISOString(),
            detail: exec.reason,
          });
          result.fired.push({ gateId: gate.id, mode: "auto_execute", askId: null, reason: exec.reason });
          logger.info("[gateWatcher] gate auto-executed (studio dial autoApprove)", {
            metadata: { gateId: gate.id, dialAction: exec.dial.action, reason: exec.reason },
          });
        } else {
          const askId = await raiseGateAsk(gate, evaluation, exec.reason);
          await saveGateState(gate, {
            status: "ask_raised",
            askId,
            at: now.toISOString(),
            detail: exec.reason,
          });
          result.fired.push({ gateId: gate.id, mode: "ask", askId, reason: exec.reason });
          logger.info("[gateWatcher] gate ripened → founder Decision raised", {
            metadata: { gateId: gate.id, askId, reason: exec.reason },
          });
        }
      } catch (err) {
        // A failed action leaves NO state, so the next run retries.
        result.skipped.push({
          gateId: gate.id,
          reason: `fire failed (will retry next run): ${err instanceof Error ? err.message : String(err)}`,
        });
        logger.error("[gateWatcher] gate fire failed — no state recorded, next run retries", err instanceof Error ? err : undefined);
      }
    }

    // Persist the run-level, Story-readable evaluation record — always, even
    // (especially) on all-quiet runs: the glass box shows the watching, not
    // just the acting.
    try {
      const { recordExperience } = await import("./experienceLog");
      const outcome =
        result.fired.some((f) => f.mode === "auto_execute")
          ? ("acted" as const)
          : result.fired.length > 0
            ? ("escalated" as const)
            : ("suppressed" as const);
      const narrative =
        result.fired.length === 0
          ? `Gate watch: evaluated ${result.evaluations.length} gates — none newly ripe. ${summarizeInputs(inputs)}`
          : `Gate watch: ${result.fired.length} gate(s) fired (${result.fired
              .map((f) => `${f.gateId}→${f.mode}`)
              .join(", ")}) out of ${result.evaluations.length} evaluated. ${summarizeInputs(inputs)}`;
      result.experienceId = await recordExperience({
        moveKind: "gate_watch",
        domain: "governance",
        playId: null,
        outcome,
        reasoningTrace: {
          narrative,
          inputs: {
            mrrCents: inputs.mrrCents,
            payingOrgs: inputs.payingOrgs,
            historyPoints: inputs.mrrHistory?.length ?? null,
          },
          evaluations: result.evaluations,
          fired: result.fired,
          skipped: result.skipped,
        },
      });
    } catch (err) {
      logger.warn("[gateWatcher] experience-log write failed (run still logged)", err instanceof Error ? err : undefined);
    }
  } catch (err) {
    logger.error("[gateWatcher] watch run failed", err instanceof Error ? err : undefined);
  }

  return result;
}

function summarizeInputs(inputs: GateInputs): string {
  const mrr = inputs.mrrCents === null ? "MRR unknown" : `MRR $${(inputs.mrrCents / 100).toFixed(0)}`;
  const orgs = inputs.payingOrgs === null ? "paying orgs unknown" : `${inputs.payingOrgs} paying`;
  const hist =
    inputs.mrrHistory === null ? "history unreadable" : `${inputs.mrrHistory.length} snapshot(s) in ${HISTORY_WINDOW_DAYS}d`;
  return `Inputs: ${mrr}, ${orgs}, ${hist}.`;
}

/** Raise the one-tap founder Decision for a ripened gate. Returns the ask id. */
async function raiseGateAsk(
  gate: GateDefinition,
  evaluation: GateEvaluation,
  executionReason: string,
): Promise<number> {
  const { askFounder } = await import("../solene/founderCollab");
  const body = [
    gate.action.body,
    "",
    `Condition met: ${evaluation.reason}`,
    `Observed: ${JSON.stringify(evaluation.observed)}`,
    `Why this is an ask, not an auto-execution: ${executionReason}`,
    `Source: ${gate.source}`,
  ].join("\n");
  const { askId } = await askFounder({
    askingAgentRole: "general-purpose",
    questionSummary: gate.action.summary,
    questionBody: body,
    answerFormat: "yes_no",
    urgency: "normal",
    timeoutHours: 72,
  });

  // A per-gate experience row carrying the askId, so the founder's yes/no
  // verdict accretes onto the learning ledger via founderCollab's existing
  // recordFounderVerdict hook.
  try {
    const { recordExperience } = await import("./experienceLog");
    await recordExperience({
      moveKind: "gate_ripened",
      domain: "governance",
      playId: gate.id,
      outcome: "escalated",
      askId,
      reasoningTrace: {
        narrative: `Gate '${gate.id}' ripened (${evaluation.reason}) — raised founder Decision #${askId}.`,
        evaluation,
        executionReason,
        source: gate.source,
      },
    });
  } catch (err) {
    logger.warn("[gateWatcher] per-gate experience write failed (ask still raised)", err instanceof Error ? err : undefined);
  }
  return askId;
}

/**
 * Auto-execute a studio-trigger gate: flip the matching revenue.triggers
 * dial row to status 'active' (the studio surface then shows it as done) and
 * record the acted experience. Throws on failure so the caller records no
 * state and the next run retries.
 */
async function autoExecuteStudioTrigger(
  gate: GateDefinition,
  dial: NormalizedDialRow,
  evaluation: GateEvaluation,
): Promise<void> {
  const { getSetting, setSetting } = await import("../settings");
  const raw = await getSetting<unknown>("revenue.triggers", null);
  if (!Array.isArray(raw)) {
    throw new Error("revenue.triggers unreadable at execution time — refusing to auto-execute");
  }
  const pattern = (gate.action.dialActionPattern ?? "").toLowerCase();
  let touched = false;
  const updated = raw.map((row) => {
    if (touched || !row || typeof row !== "object") return row;
    const o = row as Record<string, unknown>;
    if (typeof o.action === "string" && o.action.toLowerCase().includes(pattern)) {
      touched = true;
      return {
        ...o,
        status: "active",
        activatedBy: "gate-watcher",
        activatedAt: new Date().toISOString(),
        activatedGateId: gate.id,
      };
    }
    return row;
  });
  if (!touched) {
    throw new Error(`no revenue.triggers row matched '${gate.action.dialActionPattern}' at execution time`);
  }
  await setSetting({
    key: "revenue.triggers",
    value: updated,
    founderId: "gate-watcher",
    note: `auto-approved by gate-watcher: gate '${gate.id}' ripened (${evaluation.reason})`,
  });

  try {
    const { recordExperience } = await import("./experienceLog");
    await recordExperience({
      moveKind: "gate_auto_executed",
      domain: "governance",
      playId: gate.id,
      outcome: "acted",
      reasoningTrace: {
        narrative: `Gate '${gate.id}' ripened (${evaluation.reason}) and the studio dial '${dial.action}' says autoApprove — marked the trigger active.`,
        evaluation,
        dial,
        source: gate.source,
      },
    });
  } catch (err) {
    logger.warn("[gateWatcher] auto-execute experience write failed (trigger still activated)", err instanceof Error ? err : undefined);
  }
}

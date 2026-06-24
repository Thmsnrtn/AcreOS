/**
 * Cognition Layer — the OPERATOR (Phase 1 keystone, per the frontier audit).
 *
 * The deepest first-principles limit the audit found: the decision core is a
 * bandit over ~13 FIXED move-kinds — it can perfect a local maximum within a
 * possibly-wrong menu but can never AUTHOR a move the menu lacks (a price test,
 * a new channel, a positioning pivot). The Operator breaks that ceiling: a
 * bounded Opus-grade pass over the rich Context Pack that produces a PLAN — and
 * may PROPOSE net-new move-kinds the catalog doesn't have.
 *
 * Safety is by construction, exactly as the audit prescribes: the Operator only
 * PROPOSES; the deterministic rules (decide.ts rankMoves) remain the authoritative
 * SAFETY FLOOR (it can reorder WITHIN the non-mandatory space and add net-new,
 * but can NEVER promote a discretionary move above a mandatory one — an open
 * incident always outranks growth); every net-new move is marked maximally novel
 * so riskautonomy forces it through witnessed-send; and on any malformed plan the
 * system falls back to the pure deterministic ranking. Rules + gates + founder
 * dispose; the LLM only proposes.
 *
 * Pure functions (buildOperatorPrompt / parseOperatingPlan / planToActions) are
 * exhaustively testable with no model call — the model wiring + cadence is thin
 * IO layered on top (next increment).
 */
import type { RankedMove } from "./decide";

export interface OperatorMove {
  /** An existing RankedMove kind, OR a net-new id the Operator coined. */
  kind: string;
  isNetNew: boolean;
  rationale: string;
  /** For net-new moves: the proposed binding (drives risk/witnessed routing). */
  proposedBinding?: {
    domain?: string;
    isCustomerFacing?: boolean;
    outwardClass?: string;
    estCostUsd?: number;
    reversible?: boolean;
  } | null;
  /** 0..1 self-rated confidence. */
  confidence?: number;
}

export interface OperatingPlan {
  /** The eagle-eye read: what matters most, what's drifting, what's neglected. */
  assessment: string;
  /** Ranked recommendations (existing kinds + net-new proposals). */
  moves: OperatorMove[];
  /** What genuinely needs the founder, each with the Operator's own recommendation. */
  escalations: Array<{ question: string; recommendation: string }>;
  /** Minutia/risks to track across cycles. */
  watchItems: string[];
  /** Proposed thesis update (NOT applied here — fed to Strategy Memory later). */
  strategyNote?: string | null;
}

export interface ReconciledPlan {
  /** Safety-floor-enforced move order the loop can act on. */
  moves: RankedMove[];
  /** Kinds that are Operator-proposed net-new — the loop forces these witnessed. */
  netNewKinds: string[];
  topMove: RankedMove | null;
  /** True when the deterministic floor was used unchanged (no valid plan). */
  fellBack: boolean;
}

const KNOWN_DOMAINS = new Set(["growth", "support", "finance", "deploy", "ops"]);
function safeDomain(d: string | undefined): RankedMove["domain"] {
  return (d && KNOWN_DOMAINS.has(d) ? d : "ops") as RankedMove["domain"];
}

/**
 * Build the Operator prompt. Pure. Hands the model the eagle-eye briefing + the
 * existing move catalog, and the HARD rules: it may propose net-new moves but
 * must mark them; the deterministic safety ladder (stabilize > serve > grow) is
 * authoritative and it must never tell us to grow while an incident is open.
 */
export function buildOperatorPrompt(briefing: string, availableKinds: string[]): string {
  return [
    "You are the OPERATOR of an autonomous SaaS company — an elite operator reasoning over the whole business, then acting WITHIN the lines.",
    "Below is the eagle-eye briefing assembled from REAL signals. Reason over it across an operator's lenses (growth, finance, customers, reliability, compliance), then produce a concrete operating plan.",
    "",
    "You MAY propose a net-new move the existing catalog lacks (e.g. a pricing test, a new channel, a positioning change) — mark it isNetNew:true and give a proposedBinding. Net-new moves are always founder-approved before they run, so be bold but honest.",
    "HARD RULES: (1) the deterministic safety ladder stabilize>serve>grow is authoritative — NEVER recommend growth while an incident, runway-red, or compliance issue is open. (2) Use only REAL facts from the briefing; if a number is absent, say so — never invent one. (3) Escalate anything that genuinely needs the founder, with your own recommendation.",
    "",
    "=== EAGLE-EYE BRIEFING ===",
    briefing,
    "",
    `Existing move-kinds you can reference by exact id: ${availableKinds.join(", ")}.`,
    "",
    'Respond ONLY with JSON: {"assessment":"<eagle-eye read>","moves":[{"kind":"<id or net-new id>","isNetNew":<bool>,"rationale":"<why>","proposedBinding":{"domain":"growth|support|finance|deploy|ops","isCustomerFacing":<bool>,"estCostUsd":<num>,"reversible":<bool>},"confidence":<0..1>}],"escalations":[{"question":"<for the founder>","recommendation":"<your call>"}],"watchItems":["<minutia/risk>"],"strategyNote":"<proposed thesis update or null>"}',
  ].join("\n");
}

/** Parse + shape-validate the Operator JSON. Pure. Null on anything malformed. */
export function parseOperatingPlan(raw: string): OperatingPlan | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof o.assessment !== "string" || !Array.isArray(o.moves)) return null;
    const moves: OperatorMove[] = o.moves
      .filter((m): m is Record<string, unknown> => !!m && typeof (m as any).kind === "string")
      .map((m) => ({
        kind: String((m as any).kind).trim(),
        isNetNew: !!(m as any).isNetNew,
        rationale: typeof (m as any).rationale === "string" ? (m as any).rationale : "",
        proposedBinding: (m as any).proposedBinding && typeof (m as any).proposedBinding === "object" ? (m as any).proposedBinding : null,
        confidence: typeof (m as any).confidence === "number" ? (m as any).confidence : undefined,
      }))
      .filter((m) => m.kind.length > 0);
    if (moves.length === 0) return null;
    const escalations = Array.isArray(o.escalations)
      ? o.escalations
          .filter((e): e is Record<string, unknown> => !!e && typeof (e as any).question === "string")
          .map((e) => ({ question: String((e as any).question), recommendation: typeof (e as any).recommendation === "string" ? (e as any).recommendation : "" }))
      : [];
    const watchItems = Array.isArray(o.watchItems) ? o.watchItems.filter((w): w is string => typeof w === "string") : [];
    return {
      assessment: o.assessment,
      moves,
      escalations,
      watchItems,
      strategyNote: typeof o.strategyNote === "string" ? o.strategyNote : null,
    };
  } catch {
    return null;
  }
}

/**
 * Subordinate the Operator's plan to the deterministic safety floor. Pure — THE
 * keystone invariant: the MANDATORY tier of the deterministic ranking (the most
 * urgent priority, e.g. an open incident at priority 0) stays on top no matter
 * what the Operator says; the Operator may only reorder the discretionary space
 * and inject net-new moves BELOW the floor (marked net-new → forced witnessed).
 * A malformed/empty plan falls back to the deterministic ranking unchanged.
 */
export function planToActions(deterministic: RankedMove[], plan: OperatingPlan | null): ReconciledPlan {
  if (deterministic.length === 0) return { moves: [], netNewKinds: [], topMove: null, fellBack: true };
  if (!plan || plan.moves.length === 0) {
    return { moves: deterministic, netNewKinds: [], topMove: deterministic[0] ?? null, fellBack: true };
  }

  const floorPriority = Math.min(...deterministic.map((m) => m.priority)); // most urgent
  const floorMoves = deterministic.filter((m) => m.priority === floorPriority); // mandatory tier — immovable
  const detByKind = new Map(deterministic.map((m) => [m.kind, m]));

  const out: RankedMove[] = [...floorMoves];
  const used = new Set(floorMoves.map((m) => m.kind));
  const netNewKinds: string[] = [];

  for (const om of plan.moves) {
    if (used.has(om.kind)) continue;
    const det = detByKind.get(om.kind);
    if (det) {
      // Existing move: the Operator may promote it WITHIN the discretionary space
      // (it's already below the floor by construction — floor moves are 'used').
      out.push(det);
      used.add(om.kind);
    } else if (om.isNetNew) {
      // Net-new: inject just below the mandatory floor, marked maximally novel so
      // riskautonomy forces it through witnessed-send.
      out.push({
        priority: floorPriority + 1,
        domain: safeDomain(om.proposedBinding?.domain),
        kind: om.kind,
        rationale: `[net-new] ${om.rationale}`,
      });
      used.add(om.kind);
      netNewKinds.push(om.kind);
    }
    // Unknown non-net-new kind (hallucinated id) → silently dropped.
  }

  // Never drop a deterministic move the Operator didn't mention.
  for (const m of deterministic) if (!used.has(m.kind)) out.push(m);

  return { moves: out, netNewKinds, topMove: out[0] ?? null, fellBack: false };
}

export interface OperatorDeps {
  callModel: (prompt: string) => Promise<string>;
}

/** The move-kind catalog the Operator can reference (mirrors decide.ts). */
export const OPERATOR_KNOWN_KINDS = [
  "resolve_incident", "protect_runway", "clear_compliance", "stabilize_reflexes",
  "protect_deliverability", "clear_support_backlog", "retain_at_risk", "recover_payments",
  "unblock_activation", "convert_trials", "grow_owned_channels", "optimize",
];

/**
 * Build the Operator's model call (Opus-grade, traced + cost-attributed), or
 * null when no API key is configured. Reuses the same traced-LLM path as the
 * deliberation council but with a stronger model + room for a full plan.
 */
export async function buildOperatorModelCall(): Promise<((prompt: string) => Promise<string>) | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const OpenAImod = (await import("openai")).default;
    const client = new OpenAImod({ apiKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
    const { tracedLlmCall } = await import("../tracedLlmCall");
    const model = process.env.COGNITION_MODEL ?? process.env.AUTOPILOT_DELIBERATION_MODEL ?? "gpt-4o-mini";
    return async (prompt: string) =>
      (
        await tracedLlmCall({
          agentCodename: "autopilot",
          purpose: "operator",
          model,
          userPrompt: prompt,
          call: () =>
            client.chat.completions.create({
              model,
              temperature: 0.3,
              max_tokens: 2000,
              messages: [{ role: "user", content: prompt }],
            }),
        })
      ).content;
  } catch {
    return null;
  }
}

/**
 * Run the Operator over a briefing and return its PLAN (founder-invoked "advise
 * me" path — no execution, no reconciliation). Null when no model or malformed.
 */
export async function operate(
  briefing: string,
  availableKinds: string[],
  deps: OperatorDeps,
): Promise<OperatingPlan | null> {
  try {
    const raw = await deps.callModel(buildOperatorPrompt(briefing, availableKinds));
    return parseOperatingPlan(raw);
  } catch {
    return null;
  }
}

/**
 * Run the Operator: one model pass over the briefing → a parsed plan → the
 * safety-floor-reconciled actions. Always returns a usable ReconciledPlan — on
 * any model error or malformed output it falls back to the deterministic
 * ranking. Never throws.
 */
export async function runOperator(
  briefing: string,
  deterministic: RankedMove[],
  availableKinds: string[],
  deps: OperatorDeps,
): Promise<{ reconciled: ReconciledPlan; plan: OperatingPlan | null }> {
  try {
    const raw = await deps.callModel(buildOperatorPrompt(briefing, availableKinds));
    const plan = parseOperatingPlan(raw);
    return { reconciled: planToActions(deterministic, plan), plan };
  } catch {
    return { reconciled: planToActions(deterministic, null), plan: null };
  }
}

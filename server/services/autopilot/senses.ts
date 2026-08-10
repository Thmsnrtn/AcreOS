/**
 * Founder Autopilot — real senses gathered from live platform state.
 *
 * The brain only ever acts on senses that are genuinely measured (decide.ts).
 * This module is where the not-yet-in-the-pulse senses are read from real
 * tables — honestly, best-effort, never invented. Each loader isolates its own
 * failure and degrades to the truthful "none known" default so a single bad
 * source can't poison the decision or crash the loop.
 *
 * Currently: the support backlog (open + escalated cases). More senses
 * (activation stalls, etc.) land here as they get real sources.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { eventMeshEvents, supportCases } from "@shared/schema";
import { logger } from "../../utils/logger";

/**
 * Count support cases genuinely waiting on us — status open or escalated.
 * `awaiting_user` is waiting on the customer (not our backlog); `ai_handling`
 * is in progress; resolved/closed are done. Returns 0 on any error (honest
 * default — we never fabricate a backlog).
 */
export async function getOpenSupportCaseCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(supportCases)
      .where(sql`${supportCases.status} in ('open', 'escalated')`);
    return Number(row?.n ?? 0);
  } catch (err) {
    logger.warn(
      "[autopilot/senses] support backlog read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return 0;
  }
}

// ── The sense inventory (Wave S · S1/S2 — autonomy follows perception) ───────
//
// The single honest catalog of what the brain CAN and CANNOT currently see.
// A sense is WIRED only when BOTH halves are true: a real loader exists
// (`source`) AND the brain actually consumes it (`consumedBy` names the real
// consumption sites — "tick" = the operating loop's DecisionSenses build in
// server/services/solene/continuousLoop.ts; "context-pack" = the Operator's
// eagle-eye gather in server/services/autopilot/cognitionContext.ts).
//
// Entries with `source: null` are DECLARED GAPS — the doctrine's core senses
// that do not exist yet. They are listed here precisely so the charters
// (charters.ts) can render them as honest blindness lines and so the
// promotion gate can refuse to widen autonomy past `draft` while they are
// dark. Every claim in this table is source-pinned by
// tests/unit/staffCharters.test.ts against the actual loader + consumer
// files — wiring or unwiring a sense without updating this inventory turns
// that suite red by name.

export interface SenseWiring {
  /** Stable key charters reference (charters.ts coreSenseKeys). */
  key: string;
  /** Plain words for the founder — what this sense sees. */
  label: string;
  /**
   * The real loader/producer: repo-relative module + a symbol that appears
   * verbatim in that module AND in every consumer file. null = no loader
   * exists yet (a declared gap).
   */
  source: { module: string; symbol: string } | null;
  /** Where the brain reads it. Empty = not consumed (unwired). */
  consumedBy: ReadonlyArray<"tick" | "context-pack">;
  /** For gaps: why it's absent / what wiring it would take (honest note). */
  gap?: string;
}

export const SENSE_INVENTORY: readonly SenseWiring[] = [
  // ── Wired — loader exists AND the brain reads it ──────────────────────────
  { key: "support_backlog", label: "customers waiting on support", source: { module: "server/services/autopilot/senses.ts", symbol: "getOpenSupportCaseCount" }, consumedBy: ["tick"] },
  { key: "deal_activity", label: "deal-pipeline motion (mesh events)", source: { module: "server/services/autopilot/senses.ts", symbol: "getDealActivitySignal" }, consumedBy: ["tick"] },
  { key: "email_complaints", label: "spam complaints (deliverability risk)", source: { module: "server/services/autopilot/perception.ts", symbol: "emailComplaints" }, consumedBy: ["tick", "context-pack"] },
  { key: "dunning_pressure", label: "failed payments awaiting recovery", source: { module: "server/services/autopilot/perception.ts", symbol: "dunningPressure" }, consumedBy: ["tick"] },
  { key: "churn_signals", label: "cancellations and disputes", source: { module: "server/services/autopilot/perception.ts", symbol: "churnSignals" }, consumedBy: ["tick", "context-pack"] },
  { key: "trials_ending", label: "trials entering their closing window", source: { module: "server/services/autopilot/perception.ts", symbol: "trialsEnding" }, consumedBy: ["tick", "context-pack"] },
  { key: "note_payments", label: "note-vertical borrower payment schedule", source: { module: "server/services/autopilot/perception.ts", symbol: "notePaymentsDueSoon" }, consumedBy: ["tick"] },
  { key: "reflex_failures", label: "autonomous-job (reflex) failures", source: { module: "server/services/autopilot/reflexes.ts", symbol: "readReflexHealth" }, consumedBy: ["tick"] },
  { key: "open_incidents", label: "flagged dispatches (incident proxy)", source: { module: "server/services/solene/continuousLoop.ts", symbol: "dispatchesFlaggedLast24h" }, consumedBy: ["tick"] },
  { key: "mrr", label: "monthly recurring revenue", source: { module: "server/services/solene/continuousLoop.ts", symbol: "mrr" }, consumedBy: ["tick", "context-pack"] },
  { key: "trials", label: "signups in window", source: { module: "server/services/solene/continuousLoop.ts", symbol: "trials" }, consumedBy: ["tick", "context-pack"] },
  { key: "compliance_open", label: "open compliance findings", source: { module: "server/services/solene/continuousLoop.ts", symbol: "complianceOpenCount" }, consumedBy: ["tick", "context-pack"] },
  { key: "envelope_status", label: "cost/runway envelope health", source: { module: "server/services/solene/continuousLoop.ts", symbol: "envelopeStatus" }, consumedBy: ["tick", "context-pack"] },
  { key: "uptime", label: "measured product uptime", source: { module: "server/services/solene/continuousLoop.ts", symbol: "uptimePct" }, consumedBy: ["context-pack"] },
  { key: "budget_books", label: "the books (caps, spend, headroom)", source: { module: "server/services/solene/capitalTracker.ts", symbol: "getEffectiveMonthlyCapUsd" }, consumedBy: ["context-pack"] },
  { key: "attributed_signups", label: "attributed signups (a lower bound)", source: { module: "server/services/autopilot/attribution.ts", symbol: "getConversionSummary" }, consumedBy: ["context-pack"] },

  // ── Declared gaps — the doctrine's core senses that don't exist yet ───────
  // (Addendum C §S2: build eyes in charter priority order; every one of these
  // appears in the Letter as a blindness line until it's real.)
  { key: "activation_funnel", label: "activation/funnel events as a decision sense", source: null, consumedBy: [], gap: "funnelHealth raises a deduped ALERT, but DecisionSenses.activationStalled is never fed by the tick — the brain cannot rank on activation." },
  { key: "support_sla_timers", label: "support first-response timers", source: null, consumedBy: [], gap: "ContextPackRaw.supportFirstResponseHours exists but no producer measures it — it stays honestly null." },
  { key: "slo_canaries", label: "SLO feeds / canary probes on the live product", source: null, consumedBy: [], gap: "canary probes exist (O4: slo.ts + reliabilityCanaries) but the brain does not yet read them as a sense — the tick and context pack consume nothing from them." },
  { key: "deploy_canary_health", label: "deploy + rollback canary health", source: null, consumedBy: [], gap: "self-patch never merges itself, and no canary health sense exists for what does deploy." },
  { key: "unit_economics", label: "per-customer unit economics (margin, LTV)", source: null, consumedBy: [], gap: "only an aggregate lower-bound CAC exists; margin/LTV are unmeasured." },
  { key: "obligation_countdowns", label: "dated obligations / renewal countdowns", source: null, consumedBy: [], gap: "vendor-key and filing deadlines are not yet a machine-readable countdown the brain reads." },
  { key: "claim_verification", label: "statute/claim verification status", source: null, consumedBy: [], gap: "the statute register carries sourcing fields, but the brain does not read verification status as a sense." },
];

/** A sense is wired iff its loader exists AND the brain consumes it. */
export function senseIsWired(key: string): boolean {
  const s = SENSE_INVENTORY.find((x) => x.key === key);
  return !!s && s.source != null && s.consumedBy.length > 0;
}

/** Deal pipeline activity as the brain sees it (Jarvis 2.1, audit G2). */
export interface DealActivitySignal {
  /** deal:lifecycle mesh events in the window (created/updated/closed). */
  events: number;
  /** Of those, deals closed WON — the milestone signal. */
  closedWon: number;
}

/**
 * Count deal-lifecycle mesh events in the window. This reads the mesh's own
 * ledger (event_mesh_events) rather than re-deriving pipeline state, so the
 * brain sees exactly what the mutation seams published — no more, no less.
 * Returns honest zeros on any failure.
 */
export async function getDealActivitySignal(windowHours = 24): Promise<DealActivitySignal> {
  try {
    const [row] = await db
      .select({
        events: sql<number>`count(*)::int`,
        closedWon: sql<number>`count(*) filter (where ${eventMeshEvents.eventType} = 'deal:closed' and ${eventMeshEvents.payload} ->> 'outcome' = 'won')::int`,
      })
      .from(eventMeshEvents)
      .where(
        sql`${eventMeshEvents.channel} = 'deal:lifecycle' and ${eventMeshEvents.createdAt} > now() - (${windowHours} || ' hours')::interval`,
      );
    return { events: Number(row?.events ?? 0), closedWon: Number(row?.closedWon ?? 0) };
  } catch (err) {
    logger.warn(
      "[autopilot/senses] deal activity read failed; defaulting to 0",
      err instanceof Error ? err : undefined,
    );
    return { events: 0, closedWon: 0 };
  }
}

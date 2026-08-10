/**
 * Wave S · S5 — conflict → negotiation WITH A RECORD.
 *
 * A chartered staff disagrees. Today that disagreement is invisible: the
 * council's split lowers loop confidence (council.ts, MIN-combined at the risk
 * gate) and the tick moves on. The founder never learns that Growth and
 * Finance wanted opposite things, or why the machine went the way it did.
 *
 * This module turns that split into ONE decision memo carrying BOTH positions
 * — each charter's recommendation, its cost read, its risk read — plus a
 * default that states plainly what happens if the founder never answers. It is
 * the "resolve, remedy, learn" loop closed with a paper trail.
 *
 * THE LINE THIS MODULE DOES NOT CROSS — the safety ladder in decide.ts is
 * AUTHORITATIVE and is not up for negotiation. An open incident outranks
 * growth; a red envelope outranks growth; an open compliance finding outranks
 * outward action. Putting a founder card in front of a fire would be strictly
 * worse than the ladder deciding instantly. So a contention where EITHER side
 * is a ladder stabilize move is refused, loudly, and never becomes a memo.
 * That stabilize set is DERIVED by probing decide.ts's real ranker — never a
 * copied list — so a new P0/P1 move is covered the day it lands, and this
 * guard cannot go stale (the wave-discipline lesson in CLAUDE.md).
 *
 * What it will never do, by construction and by test:
 *   • resolve a memo itself — actionPayload is ALWAYS null; only the founder's
 *     tap disposes it, through the same verbs every other card uses;
 *   • widen autonomy — it imports no autonomy mutator and writes no standing
 *     order. A repeat resolution produces a PROPOSAL card ("may I stop asking
 *     you this?"); GRANTING it stays a founder action in Controls, forever;
 *   • open a parallel learning store — the founder's reason on disposition
 *     rides slice 5's existing rail (decisions_inbox_items.founder_modification
 *     + the `option:<key>` text), and repeat detection READS that same store.
 *     No new table, no migration.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { decisionsInboxItems } from "@shared/schema";
import { logger } from "../../utils/logger";
// The item type + the filing method live with every other native decisions-door
// item (decisionsInbox.ts, the abuse_report pattern). The dependency runs ONE
// way at runtime — decisionsInbox.ts imports this module's TYPES only, which
// erase at compile time — so there is no import cycle.
import { CONFLICT_MEMO_ITEM_TYPE, decisionsInboxService } from "../decisionsInbox";
import { rankMoves, type DecisionSenses } from "./decide";
import { COUPLINGS } from "./crossFunction";
import { councilIsContested, councilTopTwo, type CouncilAggregate } from "./council";
// TYPE-ONLY: the charter roster is the vocabulary for who is arguing, but this
// module needs none of charters.ts's runtime graph (db, the hands registry).
import type { CharterDomain } from "./charters";
import type { AutopilotDomain } from "./policyGate";

// ── The ladder, derived (never copied) ──────────────────────────────────────

/**
 * Moves decide.ts ranks at this priority or better are STABILIZE-tier: the
 * house is on fire and the ladder has already ruled. Matches rankMoves' own
 * P0/P1 banding ("nothing else matters if the house is on fire").
 */
export const LADDER_STABILIZE_MAX_PRIORITY = 1;

/**
 * Two probes that between them light every branch of rankMoves: one where
 * everything is on fire, one where nothing is (the growth/optimize tier only
 * appears when `stable` holds, so a single probe cannot see the whole catalog).
 */
const PROBE_ON_FIRE: DecisionSenses = {
  openIncidents: 1,
  complianceOpenCount: 1,
  envelopeStatus: "red",
  supportBacklog: 1,
  trials: 1,
  activationStalled: true,
  mrr: 0,
  dispatchBacklog: 0,
  emailComplaints: 1,
  dunningPressure: 1,
  churnSignals: 1,
  trialsEnding: 1,
  reflexFailures: 1,
};

const PROBE_ALL_CLEAR: DecisionSenses = {
  openIncidents: 0,
  complianceOpenCount: 0,
  envelopeStatus: "green",
  supportBacklog: 0,
  trials: 0,
  activationStalled: false,
  mrr: 0,
  dispatchBacklog: 0,
};

/**
 * Every move kind decide.ts can emit, mapped to the best (lowest) priority it
 * carries when it fires. Derived by RUNNING the authoritative ranker, so this
 * module can never hold a stale copy of the ladder. Pure + deterministic.
 */
export function ladderMovePriorities(): Map<string, number> {
  const out = new Map<string, number>();
  for (const probe of [PROBE_ON_FIRE, PROBE_ALL_CLEAR]) {
    for (const move of rankMoves(probe)) {
      const seen = out.get(move.kind);
      if (seen === undefined || move.priority < seen) out.set(move.kind, move.priority);
    }
  }
  return out;
}

/**
 * The move kinds the safety ladder decides outright — no negotiation, no memo.
 * Derived from ladderMovePriorities; an unknown kind is deliberately NOT in
 * this set (an unrecognized move is not a fire, and treating it as one would
 * silently suppress memos).
 */
export function ladderStabilizeKinds(): Set<string> {
  const out = new Set<string>();
  for (const [kind, priority] of ladderMovePriorities()) {
    if (priority <= LADDER_STABILIZE_MAX_PRIORITY) out.add(kind);
  }
  return out;
}

// ── The contention registry ─────────────────────────────────────────────────

export interface ContentionDef {
  key: string;
  label: string;
  /** The two charters with genuine standing in this fight. */
  charters: readonly [CharterDomain, CharterDomain];
  /** What is actually contested — the scarce thing. */
  resource: string;
  /** The question the memo puts to the founder, in one line. */
  question: string;
}

/**
 * The contentions that are genuinely NEGOTIABLE (Addendum C.2-S5: budget,
 * growth-vs-finance, speed-vs-compliance). Everything else the ladder ranks,
 * and anything not listed here is refused rather than improvised — the machine
 * does not get to invent new things to interrupt the founder about.
 */
export const NEGOTIABLE_CONTENTIONS: readonly ContentionDef[] = [
  {
    key: "budget_allocation",
    label: "Budget allocation",
    charters: ["growth", "ops"],
    resource: "the discretionary spend envelope",
    question: "Who gets the next discretionary dollar — acquisition, or platform cost work?",
  },
  {
    key: "growth_vs_finance",
    label: "Growth vs Finance",
    charters: ["growth", "finance"],
    resource: "cash: spent on acquisition now, or held as runway",
    question: "Spend on acquisition now, or hold the cash for runway?",
  },
  {
    key: "speed_vs_compliance",
    label: "Speed vs Compliance",
    charters: ["deploy", "compliance"],
    resource: "calendar time: ship date against verification time",
    question: "Ship now, or hold until the compliance read is verified?",
  },
] as const;

export function getContentionDef(key: string): ContentionDef | undefined {
  return NEGOTIABLE_CONTENTIONS.find((c) => c.key === key);
}

// ── Positions ───────────────────────────────────────────────────────────────

/**
 * A cost read. `usd` is null whenever the number is not genuinely measured —
 * the memo then says so in `basis`. A memo with an invented dollar figure
 * would be exactly the fabrication this codebase forbids.
 */
export interface CostRead {
  usd: number | null;
  basis: string;
}

/**
 * A risk read. When it names a `coupledCharter` the claim is grounded in the
 * real coupling model (crossFunction.COUPLINGS) — "acting here adds load
 * there" — not in a guess.
 */
export interface RiskRead {
  basis: string;
  coupledCharter: CharterDomain | null;
  /** Pressure this position adds to the coupled charter, or null if unmodeled. */
  pressureAdded: number | null;
}

export interface CharterPosition {
  charter: CharterDomain;
  /** The decide.ts move kind this charter is pushing for, when it maps to one. */
  moveKind: string | null;
  recommendation: string;
  cost: CostRead;
  /**
   * Omit it and the memo fills in the MODELED read from crossFunction's real
   * couplings — a position with no risk line at all would be the one thing a
   * negotiation memo must never ship.
   */
  risk?: RiskRead;
  /**
   * Does adopting this position commit something new (spend, a send, a ship)?
   * The position that does NOT is what a silent founder effectively backs —
   * that is how the memo's default is derived rather than asserted.
   */
  requiresNewCommitment: boolean;
}

/** A position as it appears ON the memo: the risk read is always present. */
export interface MemoPosition extends CharterPosition {
  risk: RiskRead;
}

/**
 * The risk a charter's position puts on its COUPLED colleagues, read off the
 * production coupling model. Returns an honest "not modeled" read when the
 * charter has no positive coupling (compliance and support-relieving moves
 * genuinely add no load). Pure.
 */
function riskReadFor(
  charter: CharterDomain,
  pressures?: Partial<Record<AutopilotDomain, number>>,
): RiskRead {
  const outward = COUPLINGS.filter((c) => c.from === charter && c.effect > 0);
  if (outward.length === 0) {
    return {
      basis: "no modeled second-order load on another charter",
      coupledCharter: null,
      pressureAdded: null,
    };
  }
  // The heaviest coupling, weighted by the coupled charter's CURRENT pressure
  // when we have it (an already-stressed colleague is the real risk).
  const ranked = [...outward].sort(
    (a, b) => b.effect * (pressures?.[b.to] ?? 1) - a.effect * (pressures?.[a.to] ?? 1),
  );
  const top = ranked[0];
  const theirPressure = pressures?.[top.to];
  return {
    coupledCharter: top.to,
    pressureAdded: top.effect,
    basis:
      theirPressure == null
        ? `acting here adds modeled load to ${top.to} (coupling +${top.effect}); ${top.to}'s current pressure is not measured here`
        : `acting here adds modeled load to ${top.to} (coupling +${top.effect}), which is already at ${theirPressure.toFixed(2)} pressure`,
  };
}

// ── The memo ────────────────────────────────────────────────────────────────

export interface MemoDefault {
  /** What the machine does absent a founder ruling. Only one value exists. */
  action: "hold_both_positions";
  /** The charter a silent founder effectively backs, or null if neither. */
  favors: CharterDomain | null;
  sentence: string;
}

export interface StandingOrderProposal {
  /** Always true. This is a PROPOSAL; granting it is the founder's act. */
  proposalOnly: true;
  /** Always false. Nothing here changes what the machine may do. */
  inForce: false;
  contention: string;
  chosenKey: string;
  timesResolvedTheSameWay: number;
  /** The standing-order text the founder WOULD write, if they wanted to. */
  body: string;
  ask: string;
}

export interface ConflictMemo {
  contention: string;
  label: string;
  question: string;
  resource: string;
  positions: [MemoPosition, MemoPosition];
  /**
   * One answer option per position, built HERE so the `adopt_<charter>` key
   * has exactly one definition. The filing method and the repeat-resolution
   * reader both key off it; two copies of this string would be two things to
   * keep in sync, and the learning loop would silently stop matching if they
   * ever drifted.
   */
  options: Array<{ key: string; label: string }>;
  default: MemoDefault;
  council: {
    votes: number;
    agreement: number;
    disagreement: number;
    leadingKind: string | null;
    opposingKind: string | null;
  };
  /** Stable identity of THIS contention, for repeat detection + dedupe. */
  fingerprint: string;
  standingOrderProposal: StandingOrderProposal | null;
}

export type ContentionRefusal =
  | "unknown_contention"
  | "ladder_decides"
  | "council_not_contested"
  /**
   * The positions do not belong to the contention they were filed under.
   * The memo's headline label, question and resource come from the REGISTRY,
   * so mismatched positions would produce a card headed with one fight while
   * its two positions argue another — a memo that misdescribes its own
   * subject (fleet-9 verifier catch). Refuse instead.
   */
  | "charter_mismatch";

export interface ContentionOutcome {
  memo: ConflictMemo | null;
  reason: ContentionRefusal | "memo";
  /** The ladder move that outranked the negotiation, when reason is ladder_decides. */
  ladderKind: string | null;
}

export interface EvaluateContentionInput {
  contention: string;
  positions: [CharterPosition, CharterPosition];
  council: CouncilAggregate;
  /** Live domain pressures, when the caller has them (crossFunction). */
  pressures?: Partial<Record<AutopilotDomain, number>>;
}

/**
 * Stable identity for a contention: the contention key plus its two charters,
 * ORDER-INDEPENDENT (Growth-vs-Finance is the same fight whichever charter
 * spoke first). Deliberately excludes volatile numbers — a fingerprint that
 * changed with the dollar figure would never repeat, and the "may I stop
 * asking you this?" gesture would never fire. Pure.
 */
export function contentionFingerprint(
  contention: string,
  positions: readonly CharterPosition[],
): string {
  const charters = positions.map((p) => p.charter).sort().join("+");
  return `${contention}:${charters}`;
}

/** The option key that adopts a given charter's position. Pure. */
function adoptKey(charter: CharterDomain): string {
  return `adopt_${charter}`;
}

/**
 * The memo's default, DERIVED from the positions rather than asserted: the
 * machine executes nothing from a memo (actionPayload is null), so silence
 * means no new commitment — which effectively backs whichever position asked
 * for none. When both sides want to commit something, silence backs neither
 * and the sentence says exactly that. Pure.
 */
function deriveDefault(positions: readonly CharterPosition[]): MemoDefault {
  const holds = positions.filter((p) => !p.requiresNewCommitment);
  let favors = holds.length === 1 ? holds[0].charter : null;
  let tail =
    favors != null
      ? `That effectively backs ${favors}'s position, which asks for no new commitment.`
      : "Both positions ask for a new commitment, so silence advances neither.";

  // "Silence advances neither" is only true when the ladder is indifferent
  // between the two. When both sides commit but the ladder RANKS one above the
  // other, doing nothing does not hold the line — it hands the tick to the
  // higher-ranked move (fleet-10 verifier catch: on the one contention this
  // emitter files, grow_owned_channels outranks optimize, so silence favored
  // growth while the card said it favored nobody).
  if (favors == null) {
    const priorities = ladderMovePriorities();
    const ranked = positions
      .map((p) => ({ p, priority: p.moveKind == null ? undefined : priorities.get(p.moveKind) }))
      .filter((r): r is { p: CharterPosition; priority: number } => r.priority !== undefined)
      .sort((a, b) => a.priority - b.priority);
    if (ranked.length === positions.length && ranked.length > 1 && ranked[0].priority !== ranked[1].priority) {
      favors = ranked[0].p.charter;
      tail =
        `Both positions ask for a new commitment, but the ladder already ranks ` +
        `${ranked[0].p.moveKind} above ${ranked[1].p.moveKind} — so doing nothing ` +
        `hands the next tick to ${favors}, it does not hold the line.`;
    }
  }
  return {
    action: "hold_both_positions",
    favors,
    sentence:
      "If you never answer: nothing here executes — no spend, no send, no ship. " +
      "The autopilot keeps ranking work by the safety ladder as it already does. " +
      tail,
  };
}

/**
 * Decide what a cross-charter contention becomes. Pure + total.
 *
 * Order matters and is deliberate: the LADDER is checked before the council.
 * A divided council about a fire is still a fire — the ladder's authority does
 * not depend on how the panel voted.
 */
export function evaluateContention(input: EvaluateContentionInput): ContentionOutcome {
  const def = getContentionDef(input.contention);
  if (!def) return { memo: null, reason: "unknown_contention", ladderKind: null };

  const stabilize = ladderStabilizeKinds();
  const onFire = input.positions.find((p) => p.moveKind != null && stabilize.has(p.moveKind));
  if (onFire) {
    return { memo: null, reason: "ladder_decides", ladderKind: onFire.moveKind };
  }

  // AFTER the ladder check on purpose: a fire outranks every other refusal,
  // so an incident position still reports ladder_decides even when it arrives
  // under the wrong contention key. Order-independent (Growth-vs-Finance is
  // the same fight whichever charter spoke first).
  const gotCharters = input.positions.map((p) => p.charter).slice().sort().join("+");
  const wantCharters = [...def.charters].slice().sort().join("+");
  if (gotCharters !== wantCharters) {
    return { memo: null, reason: "charter_mismatch", ladderKind: null };
  }

  if (!councilIsContested(input.council)) {
    return { memo: null, reason: "council_not_contested", ladderKind: null };
  }

  // Normalize BEFORE building: a position that arrived without a risk read
  // gets the modeled one, so every position on the memo carries both reads.
  const positions = input.positions.map((p) => ({
    ...p,
    risk: p.risk ?? riskReadFor(p.charter, input.pressures),
  })) as [MemoPosition, MemoPosition];

  const top = councilTopTwo(input.council);
  return {
    memo: {
      contention: def.key,
      label: def.label,
      question: def.question,
      resource: def.resource,
      positions,
      options: positions.map((p) => ({
        key: adoptKey(p.charter),
        label: `Adopt ${p.charter}'s position`,
      })),
      default: deriveDefault(positions),
      council: {
        votes: input.council.votes,
        agreement: input.council.agreement,
        disagreement: input.council.disagreement,
        leadingKind: top.leading?.kind ?? null,
        opposingKind: top.opposing?.kind ?? null,
      },
      fingerprint: contentionFingerprint(def.key, positions),
      standingOrderProposal: null,
    },
    reason: "memo",
    ladderKind: null,
  };
}

// ── Learning: repeat resolution → a proposal, never a policy write ──────────

/** How many identical resolutions make a pattern worth asking about. */
export const REPEAT_RESOLUTION_THRESHOLD = 2;

export interface PriorResolution {
  fingerprint: string;
  /** The option key the founder actually tapped, or null if they never chose. */
  chosenKey: string | null;
  resolvedAt: string | Date | null;
}

/**
 * Slice 5 records the founder's tapped option as `option:<key> — <label>` in
 * founderOverrideAction (Jarvis 2.3), and their typed reason in
 * founderModification. This reads the key back out of that EXISTING text —
 * the learning loop consumes the rail slice 5 built, not a new column. Pure.
 */
export function parseChosenOptionKey(overrideAction: string | null | undefined): string | null {
  if (typeof overrideAction !== "string") return null;
  const m = /^option:([A-Za-z0-9_]+)/.exec(overrideAction.trim());
  return m ? m[1] : null;
}

/**
 * The "may I stop asking you this?" gesture. When the SAME contention has been
 * resolved the SAME way at least REPEAT_RESOLUTION_THRESHOLD times, offer to
 * write it down as a standing order.
 *
 * It returns a PROPOSAL and nothing else. Creating a standing order changes
 * what the machine may do without asking — that is autonomy widening, and it
 * belongs to the founder (Controls → standing orders). Two different answers
 * are not a pattern; the function refuses to generalize from them. Pure.
 */
export function detectRepeatResolution(
  fingerprint: string,
  priors: readonly PriorResolution[],
): StandingOrderProposal | null {
  const mine = priors.filter((p) => p.fingerprint === fingerprint && p.chosenKey);
  if (mine.length < REPEAT_RESOLUTION_THRESHOLD) return null;

  const first = mine[0].chosenKey!;
  if (!mine.every((p) => p.chosenKey === first)) return null;

  const def = getContentionDef(fingerprint.split(":")[0]);
  const label = def?.label ?? fingerprint;
  return {
    proposalOnly: true,
    inForce: false,
    contention: def?.key ?? fingerprint,
    chosenKey: first,
    timesResolvedTheSameWay: mine.length,
    body: `When ${label} comes up, take the "${first.replace(/^adopt_/, "")}" position by default.`,
    ask:
      `You have answered this the same way ${mine.length} times. Want to make it a standing ` +
      `order so I stop asking? I cannot write one myself — you would add it in Controls, ` +
      `and you can remove it any time.`,
  };
}

// ── Orchestration (DB) ──────────────────────────────────────────────────────

/**
 * Prior RESOLVED memos for a fingerprint, read off the same decisions-door
 * store slice 5 writes to. No parallel store, no migration. Newest first.
 * Best-effort: a failed history read costs the proposal, never the memo.
 */
async function priorResolutionsFor(fingerprint: string): Promise<PriorResolution[]> {
  try {
    const rows = await db
      .select({
        contextBundle: decisionsInboxItems.contextBundle,
        founderOverrideAction: decisionsInboxItems.founderOverrideAction,
        founderModification: decisionsInboxItems.founderModification,
        resolvedAt: decisionsInboxItems.resolvedAt,
      })
      .from(decisionsInboxItems)
      .where(
        and(
          eq(decisionsInboxItems.itemType, CONFLICT_MEMO_ITEM_TYPE),
          or(
            eq(decisionsInboxItems.status, "approved"),
            eq(decisionsInboxItems.status, "rejected"),
          ),
          sql`${decisionsInboxItems.contextBundle}->>'fingerprint' = ${fingerprint}`,
        ),
      )
      .orderBy(desc(decisionsInboxItems.resolvedAt))
      .limit(50);

    // Re-apply the fingerprint predicate in process so the semantics are
    // pinned by unit tests independent of the SQL layer (the A1 house pattern).
    return rows
      .filter((r) => (r.contextBundle as { fingerprint?: string } | null)?.fingerprint === fingerprint)
      .map((r) => ({
        fingerprint,
        chosenKey: parseChosenOptionKey(r.founderOverrideAction),
        resolvedAt: r.resolvedAt ?? null,
      }));
  } catch (err) {
    logger.warn(
      "[autopilot/conflictMemo] repeat-resolution history read failed; filing without a proposal",
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

export interface FileConflictMemoResult {
  itemId: number | null;
  created: boolean;
  refused: ContentionRefusal | null;
}

/**
 * Evaluate a contention and, when it genuinely warrants one, file ONE memo
 * onto the founder's decisions door.
 *
 * Refuses — without writing anything — when the contention is unregistered,
 * when the safety ladder already decides it, or when the council was not
 * actually divided. A memo the founder did not need is a tax on the scarcest
 * resource this company has.
 */
export async function fileConflictMemo(
  input: EvaluateContentionInput,
): Promise<FileConflictMemoResult> {
  const outcome = evaluateContention(input);
  if (!outcome.memo) {
    logger.info("[autopilot/conflictMemo] contention did not warrant a memo", {
      contention: input.contention,
      reason: outcome.reason,
      ladderKind: outcome.ladderKind,
    });
    return { itemId: null, created: false, refused: outcome.reason as ContentionRefusal };
  }

  const memo = outcome.memo;
  memo.standingOrderProposal = detectRepeatResolution(
    memo.fingerprint,
    await priorResolutionsFor(memo.fingerprint),
  );

  const filed = await decisionsInboxService.createFromConflictMemo(memo);
  return { ...filed, refused: null };
}

// ── The founder read surface ────────────────────────────────────────────────

export interface ContentionStateRow extends ContentionDef {
  /**
   * Open memos on the founder queue for this contention, or NULL when the
   * read failed — "not measured" is not the same fact as "none open", and
   * reporting 0 for a thrown query is precisely the zero-as-fact this house
   * refuses (fleet-9 verifier catch).
   */
  openMemos: number | null;
  /** True when this row's read threw — the surface must say so, not show 0. */
  readFailed: boolean;
  /** The standing-order proposal outstanding for it, if any. Never in force. */
  standingOrderProposal: StandingOrderProposal | null;
}

export interface ContentionState {
  generatedAt: string;
  contentions: ContentionStateRow[];
  /**
   * The move kinds that are NEVER negotiated, derived live from decide.ts.
   * Rendered so the founder can see the ladder's authority is real, not a
   * claim.
   */
  ladderDecidedKinds: string[];
  /** Standing orders are founder-written; nothing here creates one. */
  standingOrdersAreFounderOnly: true;
}

/**
 * What the founder sees about cross-charter contention: the registry, how many
 * memos are open for each, and any repeat-resolution proposal outstanding —
 * every proposal explicitly marked not-in-force. A pure read; it writes
 * nothing.
 */
export async function getContentionState(): Promise<ContentionState> {
  const contentions: ContentionStateRow[] = [];
  for (const def of NEGOTIABLE_CONTENTIONS) {
    let openMemos: number | null = null; // null until a read actually succeeds
    let proposal: StandingOrderProposal | null = null;
    let readFailed = false;
    // A fingerprint is contention + its two charters, sorted — the same value
    // contentionFingerprint builds from live positions.
    const fingerprint = `${def.key}:${[...def.charters].sort().join("+")}`;
    try {
      const open = await db
        .select({ id: decisionsInboxItems.id })
        .from(decisionsInboxItems)
        .where(
          and(
            eq(decisionsInboxItems.itemType, CONFLICT_MEMO_ITEM_TYPE),
            or(
              eq(decisionsInboxItems.status, "pending"),
              eq(decisionsInboxItems.status, "deferred"),
            ),
            sql`${decisionsInboxItems.contextBundle}->>'fingerprint' = ${fingerprint}`,
          ),
        )
        .limit(50);
      openMemos = open.length;
      proposal = detectRepeatResolution(fingerprint, await priorResolutionsFor(fingerprint));
    } catch (err) {
      readFailed = true;
      openMemos = null;
      logger.warn(
        "[autopilot/conflictMemo] contention state read failed for a row",
        err instanceof Error ? err : undefined,
      );
    }
    contentions.push({ ...def, openMemos, readFailed, standingOrderProposal: proposal });
  }

  return {
    generatedAt: new Date().toISOString(),
    contentions,
    ladderDecidedKinds: [...ladderStabilizeKinds()].sort(),
    standingOrdersAreFounderOnly: true,
  };
}


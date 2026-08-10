/**
 * Wave S · S5 completion — deriving TWO REAL CHARTER POSITIONS from a divided
 * council, or filing nothing.
 *
 * conflictMemo.ts (slice 9) can turn a cross-charter contention into ONE memo
 * on the founder's decisions door. It shipped with zero production callers on
 * purpose: filing a memo means asserting, on the founder's glass, that two
 * named colleagues want two named things at two named costs. Improvising any
 * part of that is exactly how a fabricated memo gets born. This module is the
 * derivation, and it is built to REFUSE far more often than it files.
 *
 * Every field on a filed position traces to something the code established:
 *   • which two sides argued → the council's own tally (councilTopTwo), and
 *     each voted kind must resolve back to a move that was genuinely on this
 *     tick's candidate list. A vote for a kind the ranker never offered is
 *     refused, not reconstructed.
 *   • who each side IS → the move's own `domain` from decide.ts. Not a guess,
 *     and not a mapping table this module could drift from.
 *   • what each side WANTS → the ranker's own rationale sentence, which was
 *     written from real counts ("3 trial(s) ending soon — …").
 *   • whether adopting it COMMITS something new → NOT derived: every position
 *     built here records `requiresNewCommitment: true`, deliberately. Both
 *     sides of the only contention this can file spend from the same envelope,
 *     so neither is a free option, and recording either as commitment-free
 *     would make the memo's default line read "silence effectively backs X"
 *     when silence backs nothing. Stated here rather than implied, because an
 *     earlier draft DID derive it and produced exactly that false default.
 *   • what it COSTS → the worst-case per-dispatch ceiling the loop actually
 *     commits, handed down from the seam, plus the live envelope read, plus
 *     act.ts's real move binding (reversible / customer-facing) as stated
 *     context. When the ceiling or envelope is unavailable the read is
 *     `usd: null` with its basis, never a plausible-looking dollar figure.
 *   • what it RISKS → conflictMemo's modeled read off crossFunction.COUPLINGS,
 *     weighted by the tick's live pressures.
 *
 * ── WHY EXACTLY ONE MOVE-PAIR MAPS TODAY (read before adding a second) ──────
 *
 * The memo's headline label, question and resource come from the REGISTRY, so
 * a pair may only be filed under a contention whose question honestly
 * describes what those two moves actually argue. Mapping by charter pair alone
 * is not enough, and would have shipped a lie:
 *
 *   • budget_allocation asks "who gets the next discretionary dollar —
 *     acquisition, or platform cost work?" — which is precisely
 *     grow_owned_channels ("advance owned growth") against optimize ("improve
 *     a system, tighten a playbook, or reduce cost"), both drawing on the same
 *     envelope. MAPPED.
 *   • growth_vs_finance asks "spend on acquisition now, or hold the cash for
 *     runway?" The only finance move in decide.ts that means *hold the cash*
 *     is protect_runway — a P0 the safety ladder decides outright, never a
 *     negotiation. The other finance moves (recover_payments, convert_trials)
 *     are collection and a send: filing either under that question would head
 *     the card with a fight its own positions do not argue. NOT MAPPED.
 *   • speed_vs_compliance names the `compliance` charter, and no move decide.ts
 *     emits carries that domain (clear_compliance is bound to `ops`, and is a
 *     ladder move besides). NOT MAPPED — inventing the bridge would be worse
 *     than the silence.
 *
 * So today this module files a memo for one shape of disagreement and refuses
 * the rest, loudly — every refusal is logged with its reason, and with the two
 * move kinds that produced it once the derivation has identified them. That is
 * the honest state of the move catalog, not a stub.
 *
 * It writes nothing but the memo: no autonomy mutator, no standing order, no
 * dispatch. It cannot change what the tick decided — the seam discards its
 * result — and it never throws, so the loop's own outcome is untouchable from
 * here.
 */
import { logger } from "../../utils/logger";
import { bindingFor } from "./act";
import { councilIsContested, councilTopTwo, type CouncilAggregate } from "./council";
import { pressuresFromSenses } from "./crossFunction";
import type { DecisionSenses, RankedMove } from "./decide";
import {
  fileConflictMemo,
  getContentionDef,
  type CharterPosition,
  type ContentionRefusal,
  type CostRead,
} from "./conflictMemo";
import type { CharterDomain } from "./charters";
import type { AutopilotDomain } from "./policyGate";

// ── The move-pair registry ──────────────────────────────────────────────────

interface MovePairContention {
  /** The two move kinds, in either order. */
  moveKinds: readonly [string, string];
  /** The NEGOTIABLE_CONTENTIONS key these two moves genuinely argue. */
  contention: string;
  /** Why the registry's question describes THESE two moves (see header). */
  because: string;
}

/**
 * The only move pairs whose contest a registered contention honestly
 * describes. Deliberately a whitelist: an unmapped pair files nothing. Adding
 * an entry means asserting the registry's question fits the pair — read the
 * header before you do.
 */
const MOVE_PAIR_CONTENTIONS: readonly MovePairContention[] = [
  {
    moveKinds: ["grow_owned_channels", "optimize"],
    contention: "budget_allocation",
    because:
      "grow_owned_channels IS acquisition and optimize IS platform cost work; both draw on the same discretionary envelope, which is exactly the resource the registry names.",
  },
];

/** The contention two move kinds argue, or null when none honestly does. Pure. */
function contentionForMovePair(a: string, b: string): MovePairContention | null {
  const got = [a, b].slice().sort().join("|");
  return (
    MOVE_PAIR_CONTENTIONS.find((p) => [...p.moveKinds].slice().sort().join("|") === got) ?? null
  );
}

// ── Positions ───────────────────────────────────────────────────────────────

/** The envelope read a cost basis quotes, when the caller has one. */
export interface EnvelopeRead {
  capUsd: number;
  spentUsd: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * What adopting this position would cost. The only dollar figure this module
 * will ever put on a card is the worst-case ceiling the loop genuinely commits
 * per dispatch — handed down from the seam that owns it, never re-read from an
 * env var here, so there is exactly one definition. No ceiling ⇒ `usd: null`
 * with its basis, because "not measured" is a fact and a plausible number is
 * not. Pure.
 */
function costReadFor(
  move: RankedMove,
  ceilingUsd: number | null,
  envelope: EnvelopeRead | null,
): CostRead {
  // act.ts's real binding for this move — the same one the risk-autonomy gate
  // screens on. Always stated, so a position can never read as consequence-free.
  const b = bindingFor(move.kind);
  const bindingLine =
    ` The loop binds this move as ${b.reversible ? "reversible" : "irreversible"} and ` +
    `${b.isCustomerFacing ? "customer-facing (it escalates to your tap before anything is sent)" : "internal"}.`;
  if (ceilingUsd == null || !Number.isFinite(ceilingUsd)) {
    return {
      usd: null,
      basis:
        "not measured — this derivation was given no per-dispatch cost ceiling, and the autopilot meters spend only after a dispatch runs." +
        bindingLine,
    };
  }
  // NAME WHAT IT MEASURES. The spend figure is autopilot DISPATCH spend, not
  // all AI and data spend — chat, letter parsing and every other model call sit
  // outside it. Calling it the latter understated the draw on the very envelope
  // this card asks the founder to allocate (fleet-10 verifier catch), on the one
  // contention this emitter can file: "who gets the next discretionary dollar".
  const envelopeLine = envelope
    ? ` Month-to-date autopilot dispatch spend is ${usd(envelope.spentUsd)} against the ${usd(envelope.capUsd)} monthly envelope (other AI spend — chat, letter parsing — is not in this figure).`
    : " The monthly envelope was not readable here, so remaining room is not stated.";
  // The budget gate treats a GROWTH move as the deferrable one: it waits when
  // spending it would eat the reserve held for non-deferrable work. That
  // asymmetry is real (economics.budgetGate, called with
  // `deferrable: move.domain === "growth"`), so the memo may state it.
  const reserveLine =
    move.domain === "growth"
      ? " A growth dispatch is the deferrable side at the budget gate — the one that waits when the reserve for non-deferrable work is at risk."
      : "";
  return {
    usd: ceilingUsd,
    basis:
      `Up to ${usd(ceilingUsd)} — the worst-case ceiling on the one dispatch this position would enqueue ` +
      `if the gate stack lets it run; actual spend is metered only after it runs.` +
      envelopeLine +
      reserveLine +
      bindingLine,
  };
}

/**
 * One charter's position, every field read off real state. The risk read is
 * deliberately OMITTED: conflictMemo fills it from the production coupling
 * model weighted by this tick's live pressures, so the modeled read has one
 * author. Pure.
 */
function positionFor(
  move: RankedMove,
  ceilingUsd: number | null,
  envelope: EnvelopeRead | null,
): CharterPosition {
  return {
    charter: move.domain as CharterDomain,
    moveKind: move.kind,
    // The ranker's OWN sentence — written from measured counts. Re-wording it
    // here would be this module asserting something decide.ts did not.
    recommendation: `Take ${move.kind} first — ${move.rationale}`,
    cost: costReadFor(move, ceilingUsd, envelope),
    // TRUE for every derived position, and deliberately not a per-move guess.
    // conflictMemo derives the memo's DEFAULT from this field: a lone
    // no-commitment side becomes "silence effectively backs <charter>". But
    // every move on the tick's candidate list becomes a governed dispatch that
    // draws on the AI/data envelope when the loop acts on it — none of them is
    // free — and silence does not adopt either position anyway: the ladder
    // simply keeps ranking as it already did. Marking either side "asks for no
    // new commitment" would put a claim on the card that the loop's own
    // behaviour contradicts, so both are recorded as committing and the memo's
    // default correctly reads "silence advances neither". The binding facts
    // that DO differ (reversible / customer-facing) are stated in the cost
    // basis instead, where they cannot be mistaken for a free option.
    requiresNewCommitment: true,
  };
}

// ── Derivation ──────────────────────────────────────────────────────────────

export type ContentionDerivationRefusal =
  /** No panel actually deliberated this tick. */
  | "not_deliberated"
  /** The panel was not divided enough to be news (council.councilIsContested). */
  | "council_not_contested"
  /** Only one side was recommended — there is no second position to carry. */
  | "single_side"
  /**
   * The panel voted three or more distinct moves. Two of three positions is
   * not the whole contest, and the card would present it as a two-way fight
   * while a third colleague's ask went unmentioned.
   */
  | "multi_way_split"
  /** A voted kind was not on this tick's candidate list — nothing to describe. */
  | "vote_not_a_candidate"
  /** Both sides belong to the same charter: a preference, not a contention. */
  | "same_charter"
  /** No registered contention honestly describes this pair (see the header). */
  | "no_registered_contention";

interface DerivedContention {
  contention: string;
  positions: [CharterPosition, CharterPosition];
  /** Live domain pressures, for the modeled risk read. */
  pressures: Partial<Record<AutopilotDomain, number>>;
  /** The two move kinds the panel actually argued. */
  pair: [string, string];
}

interface ContentionDerivation {
  derived: DerivedContention | null;
  refusal: ContentionDerivationRefusal | null;
  /** The pair that was examined, when the derivation got that far. */
  pair: [string, string] | null;
}

export interface DeriveContentionInput {
  /** This tick's candidate moves (post-deliberation ordering is fine). */
  moves: readonly RankedMove[];
  council: CouncilAggregate;
  /** Whether a panel genuinely ran (runCouncilPanel's `deliberated`). */
  deliberated: boolean;
  senses: DecisionSenses;
  /** Worst-case per-dispatch cost the loop commits. null ⇒ not measured. */
  dispatchCeilingUsd?: number | null;
  /** Live envelope read. Omit to have the filer read it best-effort; null = unreadable. */
  budget?: EnvelopeRead | null;
}

/**
 * Turn a divided council into two real charter positions, or refuse with a
 * reason. Pure + total — it reads only what it was handed and writes nothing.
 */
function deriveContention(input: DeriveContentionInput): ContentionDerivation {
  if (!input.deliberated) return { derived: null, refusal: "not_deliberated", pair: null };
  if (!councilIsContested(input.council)) {
    return { derived: null, refusal: "council_not_contested", pair: null };
  }

  const { leading, opposing } = councilTopTwo(input.council);
  if (!leading || !opposing) return { derived: null, refusal: "single_side", pair: null };

  // A memo carries exactly two positions, and the card frames them as the
  // contest. So the panel must have voted exactly two things: with three or
  // more, the top two would be presented as the whole fight while a third
  // colleague's ask went unmentioned — and where the runner-up is tied, which
  // two appear would come down to vote order. Refuse instead.
  if (Object.keys(input.council.tally).length > 2) {
    return { derived: null, refusal: "multi_way_split", pair: [leading.kind, opposing.kind] };
  }

  const pair: [string, string] = [leading.kind, opposing.kind];
  const leadMove = input.moves.find((m) => m.kind === leading.kind);
  const opposeMove = input.moves.find((m) => m.kind === opposing.kind);
  if (!leadMove || !opposeMove) {
    return { derived: null, refusal: "vote_not_a_candidate", pair };
  }
  if (leadMove.domain === opposeMove.domain) {
    return { derived: null, refusal: "same_charter", pair };
  }

  const mapped = contentionForMovePair(leadMove.kind, opposeMove.kind);
  if (!mapped) return { derived: null, refusal: "no_registered_contention", pair };
  // The registry is still the authority on who has standing: a pair whose
  // charters are not this contention's would be refused downstream with
  // charter_mismatch, and a memo that reached that point would have been built
  // on a table that drifted. Refuse here too, with the honest reason.
  const def = getContentionDef(mapped.contention);
  const want = def ? [...def.charters].slice().sort().join("+") : null;
  const got = [leadMove.domain, opposeMove.domain].slice().sort().join("+");
  if (!def || want !== got) return { derived: null, refusal: "no_registered_contention", pair };

  const ceiling = input.dispatchCeilingUsd ?? null;
  const envelope = input.budget ?? null;
  return {
    derived: {
      contention: def.key,
      positions: [
        positionFor(leadMove, ceiling, envelope),
        positionFor(opposeMove, ceiling, envelope),
      ],
      pressures: pressuresFromSenses(input.senses),
      pair,
    },
    refusal: null,
    pair,
  };
}

// ── The seam's one entry point ──────────────────────────────────────────────

export interface ContentionMemoOutcome {
  filed: boolean;
  itemId: number | null;
  contention: string | null;
  /**
   * Why nothing was filed. `reused_open_memo` means the same contention is
   * already open on the door — the memo is idempotent per fingerprint, so a
   * long-running disagreement produces one card, not one per tick.
   */
  reason:
    | ContentionDerivationRefusal
    | ContentionRefusal
    | "reused_open_memo"
    | "error"
    | null;
}

/**
 * Read the tick's divided council; file at most ONE memo.
 *
 * NEVER THROWS. The loop's tick is the caller and a memo is strictly a record
 * of a disagreement the tick already resolved its own way — a failure here
 * must cost the record and nothing else.
 */
export async function maybeFileContentionMemo(
  input: DeriveContentionInput,
): Promise<ContentionMemoOutcome> {
  try {
    // The envelope read, when the caller did not supply one. Best-effort and
    // resolved BEFORE the derivation so every cost basis quotes exactly what
    // was read: an unreadable envelope becomes an honest line in the basis,
    // never a number, and never a reason to drop the memo.
    let envelope = input.budget ?? null;
    if (input.budget === undefined) {
      try {
        const { getEffectiveMonthlyCapUsd, getMonthToDateSpendForType } = await import(
          "../solene/capitalTracker"
        );
        const capUsd = await getEffectiveMonthlyCapUsd();
        const spentUsd = await getMonthToDateSpendForType("agent_dispatch");
        envelope =
          Number.isFinite(capUsd) && Number.isFinite(spentUsd) ? { capUsd, spentUsd } : null;
      } catch (envErr) {
        envelope = null;
        logger.warn(
          "[autopilot/contentionPositions] envelope read failed; cost basis will say so",
          envErr instanceof Error ? envErr : undefined,
        );
      }
    }

    const { derived, refusal, pair } = deriveContention({ ...input, budget: envelope });
    if (!derived) {
      logger.info("[autopilot/contentionPositions] divided council did not warrant a memo", {
        metadata: {
          reason: refusal,
          pair,
          votes: input.council.votes,
          agreement: input.council.agreement,
        },
      });
      return { filed: false, itemId: null, contention: null, reason: refusal };
    }

    const filed = await fileConflictMemo({
      contention: derived.contention,
      positions: derived.positions,
      council: input.council,
      pressures: derived.pressures,
    });

    if (filed.refused) {
      return { filed: false, itemId: null, contention: derived.contention, reason: filed.refused };
    }
    if (!filed.created) {
      // The same contention is already open on the door — one fight, one card.
      return {
        filed: false,
        itemId: filed.itemId,
        contention: derived.contention,
        reason: "reused_open_memo",
      };
    }
    logger.info("[autopilot/contentionPositions] filed a conflict memo", {
      metadata: { contention: derived.contention, itemId: filed.itemId, pair: derived.pair },
    });
    return { filed: true, itemId: filed.itemId, contention: derived.contention, reason: null };
  } catch (err) {
    logger.warn(
      "[autopilot/contentionPositions] memo path failed; the tick is unaffected",
      err instanceof Error ? err : undefined,
    );
    return { filed: false, itemId: null, contention: null, reason: "error" };
  }
}

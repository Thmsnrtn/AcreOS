/**
 * Collection-sequence ARMING — the consent seam for consumer contact.
 * Founder ruling R-3, 2026-08-11.
 *
 * ── WHAT THIS GUARDS ────────────────────────────────────────────────────────
 * A `collection_sequences` row is a debt-collection ladder an AcreOS CUSTOMER
 * runs against a CONSUMER (a borrower who is late on a seller-financed note the
 * customer holds). Enrolling a note in one begins debt-collection-adjacent
 * contact with a real person.
 *
 * The column `auto_start` used to default to TRUE. That meant "yes, contact
 * them" was the answer a row gave when nobody had answered anything — consent
 * by schema default. The founder ruled the default flips to FALSE and, rather
 * than grandfathering or disarming the rows already carrying `true`, those rows
 * KEEP RUNNING and are surfaced for one-tap confirmation until a human owns
 * them.
 *
 * ── WHAT HAPPENS TO ROWS CREATED UNDER THE OLD DEFAULT ──────────────────────
 * Changing a column DEFAULT does not rewrite existing rows, and migration 0231
 * deliberately does NOT backfill them. So a row created before 2026-08-11 still
 * has `auto_start = true` and now has `armed_at = NULL` (the new column is NULL
 * for every pre-existing row). That pair is the state `armed_unconfirmed`:
 *
 *   • `isArmedForDispatch()` is TRUE  → a live collection is NOT cut off
 *     mid-ladder.
 *   • `needsConfirmation()` is TRUE   → it shows up in the Finance-door confirm
 *     surface until someone actually chooses it.
 *
 * Both halves matter. Returning false from the first would disarm running
 * ladders wholesale; returning false from the second would silently grandfather
 * them. `collectionArmingGate.test.ts` asserts both directions.
 *
 * ── MONEY POSTURE ───────────────────────────────────────────────────────────
 * Nothing here moves money. A dunning contact tells a consumer that money is
 * owed on the CUSTOMER'S own rails; AcreOS is not a party to the debt and no
 * funds transit AcreOS.
 *
 * This module is pure and dependency-free so the server chokepoint, the
 * Finance-door gate and the tests all describe the ladder with the SAME code —
 * the gate cannot drift into showing placeholder copy while the dispatcher
 * sends something else.
 */

/** One rung of a collection ladder, as stored in `collection_sequences.steps`. */
export interface CollectionLadderStep {
  stepNumber: number;
  /** negative = before due date, 0 = on the due date, positive = after due. */
  daysAfterDue: number;
  channel: "email" | "sms" | "call" | "mail";
  templateId?: number;
  subject?: string;
  content?: string;
  escalationLevel: "reminder" | "warning" | "urgent" | "final";
}

/** The arming-relevant shape of a `collection_sequences` row. */
export interface ArmableSequence {
  name?: string | null;
  steps?: CollectionLadderStep[] | null;
  autoStart?: boolean | null;
  armedAt?: Date | string | null;
  armedBy?: string | null;
  armedLadderDigest?: string | null;
}

export type ArmingState =
  /** `auto_start = false` — the default for every row created from 2026-08-11. */
  | "unarmed"
  /** Armed, but no human is on record. Rows created under the old default. */
  | "armed_unconfirmed"
  /** Armed and confirmed, but the ladder has been edited since. */
  | "armed_stale"
  /** Armed by a named human against the exact ladder now stored. */
  | "armed_confirmed";

/** Human-readable rung, rendered from the sequence's OWN steps. */
export interface LadderRung {
  stepNumber: number;
  channel: CollectionLadderStep["channel"];
  escalationLevel: CollectionLadderStep["escalationLevel"];
  /** Signed offset in days, copied from the step — never inferred. */
  relativeDays: number;
  /** e.g. "7 days before the due date", "on the due date", "14 days past due". */
  timing: string;
  /** e.g. "Step 3 · SMS · 14 days past due · urgent". */
  label: string;
}

const CHANNEL_LABELS: Record<CollectionLadderStep["channel"], string> = {
  email: "Email",
  sms: "SMS",
  call: "Phone call",
  mail: "Physical mail",
};

/** Plain-English timing for a signed day offset. */
export function describeTiming(daysAfterDue: number): string {
  if (daysAfterDue === 0) return "on the due date";
  if (daysAfterDue < 0) {
    const d = Math.abs(daysAfterDue);
    return `${d} day${d === 1 ? "" : "s"} before the due date`;
  }
  return `${daysAfterDue} day${daysAfterDue === 1 ? "" : "s"} past due`;
}

export function channelLabel(channel: CollectionLadderStep["channel"]): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

/**
 * Render the EXACT ladder a sequence will run — one rung per stored step, in
 * send order. Every field is copied from the step; nothing is defaulted or
 * invented. An empty/missing `steps` array renders as an empty ladder, which
 * the gate reports as "this sequence has no steps" rather than inventing one.
 */
export function describeLadder(steps: CollectionLadderStep[] | null | undefined): LadderRung[] {
  if (!Array.isArray(steps)) return [];
  return [...steps]
    .sort((a, b) => a.daysAfterDue - b.daysAfterDue || a.stepNumber - b.stepNumber)
    .map((step) => {
      const timing = describeTiming(step.daysAfterDue);
      return {
        stepNumber: step.stepNumber,
        channel: step.channel,
        escalationLevel: step.escalationLevel,
        relativeDays: step.daysAfterDue,
        timing,
        label: `Step ${step.stepNumber} · ${channelLabel(step.channel)} · ${timing} · ${step.escalationLevel}`,
      };
    });
}

/** Distinct channels this ladder will use, in first-send order. */
export function channelsUsed(steps: CollectionLadderStep[] | null | undefined): string[] {
  const seen: string[] = [];
  for (const rung of describeLadder(steps)) {
    if (!seen.includes(rung.channel)) seen.push(rung.channel);
  }
  return seen;
}

/**
 * Stable digest of the ladder a human was shown when they confirmed.
 *
 * FNV-1a over a canonical projection of the send-affecting fields only
 * (order, timing, channel, escalation). Renaming the sequence or editing a
 * template body does not re-trigger confirmation; changing WHO gets contacted,
 * HOW, or WHEN does. Dependency-free so client, server and tests agree.
 */
export function ladderDigest(steps: CollectionLadderStep[] | null | undefined): string {
  const canonical = describeLadder(steps)
    .map((r) => `${r.stepNumber}|${r.relativeDays}|${r.channel}|${r.escalationLevel}`)
    .join(";");
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${canonical.length}`;
}

/**
 * Classify a sequence. See the module header for why `armed_unconfirmed` both
 * dispatches and needs confirmation.
 */
export function armingState(sequence: ArmableSequence): ArmingState {
  if (!sequence.autoStart) return "unarmed";
  if (!sequence.armedAt) return "armed_unconfirmed";
  if (sequence.armedLadderDigest !== ladderDigest(sequence.steps ?? null)) {
    return "armed_stale";
  }
  return "armed_confirmed";
}

/**
 * May this sequence enroll a note and begin contacting a consumer?
 *
 * TRUE for `armed_unconfirmed` on purpose: a collection already climbing the
 * ladder is not cut off just because the confirm surface hasn't been visited.
 * The founder chose the more expensive option — surface it, don't sever it.
 */
export function isArmedForDispatch(sequence: ArmableSequence): boolean {
  const state = armingState(sequence);
  return state !== "unarmed";
}

/** Does this sequence belong in the Finance-door confirm surface? */
export function needsConfirmation(sequence: ArmableSequence): boolean {
  const state = armingState(sequence);
  return state === "armed_unconfirmed" || state === "armed_stale";
}

/** Why a sequence is being surfaced, in the customer's words. */
export function confirmationReason(sequence: ArmableSequence): string | null {
  switch (armingState(sequence)) {
    case "armed_unconfirmed":
      return "This sequence was armed by an old system default, not by a person. Confirm the ladder below to keep it running with someone's name on it.";
    case "armed_stale":
      return "The ladder changed after this sequence was confirmed. Review the current steps and confirm again.";
    default:
      return null;
  }
}

/** The full disclosure a customer must see before arming. */
export interface ArmingPlan {
  sequenceName: string;
  state: ArmingState;
  armedBy: string | null;
  armedAt: string | null;
  rungs: LadderRung[];
  channels: string[];
  digest: string;
  totalSteps: number;
  /** Plain-English window the ladder spans, or null when there are no steps. */
  span: string | null;
  needsConfirmation: boolean;
  armedForDispatch: boolean;
  reason: string | null;
}

/**
 * Build the disclosure the arming gate renders: what will be sent, to whom,
 * over which channels, and when — all derived from the sequence's own steps.
 */
export function describeArmingPlan(sequence: ArmableSequence): ArmingPlan {
  const rungs = describeLadder(sequence.steps ?? null);
  const armedAt = sequence.armedAt
    ? new Date(sequence.armedAt).toISOString()
    : null;
  return {
    sequenceName: sequence.name ?? "Untitled sequence",
    state: armingState(sequence),
    armedBy: sequence.armedBy ?? null,
    armedAt,
    rungs,
    channels: channelsUsed(sequence.steps ?? null),
    digest: ladderDigest(sequence.steps ?? null),
    totalSteps: rungs.length,
    span:
      rungs.length === 0
        ? null
        : `${describeTiming(rungs[0].relativeDays)} through ${describeTiming(rungs[rungs.length - 1].relativeDays)}`,
    needsConfirmation: needsConfirmation(sequence),
    armedForDispatch: isArmedForDispatch(sequence),
    reason: confirmationReason(sequence),
  };
}

/** Refusal returned by the enrollment chokepoint when a sequence is unarmed. */
export const UNARMED_REFUSAL =
  "This collection sequence is not armed. Arm it from Finance → Collections — " +
  "you'll see the exact steps, channels and timing before anything is sent.";

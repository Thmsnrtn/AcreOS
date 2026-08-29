/**
 * OUTBOUND SEAM — the strangler-fig facade for agent-initiated email
 * (stage-4 turn 4, docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md §1a).
 *
 * Agent engines that today call emailService.sendEmail directly (the seven
 * agent-autonomous sites frozen by outboundEmailChokepoint.test.ts) will —
 * one caller per verified turn, and only after Decision A — call THIS
 * instead. The seam never sends: it runs the same refusals as the canonical
 * hand and then FREEZES the send as a pending witnessed action
 * (autopilot_pending_actions), where the founder's tap or a standing
 * witness grant releases it through executeHandWitnessed, which re-runs
 * every check at execution time (defense in depth, panic-stop re-read
 * included).
 *
 * Refusal order mirrors hands/send-email.ts deliberately:
 *  1. counterpartyMatch — HARD STOP (founder rulings 2026-08-16 system-only
 *     autopilot; 2026-07-17 no re-fronting the platform rail). FAIL CLOSED:
 *     a lookup error is not permission to propose.
 *  2. suppression — an address that must never receive platform mail is
 *     refused at proposal time rather than surfacing a doomed card to the
 *     founder.
 * A proposal that passes here can still be refused at execution; the seam's
 * checks exist so the Decisions door only ever shows sends that could
 * actually go.
 *
 * NO CALLER FLIPS IN THIS TURN. The seam ships dark, unit-tested; turns
 * 6-9 move the callers one at a time with the chokepoint ratchet lowered
 * in each flipping commit.
 */
import { proposePendingHand } from "./pendingHands";
import { counterpartyMatch } from "./hands/counterpartyMatch";
import { filterSuppressed } from "../emailSuppressions";
import { logger } from "../../utils/logger";

export interface GovernedEmailProposal {
  /** Org whose surface triggered this (recipient is an AcreOS user of it). */
  organizationId: number;
  to: string;
  subject: string;
  html: string;
  /**
   * WHO proposes — e.g. "agentActionExecutors:send_retention_email".
   * Carried into the pending action's summary and payload so the receipt
   * chain names the machinery, not just the hand.
   */
  source: string;
  /** Optional policy domain for the pending action (e.g. "retention"). */
  domain?: string | null;
}

export type GovernedEmailResult =
  | { proposed: true; pendingActionId: number; deduped: boolean }
  | { proposed: false; refusal: string };

export async function proposeGovernedEmail(
  input: GovernedEmailProposal,
): Promise<GovernedEmailResult> {
  const to = input.to.trim();
  const subject = input.subject.trim();
  const html = input.html.trim();
  if (!to || !subject || !html) {
    return { proposed: false, refusal: "outboundSeam: 'to', 'subject' and 'html' are all required." };
  }

  // 1. Hard stop: system-only. Fail CLOSED on lookup error.
  let hit;
  try {
    hit = await counterpartyMatch(to);
  } catch (err) {
    logger.error("[outboundSeam] counterparty lookup failed — refusing (fail closed)", err, {
      metadata: { source: input.source, organizationId: input.organizationId },
    });
    return {
      proposed: false,
      refusal:
        "outboundSeam refused: could not verify the recipient is an AcreOS user (lookup failed). " +
        "The autopilot is system-only (founder ruling 2026-08-16); an unverifiable recipient fails closed.",
    };
  }
  if (hit) {
    logger.warn("[outboundSeam] refused — recipient is a customer counterparty", {
      metadata: {
        source: input.source,
        matchedKind: hit.kind,
        matchedRecordId: hit.recordId,
        counterpartyOrganizationId: hit.organizationId,
        callerOrganizationId: input.organizationId,
      },
    });
    return {
      proposed: false,
      refusal:
        `outboundSeam refused: the recipient resolves to a customer counterparty (${hit.kind} ` +
        `#${hit.recordId}). Counterparty mail goes out on the org's OWN connected identity ` +
        "(founder decision 2026-07-17), never the platform rail.",
    };
  }

  // 2. Suppression: refuse at proposal time; no doomed cards on the door.
  const { allowed } = await filterSuppressed([to]);
  if (allowed.length === 0) {
    return {
      proposed: false,
      refusal:
        "outboundSeam refused: the recipient is on the global suppression list " +
        "(one spam complaint suppresses the address for every tenant).",
    };
  }

  // 3. Freeze. Content-hash dedup inside proposePendingHand means a cadence
  //    re-proposing the identical send gets the live pending row back.
  const row = await proposePendingHand({
    handName: "send_email",
    args: {
      to,
      subject,
      html,
      organization_id: input.organizationId,
      proposed_by: input.source,
    },
    domain: input.domain ?? null,
    summary: `${input.source}: email to ${to} — "${subject}"`,
  });
  if (!row) {
    return {
      proposed: false,
      refusal: "outboundSeam: freezing the send failed (pending-action store unavailable); nothing was sent or queued.",
    };
  }
  const deduped = !!row.createdAt && row.createdAt.getTime() < Date.now() - 2_000;
  return { proposed: true, pendingActionId: row.id, deduped };
}

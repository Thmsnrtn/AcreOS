/**
 * Deal lifecycle → event mesh (Jarvis 2.1 — deal-shaped perception, audit G2).
 *
 * The v12 event mesh has carried deal-lifecycle publisher methods since
 * Phase B, but nothing ever called them — deal-stage transitions were
 * invisible to the brain. This module is the single seam between the REAL
 * deal write paths (storage/dealRepo: createDeal / updateDeal /
 * bulkUpdateDeals — which every route, AI tool, workflow, and import
 * funnels through) and the mesh.
 *
 * Two rules, both load-bearing:
 *   1. `publishDealLifecycle` is FIRE-AND-FORGET and never throws (sync or
 *      async). A mesh outage can never fail a customer's deal mutation.
 *   2. `classifyDealMutation` is PURE and never invents a value. No status
 *      change → no event; a closed-lost deal gets no fabricated amount.
 *
 * Payloads are org-scoped ids/statuses/amounts only — the same shape the
 * mesh already carries for other business events. No customer PII.
 */
import { logger } from "../utils/logger";
import { eventMeshPublisher } from "./eventMeshPublisher";

/** The slice of a deal row the classifier needs. Duck-typed so the repo can
 * pass its own row shapes without importing Deal here. */
export interface DealLifecycleSnapshot {
  id: number;
  type?: string | null;
  status?: string | null;
  propertyId?: number | null;
  acceptedAmount?: string | number | null;
  offerAmount?: string | number | null;
}

export type DealLifecycleEvent =
  | { kind: "discovered"; payload: { dealId: number; type?: string; status?: string; propertyId?: number } }
  | { kind: "updated"; payload: { dealId: number; from: string; to: string } }
  | {
      kind: "closed";
      payload: { dealId: number; from: string; to: string; outcome: "won" | "lost"; amount?: number };
    };

/** Terminal statuses and what they honestly mean. `deleted` is the soft-delete
 * hygiene status, not a customer lifecycle stage — it never publishes. */
const CLOSED_OUTCOME: Record<string, "won" | "lost"> = {
  closed: "won",
  cancelled: "lost",
};

/**
 * Pure classification of a deal mutation into the mesh event it deserves
 * (or null for no event). `before === null` means the deal was just created.
 * Only genuine status transitions publish — field-only edits are not
 * lifecycle events.
 */
export function classifyDealMutation(
  before: { status?: string | null } | null,
  after: DealLifecycleSnapshot,
): DealLifecycleEvent | null {
  const to = after.status ?? "";

  if (before === null) {
    // Soft-deleted rows can't be "discovered"; everything else can.
    if (to === "deleted") return null;
    const payload: { dealId: number; type?: string; status?: string; propertyId?: number } = {
      dealId: after.id,
    };
    if (after.type) payload.type = after.type;
    if (to) payload.status = to;
    if (after.propertyId != null) payload.propertyId = after.propertyId;
    return { kind: "discovered", payload };
  }

  const from = before.status ?? "";
  if (from === to) return null; // not a stage transition
  if (to === "deleted") return null; // soft delete is hygiene, not lifecycle

  const outcome = CLOSED_OUTCOME[to];
  if (outcome) {
    const payload: { dealId: number; from: string; to: string; outcome: "won" | "lost"; amount?: number } = {
      dealId: after.id,
      from,
      to,
      outcome,
    };
    // Amount only when honestly known: a won deal's accepted amount (falling
    // back to the offer that was accepted). Never fabricated for lost deals.
    if (outcome === "won") {
      const amount = Number(after.acceptedAmount ?? after.offerAmount ?? NaN);
      if (Number.isFinite(amount) && amount > 0) payload.amount = amount;
    }
    return { kind: "closed", payload };
  }

  return { kind: "updated", payload: { dealId: after.id, from, to } };
}

/**
 * Fire-and-forget publish of the mesh event a mutation deserves. Synchronous
 * void return; all failure modes (classification, import, publish) are
 * swallowed with a warn log. NEVER let this fail the mutation that called it.
 */
export function publishDealLifecycle(
  orgId: number,
  before: { status?: string | null } | null,
  after: DealLifecycleSnapshot,
): void {
  try {
    const event = classifyDealMutation(before, after);
    if (!event) return;
    const publish =
      event.kind === "discovered"
        ? eventMeshPublisher.dealDiscovered(orgId, event.payload)
        : event.kind === "closed"
          ? eventMeshPublisher.dealClosed(orgId, event.payload)
          : eventMeshPublisher.dealUpdated(orgId, event.payload);
    void publish.catch((err) => {
      logger.warn(
        `[dealLifecycleEvents] mesh publish failed for deal ${after.id} (${event.kind}) — swallowed, mutation unaffected`,
        err instanceof Error ? err : undefined,
      );
    });
  } catch (err) {
    logger.warn(
      "[dealLifecycleEvents] lifecycle classification failed (swallowed)",
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * The `after.status` a retention purge reports (auditRepo.purgeOldDeals):
 * the deal is gone because it aged out, not because the sale was undone —
 * the commission owed on it stands (dealClose.recordDealReopen).
 */
export const DEAL_PURGED = "purged";

/**
 * The evidence a stage transition carries (quality directive 2026-09-29,
 * audits of e3debe0 and 224a5c0). It was recorded by one route, then beside
 * seven route-level emitters — while the undo, the bulk endpoint, workflows,
 * the agent, voice-call CRM updates, title closing and soft deletes changed
 * `deals.status` without it. It now runs where the status is written: the
 * deal repository (`updateDeal`, `bulkUpdateDeals`, the soft deletes), which
 * every status write goes through (pinned by
 * dealTransitionEvidenceEverywhere.test.ts).
 *
 *  - entering offer_sent is the first-offer activation signal (deduped per
 *    org by the activation table);
 *  - leaving closed — reopened, or deleted — retracts the sale the close
 *    recorded (marked an outlier, not deleted) and its commission
 *    (dealClose.recordDealReopen). A close is NOT recorded here:
 *    the close's consequences are dealClose.recordDealClose, called by the
 *    same repository hook (W10.4), and what qualifies as a sale is decided by
 *    its evidence rule.
 *
 * Fire-and-forget: never throws into the write.
 */
export function recordDealTransitionEvidence(
  orgId: number,
  before: { status?: string | null } | null | undefined,
  after: { id: number; status?: string | null; offerAmount?: string | number | null },
): void {
  try {
    if (!before || (before.status ?? null) === (after.status ?? null)) return;
    const dealId = after.id;
    const swallowed = (what: string) => (err: unknown) =>
      logger.warn(`[dealLifecycleEvents] ${what} failed for deal ${dealId} (swallowed)`, err instanceof Error ? err : undefined);
    if (after.status === "offer_sent") {
      void import("./activation")
        .then(({ recordActivationEventAsync }) =>
          recordActivationEventAsync({
            orgId,
            userId: null,
            eventName: "first_offer_made",
            eventValue: { dealId, offerAmount: after.offerAmount ?? null },
          }),
        )
        .catch(swallowed("first_offer_made"));
    }
    if (before.status === "closed") {
      // The close's reversible money effects are reversed: the training row
      // (under the per-deal lock the close's insert also takes, DEFECT-0258
      // (1), and only if the deal is not closed again by then) and the
      // commission (an unpaid record removed, a paid one flagged for review).
      void import("./dealClose")
        .then(({ recordDealReopen }) => recordDealReopen(orgId, dealId, after.status ?? null))
        .catch(swallowed("reopen retraction"));
    }
  } catch (err) {
    logger.warn("[dealLifecycleEvents] transition evidence failed (swallowed)", err instanceof Error ? err : undefined);
  }
}

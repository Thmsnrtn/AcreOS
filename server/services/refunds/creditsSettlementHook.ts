/**
 * The credits-settlement hook of a processed guarantee refund (design §3.4).
 *
 * S2 IMPLEMENTATION — MOVES NO MONEY. §5A promises that an unused
 * purchased-credit balance is refundable as part of the guarantee request. The
 * claim-machinery settlement (advisory lock + purchase_refund claim row +
 * atomic clawback, oldest purchase first) is its own slice (S3). Until it
 * lands, the design's pre-decided fallback applies: the org's remaining
 * credit position goes to the founder queue as a visible one-tap item — never
 * silent, never automatic on an unverified model.
 *
 * The apply_refund hand's own $50 ceiling is untouched; nothing here calls it.
 *
 * The included monthly AI allowance is metered usage, not a balance (design
 * §2a) — this hook never reads or writes it.
 */
import { storage } from "../../storage";
import { logger } from "../../utils/logger";
import { raiseRefundPipelineAlert } from "./refundAlerts";

export interface CreditsSettlementContext {
  organizationId: number;
  organizationName: string;
  refundRequestId: number;
}

export type CreditsSettlementOutcome =
  | { state: "none"; balanceCents: 0 }
  | { state: "queued_for_founder"; balanceCents: number }
  | { state: "check_failed"; balanceCents: null };

export type CreditsSettlementHook = (ctx: CreditsSettlementContext) => Promise<CreditsSettlementOutcome>;

/** Never throws: the subscription refund has already gone out. */
export const queueCreditsSettlementForFounder: CreditsSettlementHook = async (ctx) => {
  try {
    const org = await storage.getOrganization(ctx.organizationId);
    const balanceCents = Math.max(0, Math.round(Number(org?.creditBalance ?? 0)));
    if (!Number.isFinite(balanceCents) || balanceCents <= 0) return { state: "none", balanceCents: 0 };
    await raiseRefundPipelineAlert({
      type: "refund_credits_settlement",
      severity: "warning",
      title: `Credits to settle: $${(balanceCents / 100).toFixed(2)} (refund request #${ctx.refundRequestId})`,
      message:
        `Org "${ctx.organizationName}" had a guarantee refund processed and still holds ` +
        `$${(balanceCents / 100).toFixed(2)} of credit balance. §5A makes unused PURCHASED credits refundable with the guarantee; ` +
        `spent credits are not. The balance is one fungible number, so which part is purchased-and-unused is a founder call — ` +
        `settle it by hand (nothing was refunded or clawed back automatically).`,
      organizationId: ctx.organizationId,
      requestId: ctx.refundRequestId,
    });
    return { state: "queued_for_founder", balanceCents };
  } catch (err) {
    logger.error(`[Refund] credits position for refund request #${ctx.refundRequestId} could not be read — founder must check the org's credit balance`, err instanceof Error ? err : undefined);
    return { state: "check_failed", balanceCents: null };
  }
};

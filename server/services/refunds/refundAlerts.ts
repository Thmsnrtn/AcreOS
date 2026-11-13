/**
 * system_alerts writers for the refund pipeline. Every queued request gets the
 * same notification the old pending path wrote (type "refund_request"), now
 * carrying its brake code.
 */
import { storage } from "../../storage";
import { logger } from "../../utils/logger";
import type { RefundBrakeCode } from "./guaranteeEligibility";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The "a request is waiting for the founder" notification. Never throws. */
export async function raiseRefundQueueAlert(args: {
  organizationId: number;
  organizationName: string;
  requestId: number;
  amountCents: number;
  brake: RefundBrakeCode | null;
  reason: string | null;
  note?: string;
  severity?: "warning" | "critical";
}): Promise<void> {
  try {
    await storage.createSystemAlert({
      type: "refund_request",
      severity: args.severity ?? "warning",
      title: `Refund Request: ${dollars(args.amountCents)}${args.brake ? ` (brake ${args.brake})` : ""}`,
      message: `Org "${args.organizationName}" requested a refund. Reason: ${args.reason ?? "(none given)"}${args.note ? `\n${args.note}` : ""}`,
      organizationId: args.organizationId,
      relatedEntityType: "refund_request",
      relatedEntityId: args.requestId,
      status: "new",
    });
  } catch (err) {
    logger.error(`[Refund] could not write the queue alert for refund request #${args.requestId}`, err instanceof Error ? err : undefined);
  }
}

/** A founder-facing alert about a refund pipeline event that is not a queue entry. */
export async function raiseRefundPipelineAlert(args: {
  type: string;
  severity: "warning" | "critical";
  title: string;
  message: string;
  organizationId?: number | null;
  requestId?: number | null;
}): Promise<void> {
  try {
    await storage.createSystemAlert({
      type: args.type,
      severity: args.severity,
      title: args.title,
      message: args.message,
      organizationId: args.organizationId ?? undefined,
      relatedEntityType: args.requestId ? "refund_request" : undefined,
      relatedEntityId: args.requestId ?? undefined,
      status: "new",
    });
  } catch (err) {
    logger.error(`[Refund] could not write the "${args.type}" alert`, err instanceof Error ? err : undefined);
  }
}

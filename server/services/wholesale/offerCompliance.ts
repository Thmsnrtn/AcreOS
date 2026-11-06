/**
 * Assignment compliance for OFFERING a property under contract — and the one
 * place a compliance acknowledgement is RECORDED (wholesale package, Leg 3).
 *
 * ── WHAT WAS UNGATED ────────────────────────────────────────────────────────
 * `checkAssignmentCompliance` (routes-wholesaler-rules.ts) guarded the three
 * paths that DRAFT an assignment document. It guarded none of the paths that
 * ADVERTISE a property to buyers, though a property the org holds only under
 * an assignable contract (`properties.status = "under_contract"`, which
 * `offerabilityRefusal` admits as offerable) is exactly what a state's
 * advertising restriction is about. The population is every caller that
 * offers a property outward, enumerated in offerCompliancePopulation.test.ts:
 * the buyer blast, listing create, publish and syndicate, the property flyer,
 * and the background channel sync.
 *
 * ── THE RULE, SAME AS THE DOCUMENT GATES ────────────────────────────────────
 *   - not under contract (owned / listed land): the gate does not apply — the
 *     assignment rules govern a contract right, not land the org owns;
 *   - a state `block` (license_required, or no rule on file): refused;
 *   - a state `warn`: refused until the operator acknowledges it, and the
 *     acknowledgement is RECORDED before the action proceeds. If it cannot be
 *     recorded the action is refused: an acknowledgement nobody can later
 *     produce is not one.
 *
 * The rule CONTENT (which state blocks, which warns) is the registry's —
 * attorney work this module never reads around or alters.
 *
 * ── WHERE THE ACKNOWLEDGEMENT LIVES ─────────────────────────────────────────
 * `audit_log`: org-scoped, append-only (a trigger refuses UPDATE/DELETE) and
 * hash-chained per org. No new table: an acknowledgement is an auditable act
 * by a named user, which is what that table records.
 */
import type { AssignmentComplianceResult } from "../../routes-wholesaler-rules";
import { chainAndInsertAuditLog } from "../../utils/auditLogChain";
import type { Response } from "express";
import { logger } from "../../utils/logger";
import { sendError } from "../../utils/errors";

/** Every surface that can act on a warn — the acknowledgement names which one. */
export type ComplianceSurface =
  | "buyer_blast"
  | "listing_create"
  | "listing_publish"
  | "listing_syndicate"
  | "property_flyer"
  | "generated_document"
  | "document_package"
  | "contract_chain_draft";

const COMPLIANCE_ACK_ACTION = "wholesale.compliance_ack" as const;

export interface ComplianceAckContext {
  organizationId: number;
  userId: string | null;
  surface: ComplianceSurface;
  /** What the acknowledged action is about — "property", "deal", "document_template". */
  entityType: string;
  entityId: number | null;
  state: string | null | undefined;
}

/** Thrown when an acknowledgement could not be written; callers refuse. */
class ComplianceAckNotRecordedError extends Error {}

/**
 * Write the operator's acknowledgement of a state-rule warning. Awaited and
 * throwing — never fire-and-forget — because the action it licenses must not
 * proceed without it.
 */
export async function recordComplianceAck(
  ctx: ComplianceAckContext,
  result: Pick<AssignmentComplianceResult, "recommendation" | "citation" | "summary" | "attorneyReviewed">,
): Promise<number> {
  try {
    const row = await chainAndInsertAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: COMPLIANCE_ACK_ACTION,
      entityType: ctx.entityType,
      entityId: ctx.entityId,
      metadata: {
        surface: ctx.surface,
        state: ctx.state ? ctx.state.toUpperCase() : null,
        recommendation: result.recommendation,
        citation: result.citation,
        summary: result.summary,
        attorneyReviewed: result.attorneyReviewed,
      },
    });
    return row.id;
  } catch (err) {
    logger.error("wholesale.compliance_ack not recorded", err instanceof Error ? err : undefined, {
      metadata: { organizationId: ctx.organizationId, surface: ctx.surface },
    });
    throw new ComplianceAckNotRecordedError("The compliance acknowledgement could not be recorded, so nothing was done. Try again.");
  }
}

/** The body every refusal carries — the same shape the document gates already return. */
function refusalBody(code: "wholesaler_compliance_blocked" | "wholesaler_compliance_warn", r: AssignmentComplianceResult) {
  return {
    error: code,
    message: r.summary,
    recommendation: r.recommendation,
    citation: r.citation,
    attorneyReviewed: r.attorneyReviewed,
    ...(code === "wholesaler_compliance_warn"
      ? { actionRequired: "set ackComplianceWarning=true in the request to acknowledge and proceed" }
      : {}),
    statusCode: 409,
  };
}

export type OfferComplianceOutcome =
  | { ok: true; applies: false }
  | { ok: true; applies: true; warning: ReturnType<typeof refusalBody> | null; ackId: number | null }
  | { ok: false; status: 409 | 503; body: Record<string, unknown> };

/** Is this property offered as an assignable contract right rather than owned land? */
function isAssignmentOffer(status: string | null | undefined): boolean {
  return status === "under_contract";
}

/**
 * Gate one outward offer of a property.
 *
 * `previewOnly` (a dry run that sends nothing): a block still refuses — the
 * operator should learn it before composing a send that cannot happen — and a
 * warn is returned as a `warning` without needing (or recording) an
 * acknowledgement, because nothing is being done yet.
 */
export async function offerComplianceGate(args: {
  organizationId: number;
  userId: string | null;
  property: { id: number; status: string | null | undefined; state: string | null | undefined };
  surface: ComplianceSurface;
  acknowledged: boolean;
  previewOnly?: boolean;
}): Promise<OfferComplianceOutcome> {
  if (!isAssignmentOffer(args.property.status)) return { ok: true, applies: false };

  const { checkAssignmentCompliance } = await import("../../routes-wholesaler-rules");
  const result = await checkAssignmentCompliance(args.property.state);
  if (result.blocked) return { ok: false, status: 409, body: refusalBody("wholesaler_compliance_blocked", result) };
  if (!result.warn) return { ok: true, applies: true, warning: null, ackId: null };

  if (args.previewOnly) return { ok: true, applies: true, warning: refusalBody("wholesaler_compliance_warn", result), ackId: null };
  if (!args.acknowledged) return { ok: false, status: 409, body: refusalBody("wholesaler_compliance_warn", result) };

  try {
    const ackId = await recordComplianceAck(
      {
        organizationId: args.organizationId,
        userId: args.userId,
        surface: args.surface,
        entityType: "property",
        entityId: args.property.id,
        state: args.property.state,
      },
      result,
    );
    return { ok: true, applies: true, warning: null, ackId };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      body: { error: "compliance_ack_not_recorded", message: (err as Error).message, statusCode: 503 },
    };
  }
}

/**
 * For a background path with nobody present to acknowledge (the channel sync):
 * an under-contract property is skipped in any state that blocks OR warns.
 * Returns the reason to skip, or null to proceed.
 */
export async function unattendedOfferRefusal(property: { status: string | null | undefined; state: string | null | undefined }): Promise<string | null> {
  if (!isAssignmentOffer(property.status)) return null;
  const { checkAssignmentCompliance } = await import("../../routes-wholesaler-rules");
  const result = await checkAssignmentCompliance(property.state);
  if (result.blocked) return `Assignment advertising is blocked in ${property.state ?? "this state"}: ${result.summary}`;
  if (result.warn) return `Assignment advertising in ${property.state ?? "this state"} needs an operator's acknowledgement; the background sync cannot give one.`;
  return null;
}

/**
 * Send a refusal from any compliance gate in the standard error envelope
 * ({ error, message, details, statusCode }); the rule's recommendation and
 * citation travel in `details`.
 */
export function sendComplianceRefusal(res: Response, status: number, body: Record<string, unknown>): void {
  const { error, message, statusCode: _s, ...details } = body as { error: string; message: string; statusCode?: number } & Record<string, unknown>;
  sendError(res, status, error, message, Object.keys(details).length ? details : undefined);
}

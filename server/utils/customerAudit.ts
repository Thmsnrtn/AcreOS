/**
 * customerAudit — writer for the customer-visible security activity log.
 *
 * Tahoe / Beatrice. Single chokepoint for security/data-significant events
 * that the CUSTOMER is allowed to see in Settings → Security activity:
 *   - auth: login, logout
 *   - members: invited, removed, role changed
 *   - billing: autopay toggled, plan/subscription changed, cancelled/paused
 *   - data: export requested/completed
 *   - security: tax-identity changed, API key issued/revoked
 *
 * Every call is fire-and-forget on the DB write — an audit-write failure can
 * never crash the request that triggered the action. Failures are logged via
 * the structured logger.
 *
 * MOUNTS the data-classification registry: any `metadata` passed here is run
 * through redactByClassification(.., { label: true }) so PII / financial
 * values are reduced to a class LABEL (e.g. "[Personal]", "[Financial]")
 * before they are persisted and surfaced to the customer. The action itself,
 * the actor, and non-sensitive fields are preserved.
 */

import type { Request } from "express";
import { db } from "../db";
import { customerAuditLog } from "@shared/schema";
import { redactByClassification } from "@shared/data-classification";
import { logger } from "./logger";

export type CustomerAuditCategory =
  | "auth"
  | "members"
  | "billing"
  | "data"
  | "security";

export interface CustomerAuditInput {
  organizationId: number;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string; // dot-namespaced, must match a CustomerAuditActions value
  category: CustomerAuditCategory;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Optional source table for `metadata`. When set, the classification
   * registry is consulted by exact `<table>.<column>` key (more precise than
   * the name heuristic) to decide which metadata values get class-labelled.
   */
  metadataTable?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Centralised action strings — grep-able, never renamed (log is permanent). */
export const CustomerAuditActions = {
  // auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  // members
  MEMBER_INVITED: "member.invited",
  MEMBER_REMOVED: "member.removed",
  MEMBER_ROLE_CHANGED: "member.role_changed",
  // billing
  BILLING_AUTOPAY_TOGGLED: "billing.autopay_toggled",
  BILLING_PLAN_CHANGED: "billing.plan_changed",
  BILLING_SUBSCRIPTION_CANCELLED: "billing.subscription_cancelled",
  // data
  DATA_EXPORT: "data.export",
  // security
  SECURITY_TAX_IDENTITY_CHANGED: "security.tax_identity_changed",
  SECURITY_API_KEY_ISSUED: "security.api_key_issued",
  SECURITY_API_KEY_REVOKED: "security.api_key_revoked",
} as const;

export type CustomerAuditActionName =
  (typeof CustomerAuditActions)[keyof typeof CustomerAuditActions];

/**
 * Write one customer-visible audit row. Never throws. Metadata is class-
 * labelled via the classification registry before persistence.
 */
export async function customerAudit(input: CustomerAuditInput): Promise<void> {
  try {
    const safeMetadata = redactByClassification(input.metadata ?? {}, {
      label: true,
      table: input.metadataTable,
    }) as Record<string, unknown>;

    await db.insert(customerAuditLog).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      category: input.category,
      targetLabel: input.targetLabel ?? null,
      metadata: safeMetadata,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (err) {
    logger.error(
      "[customerAudit] write failed",
      err instanceof Error ? err : undefined,
      { metadata: { action: input.action, category: input.category } },
    );
  }
}

/**
 * Convenience: pull actor + request context off an Express request and write.
 * The caller supplies orgId explicitly so this works on routes where org is
 * resolved by middleware.
 */
export async function customerAuditFromRequest(
  req: Request,
  payload: Omit<
    CustomerAuditInput,
    "actorUserId" | "actorEmail" | "ipAddress" | "userAgent"
  >,
): Promise<void> {
  const user = (req as any).user as
    | { id?: string; email?: string; clerkUserId?: string }
    | undefined;
  const auth = (req as any).auth as { userId?: string } | undefined;
  const actorUserId =
    auth?.userId ?? user?.clerkUserId ?? user?.id ?? null;
  const fwd = req.headers["x-forwarded-for"];
  const ipAddress =
    (typeof fwd === "string"
      ? fwd.split(",")[0]?.trim()
      : Array.isArray(fwd)
        ? fwd[0]
        : undefined) ??
    req.socket?.remoteAddress ??
    null;
  return customerAudit({
    ...payload,
    actorUserId,
    actorEmail: user?.email ?? null,
    ipAddress,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
  });
}

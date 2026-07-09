/**
 * auditLog — sensitive-action audit helper (Phase 3 Week 11).
 *
 * Single chokepoint for every sensitive action that must land in
 * `audit_events`. Sensitive actions include:
 *   - Auth: login, logout, MFA enable/disable
 *   - Password resets, password changes
 *   - Org ownership transfers, member adds/removes
 *   - Billing changes (plan switch, refund issued)
 *   - DSAR actions (intake, verify, fulfil, erasure, deny)
 *   - Data exports
 *   - Settings changes (tax identity, notification prefs, autopay state)
 *
 * The helper is deliberately fire-and-forget on the database write — every
 * call is wrapped so an audit-write failure cannot crash the request that
 * triggered the sensitive action. Failures are logged via the structured
 * logger so an out-of-band aggregator (Datadog) still sees the gap.
 *
 * IMPORTANT: `audit_events` ships with an append-only trigger
 * (migrations/0049_dsar_audit_subprocessors.sql). Never UPDATE or DELETE
 * audit rows from application code.
 */

import type { Request } from "express";
import { getClerkAuth } from "../types/request";
import { logger } from "./logger";
import { chainAndInsertAuditEvent } from "./auditEventsChain";

export type AuditTargetType =
  | "user"
  | "organization"
  | "session"
  | "route"
  | "billing"
  | "dsar"
  | "subprocessor"
  | "settings"
  | "export"
  // Solene dispatch — used by the founder-bypass review path so the
  // alignment detector can join its review row back to the bypassed dispatch.
  | "dispatch";

export interface AuditActor {
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditTarget {
  type: AuditTargetType;
  id: string | number;
}

export interface AuditLogInput {
  actor: AuditActor;
  action: string; // dot-namespaced, e.g. "auth.login", "billing.plan_switch", "dsar.verify"
  target: AuditTarget;
  justification?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write a sensitive-action row to audit_events. Never throws — if the audit
 * write fails the error is logged and execution continues. Callers should
 * `await` for ordering but do not need a try/catch.
 */
export async function auditLog(input: AuditLogInput): Promise<void> {
  try {
    // Beatrice / compliance-debt §2 — write through the hash-chain helper so
    // every crown-jewel event (login, MFA-disable, ownership-transfer, refund,
    // DSAR-erasure) is tamper-evident, matching audit_log. The row is inserted
    // already-chained in a single statement (audit_events is append-only and
    // rejects the insert-then-UPDATE pattern audit_log uses).
    await chainAndInsertAuditEvent({
      actorUserId: input.actor.userId ?? null,
      actorEmail: input.actor.email ?? null,
      action: input.action,
      targetType: input.target.type,
      targetId: String(input.target.id),
      justification: input.justification ?? null,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
      ip: input.actor.ip ?? null,
      userAgent: input.actor.userAgent ?? null,
    });
  } catch (err) {
    logger.error("[auditLog] write failed", err as Error, {
      metadata: { action: input.action, targetType: input.target.type },
    });
  }
}

/**
 * Extract an AuditActor from an Express request. Works on both
 * unauthenticated requests (DSAR intake) and authenticated ones.
 */
export function actorFromRequest(req: Request): AuditActor {
  const user = req.user as { id?: string; email?: string | null; clerkUserId?: string | null } | undefined;
  const auth = getClerkAuth(req);
  const userId = auth?.userId ?? user?.clerkUserId ?? user?.id ?? null;
  const email = user?.email ?? null;
  const fwd = req.headers["x-forwarded-for"];
  const ip =
    (typeof fwd === "string" ? fwd.split(",")[0]?.trim() : Array.isArray(fwd) ? fwd[0] : undefined) ??
    req.socket?.remoteAddress ??
    null;
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
  return { userId, email, ip, userAgent };
}

/**
 * Convenience wrapper: pull actor from request, log, fire-and-forget.
 */
export async function auditFromRequest(
  req: Request,
  payload: Omit<AuditLogInput, "actor">
): Promise<void> {
  return auditLog({ actor: actorFromRequest(req), ...payload });
}

// ─── Action namespace constants ─────────────────────────────────────────────
// Centralising action strings makes it grep-able which call sites emit which
// events. Keep dot-namespaced; never rename — the audit log is permanent.
export const AuditActions = {
  // Auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_LOGIN_FAILED: "auth.login_failed",
  AUTH_PASSWORD_RESET_REQUESTED: "auth.password_reset_requested",
  AUTH_PASSWORD_CHANGED: "auth.password_changed",
  AUTH_MFA_ENABLED: "auth.mfa_enabled",
  AUTH_MFA_DISABLED: "auth.mfa_disabled",
  // Org membership
  ORG_OWNERSHIP_TRANSFERRED: "org.ownership_transferred",
  ORG_MEMBER_ADDED: "org.member_added",
  ORG_MEMBER_REMOVED: "org.member_removed",
  // Billing
  BILLING_PLAN_SWITCHED: "billing.plan_switched",
  BILLING_REFUND_ISSUED: "billing.refund_issued",
  BILLING_AUTOPAY_TOGGLED: "billing.autopay_toggled",
  // DSAR
  DSAR_INTAKE: "dsar.intake",
  DSAR_VERIFY_SENT: "dsar.verify_sent",
  DSAR_VERIFIED: "dsar.verified",
  DSAR_FULFILLING: "dsar.fulfilling",
  DSAR_COMPLETED: "dsar.completed",
  DSAR_DENIED: "dsar.denied",
  DSAR_ERASURE: "dsar.erasure",
  // Data exports
  DATA_EXPORT: "data.export",
  // Settings
  SETTINGS_TAX_IDENTITY_CHANGED: "settings.tax_identity_changed",
  SETTINGS_NOTIFICATION_PREFS_CHANGED: "settings.notification_prefs_changed",
  SETTINGS_AUTOPAY_STATE_CHANGED: "settings.autopay_state_changed",
  // Sub-processor registry
  SUBPROCESSOR_UPDATED: "subprocessor.updated",
  // Alignment — founder-bypass post-hoc review. Written when the founder (or
  // Quinn on the founder's behalf) documents the review of a sovereign bypass.
  // The founder-bypass alignment detector keys on this action + targetType
  // "dispatch" + targetId=dispatch_id to decide whether a bypass is closed.
  ALIGNMENT_FOUNDER_BYPASS_REVIEWED: "alignment.founder_bypass_reviewed",
} as const;

export type AuditActionName = (typeof AuditActions)[keyof typeof AuditActions];

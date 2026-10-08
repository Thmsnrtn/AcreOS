/**
 * WitnessGrant — delegable, policy-bound witnessing authority (Frontier #13).
 * KERNEL.
 *
 * Witnessed-send is the keystone: a customer-facing / money / broadcast action
 * fires ONLY on a real human's tap (hands/registry.executeHandWitnessed). That
 * is correct and must never weaken — but it also doesn't scale past one founder
 * tapping everything. A WitnessGrant lets the founder DELEGATE the tap for a
 * BOUNDED class of actions to a named principal, without surrendering control:
 *
 *   • A grant can only ever be NARROWER than the founder's own authority —
 *     it carries explicit bounds (domains, per-action cost ceiling, a total
 *     action budget, an expiry) and is revocable at any time.
 *   • It NEVER removes accountability: a delegated send still produces a
 *     proof-receipt naming BOTH the grantee (who tapped) AND the grantor (whose
 *     authority) + the grant id. The chain still answers "on whose authority?".
 *   • It fails CLOSED: any expiry / revocation / out-of-bounds / malformed input
 *     → NOT authorized. Absence of a grant is simply the status quo (the founder
 *     taps). A grant only ever ADDS a bounded delegate path; it removes nothing.
 *
 * This module is the pure POLICY ENGINE — types + evaluation, exhaustively
 * testable, no DB, no clock (now is injected). Persistence + the approval-path
 * integration are deliberately separate: wiring a delegate into the live
 * human-in-the-loop path is a reviewed change (see the integration contract at
 * the foot of this file), because the keystone's blast radius demands it.
 */

import type { AutopilotDomain } from "./policyGate";
import { HARD_STOP_SPEND_LIMIT_USD } from "./hardStops";

/** The bounds a grant may never exceed. Every field is a CEILING / allowlist. */
export interface WitnessGrantBounds {
  /** Domains this grant covers. Empty ⇒ covers NOTHING (fail-closed default). */
  domains: AutopilotDomain[];
  /**
   * Hand names this grant covers. Empty or absent ⇒ covers NOTHING. A grant
   * names the exact hands it releases — a "finance" grant is not a licence for
   * every finance-domain hand a coding agent might draft.
   */
  hands?: string[];
  /**
   * Drafting roles this grant covers (the pending action's source_role).
   * Empty or absent ⇒ covers NOTHING. A draft with no role (a coding dispatch,
   * the chat) is never covered by any grant.
   */
  sourceRoles?: string[];
  /** Per-action predicted-cost ceiling in USD. An action above it is not covered. */
  maxCostUsd: number;
  /** Total number of actions this grant may witness over its life. */
  maxActions: number;
  /** ISO expiry. After this instant the grant is dead. */
  expiresAt: string;
  /** If true, this grant may NOT witness money-moving actions (extra belt). */
  denyMoney?: boolean;
  /** If true, this grant may NOT witness public broadcasts. */
  denyBroadcast?: boolean;
}

export interface WitnessGrant {
  id: string;
  /** The human delegating authority — always a real founder/principal. */
  grantorId: string;
  /** The principal authorized to tap on the grantor's behalf. */
  granteeId: string;
  bounds: WitnessGrantBounds;
  /** Count of actions already witnessed under this grant. */
  usedCount: number;
  revoked: boolean;
  issuedAt: string;
}

/** The minimal description of the action a grant is being asked to cover. */
export interface WitnessRequest {
  /** The frozen hand's name. */
  handName: string;
  /** Who drafted it (pending action source_role); null ⇒ no grant covers it. */
  sourceRole: string | null;
  domain: AutopilotDomain;
  predictedCostUsd: number;
  movesMoney: boolean;
  isBroadcast: boolean;
  /** The principal proposing to tap (must equal the grant's grantee). */
  granteeId: string;
}

export interface WitnessGrantVerdict {
  /** True ONLY if every bound is satisfied. Default stance is false. */
  authorized: boolean;
  reason: string;
  /** On an authorized verdict, the accountability pair for the receipt. */
  attribution?: { grantee: string; grantor: string; grantId: string };
}

const DENY = (reason: string): WitnessGrantVerdict => ({ authorized: false, reason });

/**
 * The drafting roles whose frozen actions a grant may ever release, per hand.
 * This is the role tools' rule set expressed as data: Support drafts ticket
 * replies and refunds of its ticket's own purchases; Retention (and the
 * governed outbound-email seam) draft system mail to an org's owner. Any hand
 * not listed — and any role not listed for it — is founder-tap only, forever,
 * whatever a grant names. Hand-specific execution rules (the refund's
 * org/once/≤cost rule, the delegated email's owner-only recipient) are
 * re-checked at execution by the hand / delegationRules.ts.
 */
export const DELEGABLE_HANDS: Readonly<Record<string, readonly string[]>> = {
  reply_support_ticket: ["support"],
  apply_refund: ["support"],
  send_email: ["retention", "outbound_seam"],
};

/** Every role a grant may name. */
export const GRANTABLE_SOURCE_ROLES: readonly string[] = [...new Set(Object.values(DELEGABLE_HANDS).flat())];

/** True when `handName` drafted by `sourceRole` may ever be grant-released. Pure. */
export function isDelegableDraft(handName: string, sourceRole: string | null | undefined): boolean {
  if (!sourceRole) return false;
  const roles = Object.prototype.hasOwnProperty.call(DELEGABLE_HANDS, handName) ? DELEGABLE_HANDS[handName] : undefined;
  return !!roles && roles.includes(sourceRole);
}

/**
 * Decide whether `grant` authorizes `req` at instant `nowMs`. Pure + total +
 * fail-closed: ANY problem (revoked, expired, exhausted, wrong grantee, domain
 * not covered, over cost, money/broadcast denied, malformed) returns DENY. An
 * authorized verdict carries the grantor+grantee attribution the proof-receipt
 * must record — delegation never erases who is accountable.
 */
export function evaluateWitnessGrant(grant: WitnessGrant, req: WitnessRequest, nowMs: number): WitnessGrantVerdict {
  if (!grant || !req) return DENY("missing grant or request");
  if (grant.revoked) return DENY("grant revoked");
  if (grant.granteeId !== req.granteeId) return DENY("grantee mismatch — this principal is not the delegate");
  if (!grant.granteeId || !grant.grantorId) return DENY("grant missing principal attribution");

  const exp = Date.parse(grant.bounds?.expiresAt ?? "");
  if (!Number.isFinite(exp) || nowMs >= exp) return DENY("grant expired");

  if (!(grant.usedCount < grant.bounds.maxActions)) return DENY("grant action budget exhausted");

  if (!grant.bounds.domains.includes(req.domain)) return DENY(`domain "${req.domain}" not in grant`);

  // The hand + drafting-role bounds. Both are allowlists that fail closed:
  // a hand or role the grant does not NAME is not covered, a draft with no
  // role is never covered, and a (hand, role) pair outside DELEGABLE_HANDS —
  // the role tools' own rules about who may draft what — is never covered
  // whatever a grant names.
  if (!Array.isArray(grant.bounds.hands) || !grant.bounds.hands.includes(req.handName)) {
    return DENY(`hand "${req.handName}" not in grant`);
  }
  if (!req.sourceRole) return DENY("draft has no source role — only a founder tap releases it");
  if (!Array.isArray(grant.bounds.sourceRoles) || !grant.bounds.sourceRoles.includes(req.sourceRole)) {
    return DENY(`source role "${req.sourceRole}" not in grant`);
  }
  if (!isDelegableDraft(req.handName, req.sourceRole)) {
    return DENY(`${req.handName} drafted by ${req.sourceRole} is never grant-released`);
  }

  // The permanent >$500 spend hard-stop binds ABOVE any grant: a founder-issued
  // grant whose maxCostUsd exceeds the hard-stop cannot authorize a spend past
  // it. Previously grant ceilings were unclamped, so a generous grant could
  // delegate a spend the hard-stop list says is never autonomous.
  const effectiveCeiling = Math.min(grant.bounds.maxCostUsd, HARD_STOP_SPEND_LIMIT_USD);
  if (!(req.predictedCostUsd <= effectiveCeiling)) {
    return DENY(
      effectiveCeiling < grant.bounds.maxCostUsd
        ? `action cost $${req.predictedCostUsd} exceeds the permanent $${HARD_STOP_SPEND_LIMIT_USD} spend hard-stop (grant ceiling $${grant.bounds.maxCostUsd} is clamped to it)`
        : `action cost $${req.predictedCostUsd} exceeds grant ceiling $${grant.bounds.maxCostUsd}`,
    );
  }
  if (req.movesMoney && grant.bounds.denyMoney) return DENY("grant does not cover money-moving actions");
  if (req.isBroadcast && grant.bounds.denyBroadcast) return DENY("grant does not cover broadcasts");

  return {
    authorized: true,
    reason: "within grant bounds",
    attribution: { grantee: grant.granteeId, grantor: grant.grantorId, grantId: grant.id },
  };
}

/**
 * Pick the FIRST grant (if any) that authorizes the request. Returns the verdict
 * + the winning grant, or a DENY verdict when none cover it. Deterministic over
 * the input order. Pure.
 */
export function authorizeByAnyGrant(
  grants: WitnessGrant[],
  req: WitnessRequest,
  nowMs: number,
): { verdict: WitnessGrantVerdict; grant: WitnessGrant | null } {
  for (const g of grants) {
    const v = evaluateWitnessGrant(g, req, nowMs);
    if (v.authorized) return { verdict: v, grant: g };
  }
  return { verdict: DENY("no grant authorizes this action"), grant: null };
}

/* ── INTEGRATION CONTRACT (WIRED — consumed by autoWitness.ts) ────────────────
 *
 * Status (W7 comment reconciliation, 2026-07): this contract IS live —
 * server/services/autopilot/autoWitness.ts calls authorizeByAnyGrant() and
 * follows the steps below. The original note said "NOT wired this session,"
 * which stayed stale after the wiring landed. The contract text remains as
 * the reference for how a delegated tap honors the keystone:
 *
 * executeHandWitnessed currently accepts a non-empty `witnessedBy` string. To
 * honor a delegated tap WITHOUT weakening the keystone, the approval ENDPOINT
 * (not this kernel) would, for a tap by a non-founder principal:
 *   1. load the live, non-revoked grants for the org/platform scope,
 *   2. build a WitnessRequest from the frozen action (domain, predicted cost,
 *      movesMoney, outwardClass==="broadcast", granteeId = the tapping principal),
 *   3. authorizeByAnyGrant(...) at the current time,
 *   4. on authorized: proceed AND atomically increment the grant's usedCount
 *      (so the action budget is real), recording attribution.grantor +
 *      attribution.grantId on the proof-receipt alongside the grantee,
 *   5. on DENY: refuse exactly as today (a missing/insufficient grant is the
 *      status quo — the founder must tap).
 * A founder's own tap bypasses all of this (no grant needed). With zero grants
 * issued, behavior is identical to today. This is intentionally left for review
 * because it edits the human-in-the-loop path. */

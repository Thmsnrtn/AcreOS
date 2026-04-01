/**
 * Temporary Delegation — Sovereign Company Protocol v5
 *
 * CEO says "Let Sophie handle all support without asking me until Friday"
 * → Sophie's authority is temporarily elevated for support actions.
 *
 * Delegations auto-expire. When they expire, authority reverts.
 * CEO can revoke delegations early.
 */

import { db } from "../db";
import { companyAgents } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { logger } from "../utils/logger";

interface Delegation {
  id: string;
  agentCodename: string;
  elevatedActions: string[]; // which actions are elevated
  fromLevel: number;         // original authority level
  toLevel: number;           // elevated authority level (0 = full autonomy)
  expiresAt: Date;
  reason: string;
  isActive: boolean;
  createdAt: Date;
}

// In-memory delegation store (backed by the authority gate checks)
const activeDelegations: Map<string, Delegation> = new Map();

/**
 * Grant temporary authority elevation to an agent.
 */
export function grantTemporaryAuthority(params: {
  agentCodename: string;
  actions?: string[];       // specific actions, or empty for all
  toLevel?: number;         // default: 0 (full autonomy)
  durationHours: number;
  reason: string;
}): Delegation {
  const id = `deleg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const delegation: Delegation = {
    id,
    agentCodename: params.agentCodename,
    elevatedActions: params.actions || ["*"], // "*" means all actions
    fromLevel: 2, // default: recommend+wait
    toLevel: params.toLevel ?? 0, // default: full autonomy
    expiresAt: new Date(Date.now() + params.durationHours * 60 * 60 * 1000),
    reason: params.reason,
    isActive: true,
    createdAt: new Date(),
  };

  activeDelegations.set(id, delegation);
  logger.info(`[Delegation] Granted: ${params.agentCodename} elevated to level ${delegation.toLevel} for ${params.durationHours}h. Reason: ${params.reason}`);

  return delegation;
}

/**
 * Check if an agent has a temporary delegation for a specific action.
 * Called by the authority gate before checking static authority config.
 */
export function checkTemporaryDelegation(agentCodename: string, action: string): {
  hasDelegation: boolean;
  toLevel: number;
  delegationId?: string;
  reason?: string;
} {
  // Clean expired delegations
  const now = new Date();
  for (const [id, deleg] of activeDelegations) {
    if (deleg.expiresAt <= now) {
      deleg.isActive = false;
      activeDelegations.delete(id);
      logger.info(`[Delegation] Expired: ${deleg.agentCodename} delegation ${id}`);
    }
  }

  // Find matching active delegation
  for (const [id, deleg] of activeDelegations) {
    if (deleg.agentCodename !== agentCodename || !deleg.isActive) continue;
    if (deleg.elevatedActions.includes("*") || deleg.elevatedActions.includes(action)) {
      return {
        hasDelegation: true,
        toLevel: deleg.toLevel,
        delegationId: id,
        reason: deleg.reason,
      };
    }
  }

  return { hasDelegation: false, toLevel: 3 };
}

/**
 * Revoke a delegation early.
 */
export function revokeDelegation(delegationId: string): boolean {
  const deleg = activeDelegations.get(delegationId);
  if (!deleg) return false;
  deleg.isActive = false;
  activeDelegations.delete(delegationId);
  logger.info(`[Delegation] Revoked: ${deleg.agentCodename} delegation ${delegationId}`);
  return true;
}

/**
 * Get all active delegations (for display in CEO dashboard).
 */
export function getActiveDelegations(): Delegation[] {
  const now = new Date();
  const active: Delegation[] = [];

  for (const [id, deleg] of activeDelegations) {
    if (deleg.expiresAt <= now) {
      activeDelegations.delete(id);
      continue;
    }
    if (deleg.isActive) active.push(deleg);
  }

  return active;
}

/**
 * Revoke all delegations for an agent.
 */
export function revokeAllForAgent(agentCodename: string): number {
  let revoked = 0;
  for (const [id, deleg] of activeDelegations) {
    if (deleg.agentCodename === agentCodename && deleg.isActive) {
      deleg.isActive = false;
      activeDelegations.delete(id);
      revoked++;
    }
  }
  return revoked;
}

/**
 * Delegation Tokens — Sovereign Company Protocol v11
 *
 * CEO grants temporary elevated authority:
 * - "Sophie, you can issue refunds up to $500 until Friday"
 * - Token: { agent, scope, limit, expiry, conditions }
 * - Auto-revocation on expiry or condition violation
 * - Standing delegation: renewable tokens that auto-extend
 * - Revocation triggers: misuse (failure rate > 40%) → auto-revoke
 */

import { db } from "../db";
import { delegationTokens, type DelegationToken } from "@shared/schema";
import { eq, desc, and, lte, gte, sql } from "drizzle-orm";

const AUTO_REVOKE_FAILURE_RATE = 40; // % failures to trigger auto-revocation

class DelegationTokenService {

  /**
   * Grant a delegation token to an agent.
   */
  async grant(params: {
    agentCodename: string;
    scope: string;
    authorityLevel?: number;
    spendingLimitCents?: number;
    conditions?: Record<string, any>;
    reason: string;
    expiresAt: Date;
    isStanding?: boolean;
    autoRenewDays?: number;
  }): Promise<DelegationToken> {
    const [token] = await db.insert(delegationTokens).values({
      agentCodename: params.agentCodename,
      scope: params.scope,
      authorityLevel: params.authorityLevel || 1,
      spendingLimitCents: params.spendingLimitCents || null,
      conditions: params.conditions || {},
      reason: params.reason,
      expiresAt: params.expiresAt,
      isStanding: params.isStanding || false,
      autoRenewDays: params.autoRenewDays || null,
    }).returning();
    return token;
  }

  /**
   * Check if an agent has a valid delegation for a scope.
   */
  async checkDelegation(agentCodename: string, scope: string, amountCents?: number): Promise<{
    hasDelegation: boolean;
    token?: DelegationToken;
    reason?: string;
  }> {
    const tokens = await db.select().from(delegationTokens)
      .where(and(
        eq(delegationTokens.agentCodename, agentCodename),
        eq(delegationTokens.scope, scope),
        eq(delegationTokens.status, "active"),
      ));

    for (const token of tokens) {
      // Check expiry
      if (new Date() > new Date(token.expiresAt)) {
        await this.expire(token.id);
        continue;
      }

      // Check spending limit
      if (amountCents && token.spendingLimitCents && amountCents > token.spendingLimitCents) {
        return { hasDelegation: false, reason: `Amount $${(amountCents / 100).toFixed(2)} exceeds delegation limit $${(token.spendingLimitCents / 100).toFixed(2)}` };
      }

      return { hasDelegation: true, token };
    }

    return { hasDelegation: false, reason: "No active delegation for this scope" };
  }

  /**
   * Record that an agent used their delegation.
   */
  async recordUsage(tokenId: number, success: boolean): Promise<void> {
    const [token] = await db.select().from(delegationTokens)
      .where(eq(delegationTokens.id, tokenId)).limit(1);
    if (!token) return;

    const updates: Partial<DelegationToken> = {
      actionsTaken: token.actionsTaken + 1,
    };

    if (success) {
      updates.actionsSucceeded = token.actionsSucceeded + 1;
    } else {
      updates.actionsFailed = token.actionsFailed + 1;
    }

    // Auto-revoke on high failure rate
    const totalActions = token.actionsTaken + 1;
    const failedActions = (success ? token.actionsFailed : token.actionsFailed + 1);
    if (totalActions >= 5) {
      const failureRate = (failedActions / totalActions) * 100;
      if (failureRate >= AUTO_REVOKE_FAILURE_RATE) {
        updates.revoked = true;
        updates.revokedAt = new Date();
        updates.revocationReason = `Auto-revoked: ${Math.round(failureRate)}% failure rate (threshold: ${AUTO_REVOKE_FAILURE_RATE}%)`;
        updates.status = "revoked";
      }
    }

    await db.update(delegationTokens).set(updates).where(eq(delegationTokens.id, tokenId));
  }

  /**
   * Manually revoke a delegation.
   */
  async revoke(tokenId: number, reason: string): Promise<void> {
    await db.update(delegationTokens)
      .set({
        revoked: true,
        revokedAt: new Date(),
        revocationReason: reason,
        status: "revoked",
      })
      .where(eq(delegationTokens.id, tokenId));
  }

  /**
   * Expire a token.
   */
  async expire(tokenId: number): Promise<void> {
    const [token] = await db.select().from(delegationTokens)
      .where(eq(delegationTokens.id, tokenId)).limit(1);

    if (token?.isStanding && token.autoRenewDays) {
      // Auto-renew standing delegations
      const newExpiry = new Date(Date.now() + token.autoRenewDays * 86400000);
      await db.update(delegationTokens)
        .set({ expiresAt: newExpiry })
        .where(eq(delegationTokens.id, tokenId));
    } else {
      await db.update(delegationTokens)
        .set({ status: "expired" })
        .where(eq(delegationTokens.id, tokenId));
    }
  }

  /**
   * Process expired tokens.
   */
  async processExpirations(): Promise<number> {
    const expired = await db.select().from(delegationTokens)
      .where(and(
        eq(delegationTokens.status, "active"),
        lte(delegationTokens.expiresAt, new Date()),
      ));

    for (const token of expired) {
      await this.expire(token.id);
    }

    return expired.length;
  }

  async getActiveForAgent(agentCodename: string): Promise<DelegationToken[]> {
    return db.select().from(delegationTokens)
      .where(and(
        eq(delegationTokens.agentCodename, agentCodename),
        eq(delegationTokens.status, "active"),
      ))
      .orderBy(desc(delegationTokens.createdAt));
  }

  async getAllActive(): Promise<DelegationToken[]> {
    return db.select().from(delegationTokens)
      .where(eq(delegationTokens.status, "active"))
      .orderBy(desc(delegationTokens.createdAt));
  }

  async getRecent(limit = 30): Promise<DelegationToken[]> {
    return db.select().from(delegationTokens)
      .orderBy(desc(delegationTokens.createdAt)).limit(limit);
  }

  async getById(id: number): Promise<DelegationToken | null> {
    const [t] = await db.select().from(delegationTokens)
      .where(eq(delegationTokens.id, id)).limit(1);
    return t || null;
  }
}

export const delegationTokenService = new DelegationTokenService();

/**
 * Temporary Delegation — Sovereign Company Protocol v5
 *
 * CEO says "Let Sophie handle all support without asking me until Friday"
 * → Sophie's authority is temporarily elevated for support actions.
 *
 * Delegations auto-expire. When they expire, authority reverts.
 * CEO can revoke delegations early.
 *
 * DB-BACKED (module-state audit 2026-07-07): this was a module-level Map,
 * which on 2+ Fly machines meant a grant made on the app machine was
 * invisible to the authority gate on the worker — where autonomous
 * execution actually runs — and every deploy silently revoked everything.
 * Delegations now live in `authority_delegations`; active = revoked_at IS NULL
 * AND expires_at > now(). Failure posture: if the DB read fails, the gate
 * sees NO delegation (fail toward less autonomy, never more).
 */

import { db } from "../db";
import { authorityDelegations, type AuthorityDelegation } from "@shared/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface Delegation {
  id: number;
  agentCodename: string;
  elevatedActions: string[]; // which actions are elevated; ["*"] = all
  fromLevel: number;         // original authority level
  toLevel: number;           // elevated authority level (0 = full autonomy)
  expiresAt: Date;
  reason: string;
  isActive: boolean;
  createdAt: Date;
}

function toDelegation(row: AuthorityDelegation): Delegation {
  return {
    id: row.id,
    agentCodename: row.agentCodename,
    elevatedActions: Array.isArray(row.elevatedActions) ? row.elevatedActions : ["*"],
    fromLevel: row.fromLevel,
    toLevel: row.toLevel,
    expiresAt: row.expiresAt,
    reason: row.reason,
    isActive: row.revokedAt === null && row.expiresAt > new Date(),
    createdAt: row.createdAt,
  };
}

/**
 * Grant temporary authority elevation to an agent.
 */
/**
 * An OMITTED field is not a request for maximum authority.
 *
 * `toLevel` defaulted to 0 — full autonomy, and silent: `executeWithAuthority`
 * notifies the founder only at level 1. Combined with `actions` defaulting to
 * `["*"]`, a grant posted as `{ agentCodename, durationHours, reason }` — which
 * is what the founder route forwards when the body omits the rest — put the
 * agent's entire action surface at full autonomy with no notification. Two
 * absent fields, read as the broadest possible grant.
 *
 * The default is now level 1: the agent acts, and the founder is told. Somebody
 * who wants silent full autonomy asks for it explicitly, which is a different
 * act from not mentioning it. The wildcard stays, because "I am away, act for
 * me" is legitimately broad and narrowing it would remove the feature rather
 * than govern it — and the authority gate now refuses to let any delegation
 * elevate an action nobody classified, which is where the real breadth was.
 */
export async function grantTemporaryAuthority(params: {
  agentCodename: string;
  actions?: string[];       // specific actions, or empty for all
  toLevel?: number;         // default: 1 (act, and notify the founder)
  durationHours: number;
  reason: string;
}): Promise<Delegation> {
  const [row] = await db
    .insert(authorityDelegations)
    .values({
      agentCodename: params.agentCodename,
      elevatedActions: params.actions && params.actions.length > 0 ? params.actions : ["*"],
      fromLevel: 2, // default: recommend+wait
      toLevel: params.toLevel ?? 1,
      reason: params.reason,
      expiresAt: new Date(Date.now() + params.durationHours * 60 * 60 * 1000),
    })
    .returning();

  logger.info(
    `[Delegation] Granted: ${params.agentCodename} elevated to level ${row.toLevel} for ${params.durationHours}h. Reason: ${params.reason}`,
  );
  return toDelegation(row);
}

/**
 * Check if an agent has a temporary delegation for a specific action.
 * Called by the authority gate before checking static authority config.
 * FAIL SAFE: any DB error reads as "no delegation" — an unverifiable
 * elevation must never grant autonomy.
 */
export async function checkTemporaryDelegation(
  agentCodename: string,
  action: string,
): Promise<{
  hasDelegation: boolean;
  toLevel: number;
  delegationId?: number;
  reason?: string;
}> {
  try {
    const rows = await db
      .select()
      .from(authorityDelegations)
      .where(
        and(
          eq(authorityDelegations.agentCodename, agentCodename),
          isNull(authorityDelegations.revokedAt),
          gt(authorityDelegations.expiresAt, new Date()),
        ),
      );
    for (const row of rows) {
      const actions = Array.isArray(row.elevatedActions) ? row.elevatedActions : [];
      if (actions.includes("*") || actions.includes(action)) {
        return {
          hasDelegation: true,
          toLevel: row.toLevel,
          delegationId: row.id,
          reason: row.reason,
        };
      }
    }
  } catch (err) {
    logger.warn("[Delegation] check failed — treating as no delegation (fail safe)", {
      metadata: { agentCodename, error: err instanceof Error ? err.message : String(err) },
    });
  }
  return { hasDelegation: false, toLevel: 3 };
}

/**
 * Revoke a delegation early.
 */
export async function revokeDelegation(delegationId: number): Promise<boolean> {
  const [row] = await db
    .update(authorityDelegations)
    .set({ revokedAt: new Date() })
    .where(and(eq(authorityDelegations.id, delegationId), isNull(authorityDelegations.revokedAt)))
    .returning({ id: authorityDelegations.id, agentCodename: authorityDelegations.agentCodename });
  if (!row) return false;
  logger.info(`[Delegation] Revoked: ${row.agentCodename} delegation ${row.id}`);
  return true;
}

/**
 * Get all active delegations (for display in CEO dashboard).
 */
export async function getActiveDelegations(): Promise<Delegation[]> {
  const rows = await db
    .select()
    .from(authorityDelegations)
    .where(and(isNull(authorityDelegations.revokedAt), gt(authorityDelegations.expiresAt, new Date())));
  return rows.map(toDelegation);
}

/**
 * Revoke all delegations for an agent.
 */
export async function revokeAllForAgent(agentCodename: string): Promise<number> {
  const rows = await db
    .update(authorityDelegations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authorityDelegations.agentCodename, agentCodename),
        isNull(authorityDelegations.revokedAt),
        gt(authorityDelegations.expiresAt, new Date()),
      ),
    )
    .returning({ id: authorityDelegations.id });
  return rows.length;
}

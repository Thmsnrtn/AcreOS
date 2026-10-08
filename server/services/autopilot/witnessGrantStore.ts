/**
 * Founder Autopilot — WitnessGrant persistence (step-away gap #5).
 *
 * The DB half of the delegation keystone. witnessGrant.ts is the pure policy
 * engine (evaluate/authorize, no DB, no clock); this module owns the rows and
 * the ONE mutation that must be race-proof: consuming a use from the action
 * budget. consumeGrantUse is a single conditional UPDATE — two concurrent
 * sweeps can never spend the same budget slot twice.
 *
 * Issue-time validation is strict (fail-closed): domains must be known
 * autopilot domains, ceilings positive, expiry in the future and capped at
 * MAX_GRANT_TTL_DAYS so a forgotten grant cannot outlive its intent.
 */
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { witnessGrants, type WitnessGrantRow } from "@shared/schema/autopilot-witness-grants";
import { logger } from "../../utils/logger";
import { DELEGABLE_HANDS, GRANTABLE_SOURCE_ROLES, type WitnessGrant } from "./witnessGrant";
import type { AutopilotDomain } from "./policyGate";
import { AUTOPILOT_DOMAINS } from "./domainAutonomy";

/** The longest a grant may live. Delegation is renewed, never immortal. */
export const MAX_GRANT_TTL_DAYS = 30;

export interface IssueGrantInput {
  grantorId: string;
  granteeId: string;
  domains: AutopilotDomain[];
  /** The hands this grant releases (each must be a delegable hand). */
  hands: string[];
  /** The drafting roles this grant releases for (each must be grantable). */
  sourceRoles: string[];
  maxCostUsd: number;
  maxActions: number;
  expiresAt: Date;
  /** Explicit opt-ins — omitted means the belt stays ON (denied). */
  allowMoney?: boolean;
  allowBroadcast?: boolean;
  note?: string | null;
}

/** Map a DB row to the pure policy engine's WitnessGrant shape. */
export function toPolicyGrant(row: WitnessGrantRow): WitnessGrant {
  return {
    id: String(row.id),
    grantorId: row.grantorId,
    granteeId: row.granteeId,
    bounds: {
      domains: (row.domains ?? []) as AutopilotDomain[],
      hands: Array.isArray(row.hands) ? row.hands : [],
      sourceRoles: Array.isArray(row.sourceRoles) ? row.sourceRoles : [],
      maxCostUsd: Number(row.maxCostUsd),
      maxActions: row.maxActions,
      expiresAt: row.expiresAt.toISOString(),
      denyMoney: row.denyMoney,
      denyBroadcast: row.denyBroadcast,
    },
    usedCount: row.usedCount,
    revoked: row.revoked,
    issuedAt: row.issuedAt.toISOString(),
  };
}

export async function issueWitnessGrant(input: IssueGrantInput): Promise<WitnessGrantRow> {
  if (!input.grantorId?.trim()) throw new Error("issueWitnessGrant: grantorId required");
  if (!input.granteeId?.trim()) throw new Error("issueWitnessGrant: granteeId required");
  if (!Array.isArray(input.domains) || input.domains.length === 0) {
    throw new Error("issueWitnessGrant: at least one domain required (an empty grant covers nothing)");
  }
  const unknown = input.domains.filter((d) => !AUTOPILOT_DOMAINS.includes(d));
  if (unknown.length > 0) {
    throw new Error(`issueWitnessGrant: unknown domain(s): ${unknown.join(", ")}`);
  }
  if (!Array.isArray(input.hands) || input.hands.length === 0) {
    throw new Error("issueWitnessGrant: at least one hand required (a grant names exactly what it releases)");
  }
  const badHands = input.hands.filter((h) => !Object.prototype.hasOwnProperty.call(DELEGABLE_HANDS, h));
  if (badHands.length > 0) {
    throw new Error(`issueWitnessGrant: hand(s) never grant-released: ${badHands.join(", ")} — those stay a founder tap`);
  }
  if (!Array.isArray(input.sourceRoles) || input.sourceRoles.length === 0) {
    throw new Error("issueWitnessGrant: at least one source role required");
  }
  const badRoles = input.sourceRoles.filter((r) => !GRANTABLE_SOURCE_ROLES.includes(r));
  if (badRoles.length > 0) {
    throw new Error(`issueWitnessGrant: unknown source role(s): ${badRoles.join(", ")}`);
  }
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) {
    throw new Error(`issueWitnessGrant: invalid maxCostUsd=${input.maxCostUsd}`);
  }
  if (!Number.isInteger(input.maxActions) || input.maxActions <= 0) {
    throw new Error(`issueWitnessGrant: invalid maxActions=${input.maxActions}`);
  }
  const now = Date.now();
  const exp = input.expiresAt.getTime();
  if (!Number.isFinite(exp) || exp <= now) {
    throw new Error("issueWitnessGrant: expiresAt must be in the future");
  }
  if (exp > now + MAX_GRANT_TTL_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`issueWitnessGrant: expiry exceeds the ${MAX_GRANT_TTL_DAYS}-day cap — delegation is renewed, never immortal`);
  }

  const [row] = await db
    .insert(witnessGrants)
    .values({
      grantorId: input.grantorId,
      granteeId: input.granteeId,
      domains: input.domains,
      hands: [...new Set(input.hands)],
      sourceRoles: [...new Set(input.sourceRoles)],
      maxCostUsd: input.maxCostUsd.toFixed(2),
      maxActions: input.maxActions,
      expiresAt: input.expiresAt,
      denyMoney: input.allowMoney !== true,
      denyBroadcast: input.allowBroadcast !== true,
      note: input.note ?? null,
    })
    .returning();
  logger.warn(
    `[witnessGrantStore] grant #${row.id} ISSUED by ${input.grantorId} to ${input.granteeId}: domains=${input.domains.join("+")} hands=${input.hands.join("+")} roles=${input.sourceRoles.join("+")} ceiling=$${input.maxCostUsd} budget=${input.maxActions} expires=${input.expiresAt.toISOString()} money=${input.allowMoney === true ? "ALLOWED" : "denied"} broadcast=${input.allowBroadcast === true ? "ALLOWED" : "denied"}`,
  );
  return row;
}

export async function revokeWitnessGrant(id: number, reason: string): Promise<boolean> {
  const updated = await db
    .update(witnessGrants)
    .set({ revoked: true, revokedAt: new Date(), revokeReason: reason.slice(0, 2000) })
    .where(eq(witnessGrants.id, id))
    .returning({ id: witnessGrants.id });
  if (updated.length > 0) {
    logger.warn(`[witnessGrantStore] grant #${id} REVOKED: ${reason.slice(0, 200)}`);
  }
  return updated.length > 0;
}

/** Revoke every live grant at once (the panic stop). Returns the ids revoked. */
export async function revokeAllLiveGrants(reason: string): Promise<number[]> {
  const updated = await db
    .update(witnessGrants)
    .set({ revoked: true, revokedAt: new Date(), revokeReason: reason.slice(0, 2000) })
    .where(eq(witnessGrants.revoked, false))
    .returning({ id: witnessGrants.id });
  if (updated.length > 0) logger.warn(`[witnessGrantStore] ${updated.length} grant(s) REVOKED: ${reason.slice(0, 200)}`);
  return updated.map((u) => u.id);
}

/** All grants, newest first — the Control-door ledger view. */
export async function listWitnessGrants(limit = 100): Promise<WitnessGrantRow[]> {
  return db.select().from(witnessGrants).orderBy(desc(witnessGrants.issuedAt)).limit(limit);
}

/** Live (unrevoked, unexpired, budget-remaining) grants for a grantee. */
export async function liveGrantsFor(granteeId: string): Promise<WitnessGrantRow[]> {
  return db
    .select()
    .from(witnessGrants)
    .where(
      sql`${witnessGrants.granteeId} = ${granteeId}
        AND ${witnessGrants.revoked} = false
        AND ${witnessGrants.expiresAt} > now()
        AND ${witnessGrants.usedCount} < ${witnessGrants.maxActions}`,
    )
    .orderBy(desc(witnessGrants.issuedAt));
}

/**
 * Atomically consume one budget slot. Returns true only if THIS call took the
 * slot — the conditional UPDATE re-verifies revocation, expiry, and remaining
 * budget at the database, so a revoke that landed after the in-memory
 * authorization still wins.
 */
export async function consumeGrantUse(id: number): Promise<boolean> {
  const updated = await db
    .update(witnessGrants)
    .set({ usedCount: sql`${witnessGrants.usedCount} + 1` })
    .where(
      sql`${witnessGrants.id} = ${id}
        AND ${witnessGrants.revoked} = false
        AND ${witnessGrants.expiresAt} > now()
        AND ${witnessGrants.usedCount} < ${witnessGrants.maxActions}`,
    )
    .returning({ id: witnessGrants.id });
  return updated.length > 0;
}

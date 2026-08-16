/**
 * Which of these addresses belong to a MEMBER of this organization?
 *
 * An org's own people are AcreOS's own users, and the founder rule defines the
 * `system` send lane as exactly that — "AcreOS talking to its own users". So a
 * membership hit is what tells the undeclared-lane guard in emailService.ts
 * that a same-org counterparty match is NOT deal mail.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────
 * It began as a private helper inside emailService.ts and could not be tested
 * there: the guard's fail-open catch swallows a throwing lookup, so an
 * unmocked db turned every "refuses" case into a silent pass. A test that
 * cannot distinguish "the guard declined" from "the lookup crashed" is not
 * testing the guard. Extracted so it can be mocked by path — the same shape
 * `counterpartyMatch` already has, and mocked the same way.
 *
 * ── WHY TWO SOURCES ──────────────────────────────────────────────────────────
 * This repo resolves "the org's own address" two different ways and both are
 * live, so checking one would leave the other refusing legitimate mail:
 *   - `teamMembers` (owner / admin / member / viewer / va) — what
 *     growthAutomation's getOwnerEmail reads, and where a logged-in user
 *     testing a campaign send lives.
 *   - `users` joined through `organizations.ownerId` — what
 *     agentActionExecutors' resolveOrgContactEmail falls back to.
 *
 * ── NOT COVERED, deliberately ────────────────────────────────────────────────
 * `organizations.settings.companyEmail` is a jsonb blob and is not queried. A
 * send to that address, where the same address is also a same-org lead, would
 * still refuse. Narrower than a jsonb containment query, and written down
 * rather than implied away.
 *
 * Throwing is meaningful: the caller treats an error as "membership unknown"
 * and fails OPEN, because "unknown" is precisely the state that produces the
 * false positive this exists to prevent.
 */
import { db } from "../db";
import { teamMembers, organizations } from "@shared/schema";
import { users } from "@shared/models/auth";
import { eq, sql } from "drizzle-orm";

export async function orgMemberAddresses(
  organizationId: number,
  candidates: string[],
): Promise<Set<string>> {
  const wanted = new Set(candidates.map((c) => c.trim().toLowerCase()).filter(Boolean));
  const found = new Set<string>();
  if (wanted.size === 0) return found;

  const rows = await db
    .select({ email: teamMembers.email })
    .from(teamMembers)
    .where(eq(teamMembers.organizationId, organizationId));
  for (const r of rows) {
    const e = r.email?.trim().toLowerCase();
    if (e && wanted.has(e)) found.add(e);
  }

  // The org owner, resolved the way agentActionExecutors resolves it.
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (org?.ownerId) {
    const owners = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.clerkUserId, org.ownerId))
      .limit(1);
    for (const o of owners) {
      const e = o.email?.trim().toLowerCase();
      if (e && wanted.has(e)) found.add(e);
    }
  }
  void sql;
  return found;
}

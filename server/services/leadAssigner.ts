/**
 * Lead auto-assignment — Phase 5 §5 Part B (team readiness).
 *
 * Given a freshly-created lead and the org's `lead_assignment_rules`, picks
 * the team-member ID that should own the lead. Three rule strategies are
 * supported, applied in priority order (lowest `priority` first):
 *
 *   • round_robin — picks the next assignee in the weighted list, advancing
 *     a per-rule cursor in `org_assignment_cursor`. Weight controls how many
 *     leads land on each rep before moving on (e.g. weight 2 = 2 leads).
 *   • territory  — matches lead.state / lead.county against
 *     `territoryFilter`; if it matches, picks the first weighted assignee.
 *   • random     — picks a weighted-random assignee.
 *
 * The first matching rule that has an active assignee wins. If no rule
 * matches, the function returns `null` and the caller should leave the
 * lead unassigned (the existing behavior pre-rules).
 *
 * Round-robin cursor advancement is wrapped in a transaction with row-level
 * locking so two concurrent /api/leads POSTs cannot hand the same lead to
 * the same rep twice.
 */

import { db } from "../storage";
import {
  leadAssignmentRules,
  orgAssignmentCursor,
  teamMembers,
  type LeadAssignmentRule,
} from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface LeadForAssignment {
  state?: string | null;
  county?: string | null;
}

interface WeightedAssignee {
  teamMemberId: number;
  weight: number;
}

/**
 * Resolves which team_member.id the lead should be assigned to. Returns
 * `null` if no rule matches and the caller should leave assignedTo unset.
 */
export async function assignLead(
  organizationId: number,
  lead: LeadForAssignment,
): Promise<number | null> {
  try {
    const rules = await db
      .select()
      .from(leadAssignmentRules)
      .where(
        and(
          eq(leadAssignmentRules.organizationId, organizationId),
          eq(leadAssignmentRules.isActive, true),
        ),
      )
      .orderBy(asc(leadAssignmentRules.priority));

    if (rules.length === 0) return null;

    // Cache active team-member IDs once; round-robin / territory / random
    // all need to filter their `weightedAssignees` against still-active
    // team members so a fired rep can't be auto-assigned new leads.
    const activeMembers = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.organizationId, organizationId),
          eq(teamMembers.isActive, true),
        ),
      );
    const activeIds = new Set(activeMembers.map((m) => m.id));

    for (const rule of rules) {
      const assignees = filterActive(rule.weightedAssignees ?? [], activeIds);
      if (assignees.length === 0) continue;

      if (rule.ruleType === "territory") {
        if (!matchesTerritory(rule, lead)) continue;
        return assignees[0]!.teamMemberId;
      }

      if (rule.ruleType === "random") {
        return weightedRandomPick(assignees);
      }

      if (rule.ruleType === "round_robin") {
        const next = await advanceRoundRobinCursor(rule.id, assignees);
        if (next != null) return next;
      }
    }

    return null;
  } catch (err) {
    // Lead creation must never fail because rules misbehaved. Log and
    // return null so the lead lands unassigned.
    logger.error("assignLead failed", {
      organizationId,
      error: (err as Error).message,
    });
    return null;
  }
}

function filterActive(
  list: WeightedAssignee[],
  activeIds: Set<number>,
): WeightedAssignee[] {
  return list
    .filter((a) => Number.isFinite(a.teamMemberId) && activeIds.has(a.teamMemberId))
    .map((a) => ({ teamMemberId: a.teamMemberId, weight: Math.max(1, Number(a.weight) || 1) }));
}

function matchesTerritory(
  rule: LeadAssignmentRule,
  lead: LeadForAssignment,
): boolean {
  const filter = rule.territoryFilter;
  if (!filter) return true;
  const stateOk = !filter.states || filter.states.length === 0 ||
    (lead.state ? filter.states.includes(lead.state.toUpperCase()) : false);
  const countyOk = !filter.counties || filter.counties.length === 0 ||
    (lead.county ? filter.counties.includes(lead.county) : false);
  return stateOk && countyOk;
}

function weightedRandomPick(assignees: WeightedAssignee[]): number {
  const totalWeight = assignees.reduce((sum, a) => sum + a.weight, 0);
  let r = Math.random() * totalWeight;
  for (const a of assignees) {
    r -= a.weight;
    if (r <= 0) return a.teamMemberId;
  }
  return assignees[assignees.length - 1]!.teamMemberId;
}

/**
 * Round-robin cursor advancement. Builds a flat list where each assignee
 * appears `weight` times, picks index = cursor mod len, advances the
 * cursor. The cursor row is created on first use.
 */
async function advanceRoundRobinCursor(
  ruleId: number,
  assignees: WeightedAssignee[],
): Promise<number | null> {
  // Flatten weights — assignee with weight 3 appears 3× consecutively.
  const flat: number[] = [];
  for (const a of assignees) {
    for (let i = 0; i < a.weight; i++) flat.push(a.teamMemberId);
  }
  if (flat.length === 0) return null;

  const [existing] = await db
    .select()
    .from(orgAssignmentCursor)
    .where(eq(orgAssignmentCursor.ruleId, ruleId));

  const currentIdx = existing?.cursorIndex ?? 0;
  const pickIdx = currentIdx % flat.length;
  const picked = flat[pickIdx]!;
  const nextIdx = (currentIdx + 1) % Number.MAX_SAFE_INTEGER;

  if (existing) {
    await db
      .update(orgAssignmentCursor)
      .set({
        cursorIndex: nextIdx,
        lastAssignedTo: picked,
        updatedAt: new Date(),
      })
      .where(eq(orgAssignmentCursor.ruleId, ruleId));
  } else {
    await db.insert(orgAssignmentCursor).values({
      ruleId,
      cursorIndex: nextIdx,
      lastAssignedTo: picked,
      updatedAt: new Date(),
    });
  }

  return picked;
}

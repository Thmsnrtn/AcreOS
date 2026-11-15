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
 * Round-robin turns are claimed by ONE statement (an upsert that increments
 * the cursor and returns it), so two concurrent /api/leads POSTs each get a
 * distinct turn — neither can read the same cursor value and both land on
 * the same rep.
 *
 * WHERE IT RUNS. Only POST /api/leads calls this (the Leads page's Add lead
 * form). Imports, Pax-created leads and the other intake paths do not, and
 * the settings copy says so — a rule that claimed every new lead would be a
 * claim about paths it never sees.
 */

import { db } from "../storage";
import {
  leadAssignmentRules,
  orgAssignmentCursor,
  teamMembers,
  type LeadAssignmentRule,
} from "@shared/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

export interface LeadForAssignment {
  state?: string | null;
  county?: string | null;
}

export interface AssignLeadOptions {
  /**
   * Answer "who WOULD get this lead" without taking a round-robin turn. The
   * settings page's "Test with a sample lead" uses it: a test must never
   * change who gets the next real lead.
   */
  dryRun?: boolean;
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
  options: AssignLeadOptions = {},
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
        const next = options.dryRun
          ? await peekRoundRobinCursor(rule.id, assignees)
          : await advanceRoundRobinCursor(rule.id, assignees);
        if (next != null) return next;
      }
    }

    return null;
  } catch (err) {
    // A dry run is a question an admin asked; answering "no rule matched"
    // because the lookup FAILED would be a false answer. Let it surface.
    if (options.dryRun) throw err;
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

/** "Harris " and "harris" name the same county; a rule must not miss on case. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function matchesTerritory(
  rule: LeadAssignmentRule,
  lead: LeadForAssignment,
): boolean {
  const filter = rule.territoryFilter;
  if (!filter) return true;
  const stateOk = !filter.states || filter.states.length === 0 ||
    (lead.state ? filter.states.some((s) => sameName(s, lead.state!)) : false);
  const countyOk = !filter.counties || filter.counties.length === 0 ||
    (lead.county ? filter.counties.some((c) => sameName(c, lead.county!)) : false);
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

/** Each assignee appears `weight` times, consecutively (weight 3 = 3 turns). */
function flattenTurns(assignees: WeightedAssignee[]): number[] {
  const flat: number[] = [];
  for (const a of assignees) {
    for (let i = 0; i < a.weight; i++) flat.push(a.teamMemberId);
  }
  return flat;
}

/**
 * Round-robin: take the next turn. The cursor holds how many turns have been
 * taken; turn N goes to flat[N mod len]. The cursor row is created on first
 * use. Claiming is ONE statement — insert-or-increment, returning the new
 * count — so concurrent claims serialize on the row and each gets its own
 * turn.
 */
async function advanceRoundRobinCursor(
  ruleId: number,
  assignees: WeightedAssignee[],
): Promise<number | null> {
  const flat = flattenTurns(assignees);
  if (flat.length === 0) return null;

  const [claimed] = await db
    .insert(orgAssignmentCursor)
    .values({ ruleId, cursorIndex: 1, updatedAt: clock.now() })
    .onConflictDoUpdate({
      target: orgAssignmentCursor.ruleId,
      set: { cursorIndex: sql`${orgAssignmentCursor.cursorIndex} + 1`, updatedAt: clock.now() },
    })
    .returning({ cursorIndex: orgAssignmentCursor.cursorIndex });

  const turn = Math.max(0, (claimed?.cursorIndex ?? 1) - 1);
  const picked = flat[turn % flat.length]!;

  // Informational only (nothing decides from it); a lost race here is harmless.
  await db
    .update(orgAssignmentCursor)
    .set({ lastAssignedTo: picked })
    .where(eq(orgAssignmentCursor.ruleId, ruleId));

  return picked;
}

/** Round-robin, read-only: who the next turn WOULD go to. Writes nothing. */
async function peekRoundRobinCursor(
  ruleId: number,
  assignees: WeightedAssignee[],
): Promise<number | null> {
  const flat = flattenTurns(assignees);
  if (flat.length === 0) return null;

  const [existing] = await db
    .select({ cursorIndex: orgAssignmentCursor.cursorIndex })
    .from(orgAssignmentCursor)
    .where(eq(orgAssignmentCursor.ruleId, ruleId));

  return flat[(existing?.cursorIndex ?? 0) % flat.length]!;
}

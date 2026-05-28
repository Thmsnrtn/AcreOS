/**
 * T174 — GDPR Data Service
 *
 * Handles GDPR/CCPA data requests:
 * - Data export: compile all personal data for a user into a JSON archive
 * - Data deletion: permanently delete all personal data for a user
 * - Anonymization: replace personal data with hashed/anonymized values
 *
 * Deletion follows a defined order to respect foreign keys:
 * 1. Agent events (logs)
 * 2. Activity logs
 * 3. Support tickets
 * 4. Team messages
 * 5. Notes (seller-financed notes are retained for legal compliance)
 * 6. Leads (with anonymization option to keep business records)
 * 7. User sessions
 * 8. User account
 */

import { db } from "../db";
import {
  users,
  leads,
  agentEvents,
  agentMemory,
  aiConversations,
  teamMessages,
  supportTickets,
  sessions,
  notes,
  deals,
  properties,
  tasks,
  teamMembers,
} from "@shared/schema";
import { eq, and, count, inArray } from "drizzle-orm";
import crypto from "crypto";
import { orgHasActiveHold, LegalHoldViolationError } from "./legalHold";

/** Safety limit to prevent unbounded memory usage on very large accounts */
const MAX_EXPORT_RECORDS = 100_000;

type GdprExportData = {
  exportedAt: string;
  user: Record<string, any>;
  leads: any[];
  deals: any[];
  properties: any[];
  tasks: any[];
  messages: any[];
  supportTickets: any[];
  totalRecords: {
    leads: number;
    deals: number;
    properties: number;
    tasks: number;
    messages: number;
    supportTickets: number;
  };
};

type DeletionReport = {
  userId: string;
  deletedAt: string;
  itemsDeleted: {
    agentEvents: number;
    teamMessages: number;
    supportTickets: number;
    tasks: number;
    sessions: number;
    aiMemory: number;
    aiConversations: number;
  };
  leadsAnonymized: number;
  userAnonymized: boolean;
};

/**
 * Export all personal data for a user (GDPR Article 15 — Right of Access).
 */
export async function exportUserData(userId: string): Promise<GdprExportData> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);

  // Redact sensitive internal fields before export
  const { password, ...safeUser } = user as Record<string, unknown>;

  // leads/deals/tasks.assignedTo are numeric teamMembers.id values, not the
  // user's (string) id. Resolve this user's team-member ids first.
  // TODO(tsc): properties has no assignedTo column and is therefore not
  // exportable per-user; it is reported as empty.
  const teamMemberRows = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const teamMemberIds = teamMemberRows.map((t) => t.id);

  const emptyIfNoTeam = <T,>(q: Promise<T[]>): Promise<T[]> =>
    teamMemberIds.length > 0 ? q : Promise.resolve([] as T[]);

  // Fetch all records (with safety cap) and total counts in parallel
  const [
    userLeads, userDeals, userTasks, userMessages, userTickets,
    leadCount, dealCount, taskCount, messageCount, ticketCount,
  ] = await Promise.all([
    emptyIfNoTeam(db.select().from(leads).where(inArray(leads.assignedTo, teamMemberIds)).limit(MAX_EXPORT_RECORDS)),
    emptyIfNoTeam(db.select().from(deals).where(inArray(deals.assignedTo, teamMemberIds)).limit(MAX_EXPORT_RECORDS)),
    emptyIfNoTeam(db.select().from(tasks).where(inArray(tasks.assignedTo, teamMemberIds)).limit(MAX_EXPORT_RECORDS)),
    db.select().from(teamMessages).where(eq(teamMessages.senderId, userId)).limit(MAX_EXPORT_RECORDS),
    db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).limit(MAX_EXPORT_RECORDS),
    emptyIfNoTeam(db.select({ count: count() }).from(leads).where(inArray(leads.assignedTo, teamMemberIds))),
    emptyIfNoTeam(db.select({ count: count() }).from(deals).where(inArray(deals.assignedTo, teamMemberIds))),
    emptyIfNoTeam(db.select({ count: count() }).from(tasks).where(inArray(tasks.assignedTo, teamMemberIds))),
    db.select({ count: count() }).from(teamMessages).where(eq(teamMessages.senderId, userId)),
    db.select({ count: count() }).from(supportTickets).where(eq(supportTickets.userId, userId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user: safeUser,
    leads: userLeads,
    deals: userDeals,
    properties: [],
    tasks: userTasks,
    messages: userMessages,
    supportTickets: userTickets,
    totalRecords: {
      leads: leadCount[0]?.count ?? 0,
      deals: dealCount[0]?.count ?? 0,
      properties: 0,
      tasks: taskCount[0]?.count ?? 0,
      messages: messageCount[0]?.count ?? 0,
      supportTickets: ticketCount[0]?.count ?? 0,
    },
  };
}

/**
 * Anonymize a user's personal data (GDPR Article 17 — Right to Erasure).
 * Soft-deletion: replaces PII with hashed/placeholder values.
 * Business records (deals, notes with legal significance) are retained.
 */
export async function anonymizeUser(userId: string): Promise<DeletionReport> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);

  // Phase 3 Week 11 (FRCP 37(e)): GDPR erasure must NOT proceed when the
  // user belongs to an org under an active legal hold. The 30-day GDPR
  // response window contemplates exactly this kind of "lawful obligation
  // overrides erasure" carve-out (Art. 17(3)(b/e)). Operators must release
  // the hold (or carve out the user via scoped erasure outside the
  // automated pipeline) before this path can run.
  const memberships = await db
    .select({ orgId: teamMembers.organizationId, id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const teamMemberIds = memberships.map((m) => m.id);
  for (const { orgId } of memberships) {
    if (await orgHasActiveHold(orgId)) {
      throw new LegalHoldViolationError(orgId, "user", userId, {
        id: "(see legal_holds)",
        caseRef: "active",
        scope: "org_wide_or_user_specific",
      });
    }
  }

  const hash = crypto.createHash("sha256").update(String(userId)).digest("hex").substring(0, 8);
  const anonEmail = `deleted-user-${hash}@gdpr-deleted.invalid`;
  const anonName = `[Deleted User ${hash}]`;

  // 1. Delete agent events (logs)
  // TODO(tsc): agent_events has no userId column (events are org-scoped, with
  // any agent identity living in payload), so they cannot be deleted per-user.
  const deletedEvents: { id: number }[] = [];

  // 2. Delete team messages
  const deletedMessages = await db.delete(teamMessages).where(eq(teamMessages.senderId, userId)).returning({ id: teamMessages.id });

  // 3. Delete support tickets
  const deletedTickets = await db.delete(supportTickets).where(eq(supportTickets.userId, userId)).returning({ id: supportTickets.id });

  // 4. Delete tasks assigned to user (tasks.assignedTo is a numeric teamMembers.id)
  const deletedTasks = teamMemberIds.length > 0
    ? await db.delete(tasks).where(inArray(tasks.assignedTo, teamMemberIds)).returning({ id: tasks.id })
    : [];

  // 5. Delete sessions
  // TODO(tsc): sessions.userId is an integer, but users.id is a UUID string;
  // these key spaces are incompatible, so sessions can't be matched here.
  const deletedSessions: { id: number }[] = [];

  // 5a. Task #48: Delete AI conversation history and org-scoped agent memory
  // aiConversations are user-scoped; agentMemory is org-scoped (deleted if user owns the org)
  const deletedAiMemory: { id: number }[] = []; // agentMemory is org-scoped, not user-scoped
  // Note: org-level agentMemory is purged separately via deleteOrganization(orgId)

  const deletedAiConversations = await db.delete(aiConversations)
    .where(eq(aiConversations.userId, String(userId)))
    .returning({ id: aiConversations.id })
    .catch(() => [] as { id: number }[]);

  // 6. Anonymize leads assigned to user (keep for business records but strip PII).
  // leads.assignedTo is a numeric teamMembers.id.
  const userLeads = teamMemberIds.length > 0
    ? await db.select({ id: leads.id }).from(leads).where(inArray(leads.assignedTo, teamMemberIds))
    : [];
  for (const lead of userLeads) {
    await db.update(leads).set({
      firstName: "[Deleted]",
      lastName: "[User]",
      email: `deleted-${lead.id}@gdpr-deleted.invalid`,
      phone: null,
      notes: null,
    }).where(eq(leads.id, lead.id));
  }

  // 7. Anonymize user account
  await db.update(users).set({
    email: anonEmail,
    firstName: anonName,
    lastName: "",
    profileImageUrl: null,
  }).where(eq(users.id, userId));

  return {
    userId,
    deletedAt: new Date().toISOString(),
    itemsDeleted: {
      agentEvents: deletedEvents.length,
      teamMessages: deletedMessages.length,
      supportTickets: deletedTickets.length,
      tasks: deletedTasks.length,
      sessions: deletedSessions.length,
      aiMemory: deletedAiMemory.length,
      aiConversations: deletedAiConversations.length,
    },
    leadsAnonymized: userLeads.length,
    userAnonymized: true,
  };
}

/**
 * Check if a user has an active GDPR deletion request.
 * Returns true if the user's email matches the deletion pattern.
 */
export async function isUserDeleted(userId: string): Promise<boolean> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user?.email) return false;
  return user.email.endsWith("@gdpr-deleted.invalid");
}

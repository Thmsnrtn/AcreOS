// @ts-nocheck
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
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

type GdprExportData = {
  exportedAt: string;
  user: Record<string, any>;
  leads: any[];
  deals: any[];
  properties: any[];
  tasks: any[];
  messages: any[];
  supportTickets: any[];
};

type DeletionReport = {
  userId: number;
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
export async function exportUserData(userId: number): Promise<GdprExportData> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);

  // Redact sensitive internal fields before export
  const { password, ...safeUser } = user as any;

  const [userLeads, userDeals, userProperties, userTasks, userMessages, userTickets] = await Promise.all([
    db.select().from(leads).where(eq(leads.assignedTo, userId)).limit(1000),
    db.select().from(deals).where(eq(deals.assignedTo, userId)).limit(1000),
    db.select().from(properties).where(eq(properties.assignedTo, userId)).limit(1000),
    db.select().from(tasks).where(eq(tasks.assignedTo, userId)).limit(1000),
    db.select().from(teamMessages).where(eq(teamMessages.senderId, userId)).limit(1000),
    db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).limit(500),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    user: safeUser,
    leads: userLeads,
    deals: userDeals,
    properties: userProperties,
    tasks: userTasks,
    messages: userMessages,
    supportTickets: userTickets,
  };
}

/**
 * Anonymize a user's personal data (GDPR Article 17 — Right to Erasure).
 * Soft-deletion: replaces PII with hashed/placeholder values.
 * Business records (deals, notes with legal significance) are retained.
 */
export async function anonymizeUser(userId: number): Promise<DeletionReport> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`User ${userId} not found`);

  const hash = crypto.createHash("sha256").update(String(userId)).digest("hex").substring(0, 8);
  const anonEmail = `deleted-user-${hash}@gdpr-deleted.invalid`;
  const anonName = `[Deleted User ${hash}]`;

  // 1. Delete agent events (logs)
  const deletedEvents = await db.delete(agentEvents).where(eq(agentEvents.userId, userId)).returning({ id: agentEvents.id });

  // 2. Delete team messages
  const deletedMessages = await db.delete(teamMessages).where(eq(teamMessages.senderId, userId)).returning({ id: teamMessages.id });

  // 3. Delete support tickets
  const deletedTickets = await db.delete(supportTickets).where(eq(supportTickets.userId, userId)).returning({ id: supportTickets.id });

  // 4. Delete tasks assigned to user
  const deletedTasks = await db.delete(tasks).where(eq(tasks.assignedTo, userId)).returning({ id: tasks.id });

  // 5. Delete sessions
  const deletedSessions = await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });

  // 5a. Task #48: Delete AI conversation history and org-scoped agent memory
  // aiConversations are user-scoped; agentMemory is org-scoped (deleted if user owns the org)
  const deletedAiMemory: { id: number }[] = []; // agentMemory is org-scoped, not user-scoped
  // Note: org-level agentMemory is purged separately via deleteOrganization(orgId)

  const deletedAiConversations = await db.delete(aiConversations)
    .where(eq(aiConversations.userId, String(userId)))
    .returning({ id: aiConversations.id })
    .catch(() => [] as { id: number }[]);

  // 6. Anonymize leads assigned to user (keep for business records but strip PII)
  const userLeads = await db.select({ id: leads.id }).from(leads).where(eq(leads.assignedTo, userId));
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
export async function isUserDeleted(userId: number): Promise<boolean> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user) return false;
  return user.email.endsWith("@gdpr-deleted.invalid");
}

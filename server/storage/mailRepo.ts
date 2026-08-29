// Mail + messaging data layer: email sender identities, the unified inbox,
// physical-mail sender identities, and mailing orders + pieces (direct-mail
// fulfillment). Extracted from the god-class server/storage.ts in the storage
// refactor. Methods are merged into DatabaseStorage.prototype at construction
// time; `this` refers to the full DatabaseStorage instance.

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { forOrg } from "../utils/orgScopedDb";
import {
  emailSenderIdentities,
  inboxMessages,
  mailSenderIdentities,
  mailingOrders,
  mailingOrderPieces,
  type EmailSenderIdentity,
  type InsertEmailSenderIdentity,
  type InboxMessage,
  type InsertInboxMessage,
  type MailSenderIdentity,
  type InsertMailSenderIdentity,
  type MailingOrder,
  type InsertMailingOrder,
  type MailingOrderPiece,
  type InsertMailingOrderPiece,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const mailRepo = {
  // ============================================
  // EMAIL SENDER IDENTITIES
  // ============================================

  async createEmailSenderIdentity(this: DatabaseStorage, identity: InsertEmailSenderIdentity): Promise<EmailSenderIdentity> {
    const [created] = await db.insert(emailSenderIdentities).values(identity).returning();
    return created;
  },

  async getEmailSenderIdentities(this: DatabaseStorage, orgId: number): Promise<EmailSenderIdentity[]> {
    return await db.select()
      .from(emailSenderIdentities)
      .where(eq(emailSenderIdentities.organizationId, orgId))
      .orderBy(desc(emailSenderIdentities.isDefault), desc(emailSenderIdentities.createdAt));
  },

  // Tier 1F: org-scoped by construction.
  async getEmailSenderIdentity(this: DatabaseStorage, organizationId: number, id: number): Promise<EmailSenderIdentity | undefined> {
    return await forOrg(organizationId).findById(emailSenderIdentities, id);
  },

  async getDefaultEmailSenderIdentity(this: DatabaseStorage, orgId: number): Promise<EmailSenderIdentity | undefined> {
    const [identity] = await db.select()
      .from(emailSenderIdentities)
      .where(and(
        eq(emailSenderIdentities.organizationId, orgId),
        eq(emailSenderIdentities.isDefault, true),
        eq(emailSenderIdentities.isActive, true)
      ));
    return identity;
  },

  // getEmailSenderIdentityByEmail deleted 2026-08-29 — zero callers, adversarially verified (rule-1 register close-out).

  async updateEmailSenderIdentity(this: DatabaseStorage, id: number, updates: Partial<InsertEmailSenderIdentity>, organizationId?: number): Promise<EmailSenderIdentity> {
    const conditions = [eq(emailSenderIdentities.id, id)];
    if (organizationId) conditions.push(eq(emailSenderIdentities.organizationId, organizationId));
    const [updated] = await db.update(emailSenderIdentities)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async setDefaultEmailSenderIdentity(this: DatabaseStorage, orgId: number, identityId: number): Promise<void> {
    await db.update(emailSenderIdentities)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(emailSenderIdentities.organizationId, orgId));
    
    // SCOPED. Without the org predicate this UPDATE flipped `isDefault` on ANY
    // identity by id — `POST /api/email-identities/:id/set-default` hands the URL
    // param straight in with no ownership check, so one authenticated user could
    // re-point which connected identity another org's counterparty mail leaves
    // under. The correct shape was already in this file: see
    // `deleteEmailSenderIdentity` below, which builds its conditions with the org.
    await db.update(emailSenderIdentities)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(
        eq(emailSenderIdentities.id, identityId),
        eq(emailSenderIdentities.organizationId, orgId),
      ));
  },

  async deleteEmailSenderIdentity(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(emailSenderIdentities.id, id)];
    if (organizationId) conditions.push(eq(emailSenderIdentities.organizationId, organizationId));
    await db.delete(emailSenderIdentities).where(and(...conditions));
  },

  // ============================================
  // INBOX MESSAGES
  // ============================================

  async createInboxMessage(this: DatabaseStorage, message: InsertInboxMessage): Promise<InboxMessage> {
    const [created] = await db.insert(inboxMessages).values(message).returning();
    return created;
  },

  async getInboxMessages(this: DatabaseStorage, orgId: number, options?: { 
    isRead?: boolean; 
    isArchived?: boolean;
    leadId?: number;
    limit?: number;
    offset?: number;
  }): Promise<InboxMessage[]> {
    const conditions = [eq(inboxMessages.organizationId, orgId)];
    
    if (options?.isRead !== undefined) {
      conditions.push(eq(inboxMessages.isRead, options.isRead));
    }
    if (options?.isArchived !== undefined) {
      conditions.push(eq(inboxMessages.isArchived, options.isArchived));
    }
    if (options?.leadId !== undefined) {
      conditions.push(eq(inboxMessages.leadId, options.leadId));
    }

    let query = db.select()
      .from(inboxMessages)
      .where(and(...conditions))
      .orderBy(desc(inboxMessages.receivedAt));
    
    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    return await query;
  },

  // Tier 1F: org-scoped by construction.
  async getInboxMessage(this: DatabaseStorage, organizationId: number, id: number): Promise<InboxMessage | undefined> {
    return await forOrg(organizationId).findById(inboxMessages, id);
  },

  async getUnreadInboxCount(this: DatabaseStorage, orgId: number): Promise<number> {
    const result = await db.select({ count: count() })
      .from(inboxMessages)
      .where(and(
        eq(inboxMessages.organizationId, orgId),
        eq(inboxMessages.isRead, false),
        eq(inboxMessages.isArchived, false)
      ));
    return result[0]?.count || 0;
  },

  async markInboxMessageRead(this: DatabaseStorage, id: number, userId: string, organizationId?: number): Promise<InboxMessage> {
    const conditions = [eq(inboxMessages.id, id)];
    if (organizationId) conditions.push(eq(inboxMessages.organizationId, organizationId));
    const [updated] = await db.update(inboxMessages)
      .set({ isRead: true, readAt: new Date(), readBy: userId })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async markInboxMessageUnread(this: DatabaseStorage, id: number, organizationId?: number): Promise<InboxMessage> {
    const conditions = [eq(inboxMessages.id, id)];
    if (organizationId) conditions.push(eq(inboxMessages.organizationId, organizationId));
    const [updated] = await db.update(inboxMessages)
      .set({ isRead: false, readAt: null, readBy: null })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async archiveInboxMessage(this: DatabaseStorage, id: number, organizationId?: number): Promise<InboxMessage> {
    const conditions = [eq(inboxMessages.id, id)];
    if (organizationId) conditions.push(eq(inboxMessages.organizationId, organizationId));
    const [updated] = await db.update(inboxMessages)
      .set({ isArchived: true })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async starInboxMessage(this: DatabaseStorage, id: number, starred: boolean, organizationId?: number): Promise<InboxMessage> {
    const conditions = [eq(inboxMessages.id, id)];
    if (organizationId) conditions.push(eq(inboxMessages.organizationId, organizationId));
    const [updated] = await db.update(inboxMessages)
      .set({ isStarred: starred })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async updateInboxMessage(this: DatabaseStorage, id: number, updates: Partial<InsertInboxMessage>, organizationId?: number): Promise<InboxMessage> {
    const conditions = [eq(inboxMessages.id, id)];
    if (organizationId) conditions.push(eq(inboxMessages.organizationId, organizationId));
    const [updated] = await db.update(inboxMessages)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // Mail Sender Identities
  async getMailSenderIdentities(this: DatabaseStorage, orgId: number): Promise<MailSenderIdentity[]> {
    return await db.select()
      .from(mailSenderIdentities)
      .where(eq(mailSenderIdentities.organizationId, orgId))
      .orderBy(desc(mailSenderIdentities.createdAt));
  },

  // Tier 1F: org-scoped by construction.
  async getMailSenderIdentity(this: DatabaseStorage, organizationId: number, id: number): Promise<MailSenderIdentity | undefined> {
    return await forOrg(organizationId).findById(mailSenderIdentities, id);
  },

  async getDefaultMailSenderIdentity(this: DatabaseStorage, orgId: number): Promise<MailSenderIdentity | undefined> {
    const [identity] = await db.select()
      .from(mailSenderIdentities)
      .where(and(
        eq(mailSenderIdentities.organizationId, orgId),
        eq(mailSenderIdentities.isDefault, true)
      ));
    return identity;
  },

  async createMailSenderIdentity(this: DatabaseStorage, data: InsertMailSenderIdentity): Promise<MailSenderIdentity> {
    const [identity] = await db.insert(mailSenderIdentities)
      .values(data)
      .returning();
    return identity;
  },

  async updateMailSenderIdentity(this: DatabaseStorage, id: number, data: Partial<MailSenderIdentity>, organizationId?: number): Promise<MailSenderIdentity> {
    const conditions = [eq(mailSenderIdentities.id, id)];
    if (organizationId) conditions.push(eq(mailSenderIdentities.organizationId, organizationId));
    const [updated] = await db.update(mailSenderIdentities)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async setDefaultMailSenderIdentity(this: DatabaseStorage, orgId: number, id: number): Promise<void> {
    await db.update(mailSenderIdentities)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(mailSenderIdentities.organizationId, orgId));
    
    // SCOPED — same defect as the email twin above, on the physical rail: this
    // set the return address and sender identity printed on another org's
    // outgoing mail.
    await db.update(mailSenderIdentities)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(
        eq(mailSenderIdentities.id, id),
        eq(mailSenderIdentities.organizationId, orgId),
      ));
  },

  async deleteMailSenderIdentity(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(mailSenderIdentities.id, id)];
    if (organizationId) conditions.push(eq(mailSenderIdentities.organizationId, organizationId));
    await db.delete(mailSenderIdentities)
      .where(and(...conditions));
  },

  // Mailing Orders
  async getMailingOrders(this: DatabaseStorage, orgId: number, filters?: { campaignId?: number; status?: string }): Promise<MailingOrder[]> {
    const conditions = [eq(mailingOrders.organizationId, orgId)];
    
    if (filters?.campaignId !== undefined) {
      conditions.push(eq(mailingOrders.campaignId, filters.campaignId));
    }
    if (filters?.status !== undefined) {
      conditions.push(eq(mailingOrders.status, filters.status));
    }
    
    return await db.select()
      .from(mailingOrders)
      .where(and(...conditions))
      .orderBy(desc(mailingOrders.createdAt));
  },

  // Tier 1F: org-scoped by construction.
  async getMailingOrder(this: DatabaseStorage, organizationId: number, id: number): Promise<MailingOrder | undefined> {
    return await forOrg(organizationId).findById(mailingOrders, id);
  },

  async createMailingOrder(this: DatabaseStorage, data: InsertMailingOrder): Promise<MailingOrder> {
    const [order] = await db.insert(mailingOrders)
      .values(data)
      .returning();
    return order;
  },

  async updateMailingOrder(this: DatabaseStorage, id: number, data: Partial<MailingOrder>, organizationId?: number): Promise<MailingOrder> {
    const conditions = [eq(mailingOrders.id, id)];
    if (organizationId) conditions.push(eq(mailingOrders.organizationId, organizationId));
    const [updated] = await db.update(mailingOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async incrementMailingOrderPieces(this: DatabaseStorage, id: number, type: 'sent' | 'failed'): Promise<void> {
    if (type === 'sent') {
      await db.update(mailingOrders)
        .set({ 
          sentPieces: sql`${mailingOrders.sentPieces} + 1`,
          updatedAt: new Date()
        })
        .where(eq(mailingOrders.id, id));
    } else {
      await db.update(mailingOrders)
        .set({ 
          failedPieces: sql`${mailingOrders.failedPieces} + 1`,
          updatedAt: new Date()
        })
        .where(eq(mailingOrders.id, id));
    }
  },

  // Mailing Order Pieces
  async getMailingOrderPieces(this: DatabaseStorage, orderId: number): Promise<MailingOrderPiece[]> {
    return await db.select()
      .from(mailingOrderPieces)
      .where(eq(mailingOrderPieces.mailingOrderId, orderId))
      .orderBy(desc(mailingOrderPieces.createdAt));
  },

  async createMailingOrderPiece(this: DatabaseStorage, data: InsertMailingOrderPiece): Promise<MailingOrderPiece> {
    const [piece] = await db.insert(mailingOrderPieces)
      .values(data)
      .returning();
    return piece;
  },

  async updateMailingOrderPiece(this: DatabaseStorage, id: number, data: Partial<MailingOrderPiece>): Promise<MailingOrderPiece> {
    const [updated] = await db.update(mailingOrderPieces)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mailingOrderPieces.id, id))
      .returning();
    return updated;
  },
};

export type MailRepo = typeof mailRepo;

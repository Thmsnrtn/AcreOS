import crypto from "crypto";
import { db } from "../storage";
import { leadEmails, leads, leadActivities } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { activityLogger } from "./activityLogger";

const HMAC_SECRET = process.env.INBOUND_EMAIL_HMAC_SECRET
  || process.env.SESSION_SECRET
  || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('Missing required secret: INBOUND_EMAIL_HMAC_SECRET (or SESSION_SECRET)'); })()
    : 'dev-fallback-not-for-production');

/**
 * Generate a reply-to address for a specific lead.
 * Format: inbox+{leadId}-{hash}@replies.acreos.io
 */
export function generateReplyToAddress(leadId: number, orgId: number): string {
  const hash = generateHash(leadId, orgId);
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "replies.acreos.io";
  return `inbox+${leadId}-${hash}@${domain}`;
}

/**
 * Generate a short HMAC hash for lead address verification.
 */
function generateHash(leadId: number, orgId: number): string {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${leadId}:${orgId}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Parse a reply-to address to extract leadId and hash.
 * Supports: inbox+{leadId}-{hash}@domain and lead-{leadId}-{hash}@domain
 */
export function parseReplyToAddress(toAddress: string): { leadId: number; hash: string } | null {
  // Match inbox+{leadId}-{hash}@domain or lead-{leadId}-{hash}@domain
  const match = toAddress.match(/(?:inbox\+|lead-)(\d+)-([a-f0-9]+)@/i);
  if (!match) return null;
  return { leadId: parseInt(match[1], 10), hash: match[2] };
}

/**
 * Verify the hash matches a given leadId + orgId.
 */
export function verifyReplyHash(leadId: number, orgId: number, hash: string): boolean {
  const expected = generateHash(leadId, orgId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash));
}

export interface InboundEmailPayload {
  from: string;
  to: string | string[];
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  messageId?: string;
  inReplyTo?: string;
}

/**
 * Process an inbound email received via webhook (SES → SNS → HTTPS).
 * Extracts the lead from the to-address, verifies the hash, stores the email,
 * and updates the lead status.
 */
export async function processInboundEmail(payload: InboundEmailPayload): Promise<{
  success: boolean;
  leadId?: number;
  error?: string;
}> {
  const toAddresses = Array.isArray(payload.to) ? payload.to : [payload.to];

  for (const toAddr of toAddresses) {
    const parsed = parseReplyToAddress(toAddr);
    if (!parsed) continue;

    const { leadId, hash } = parsed;

    // Look up the lead to get orgId for hash verification
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) {
      logger.warn("Inbound email for unknown lead", { leadId });
      return { success: false, error: "Lead not found" };
    }

    if (!verifyReplyHash(leadId, lead.organizationId, hash)) {
      logger.warn("Inbound email hash verification failed", { leadId });
      return { success: false, error: "Invalid hash" };
    }

    // Store the email
    const [stored] = await db.insert(leadEmails).values({
      organizationId: lead.organizationId,
      leadId,
      direction: "inbound",
      fromEmail: payload.from,
      toEmail: toAddr,
      subject: payload.subject || null,
      bodyText: payload.textBody || null,
      bodyHtml: payload.htmlBody || null,
      messageId: payload.messageId || null,
      inReplyTo: payload.inReplyTo || null,
    }).returning();

    // Mark lead as responded
    await db.update(leads).set({
      status: "responded",
      updatedAt: new Date(),
    }).where(
      and(eq(leads.id, leadId), eq(leads.organizationId, lead.organizationId))
    );

    // TTFM companion metric — the org's first seller response. Idempotent
    // FIRST-occurrence on (org, eventName); fire-and-forget.
    try {
      const { recordActivationEventAsync } = await import("./activation");
      recordActivationEventAsync({
        orgId: lead.organizationId,
        userId: null,
        eventName: "first_seller_response",
        eventValue: { channel: "email", leadId },
      });
    } catch { /* non-fatal */ }

    // Log activity
    await activityLogger.logEmailSent(
      lead.organizationId,
      "lead",
      leadId,
      payload.from,
      payload.subject || "(no subject)",
    );

    // Log to lead activities
    await db.insert(leadActivities).values({
      leadId,
      organizationId: lead.organizationId,
      type: "email_received",
      description: `Inbound email from ${payload.from}: ${payload.subject || "(no subject)"}`,
      metadata: { emailId: stored.id, from: payload.from, subject: payload.subject },
    });

    logger.info("Inbound email processed", { leadId, emailId: stored.id });
    return { success: true, leadId };
  }

  return { success: false, error: "No valid recipient address found" };
}

/**
 * Store an outbound email record for thread continuity.
 */
export async function storeOutboundEmail(params: {
  organizationId: number;
  leadId: number;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  messageId?: string;
}): Promise<void> {
  await db.insert(leadEmails).values({
    ...params,
    direction: "outbound",
  });
}

/**
 * Get the email thread for a lead, ordered chronologically.
 */
export async function getLeadEmailThread(leadId: number, organizationId: number) {
  return db.select()
    .from(leadEmails)
    .where(and(
      eq(leadEmails.leadId, leadId),
      eq(leadEmails.organizationId, organizationId),
    ))
    .orderBy(leadEmails.receivedAt);
}

/**
 * Mark emails as read.
 */
export async function markEmailsRead(emailIds: number[], organizationId: number): Promise<void> {
  for (const id of emailIds) {
    await db.update(leadEmails).set({ readAt: new Date() }).where(
      and(eq(leadEmails.id, id), eq(leadEmails.organizationId, organizationId))
    );
  }
}

/**
 * Count unread inbound emails for an organization.
 */
export async function getUnreadEmailCount(organizationId: number): Promise<number> {
  const results = await db.select()
    .from(leadEmails)
    .where(and(
      eq(leadEmails.organizationId, organizationId),
      eq(leadEmails.direction, "inbound"),
    ));
  return results.filter(e => !e.readAt).length;
}

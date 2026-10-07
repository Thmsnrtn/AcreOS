/**
 * Read-only account answers for Pax — credits, campaigns and mail, the inbox,
 * team activity, plan limits, sending identity.
 *
 * An oracle pass over 40 real customer questions found most of Pax's
 * "partial" answers were TOOL GAPS, not model error: Pax had 57 tools and none
 * could read the credit balance, a campaign, a reply, what a teammate did, the
 * plan's caps, or whether the org can send email or texts at all. These are
 * those reads.
 *
 * Every function here:
 *   - takes the organization id as its FIRST argument and pins every query to
 *     it (`eq(<table>.organizationId, organizationId)`), or delegates to a
 *     storage/service read that does. Each is its own unit, so the tenancy
 *     lint (`scripts/check-org-scoped-fetch.mjs`, which walks all of
 *     server/**) reads each one separately rather than as part of the 3,000-
 *     line `executeTool` switch, where one org mention anywhere satisfies it;
 *   - reads, and only reads;
 *   - returns counts the caller can quote, never an estimate. Where a number
 *     cannot be read it says so instead of returning 0.
 */
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  activityLog,
  campaigns,
  conversations,
  inboxMessages,
  leads,
  mailShipments,
  mailingOrders,
  messages,
  teamMembers,
} from "@shared/schema";
import { creditsToDollars, type SendRails } from "./sendPricing";
import { creditService } from "./credits";
import { getAllUsageLimits, getSeatInfo } from "./usageLimits";
import { getPaxProductFacts } from "./paxProductFacts";
import { counterpartyEmailIdentityStatus } from "./emailService";
import { orgHasConnectedSmsIdentity } from "./smsService";
import { directMailService } from "./directMail";
import { storage } from "../storage";
import { byokTierAllows } from "@shared/billing/byok-tiers";
import { tierForSubscriptionTier } from "@shared/billing/tier-pricing";

const DAY_MS = 24 * 60 * 60 * 1000;

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = d instanceof Date ? d : new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// ── Credits ──────────────────────────────────────────────────────────────────

export async function readCreditsForPax(organizationId: number, opts: { limit?: unknown } = {}) {
  const limit = clampInt(opts.limit, 1, 25, 10);
  const [isFounder, balance, history] = await Promise.all([
    creditService.isFounder(organizationId),
    creditService.getBalance(organizationId),
    creditService.getTransactionHistory(organizationId, limit),
  ]);
  if (isFounder) {
    return {
      metered: false,
      note: "This organization is not metered (founder account), so there is no credit balance to report.",
      recent: [],
    };
  }
  return {
    metered: true,
    balanceCredits: balance,
    balanceDollars: creditsToDollars(balance),
    creditUnit: "1 credit = $0.01",
    where: "Settings → Account shows your available credit; Settings → Billing buys more.",
    recent: history.map((t) => ({
      type: t.type,
      credits: t.amountCents,
      dollars: creditsToDollars(t.amountCents),
      balanceAfterCredits: t.balanceAfterCents,
      description: t.description,
      at: iso(t.createdAt),
    })),
  };
}

// ── Campaigns and mail ───────────────────────────────────────────────────────

export async function readCampaignsForPax(
  organizationId: number,
  opts: { status?: unknown; limit?: unknown } = {},
) {
  const limit = clampInt(opts.limit, 1, 50, 20);
  const status = typeof opts.status === "string" && opts.status.trim() ? opts.status.trim() : null;
  const since = new Date(Date.now() - 120 * DAY_MS);

  // ONE QUERY PER STATEMENT, on purpose. The tenancy lint slices a query chain
  // from `.from(table)` to its terminating `;`. Three chains inside one
  // `Promise.all([...]);` share a single terminator, so each chain's text would
  // include its siblings' org predicates and an unscoped one would pass.
  // Measured by mutation 2026-10-07: dropping the inbox org predicate inside a
  // Promise.all array stayed green under the lint; as separate statements it
  // goes red.
  const rowsQ = db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      type: campaigns.type,
      status: campaigns.status,
      totalSent: campaigns.totalSent,
      totalDelivered: campaigns.totalDelivered,
      totalResponded: campaigns.totalResponded,
      scheduledDate: campaigns.scheduledDate,
      completedDate: campaigns.completedDate,
      createdAt: campaigns.createdAt,
    })
    .from(campaigns)
    .where(
      status
        ? and(eq(campaigns.organizationId, organizationId), eq(campaigns.status, status))
        : eq(campaigns.organizationId, organizationId),
    )
    .orderBy(desc(campaigns.createdAt))
    .limit(limit);
  // Campaign direct mail (Outreach → campaign → Send direct mail).
  const ordersQ = db
    .select({ sentPieces: mailingOrders.sentPieces, createdAt: mailingOrders.createdAt })
    .from(mailingOrders)
    .where(and(eq(mailingOrders.organizationId, organizationId), gte(mailingOrders.createdAt, since)));
  // Outreach mail composer (the router-priced path). A shipment counts once sent.
  const shipmentsQ = db
    .select({ pieceCount: mailShipments.pieceCount, sentAt: mailShipments.sentAt, pieceType: mailShipments.pieceType })
    .from(mailShipments)
    .where(
      and(
        eq(mailShipments.organizationId, organizationId),
        isNotNull(mailShipments.sentAt),
        gte(mailShipments.sentAt, since),
      ),
    );
  const [rows, orders, shipments] = await Promise.all([rowsQ, ordersQ, shipmentsQ]);

  const byMonth = new Map<string, { campaignMail: number; outreachMail: number }>();
  const bump = (d: Date | null, key: "campaignMail" | "outreachMail", n: number) => {
    if (!d || !n) return;
    const k = monthKey(d);
    const cur = byMonth.get(k) ?? { campaignMail: 0, outreachMail: 0 };
    cur[key] += n;
    byMonth.set(k, cur);
  };
  for (const o of orders) bump(o.createdAt ? new Date(o.createdAt) : null, "campaignMail", Number(o.sentPieces) || 0);
  for (const s of shipments) bump(s.sentAt ? new Date(s.sentAt) : null, "outreachMail", Number(s.pieceCount) || 0);

  return {
    totalReturned: rows.length,
    filter: status ? { status } : null,
    campaigns: rows.map((c) => ({
      id: c.id,
      name: c.name,
      channel: c.type,
      status: c.status,
      sent: c.totalSent ?? 0,
      delivered: c.totalDelivered ?? 0,
      responded: c.totalResponded ?? 0,
      scheduledFor: iso(c.scheduledDate),
      completedAt: iso(c.completedDate),
      createdAt: iso(c.createdAt),
    })),
    mailPiecesSentByMonth: Array.from(byMonth.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([month, v]) => ({ month, ...v, total: v.campaignMail + v.outreachMail })),
    mailWindow: `months with mail sent in the last 120 days (a month that is absent sent 0 pieces from AcreOS)`,
  };
}

// ── Inbox: replies ───────────────────────────────────────────────────────────

export async function readInboxRepliesForPax(
  organizationId: number,
  opts: { days?: unknown; limit?: unknown } = {},
) {
  const days = clampInt(opts.days, 1, 90, 7);
  const limit = clampInt(opts.limit, 1, 50, 20);
  const since = new Date(Date.now() - days * DAY_MS);

  // One query per statement — see readCampaignsForPax.
  const emailsQ = db
    .select({
      id: inboxMessages.id,
      senderName: inboxMessages.senderName,
      senderEmail: inboxMessages.senderEmail,
      subject: inboxMessages.subject,
      bodyText: inboxMessages.bodyText,
      leadId: inboxMessages.leadId,
      isRead: inboxMessages.isRead,
      receivedAt: inboxMessages.receivedAt,
    })
    .from(inboxMessages)
    .where(and(eq(inboxMessages.organizationId, organizationId), gte(inboxMessages.receivedAt, since)))
    .orderBy(desc(inboxMessages.receivedAt))
    .limit(limit);
  const textsQ = db
    .select({
      id: messages.id,
      content: messages.content,
      createdAt: messages.createdAt,
      channel: conversations.channel,
      leadId: conversations.leadId,
      firstName: leads.firstName,
      lastName: leads.lastName,
    })
    .from(messages)
    .innerJoin(
      conversations,
      and(eq(conversations.id, messages.conversationId), eq(conversations.organizationId, organizationId)),
    )
    .leftJoin(leads, and(eq(leads.id, conversations.leadId), eq(leads.organizationId, organizationId)))
    .where(
      and(
        eq(messages.organizationId, organizationId),
        eq(messages.direction, "inbound"),
        gte(messages.createdAt, since),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  const [emails, texts] = await Promise.all([emailsQ, textsQ]);

  return {
    windowDays: days,
    since: since.toISOString(),
    emailReplyCount: emails.length,
    textReplyCount: texts.length,
    countsCappedAt: limit,
    emailReplies: emails.map((m) => ({
      id: m.id,
      from: [m.senderName, m.senderEmail].filter(Boolean).join(" "),
      subject: m.subject ?? "",
      text: (m.bodyText ?? "").slice(0, 400),
      leadId: m.leadId,
      isRead: Boolean(m.isRead),
      receivedAt: iso(m.receivedAt),
    })),
    textReplies: texts.map((m) => ({
      id: m.id,
      channel: m.channel,
      leadId: m.leadId,
      leadName: [m.firstName, m.lastName].filter(Boolean).join(" ") || null,
      text: (m.content ?? "").slice(0, 400),
      receivedAt: iso(m.createdAt),
    })),
    where: "Inbox in the top bar",
  };
}

// ── Team activity ────────────────────────────────────────────────────────────

export async function readTeamActivityForPax(
  organizationId: number,
  opts: { days?: unknown; role?: unknown; limit?: unknown; ownerUserId?: string | null } = {},
) {
  const days = clampInt(opts.days, 1, 30, 1);
  const limit = clampInt(opts.limit, 1, 100, 50);
  const role = typeof opts.role === "string" && opts.role.trim() ? opts.role.trim().toLowerCase() : null;
  const since = new Date(Date.now() - days * DAY_MS);

  const members = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      displayName: teamMembers.displayName,
      email: teamMembers.email,
      role: teamMembers.role,
      isActive: teamMembers.isActive,
      viewOnlyAssignedLeads: teamMembers.viewOnlyAssignedLeads,
      joinedAt: teamMembers.joinedAt,
      invitedAt: teamMembers.invitedAt,
    })
    .from(teamMembers)
    .where(eq(teamMembers.organizationId, organizationId));

  const chosen = role ? members.filter((m) => (m.role ?? "").toLowerCase() === role) : members;
  const userIds = chosen.map((m) => m.userId).filter(Boolean);
  const memberIds = chosen.map((m) => m.id);

  const personFilter =
    userIds.length > 0 || memberIds.length > 0
      ? or(
          userIds.length > 0 ? inArray(activityLog.userId, userIds) : undefined,
          memberIds.length > 0 ? inArray(activityLog.teamMemberId, memberIds) : undefined,
        )
      : undefined;

  const rows =
    role && !personFilter
      ? []
      : await db
          .select({
            userId: activityLog.userId,
            teamMemberId: activityLog.teamMemberId,
            agentType: activityLog.agentType,
            action: activityLog.action,
            entityType: activityLog.entityType,
            entityId: activityLog.entityId,
            description: activityLog.description,
            createdAt: activityLog.createdAt,
          })
          .from(activityLog)
          .where(
            and(
              eq(activityLog.organizationId, organizationId),
              gte(activityLog.createdAt, since),
              personFilter ?? sql`true`,
            ),
          )
          .orderBy(desc(activityLog.createdAt))
          .limit(limit);

  const byUser = new Map(members.map((m) => [m.userId, m]));
  const byMember = new Map(members.map((m) => [m.id, m]));
  const who = (r: (typeof rows)[number]) => {
    const m = (r.teamMemberId != null ? byMember.get(r.teamMemberId) : undefined) ?? (r.userId ? byUser.get(r.userId) : undefined);
    if (m) return { name: m.displayName || m.email || `member #${m.id}`, role: m.role };
    if (r.userId && opts.ownerUserId && r.userId === opts.ownerUserId) return { name: "the account owner", role: "owner" };
    if (r.userId) return { name: "a signed-in user", role: null };
    return { name: r.agentType ? `automation (${r.agentType})` : "automation (no person)", role: null };
  };

  return {
    windowDays: days,
    since: since.toISOString(),
    roleFilter: role,
    members: members.map((m) => ({
      name: m.displayName || m.email || `member #${m.id}`,
      role: m.role,
      active: m.isActive,
      seesOnlyAssignedLeads: m.viewOnlyAssignedLeads,
      joinedAt: iso(m.joinedAt),
      invitedAt: iso(m.invitedAt),
    })),
    membersMatchingRole: role ? chosen.length : null,
    activityCount: rows.length,
    countsCappedAt: limit,
    activity: rows.map((r) => {
      const w = who(r);
      return {
        who: w.name,
        role: w.role,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        description: r.description ?? "",
        at: iso(r.createdAt),
      };
    }),
    where: "Activity (/activity)",
  };
}

// ── Plan limits ──────────────────────────────────────────────────────────────

export async function readPlanLimitsForPax(organizationId: number) {
  const [limits, seats, facts] = await Promise.all([
    getAllUsageLimits(organizationId),
    getSeatInfo(organizationId),
    getPaxProductFacts("imports"),
  ]);
  const exportsFacts = await getPaxProductFacts("exports");
  return {
    plan: limits.tier,
    unmetered: Boolean(limits.isFounder),
    usage: Object.fromEntries(
      Object.entries(limits.usage).map(([k, v]) => [k, { used: v.current, limit: v.limit, percentUsed: v.percentage }]),
    ),
    aiTurnsThisMonth: { used: limits.aiTurns.current, byokThreshold: limits.aiTurns.threshold },
    seats: {
      used: seats.usedSeats,
      total: seats.totalSeats,
      included: seats.includedSeats,
      available: seats.availableSeats,
      max: seats.maxSeats,
      canAddSeats: seats.canAddSeats,
      pricePerExtraSeatDollars: seats.seatPriceCents != null ? creditsToDollars(seats.seatPriceCents) : null,
    },
    imports: facts.imports,
    exports: exportsFacts.exports,
    nullLimitMeans: "no cap on this plan",
  };
}

// ── Sending identity ─────────────────────────────────────────────────────────

/**
 * The org's send rails, read through the SAME resolvers the send paths ask:
 * the campaign email handler's counterpartyEmailIdentityStatus, the SMS
 * handler's orgHasConnectedSmsIdentity, the direct-mail handler's
 * hasOrgLobCredentials. Feeds quote_outbound_cost and the identity status.
 */
export async function readSendRails(organizationId: number): Promise<SendRails> {
  const [email, sms, lob] = await Promise.all([
    counterpartyEmailIdentityStatus(organizationId).catch(() => ({ canSend: false, ownSesCredentials: false, verifiedDomain: false })),
    orgHasConnectedSmsIdentity(organizationId).catch(() => false),
    directMailService.hasOrgLobCredentials(organizationId).catch(() => false),
  ]);
  return {
    ownMailAccount: Boolean(lob),
    ownEmailAccount: email.ownSesCredentials,
    emailCanSend: email.canSend,
    smsConnected: Boolean(sms),
  };
}

export async function readSendingIdentityForPax(organizationId: number, subscriptionTier: string | null) {
  const [rails, returnAddress] = await Promise.all([
    readSendRails(organizationId),
    storage.getDefaultMailSenderIdentity(organizationId).catch(() => undefined),
  ]);
  const tier = tierForSubscriptionTier(subscriptionTier);
  return {
    email: {
      canSendCampaignEmail: rails.emailCanSend,
      viaOwnEmailAccount: rails.ownEmailAccount,
      status: rails.emailCanSend
        ? "ready — campaign email goes out under your own identity"
        : "not connected — campaign email cannot send until a sending domain is verified or your own email account is connected",
    },
    sms: {
      ownTwilioConnected: rails.smsConnected,
      planAllowsConnectingTwilio: byokTierAllows(tier, "twilio"),
      status: rails.smsConnected
        ? "ready — texts go out on your own Twilio number"
        : "not connected — texts cannot send until your own Twilio number is connected (Settings → Bring your own keys)",
    },
    mail: {
      returnAddressSet: Boolean(returnAddress),
      returnAddressVerified: returnAddress ? returnAddress.status === "verified" : false,
      viaOwnMailAccount: rails.ownMailAccount,
    },
  };
}

// ── Who may be contacted (refusal copy's safe alternative) ───────────────────

/**
 * Leads the org may contact on `channel`, counted the way the send gate
 * decides it (tcpaCompliance.checkTcpaConsentFromLead: not do-not-contact,
 * and consent on file for BOTH email and SMS), plus an address to send to.
 * Used to word the screener's refusal ("I can text only the N leads who did").
 */
export async function countContactableLeadsForPax(
  organizationId: number,
  channel: "text" | "email",
): Promise<number> {
  const reachable = and(
    eq(leads.tcpaConsent, true),
    channel === "text" ? isNotNull(leads.phone) : isNotNull(leads.email),
  );
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        sql`coalesce(${leads.doNotContact}, false) = false`,
        sql`${leads.deletedAt} is null`,
        reachable,
      ),
    );
  return Number(row?.n ?? 0);
}

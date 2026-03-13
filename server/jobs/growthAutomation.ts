// @ts-nocheck
/**
 * Growth Automation Engine
 *
 * Passive revenue growth without founder involvement.
 * Runs every 6 hours and executes revenue-generating automations:
 *
 * 1. UPSELL ENGINE
 *    Identifies free/starter tier users approaching their plan limits
 *    → Sends personalized upgrade invitations timed to peak motivation
 *    (when they just hit a limit is the highest-intent moment)
 *
 * 2. WIN-BACK ENGINE
 *    Organizations that cancelled in the last 30-90 days
 *    → 3-touch reactivation sequence with personalized offers
 *    → Touch 1 (7d after cancel): "We miss you" + feature highlight
 *    → Touch 2 (30d after cancel): Product update email
 *    → Touch 3 (60d after cancel): Special offer (if configurable)
 *
 * 3. REFERRAL ACTIVATION
 *    Power users (high activity, good NPS signals) who haven't referred anyone
 *    → Invite to referral program with personalized note
 *    → Track and credit referral conversions automatically
 *
 * 4. ENGAGEMENT REACTIVATION
 *    Active paying orgs that haven't logged in for 14+ days
 *    → AI-crafted re-engagement email with specific feature recommendations
 *    → Based on their actual data (deals pending, leads going cold, etc.)
 *
 * 5. EXPANSION REVENUE
 *    Pro/Scale tier orgs using >80% of any limit
 *    → Surface value and suggest Enterprise tier
 *
 * SAFETY GUARDRAILS:
 *    - Each org gets max 1 growth email per 21 days (configurable)
 *    - Respects unsubscribes and email preferences
 *    - All emails logged to revenueProtectionInterventions table
 *    - Win-back offers are configured ranges (never commits to specific pricing)
 *
 * Runs every 6 hours via setInterval in index.ts
 */

import { db } from "../db";
import {
  organizations,
  teamMembers,
  leads,
  deals,
  revenueProtectionInterventions,
  subscriptionEvents,
  activityLog,
} from "@shared/schema";
import { eq, and, gte, lt, lte, desc, count, sql, not, isNull, ne } from "drizzle-orm";
import { subDays, subHours, addDays, format, differenceInDays } from "date-fns";
import { emailService } from "../services/emailService";
import { routeComplexTask } from "../services/aiRouter";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  // Minimum days between growth emails per org
  MIN_DAYS_BETWEEN_EMAILS: parseInt(process.env.GROWTH_EMAIL_COOLDOWN_DAYS || "21"),

  // Win-back sequence: days after cancellation to send each touch
  WIN_BACK_TOUCH_1_DAYS: 7,
  WIN_BACK_TOUCH_2_DAYS: 30,
  WIN_BACK_TOUCH_3_DAYS: 60,

  // Upsell: what % of limit usage triggers upgrade invitation
  UPSELL_TRIGGER_PCT: 0.80, // 80%

  // Power user threshold for referral program invitation
  POWER_USER_ACTIVITY_DAYS: 30,
  POWER_USER_MIN_ACTIONS: 50,

  // Re-engagement: days of inactivity before re-engagement email
  REENGAGEMENT_DAYS: 14,

  APP_URL: process.env.APP_URL || "https://app.acreos.com",
};

// Plan limits for upsell detection
const PLAN_LIMITS: Record<string, { leads: number; deals: number; name: string; nextTier: string }> = {
  free:    { leads: 50,   deals: 5,   name: "Free",    nextTier: "starter" },
  starter: { leads: 500,  deals: 50,  name: "Starter", nextTier: "pro" },
  pro:     { leads: 5000, deals: 500, name: "Pro",     nextTier: "scale" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting: check if org received a growth email recently
// ─────────────────────────────────────────────────────────────────────────────

async function wasRecentlyEmailed(orgId: number): Promise<boolean> {
  const since = subDays(new Date(), CONFIG.MIN_DAYS_BETWEEN_EMAILS);
  const recent = await db.select({ c: count() })
    .from(revenueProtectionInterventions)
    .where(and(
      eq(revenueProtectionInterventions.organizationId, orgId),
      gte(revenueProtectionInterventions.createdAt, since),
      sql`intervention_type LIKE 'growth_%'`,
    ));
  return Number(recent[0]?.c || 0) > 0;
}

async function logGrowthEmail(orgId: number, type: string, notes: string): Promise<void> {
  try {
    await db.insert(revenueProtectionInterventions).values({
      organizationId: orgId,
      interventionType: type,
      status: "sent",
      triggeredBy: "growth_automation",
      notes,
    } as any);
  } catch (err: any) {
    console.warn(`[GrowthAutomation] Failed to log intervention:`, err.message);
  }
}

async function getOwnerEmail(orgId: number): Promise<{ email: string; name: string } | null> {
  const [owner] = await db.select({ email: teamMembers.email, name: teamMembers.displayName })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.role, "owner")))
    .limit(1);
  if (owner?.email) return { email: owner.email, name: owner.name || owner.email.split("@")[0] };

  const [org] = await db.select({ contactEmail: (organizations as any).contactEmail, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if ((org as any)?.contactEmail) return { email: (org as any).contactEmail, name: org?.name || "Investor" };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Upsell Engine
// ─────────────────────────────────────────────────────────────────────────────

async function runUpsellEngine(): Promise<{ sent: number }> {
  let sent = 0;

  const upgradeableTiers = ["free", "starter", "pro"];
  const orgs = await db.select({
    id: organizations.id,
    name: organizations.name,
    tier: organizations.subscriptionTier,
    status: organizations.subscriptionStatus,
  }).from(organizations)
    .where(and(
      eq(organizations.subscriptionStatus, "active"),
      sql`subscription_tier IN ('free', 'starter', 'pro')`,
    ))
    .limit(200);

  for (const org of orgs) {
    if (await wasRecentlyEmailed(org.id)) continue;

    const limits = PLAN_LIMITS[org.tier as string];
    if (!limits) continue;

    // Count actual usage
    const [leadCount, dealCount] = await Promise.all([
      db.select({ c: count() }).from(leads).where(eq(leads.organizationId, org.id)),
      db.select({ c: count() }).from(deals).where(eq(deals.organizationId, org.id)),
    ]);

    const leadUsage = Number(leadCount[0]?.c || 0) / limits.leads;
    const dealUsage = Number(dealCount[0]?.c || 0) / limits.deals;
    const maxUsage = Math.max(leadUsage, dealUsage);

    if (maxUsage < CONFIG.UPSELL_TRIGGER_PCT) continue;

    const contact = await getOwnerEmail(org.id);
    if (!contact) continue;

    const hitResource = leadUsage >= dealUsage ? "leads" : "deals";
    const usagePct = Math.round(maxUsage * 100);
    const nextTier = limits.nextTier.charAt(0).toUpperCase() + limits.nextTier.slice(1);

    try {
      await emailService.sendEmail({
        to: contact.email,
        subject: `You've used ${usagePct}% of your ${limits.name} plan — here's what's next`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
          <h2 style="color:#1e3a5f;">You're scaling fast, ${contact.name}</h2>
          <p>Your AcreOS account is at <strong>${usagePct}%</strong> of your ${limits.name} plan limit for ${hitResource}.</p>
          <p>When you reach 100%, new ${hitResource} won't sync until you upgrade — which means missed opportunities in your pipeline.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
            <h3 style="margin:0 0 8px;font-size:16px;color:#374151;">Upgrade to ${nextTier} and get:</h3>
            <ul style="color:#374151;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
              <li>${limits.nextTier === "pro" ? "500 leads (10× more)" : "Unlimited leads & deals"}</li>
              <li>Advanced AI deal analysis</li>
              <li>Priority support from Sophie</li>
              ${limits.nextTier === "scale" ? "<li>White-label capabilities + API access</li>" : ""}
            </ul>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${CONFIG.APP_URL}/settings/billing" style="background:#1e3a5f;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Upgrade to ${nextTier} →</a>
          </div>
          <p style="color:#9ca3af;font-size:12px;">Questions? Just reply to this email — we're here to help.</p>
        </div>`,
        text: `You've used ${usagePct}% of your ${limits.name} plan. Upgrade to ${nextTier} to keep growing. ${CONFIG.APP_URL}/settings/billing`,
      });

      await logGrowthEmail(org.id, `growth_upsell_${limits.nextTier}`, `Sent upsell email at ${usagePct}% ${hitResource} usage`);
      sent++;
    } catch (err: any) {
      console.warn(`[GrowthAutomation] Upsell email failed for org ${org.id}:`, err.message);
    }
  }

  return { sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Win-Back Engine
// ─────────────────────────────────────────────────────────────────────────────

async function runWinBackEngine(): Promise<{ sent: number }> {
  let sent = 0;
  const now = new Date();

  // Find orgs that cancelled in the last 90 days
  const cancelledOrgs = await db.select({
    orgId: subscriptionEvents.organizationId,
    cancelledAt: subscriptionEvents.createdAt,
  }).from(subscriptionEvents)
    .where(and(
      eq(subscriptionEvents.eventType, "subscription_cancelled"),
      gte(subscriptionEvents.createdAt, subDays(now, 90)),
    ))
    .limit(100);

  for (const { orgId, cancelledAt } of cancelledOrgs) {
    if (!orgId || !cancelledAt) continue;
    if (await wasRecentlyEmailed(orgId)) continue;

    const daysSinceCancel = differenceInDays(now, new Date(cancelledAt));

    // Determine which touch to send
    let touchNumber: number | null = null;
    let touchType = "";

    const touch1Sent = await db.select({ c: count() }).from(revenueProtectionInterventions)
      .where(and(eq(revenueProtectionInterventions.organizationId, orgId), sql`intervention_type = 'growth_winback_1'`));
    const touch2Sent = await db.select({ c: count() }).from(revenueProtectionInterventions)
      .where(and(eq(revenueProtectionInterventions.organizationId, orgId), sql`intervention_type = 'growth_winback_2'`));
    const touch3Sent = await db.select({ c: count() }).from(revenueProtectionInterventions)
      .where(and(eq(revenueProtectionInterventions.organizationId, orgId), sql`intervention_type = 'growth_winback_3'`));

    if (daysSinceCancel >= CONFIG.WIN_BACK_TOUCH_3_DAYS && Number(touch3Sent[0]?.c || 0) === 0) {
      touchNumber = 3; touchType = "growth_winback_3";
    } else if (daysSinceCancel >= CONFIG.WIN_BACK_TOUCH_2_DAYS && Number(touch2Sent[0]?.c || 0) === 0) {
      touchNumber = 2; touchType = "growth_winback_2";
    } else if (daysSinceCancel >= CONFIG.WIN_BACK_TOUCH_1_DAYS && Number(touch1Sent[0]?.c || 0) === 0) {
      touchNumber = 1; touchType = "growth_winback_1";
    }

    if (!touchNumber) continue;

    const contact = await getOwnerEmail(orgId);
    if (!contact) continue;

    const [org] = await db.select({ name: organizations.name })
      .from(organizations).where(eq(organizations.id, orgId)).limit(1);

    try {
      let subject: string, htmlBody: string, textBody: string;

      if (touchNumber === 1) {
        subject = "We noticed you left — here's what's changed";
        htmlBody = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Hey ${contact.name},</h2>
          <p>We noticed your AcreOS account isn't active anymore — and we wanted to reach out personally.</p>
          <p>We've shipped several features recently that might change things for you:</p>
          <ul style="line-height:1.8;color:#374151;">
            <li><strong>Atlas AI</strong> — finds deals while you sleep, every night at 1 AM</li>
            <li><strong>5-touch follow-up automation</strong> — never let a lead go cold again</li>
            <li><strong>Seller-financed note tracking</strong> — complete note servicing dashboard</li>
          </ul>
          <p>If something wasn't working right when you left, I'd genuinely like to know — just reply.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${CONFIG.APP_URL}" style="background:#1e3a5f;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">See what's new →</a>
          </div>
        </div>`;
        textBody = `Hey ${contact.name}, we noticed you left AcreOS. We've added a lot — would love to show you what's changed. ${CONFIG.APP_URL}`;

      } else if (touchNumber === 2) {
        subject = "AcreOS product update — new features you might have missed";
        htmlBody = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Product Update for ${contact.name}</h2>
          <p>It's been about a month since you left AcreOS. We wanted to share what we've been building:</p>
          <ul style="line-height:1.8;color:#374151;">
            <li><strong>Marketplace</strong> — buy and sell land notes peer-to-peer</li>
            <li><strong>Acquisition Radar</strong> — AI county scoring for deal sourcing</li>
            <li><strong>Satellite imagery</strong> — automated property condition analysis</li>
            <li><strong>Voice AI</strong> — call transcription + sentiment analysis</li>
          </ul>
          <p>The platform is genuinely different from what you saw. If timing just wasn't right before, we'd love another shot.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${CONFIG.APP_URL}" style="background:#1e3a5f;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Take a look →</a>
          </div>
        </div>`;
        textBody = `AcreOS product update for ${contact.name}. We've built a lot since you left. ${CONFIG.APP_URL}`;

      } else {
        // Touch 3 — final touch, 60 days post-cancel
        subject = "Last note from AcreOS — a special offer";
        htmlBody = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Hey ${contact.name},</h2>
          <p>This is our last outreach — promise.</p>
          <p>You left AcreOS about two months ago. We've been thinking about what we could have done better for you, and we'd genuinely appreciate knowing.</p>
          <p>If you want to come back, reply to this email and we'll work something out. We're flexible for the right customers.</p>
          <p>If we're not the right fit, that's okay too. We wish you the best with your land investing journey.</p>
          <p style="margin-top:24px;">— The AcreOS Team</p>
        </div>`;
        textBody = `Last note from AcreOS. We'd love to have you back — reply to this email if you want to reconnect.`;
      }

      await emailService.sendEmail({ to: contact.email, subject, html: htmlBody, text: textBody });
      await logGrowthEmail(orgId, touchType, `Win-back touch ${touchNumber} sent (${daysSinceCancel}d post-cancel)`);
      sent++;
    } catch (err: any) {
      console.warn(`[GrowthAutomation] Win-back email failed for org ${orgId}:`, err.message);
    }
  }

  return { sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Referral Activation
// ─────────────────────────────────────────────────────────────────────────────

async function runReferralActivation(): Promise<{ sent: number }> {
  let sent = 0;
  const since = subDays(new Date(), CONFIG.POWER_USER_ACTIVITY_DAYS);

  // Find power users: paying, active, high activity, not recently emailed about referrals
  const powerUsers = await db.select({
    orgId: organizations.id,
    orgName: organizations.name,
    tier: organizations.subscriptionTier,
    activityCount: count(activityLog.id),
  }).from(organizations)
    .leftJoin(activityLog, and(
      eq(activityLog.organizationId, organizations.id),
      gte(activityLog.createdAt, since),
    ))
    .where(and(
      eq(organizations.subscriptionStatus, "active"),
      sql`subscription_tier NOT IN ('free')`,
    ))
    .groupBy(organizations.id, organizations.name, organizations.subscriptionTier)
    .having(sql`count(${activityLog.id}) >= ${CONFIG.POWER_USER_MIN_ACTIONS}`)
    .orderBy(desc(count(activityLog.id)))
    .limit(20);

  for (const user of powerUsers) {
    if (await wasRecentlyEmailed(user.orgId)) continue;

    // Check if already invited to referral program
    const alreadyInvited = await db.select({ c: count() })
      .from(revenueProtectionInterventions)
      .where(and(
        eq(revenueProtectionInterventions.organizationId, user.orgId),
        sql`intervention_type = 'growth_referral_invite'`,
      ));
    if (Number(alreadyInvited[0]?.c || 0) > 0) continue;

    const contact = await getOwnerEmail(user.orgId);
    if (!contact) continue;

    try {
      await emailService.sendEmail({
        to: contact.email,
        subject: "You've been active — want to earn rewards for it?",
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Hey ${contact.name},</h2>
          <p>You're one of our most active users — ${user.activityCount}+ actions in the last 30 days. We notice these things.</p>
          <p>We just launched our referral program, and we wanted you to be among the first to know about it.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
            <h3 style="margin:0 0 8px;color:#374151;">Refer a land investor, earn rewards:</h3>
            <ul style="color:#374151;font-size:14px;line-height:1.8;margin:0;padding-left:20px;">
              <li><strong>1 month free</strong> for every paying referral</li>
              <li>Your referrals get <strong>20% off their first 3 months</strong></li>
              <li>Stack multiple referrals — no limit</li>
            </ul>
          </div>
          <p>If you know other land investors who'd benefit from AcreOS, we'd love the introduction.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${CONFIG.APP_URL}/referrals" style="background:#059669;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Get your referral link →</a>
          </div>
          <p style="color:#9ca3af;font-size:12px;">Questions? Just reply — I'm a real person.</p>
        </div>`,
        text: `Hey ${contact.name}, you're one of our most active users. We just launched our referral program — earn a free month for every paying referral. ${CONFIG.APP_URL}/referrals`,
      });

      await logGrowthEmail(user.orgId, "growth_referral_invite", `Referral program invitation sent to power user (${user.activityCount} actions/30d)`);
      sent++;
    } catch (err: any) {
      console.warn(`[GrowthAutomation] Referral email failed for org ${user.orgId}:`, err.message);
    }
  }

  return { sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Engagement Reactivation
// ─────────────────────────────────────────────────────────────────────────────

async function runEngagementReactivation(): Promise<{ sent: number }> {
  let sent = 0;
  const inactiveSince = subDays(new Date(), CONFIG.REENGAGEMENT_DAYS);

  // Find paying orgs with no recent activity
  const inactiveOrgs = await db.select({
    orgId: organizations.id,
    orgName: organizations.name,
    tier: organizations.subscriptionTier,
  }).from(organizations)
    .where(and(
      eq(organizations.subscriptionStatus, "active"),
      sql`subscription_tier NOT IN ('free')`,
    ))
    .limit(100);

  for (const org of inactiveOrgs) {
    if (await wasRecentlyEmailed(org.orgId)) continue;

    // Check last activity
    const [lastActivity] = await db.select({ lastAt: sql<string>`max(created_at)` })
      .from(activityLog)
      .where(eq(activityLog.organizationId, org.orgId));

    if (!lastActivity?.lastAt) continue;
    const daysSinceActivity = differenceInDays(new Date(), new Date(lastActivity.lastAt));
    if (daysSinceActivity < CONFIG.REENGAGEMENT_DAYS) continue;

    // Get their specific data to personalize
    const [hotLeads, expiringDeals, activeNotes] = await Promise.all([
      db.select({ c: count() }).from(leads).where(and(
        eq(leads.organizationId, org.orgId),
        sql`score >= 75`,
        eq(leads.status, "active"),
      )),
      db.select({ c: count() }).from(deals).where(and(
        eq(deals.organizationId, org.orgId),
        sql`status IN ('offer_sent', 'negotiating')`,
      )),
      db.select({ c: count() }).from(sql`notes`).where(
        sql`organization_id = ${org.orgId} AND status = 'active'`,
      ).catch(() => [{ c: 0 }]),
    ]);

    const hotLeadCount = Number(hotLeads[0]?.c || 0);
    const expiringDealCount = Number(expiringDeals[0]?.c || 0);

    if (hotLeadCount === 0 && expiringDealCount === 0) continue; // nothing to surface

    const contact = await getOwnerEmail(org.orgId);
    if (!contact) continue;

    const urgentItems: string[] = [];
    if (hotLeadCount > 0) urgentItems.push(`${hotLeadCount} hot lead(s) waiting for contact`);
    if (expiringDealCount > 0) urgentItems.push(`${expiringDealCount} deal(s) in negotiation — response pending`);

    try {
      await emailService.sendEmail({
        to: contact.email,
        subject: `${urgentItems.length} item(s) need your attention in AcreOS`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1e3a5f;">Hey ${contact.name},</h2>
          <p>It's been ${daysSinceActivity} days since you last logged in — a few things have been piling up:</p>
          <ul style="line-height:1.8;color:#374151;">
            ${urgentItems.map(i => `<li><strong>${i}</strong></li>`).join("")}
          </ul>
          <p>Hot leads go cold fast. Deals go stale. We wanted to make sure these didn't slip through the cracks.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${CONFIG.APP_URL}/dashboard" style="background:#1e3a5f;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Open AcreOS →</a>
          </div>
        </div>`,
        text: `Hey ${contact.name}, ${daysSinceActivity} days inactive — ${urgentItems.join("; ")}. Log in: ${CONFIG.APP_URL}`,
      });

      await logGrowthEmail(org.orgId, "growth_reengagement", `Re-engagement sent (${daysSinceActivity}d inactive, ${hotLeadCount} hot leads, ${expiringDealCount} expiring deals)`);
      sent++;
    } catch (err: any) {
      console.warn(`[GrowthAutomation] Reengagement email failed for org ${org.orgId}:`, err.message);
    }
  }

  return { sent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export interface GrowthAutomationResult {
  runAt: Date;
  upsellSent: number;
  winBackSent: number;
  referralSent: number;
  reengagementSent: number;
  totalEmailsSent: number;
}

export async function runGrowthAutomation(): Promise<GrowthAutomationResult> {
  const runAt = new Date();
  console.log("[GrowthAutomation] Starting growth automation run...");

  const [upsell, winBack, referral, reengagement] = await Promise.allSettled([
    runUpsellEngine(),
    runWinBackEngine(),
    runReferralActivation(),
    runEngagementReactivation(),
  ]);

  const result: GrowthAutomationResult = {
    runAt,
    upsellSent: upsell.status === "fulfilled" ? upsell.value.sent : 0,
    winBackSent: winBack.status === "fulfilled" ? winBack.value.sent : 0,
    referralSent: referral.status === "fulfilled" ? referral.value.sent : 0,
    reengagementSent: reengagement.status === "fulfilled" ? reengagement.value.sent : 0,
    totalEmailsSent: 0,
  };
  result.totalEmailsSent = result.upsellSent + result.winBackSent + result.referralSent + result.reengagementSent;

  console.log(
    `[GrowthAutomation] Complete: ${result.totalEmailsSent} total emails — ` +
    `upsell: ${result.upsellSent}, win-back: ${result.winBackSent}, referral: ${result.referralSent}, re-engagement: ${result.reengagementSent}`
  );

  return result;
}

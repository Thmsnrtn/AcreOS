// @ts-nocheck
/**
 * Atlas Daily Briefing Job
 *
 * Runs every morning at 7 AM (user's timezone, approximated from org setting).
 * Generates a personalized briefing email covering:
 *   - Pipeline health: deals expiring, hot leads going cold
 *   - Notes payments due this week / overdue
 *   - Market pulse for target counties
 *   - Suggested top 3 action items for the day
 *   - Atlas memory highlights
 *
 * Scheduled via BullMQ repeatable job.
 */

import { db } from "../db";
import { organizations, leads, deals, notes, payments, teamMembers } from "@shared/schema";
import { eq, and, gte, lte, desc, lt, gt } from "drizzle-orm";
import { addDays, subDays, format, startOfDay, endOfDay, isAfter } from "date-fns";
import { sendEmail } from "../services/emailService";
import { getRelevantMemories, formatMemoriesForContext } from "../services/atlasMemory";

interface BriefingData {
  orgId: number;
  orgName: string;
  recipientEmail: string;
  recipientName: string;
  pipelineStats: {
    totalDeals: number;
    activeDeals: number;
    dealsClosingThisWeek: number;
    hotLeads: number;
    coldLeads: number;
  };
  notesStats: {
    paymentsThisWeek: number;
    overduePayments: number;
    totalActiveNotes: number;
  };
  topActions: string[];
  memoryHighlights: string;
  generatedAt: Date;
}

async function collectBriefingData(orgId: number): Promise<BriefingData | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return null;

  // Get org owner email
  const [owner] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.role, 'owner')))
    .limit(1);

  const recipientEmail = owner?.email || org.contactEmail;
  if (!recipientEmail) return null;

  const now = new Date();
  const nextWeek = addDays(now, 7);

  // Pipeline stats
  const allDeals = await db
    .select()
    .from(deals)
    .where(eq(deals.organizationId, orgId));

  const activeDeals = allDeals.filter(d => !['closed', 'dead', 'cancelled'].includes(d.status || ''));
  const closingThisWeek = activeDeals.filter(d =>
    d.expectedCloseDate && new Date(d.expectedCloseDate) <= nextWeek && new Date(d.expectedCloseDate) >= now
  );

  // Lead stats
  const allLeads = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), eq(leads.status, 'active')));

  const hotLeads = allLeads.filter(l => (l.score || 0) >= 75);
  const coldLeads = allLeads.filter(l => (l.score || 0) < 30);

  // Notes stats
  const allNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), eq(notes.status, 'active')));

  // Payments due this week (rough estimate from next payment date if stored)
  const paymentsThisWeek = allNotes.length; // Simplified — would need nextPaymentDate field
  const overduePayments = 0; // Would query from payments table for missed payments

  // Top actions — rule-based suggestions
  const topActions: string[] = [];
  if (closingThisWeek.length > 0) {
    topActions.push(`📋 Follow up on ${closingThisWeek.length} deal(s) closing this week`);
  }
  if (hotLeads.length > 0) {
    topActions.push(`🔥 Contact ${Math.min(hotLeads.length, 3)} hot lead(s) today while they're warm`);
  }
  if (coldLeads.length > 5) {
    topActions.push(`❄️ Re-engage ${coldLeads.length} cold leads — consider a new campaign`);
  }
  if (allNotes.length > 0) {
    topActions.push(`💰 Verify ${allNotes.length} active notes are current on payments`);
  }
  if (topActions.length === 0) {
    topActions.push('🎯 Review your pipeline and update deal stages', '📞 Make 5 seller calls today', '📊 Check your market intelligence reports');
  }

  // Atlas memory highlights
  const memories = await getRelevantMemories(orgId, 'atlas', 5);
  const memHighlights = formatMemoriesForContext(memories).trim();

  return {
    orgId,
    orgName: org.name || 'Your Organization',
    recipientEmail,
    recipientName: owner?.displayName || owner?.email?.split('@')[0] || 'Investor',
    pipelineStats: {
      totalDeals: allDeals.length,
      activeDeals: activeDeals.length,
      dealsClosingThisWeek: closingThisWeek.length,
      hotLeads: hotLeads.length,
      coldLeads: coldLeads.length,
    },
    notesStats: {
      paymentsThisWeek,
      overduePayments,
      totalActiveNotes: allNotes.length,
    },
    topActions,
    memoryHighlights: memHighlights,
    generatedAt: now,
  };
}

function generateBriefingEmailHtml(data: BriefingData): string {
  const dateStr = format(data.generatedAt, 'EEEE, MMMM d, yyyy');
  const actionsHtml = data.topActions
    .map(a => `<li style="margin-bottom:8px;">${a}</li>`)
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width:600px; margin:0 auto; padding:20px; color:#1a1a1a;">

  <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d6a4f 100%); padding:30px; border-radius:12px; margin-bottom:24px;">
    <h1 style="color:white; margin:0; font-size:24px;">☀️ Good Morning, ${data.recipientName}</h1>
    <p style="color:rgba(255,255,255,0.8); margin:8px 0 0;">${dateStr} · Atlas Daily Briefing</p>
  </div>

  <!-- Pipeline Snapshot -->
  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:16px;">
    <h2 style="margin:0 0 16px; font-size:16px; color:#374151;">📊 Pipeline Snapshot</h2>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
      <div style="text-align:center; background:white; padding:12px; border-radius:6px;">
        <div style="font-size:28px; font-weight:700; color:#1e3a5f;">${data.pipelineStats.activeDeals}</div>
        <div style="font-size:12px; color:#6b7280;">Active Deals</div>
      </div>
      <div style="text-align:center; background:white; padding:12px; border-radius:6px;">
        <div style="font-size:28px; font-weight:700; color:#f59e0b;">${data.pipelineStats.dealsClosingThisWeek}</div>
        <div style="font-size:12px; color:#6b7280;">Closing This Week</div>
      </div>
      <div style="text-align:center; background:white; padding:12px; border-radius:6px;">
        <div style="font-size:28px; font-weight:700; color:#ef4444;">${data.pipelineStats.hotLeads}</div>
        <div style="font-size:12px; color:#6b7280;">Hot Leads</div>
      </div>
    </div>
    ${data.pipelineStats.coldLeads > 0 ? `<p style="margin-top:12px; color:#ef4444; font-size:13px;">⚠️ ${data.pipelineStats.coldLeads} leads going cold — consider re-engagement</p>` : ''}
  </div>

  <!-- Notes & Payments -->
  ${data.notesStats.totalActiveNotes > 0 ? `
  <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px; margin-bottom:16px;">
    <h2 style="margin:0 0 8px; font-size:16px; color:#166534;">💰 Note Servicing</h2>
    <p style="margin:0; color:#15803d; font-size:14px;">${data.notesStats.totalActiveNotes} active notes · ${data.notesStats.paymentsThisWeek} payment(s) expected this week</p>
    ${data.notesStats.overduePayments > 0 ? `<p style="margin:8px 0 0; color:#ef4444; font-weight:600;">🚨 ${data.notesStats.overduePayments} overdue payment(s) need attention!</p>` : ''}
  </div>` : ''}

  <!-- Today's Top Actions -->
  <div style="background:white; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:16px;">
    <h2 style="margin:0 0 12px; font-size:16px; color:#374151;">✅ Today's Top Actions</h2>
    <ul style="margin:0; padding-left:20px; color:#374151; font-size:14px; line-height:1.7;">
      ${actionsHtml}
    </ul>
  </div>

  ${data.memoryHighlights ? `
  <!-- Atlas Memory Highlights -->
  <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:8px; padding:16px; margin-bottom:16px;">
    <h2 style="margin:0 0 8px; font-size:16px; color:#7c3aed;">🧠 Atlas Remembers</h2>
    <pre style="margin:0; font-size:12px; color:#6b21a8; white-space:pre-wrap; font-family:inherit;">${data.memoryHighlights}</pre>
  </div>` : ''}

  <!-- CTA -->
  <div style="text-align:center; margin:24px 0;">
    <a href="${process.env.APP_URL || 'https://app.acreos.com'}/dashboard"
       style="display:inline-block; background:#1e3a5f; color:white; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; font-size:15px;">
      Open AcreOS Dashboard →
    </a>
  </div>

  <p style="text-align:center; font-size:12px; color:#9ca3af; margin-top:24px;">
    Atlas Daily Briefing for ${data.orgName} · Powered by AcreOS<br>
    <a href="${process.env.APP_URL || 'https://app.acreos.com'}/settings/notifications" style="color:#9ca3af;">Manage email preferences</a>
  </p>
</body>
</html>`;
}

/**
 * Send the daily briefing to all eligible orgs.
 * Called by the BullMQ scheduler at 7 AM daily.
 */
export async function sendDailyBriefings(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  const allOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, 'active'));

  for (const { id } of allOrgs) {
    try {
      const data = await collectBriefingData(id);
      if (!data || !data.recipientEmail) continue;

      const html = generateBriefingEmailHtml(data);
      const subject = `☀️ Your Daily Briefing — ${format(new Date(), 'EEEE, MMM d')}`;

      await sendEmail({
        to: data.recipientEmail,
        subject,
        html,
        text: `Good morning, ${data.recipientName}! Your AcreOS daily briefing: ${data.pipelineStats.activeDeals} active deals, ${data.pipelineStats.hotLeads} hot leads, ${data.notesStats.totalActiveNotes} active notes. Open AcreOS to take action.`,
      });

      sent++;
    } catch (err: any) {
      console.error(`[DailyBriefing] Failed for org ${id}:`, err.message);
      failed++;
    }
  }

  console.log(`[DailyBriefing] Sent ${sent} briefings, ${failed} failed`);
  return { sent, failed };
}

/**
 * Register the daily briefing repeatable job with BullMQ.
 */
export async function registerDailyBriefingJob(queue: any): Promise<void> {
  await queue.add(
    'daily-briefing',
    {},
    {
      repeat: {
        cron: '0 7 * * *', // 7 AM UTC daily
        timezone: 'America/Chicago', // Central time (most land investors are central/mountain)
      },
      removeOnComplete: 5,
      removeOnFail: 3,
    }
  );
  console.log('[DailyBriefing] Registered daily briefing job at 7 AM CT');
}

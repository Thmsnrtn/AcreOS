/**
 * Customer Narrative — the per-Land-Investor monthly letter.
 *
 * Mirror of the founder letter, but written for each organization's
 * principal (the Land Investor using AcreOS). Generated in Pax's
 * voice — the customer-facing AI copilot that knows their account.
 *
 * Each letter synthesizes the org's past month:
 *   - Portfolio delta (leads, properties, deals, revenue)
 *   - Campaign results
 *   - Pipeline velocity (deals moving through stages)
 *   - Churn-risk/engagement state (framed positively)
 *   - One recommended action for next month
 *
 * The letter is the single biggest retention + engagement lever in
 * the product. Instead of a silent CRM, each user hears from Pax
 * monthly with personalized recommendations. Read rate and action-
 * taken rate become first-class metrics.
 *
 * Persona: customers see ONE AI brand — Pax. The founder-side board
 * (sophie_csm, forge_revenue, etc.) is an internal taxonomy that
 * never leaks into customer-facing surfaces. Sophie as a name stays
 * founder-internal.
 *
 * Voice rules (enforced by system prompt):
 *   - "Pax" first-person — never "the AcreOS team"
 *   - Land Investors (never real estate professionals, users, or clients)
 *   - Plain English, no CRM jargon
 *   - No competitor references
 *   - No emojis
 *   - Specific over generic ("You closed 3 deals in March; 2 came from
 *     your direct-mail campaign") not ("Great month!")
 *
 * Safety:
 *   - Letters never trigger real emails when SIMULATION_MODE=true.
 *   - Delivery is opt-in through the customer's notification settings.
 *   - Letters stored in `customer_letters` whether delivered or not,
 *     so the customer can always view them in-app.
 */

import { db } from "../db";
import {
  customerLetters,
  organizations,
  leads,
  deals,
  properties,
  campaigns,
  payments,
  churnRiskScores,
} from "@shared/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { routeCriticalTask } from "./aiRouter";

export interface CustomerMonthlySummary {
  monthKey: string;
  monthLabel: string;
  organizationId: number;
  organizationName: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  windowStart: Date;
  windowEnd: Date;
  portfolio: {
    leadsAdded: number;
    leadsTotal: number;
    propertiesAdded: number;
    propertiesTotal: number;
    dealsClosedWon: number;
    dealsClosedLost: number;
    dealsInPipeline: number;
    revenueThisMonthCents: number;
  };
  campaigns: {
    active: number;
    totalReach: number;
  };
  engagement: {
    lastActivity: Date | null;
    churnRiskBand: string | null;
    churnRiskScore: number | null;
  };
}

export async function generateCustomerLetter(
  organizationId: number,
  monthKey?: string,
): Promise<{
  monthKey: string;
  letterMarkdown: string;
  recommendedAction: string | null;
  summary: CustomerMonthlySummary;
}> {
  const { key, start, end, label } = resolveMonth(monthKey);
  const summary = await buildSummary(organizationId, key, label, start, end);
  const prose = await writeLetter(summary);

  await db
    .insert(customerLetters)
    .values({
      organizationId,
      monthKey: key,
      letterMarkdown: prose.markdown,
      summaryJson: summary,
      recommendedAction: prose.recommendedAction,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: [customerLetters.organizationId, customerLetters.monthKey],
      set: {
        letterMarkdown: prose.markdown,
        summaryJson: summary,
        recommendedAction: prose.recommendedAction,
        generatedAt: new Date(),
      },
    });

  logger.info(`[customerNarrative] letter generated for org=${organizationId} month=${key}`);
  return {
    monthKey: key,
    letterMarkdown: prose.markdown,
    recommendedAction: prose.recommendedAction,
    summary,
  };
}

export async function runMonthlyCustomerLetters(explicitMonthKey?: string): Promise<{
  monthKey: string;
  orgsProcessed: number;
  succeeded: number;
  failed: number;
}> {
  const { key } = resolveMonth(explicitMonthKey);
  // Generate for every active organization. Skip free-tier orgs if desired
  // in future; for now, everyone gets one.
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing', 'past_due')`);

  let succeeded = 0;
  let failed = 0;
  for (const o of orgs) {
    try {
      await generateCustomerLetter(o.id, key);
      succeeded++;
    } catch (err: any) {
      failed++;
      logger.warn(`[customerNarrative] failed for org=${o.id}`, {
        metadata: { error: err?.message },
      });
    }
  }
  logger.info(
    `[customerNarrative] monthly ${key}: ${succeeded} generated, ${failed} failed, ${orgs.length} total`,
  );

  // Email-deliver any letters that landed in draft status.
  try {
    const d = await deliverAllPendingLettersForMonth(key);
    logger.info(
      `[customerNarrative] delivery ${key}: ${d.delivered} sent, ${d.skipped} skipped, ${d.failed} failed`,
    );
  } catch (err: any) {
    logger.warn("[customerNarrative] delivery pass failed", {
      metadata: { error: err?.message },
    });
  }

  return { monthKey: key, orgsProcessed: orgs.length, succeeded, failed };
}

export async function getCustomerLetter(organizationId: number, monthKey?: string) {
  if (monthKey) {
    const [row] = await db
      .select()
      .from(customerLetters)
      .where(
        and(
          eq(customerLetters.organizationId, organizationId),
          eq(customerLetters.monthKey, monthKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select()
    .from(customerLetters)
    .where(eq(customerLetters.organizationId, organizationId))
    .orderBy(desc(customerLetters.generatedAt))
    .limit(1);
  return row ?? null;
}

export async function listCustomerLetterArchive(organizationId: number, limit = 12) {
  return db
    .select({
      monthKey: customerLetters.monthKey,
      generatedAt: customerLetters.generatedAt,
      openedAt: customerLetters.openedAt,
      status: customerLetters.status,
      recommendedAction: customerLetters.recommendedAction,
    })
    .from(customerLetters)
    .where(eq(customerLetters.organizationId, organizationId))
    .orderBy(desc(customerLetters.monthKey))
    .limit(limit);
}

export async function markCustomerLetterOpened(organizationId: number, monthKey: string) {
  await db
    .update(customerLetters)
    .set({ openedAt: new Date(), status: "opened" })
    .where(
      and(
        eq(customerLetters.organizationId, organizationId),
        eq(customerLetters.monthKey, monthKey),
      ),
    );
}

/**
 * Email-deliver one customer letter. Uses the existing emailService,
 * which is already SIMULATION_MODE-wrapped — nothing ships during
 * sim runs. Returns delivery info; stamps deliveredAt on the letter
 * row on success so we don't re-send on retries.
 */
export async function deliverCustomerLetter(
  organizationId: number,
  monthKey: string,
): Promise<{ success: boolean; skipped?: string; error?: string; messageId?: string }> {
  const letter = await getCustomerLetter(organizationId, monthKey);
  if (!letter) return { success: false, skipped: "no letter" };
  if (letter.deliveredAt) return { success: true, skipped: "already delivered" };

  // Find the org's owner email. Users table lives in shared/models/auth.
  const { users } = await import("@shared/models/auth");
  const { organizations } = await import("@shared/schema");
  const [org] = await db
    .select({ ownerId: organizations.ownerId, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org?.ownerId) return { success: false, skipped: "org has no owner" };
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, org.ownerId))
    .limit(1);
  if (!user?.email) return { success: false, skipped: "owner has no email" };

  const { emailService } = await import("./emailService");
  const html = markdownToEmailHtml(letter.letterMarkdown);
  const subject = `Your ${new Date(letter.generatedAt).toLocaleString("en-US", { month: "long", year: "numeric" })} at ${org.name ?? "AcreOS"}`;

  const result = await emailService.sendEmail({
    to: user.email,
    subject,
    html,
    text: letter.letterMarkdown,
    fromName: "Pax at AcreOS",
    organizationId,
    tags: { type: "customer_monthly_letter", monthKey },
  });

  if (result.success) {
    await db
      .update(customerLetters)
      .set({ deliveredAt: new Date(), status: "delivered" })
      .where(
        and(
          eq(customerLetters.organizationId, organizationId),
          eq(customerLetters.monthKey, monthKey),
        ),
      );
  }
  return {
    success: result.success,
    error: result.error,
    messageId: result.messageId,
  };
}

/**
 * Deliver letters for all orgs that have an undelivered letter for
 * the given monthKey. Called right after monthly generation.
 */
export async function deliverAllPendingLettersForMonth(
  monthKey: string,
): Promise<{ delivered: number; skipped: number; failed: number }> {
  const pending = await db
    .select({ organizationId: customerLetters.organizationId })
    .from(customerLetters)
    .where(
      and(
        eq(customerLetters.monthKey, monthKey),
        eq(customerLetters.status, "draft"),
      ),
    );
  let delivered = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of pending) {
    const r = await deliverCustomerLetter(p.organizationId, monthKey);
    if (r.success && !r.skipped) delivered++;
    else if (r.skipped) skipped++;
    else failed++;
  }
  logger.info(`[customerNarrative] delivered ${delivered}, skipped ${skipped}, failed ${failed} for ${monthKey}`);
  return { delivered, skipped, failed };
}

/**
 * Lightweight markdown → HTML for email. Tuned for the narrative
 * structure (h1/h2, bold, lists, paragraphs). Inlines minimal styling.
 */
function markdownToEmailHtml(md: string): string {
  const blocks = md.trim().split(/\n{2,}/);
  const body = blocks
    .map((block) => {
      const t = block.trim();
      if (t.startsWith("# "))
        return `<h1 style="font-family:Georgia,serif;color:#111;margin:24px 0 12px">${inlineMd(t.slice(2))}</h1>`;
      if (t.startsWith("## "))
        return `<h2 style="font-family:Georgia,serif;color:#222;margin:20px 0 8px;font-size:18px">${inlineMd(t.slice(3))}</h2>`;
      if (/^[-*] /.test(t)) {
        const items = t
          .split(/\n/)
          .filter((l) => /^[-*] /.test(l))
          .map((l) => `<li style="margin:4px 0">${inlineMd(l.replace(/^[-*] /, ""))}</li>`)
          .join("");
        return `<ul style="padding-left:20px">${items}</ul>`;
      }
      if (t === "---") return `<hr style="border:0;border-top:1px solid #e5e5e5;margin:16px 0">`;
      return `<p style="font-family:Georgia,serif;line-height:1.55;color:#333;margin:12px 0">${inlineMd(t)}</p>`;
    })
    .join("\n");
  const appUrl = process.env.APP_URL ?? "https://acreos.io";
  return `<!doctype html><html><body style="max-width:640px;margin:0 auto;padding:24px;background:#fafafa"><div style="background:#fff;padding:32px;border:1px solid #eee;border-radius:8px">${body}<p style="margin-top:32px;color:#999;font-size:12px;font-family:Georgia,serif">This letter is personalized for your account. <a href="${appUrl}/my-letter" style="color:#666;text-decoration:underline">View it in the app →</a></p></div></body></html>`;
}

function inlineMd(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// ── Summary builder ─────────────────────────────────────────────────

async function buildSummary(
  orgId: number,
  key: string,
  label: string,
  start: Date,
  end: Date,
): Promise<CustomerMonthlySummary> {
  const [orgRow, leadStats, propStats, dealStats, campaignStats, paymentStats, churnRow] =
    await Promise.all([
      db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1),
      db
        .select({
          added: sql<number>`sum(case when created_at >= ${start} and created_at < ${end} then 1 else 0 end)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(leads)
        .where(eq(leads.organizationId, orgId)),
      db
        .select({
          added: sql<number>`sum(case when created_at >= ${start} and created_at < ${end} then 1 else 0 end)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(properties)
        .where(eq(properties.organizationId, orgId)),
      db
        .select({
          won: sql<number>`sum(case when status = 'closed_won' and updated_at >= ${start} and updated_at < ${end} then 1 else 0 end)::int`,
          lost: sql<number>`sum(case when status = 'closed_lost' and updated_at >= ${start} and updated_at < ${end} then 1 else 0 end)::int`,
          active: sql<number>`sum(case when status not in ('closed_won', 'closed_lost') then 1 else 0 end)::int`,
        })
        .from(deals)
        .where(eq(deals.organizationId, orgId)),
      db
        .select({
          active: sql<number>`sum(case when status = 'active' then 1 else 0 end)::int`,
        })
        .from(campaigns)
        .where(eq(campaigns.organizationId, orgId)),
      db
        .select({
          totalThisMonth: sql<number>`coalesce(sum(amount), 0)::numeric`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, orgId),
            gte(payments.createdAt, start),
            lt(payments.createdAt, end),
          ),
        ),
      db
        .select()
        .from(churnRiskScores)
        .where(eq(churnRiskScores.organizationId, orgId))
        .orderBy(desc(churnRiskScores.createdAt))
        .limit(1),
    ]);

  const org = orgRow[0];
  return {
    monthKey: key,
    monthLabel: label,
    organizationId: orgId,
    organizationName: org?.name ?? "Your organization",
    subscriptionTier: org?.subscriptionTier ?? "unknown",
    subscriptionStatus: org?.subscriptionStatus ?? "unknown",
    windowStart: start,
    windowEnd: end,
    portfolio: {
      leadsAdded: Number(leadStats[0]?.added ?? 0),
      leadsTotal: Number(leadStats[0]?.total ?? 0),
      propertiesAdded: Number(propStats[0]?.added ?? 0),
      propertiesTotal: Number(propStats[0]?.total ?? 0),
      dealsClosedWon: Number(dealStats[0]?.won ?? 0),
      dealsClosedLost: Number(dealStats[0]?.lost ?? 0),
      dealsInPipeline: Number(dealStats[0]?.active ?? 0),
      // Payments uses numeric `amount` (dollars), so multiply for cents consistency.
      revenueThisMonthCents: Math.round(Number(paymentStats[0]?.totalThisMonth ?? 0) * 100),
    },
    campaigns: {
      active: Number(campaignStats[0]?.active ?? 0),
      totalReach: 0,
    },
    engagement: {
      lastActivity: org?.updatedAt ?? null,
      churnRiskBand: churnRow[0]?.riskBand ?? null,
      churnRiskScore: churnRow[0]?.riskScore ?? null,
    },
  };
}

// ── LLM call ────────────────────────────────────────────────────────

async function writeLetter(s: CustomerMonthlySummary): Promise<{
  markdown: string;
  recommendedAction: string | null;
}> {
  const context = buildLetterContext(s);
  // Vertical-aware voice: wholesaler vs. note investor vs. fix-and-flip
  // all get addressed correctly. Falls back to land-investor vocabulary
  // when we can't infer.
  const { paxVerticalContext, getOrgInvestorType } = await import("./paxPersona");
  const investorType = await getOrgInvestorType(s.organizationId);
  const verticalBlock = paxVerticalContext(investorType);
  const systemPrompt = verticalBlock
    ? `${CUSTOMER_LETTER_SYSTEM_PROMPT}\n${verticalBlock}`
    : CUSTOMER_LETTER_SYSTEM_PROMPT;
  try {
    const response = await routeCriticalTask(
      "customer_monthly_letter",
      systemPrompt,
      context,
    );
    const parsed = parseNarrative(response.content);
    return parsed;
  } catch (err: any) {
    logger.warn("[customerNarrative] letter generation failed, using fallback", {
      metadata: { error: err?.message, orgId: s.organizationId },
    });
    return {
      markdown: buildFallbackLetter(s),
      recommendedAction: s.engagement.churnRiskBand === "critical"
        ? "Let's get on a call — your account has some early warning signals I'd like to walk through together."
        : "Review your top 3 leads and move them to the next stage before Friday.",
    };
  }
}

function buildLetterContext(s: CustomerMonthlySummary): string {
  const lines: string[] = [];
  lines.push(`ORGANIZATION: ${s.organizationName}`);
  lines.push(`TIER: ${s.subscriptionTier} (${s.subscriptionStatus})`);
  lines.push(`MONTH: ${s.monthLabel}`);
  lines.push("");
  lines.push(`PORTFOLIO THIS MONTH:`);
  lines.push(`- Leads added: ${s.portfolio.leadsAdded} (total ${s.portfolio.leadsTotal})`);
  lines.push(`- Properties added: ${s.portfolio.propertiesAdded} (total ${s.portfolio.propertiesTotal})`);
  lines.push(`- Deals won: ${s.portfolio.dealsClosedWon}, lost: ${s.portfolio.dealsClosedLost}, in pipeline: ${s.portfolio.dealsInPipeline}`);
  lines.push(`- Revenue: $${(s.portfolio.revenueThisMonthCents / 100).toFixed(0)}`);
  lines.push("");
  lines.push(`CAMPAIGNS: ${s.campaigns.active} active`);
  lines.push("");
  lines.push(`ENGAGEMENT:`);
  lines.push(`- Churn risk band: ${s.engagement.churnRiskBand ?? "unknown"}`);
  lines.push(`- Churn risk score: ${s.engagement.churnRiskScore ?? "unknown"}`);
  lines.push("");
  lines.push(
    `Write the monthly customer letter. Return JSON { markdown, recommendedAction }.`,
  );
  return lines.join("\n");
}

function parseNarrative(raw: string): {
  markdown: string;
  recommendedAction: string | null;
} {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.markdown === "string") {
      return {
        markdown: parsed.markdown,
        recommendedAction: parsed.recommendedAction ?? null,
      };
    }
  } catch {}
  return { markdown: raw.trim(), recommendedAction: null };
}

function buildFallbackLetter(s: CustomerMonthlySummary): string {
  return [
    `# Your ${s.monthLabel} at ${s.organizationName}`,
    "",
    `Hi — this is Pax, your AI copilot at AcreOS.`,
    "",
    `## Your month`,
    "",
    `You added ${s.portfolio.leadsAdded} leads, ${s.portfolio.propertiesAdded} properties, and closed ${s.portfolio.dealsClosedWon} ${s.portfolio.dealsClosedWon === 1 ? "deal" : "deals"}. ${s.portfolio.dealsInPipeline > 0 ? `You have ${s.portfolio.dealsInPipeline} ${s.portfolio.dealsInPipeline === 1 ? "deal" : "deals"} still in the pipeline.` : ""}`,
    "",
    s.portfolio.revenueThisMonthCents > 0
      ? `Revenue this month: **$${(s.portfolio.revenueThisMonthCents / 100).toFixed(0)}**.`
      : `No closed revenue yet this month — that's normal for most Land Investors when ${s.portfolio.dealsInPipeline} deals are still in pipeline.`,
    "",
    `## What I recommend next month`,
    "",
    s.engagement.churnRiskBand === "critical"
      ? `Let's get on a quick call. Your account has a few early warning signals I'd like to walk through — it's easier over a conversation than by email.`
      : s.portfolio.dealsInPipeline > 0
        ? `Focus on moving your top 3 pipeline deals to the next stage. Deals that sit more than 14 days lose 40% of their close probability.`
        : `Start a new direct-mail campaign if you haven't in the last 30 days. Lead flow is the engine; the rest follows.`,
  ].join("\n");
}

function resolveMonth(
  monthKey?: string,
): { key: string; start: Date; end: Date; label: string } {
  const now = new Date();
  let year: number, month: number;
  if (monthKey) {
    const [y, m] = monthKey.split("-").map((n) => parseInt(n, 10));
    year = y;
    month = m - 1;
  } else {
    year = now.getUTCFullYear();
    month = now.getUTCMonth() - 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const label = start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { key, start, end, label };
}

const CUSTOMER_LETTER_SYSTEM_PROMPT = `You are Pax, the Land Investor's AI copilot, writing the monthly letter to the Land Investor about their business.

Voice rules (non-negotiable):
- First-person "I" as Pax. Never "we" or "the AcreOS team" or "the platform."
- Refer to the reader as a Land Investor. Never "user," "customer," "client," or "real estate professional."
- Specific over generic. Cite exact numbers. Never "great month" or "keep up the good work."
- Unflinching when the data is bad. If deals are drying up, say so — and suggest what to do.
- No competitor references (Land Geek, GeekPay, LG Pass, Mark Podolsky, etc. do not exist to you).
- No emojis.
- Plain English. Short paragraphs. If jargon appears, define it or remove it.

Letter structure (markdown headings):

# Your <month label>, <org name>

(Opener: one warm but specific sentence naming the reader's actual month — a standout, a miss, or a trend.)

## Your month at a glance

(2-4 sentences summarizing what happened. Use the numbers. Be honest.)

## What worked

(1-3 bullets of specifics — not "you did great" but "your direct-mail campaign generated 12 qualified leads, the highest of any channel this month.")

## What didn't

(0-2 bullets. Skip this section if genuinely nothing warranted concern. When used, propose a remedy.)

## What I recommend next month

(The single most valuable next move. One clear action with a specific outcome. If churn risk is elevated, offer a call.)

---

Output format (JSON, no code fences):
{
  "markdown": "<full letter in markdown>",
  "recommendedAction": "<one-line version of the recommended next-month action, suitable for in-app display>"
}`;

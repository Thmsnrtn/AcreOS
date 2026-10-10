/**
 * The pre-renewal notice for yearly plans (Cal. Bus. & Prof. Code
 * § 17602(a)(8), (b)(2): at least 15 and at most 45 days before an automatic
 * renewal with an initial term of one year or longer). The notice content and
 * the window are shared/billing/autoRenewalTerms.ts; this is the daily job.
 *
 * For every active yearly org with a Stripe subscription: read the
 * subscription's period end and cancel-at-period-end from Stripe (the source
 * of truth — the org row does not carry the period end), and when the renewal
 * is 15–30 days away and no notice went out for that period, send one on the
 * SYSTEM lane (AcreOS's own mail to its own customer) and record it in
 * subscription_history keyed by the period end, so it is sent once per
 * renewal. A Stripe or send failure is logged and retried the next day,
 * still inside the window.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { organizations, subscriptionHistory } from "@shared/schema";
import { annualRenewalNotice, annualRenewalNoticeDue } from "@shared/billing/autoRenewalTerms";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

const ANNUAL_NOTICE_EVENT = "annual_renewal_notice_sent";
const REASON = "annual renewal notice: AcreOS reads its own yearly subscribers to send the renewal notice the auto-renewal law requires (AcreOS operating itself)";

export interface AnnualNoticeDeps {
  getSubscription: (id: string) => Promise<{ current_period_end?: number; cancel_at_period_end?: boolean; items?: { data?: Array<{ current_period_end?: number; price?: { unit_amount?: number | null; currency?: string } }> } } | null>;
  ownerEmail: (orgId: number) => Promise<string | null>;
  send: (o: { to: string; subject: string; html: string; text: string; organizationId: number; idempotencyKey: string }) => Promise<unknown>;
}

async function defaultDeps(): Promise<AnnualNoticeDeps> {
  const { stripeService } = await import("../stripeService");
  const { ownerEmailOf } = await import("./autopilot/delegationRules");
  const { emailService } = await import("./emailService");
  return {
    // The period end lives on the subscription ITEM in this Stripe API version.
    getSubscription: async (id) => {
      const s = await stripeService.getSubscription(id);
      if (!s) return null;
      return {
        cancel_at_period_end: s.cancel_at_period_end,
        items: { data: s.items.data.map((i) => ({ current_period_end: i.current_period_end, price: { unit_amount: i.price.unit_amount, currency: i.price.currency } })) },
      };
    },
    ownerEmail: ownerEmailOf,
    send: (o) => emailService.sendEmail({ to: o.to, subject: o.subject, html: o.html, text: o.text, purpose: "system", organizationId: o.organizationId, idempotencyKey: o.idempotencyKey }),
  };
}

export async function runAnnualRenewalNotices(opts: { deps?: AnnualNoticeDeps; nowMs?: number } = {}): Promise<{ considered: number; sent: number; skipped: number; failed: number }> {
  const deps = opts.deps ?? (await defaultDeps());
  const nowMs = opts.nowMs ?? clock.nowMs();
  const db = unscopedForPlatformOps(REASON);
  const orgs = await db
    .select({ id: organizations.id, tier: organizations.subscriptionTier, subId: organizations.stripeSubscriptionId })
    .from(organizations)
    .where(and(eq(organizations.billingInterval, "yearly"), eq(organizations.subscriptionStatus, "active"), isNotNull(organizations.stripeSubscriptionId), sql`coalesce(${organizations.isFounder}, false) = false`));
  const out = { considered: orgs.length, sent: 0, skipped: 0, failed: 0 };
  for (const o of orgs) {
    try {
      const sub = await deps.getSubscription(o.subId!);
      const item = sub?.items?.data?.[0];
      const periodEndSec = sub?.current_period_end ?? item?.current_period_end;
      if (!sub || !periodEndSec) { out.skipped++; continue; }
      const renewsAtMs = periodEndSec * 1000;
      const [prior] = await db
        .select({ id: subscriptionHistory.id })
        .from(subscriptionHistory)
        .where(and(eq(subscriptionHistory.organizationId, o.id), eq(subscriptionHistory.eventType, ANNUAL_NOTICE_EVENT), sql`${subscriptionHistory.metadata}->>'periodEnd' = ${String(periodEndSec)}`))
        .limit(1);
      if (!annualRenewalNoticeDue({ renewsAtMs, nowMs, alreadySentForThisPeriod: !!prior, cancelAtPeriodEnd: sub.cancel_at_period_end === true })) { out.skipped++; continue; }
      const amount = item?.price?.unit_amount;
      const to = await deps.ownerEmail(o.id);
      if (typeof amount !== "number" || !to) {
        logger.warn(`[annualRenewalNotice] org ${o.id}: ${typeof amount !== "number" ? "no price on the subscription" : "no owner email"} — notice not sent`);
        out.failed++;
        continue;
      }
      const planName = (o.tier ?? "AcreOS").charAt(0).toUpperCase() + (o.tier ?? "AcreOS").slice(1);
      const notice = annualRenewalNotice({ planName, renewsOn: new Date(renewsAtMs), amountCents: amount, currency: item?.price?.currency, appUrl: process.env.APP_URL || "https://acreos.io" });
      // Keyed by org and period: a job that crashes after the send and before the
      // history row replays the next day instead of sending twice.
      await deps.send({ to, ...notice, organizationId: o.id, idempotencyKey: `annual-renewal-notice:${o.id}:${periodEndSec}` });
      await db.insert(subscriptionHistory).values({
        organizationId: o.id,
        eventType: ANNUAL_NOTICE_EVENT,
        tier: o.tier,
        billingInterval: "yearly",
        priceCents: amount,
        metadata: { periodEnd: String(periodEndSec), sentAt: new Date(nowMs).toISOString() },
      });
      out.sent++;
    } catch (err) {
      out.failed++;
      logger.warn(`[annualRenewalNotice] org ${o.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

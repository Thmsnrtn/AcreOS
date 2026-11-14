/**
 * The pre-renewal notice for yearly plans (Cal. Bus. & Prof. Code
 * § 17602(a)(8), (b)(2): at least 15 and at most 45 days before an automatic
 * renewal with an initial term of one year or longer; and 940 CMR
 * 38.05(4)–(5) (Massachusetts): written notice 5–30 days before the
 * cancel-by date at every renewal of a feature exceeding 31 days, price
 * change or not, with the (4)(a)–(e) disclosures). The notice content and
 * the windows are shared/billing/autoRenewalTerms.ts; this is the daily job.
 *
 * For every active yearly org with a Stripe subscription: read the
 * subscription's period end and cancel-at-period-end from Stripe (the source
 * of truth — the org row does not carry the period end), and when either
 * regime's window is open (15–30 days for California; 5–30 days for
 * Massachusetts — the 5–14-day band is Massachusetts-timely even when it is
 * California-late) and no notice went out for that period, send one notice
 * carrying both regimes' contents on the SYSTEM lane (AcreOS's own mail to
 * its own customer) and record it in subscription_history keyed by the
 * period end, so it is sent once per renewal. The recorded amount is the
 * FULL renewal charge — every subscription item (base plan plus seat
 * add-ons), quantity counted — not just the first item's price. A Stripe
 * or send failure is logged and retried the next day, still inside the
 * window.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { organizations, subscriptionHistory } from "@shared/schema";
import { annualRenewalNotice, annualRenewalNoticeDue, maAnnualRenewalNoticeDue } from "@shared/billing/autoRenewalTerms";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

const ANNUAL_NOTICE_EVENT = "annual_renewal_notice_sent";
const REASON = "annual renewal notice: AcreOS reads its own yearly subscribers to send the renewal notice the auto-renewal law requires (AcreOS operating itself)";

export interface AnnualNoticeDeps {
  getSubscription: (id: string) => Promise<{ current_period_end?: number; cancel_at_period_end?: boolean; items?: { data?: Array<{ current_period_end?: number; quantity?: number; price?: { unit_amount?: number | null; currency?: string } }> } } | null>;
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
        items: { data: s.items.data.map((i) => ({ current_period_end: i.current_period_end, quantity: i.quantity, price: { unit_amount: i.price.unit_amount, currency: i.price.currency } })) },
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
      const dueInput = { renewsAtMs, nowMs, alreadySentForThisPeriod: !!prior, cancelAtPeriodEnd: sub.cancel_at_period_end === true };
      const caDue = annualRenewalNoticeDue(dueInput);
      const maDue = maAnnualRenewalNoticeDue(dueInput);
      if (!caDue && !maDue) { out.skipped++; continue; }
      // The amount owed at renewal is the sum over ALL subscription items
      // (base plan + seat add-ons), quantities counted — 38.05(4)(b) also
      // requires every chargeable Product to be named, so the item list
      // travels into the notice. Any item without a price makes the total
      // unknowable: fail loudly and retry tomorrow rather than understate.
      const items = sub.items?.data ?? [];
      const amount = items.length > 0 && items.every((i) => typeof i.price?.unit_amount === "number")
        ? items.reduce((sum, i) => sum + (i.price!.unit_amount as number) * (i.quantity ?? 1), 0)
        : undefined;
      const to = await deps.ownerEmail(o.id);
      if (typeof amount !== "number" || !to) {
        logger.warn(`[annualRenewalNotice] org ${o.id}: ${typeof amount !== "number" ? "no price on the subscription" : "no owner email"} — notice not sent`);
        out.failed++;
        continue;
      }
      const planName = (o.tier ?? "AcreOS").charAt(0).toUpperCase() + (o.tier ?? "AcreOS").slice(1);
      const products = items.map((_, idx) => (idx === 0 ? `AcreOS ${planName} plan` : "additional seat add-on"));
      const notice = annualRenewalNotice({ planName, renewsOn: new Date(renewsAtMs), amountCents: amount, currency: item?.price?.currency, appUrl: process.env.APP_URL || "https://acreos.io", products });
      // Keyed by org and period: a job that crashes after the send and before the
      // history row replays the next day instead of sending twice.
      await deps.send({ to, ...notice, organizationId: o.id, idempotencyKey: `annual-renewal-notice:${o.id}:${periodEndSec}` });
      await db.insert(subscriptionHistory).values({
        organizationId: o.id,
        eventType: ANNUAL_NOTICE_EVENT,
        tier: o.tier,
        billingInterval: "yearly",
        priceCents: amount,
        metadata: { periodEnd: String(periodEndSec), sentAt: new Date(nowMs).toISOString(), noticeRegimes: [...(caDue ? ["ca-arl-17602"] : []), ...(maDue ? ["ma-940-cmr-38.05"] : [])] },
      });
      out.sent++;
    } catch (err) {
      out.failed++;
      logger.warn(`[annualRenewalNotice] org ${o.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

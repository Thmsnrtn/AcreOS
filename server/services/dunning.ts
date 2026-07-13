import { storage } from "../storage";
import { db } from "../db";
import { eq, and, or, desc, sql, count } from "drizzle-orm";
import {
  DUNNING_CONFIG,
  DUNNING_STAGES,
  dunningEvents,
  organizations,
  type DunningStage,
  type DunningEvent,
  type InsertDunningEvent,
  type InsertSystemAlert,
  type Organization
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { logActivity } from "./systemActivityLogger";
import { logger } from "../utils/logger";

const APP_URL = process.env.APP_URL || "https://app.acreos.io";

// ---------------------------------------------------------------------------
// Dunning email templates
// ---------------------------------------------------------------------------

function dunningEmailTemplates(org: Organization, amountDue: string, updatePaymentUrl: string) {
  return {
    payment_failed: {
      subject: "Your AcreOS payment didn't go through",
      html: `
        <h2>Hi ${org.name},</h2>
        <p>We tried to charge your card for <strong>${amountDue}</strong> but the payment didn't go through.</p>
        <p>This can happen when a card expires or your bank flags the charge — it's usually easy to fix.</p>
        <p><a href="${updatePaymentUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Update Payment Method</a></p>
        <p>Your account is fully active — no action is needed right away, but please update your payment within a few days to avoid any interruption.</p>
        <p>— The AcreOS Team</p>
      `,
      text: `Hi ${org.name},\n\nWe tried to charge your card for ${amountDue} but the payment didn't go through.\n\nPlease update your payment method: ${updatePaymentUrl}\n\nYour account is fully active for now.\n\n— The AcreOS Team`,
    },
    reminder: {
      subject: "Reminder: please update your payment method",
      html: `
        <h2>Hi ${org.name},</h2>
        <p>Just a friendly reminder — your payment of <strong>${amountDue}</strong> is still outstanding.</p>
        <p>To keep your account running smoothly, please update your payment method:</p>
        <p><a href="${updatePaymentUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Update Payment Method</a></p>
        <p>If you've already updated it, you can ignore this email — we'll retry automatically.</p>
        <p>— The AcreOS Team</p>
      `,
      text: `Hi ${org.name},\n\nFriendly reminder: your payment of ${amountDue} is still outstanding.\n\nUpdate your payment method: ${updatePaymentUrl}\n\nIf you've already updated, we'll retry automatically.\n\n— The AcreOS Team`,
    },
    warning: {
      subject: "Action needed: your AcreOS account will be restricted soon",
      html: `
        <h2>Hi ${org.name},</h2>
        <p>Your payment of <strong>${amountDue}</strong> has been outstanding for a week. We'll need to restrict some features on your account soon if we can't process payment.</p>
        <p><strong>What happens next:</strong></p>
        <ul>
          <li>Day 8-14: Limited access (read-only for some features)</li>
          <li>Day 15+: Account suspended</li>
          <li>Day 21: Subscription cancelled (your data is preserved)</li>
        </ul>
        <p><a href="${updatePaymentUrl}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">Update Payment Now</a></p>
        <p>If you're having trouble or want to discuss your plan, reply to this email — we're happy to help.</p>
        <p>— The AcreOS Team</p>
      `,
      text: `Hi ${org.name},\n\nYour payment of ${amountDue} has been outstanding for a week.\n\nDay 8-14: Limited access\nDay 15+: Account suspended\nDay 21: Subscription cancelled (data preserved)\n\nUpdate now: ${updatePaymentUrl}\n\n— The AcreOS Team`,
    },
    final_notice: {
      subject: "Final notice: your AcreOS subscription will be cancelled in 7 days",
      html: `
        <h2>Hi ${org.name},</h2>
        <p>This is your final notice. Your payment of <strong>${amountDue}</strong> has been outstanding for two weeks, and your account features are currently restricted.</p>
        <p><strong>Your subscription will be cancelled in 7 days</strong> if we can't process payment. Your data will be preserved, and you can re-subscribe at any time.</p>
        <p><a href="${updatePaymentUrl}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">Update Payment Now</a></p>
        <p>— The AcreOS Team</p>
      `,
      text: `Hi ${org.name},\n\nFinal notice: your payment of ${amountDue} has been outstanding for two weeks.\n\nYour subscription will be cancelled in 7 days if we can't process payment. Your data will be preserved.\n\nUpdate now: ${updatePaymentUrl}\n\n— The AcreOS Team`,
    },
    recovery_success: {
      subject: "You're all set — payment received!",
      html: `
        <h2>Hi ${org.name},</h2>
        <p>Great news — we've successfully processed your payment of <strong>${amountDue}</strong>. Your account is fully active again.</p>
        <p><a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;">Go to Dashboard</a></p>
        <p>Thanks for being an AcreOS customer!</p>
        <p>— The AcreOS Team</p>
      `,
      text: `Hi ${org.name},\n\nGreat news — your payment of ${amountDue} was processed successfully. Your account is fully active.\n\nGo to your dashboard: ${APP_URL}\n\n— The AcreOS Team`,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: resolve billing email for an organization
// ---------------------------------------------------------------------------

async function getOrgBillingEmail(org: Organization): Promise<string | null> {
  // Try org settings.companyEmail first
  const settings = org.settings as Record<string, unknown> | null;
  if (settings?.companyEmail && typeof settings.companyEmail === "string") {
    return settings.companyEmail;
  }

  // Fall back to owner's email from users table
  try {
    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.clerkUserId, org.ownerId))
      .limit(1);
    return owner?.email ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DunningService
// ---------------------------------------------------------------------------

class DunningService {
  private readonly HIGH_VALUE_THRESHOLD_CENTS = 10000; // $100+ = high value customer

  // -------------------------------------------------------------------
  // Core handlers (existing, enhanced with email dispatch)
  // -------------------------------------------------------------------

  async handlePaymentFailed(
    organizationId: number,
    stripeInvoiceId: string,
    stripeSubscriptionId: string,
    amountDueCents: number,
    attemptNumber: number
  ): Promise<void> {
    try {
      logger.info(`[Dunning] Handling payment failure for org ${organizationId}, invoice ${stripeInvoiceId}, attempt ${attemptNumber}`);

      const org = await storage.getOrganization(organizationId);
      if (!org) {
        logger.error(`[Dunning] Organization ${organizationId} not found`);
        return;
      }

      const now = new Date();
      const isFirstFailure = !org.dunningStartedAt;
      const dunningStartDate = isFirstFailure ? now : new Date(org.dunningStartedAt!);
      const daysSinceFailure = Math.floor((now.getTime() - dunningStartDate.getTime()) / (1000 * 60 * 60 * 24));

      const newStage = this.calculateDunningStage(daysSinceFailure);
      const nextRetryAt = this.calculateNextRetryDate(attemptNumber);

      const notificationToSend = this.getScheduledNotification(daysSinceFailure);

      const dunningEvent: InsertDunningEvent = {
        organizationId,
        stripeSubscriptionId,
        stripeInvoiceId,
        stripeCustomerId: org.stripeCustomerId || undefined,
        eventType: "payment_failed",
        attemptNumber,
        amountDueCents,
        status: nextRetryAt ? "scheduled_retry" : "pending",
        dunningStage: newStage,
        nextRetryAt,
        retryCount: attemptNumber - 1,
        maxRetries: DUNNING_CONFIG.retryScheduleDays.length,
        notificationsSent: notificationToSend ? [{
          type: notificationToSend.type,
          sentAt: now.toISOString(),
          channel: notificationToSend.channel,
        }] : [],
        metadata: {
          daysSinceFailure,
          previousStage: org.dunningStage || "none",
        },
      };

      await storage.createDunningEvent(dunningEvent);

      const orgUpdates: Partial<Organization> = {
        dunningStage: newStage,
        lastPaymentFailedAt: now,
      };

      if (isFirstFailure) {
        orgUpdates.dunningStartedAt = now;
      }

      await storage.updateOrganization(organizationId, orgUpdates);

      // Actually send the notification email
      if (notificationToSend) {
        await this.sendDunningEmail(org, notificationToSend.type, amountDueCents);
      }

      if (amountDueCents >= this.HIGH_VALUE_THRESHOLD_CENTS) {
        await this.createRevenueAtRiskAlert(
          organizationId,
          amountDueCents,
          `Payment failed (attempt ${attemptNumber}) - ${newStage} stage`
        );
      }

      logger.info(`[Dunning] Updated org ${organizationId} to stage: ${newStage}, next retry: ${nextRetryAt?.toISOString() || 'none'}`);
      logActivity({
        orgId: organizationId,
        job: "dunning",
        action: "dunning_stage_advanced",
        summary: `Payment failure (attempt ${attemptNumber}): org advanced to dunning stage "${newStage}"`,
        metadata: { newStage, amountDueCents, attemptNumber },
      }).catch(() => {});
    } catch (error) {
      logger.error(`[Dunning] Error handling payment failure for org ${organizationId}`, error);
      throw error;
    }
  }

  async handlePaymentSucceeded(
    organizationId: number,
    stripeInvoiceId: string,
    amountPaidCents: number
  ): Promise<void> {
    try {
      logger.info(`[Dunning] Handling payment success for org ${organizationId}, invoice ${stripeInvoiceId}`);

      const org = await storage.getOrganization(organizationId);
      if (!org) {
        logger.error(`[Dunning] Organization ${organizationId} not found`);
        return;
      }

      if (org.dunningStage === "none" || !org.dunningStage) {
        logger.info(`[Dunning] Org ${organizationId} not in dunning, skipping resolution`);
        return;
      }

      await storage.resolveDunningEvents(organizationId, stripeInvoiceId, "auto_recovered");

      await storage.updateOrganization(organizationId, {
        dunningStage: "none",
        dunningStartedAt: null,
        lastPaymentFailedAt: null,
      });

      const existingAlerts = await storage.getSystemAlerts(organizationId, "new");
      for (const alert of existingAlerts) {
        if (alert.alertType === "revenue_at_risk") {
          await storage.updateSystemAlert(alert.id, {
            status: "resolved",
            resolvedAt: new Date(),
          });
        }
      }

      // Send recovery success email
      await this.sendDunningEmail(org, "recovery_success", amountPaidCents);

      logger.info(`[Dunning] Resolved dunning for org ${organizationId}, payment of ${amountPaidCents} cents received`);
      logActivity({
        orgId: organizationId,
        job: "dunning",
        action: "payment_recovered",
        summary: `Payment recovered: dunning cleared for org after receiving ${(amountPaidCents / 100).toFixed(2)} payment`,
        metadata: { amountPaidCents, stripeInvoiceId },
      }).catch(() => {});
    } catch (error) {
      logger.error(`[Dunning] Error handling payment success for org ${organizationId}`, error);
      throw error;
    }
  }

  async handlePaymentRecovered(organizationId: number): Promise<void> {
    try {
      const org = await storage.getOrganization(organizationId);
      if (!org || !org.dunningStage || org.dunningStage === "none") return;

      logger.info(`[Dunning] Payment recovered for org ${organizationId} — clearing dunning stage`);
      await storage.updateOrganization(organizationId, {
        dunningStage: "none",
        dunningStartedAt: null,
        subscriptionStatus: "active",
      } as any);

      try {
        await logActivity({
          organizationId,
          type: "dunning_recovered",
          description: "Payment recovered — dunning stage cleared",
          metadata: { previousStage: org.dunningStage },
        } as any);
      } catch {}
    } catch (err: any) {
      logger.error(`[Dunning] handlePaymentRecovered error for org ${organizationId}`, err);
    }
  }

  // -------------------------------------------------------------------
  // Email dispatch
  // -------------------------------------------------------------------

  private async sendDunningEmail(
    org: Organization,
    templateType: string,
    amountCents: number
  ): Promise<void> {
    try {
      const recipientEmail = await getOrgBillingEmail(org);
      if (!recipientEmail) {
        logger.warn(`[Dunning] No billing email found for org ${org.id}, skipping ${templateType} email`);
        return;
      }

      const amountDue = `$${(amountCents / 100).toFixed(2)}`;
      // W-sweep 2026-07-04: settings tabs are HASH-routed — ?tab=billing was
      // silently ignored and dumped a failing payer on the Account tab. The
      // #billing hash also auto-opens the plan/payment panel.
      const updatePaymentUrl = `${APP_URL}/settings#billing`;
      const templates = dunningEmailTemplates(org, amountDue, updatePaymentUrl);
      const template = templates[templateType as keyof typeof templates];
      if (!template) {
        logger.warn(`[Dunning] Unknown email template type: ${templateType}`);
        return;
      }

      const { emailService } = await import("./emailService");
      await emailService.sendEmail({
        to: recipientEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        transactional: true, // billing/payment-failure notice — not commercial
      });

      logger.info(`[Dunning] Sent ${templateType} email to ${recipientEmail} for org ${org.id}`);
    } catch (error) {
      logger.error(`[Dunning] Failed to send ${templateType} email for org ${org.id}`, error);
    }
  }

  // -------------------------------------------------------------------
  // SMS dispatch (Phase 3 Week 10 — Part B)
  // -------------------------------------------------------------------
  //
  // Sends one SMS per dunning sequence on day-3 (the last grace-period day)
  // when:
  //   1. The org has a phone on file (settings.companyPhone or owner phone).
  //   2. The org has not opted out of SMS dunning in /settings/notifications
  //      (notification-prefs key: "billing.dunning_sms").
  //   3. dunning_events.sms_sent_at is null (one-SMS-per-sequence throttle).
  //
  // Returns true on dispatch, false on opt-out/throttle/missing-phone so the
  // caller knows whether to record the notification.
  private async sendDunningSMS(
    org: Organization,
    dunningEventId: number,
    amountCents: number,
  ): Promise<boolean> {
    try {
      // Throttle: at most one SMS per dunning sequence.
      const [event] = await db
        .select({ smsSentAt: dunningEvents.smsSentAt })
        .from(dunningEvents)
        .where(eq(dunningEvents.id, dunningEventId))
        .limit(1);
      if (event?.smsSentAt) {
        logger.info(`[Dunning] SMS already sent for event ${dunningEventId}, skipping`, {
          metadata: { orgId: org.id, dunningEventId },
        });
        return false;
      }

      // Per-org opt-out: respect notification-prefs override on the owner's
      // user record. If the owner has set billing.dunning_sms → sms = false,
      // we never dispatch. Defaults from the schema (sms: true on this event)
      // apply otherwise.
      const optedOut = await this.isDunningSMSOptedOut(org);
      if (optedOut) {
        logger.info(`[Dunning] Org ${org.id} has opted out of SMS dunning`);
        return false;
      }

      // Resolve phone — org settings first, then fall back to org.taxAddress.phone.
      const phone = this.resolveOrgPhone(org);
      if (!phone) {
        logger.info(`[Dunning] No phone on file for org ${org.id}, skipping SMS`);
        return false;
      }

      const amountDue = `$${(amountCents / 100).toFixed(2)}`;
      const message =
        `Hi ${org.name}, AcreOS — your card was declined for ${amountDue}. ` +
        `Update at acreos.io/settings#billing to keep service running.`;

      const { smsService } = await import("./smsService");
      const result = await smsService.sendSMS({ to: phone, message });

      if (!result.success) {
        logger.warn(`[Dunning] SMS dispatch failed for org ${org.id}`, {
          metadata: { error: result.error },
        });
        return false;
      }

      // Record the dispatch — sets the throttle.
      await db
        .update(dunningEvents)
        .set({ smsSentAt: new Date() })
        .where(eq(dunningEvents.id, dunningEventId));

      logger.info(`[Dunning] Sent dunning SMS to ${phone} for org ${org.id}`, {
        metadata: { messageId: result.messageId, dunningEventId },
      });
      return true;
    } catch (error) {
      logger.error(`[Dunning] sendDunningSMS error for org ${org.id}`, error);
      return false;
    }
  }

  /**
   * True when the org's owner has set billing.dunning_sms → sms = false in
   * /settings/notifications. The schema-level default for this event is
   * sms: true, so the absence of an override means SMS is enabled.
   */
  private async isDunningSMSOptedOut(org: Organization): Promise<boolean> {
    try {
      const { notificationPrefsService } = await import("./notificationPreferences");
      const allowed = await notificationPrefsService.shouldNotify(
        org.ownerId,
        org.id,
        "billing.dunning_sms",
        "sms",
      );
      return !allowed;
    } catch (err) {
      // If prefs lookup fails, default to sending (SMS is opt-out, not opt-in)
      // — the customer's card just got declined, the message is high-value.
      logger.warn(`[Dunning] Could not load notification prefs for org ${org.id}, defaulting to send`, {
        metadata: { error: (err as Error).message },
      });
      return false;
    }
  }

  /**
   * Resolves a phone number for the org. Order:
   *   1. settings.companyPhone (admin-configured org-level phone)
   *   2. taxAddress.phone (captured in the 1099 onboarding step)
   * Returns null when neither is set or both are blank.
   */
  private resolveOrgPhone(org: Organization): string | null {
    const settings = org.settings as Record<string, unknown> | null;
    const companyPhone = settings?.companyPhone;
    if (typeof companyPhone === "string" && companyPhone.trim().length > 0) {
      return companyPhone.trim();
    }
    const taxAddress = org.taxAddress as { phone?: string } | null;
    if (taxAddress?.phone && taxAddress.phone.trim().length > 0) {
      return taxAddress.phone.trim();
    }
    return null;
  }

  // -------------------------------------------------------------------
  // Stage calculations
  // -------------------------------------------------------------------

  calculateDunningStage(daysSinceFailure: number): DunningStage {
    if (daysSinceFailure <= DUNNING_CONFIG.gracePeriodDays) return "grace_period";
    if (daysSinceFailure <= DUNNING_CONFIG.warningPeriodDays) return "warning";
    if (daysSinceFailure <= DUNNING_CONFIG.restrictedPeriodDays) return "restricted";
    if (daysSinceFailure <= DUNNING_CONFIG.finalCancellationDays) return "suspended";
    return "cancelled";
  }

  hasRestrictedAccess(dunningStage: DunningStage): boolean {
    const stageInfo = DUNNING_STAGES[dunningStage];
    return stageInfo.accessLevel !== "full";
  }

  async getActiveDunningOrgs(): Promise<Organization[]> {
    try {
      return await storage.getOrganizationsInDunning();
    } catch (error) {
      logger.error("[Dunning] Error fetching organizations in dunning", error);
      return [];
    }
  }

  // -------------------------------------------------------------------
  // D1 (founder decision 2026-07-11): unattended auto-retry ladder.
  //
  // The sweeper itself attempts payment of the outstanding invoice on
  // days 1/3/7 after the initial failure (DUNNING_CONFIG.autoRetryScheduleDays)
  // — previously retries only happened when a human clicked "retry" in the
  // dunning panel. Rules:
  //   - Skips entirely (one log line) while Stripe is unconfigured, so the
  //     ladder isn't burned before keys exist; goes live with the keys.
  //   - One attempt per ladder day, tracked in the event's
  //     notificationsSent array (type "auto_retry_d<N>", channel "stripe")
  //     so a 6-hourly sweep can't double-fire a day.
  //   - Every attempt — success or failure — is Letter/Story-visible via
  //     logActivity(job: "dunning").
  //   - Success resolves the event (resolutionType "auto_recovered") and
  //     clears the org's dunning state, same as the webhook path.
  // -------------------------------------------------------------------

  async processAutoRetries(now: Date = new Date()): Promise<void> {
    let stripe: any;
    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      stripe = await getUncachableStripeClient();
    } catch {
      logger.info("[Dunning] Auto-retry ladder idle — Stripe not configured yet (D1 goes live with keys)");
      return;
    }

    const orgsInDunning = await this.getActiveDunningOrgs();
    for (const org of orgsInDunning) {
      try {
        if (!org.dunningStartedAt) continue;
        const daysSinceFailure = Math.floor(
          (now.getTime() - new Date(org.dunningStartedAt).getTime()) / (1000 * 60 * 60 * 24),
        );

        const allEvents = await storage.getDunningEvents(org.id);
        const latestEvent = allEvents.filter(
          (e) => (e.status === "pending" || e.status === "scheduled_retry") && e.stripeInvoiceId,
        )[0];
        if (!latestEvent) continue;

        const sent = latestEvent.notificationsSent || [];
        const attemptedDays = new Set(
          sent
            .filter((n: any) => typeof n.type === "string" && n.type.startsWith("auto_retry_d"))
            .map((n: any) => Number(n.type.slice("auto_retry_d".length))),
        );
        const dueDay = DUNNING_CONFIG.autoRetryScheduleDays.find(
          (d) => daysSinceFailure >= d && !attemptedDays.has(d),
        );
        if (dueDay === undefined) continue;

        const attemptMarker = {
          type: `auto_retry_d${dueDay}`,
          sentAt: now.toISOString(),
          channel: "stripe",
        };

        try {
          await stripe.invoices.pay(latestEvent.stripeInvoiceId!);

          await storage.updateDunningEvent(latestEvent.id, {
            status: "resolved",
            resolvedAt: now,
            resolutionType: "auto_recovered",
            retryCount: (latestEvent.retryCount ?? 0) + 1,
            notificationsSent: [...sent, attemptMarker],
          } as any);
          await storage.updateOrganization(org.id, {
            dunningStage: "none",
            dunningStartedAt: null,
            lastPaymentFailedAt: null,
          });

          logger.info(`[Dunning] Auto-retry day ${dueDay} SUCCEEDED for org ${org.id} (invoice ${latestEvent.stripeInvoiceId})`);
          logActivity({
            orgId: org.id,
            job: "dunning",
            action: "auto_retry_succeeded",
            summary: `Dunning auto-retry (day ${dueDay}) recovered the outstanding invoice`,
            metadata: { day: dueDay, invoiceId: latestEvent.stripeInvoiceId, eventId: latestEvent.id },
          }).catch(() => {});
        } catch (payErr: any) {
          const reason = (payErr?.message || String(payErr)).slice(0, 200);
          await storage.updateDunningEvent(latestEvent.id, {
            retryCount: (latestEvent.retryCount ?? 0) + 1,
            notificationsSent: [...sent, attemptMarker],
          } as any);

          logger.warn(`[Dunning] Auto-retry day ${dueDay} failed for org ${org.id}: ${reason}`);
          logActivity({
            orgId: org.id,
            job: "dunning",
            action: "auto_retry_failed",
            summary: `Dunning auto-retry (day ${dueDay}) failed — ${reason}`,
            metadata: { day: dueDay, invoiceId: latestEvent.stripeInvoiceId, eventId: latestEvent.id, reason },
          }).catch(() => {});
        }
      } catch (orgErr) {
        logger.error(`[Dunning] Auto-retry processing error for org ${org.id}`, undefined, { metadata: { detail: orgErr } });
      }
    }
  }

  // -------------------------------------------------------------------
  // Scheduled task processor (wired into server startup interval)
  // -------------------------------------------------------------------

  async processScheduledTasks(): Promise<void> {
    try {
      logger.info("[Dunning] Processing scheduled dunning tasks...");

      // D1: attempt the unattended retry ladder first, so a recovered org
      // drops out of dunning before this cycle sends it another notice.
      await this.processAutoRetries().catch((err) =>
        logger.error("[Dunning] Auto-retry pass failed (continuing with notifications)", err),
      );

      const orgsInDunning = await this.getActiveDunningOrgs();
      const now = new Date();

      for (const org of orgsInDunning) {
        try {
          if (!org.dunningStartedAt) continue;

          const dunningStartDate = new Date(org.dunningStartedAt);
          const daysSinceFailure = Math.floor((now.getTime() - dunningStartDate.getTime()) / (1000 * 60 * 60 * 24));
          const expectedStage = this.calculateDunningStage(daysSinceFailure);

          if (expectedStage !== org.dunningStage) {
            logger.info(`[Dunning] Advancing org ${org.id} from ${org.dunningStage} to ${expectedStage}`);

            await storage.updateOrganization(org.id, {
              dunningStage: expectedStage,
            });

            // Auto-downgrade to free tier when reaching suspended or cancelled
            if (expectedStage === "suspended" || expectedStage === "cancelled") {
              logger.info(`[Dunning] Auto-downgrading org ${org.id} to free tier (stage: ${expectedStage})`);
              await storage.updateOrganization(org.id, {
                subscriptionTier: "free",
                subscriptionStatus: expectedStage === "cancelled" ? "cancelled" : "suspended",
              });

              await this.createRevenueAtRiskAlert(
                org.id,
                0,
                expectedStage === "cancelled"
                  ? "Subscription cancelled due to non-payment after dunning period"
                  : "Account suspended due to non-payment — downgraded to free tier"
              );

              logActivity({
                orgId: org.id,
                job: "dunning",
                action: "account_downgraded",
                summary: `Account auto-downgraded to free tier (dunning stage: ${expectedStage})`,
                metadata: { stage: expectedStage, previousTier: org.subscriptionTier },
              }).catch(() => {});
            }
          }

          // Send scheduled notifications (email + SMS legs).
          //
          // The schedule entry's `channel` selects the dispatcher:
          //   - "email" → sendDunningEmail
          //   - "sms"   → sendDunningSMS (Phase 3 W10), guarded by per-org
          //               opt-out and a one-SMS-per-sequence throttle so a
          //               flapping sequence can't spam the customer.
          const notification = this.getScheduledNotification(daysSinceFailure);
          if (notification) {
            // Roadmap W1.1 (2026-07 audit): the reminder ladder was DEAD for
            // exactly the recoverable accounts. handlePaymentFailure() parks
            // events at "scheduled_retry" whenever Stripe set a next retry
            // (the normal case), but this selector only fetched "pending" —
            // so latestEvent was undefined and the day-3/7/14 reminder →
            // warning → final-notice emails never sent. Select the latest
            // OPEN event (pending OR scheduled_retry), mirroring
            // getActiveCases' definition of open.
            const allEvents = await storage.getDunningEvents(org.id);
            const openEvents = allEvents.filter(
              (e) => e.status === "pending" || e.status === "scheduled_retry",
            );
            const latestEvent = openEvents[0];

            if (latestEvent) {
              const sentNotifications = latestEvent.notificationsSent || [];
              const alreadySent = sentNotifications.some((n: any) => n.type === notification.type);

              if (!alreadySent) {
                let dispatched = false;

                if (notification.channel === "sms") {
                  dispatched = await this.sendDunningSMS(
                    org,
                    latestEvent.id,
                    latestEvent.amountDueCents || 0,
                  );
                } else {
                  logger.info(`[Dunning] Sending ${notification.type} notification for org ${org.id}`);
                  await this.sendDunningEmail(org, notification.type, latestEvent.amountDueCents || 0);
                  dispatched = true;
                }

                if (dispatched) {
                  await storage.updateDunningEvent(latestEvent.id, {
                    notificationsSent: [
                      ...sentNotifications,
                      {
                        type: notification.type,
                        sentAt: now.toISOString(),
                        channel: notification.channel,
                      }
                    ],
                  });
                }
              }
            }
          }
        } catch (orgError) {
          logger.error(`[Dunning] Error processing org ${org.id}`, undefined, { metadata: { detail: orgError } });
        }
      }

      logger.info(`[Dunning] Processed ${orgsInDunning.length} organizations`);
    } catch (error) {
      logger.error("[Dunning] Error processing scheduled tasks", error);
      throw error;
    }
  }

  // -------------------------------------------------------------------
  // API methods (used by routes-dunning.ts)
  // -------------------------------------------------------------------

  async getSummary(): Promise<{
    totalActive: number;
    byStage: Record<string, number>;
    totalAmountAtRiskCents: number;
    recoveredLast30Days: number;
  }> {
    const orgs = await this.getActiveDunningOrgs();
    const byStage: Record<string, number> = {};
    for (const org of orgs) {
      const stage = org.dunningStage || "none";
      byStage[stage] = (byStage[stage] || 0) + 1;
    }

    // Sum amount at risk from active dunning events
    let totalAmountAtRiskCents = 0;
    for (const org of orgs) {
      const events = await storage.getDunningEvents(org.id);
      const pending = events.filter(e => e.status === "pending" || e.status === "scheduled_retry");
      for (const ev of pending) {
        totalAmountAtRiskCents += ev.amountDueCents || 0;
      }
    }

    // Count recovered in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [recoveredResult] = await db
      .select({ count: count() })
      .from(dunningEvents)
      .where(and(
        eq(dunningEvents.resolutionType, "auto_recovered"),
        sql`${dunningEvents.resolvedAt} >= ${thirtyDaysAgo}`
      ));
    const recoveredLast30Days = Number(recoveredResult?.count ?? 0);

    return {
      totalActive: orgs.length,
      byStage,
      totalAmountAtRiskCents,
      recoveredLast30Days,
    };
  }

  async getActiveCases(statusFilter?: string): Promise<DunningEvent[]> {
    if (statusFilter) {
      return await db
        .select()
        .from(dunningEvents)
        .where(eq(dunningEvents.status, statusFilter))
        .orderBy(desc(dunningEvents.createdAt))
        .limit(100);
    }
    return await db
      .select()
      .from(dunningEvents)
      .where(or(
        eq(dunningEvents.status, "pending"),
        eq(dunningEvents.status, "scheduled_retry")
      ))
      .orderBy(desc(dunningEvents.createdAt))
      .limit(100);
  }

  async retryPayment(eventId: number): Promise<{ success: boolean; message: string }> {
    const [event] = await db
      .select()
      .from(dunningEvents)
      .where(eq(dunningEvents.id, eventId))
      .limit(1);

    if (!event) {
      return { success: false, message: "Dunning event not found" };
    }

    if (!event.stripeInvoiceId) {
      return { success: false, message: "No Stripe invoice associated with this event" };
    }

    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      await stripe.invoices.pay(event.stripeInvoiceId);

      await storage.updateDunningEvent(eventId, {
        status: "resolved",
        resolvedAt: new Date(),
        resolutionType: "manual_payment",
      } as any);

      if (event.organizationId) {
        await storage.updateOrganization(event.organizationId, {
          dunningStage: "none",
          dunningStartedAt: null,
          lastPaymentFailedAt: null,
        });
      }

      return { success: true, message: "Payment retry successful" };
    } catch (err: any) {
      logger.error(`[Dunning] Manual retry failed for event ${eventId}`, err);
      return { success: false, message: err.message || "Payment retry failed" };
    }
  }

  async cancelCase(eventId: number): Promise<{ success: boolean; message: string }> {
    const [event] = await db
      .select()
      .from(dunningEvents)
      .where(eq(dunningEvents.id, eventId))
      .limit(1);

    if (!event) {
      return { success: false, message: "Dunning event not found" };
    }

    await storage.updateDunningEvent(eventId, {
      status: "resolved",
      resolvedAt: new Date(),
      resolutionType: "subscription_cancelled",
    } as any);

    if (event.organizationId) {
      await storage.updateOrganization(event.organizationId, {
        dunningStage: "none",
        dunningStartedAt: null,
        lastPaymentFailedAt: null,
      });
    }

    return { success: true, message: "Dunning case cancelled" };
  }

  async resolveCase(eventId: number, notes?: string): Promise<{ success: boolean; message: string }> {
    const [event] = await db
      .select()
      .from(dunningEvents)
      .where(eq(dunningEvents.id, eventId))
      .limit(1);

    if (!event) {
      return { success: false, message: "Dunning event not found" };
    }

    await storage.updateDunningEvent(eventId, {
      status: "resolved",
      resolvedAt: new Date(),
      resolutionType: "escalated",
      metadata: { ...(event.metadata as Record<string, unknown> || {}), resolutionNotes: notes },
    } as any);

    if (event.organizationId) {
      await storage.updateOrganization(event.organizationId, {
        dunningStage: "none",
        dunningStartedAt: null,
        lastPaymentFailedAt: null,
      });
    }

    return { success: true, message: "Dunning case resolved manually" };
  }

  async getHistory(limit: number = 50): Promise<DunningEvent[]> {
    return await db
      .select()
      .from(dunningEvents)
      .where(or(
        eq(dunningEvents.status, "resolved"),
        eq(dunningEvents.status, "failed_final")
      ))
      .orderBy(desc(dunningEvents.resolvedAt))
      .limit(limit);
  }

  // -------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------

  async createRevenueAtRiskAlert(
    organizationId: number,
    amountAtRisk: number,
    reason: string
  ): Promise<void> {
    try {
      let severity: "info" | "warning" | "critical" = "info";
      if (amountAtRisk >= 50000) {
        severity = "critical";
      } else if (amountAtRisk >= 10000) {
        severity = "warning";
      }

      const formattedAmount = (amountAtRisk / 100).toFixed(2);

      const alert: InsertSystemAlert = {
        type: "revenue_at_risk",
        severity,
        title: `Revenue at Risk: $${formattedAmount}`,
        message: reason,
        organizationId,
        relatedEntityType: "organization",
        relatedEntityId: organizationId,
        status: "new",
        autoResolvable: true,
        autoResolveAction: "payment_received",
        metadata: {
          amountAtRiskCents: amountAtRisk,
          createdAt: new Date().toISOString(),
        },
      };

      await storage.createSystemAlert(alert);
      logger.info(`[Dunning] Created revenue at risk alert for org ${organizationId}: $${formattedAmount}`);
    } catch (error) {
      logger.error(`[Dunning] Error creating revenue at risk alert for org ${organizationId}`, error);
    }
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private calculateNextRetryDate(attemptNumber: number): Date | null {
    const retryIndex = attemptNumber - 1;
    if (retryIndex >= DUNNING_CONFIG.retryScheduleDays.length) {
      return null;
    }

    const daysUntilRetry = DUNNING_CONFIG.retryScheduleDays[retryIndex];
    const nextRetry = new Date();
    nextRetry.setDate(nextRetry.getDate() + daysUntilRetry);
    return nextRetry;
  }

  private getScheduledNotification(daysSinceFailure: number): { type: string; channel: string } | null {
    for (const notification of DUNNING_CONFIG.notificationSchedule) {
      if (daysSinceFailure === notification.dayOffset) {
        return {
          type: notification.type,
          channel: notification.channel,
        };
      }
    }
    return null;
  }
}

export const dunningService = new DunningService();

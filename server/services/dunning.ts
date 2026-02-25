import { storage } from "../storage";
import { 
  DUNNING_CONFIG, 
  DUNNING_STAGES, 
  type DunningStage, 
  type InsertDunningEvent, 
  type InsertSystemAlert,
  type Organization
} from "@shared/schema";

class DunningService {
  private readonly HIGH_VALUE_THRESHOLD_CENTS = 10000; // $100+ = high value customer

  async handlePaymentFailed(
    organizationId: number,
    stripeInvoiceId: string,
    stripeSubscriptionId: string,
    amountDueCents: number,
    attemptNumber: number
  ): Promise<void> {
    try {
      console.log(`[Dunning] Handling payment failure for org ${organizationId}, invoice ${stripeInvoiceId}, attempt ${attemptNumber}`);

      const org = await storage.getOrganization(organizationId);
      if (!org) {
        console.error(`[Dunning] Organization ${organizationId} not found`);
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

      if (notificationToSend) {
        console.log(`[Dunning] Scheduled ${notificationToSend.type} notification for org ${organizationId}`);
      }

      if (amountDueCents >= this.HIGH_VALUE_THRESHOLD_CENTS) {
        await this.createRevenueAtRiskAlert(
          organizationId,
          amountDueCents,
          `Payment failed (attempt ${attemptNumber}) - ${newStage} stage`
        );
      }

      console.log(`[Dunning] Updated org ${organizationId} to stage: ${newStage}, next retry: ${nextRetryAt?.toISOString() || 'none'}`);
    } catch (error) {
      console.error(`[Dunning] Error handling payment failure for org ${organizationId}:`, error);
      throw error;
    }
  }

  async handlePaymentSucceeded(
    organizationId: number,
    stripeInvoiceId: string,
    amountPaidCents: number
  ): Promise<void> {
    try {
      console.log(`[Dunning] Handling payment success for org ${organizationId}, invoice ${stripeInvoiceId}`);

      const org = await storage.getOrganization(organizationId);
      if (!org) {
        console.error(`[Dunning] Organization ${organizationId} not found`);
        return;
      }

      if (org.dunningStage === "none" || !org.dunningStage) {
        console.log(`[Dunning] Org ${organizationId} not in dunning, skipping resolution`);
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

      console.log(`[Dunning] Resolved dunning for org ${organizationId}, payment of ${amountPaidCents} cents received`);
    } catch (error) {
      console.error(`[Dunning] Error handling payment success for org ${organizationId}:`, error);
      throw error;
    }
  }

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
      console.error("[Dunning] Error fetching organizations in dunning:", error);
      return [];
    }
  }

  async processScheduledTasks(): Promise<void> {
    try {
      console.log("[Dunning] Processing scheduled dunning tasks...");
      
      const orgsInDunning = await this.getActiveDunningOrgs();
      const now = new Date();

      for (const org of orgsInDunning) {
        try {
          if (!org.dunningStartedAt) continue;

          const dunningStartDate = new Date(org.dunningStartedAt);
          const daysSinceFailure = Math.floor((now.getTime() - dunningStartDate.getTime()) / (1000 * 60 * 60 * 24));
          const expectedStage = this.calculateDunningStage(daysSinceFailure);

          if (expectedStage !== org.dunningStage) {
            console.log(`[Dunning] Advancing org ${org.id} from ${org.dunningStage} to ${expectedStage}`);
            
            await storage.updateOrganization(org.id, {
              dunningStage: expectedStage,
            });

            if (expectedStage === "cancelled") {
              console.log(`[Dunning] Org ${org.id} reached cancellation stage - subscription should be cancelled`);
              
              await this.createRevenueAtRiskAlert(
                org.id,
                0, // Amount unknown at this point
                "Subscription cancelled due to non-payment after dunning period"
              );
            }
          }

          const notification = this.getScheduledNotification(daysSinceFailure);
          if (notification) {
            const recentEvents = await storage.getDunningEvents(org.id, "pending");
            const latestEvent = recentEvents[0];
            
            if (latestEvent) {
              const sentNotifications = latestEvent.notificationsSent || [];
              const alreadySent = sentNotifications.some(n => n.type === notification.type);
              
              if (!alreadySent) {
                console.log(`[Dunning] Sending ${notification.type} notification for org ${org.id}`);
                
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
        } catch (orgError) {
          console.error(`[Dunning] Error processing org ${org.id}:`, orgError);
        }
      }

      console.log(`[Dunning] Processed ${orgsInDunning.length} organizations`);
    } catch (error) {
      console.error("[Dunning] Error processing scheduled tasks:", error);
      throw error;
    }
  }

  async createRevenueAtRiskAlert(
    organizationId: number,
    amountAtRisk: number,
    reason: string
  ): Promise<void> {
    try {
      let severity: "info" | "warning" | "critical" = "info";
      if (amountAtRisk >= 50000) { // $500+
        severity = "critical";
      } else if (amountAtRisk >= 10000) { // $100+
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
      console.log(`[Dunning] Created revenue at risk alert for org ${organizationId}: $${formattedAmount}`);
    } catch (error) {
      console.error(`[Dunning] Error creating revenue at risk alert for org ${organizationId}:`, error);
    }
  }

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

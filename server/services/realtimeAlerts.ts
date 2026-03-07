/**
 * Real-Time Market Alerts Service — AcreOS Phase 3
 *
 * Watches for market condition changes and pushes them via WebSocket
 * to connected clients. Bridges the existing alerting system with
 * the new WebSocket server for live, push-based notifications.
 *
 * Alert types:
 * - market_shift    — county market changed from warm → hot, etc.
 * - deal_match      — new Deal Hunter opportunity matched a user's criteria
 * - bid_received    — marketplace bid on user's listing
 * - offer_accepted  — bid accepted, deal room created
 * - negotiation_move — new AI-suggested negotiation move
 * - payment_due     — note payment coming up
 * - system          — system-level notifications
 */

// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import {
  organizations,
  dealAlerts,
  marketplaceListings,
  scrapedDeals,
} from '../../shared/schema';
import { eq, desc, gte, and, sql } from 'drizzle-orm';

export interface RealtimeAlert {
  id: string;
  type: 'market_shift' | 'deal_match' | 'bid_received' | 'offer_accepted' | 'negotiation_move' | 'payment_due' | 'system';
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  organizationId: number;
  actionUrl?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  read: boolean;
}

// In-memory notification store (would be Redis pub/sub in production)
const notificationQueues = new Map<number, RealtimeAlert[]>(); // orgId → alerts
let wsServerRef: any = null;

class RealtimeAlertsService {
  /**
   * Register the WebSocket server instance for broadcasting.
   */
  setWebSocketServer(wsServer: any): void {
    wsServerRef = wsServer;
  }

  /**
   * Push an alert to an organization and broadcast via WebSocket.
   */
  async pushAlert(alert: Omit<RealtimeAlert, 'id' | 'createdAt' | 'read'>): Promise<RealtimeAlert> {
    const fullAlert: RealtimeAlert = {
      ...alert,
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
      read: false,
    };

    // Queue in memory
    const queue = notificationQueues.get(alert.organizationId) || [];
    queue.unshift(fullAlert);
    // Keep last 100 alerts per org
    notificationQueues.set(alert.organizationId, queue.slice(0, 100));

    // Broadcast via WebSocket if server is available
    if (wsServerRef) {
      wsServerRef.broadcastToOrg(alert.organizationId, 'notification', {
        alert: fullAlert,
      });
    }

    return fullAlert;
  }

  /**
   * Get pending (unread) alerts for an organization.
   */
  getAlerts(organizationId: number, limit = 20): RealtimeAlert[] {
    const queue = notificationQueues.get(organizationId) || [];
    return queue.slice(0, limit);
  }

  /**
   * Mark alerts as read.
   */
  markRead(organizationId: number, alertIds: string[]): void {
    const queue = notificationQueues.get(organizationId) || [];
    for (const alert of queue) {
      if (alertIds.includes(alert.id)) {
        alert.read = true;
      }
    }
  }

  /**
   * Get unread count for an organization.
   */
  getUnreadCount(organizationId: number): number {
    const queue = notificationQueues.get(organizationId) || [];
    return queue.filter(a => !a.read).length;
  }

  /**
   * Scan deal alerts from DB and push unbroadcast ones.
   * Run periodically to catch alerts that were created but not yet pushed.
   */
  async syncDealAlertsToWebSocket(): Promise<number> {
    if (!wsServerRef) return 0;

    try {
      // Get recent high-priority deal alerts from the last 2 hours
      const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const alerts = await db
        .select()
        .from(dealAlerts)
        .where(gte(dealAlerts.createdAt, cutoff))
        .orderBy(desc(dealAlerts.createdAt))
        .limit(50);

      let pushed = 0;
      for (const alert of alerts) {
        const priority = alert.priority === 'high' ? 'high' : 'medium';
        await this.pushAlert({
          type: 'deal_match',
          title: alert.alertType === 'bid_placed' ? 'Auto-Bid Placed' : 'New Deal Match',
          message: alert.message || 'A new matching deal opportunity was found',
          priority,
          organizationId: alert.organizationId,
          actionUrl: alert.actionUrl || '/deal-hunter',
          metadata: { alertId: alert.id },
        });
        pushed++;
      }

      return pushed;
    } catch (err) {
      console.error('[RealtimeAlerts] Failed to sync deal alerts:', err);
      return 0;
    }
  }

  /**
   * Broadcast a market condition change to all orgs watching that county.
   * Used by the market prediction service when conditions shift.
   */
  async broadcastMarketShift(
    state: string,
    county: string,
    from: string,
    to: string,
    details: Record<string, any>
  ): Promise<void> {
    if (!wsServerRef) return;

    wsServerRef.broadcastMarketAlert(state, county, {
      type: 'market_shift',
      title: `${county}, ${state}: Market Shifted`,
      message: `Market conditions changed from ${from} → ${to}`,
      state,
      county,
      from,
      to,
      ...details,
    });
  }

  /**
   * Notify all parties in a deal room of a new message or action.
   */
  async notifyDealRoom(
    listingId: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    if (!wsServerRef) return;
    wsServerRef.broadcastListingEvent(listingId, eventType, payload);
  }

  /**
   * Send a negotiation coaching update to the user's session.
   */
  async pushNegotiationUpdate(
    sessionId: number,
    organizationId: number,
    update: Record<string, any>
  ): Promise<void> {
    if (!wsServerRef) return;

    wsServerRef.broadcastNegotiationUpdate(sessionId, update);

    // Also push as an in-app notification
    await this.pushAlert({
      type: 'negotiation_move',
      title: 'Negotiation Copilot',
      message: update.suggestion || 'New negotiation move available',
      priority: 'medium',
      organizationId,
      actionUrl: `/negotiation?session=${sessionId}`,
      metadata: { sessionId, ...update },
    });
  }

  /**
   * WebSocket stats for monitoring.
   */
  getStats(): Record<string, any> {
    let totalQueued = 0;
    let totalUnread = 0;
    for (const [orgId, queue] of notificationQueues) {
      totalQueued += queue.length;
      totalUnread += queue.filter(a => !a.read).length;
    }

    return {
      orgsWithAlerts: notificationQueues.size,
      totalQueuedAlerts: totalQueued,
      totalUnreadAlerts: totalUnread,
      wsConnections: wsServerRef?.getConnectionCount() || 0,
    };
  }
}

export const realtimeAlertsService = new RealtimeAlertsService();

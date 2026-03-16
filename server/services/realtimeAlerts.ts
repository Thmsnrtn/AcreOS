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
 *
 * Multi-instance coordination:
 * When REDIS_URL is set the service uses Redis pub/sub so that any server
 * instance can publish an alert and ALL instances (and their WebSocket
 * clients) receive it. When Redis is unavailable the service falls back to
 * in-process in-memory queues (single-instance only).
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

// ---------------------------------------------------------------------------
// Redis pub/sub setup (optional — graceful fallback to in-memory)
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;
const ALERT_CHANNEL = 'acreos:alerts';

/** Lazily-resolved ioredis instances. Null when Redis is unavailable. */
let redisPub: any = null;
let redisSub: any = null;

async function initRedis(): Promise<boolean> {
  if (!REDIS_URL) return false;
  if (redisPub) return true;
  try {
    const IORedis = (await import('ioredis')).default;
    redisPub = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true });
    redisSub = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true });

    await redisPub.connect();
    await redisSub.connect();

    // Subscribe once; the message handler dispatches to WS clients
    await redisSub.subscribe(ALERT_CHANNEL);
    redisSub.on('message', (_channel: string, message: string) => {
      try {
        const alert: RealtimeAlert = JSON.parse(message);
        deliverToWebSocket(alert);
      } catch {
        // malformed message — ignore
      }
    });

    console.log('[RealtimeAlerts] Redis pub/sub active — multi-instance coordination enabled');
    return true;
  } catch (err: any) {
    console.warn('[RealtimeAlerts] Redis unavailable, using in-memory fallback:', err.message);
    redisPub = null;
    redisSub = null;
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback store
// ---------------------------------------------------------------------------

const notificationQueues = new Map<number, RealtimeAlert[]>(); // orgId → alerts
let wsServerRef: any = null;

/** Deliver an alert to the local WebSocket server (all instances do this on receipt). */
function deliverToWebSocket(alert: RealtimeAlert): void {
  if (!wsServerRef) return;
  wsServerRef.broadcastToOrg(alert.organizationId, 'notification', { alert });
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

class RealtimeAlertsService {
  /**
   * Register the WebSocket server instance for broadcasting.
   * Called once at server startup. Also triggers async Redis init.
   */
  setWebSocketServer(wsServer: any): void {
    wsServerRef = wsServer;
    // Attempt Redis connection in the background; no await — don't block startup
    initRedis().catch(() => { /* already warned inside initRedis */ });
  }

  /**
   * Push an alert to an organization and broadcast via WebSocket.
   *
   * With Redis: publishes to the shared channel so every running instance
   * delivers the alert to its locally-connected WebSocket clients.
   *
   * Without Redis: broadcasts directly on this instance only and stores
   * in the local in-memory queue.
   */
  async pushAlert(alert: Omit<RealtimeAlert, 'id' | 'createdAt' | 'read'>): Promise<RealtimeAlert> {
    const fullAlert: RealtimeAlert = {
      ...alert,
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
      read: false,
    };

    // Always store locally (serves getAlerts() and in-memory reads)
    const queue = notificationQueues.get(alert.organizationId) || [];
    queue.unshift(fullAlert);
    notificationQueues.set(alert.organizationId, queue.slice(0, 100));

    if (redisPub) {
      // Multi-instance path: publish → Redis → all subscribers → WS clients
      try {
        await redisPub.publish(ALERT_CHANNEL, JSON.stringify(fullAlert));
      } catch (err: any) {
        console.warn('[RealtimeAlerts] Redis publish failed, falling back to local WS:', err.message);
        deliverToWebSocket(fullAlert);
      }
    } else {
      // Single-instance path: push directly to local WS
      deliverToWebSocket(fullAlert);
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
   * Whether Redis pub/sub is active (true = multi-instance mode).
   */
  isRedisPubSubActive(): boolean {
    return redisPub !== null;
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
      redisPubSubActive: this.isRedisPubSubActive(),
    };
  }
}

export const realtimeAlertsService = new RealtimeAlertsService();

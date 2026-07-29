/**
 * Notification Dispatcher — Phase D
 *
 * Routes events to the correct notification channel based on:
 * 1. Event type → channel mapping (defaults)
 * 2. Founder preferences (overrides defaults)
 *
 * Delivery honesty (Wave A, "Nothing lies"):
 * - Every notification is persisted to the `notifications` table (write-through)
 *   so the tray survives restarts/deploys — the in-memory array is only a cache.
 * - Channels without a real delivery rail (SMS / email / push — Wave C wires
 *   them) record `channel_unavailable`, NEVER `sent`. The in-app leg (WebSocket
 *   toast + persisted tray row) is the honest fallback that always carries the
 *   notification.
 */

import { wsServer } from "../websocket";
import { logger } from "../utils/logger";
import {
  arbitrateFounderInterrupt,
  recordDeferredInterrupt,
  type ArbiterDecision,
} from "./founderInterruptArbiter";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationEvent {
  eventType: string;
  channel: string;
  payload: Record<string, any>;
  priority: number;
  orgId?: number;
  timestamp?: Date | string;
}

interface ChannelConfig {
  defaultChannel: "in_app" | "email" | "sms" | "push";
  urgentChannel?: "sms" | "push";
  label: string;
  /**
   * Jarvis 2.2 — constitutional decision class of the FOUNDER-facing legs
   * (founder broadcast + SMS + email), mapped EXPLICITLY per event: events
   * with an urgentChannel (escalation / approval / conflict) are Class B;
   * everything else is Class C (never interrupts the founder). The org
   * broadcast is customer-facing and never arbitrated.
   */
  founderClass: "B" | "C";
}

/**
 * Honest per-channel delivery status (Wave A):
 * - `sent`                — the leg actually executed against a real rail
 * - `failed`              — the leg was attempted and errored
 * - `channel_unavailable` — no real delivery rail exists for this channel yet
 *                           (SMS/email/push until Wave C); nothing was sent
 * - `suppressed`          — the interrupt arbiter deliberately held the
 *                           founder-facing leg (deferral/suppression/failure)
 */
export type ChannelDeliveryStatus = "sent" | "failed" | "channel_unavailable" | "suppressed";

// ─── Event → Channel Mapping ─────────────────────────────────────────────────

const EVENT_CHANNEL_MAP: Record<string, ChannelConfig> = {
  "deal:discovered": { defaultChannel: "in_app", label: "New Deal Found", founderClass: "C" },
  "deal:closed": { defaultChannel: "email", label: "Deal Closed", founderClass: "C" },
  "agent:escalation": { defaultChannel: "in_app", urgentChannel: "sms", label: "Agent Escalation", founderClass: "B" },
  "agent:decision": { defaultChannel: "in_app", label: "Agent Decision", founderClass: "C" },
  "approval:requested": { defaultChannel: "in_app", urgentChannel: "sms", label: "Approval Needed", founderClass: "B" },
  "job:failed": { defaultChannel: "in_app", label: "Job Failed", founderClass: "C" },
  "revenue:milestone": { defaultChannel: "email", label: "Revenue Milestone", founderClass: "C" },
  "briefing:ready": { defaultChannel: "in_app", label: "Daily Briefing Ready", founderClass: "C" },
  "agent:conflict": { defaultChannel: "in_app", urgentChannel: "sms", label: "Agent Conflict", founderClass: "B" },
  "market:alert": { defaultChannel: "in_app", label: "Market Alert", founderClass: "C" },
};

// ─── Notification Storage (in-app history) ───────────────────────────────────

export interface StoredNotification {
  id: string;
  eventType: string;
  title: string;
  message: string;
  priority: number;
  channel: string;
  read: boolean;
  createdAt: string;
  payload: Record<string, any>;
  /** Honest per-leg delivery record (Wave A). */
  delivery: Record<string, ChannelDeliveryStatus>;
  /** True once the row is in the `notifications` table (survives restart). */
  persisted: boolean;
  /** DB row id in the `notifications` table, when persisted. */
  dbId?: number;
}

const MAX_NOTIFICATIONS = 200;
/** Tray reads older than this trigger a background DB reconcile. */
const REFRESH_INTERVAL_MS = 15_000;
/** Marker so hydration only pulls rows this dispatcher wrote. */
const METADATA_SOURCE = "notification_dispatcher";

// ─── Service ─────────────────────────────────────────────────────────────────

export class NotificationDispatcher {
  /**
   * Write-through cache over the `notifications` table. The DB row is the
   * source of truth (survives restart/deploy — module-state pin, audit
   * 2026-07-07, resolved Wave A); this array only serves the sync tray API.
   */
  private store: StoredNotification[] = [];
  private lastRefreshAt = 0;
  private recipient: { orgId: number; userId: string } | null = null;
  private readonly hydration: Promise<void>;

  constructor() {
    // Hydrate the tray cache from the DB so a restart loses nothing that was
    // persisted. Fail-open with a logged error: the tray degrades to
    // memory-only, it never blocks startup.
    this.hydration = this.refreshFromDb("hydrate");
  }

  /** Resolves when initial DB hydration has completed (success or logged failure). */
  whenReady(): Promise<void> {
    return this.hydration;
  }

  /**
   * Dispatch a notification event to the appropriate channels.
   */
  async dispatch(event: NotificationEvent): Promise<void> {
    const config = EVENT_CHANNEL_MAP[event.eventType];
    const channel = config?.defaultChannel ?? "in_app";
    const label = config?.label ?? event.eventType;
    const isUrgent = event.priority <= 2;

    // Build notification
    const notification: StoredNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      eventType: event.eventType,
      title: label,
      message: this.buildMessage(event),
      priority: event.priority,
      channel: event.channel,
      read: false,
      createdAt: new Date().toISOString(),
      payload: event.payload,
      delivery: {},
      persisted: false,
    };

    // Store in the tray cache (pull-based in-app leg — always available)
    this.store.unshift(notification);
    if (this.store.length > MAX_NOTIFICATIONS) {
      this.store.length = MAX_NOTIFICATIONS;
    }
    notification.delivery.in_app = "sent";

    // Jarvis 2.2 — the FOUNDER-facing legs (founder broadcast + SMS + email)
    // route through the interrupt arbiter. The org broadcast (customer-facing)
    // and the in-app history store (pull-based tray) are untouched. Fails
    // CLOSED-quiet: an arbiter failure suppresses the founder legs with a
    // log — it never blocks the customer-facing path and never spams.
    const founderClass = config?.founderClass ?? "C"; // unmapped events → C
    let founderLegsAllowed = false;
    try {
      const decision: ArbiterDecision = await arbitrateFounderInterrupt({
        source: "notification_dispatcher",
        interruptClass: founderClass,
        channel: "founder_broadcast",
        subject: label,
        body: notification.message,
        metadata: {
          eventType: event.eventType,
          priority: event.priority,
          organizationId: event.orgId,
        },
      });
      founderLegsAllowed = decision.outcome === "deliver";
      if (decision.outcome === "defer_next_pulse" || decision.outcome === "defer_to_letter") {
        await recordDeferredInterrupt(
          {
            source: "notification_dispatcher",
            interruptClass: founderClass,
            channel: "founder_broadcast",
            subject: label,
            body: notification.message,
            metadata: { eventType: event.eventType, priority: event.priority, organizationId: event.orgId },
          },
          decision,
        );
      }
    } catch (err) {
      logger.error(
        `[notification-dispatcher] interrupt arbiter threw for ${event.eventType} — founder legs fail CLOSED-quiet`,
        err instanceof Error ? err : undefined,
      );
      founderLegsAllowed = false;
    }

    // Route to channels, recording an HONEST status per leg. A channel with
    // no real rail is `channel_unavailable`, never `sent` — the in-app leg
    // above is the degrade path that actually carries the notification.
    try {
      // Customer-facing org broadcast — always, never arbitrated.
      const orgStatus = await this.sendInAppOrg(event, notification);
      if (orgStatus) notification.delivery.in_app_org = orgStatus;

      const wantsSms = isUrgent && config?.urgentChannel === "sms";
      const wantsPush = isUrgent && config?.urgentChannel === "push";
      const wantsEmail = channel === "email" || (isUrgent && channel !== "sms");

      if (founderLegsAllowed) {
        notification.delivery.in_app_founder = await this.sendInAppFounder(event, notification);

        if (wantsSms) notification.delivery.sms = this.recordChannelUnavailable("sms", notification);
        if (wantsPush) notification.delivery.push = this.recordChannelUnavailable("push", notification);
        if (wantsEmail) notification.delivery.email = this.recordChannelUnavailable("email", notification);
        // Defensive: a default channel pointing at an unwired rail degrades
        // to the in-app leg with honest status, same as above.
        if ((channel === "sms" || channel === "push") && !notification.delivery[channel]) {
          notification.delivery[channel] = this.recordChannelUnavailable(channel, notification);
        }
      } else {
        // Arbiter held the founder legs — record the hold, don't pretend.
        notification.delivery.in_app_founder = "suppressed";
        if (wantsSms) notification.delivery.sms = "suppressed";
        if (wantsPush) notification.delivery.push = "suppressed";
        if (wantsEmail) notification.delivery.email = "suppressed";
      }
    } catch (err: any) {
      logger.error(`[notification-dispatcher] Error dispatching ${event.eventType}`, err);
    }

    // Persist with the final delivery record so the tray (and the honest
    // statuses) survive restart. Fail-open with a loud log: a DB outage
    // degrades to memory-only, it never blocks dispatch.
    await this.persist(event, notification);
  }

  /**
   * In-app notification via WebSocket toast — customer-facing org broadcast.
   */
  private async sendInAppOrg(
    event: NotificationEvent,
    notification: StoredNotification,
  ): Promise<ChannelDeliveryStatus | undefined> {
    if (!event.orgId) return undefined;
    try {
      wsServer.broadcastToOrg(event.orgId, "notification", {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        priority: event.priority,
        eventType: event.eventType,
        actionUrl: this.getActionUrl(event),
        createdAt: notification.createdAt,
      });
      return "sent";
    } catch (err) {
      logger.error(
        `[notification-dispatcher] org broadcast failed for ${event.eventType}`,
        err instanceof Error ? err : undefined,
      );
      return "failed";
    }
  }

  /**
   * In-app notification via WebSocket toast — founder-facing broadcast
   * (arbitrated; Jarvis 2.2).
   */
  private async sendInAppFounder(
    event: NotificationEvent,
    notification: StoredNotification,
  ): Promise<ChannelDeliveryStatus> {
    try {
      wsServer.broadcast("founder:activity", "notification", {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        priority: event.priority,
        eventType: event.eventType,
        actionUrl: this.getActionUrl(event),
      });
      return "sent";
    } catch (err) {
      logger.error(
        `[notification-dispatcher] founder broadcast failed for ${event.eventType}`,
        err instanceof Error ? err : undefined,
      );
      return "failed";
    }
  }

  /**
   * SMS / email / push have NO delivery rail wired here yet (Wave C owns the
   * rails). Record `channel_unavailable` honestly — never claim `sent`,
   * never log "queued". The in-app leg carries the notification instead.
   */
  private recordChannelUnavailable(
    channel: "sms" | "email" | "push",
    notification: StoredNotification,
  ): ChannelDeliveryStatus {
    logger.warn(
      `[notification-dispatcher] ${channel} rail not wired — recording channel_unavailable for "${notification.title}"; nothing was sent on ${channel}, the in-app leg carries this notification`,
    );
    return "channel_unavailable";
  }

  // ─── Persistence (notifications table — source of truth) ──────────────────

  /**
   * Resolve the founder recipient the dispatcher tray persists under. The
   * tray is the founder's pull-based surface, so rows are keyed to the
   * founder's primary org + user id; the originating customer org (if any)
   * rides along in metadata.sourceOrgId.
   */
  private async resolveRecipient(): Promise<{ orgId: number; userId: string }> {
    if (this.recipient) return this.recipient;
    const { getFounderPrimaryOrgId, getFounderUserIds } = await import("./founder");
    const orgId = await getFounderPrimaryOrgId();
    const userIds = await getFounderUserIds();
    this.recipient = { orgId, userId: userIds[0] ?? "founder" };
    return this.recipient;
  }

  private async persist(event: NotificationEvent, notification: StoredNotification): Promise<void> {
    try {
      const { storage } = await import("../storage");
      const recipient = await this.resolveRecipient();
      const row = await storage.createNotification({
        organizationId: recipient.orgId,
        userId: recipient.userId,
        type: notification.eventType,
        title: notification.title,
        message: notification.message,
        metadata: {
          source: METADATA_SOURCE,
          trayId: notification.id,
          priority: notification.priority,
          channel: notification.channel,
          payload: notification.payload,
          delivery: notification.delivery,
          sourceOrgId: event.orgId ?? null,
        },
      });
      notification.dbId = row.id;
      notification.persisted = true;
    } catch (err) {
      notification.persisted = false;
      logger.error(
        `[notification-dispatcher] failed to persist ${event.eventType} to the notifications table — this notification will NOT survive a restart`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Reconcile the tray cache from the `notifications` table. Local-only
   * (unpersisted) items are kept; a locally-set read flag wins over a stale
   * DB row (the read write-back is fire-and-forget).
   */
  private async refreshFromDb(reason: string): Promise<void> {
    try {
      const { storage } = await import("../storage");
      const recipient = await this.resolveRecipient();
      const rows = await storage.getNotifications(recipient.orgId, recipient.userId, false);

      const fromDb: StoredNotification[] = rows
        .filter((r) => (r.metadata as any)?.source === METADATA_SOURCE)
        .map((r) => {
          const m = (r.metadata ?? {}) as Record<string, any>;
          return {
            id: typeof m.trayId === "string" ? m.trayId : String(r.id),
            dbId: r.id,
            eventType: r.type,
            title: r.title,
            message: r.message ?? "",
            priority: typeof m.priority === "number" ? m.priority : 3,
            channel: typeof m.channel === "string" ? m.channel : "in_app",
            read: !!r.isRead,
            createdAt:
              r.createdAt instanceof Date
                ? r.createdAt.toISOString()
                : String(r.createdAt ?? new Date().toISOString()),
            payload: (m.payload as Record<string, any>) ?? {},
            delivery: (m.delivery as Record<string, ChannelDeliveryStatus>) ?? {},
            persisted: true,
          };
        });

      const byId = new Map<string, StoredNotification>(fromDb.map((n) => [n.id, n]));
      for (const local of this.store) {
        const dbItem = byId.get(local.id);
        if (!dbItem) {
          byId.set(local.id, local);
        } else if (local.read && !dbItem.read) {
          dbItem.read = true;
        }
      }

      this.store = [...byId.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_NOTIFICATIONS);
      this.lastRefreshAt = Date.now();
    } catch (err) {
      logger.error(
        `[notification-dispatcher] ${reason}: failed to load persisted notifications — serving the in-memory view only`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  // ─── Message / URL builders ────────────────────────────────────────────────

  /**
   * Build human-readable notification message from event payload
   */
  private buildMessage(event: NotificationEvent): string {
    const p = event.payload ?? {};

    switch (event.eventType) {
      case "deal:discovered":
        return `New deal found: ${p.address ?? p.propertyAddress ?? "Unknown"} — $${p.price?.toLocaleString() ?? "N/A"}`;
      case "deal:closed":
        return `Deal closed: ${p.address ?? "Unknown"} for $${p.amount?.toLocaleString() ?? p.price?.toLocaleString() ?? "N/A"}`;
      case "agent:escalation":
        return `${p.agent ?? "Agent"} needs your input: ${p.reason ?? p.description ?? "Review required"}`;
      case "agent:decision":
        return `${p.agent ?? "Agent"} decided: ${p.decision ?? p.description ?? "Action taken"}`;
      case "approval:requested":
        return `Approval needed: ${p.description ?? p.action ?? "Review request"}`;
      case "job:failed":
        return `Job failed: ${p.jobName ?? "Unknown"} — ${p.error ?? "Check logs"}`;
      case "revenue:milestone":
        return `Revenue milestone: $${p.amount?.toLocaleString() ?? "N/A"} — ${p.description ?? ""}`;
      case "briefing:ready":
        return `Your daily briefing is ready. ${p.highlights ?? ""}`;
      case "agent:conflict":
        return `Agents disagree: ${p.topic ?? p.description ?? "Needs resolution"}`;
      case "market:alert":
        return `Market alert for ${p.county ?? p.market ?? "your area"}: ${p.description ?? p.message ?? ""}`;
      default:
        return p.message ?? p.description ?? `${event.eventType} event occurred`;
    }
  }

  /**
   * Map events to action URLs in the frontend
   */
  private getActionUrl(event: NotificationEvent): string {
    switch (event.eventType) {
      case "deal:discovered":
      case "deal:closed":
        return "/deals";
      case "agent:escalation":
      case "agent:decision":
      case "agent:conflict":
        return "/board-of-directors";
      case "approval:requested":
        return "/admin/decisions";
      case "job:failed":
        return "/job-health";
      case "revenue:milestone":
        return "/agent-performance";
      case "briefing:ready":
        return "/today";
      case "market:alert":
        return "/market-intelligence";
      default:
        return "/sovereign";
    }
  }

  // ─── Tray API (sync — served from the write-through cache) ────────────────

  /**
   * Get stored in-app notifications (for notification tray). Served from the
   * cache; a throttled background reconcile keeps the cache converging on
   * the DB (other machines' writes appear within one tray poll).
   */
  getNotifications(limit: number = 50): StoredNotification[] {
    if (Date.now() - this.lastRefreshAt > REFRESH_INTERVAL_MS) {
      this.lastRefreshAt = Date.now();
      void this.refreshFromDb("tray-read");
    }
    return this.store.slice(0, limit);
  }

  /**
   * Mark a notification as read. Updates the cache synchronously and writes
   * the read flag back to the DB fire-and-forget (poll/refresh reconciles).
   */
  markAsRead(notificationId: string): boolean {
    const notif = this.store.find((n) => n.id === notificationId);
    if (!notif) return false;
    notif.read = true;
    if (notif.dbId != null) {
      const dbId = notif.dbId;
      void import("../storage")
        .then(({ storage }) => storage.markNotificationRead(dbId))
        .catch((err) =>
          logger.error(
            `[notification-dispatcher] failed to persist read state for notification ${notificationId}`,
            err instanceof Error ? err : undefined,
          ),
        );
    }
    return true;
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return this.store.filter((n) => !n.read).length;
  }
}

export const notificationDispatcher = new NotificationDispatcher();

/**
 * Event Mesh — Sovereign Company Protocol v12
 *
 * Real pub/sub replacing all polling. Events are published to channels,
 * subscribers register patterns, and delivery is tracked with acknowledgements.
 * Unprocessable events are routed to a dead-letter queue for investigation.
 */

import { db } from "../db";
import {
  eventMeshEvents,
  eventMeshSubscriptions,
  type EventMeshEvent,
  type EventMeshSubscription,
} from "@shared/schema";
import { eq, desc, and, like, sql, inArray, lte, gte } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../utils/logger";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublishOptions {
  publisher: string;
  priority?: number;
  requiresAck?: boolean;
  orgId?: number;
  maxRetries?: number;
  expiresAt?: Date;
}

interface SubscribeOptions {
  filterConditions?: Record<string, any>;
  callbackType?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class EventMeshService {
  /**
   * Publish an event to a channel.
   */
  async publish(
    channel: string,
    eventType: string,
    payload: Record<string, any>,
    options: PublishOptions,
  ): Promise<EventMeshEvent> {
    const eventId = crypto.randomUUID();

    const [event] = await db
      .insert(eventMeshEvents)
      .values({
        eventId,
        channel,
        eventType,
        payload,
        publisher: options.publisher,
        priority: options.priority ?? 5,
        requiresAck: options.requiresAck ?? false,
        orgId: options.orgId ?? null,
        maxRetries: options.maxRetries ?? 3,
        expiresAt: options.expiresAt ?? null,
        ackedBy: [],
        deadLettered: false,
        retryCount: 0,
      })
      .returning();

    logger.info(`[event-mesh] Published ${eventType} on ${channel} (${eventId})`);
    return event;
  }

  /**
   * Register a subscription to a channel pattern.
   * Pattern supports SQL LIKE syntax (% for wildcard).
   */
  async subscribe(
    subscriber: string,
    channelPattern: string,
    options?: SubscribeOptions,
  ): Promise<EventMeshSubscription> {
    // Check for duplicate subscription
    const existing = await db
      .select()
      .from(eventMeshSubscriptions)
      .where(
        and(
          eq(eventMeshSubscriptions.subscriber, subscriber),
          eq(eventMeshSubscriptions.channelPattern, channelPattern),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Reactivate if inactive
      if (!existing[0].isActive) {
        const [reactivated] = await db
          .update(eventMeshSubscriptions)
          .set({ isActive: true })
          .where(eq(eventMeshSubscriptions.id, existing[0].id))
          .returning();
        return reactivated;
      }
      return existing[0];
    }

    const [subscription] = await db
      .insert(eventMeshSubscriptions)
      .values({
        subscriber,
        channelPattern,
        filterConditions: options?.filterConditions ?? {},
        callbackType: options?.callbackType ?? "internal",
        isActive: true,
        eventsProcessed: 0,
        eventsFailed: 0,
      })
      .returning();

    logger.info(`[event-mesh] ${subscriber} subscribed to ${channelPattern}`);
    return subscription;
  }

  /**
   * Unsubscribe — deactivate rather than delete for audit trail.
   */
  async unsubscribe(subscriber: string, channelPattern: string): Promise<boolean> {
    const result = await db
      .update(eventMeshSubscriptions)
      .set({ isActive: false })
      .where(
        and(
          eq(eventMeshSubscriptions.subscriber, subscriber),
          eq(eventMeshSubscriptions.channelPattern, channelPattern),
        ),
      )
      .returning();

    return result.length > 0;
  }

  /**
   * Get unprocessed events matching a subscriber's patterns.
   * An event is unprocessed if the subscriber hasn't acked it.
   */
  async getUnprocessedEvents(
    subscriber: string,
    limit: number = 50,
  ): Promise<EventMeshEvent[]> {
    // Get subscriber's active patterns
    const subs = await db
      .select()
      .from(eventMeshSubscriptions)
      .where(
        and(
          eq(eventMeshSubscriptions.subscriber, subscriber),
          eq(eventMeshSubscriptions.isActive, true),
        ),
      );

    if (subs.length === 0) return [];

    // For each pattern, find matching unacked events
    const allEvents: EventMeshEvent[] = [];

    for (const sub of subs) {
      const pattern = sub.channelPattern.replace(/\*/g, "%");
      const events = await unscopedForPlatformOps(
        "event-mesh drain reads every unacked event matching a platform subscriber's channel pattern; the event mesh is ONE shared bus, not tenant data: its `system:*` channels carry no orgId at all, so an org predicate would return zero rows for exactly the lanes the operator needs",
      )
        .select()
        .from(eventMeshEvents)
        .where(
          and(
            like(eventMeshEvents.channel, pattern),
            eq(eventMeshEvents.deadLettered, false),
            sql`NOT (${eventMeshEvents.ackedBy} @> ${JSON.stringify([subscriber])}::jsonb)`,
          ),
        )
        .orderBy(desc(eventMeshEvents.priority), eventMeshEvents.createdAt)
        .limit(limit);

      allEvents.push(...events);
    }

    // Deduplicate by eventId and respect limit
    const seen = new Set<string>();
    const unique: EventMeshEvent[] = [];
    for (const event of allEvents) {
      if (!seen.has(event.eventId) && unique.length < limit) {
        seen.add(event.eventId);
        unique.push(event);
      }
    }

    return unique;
  }

  /**
   * Acknowledge that a subscriber has processed an event.
   */
  async acknowledge(eventId: string, subscriber: string): Promise<void> {
    // Ack is DELIVERY BOOKKEEPING for platform singleton subscribers, and it is
    // the other half of getUnprocessedEvents — "unprocessed" is defined as "not
    // in ackedBy". Scope the ack to an org and the drain could never mark a
    // system-lane event done, so it would redeliver forever.
    const [event] = await unscopedForPlatformOps(
      "event acknowledgement is delivery bookkeeping for platform subscribers; scoping it would make system-lane events undeliverable-forever",
    )
      .select()
      .from(eventMeshEvents)
      .where(eq(eventMeshEvents.eventId, eventId))
      .limit(1);

    if (!event) throw new Error(`Event not found: ${eventId}`);

    const ackedBy = [...(event.ackedBy ?? []), subscriber];

    await unscopedForPlatformOps(
      "marks the event acked for this platform subscriber; the event is the one just read above",
    )
      .update(eventMeshEvents)
      .set({ ackedBy })
      .where(eq(eventMeshEvents.eventId, eventId));

    // Update subscriber stats
    await unscopedForPlatformOps(
      "subscriber throughput counters describe the shared bus, not a tenant",
    )
      .update(eventMeshSubscriptions)
      .set({
        eventsProcessed: sql`${eventMeshSubscriptions.eventsProcessed} + 1`,
        lastEventAt: new Date(),
      })
      .where(eq(eventMeshSubscriptions.subscriber, subscriber));
  }

  /**
   * Move an event to the dead-letter queue.
   */
  async deadLetter(eventId: string, reason: string): Promise<void> {
    // The drain must be able to quarantine a poison event whatever lane it is
    // on — including none — or one undeliverable event blocks the bus for
    // everybody.
    await unscopedForPlatformOps(
      "platform drain quarantines a poison event on whatever lane it belongs to, including the system lanes that carry no org",
    )
      .update(eventMeshEvents)
      .set({
        deadLettered: true,
        deadLetterReason: reason,
      })
      .where(eq(eventMeshEvents.eventId, eventId));

    logger.info(`[event-mesh] Dead-lettered ${eventId}: ${reason}`);
  }

  /**
   * Query dead-letter queue.
   */
  async getDeadLetterEvents(limit: number = 50): Promise<EventMeshEvent[]> {
    return unscopedForPlatformOps(
      "the dead-letter queue is the platform operator's failure queue, and its contents are disproportionately events with no org at all; the event mesh is ONE shared bus, not tenant data: its `system:*` channels carry no orgId at all, so an org predicate would return zero rows for exactly the lanes the operator needs",
    )
      .select()
      .from(eventMeshEvents)
      .where(eq(eventMeshEvents.deadLettered, true))
      .orderBy(desc(eventMeshEvents.createdAt))
      .limit(limit);
  }

  /**
   * Replay events from a channel within a time range.
   */
  async replayEvents(
    channel: string,
    fromTimestamp: Date,
    toTimestamp: Date,
  ): Promise<EventMeshEvent[]> {
    return db
      .select()
      .from(eventMeshEvents)
      .where(
        and(
          eq(eventMeshEvents.channel, channel),
          gte(eventMeshEvents.createdAt, fromTimestamp),
          lte(eventMeshEvents.createdAt, toTimestamp),
        ),
      )
      .orderBy(eventMeshEvents.createdAt);
  }

  /**
   * Get events by channel.
   */
  async getEventsByChannel(channel: string, limit: number = 50): Promise<EventMeshEvent[]> {
    return unscopedForPlatformOps(
      "per-channel view of the operator's event log; the event mesh is ONE shared bus, not tenant data: its `system:*` channels carry no orgId at all, so an org predicate would return zero rows for exactly the lanes the operator needs",
    )
      .select()
      .from(eventMeshEvents)
      .where(eq(eventMeshEvents.channel, channel))
      .orderBy(desc(eventMeshEvents.createdAt))
      .limit(limit);
  }

  /**
   * Recent events across ALL channels, newest first. Powers the founder
   * event-log stream (a cross-channel firehose the per-channel endpoint
   * couldn't serve).
   */
  async getRecentEvents(limit: number = 100): Promise<EventMeshEvent[]> {
    return unscopedForPlatformOps(
      "the operator's cross-channel mesh firehose; the event mesh is ONE shared bus, not tenant data: its `system:*` channels carry no orgId at all, so an org predicate would return zero rows for exactly the lanes the operator needs",
    )
      .select()
      .from(eventMeshEvents)
      .orderBy(desc(eventMeshEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  }

  /**
   * Get events by type.
   */
  async getEventsByType(type: string, limit: number = 50): Promise<EventMeshEvent[]> {
    return db
      .select()
      .from(eventMeshEvents)
      .where(eq(eventMeshEvents.eventType, type))
      .orderBy(desc(eventMeshEvents.createdAt))
      .limit(limit);
  }

  /**
   * List subscriptions, optionally filtered by subscriber.
   */
  async getSubscriptions(subscriber?: string): Promise<EventMeshSubscription[]> {
    if (subscriber) {
      return db
        .select()
        .from(eventMeshSubscriptions)
        .where(eq(eventMeshSubscriptions.subscriber, subscriber))
        .orderBy(eventMeshSubscriptions.createdAt);
    }
    return db
      .select()
      .from(eventMeshSubscriptions)
      .orderBy(eventMeshSubscriptions.subscriber);
  }

  /**
   * Mesh statistics — event throughput, DLQ depth, subscriber lag.
   */
  async getStats(): Promise<{
    totalEvents: number;
    channelsActive: number;
    deadLetterDepth: number;
    subscriberCount: number;
    activeSubscriptions: number;
    recentEventsPerMinute: number;
    topChannels: Array<{ channel: string; count: number }>;
  }> {
    const [totalRow] = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({ count: sql<number>`count(*)::int` })
      .from(eventMeshEvents);

    const [dlqRow] = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({ count: sql<number>`count(*)::int` })
      .from(eventMeshEvents)
      .where(eq(eventMeshEvents.deadLettered, true));

    const [channelRow] = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({ count: sql<number>`count(distinct ${eventMeshEvents.channel})::int` })
      .from(eventMeshEvents);

    const [subRow] = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({ count: sql<number>`count(*)::int` })
      .from(eventMeshSubscriptions);

    const [activeSubRow] = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({ count: sql<number>`count(*)::int` })
      .from(eventMeshSubscriptions)
      .where(eq(eventMeshSubscriptions.isActive, true));

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [recentRow] = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({ count: sql<number>`count(*)::int` })
      .from(eventMeshEvents)
      .where(gte(eventMeshEvents.createdAt, fiveMinAgo));

    const topChannels = await unscopedForPlatformOps(
      "mesh health: throughput, DLQ depth, channel spread and subscriber lag measure ONE shared bus, not a tenant",
    )
      .select({
        channel: eventMeshEvents.channel,
        count: sql<number>`count(*)::int`,
      })
      .from(eventMeshEvents)
      .groupBy(eventMeshEvents.channel)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    return {
      totalEvents: totalRow.count,
      channelsActive: channelRow.count,
      deadLetterDepth: dlqRow.count,
      subscriberCount: subRow.count,
      activeSubscriptions: activeSubRow.count,
      recentEventsPerMinute: Math.round(recentRow.count / 5),
      topChannels,
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const eventMeshService = new EventMeshService();

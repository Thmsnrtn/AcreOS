// @ts-nocheck
/**
 * Event Mesh Drain — Phase B
 *
 * Background job that processes pending events from the event mesh:
 * 1. Pulls unprocessed events matching subscriber patterns
 * 2. Executes callback logic per subscriber type
 * 3. Broadcasts qualifying events to WebSocket for real-time founder visibility
 * 4. Routes urgent events to the notification dispatcher
 * 5. Acknowledges processed events
 */

import { eventMeshService } from "./eventMeshV12";
import { wsServer } from "../websocket";
import { notificationDispatcher } from "./notificationDispatcher";
import { db } from "../db";
import { eventMeshSubscriptions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

// ─── Subscriber Callbacks ────────────────────────────────────────────────────

type SubscriberCallback = (event: any) => Promise<void>;

const subscriberCallbacks: Record<string, SubscriberCallback> = {
  /**
   * WebSocket Bridge — broadcasts events to connected clients
   */
  "ws-bridge": async (event) => {
    const orgId = event.orgId;
    if (orgId) {
      wsServer.broadcastToOrg(orgId, `event_mesh:${event.eventType}`, {
        eventId: event.eventId,
        channel: event.channel,
        eventType: event.eventType,
        payload: event.payload,
        publisher: event.publisher,
        priority: event.priority,
        createdAt: event.createdAt,
      });
    }

    // Also broadcast to founder activity channel for real-time dashboard
    wsServer.broadcast("founder:activity", "event_mesh_activity", {
      eventId: event.eventId,
      channel: event.channel,
      eventType: event.eventType,
      publisher: event.publisher,
      priority: event.priority,
      timestamp: event.createdAt,
    });
  },

  /**
   * Notification Router — sends urgent events to notification dispatcher
   */
  "notification-router": async (event) => {
    // High-priority events (1-3) get pushed to notification dispatcher
    if (event.priority <= 3) {
      await notificationDispatcher.dispatch({
        eventType: event.eventType,
        channel: event.channel,
        payload: event.payload,
        priority: event.priority,
        orgId: event.orgId,
        timestamp: event.createdAt,
      });
    }
  },

  /**
   * Agent Reaction Trigger — wakes agents when relevant events arrive
   */
  "agent-reaction": async (event) => {
    // Agent events that should trigger reactions
    const agentEvents = ["agent:decision", "agent:escalation", "agent:conflict", "task_delegated"];
    if (agentEvents.some((t) => event.eventType.includes(t))) {
      // The existing agent reaction processor will pick this up
      // We just ensure it's visible in the event stream
      logger.info(`[event-mesh-drain] Agent event: ${event.eventType} from ${event.publisher}`);
    }
  },
};

// ─── Drain Service ───────────────────────────────────────────────────────────

class EventMeshDrainService {
  private initialized = false;

  /**
   * Initialize subscriptions — registers the core system subscribers.
   * Called once at startup.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Register WebSocket bridge subscriber (catches all events)
      await eventMeshService.subscribe("ws-bridge", "*", {
        callbackType: "ws-bridge",
      });

      // Register notification router (catches all events, filters by priority)
      await eventMeshService.subscribe("notification-router", "*", {
        callbackType: "notification-router",
      });

      // Register agent reaction trigger (catches agent events)
      await eventMeshService.subscribe("agent-reaction", "agent:*", {
        callbackType: "agent-reaction",
      });

      this.initialized = true;
      logger.info("[event-mesh-drain] Initialized with 3 system subscribers");
    } catch (err: any) {
      logger.error("[event-mesh-drain] Initialization error", err);
    }
  }

  /**
   * Drain — process pending events for all subscribers.
   * Called by the background job scheduler.
   */
  async drain(): Promise<{ processed: number; errors: number }> {
    let processed = 0;
    let errors = 0;

    try {
      // Get all active subscribers
      const subs = await db
        .select()
        .from(eventMeshSubscriptions)
        .where(eq(eventMeshSubscriptions.isActive, true));

      for (const sub of subs) {
        try {
          const events = await eventMeshService.getUnprocessedEvents(sub.subscriber, 25);

          for (const event of events) {
            try {
              // Execute callback
              const callback = subscriberCallbacks[sub.callbackType ?? sub.subscriber];
              if (callback) {
                await callback(event);
              }

              // Acknowledge
              await eventMeshService.acknowledge(event.eventId, sub.subscriber);
              processed++;
            } catch (eventErr: any) {
              errors++;
              logger.error(`[event-mesh-drain] Error processing ${event.eventId} for ${sub.subscriber}`, undefined, { metadata: { detail: eventErr.message } });

              // Dead-letter after max retries
              if ((event.retryCount ?? 0) >= (event.maxRetries ?? 3)) {
                await eventMeshService.deadLetter(event.eventId, eventErr.message);
              }
            }
          }
        } catch (subErr: any) {
          errors++;
          logger.error(`[event-mesh-drain] Error for subscriber ${sub.subscriber}`, undefined, { metadata: { detail: subErr.message } });
        }
      }
    } catch (err: any) {
      logger.error("[event-mesh-drain] Drain error", err);
    }

    if (processed > 0 || errors > 0) {
      logger.info(`[event-mesh-drain] Processed ${processed}, errors ${errors}`);
    }

    return { processed, errors };
  }
}

export const eventMeshDrain = new EventMeshDrainService();

// @ts-nocheck
/**
 * Event Mesh Publisher — Phase B
 *
 * Convenience functions that business logic calls to publish events
 * to the event mesh. These replace scattered console.log calls with
 * structured event publishing that flows through the drain → WebSocket → notifications.
 */

import { eventMeshService } from "./eventMeshV12";

class EventMeshPublisher {
  // ─── Deal Events ─────────────────────────────────────────────────────────

  async dealDiscovered(orgId: number, deal: Record<string, any>): Promise<void> {
    await eventMeshService.publish("deal:lifecycle", "deal:discovered", deal, {
      publisher: "deal-hunter",
      priority: 3,
      orgId,
      requiresAck: false,
    });
  }

  async dealClosed(orgId: number, deal: Record<string, any>): Promise<void> {
    await eventMeshService.publish("deal:lifecycle", "deal:closed", deal, {
      publisher: "deal-pipeline",
      priority: 2,
      orgId,
      requiresAck: true,
    });
  }

  async dealUpdated(orgId: number, deal: Record<string, any>): Promise<void> {
    await eventMeshService.publish("deal:lifecycle", "deal:updated", deal, {
      publisher: "deal-pipeline",
      priority: 5,
      orgId,
    });
  }

  // ─── Agent Events ────────────────────────────────────────────────────────

  async agentDecision(orgId: number, agent: string, decision: Record<string, any>): Promise<void> {
    await eventMeshService.publish("agent:decisions", "agent:decision", {
      agent,
      ...decision,
    }, {
      publisher: agent,
      priority: 4,
      orgId,
    });
  }

  async agentEscalation(orgId: number, agent: string, reason: string, context: Record<string, any> = {}): Promise<void> {
    await eventMeshService.publish("agent:escalations", "agent:escalation", {
      agent,
      reason,
      ...context,
    }, {
      publisher: agent,
      priority: 1,
      orgId,
      requiresAck: true,
    });
  }

  async agentConflict(orgId: number, agents: string[], topic: string, details: Record<string, any> = {}): Promise<void> {
    await eventMeshService.publish("agent:conflicts", "agent:conflict", {
      agents,
      topic,
      ...details,
    }, {
      publisher: "conflict-detector",
      priority: 2,
      orgId,
      requiresAck: true,
    });
  }

  // ─── Approval Events ────────────────────────────────────────────────────

  async approvalRequested(orgId: number, request: Record<string, any>): Promise<void> {
    await eventMeshService.publish("approval:queue", "approval:requested", request, {
      publisher: request.requestedBy ?? "system",
      priority: 2,
      orgId,
      requiresAck: true,
    });
  }

  // ─── System Events ──────────────────────────────────────────────────────

  async jobCompleted(jobName: string, result: Record<string, any>): Promise<void> {
    await eventMeshService.publish("system:jobs", "job:completed", {
      jobName,
      ...result,
    }, {
      publisher: "job-scheduler",
      priority: 7,
    });
  }

  async jobFailed(jobName: string, error: string, context: Record<string, any> = {}): Promise<void> {
    await eventMeshService.publish("system:jobs", "job:failed", {
      jobName,
      error,
      ...context,
    }, {
      publisher: "job-scheduler",
      priority: 2,
      requiresAck: true,
    });
  }

  async briefingReady(orgId: number, briefing: Record<string, any>): Promise<void> {
    await eventMeshService.publish("system:briefing", "briefing:ready", briefing, {
      publisher: "briefing-generator",
      priority: 3,
      orgId,
    });
  }

  // ─── Revenue Events ─────────────────────────────────────────────────────

  async revenueMilestone(orgId: number, milestone: Record<string, any>): Promise<void> {
    await eventMeshService.publish("finance:revenue", "revenue:milestone", milestone, {
      publisher: "finance-agent",
      priority: 3,
      orgId,
    });
  }

  // ─── Market Events ──────────────────────────────────────────────────────

  async marketAlert(orgId: number, alert: Record<string, any>): Promise<void> {
    await eventMeshService.publish("market:alerts", "market:alert", alert, {
      publisher: "market-intelligence",
      priority: 4,
      orgId,
    });
  }

  // ─── Generic publish for custom events ───────────────────────────────────

  async publish(
    channel: string,
    eventType: string,
    payload: Record<string, any>,
    options: { publisher: string; priority?: number; orgId?: number; requiresAck?: boolean },
  ): Promise<void> {
    await eventMeshService.publish(channel, eventType, payload, {
      ...options,
      priority: options.priority ?? 5,
    });
  }
}

export const eventMeshPublisher = new EventMeshPublisher();

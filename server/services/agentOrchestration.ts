import { db } from "../db";
import { 
  agentSessions, 
  agentSessionSteps, 
  eventSubscriptions, 
  agentEvents, 
  outcomeTelemetry,
  agentTasks,
  type InsertAgentSession,
  type InsertAgentSessionStep,
  type InsertEventSubscription,
  type InsertAgentEvent,
  type InsertOutcomeTelemetry,
  type AgentSession,
  type AgentSessionStep,
} from "@shared/schema";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { SkillRegistry } from "./agent-skills";

const skillRegistry = new SkillRegistry();

export type SessionType = 
  | "due_diligence_pod"
  | "acquisition_research"
  | "deal_analysis"
  | "market_intelligence"
  | "portfolio_monitoring"
  | "custom";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_approval";

export type TriggerAction = "create_task" | "start_session" | "call_webhook";

export interface PendingApproval {
  stepId: number;
  stepNumber: number;
  agentType: string;
  skillName?: string;
  reason: string;
  requestedAt: string;
  requestedBy?: string;
}

export interface StructuredOutput {
  data: any;
  timestamp: string;
  agentType: string;
  stepNumber: number;
  version: number;
}

export interface SessionContext {
  targetEntity?: { type: string; id: number };
  inputs?: Record<string, any>;
  intermediateResults?: Record<string, any>;
  decisions?: Array<{ agentType: string; decision: string; reasoning: string; timestamp: string }>;
  structuredOutputs?: Record<string, StructuredOutput[]>;
  pendingApprovals?: Record<string, PendingApproval>;
  outputHistory?: Array<{
    key: string;
    output: StructuredOutput;
    mergedAt: string;
  }>;
}

export interface StepDefinition {
  agentType: string;
  skillName?: string;
  input?: Record<string, any>;
  dependsOnSteps?: number[];
  description?: string;
}

export interface SessionConfig {
  maxSteps?: number;
  timeout?: number;
  requireHumanApproval?: string[];
  participatingAgents?: string[];
}

export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTimeMs: number;
  awaitingApproval?: boolean;
}

export interface EventCondition {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists";
  value: any;
}

export interface EventFilter {
  entityType?: string;
  entityId?: number;
  conditions?: EventCondition[];
}

export interface SubscriptionData {
  subscriberType: "agent" | "workflow" | "webhook";
  subscriberId: string;
  eventType: string;
  eventFilter?: EventFilter;
  triggerAction?: TriggerAction;
  triggerConfig?: {
    webhookUrl?: string;
    sessionType?: SessionType;
    taskPriority?: string;
    taskInput?: Record<string, any>;
  };
}

class AgentOrchestrationService {
  async createSession(
    organizationId: number,
    data: {
      name: string;
      sessionType: SessionType;
      initiatedBy?: string;
      config?: SessionConfig;
      sharedContext?: SessionContext;
    }
  ): Promise<AgentSession> {
    const initialContext: SessionContext = {
      ...data.sharedContext,
      structuredOutputs: data.sharedContext?.structuredOutputs || {},
      pendingApprovals: data.sharedContext?.pendingApprovals || {},
      outputHistory: data.sharedContext?.outputHistory || [],
      intermediateResults: data.sharedContext?.intermediateResults || {},
      decisions: data.sharedContext?.decisions || [],
    };

    const [session] = await db.insert(agentSessions).values({
      organizationId,
      name: data.name,
      sessionType: data.sessionType,
      initiatedBy: data.initiatedBy,
      config: data.config,
      sharedContext: initialContext,
      status: "active",
    }).returning();
    
    return session;
  }

  async getSession(sessionId: number): Promise<AgentSession | null> {
    const [session] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId));
    return session || null;
  }

  async getSessionsByOrganization(organizationId: number, limit = 50): Promise<AgentSession[]> {
    return db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.organizationId, organizationId))
      .orderBy(desc(agentSessions.createdAt))
      .limit(limit);
  }

  async updateSessionContext(
    sessionId: number,
    contextUpdate: Partial<SessionContext>
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error("Session not found");

    const currentContext = (session.sharedContext as SessionContext) || {};
    const timestamp = new Date().toISOString();

    const newOutputHistory = [...(currentContext.outputHistory || [])];
    if (contextUpdate.intermediateResults) {
      for (const [key, value] of Object.entries(contextUpdate.intermediateResults)) {
        const structuredOutput: StructuredOutput = {
          data: value,
          timestamp,
          agentType: "unknown",
          stepNumber: 0,
          version: (currentContext.structuredOutputs?.[key]?.length || 0) + 1,
        };
        newOutputHistory.push({
          key,
          output: structuredOutput,
          mergedAt: timestamp,
        });
      }
    }

    const mergedStructuredOutputs = { ...(currentContext.structuredOutputs || {}) };
    if (contextUpdate.structuredOutputs) {
      for (const [key, outputs] of Object.entries(contextUpdate.structuredOutputs)) {
        if (!mergedStructuredOutputs[key]) {
          mergedStructuredOutputs[key] = [];
        }
        mergedStructuredOutputs[key] = [
          ...mergedStructuredOutputs[key],
          ...outputs,
        ];
      }
    }

    const newContext: SessionContext = {
      ...currentContext,
      ...contextUpdate,
      intermediateResults: {
        ...(currentContext.intermediateResults || {}),
        ...(contextUpdate.intermediateResults || {}),
      },
      decisions: [
        ...(currentContext.decisions || []),
        ...(contextUpdate.decisions || []),
      ],
      structuredOutputs: mergedStructuredOutputs,
      pendingApprovals: {
        ...(currentContext.pendingApprovals || {}),
        ...(contextUpdate.pendingApprovals || {}),
      },
      outputHistory: newOutputHistory,
    };

    await db
      .update(agentSessions)
      .set({ sharedContext: newContext })
      .where(eq(agentSessions.id, sessionId));
  }

  async requestApproval(
    sessionId: number,
    stepId: number,
    reason: string,
    requestedBy?: string
  ): Promise<PendingApproval> {
    const [step] = await db
      .select()
      .from(agentSessionSteps)
      .where(eq(agentSessionSteps.id, stepId));

    if (!step) throw new Error("Step not found");

    const approval: PendingApproval = {
      stepId,
      stepNumber: step.stepNumber,
      agentType: step.agentType,
      skillName: step.skillUsed || undefined,
      reason,
      requestedAt: new Date().toISOString(),
      requestedBy,
    };

    await db
      .update(agentSessionSteps)
      .set({ status: "awaiting_approval" })
      .where(eq(agentSessionSteps.id, stepId));

    await this.updateSessionContext(sessionId, {
      pendingApprovals: {
        [`step_${stepId}`]: approval,
      },
    });

    console.log(`[orchestration] Approval requested for step ${stepId}: ${reason}`);
    return approval;
  }

  async approveStep(
    sessionId: number,
    stepId: number,
    approvedBy: string
  ): Promise<{ approved: boolean; message: string }> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error("Session not found");

    const context = session.sharedContext as SessionContext;
    const approvalKey = `step_${stepId}`;
    const pendingApproval = context.pendingApprovals?.[approvalKey];

    if (!pendingApproval) {
      return { approved: false, message: "No pending approval found for this step" };
    }

    const newPendingApprovals = { ...(context.pendingApprovals || {}) };
    delete newPendingApprovals[approvalKey];

    const updatedContext: SessionContext = {
      ...context,
      pendingApprovals: newPendingApprovals,
      decisions: [
        ...(context.decisions || []),
        {
          agentType: "human",
          decision: "approved",
          reasoning: `Step ${stepId} approved by ${approvedBy}`,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    await db
      .update(agentSessions)
      .set({
        sharedContext: updatedContext as any,
      })
      .where(eq(agentSessions.id, sessionId));

    await db
      .update(agentSessionSteps)
      .set({ status: "pending" })
      .where(eq(agentSessionSteps.id, stepId));

    console.log(`[orchestration] Step ${stepId} approved by ${approvedBy}`);
    return { approved: true, message: "Step approved successfully" };
  }

  async getPendingApprovals(sessionId: number): Promise<PendingApproval[]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error("Session not found");

    const context = session.sharedContext as SessionContext;
    return Object.values(context.pendingApprovals || {});
  }

  async completeSession(sessionId: number, status: "completed" | "failed" | "cancelled" = "completed"): Promise<void> {
    await db
      .update(agentSessions)
      .set({ 
        status, 
        completedAt: new Date() 
      })
      .where(eq(agentSessions.id, sessionId));
  }

  async addStep(
    sessionId: number,
    organizationId: number,
    step: StepDefinition
  ): Promise<AgentSessionStep> {
    const existingSteps = await db
      .select()
      .from(agentSessionSteps)
      .where(eq(agentSessionSteps.sessionId, sessionId));

    const stepNumber = existingSteps.length + 1;

    const [newStep] = await db.insert(agentSessionSteps).values({
      sessionId,
      organizationId,
      stepNumber,
      agentType: step.agentType,
      skillUsed: step.skillName,
      input: step.input,
      dependsOnSteps: step.dependsOnSteps,
      status: "pending",
    }).returning();

    return newStep;
  }

  async getSessionSteps(sessionId: number): Promise<AgentSessionStep[]> {
    return db
      .select()
      .from(agentSessionSteps)
      .where(eq(agentSessionSteps.sessionId, sessionId))
      .orderBy(agentSessionSteps.stepNumber);
  }

  private requiresApproval(step: AgentSessionStep, config?: SessionConfig): boolean {
    if (!config?.requireHumanApproval || config.requireHumanApproval.length === 0) {
      return false;
    }

    const checkStrings = [
      step.agentType,
      step.skillUsed,
      `${step.agentType}:${step.skillUsed}`,
    ].filter(Boolean) as string[];

    return checkStrings.some(s => 
      config.requireHumanApproval!.includes(s)
    );
  }

  async executeStep(stepId: number, userId?: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    const [step] = await db
      .select()
      .from(agentSessionSteps)
      .where(eq(agentSessionSteps.id, stepId));

    if (!step) {
      return { success: false, error: "Step not found", executionTimeMs: 0 };
    }

    if (step.status === "awaiting_approval") {
      return { 
        success: false, 
        error: "Step is awaiting human approval", 
        executionTimeMs: 0,
        awaitingApproval: true 
      };
    }

    const session = await this.getSession(step.sessionId);
    if (!session) {
      return { success: false, error: "Session not found", executionTimeMs: 0 };
    }

    const config = session.config as SessionConfig;

    if (this.requiresApproval(step, config) && step.status === "pending") {
      await this.requestApproval(
        step.sessionId,
        step.id,
        `Step "${step.skillUsed || step.agentType}" requires human approval before execution`,
        userId
      );
      return {
        success: false,
        error: "Step requires human approval",
        executionTimeMs: Date.now() - startTime,
        awaitingApproval: true,
      };
    }

    await db
      .update(agentSessionSteps)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(agentSessionSteps.id, stepId));

    try {
      if (step.dependsOnSteps && step.dependsOnSteps.length > 0) {
        const dependentSteps = await db
          .select()
          .from(agentSessionSteps)
          .where(
            and(
              eq(agentSessionSteps.sessionId, step.sessionId),
              sql`${agentSessionSteps.stepNumber} = ANY(${step.dependsOnSteps})`
            )
          );

        const allCompleted = dependentSteps.every(s => s.status === "completed");
        if (!allCompleted) {
          throw new Error("Dependent steps not yet completed");
        }
      }

      let result: any;
      if (step.skillUsed) {
        const skill = skillRegistry.getSkillById(step.skillUsed);
        if (skill) {
          const sessionContext = session.sharedContext as SessionContext;
          const context = {
            organizationId: step.organizationId,
            userId: userId || "system",
            sharedContext: sessionContext,
          };
          
          const input = {
            ...(step.input || {}),
            ...(sessionContext?.intermediateResults || {}),
          };
          
          result = await skill.execute(input, context);
        } else {
          throw new Error(`Skill not found: ${step.skillUsed}`);
        }
      } else {
        result = { message: "Step completed (no skill specified)" };
      }

      const executionTimeMs = Date.now() - startTime;
      const timestamp = new Date().toISOString();

      await db
        .update(agentSessionSteps)
        .set({
          status: "completed",
          output: result,
          completedAt: new Date(),
          executionTimeMs,
        })
        .where(eq(agentSessionSteps.id, stepId));

      if (result?.data) {
        const outputKey = `step_${step.stepNumber}`;
        const structuredOutput: StructuredOutput = {
          data: result.data,
          timestamp,
          agentType: step.agentType,
          stepNumber: step.stepNumber,
          version: 1,
        };

        await this.updateSessionContext(step.sessionId, {
          intermediateResults: {
            [outputKey]: result.data,
          },
          structuredOutputs: {
            [outputKey]: [structuredOutput],
          },
        });
      }

      return { success: true, output: result, executionTimeMs };
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;

      await db
        .update(agentSessionSteps)
        .set({
          status: "failed",
          error: error.message,
          completedAt: new Date(),
          executionTimeMs,
        })
        .where(eq(agentSessionSteps.id, stepId));

      return { success: false, error: error.message, executionTimeMs };
    }
  }

  async executeSession(sessionId: number, userId?: string): Promise<{
    success: boolean;
    completedSteps: number;
    failedSteps: number;
    awaitingApproval: number;
    results: Array<{ stepNumber: number; result: ExecutionResult }>;
  }> {
    const steps = await this.getSessionSteps(sessionId);
    const results: Array<{ stepNumber: number; result: ExecutionResult }> = [];
    let completedSteps = 0;
    let failedSteps = 0;
    let awaitingApproval = 0;

    for (const step of steps) {
      if (step.status === "completed") {
        completedSteps++;
        continue;
      }
      if (step.status === "skipped") continue;
      if (step.status === "awaiting_approval") {
        awaitingApproval++;
        continue;
      }

      const result = await this.executeStep(step.id, userId);
      results.push({ stepNumber: step.stepNumber, result });

      if (result.awaitingApproval) {
        awaitingApproval++;
        continue;
      }

      if (result.success) {
        completedSteps++;
      } else {
        failedSteps++;
        break;
      }
    }

    const success = failedSteps === 0 && awaitingApproval === 0;
    if (success && completedSteps === steps.length) {
      await this.completeSession(sessionId, "completed");
    } else if (failedSteps > 0) {
      await this.completeSession(sessionId, "failed");
    }

    return { success, completedSteps, failedSteps, awaitingApproval, results };
  }

  async subscribe(
    organizationId: number,
    data: SubscriptionData
  ): Promise<{ id: number }> {
    const [subscription] = await db.insert(eventSubscriptions).values({
      organizationId,
      subscriberType: data.subscriberType,
      subscriberId: data.subscriberId,
      eventType: data.eventType,
      eventFilter: {
        ...(data.eventFilter || {}),
        triggerAction: data.triggerAction,
        triggerConfig: data.triggerConfig,
      } as any,
      isActive: true,
    }).returning();

    return { id: subscription.id };
  }

  async unsubscribe(subscriptionId: number): Promise<void> {
    await db
      .update(eventSubscriptions)
      .set({ isActive: false })
      .where(eq(eventSubscriptions.id, subscriptionId));
  }

  async getSubscriptions(organizationId: number, eventType?: string) {
    let query = db
      .select()
      .from(eventSubscriptions)
      .where(
        and(
          eq(eventSubscriptions.organizationId, organizationId),
          eq(eventSubscriptions.isActive, true)
        )
      );

    if (eventType) {
      query = db
        .select()
        .from(eventSubscriptions)
        .where(
          and(
            eq(eventSubscriptions.organizationId, organizationId),
            eq(eventSubscriptions.isActive, true),
            eq(eventSubscriptions.eventType, eventType)
          )
        );
    }

    return query;
  }

  private evaluateCondition(condition: EventCondition, payload: Record<string, any>): boolean {
    const fieldValue = this.getNestedValue(payload, condition.field);
    
    switch (condition.operator) {
      case "eq":
        return fieldValue === condition.value;
      case "neq":
        return fieldValue !== condition.value;
      case "gt":
        return typeof fieldValue === "number" && fieldValue > condition.value;
      case "gte":
        return typeof fieldValue === "number" && fieldValue >= condition.value;
      case "lt":
        return typeof fieldValue === "number" && fieldValue < condition.value;
      case "lte":
        return typeof fieldValue === "number" && fieldValue <= condition.value;
      case "contains":
        if (typeof fieldValue === "string") {
          return fieldValue.includes(condition.value);
        }
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(condition.value);
        }
        return false;
      case "in":
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      case "exists":
        return fieldValue !== undefined && fieldValue !== null;
      default:
        return false;
    }
  }

  private getNestedValue(obj: Record<string, any>, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  private matchesFilter(
    filter: EventFilter | null,
    payload: Record<string, any>,
    relatedEntityType?: string,
    relatedEntityId?: number
  ): boolean {
    if (!filter) return true;

    if (filter.entityType && filter.entityType !== relatedEntityType) {
      return false;
    }
    if (filter.entityId && filter.entityId !== relatedEntityId) {
      return false;
    }

    if (filter.conditions && filter.conditions.length > 0) {
      return filter.conditions.every(condition => 
        this.evaluateCondition(condition, payload)
      );
    }

    return true;
  }

  private async triggerSubscriptionAction(
    subscription: any,
    event: any,
    organizationId: number
  ): Promise<void> {
    const filter = subscription.eventFilter as (EventFilter & { 
      triggerAction?: TriggerAction;
      triggerConfig?: Record<string, any>;
    }) | null;

    const triggerAction = filter?.triggerAction;
    const triggerConfig = filter?.triggerConfig;

    if (!triggerAction) {
      console.log(`[orchestration] No trigger action for subscription ${subscription.id}`);
      return;
    }

    switch (triggerAction) {
      case "create_task":
        await db.insert(agentTasks).values({
          organizationId,
          agentType: subscription.subscriberId,
          status: "pending",
          priority: triggerConfig?.taskPriority || "normal",
          input: {
            ...(triggerConfig?.taskInput || {}),
            triggeredByEvent: event.id,
            eventType: event.eventType,
            eventPayload: event.payload,
          },
        });
        console.log(`[orchestration] Created task for agent ${subscription.subscriberId} from event ${event.eventType}`);
        break;

      case "start_session":
        const sessionType = (triggerConfig?.sessionType || "custom") as SessionType;
        await this.createSession(organizationId, {
          name: `Auto-session from ${event.eventType}`,
          sessionType,
          initiatedBy: "event_trigger",
          sharedContext: {
            inputs: {
              triggeredByEvent: event.id,
              eventPayload: event.payload,
            },
          },
        });
        console.log(`[orchestration] Started session from event ${event.eventType}`);
        break;

      case "call_webhook":
        if (triggerConfig?.webhookUrl) {
          try {
            await fetch(triggerConfig.webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                eventId: event.id,
                eventType: event.eventType,
                payload: event.payload,
                triggeredAt: new Date().toISOString(),
              }),
            });
            console.log(`[orchestration] Called webhook for event ${event.eventType}`);
          } catch (error: any) {
            console.error(`[orchestration] Webhook call failed: ${error.message}`);
          }
        }
        break;
    }
  }

  async publishEvent(
    organizationId: number,
    data: {
      eventType: string;
      eventSource: "system" | "user" | "agent" | "external";
      payload: Record<string, any>;
      relatedEntityType?: string;
      relatedEntityId?: number;
    }
  ): Promise<{ eventId: number; triggeredSubscriptions: number; actionsTriggered: number }> {
    const [event] = await db.insert(agentEvents).values({
      organizationId,
      eventType: data.eventType,
      eventSource: data.eventSource,
      payload: data.payload,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
    }).returning();

    const subscriptions = await this.getSubscriptions(organizationId, data.eventType);

    let triggeredCount = 0;
    let actionsTriggered = 0;

    for (const sub of subscriptions) {
      const filter = sub.eventFilter as EventFilter | null;
      
      if (!this.matchesFilter(filter, data.payload, data.relatedEntityType, data.relatedEntityId)) {
        continue;
      }

      triggeredCount++;
      
      await db
        .update(eventSubscriptions)
        .set({
          lastTriggeredAt: new Date(),
          triggerCount: sql`${eventSubscriptions.triggerCount} + 1`,
        })
        .where(eq(eventSubscriptions.id, sub.id));

      console.log(`[orchestration] Triggered subscription ${sub.id} for event ${data.eventType}`);

      try {
        await this.triggerSubscriptionAction(sub, event, organizationId);
        actionsTriggered++;
      } catch (error: any) {
        console.error(`[orchestration] Failed to trigger action for subscription ${sub.id}: ${error.message}`);
      }
    }

    await db
      .update(agentEvents)
      .set({ processedAt: new Date() })
      .where(eq(agentEvents.id, event.id));

    return { eventId: event.id, triggeredSubscriptions: triggeredCount, actionsTriggered };
  }

  async getEvents(
    organizationId: number,
    options?: {
      eventType?: string;
      limit?: number;
      unprocessedOnly?: boolean;
    }
  ) {
    const conditions = [eq(agentEvents.organizationId, organizationId)];
    
    if (options?.eventType) {
      conditions.push(eq(agentEvents.eventType, options.eventType));
    }
    if (options?.unprocessedOnly) {
      conditions.push(isNull(agentEvents.processedAt));
    }

    return db
      .select()
      .from(agentEvents)
      .where(and(...conditions))
      .orderBy(desc(agentEvents.createdAt))
      .limit(options?.limit || 100);
  }

  async recordOutcome(
    organizationId: number,
    data: {
      outcomeType: string;
      outcome: { success: boolean; value?: number; details?: Record<string, any> };
      contributingFactors?: Record<string, any>;
      relatedLeadId?: number;
      relatedPropertyId?: number;
      relatedDealId?: number;
    }
  ): Promise<{ id: number }> {
    const [telemetry] = await db.insert(outcomeTelemetry).values({
      organizationId,
      outcomeType: data.outcomeType,
      outcome: data.outcome,
      contributingFactors: data.contributingFactors,
      relatedLeadId: data.relatedLeadId,
      relatedPropertyId: data.relatedPropertyId,
      relatedDealId: data.relatedDealId,
    }).returning();

    return { id: telemetry.id };
  }

  async getOutcomes(
    organizationId: number,
    options?: {
      outcomeType?: string;
      successOnly?: boolean;
      limit?: number;
    }
  ) {
    const conditions = [eq(outcomeTelemetry.organizationId, organizationId)];

    if (options?.outcomeType) {
      conditions.push(eq(outcomeTelemetry.outcomeType, options.outcomeType));
    }

    let results = await db
      .select()
      .from(outcomeTelemetry)
      .where(and(...conditions))
      .orderBy(desc(outcomeTelemetry.createdAt))
      .limit(options?.limit || 100);

    if (options?.successOnly) {
      results = results.filter(r => (r.outcome as any)?.success === true);
    }

    return results;
  }

  async analyzeOutcomes(
    organizationId: number,
    outcomeType: string
  ): Promise<{
    totalCount: number;
    successCount: number;
    successRate: number;
    avgValue?: number;
    topFactors: Array<{ factor: string; correlation: number }>;
  }> {
    const outcomes = await this.getOutcomes(organizationId, { outcomeType, limit: 500 });

    const totalCount = outcomes.length;
    const successCount = outcomes.filter(o => (o.outcome as any)?.success).length;
    const successRate = totalCount > 0 ? successCount / totalCount : 0;

    const values = outcomes
      .filter(o => (o.outcome as any)?.value !== undefined)
      .map(o => (o.outcome as any).value as number);
    const avgValue = values.length > 0 
      ? values.reduce((a, b) => a + b, 0) / values.length 
      : undefined;

    const factorCounts: Record<string, { success: number; total: number }> = {};
    for (const outcome of outcomes) {
      const factors = outcome.contributingFactors as Record<string, any>;
      if (!factors) continue;

      const isSuccess = (outcome.outcome as any)?.success;
      
      for (const [key, value] of Object.entries(factors)) {
        const factorKey = `${key}:${JSON.stringify(value)}`;
        if (!factorCounts[factorKey]) {
          factorCounts[factorKey] = { success: 0, total: 0 };
        }
        factorCounts[factorKey].total++;
        if (isSuccess) factorCounts[factorKey].success++;
      }
    }

    const topFactors = Object.entries(factorCounts)
      .map(([factor, counts]) => ({
        factor,
        correlation: counts.total > 5 ? counts.success / counts.total : 0,
      }))
      .filter(f => f.correlation > 0.5)
      .sort((a, b) => b.correlation - a.correlation)
      .slice(0, 10);

    return {
      totalCount,
      successCount,
      successRate,
      avgValue,
      topFactors,
    };
  }

  async getStructuredOutputs(sessionId: number): Promise<Record<string, StructuredOutput[]>> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    
    const context = session.sharedContext as SessionContext;
    return context.structuredOutputs || {};
  }

  async getOutputHistory(sessionId: number): Promise<SessionContext["outputHistory"]> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    
    const context = session.sharedContext as SessionContext;
    return context.outputHistory || [];
  }

  async createDueDiligencePod(
    organizationId: number,
    data: {
      propertyId: number;
      initiatedBy?: string;
    }
  ): Promise<AgentSession> {
    const session = await this.createSession(organizationId, {
      name: `Due Diligence Pod - Property ${data.propertyId}`,
      sessionType: "due_diligence_pod",
      initiatedBy: data.initiatedBy,
      sharedContext: {
        targetEntity: { type: "property", id: data.propertyId },
        inputs: { propertyId: data.propertyId },
        intermediateResults: {},
        decisions: [],
        structuredOutputs: {},
        pendingApprovals: {},
        outputHistory: [],
      },
      config: {
        participatingAgents: ["research", "operations"],
        requireHumanApproval: ["high_risk_assessment"],
        maxSteps: 10,
        timeout: 300000,
      },
    });

    await this.addStep(session.id, organizationId, {
      agentType: "research",
      skillName: "lookupParcel",
      input: { propertyId: data.propertyId },
      description: "Lookup parcel data",
    });

    await this.addStep(session.id, organizationId, {
      agentType: "research",
      skillName: "lookupEnvironmental",
      input: { propertyId: data.propertyId },
      dependsOnSteps: [1],
      description: "Check environmental risks",
    });

    await this.addStep(session.id, organizationId, {
      agentType: "research",
      skillName: "researchComps",
      input: { propertyId: data.propertyId },
      dependsOnSteps: [1],
      description: "Research comparable sales",
    });

    await this.addStep(session.id, organizationId, {
      agentType: "research",
      skillName: "browserResearch",
      input: { 
        templateName: "County Assessor Lookup",
        propertyId: data.propertyId,
      },
      dependsOnSteps: [1],
      description: "Check county assessor records",
    });

    return session;
  }

  async createAcquisitionRadarSession(
    organizationId: number,
    data: {
      targetCounty: string;
      targetState: string;
      criteria?: Record<string, any>;
      initiatedBy?: string;
    }
  ): Promise<AgentSession> {
    const session = await this.createSession(organizationId, {
      name: `Acquisition Radar - ${data.targetCounty}, ${data.targetState}`,
      sessionType: "acquisition_research",
      initiatedBy: data.initiatedBy,
      sharedContext: {
        inputs: {
          county: data.targetCounty,
          state: data.targetState,
          criteria: data.criteria,
        },
        intermediateResults: {},
        decisions: [],
        structuredOutputs: {},
        pendingApprovals: {},
        outputHistory: [],
      },
      config: {
        participatingAgents: ["research", "deals"],
        maxSteps: 15,
        timeout: 600000,
      },
    });

    return session;
  }
}

export const agentOrchestration = new AgentOrchestrationService();

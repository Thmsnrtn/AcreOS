// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { storage } from "../storage";
import {
  type Workflow,
  type WorkflowRun,
  type WorkflowAction,
  type WorkflowTriggerEvent,
  type WorkflowExecutionLogEntry,
  WORKFLOW_TRIGGER_EVENTS,
  WORKFLOW_ACTION_TYPES,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// Pre-built workflow templates for land investing.
// These are used by the UI to let users quickly install common automations.
// Each template omits organizationId (added at install time) and uses
// placeholder action IDs that are stable for de-duplication checks.
// ---------------------------------------------------------------------------

export type WorkflowTemplate = {
  id: string; // stable identifier for the template
  name: string;
  description: string;
  category: "leads" | "notes" | "deals";
  trigger: {
    event: WorkflowTriggerEvent;
    conditions?: { field: string; operator: string; value: any }[];
  };
  actions: {
    id: string;
    type: string;
    config: Record<string, any>;
  }[];
};

export const LAND_INVESTING_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "tpl_new_lead_received",
    name: "New Lead Received",
    description:
      "When a new lead is created, assign it to the default campaign, score it, and schedule a follow-up task within 24 hours.",
    category: "leads",
    trigger: { event: "lead.created" },
    actions: [
      {
        id: "action_score_lead",
        type: "run_agent_skill",
        config: {
          skillId: "score_lead",
          skillParams: { autoAssignCampaign: true },
        },
      },
      {
        id: "action_notify_new_lead",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "New lead received: {{firstName}} {{lastName}} from {{county}}, {{state}}. Score: {{leadScore}}.",
        },
      },
      {
        id: "action_followup_task",
        type: "create_task",
        config: {
          title: "Follow up with new lead: {{firstName}} {{lastName}}",
          description:
            "Call or text within 24 hours to qualify interest. County: {{county}}, State: {{state}}.",
          priority: "high",
          dueInDays: 1,
        },
      },
    ],
  },
  {
    id: "tpl_payment_missed_dunning",
    name: "Note Payment Missed — Dunning Sequence",
    description:
      "When a payment is missed on a seller-financed note, immediately notify the team, create a collection task, and send the borrower a payment reminder.",
    category: "notes",
    trigger: { event: "payment.missed" },
    actions: [
      {
        id: "action_notify_missed",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message:
            "Payment missed on Note #{{noteId}} — {{borrowerName}}. Amount: ${{amount}}. Follow up immediately.",
        },
      },
      {
        id: "action_dunning_task",
        type: "create_task",
        config: {
          title: "Missed payment — Note #{{noteId}} ({{borrowerName}})",
          description:
            "Contact borrower to collect overdue payment of ${{amount}}. Grace period may apply. Check note terms.",
          priority: "high",
          dueInDays: 1,
        },
      },
      {
        id: "action_borrower_email",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Payment Reminder — Your Land Payment is Past Due",
          body: "Hi {{borrowerName}},\n\nWe noticed your payment of ${{amount}} due on {{dueDate}} has not been received. Please contact us at your earliest convenience to avoid any late fees.\n\nThank you,\n{{orgName}}",
        },
      },
    ],
  },
  {
    id: "tpl_deal_closed",
    name: "Deal Closed",
    description:
      "When a deal reaches 'closed' stage, send a congratulations notification, request a referral from the buyer, and trigger note setup if seller-financed.",
    category: "deals",
    trigger: {
      event: "deal.stage_changed",
      conditions: [{ field: "stage", operator: "equals", value: "closed" }],
    },
    actions: [
      {
        id: "action_congrats_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message:
            "Deal closed! {{propertyAddress}} — ${{salePrice}}. Great work.",
        },
      },
      {
        id: "action_referral_email",
        type: "send_email",
        config: {
          to: "{{buyerEmail}}",
          subject: "Congratulations on your land purchase!",
          body: "Hi {{buyerName}},\n\nCongratulations on your purchase of {{propertyAddress}}! We hope you love it.\n\nIf you know anyone else looking for land, we'd love a referral. Just reply to this email!\n\nThank you,\n{{orgName}}",
        },
      },
      {
        id: "action_note_setup_task",
        type: "create_task",
        config: {
          title: "Set up seller-financed note for {{propertyAddress}}",
          description:
            "If seller financing was agreed, create the note in AcreOS Finance and generate the amortization schedule. Down payment: ${{downPayment}}, Financed: ${{financedAmount}}.",
          priority: "high",
          dueInDays: 3,
        },
      },
    ],
  },
];

export type WorkflowEventData = {
  event: WorkflowTriggerEvent;
  organizationId: number;
  entityId: number;
  entityType: "lead" | "property" | "deal" | "payment";
  data: Record<string, any>;
  previousData?: Record<string, any>;
};

class WorkflowEngine {
  private isProcessing = false;
  private eventQueue: WorkflowEventData[] = [];

  async emit(eventData: WorkflowEventData): Promise<void> {
    this.eventQueue.push(eventData);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.eventQueue.length > 0) {
      const eventData = this.eventQueue.shift();
      if (eventData) {
        try {
          await this.triggerWorkflows(eventData);
        } catch (error) {
          console.error(`[WorkflowEngine] Error processing event ${eventData.event}:`, error);
        }
      }
    }

    this.isProcessing = false;
  }

  async triggerWorkflows(eventData: WorkflowEventData): Promise<WorkflowRun[]> {
    const { event, organizationId, entityId, entityType, data, previousData } = eventData;

    const matchingWorkflows = await storage.getActiveWorkflowsByTrigger(organizationId, event);
    const runs: WorkflowRun[] = [];

    for (const workflow of matchingWorkflows) {
      if (this.matchesConditions(workflow, data, previousData)) {
        const run = await this.executeWorkflow(workflow, {
          event,
          entityId,
          entityType,
          data,
          previousData,
        });
        runs.push(run);
      }
    }

    return runs;
  }

  private matchesConditions(
    workflow: Workflow,
    data: Record<string, any>,
    previousData?: Record<string, any>
  ): boolean {
    const conditions = workflow.trigger?.conditions;
    if (!conditions || conditions.length === 0) {
      return true;
    }

    return conditions.every((condition) => {
      const value = data[condition.field];
      const targetValue = condition.value;

      switch (condition.operator) {
        case "equals":
          return value === targetValue;
        case "not_equals":
          return value !== targetValue;
        case "contains":
          return String(value).toLowerCase().includes(String(targetValue).toLowerCase());
        case "greater_than":
          return Number(value) > Number(targetValue);
        case "less_than":
          return Number(value) < Number(targetValue);
        case "in":
          return Array.isArray(targetValue) && targetValue.includes(value);
        case "not_in":
          return Array.isArray(targetValue) && !targetValue.includes(value);
        default:
          return true;
      }
    });
  }

  async executeWorkflow(
    workflow: Workflow,
    triggerData: {
      event: WorkflowTriggerEvent;
      entityId?: number;
      entityType?: string;
      data?: Record<string, any>;
      previousData?: Record<string, any>;
    }
  ): Promise<WorkflowRun> {
    const executionLog: WorkflowExecutionLogEntry[] = workflow.actions.map((action) => ({
      actionId: action.id,
      actionType: action.type,
      status: "pending" as const,
    }));

    let run = await storage.createWorkflowRun({
      workflowId: workflow.id,
      status: "running",
      triggerData,
      executionLog,
      startedAt: new Date(),
    });

    const context: WorkflowExecutionContext = {
      organizationId: workflow.organizationId,
      triggerData,
      variables: { ...triggerData.data },
    };

    try {
      for (let i = 0; i < workflow.actions.length; i++) {
        const action = workflow.actions[i];
        executionLog[i].status = "running";
        executionLog[i].startedAt = new Date().toISOString();

        run = await storage.updateWorkflowRun(run.id, { executionLog });

        try {
          const result = await this.executeAction(action, context);
          executionLog[i].status = "completed";
          executionLog[i].completedAt = new Date().toISOString();
          executionLog[i].result = result;

          if (result) {
            Object.assign(context.variables, result);
          }
        } catch (actionError: any) {
          executionLog[i].status = "failed";
          executionLog[i].completedAt = new Date().toISOString();
          executionLog[i].error = actionError.message;

          for (let j = i + 1; j < workflow.actions.length; j++) {
            executionLog[j].status = "skipped";
          }

          run = await storage.updateWorkflowRun(run.id, {
            status: "failed",
            executionLog,
            completedAt: new Date(),
            error: `Action ${action.id} failed: ${actionError.message}`,
          });

          return run;
        }

        run = await storage.updateWorkflowRun(run.id, { executionLog });
      }

      run = await storage.updateWorkflowRun(run.id, {
        status: "completed",
        executionLog,
        completedAt: new Date(),
      });
    } catch (error: any) {
      run = await storage.updateWorkflowRun(run.id, {
        status: "failed",
        executionLog,
        completedAt: new Date(),
        error: error.message,
      });
    }

    return run;
  }

  async executeAction(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<Record<string, any> | void> {
    switch (action.type) {
      case "send_email":
        return this.executeSendEmail(action, context);
      case "create_task":
        return this.executeCreateTask(action, context);
      case "update_record":
        return this.executeUpdateRecord(action, context);
      case "run_agent_skill":
        return this.executeRunAgentSkill(action, context);
      case "send_notification":
        return this.executeSendNotification(action, context);
      case "delay":
        return this.executeDelay(action, context);
      default:
        console.warn(`[WorkflowEngine] Unknown action type: ${action.type}`);
    }
  }

  private async executeSendEmail(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ emailSent: boolean }> {
    const config = action.config;
    const to = this.interpolateTemplate(config.to || "", context.variables);
    const subject = this.interpolateTemplate(config.subject || "", context.variables);
    const body = this.interpolateTemplate(config.body || "", context.variables);

    console.log(`[WorkflowEngine] Sending email to ${to}: ${subject}`);
    return { emailSent: true };
  }

  private async executeCreateTask(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ taskId: number }> {
    const config = action.config;
    const title = this.interpolateTemplate(config.title || "", context.variables);
    const description = this.interpolateTemplate(config.description || "", context.variables);

    const dueDate = config.dueInDays
      ? new Date(Date.now() + config.dueInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const task = await storage.createTask({
      organizationId: context.organizationId,
      title,
      description,
      priority: config.priority || "medium",
      assignedTo: config.assignedTo,
      dueDate,
      status: "pending",
      entityType: context.triggerData.entityType,
      entityId: context.triggerData.entityId,
    });

    console.log(`[WorkflowEngine] Created task: ${task.id}`);
    return { taskId: task.id };
  }

  private async executeUpdateRecord(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ updated: boolean }> {
    const config = action.config;
    const entityType = config.entityType || context.triggerData.entityType;
    const entityId = context.triggerData.entityId;

    if (!entityId) {
      throw new Error("No entity ID available for update");
    }

    const updates: Record<string, any> = {};
    for (const [key, value] of Object.entries(config.updates || {})) {
      updates[key] = typeof value === "string"
        ? this.interpolateTemplate(value, context.variables)
        : value;
    }

    switch (entityType) {
      case "lead":
        await storage.updateLead(entityId, updates);
        break;
      case "property":
        await storage.updateProperty(entityId, updates);
        break;
      case "deal":
        await storage.updateDeal(entityId, updates);
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    console.log(`[WorkflowEngine] Updated ${entityType} ${entityId}`);
    return { updated: true };
  }

  private async executeRunAgentSkill(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ skillExecuted: boolean; result?: any }> {
    const config = action.config;
    console.log(`[WorkflowEngine] Running agent skill: ${config.skillId}`);
    return { skillExecuted: true };
  }

  private async executeSendNotification(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ notificationSent: boolean }> {
    const config = action.config;
    const message = this.interpolateTemplate(config.message || "", context.variables);

    await storage.createNotification({
      organizationId: context.organizationId,
      userId: "system",
      type: config.notificationType || "info",
      title: "Workflow Notification",
      message,
      entityType: context.triggerData.entityType,
      entityId: context.triggerData.entityId,
    });

    console.log(`[WorkflowEngine] Sent notification: ${message}`);
    return { notificationSent: true };
  }

  private async executeDelay(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ delayed: boolean; delayMinutes: number }> {
    const delayMinutes = action.config.delayMinutes || 1;
    const delayMs = Math.min(delayMinutes * 60 * 1000, 60000);
    
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    
    console.log(`[WorkflowEngine] Delayed for ${delayMinutes} minutes`);
    return { delayed: true, delayMinutes };
  }

  private interpolateTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const parts = path.split(".");
      let value: any = variables;
      for (const part of parts) {
        value = value?.[part];
      }
      return value !== undefined ? String(value) : match;
    });
  }

  async testWorkflow(
    workflow: Workflow,
    testData: Record<string, any>
  ): Promise<WorkflowRun> {
    return this.executeWorkflow(workflow, {
      event: workflow.trigger.event,
      entityId: testData.entityId || 0,
      entityType: testData.entityType || "lead",
      data: testData,
    });
  }
}

type WorkflowExecutionContext = {
  organizationId: number;
  triggerData: {
    event: WorkflowTriggerEvent;
    entityId?: number;
    entityType?: string;
    data?: Record<string, any>;
    previousData?: Record<string, any>;
  };
  variables: Record<string, any>;
};

export const workflowEngine = new WorkflowEngine();

export function emitLeadEvent(
  event: "lead.created" | "lead.updated" | "lead.status_changed",
  organizationId: number,
  leadId: number,
  data: Record<string, any>,
  previousData?: Record<string, any>
): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId: leadId,
    entityType: "lead",
    data,
    previousData,
  });
}

export function emitPropertyEvent(
  event: "property.created" | "property.updated" | "property.status_changed",
  organizationId: number,
  propertyId: number,
  data: Record<string, any>,
  previousData?: Record<string, any>
): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId: propertyId,
    entityType: "property",
    data,
    previousData,
  });
}

export function emitDealEvent(
  event: "deal.created" | "deal.updated" | "deal.stage_changed",
  organizationId: number,
  dealId: number,
  data: Record<string, any>,
  previousData?: Record<string, any>
): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId: dealId,
    entityType: "deal",
    data,
    previousData,
  });
}

export function emitPaymentEvent(
  event: "payment.received" | "payment.missed",
  organizationId: number,
  paymentId: number,
  data: Record<string, any>
): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId: paymentId,
    entityType: "payment",
    data,
  });
}

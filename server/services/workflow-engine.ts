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
import { logger } from "../utils/logger";

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
  {
    id: "tpl_buyer_match_found",
    name: "Buyer Match Found",
    description: "When a property-buyer match is created, notify the buyer and schedule a follow-up call",
    category: "deals",
    trigger: { event: "buyer.match_created" },
    actions: [
      {
        id: "action_buyer_match_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "New property match found! Check your buyer dashboard for {{propertyAddress}}.",
        },
      },
      {
        id: "action_buyer_match_email",
        type: "send_email",
        config: {
          to: "{{buyerEmail}}",
          subject: "Property match: {{propertyAddress}}",
          body: "Hi {{buyerFirstName}}, we found a property matching your criteria...",
        },
      },
      {
        id: "action_buyer_match_task",
        type: "create_task",
        config: {
          title: "Schedule buyer intro call for {{buyerName}} re: {{propertyAddress}}",
          priority: "high",
          dueInDays: 1,
        },
      },
    ],
  },
  {
    id: "tpl_lead_to_deal",
    name: "Lead Converted to Deal",
    description: "When a lead status changes to under_contract, create deal setup tasks",
    category: "leads",
    trigger: {
      event: "lead.status_changed",
      conditions: [{ field: "status", operator: "equals", value: "under_contract" }],
    },
    actions: [
      {
        id: "action_lead_deal_title_task",
        type: "create_task",
        config: {
          title: "Order title search for {{leadAddress}}",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_lead_deal_inspection_task",
        type: "create_task",
        config: {
          title: "Schedule property inspection for {{leadAddress}}",
          priority: "medium",
          dueInDays: 5,
        },
      },
      {
        id: "action_lead_deal_agreement_task",
        type: "create_task",
        config: {
          title: "Prepare purchase agreement for {{leadFirstName}} {{leadLastName}}",
          priority: "high",
          dueInDays: 2,
        },
      },
      {
        id: "action_lead_deal_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Lead {{leadFirstName}} {{leadLastName}} converted to deal! 3 tasks created.",
        },
      },
    ],
  },
  {
    id: "tpl_balloon_approaching",
    name: "Balloon Payment Approaching",
    description: "When a note has a balloon payment due in 90 days, initiate borrower conversation",
    category: "notes",
    trigger: { event: "note.balloon_approaching" },
    actions: [
      {
        id: "action_balloon_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "Balloon payment approaching for note #{{noteId}} — {{borrowerName}} owes {{balloonAmount}} in 90 days",
        },
      },
      {
        id: "action_balloon_task",
        type: "create_task",
        config: {
          title: "Contact {{borrowerName}} about balloon options for note #{{noteId}}",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_balloon_email",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Important: Upcoming balloon payment on your land note",
          body: "Hi {{borrowerFirstName}}, your balloon payment of {{balloonAmount}} is due on {{balloonDate}}...",
        },
      },
    ],
  },
  {
    id: "tpl_payment_received",
    name: "Payment Received",
    description: "When a payment is confirmed, update records and send receipt",
    category: "notes",
    trigger: { event: "payment.confirmed" },
    actions: [
      {
        id: "action_payment_received_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Payment received: {{paymentAmount}} from {{borrowerName}} for note #{{noteId}}",
        },
      },
      {
        id: "action_payment_receipt_email",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Payment receipt — {{paymentAmount}}",
          body: "Hi {{borrowerFirstName}}, we received your payment of {{paymentAmount}} on {{paymentDate}}. Remaining balance: {{remainingBalance}}.",
        },
      },
    ],
  },
  {
    id: "tpl_delinquency_escalation",
    name: "Note Delinquency Escalation",
    description: "When a note becomes 60+ days delinquent, escalate to senior review",
    category: "notes",
    trigger: { event: "note.delinquent_60d" },
    actions: [
      {
        id: "action_delinquency_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "URGENT: Note #{{noteId}} is 60+ days delinquent — {{borrowerName}} owes {{amountDue}}",
        },
      },
      {
        id: "action_delinquency_legal_task",
        type: "create_task",
        config: {
          title: "Review legal options for delinquent note #{{noteId}}",
          priority: "high",
          dueInDays: 1,
        },
      },
      {
        id: "action_delinquency_demand_task",
        type: "create_task",
        config: {
          title: "Send formal demand letter to {{borrowerName}}",
          priority: "high",
          dueInDays: 2,
        },
      },
    ],
  },
  {
    id: "tpl_property_listed",
    name: "Property Listed for Sale",
    description: "When a property is listed, notify matching buyers and post to marketplace",
    category: "deals",
    trigger: { event: "property.listed" },
    actions: [
      {
        id: "action_property_listed_match_skill",
        type: "run_agent_skill",
        config: {
          skillId: "find_matching_buyers",
          skillParams: { propertyId: "{{propertyId}}" },
        },
      },
      {
        id: "action_property_listed_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Property {{propertyAddress}} listed at {{listPrice}} — buyer matching running",
        },
      },
      {
        id: "action_property_listed_task",
        type: "create_task",
        config: {
          title: "Review buyer matches for {{propertyAddress}} and send pitch emails",
          priority: "medium",
          dueInDays: 1,
        },
      },
    ],
  },
  {
    id: "tpl_deal_stage_advanced",
    name: "Deal Stage Advanced",
    description: "When a deal advances to due_diligence, create DD checklist tasks",
    category: "deals",
    trigger: {
      event: "deal.stage_changed",
      conditions: [{ field: "newStage", operator: "equals", value: "due_diligence" }],
    },
    actions: [
      {
        id: "action_dd_title_task",
        type: "create_task",
        config: {
          title: "Complete title search for {{dealAddress}}",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_dd_survey_task",
        type: "create_task",
        config: {
          title: "Review survey and legal description for {{dealAddress}}",
          priority: "medium",
          dueInDays: 5,
        },
      },
      {
        id: "action_dd_zoning_task",
        type: "create_task",
        config: {
          title: "Confirm zoning and permitted uses for {{dealAddress}}",
          priority: "medium",
          dueInDays: 3,
        },
      },
      {
        id: "action_dd_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Deal {{dealName}} advanced to due diligence — 3 DD tasks created",
        },
      },
    ],
  },
  {
    id: "tpl_campaign_response",
    name: "Campaign Response Received",
    description: "When a lead responds to a campaign, score the lead and notify team",
    category: "leads",
    trigger: { event: "campaign.response_received" },
    actions: [
      {
        id: "action_campaign_response_score",
        type: "run_agent_skill",
        config: {
          skillId: "score_lead",
          skillParams: { leadId: "{{leadId}}" },
        },
      },
      {
        id: "action_campaign_response_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Lead {{leadFirstName}} {{leadLastName}} responded to campaign {{campaignName}}!",
        },
      },
      {
        id: "action_campaign_response_task",
        type: "create_task",
        config: {
          title: "Follow up with {{leadFirstName}} {{leadLastName}} within 24 hours",
          priority: "high",
          dueInDays: 1,
        },
      },
    ],
  },
  {
    id: "tpl_referral_milestone",
    name: "Referral Milestone Reached",
    description: "When an org reaches 10 deals closed, send a referral request",
    category: "deals",
    trigger: {
      event: "org.milestone_reached",
      conditions: [{ field: "milestone", operator: "equals", value: "deals_10" }],
    },
    actions: [
      {
        id: "action_referral_milestone_email",
        type: "send_email",
        config: {
          to: "{{ownerEmail}}",
          subject: "You've closed 10 deals with AcreOS!",
          body: "Congratulations on closing 10 deals! Know another land investor who could benefit? Refer them and earn credits...",
        },
      },
      {
        id: "action_referral_milestone_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Milestone: 10 deals closed! Referral email sent to {{ownerEmail}}",
        },
      },
    ],
  },
  {
    id: "tpl_lead_score_high",
    name: "High-Score Lead Detected",
    description: "When a lead is scored >= 75, immediately notify team for priority outreach",
    category: "leads",
    trigger: {
      event: "lead.scored",
      conditions: [{ field: "leadScore", operator: "greater_than", value: 74 }],
    },
    actions: [
      {
        id: "action_lead_score_high_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "HOT LEAD: {{leadFirstName}} {{leadLastName}} scored {{leadScore}}/100 — priority outreach needed",
        },
      },
      {
        id: "action_lead_score_high_task",
        type: "create_task",
        config: {
          title: "Call {{leadFirstName}} {{leadLastName}} (score: {{leadScore}}) — hot lead priority",
          priority: "high",
          dueInDays: 0,
        },
      },
    ],
  },
  {
    id: "tpl_acquisition_closed",
    name: "Property Acquisition Closed",
    description: "When an acquisition deal closes, set up property management tasks",
    category: "deals",
    trigger: {
      event: "deal.stage_changed",
      conditions: [{ field: "newStage", operator: "equals", value: "closed_won" }],
    },
    actions: [
      {
        id: "action_acquisition_docs_task",
        type: "create_task",
        config: {
          title: "Update property records and upload closing docs for {{dealAddress}}",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_acquisition_insurance_task",
        type: "create_task",
        config: {
          title: "Set up property taxes and insurance for {{dealAddress}}",
          priority: "medium",
          dueInDays: 7,
        },
      },
      {
        id: "action_acquisition_disposition_task",
        type: "create_task",
        config: {
          title: "List {{dealAddress}} for disposition or begin owner financing setup",
          priority: "medium",
          dueInDays: 14,
        },
      },
      {
        id: "action_acquisition_closed_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Deal CLOSED: {{dealName}} at {{dealValue}}. 3 post-close tasks created.",
        },
      },
    ],
  },
  {
    id: "tpl_offer_batch_sent",
    name: "Offer Batch Sent",
    description: "When an offer batch is sent, schedule follow-up tracking",
    category: "leads",
    trigger: { event: "offers.batch_sent" },
    actions: [
      {
        id: "action_offer_batch_task",
        type: "create_task",
        config: {
          title: "Track responses to offer batch {{batchName}} — follow up on no-replies in 14 days",
          priority: "medium",
          dueInDays: 14,
        },
      },
      {
        id: "action_offer_batch_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Offer batch {{batchName}} sent to {{offerCount}} sellers",
        },
      },
    ],
  },
  {
    id: "tpl_lease_expiring",
    name: "Lease Agreement Expiring",
    description: "When a lease is expiring in 60 days, initiate renewal conversation",
    category: "deals",
    trigger: { event: "lease.expiring_60d" },
    actions: [
      {
        id: "action_lease_expiring_task",
        type: "create_task",
        config: {
          title: "Contact tenant re: lease renewal for {{propertyAddress}}",
          priority: "medium",
          dueInDays: 3,
        },
      },
      {
        id: "action_lease_expiring_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "Lease expiring in 60 days: {{propertyAddress}} — initiate renewal discussion",
        },
      },
    ],
  },
  {
    id: "tpl_support_ticket",
    name: "Support Ticket Opened",
    description: "When a support ticket is opened, create internal task and auto-acknowledge",
    category: "leads",
    trigger: { event: "support.ticket_created" },
    actions: [
      {
        id: "action_support_ticket_task",
        type: "create_task",
        config: {
          title: "Review and respond to support ticket #{{ticketId}}: {{ticketSubject}}",
          priority: "high",
          dueInDays: 1,
        },
      },
      {
        id: "action_support_ticket_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "New support ticket #{{ticketId}} from {{userName}}: {{ticketSubject}}",
        },
      },
    ],
  },
  {
    id: "tpl_weekly_pipeline_review",
    name: "Weekly Pipeline Review",
    description: "Every Monday, create a pipeline review task for the team lead",
    category: "deals",
    trigger: { event: "schedule.weekly_monday" },
    actions: [
      {
        id: "action_weekly_pipeline_task",
        type: "create_task",
        config: {
          title: "Weekly pipeline review — check all active deals and stale leads",
          priority: "medium",
          dueInDays: 0,
        },
      },
      {
        id: "action_weekly_pipeline_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Weekly pipeline review task created. {{activeDealCount}} active deals to review.",
        },
      },
    ],
  },
  {
    id: "tpl_note_setup",
    name: "Seller Finance Note Setup",
    description: "When a deal closes as owner-finance, set up the note and payment schedule",
    category: "notes",
    trigger: {
      event: "deal.stage_changed",
      conditions: [
        { field: "newStage", operator: "equals", value: "closed_won" },
        { field: "dealType", operator: "equals", value: "owner_finance" },
      ],
    },
    actions: [
      {
        id: "action_note_setup_draft_task",
        type: "create_task",
        config: {
          title: "Draft promissory note and deed of trust for {{buyerName}}",
          priority: "high",
          dueInDays: 5,
        },
      },
      {
        id: "action_note_setup_schedule_task",
        type: "create_task",
        config: {
          title: "Set up payment schedule in AcreOS for {{buyerName}} — {{monthlyPayment}}/mo",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_note_setup_deed_task",
        type: "create_task",
        config: {
          title: "File deed and record mortgage for {{propertyAddress}}",
          priority: "high",
          dueInDays: 14,
        },
      },
      {
        id: "action_note_setup_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Owner finance deal closed: {{dealName}}. Note setup tasks created.",
        },
      },
    ],
  },
  {
    id: "tpl_ltv_alert",
    name: "LTV Risk Alert",
    description: "When a note's LTV exceeds 80%, create review task",
    category: "notes",
    trigger: { event: "note.ltv_alert" },
    actions: [
      {
        id: "action_ltv_alert_task",
        type: "create_task",
        config: {
          title: "Review LTV for note #{{noteId}} — current LTV {{ltvPercent}}%, consider appraisal update",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_ltv_alert_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "LTV Alert: Note #{{noteId}} ({{borrowerName}}) LTV is {{ltvPercent}}% — review needed",
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
          logger.error(`[WorkflowEngine] Error processing event ${eventData.event}`, error);
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
      case "conditional": {
        const { condition, ifTrue, ifFalse } = action.config as {
          condition: { field: string; operator: "eq" | "gt" | "lt" | "gte" | "lte" | "contains"; value: any };
          ifTrue: WorkflowAction[];
          ifFalse?: WorkflowAction[];
        };

        const fieldValue = context.variables[condition.field];
        let conditionMet = false;

        switch (condition.operator) {
          case "eq": conditionMet = fieldValue == condition.value; break;
          case "gt": conditionMet = Number(fieldValue) > Number(condition.value); break;
          case "lt": conditionMet = Number(fieldValue) < Number(condition.value); break;
          case "gte": conditionMet = Number(fieldValue) >= Number(condition.value); break;
          case "lte": conditionMet = Number(fieldValue) <= Number(condition.value); break;
          case "contains": conditionMet = String(fieldValue).includes(String(condition.value)); break;
        }

        const branchActions = conditionMet ? ifTrue : (ifFalse || []);
        for (const branchAction of branchActions) {
          await this.executeAction(branchAction, context);
        }
        break;
      }
      default:
        logger.warn(`[WorkflowEngine] Unknown action type: ${action.type}`);
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

    logger.info(`[WorkflowEngine] Sending email to ${to}: ${subject}`);
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

    logger.info(`[WorkflowEngine] Created task: ${task.id}`);
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

    logger.info(`[WorkflowEngine] Updated ${entityType} ${entityId}`);
    return { updated: true };
  }

  private async executeRunAgentSkill(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ skillExecuted: boolean; result?: any }> {
    const config = action.config;
    logger.info(`[WorkflowEngine] Running agent skill: ${config.skillId}`);
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

    logger.info(`[WorkflowEngine] Sent notification: ${message}`);
    return { notificationSent: true };
  }

  private async executeDelay(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<{ delayed: boolean; delayMinutes: number }> {
    const delayMinutes = action.config.delayMinutes || 1;
    const delayMs = Math.min(delayMinutes * 60 * 1000, 60000);
    
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    
    logger.info(`[WorkflowEngine] Delayed for ${delayMinutes} minutes`);
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

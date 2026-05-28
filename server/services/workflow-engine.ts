import { storage } from "../storage";
import {
  type Workflow,
  type WorkflowRun,
  type WorkflowAction,
  type WorkflowActionType,
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

// TODO(tsc): these trigger events are fired/handled by this engine but are not yet
// declared in the frozen shared WORKFLOW_TRIGGER_EVENTS union. Declared locally so the
// templates typecheck; fold these into shared/schema's union when it is unfrozen.
type ExtendedTriggerEvent =
  | WorkflowTriggerEvent
  | "buyer.match_created"
  | "payment.confirmed"
  | "note.delinquent_60d"
  | "property.listed"
  | "campaign.response_received"
  | "org.milestone_reached"
  | "lead.scored"
  | "offers.batch_sent"
  | "lease.expiring_60d"
  | "support.ticket_created"
  | "schedule.weekly_monday";

export type WorkflowTemplate = {
  id: string; // stable identifier for the template
  name: string;
  description: string;
  category: "leads" | "notes" | "deals";
  trigger: {
    event: ExtendedTriggerEvent;
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
          body: "Congratulations on closing 10 deals! Know another real estate professional who could benefit? Refer them and earn credits...",
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
  // ── Fix-and-flip workflow template ────────────────────────────────────
  // Per Devon's investor critique: AcreOS has a fix-and-flipper persona
  // (paxPersona.ts / personaVocabulary.ts) but no rehab-flavored workflow
  // template. Without one the fix-and-flipper signup hits the leads page
  // and gets land-investor language for their next steps. This template
  // gives the fix-flipper the right scaffolding the moment a deal closes
  // — rehab task, contractor schedule reminder, ARV sanity check — so
  // they're not retrofitting the land-investor playbook to a 12-week
  // rehab timeline.
  {
    id: "tpl_fix_flip_rehab_kickoff",
    name: "Fix-and-Flip — Rehab Kickoff",
    description:
      "When a fix-and-flip deal closes, kick off the rehab tracker: budget review, contractor scheduling, ARV-vs-AVM check, and a 12-week timeline reminder.",
    category: "deals",
    trigger: { event: "deal.stage_changed" },
    actions: [
      {
        id: "action_rehab_budget_task",
        type: "create_task",
        config: {
          title: "Confirm rehab budget for {{propertyAddress}} (est. ${{estimatedRepairCost}})",
          description:
            "Walk the property, finalize the scope, and lock the rehab budget. Compare against contractor bids before issuing first draw.",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_contractor_schedule",
        type: "create_task",
        config: {
          title: "Schedule contractor for {{propertyAddress}} — week 1 demo + framing",
          description:
            "Confirm GC + sub trades. Demo / framing / rough-ins drive the critical path; the rest follows.",
          priority: "high",
          dueInDays: 5,
        },
      },
      {
        id: "action_arv_sanity_check",
        type: "create_task",
        config: {
          title: "ARV sanity check — {{propertyAddress}}",
          description:
            "Pull 3 comps to defend your ARV. Reminder: the system's AVM ({{estimatedValue}}) is *as-is*. Your ARV is the post-rehab number — don't conflate them on the lender pro forma.",
          priority: "medium",
          dueInDays: 2,
        },
      },
      {
        id: "action_rehab_kickoff_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Rehab kicked off: {{propertyAddress}}. Budget ${{estimatedRepairCost}}, target ARV ${{afterRepairValue}}. 12-week timeline starts now.",
        },
      },
    ],
  },
  // ── Pillar K — Note-investor lifecycle templates ──────────────────────
  // Five templates drawn from the 25-persona insight mine in
  // docs/exhaustive-completion/pillar-k-note-investors-25-personas.md.
  // Each addresses a moment in the note's life that recurred across
  // multiple personas. Together they replace the manual spreadsheet
  // workflow many veteran note investors (Maris, Geena, Octavia) run
  // today.
  {
    id: "tpl_note_payment_received_receipt",
    name: "Note Payment Received — Receipt & Streak",
    description:
      "On every payment received, email the borrower a payment receipt, log a Pax notification, and bump the on-time-payment streak (powers the reperforming threshold).",
    category: "notes",
    trigger: { event: "payment.received" },
    actions: [
      {
        id: "action_payment_receipt_email",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Payment received — Note #{{noteId}}",
          body:
            "Hi {{borrowerName}},\n\nWe've received your payment of ${{amount}} for {{periodLabel}}. Current principal balance after this payment: ${{remainingPrincipal}}. Next payment of ${{nextAmount}} is due on {{nextDueDate}}.\n\nThank you,\n{{orgName}}",
        },
      },
      {
        id: "action_payment_received_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Payment received: Note #{{noteId}} ({{borrowerName}}) — ${{amount}}. On-time streak: {{onTimeStreak}}.",
        },
      },
    ],
  },
  {
    id: "tpl_note_insurance_expiring",
    name: "Insurance Policy Expiring (60 days)",
    description:
      "60 days before the borrower's hazard-insurance policy lapses on note collateral, create a review task and draft a renewal-request letter so the lender's lien stays insured.",
    category: "notes",
    trigger: { event: "note.insurance_expiring_60d" },
    actions: [
      {
        id: "action_insurance_renewal_task",
        type: "create_task",
        config: {
          title: "Confirm hazard-insurance renewal for Note #{{noteId}} ({{borrowerName}})",
          description:
            "Policy {{policyNumber}} on {{collateralAddress}} expires {{policyExpiryDate}}. Request proof of renewal or force-place coverage if borrower doesn't respond within 30 days.",
          priority: "high",
          dueInDays: 14,
        },
      },
      {
        id: "action_insurance_borrower_letter",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Action needed — insurance on {{collateralAddress}}",
          body:
            "Hi {{borrowerName}},\n\nOur records show your hazard-insurance policy {{policyNumber}} covering {{collateralAddress}} expires {{policyExpiryDate}}. Please forward a renewal declaration or replacement-policy proof at least 30 days before expiry. If we don't receive proof, the loan terms require us to force-place coverage at your expense, which is typically more expensive than your own policy.\n\nThank you,\n{{orgName}}",
        },
      },
      {
        id: "action_insurance_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "Insurance expiring on Note #{{noteId}} collateral {{collateralAddress}} on {{policyExpiryDate}}.",
        },
      },
    ],
  },
  {
    id: "tpl_note_escrow_shortfall",
    name: "Escrow Shortfall Detected",
    description:
      "When annual escrow analysis shows a shortfall (taxes + insurance > escrowed amount), create a review task and draft a borrower notice with the proposed payment-increase amount.",
    category: "notes",
    trigger: { event: "note.escrow_shortfall" },
    actions: [
      {
        id: "action_escrow_review_task",
        type: "create_task",
        config: {
          title: "Review escrow shortfall on Note #{{noteId}} — ${{shortfallAmount}}",
          description:
            "Annual escrow analysis projects a {{shortfallAmount}} shortfall over the next 12 months ({{taxIncrease}} tax + {{insuranceIncrease}} insurance increase). Decide whether to spread over 12 months ({{spreadAmount}}/mo) or recover lump-sum.",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_escrow_borrower_letter",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Escrow analysis — Note #{{noteId}}",
          body:
            "Hi {{borrowerName}},\n\nOur annual escrow analysis on your note shows your escrow account is projected to be short by ${{shortfallAmount}} over the next 12 months, driven by higher property-tax ({{taxIncrease}}) and insurance ({{insuranceIncrease}}) costs. We'll be increasing your monthly escrow payment by ${{spreadAmount}} starting {{effectiveDate}} to keep the account whole.\n\nWe enclose the full escrow-analysis statement.\n\n{{orgName}}",
        },
      },
    ],
  },
  {
    id: "tpl_note_reperforming_threshold",
    name: "Reperforming Threshold Reached (12 on-time payments)",
    description:
      "After 12 consecutive on-time payments on a previously non-performing note, create a review task to reclassify the note as reperforming — typically unlocks better wholesale pricing.",
    category: "notes",
    trigger: { event: "note.reperforming_threshold" },
    actions: [
      {
        id: "action_reperforming_review_task",
        type: "create_task",
        config: {
          title: "Reclassify Note #{{noteId}} ({{borrowerName}}) as reperforming",
          description:
            "Borrower has made 12 consecutive on-time payments on a previously non-performing note. Reclassify to reperforming, update the asset registry, and consider repricing if you intend to sell.",
          priority: "medium",
          dueInDays: 5,
        },
      },
      {
        id: "action_reperforming_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Note #{{noteId}} crossed 12-month reperforming threshold. Borrower: {{borrowerName}}.",
        },
      },
    ],
  },
  // ── Pillar P — Buy-and-hold landlord lifecycle templates ────────────
  // Three templates capturing the three highest-frequency landlord
  // moments: lease renewal countdown, maintenance request triage,
  // and rent received receipt. From the 25-persona insight mine in
  // docs/exhaustive-completion/pillar-p-landlords-25-personas.md.
  {
    id: "tpl_landlord_lease_renewal_countdown",
    name: "Landlord — Lease Renewal (60-day countdown)",
    description:
      "60 days before lease end, surface the renewal-or-vacate decision: rent-review math + drafted renewal/vacate letters so the landlord can act before the legal vacate-notice window closes.",
    category: "deals",
    trigger: { event: "lease.renewal_countdown_60d" },
    actions: [
      {
        id: "action_renewal_decision_task",
        type: "create_task",
        config: {
          title: "Renewal decision — {{propertyAddress}} / {{tenantName}} (lease ends {{leaseEndDate}})",
          description:
            "Current rent ${{currentRent}}. Market rent (per AVM/comps) ${{marketRent}}. Suggested renewal rent ${{suggestedRenewalRent}}. Decide: (a) offer renewal at {{suggestedRenewalRent}}, (b) offer renewal at current rent (retention), (c) issue notice to vacate. Per-state notice period: {{stateNoticeDays}}d.",
          priority: "high",
          dueInDays: 14,
        },
      },
      {
        id: "action_renewal_offer_letter",
        type: "send_email",
        config: {
          to: "{{tenantEmail}}",
          subject: "Lease renewal offer — {{propertyAddress}}",
          body:
            "Hi {{tenantName}},\n\nYour lease at {{propertyAddress}} ends {{leaseEndDate}}. We'd like to offer you a renewal at ${{suggestedRenewalRent}}/mo for another {{renewalTermMonths}}-month term ({{rentChangePct}} change from current ${{currentRent}}).\n\nIf you'd like to renew at these terms, please reply by {{renewalDecisionDeadline}}. If you'd prefer a different term length, let us know — we're happy to discuss.\n\n{{orgName}}",
        },
      },
    ],
  },
  {
    id: "tpl_landlord_maintenance_request_triage",
    name: "Landlord — Maintenance Request Triage",
    description:
      "Auto-categorize urgency on every maintenance request, then route to the appropriate vendor (or surface a DIY-vs-call decision for self-managed landlords).",
    category: "deals",
    trigger: { event: "maintenance.request_received" },
    actions: [
      {
        id: "action_triage_task",
        type: "create_task",
        config: {
          title: "Maintenance — {{propertyAddress}} ({{requestCategory}}, {{urgencyLevel}})",
          description:
            "Tenant {{tenantName}} reported {{requestDescription}}. Category: {{requestCategory}}. Urgency: {{urgencyLevel}} ({{urgencyRationale}}). Suggested vendor: {{suggestedVendor}}. Estimated cost: ${{estimatedCost}}.",
          priority: "high",
          dueInDays: 1,
        },
      },
      {
        id: "action_tenant_acknowledgment",
        type: "send_email",
        config: {
          to: "{{tenantEmail}}",
          subject: "Maintenance request received — {{propertyAddress}}",
          body:
            "Hi {{tenantName}},\n\nWe received your maintenance request: \"{{requestDescription}}\". Based on urgency, we'll have someone out within {{responseTimeSla}}. We'll send you a follow-up once the visit is scheduled.\n\n{{orgName}}",
        },
      },
      {
        id: "action_triage_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Maintenance: {{requestCategory}} at {{propertyAddress}} — {{urgencyLevel}}.",
        },
      },
    ],
  },
  {
    id: "tpl_landlord_rent_received_receipt",
    name: "Landlord — Rent Received → Receipt + Late-Fee Check",
    description:
      "On every rent payment, email a receipt, update YTD income, and flag if a late-fee should have applied based on the lease terms.",
    category: "deals",
    trigger: { event: "rent.received" },
    actions: [
      {
        id: "action_rent_receipt_email",
        type: "send_email",
        config: {
          to: "{{tenantEmail}}",
          subject: "Rent receipt — {{propertyAddress}} {{rentPeriodLabel}}",
          body:
            "Hi {{tenantName}},\n\nWe've received your rent of ${{rentAmount}} for {{rentPeriodLabel}}. YTD payments: ${{ytdPaid}}. Next payment due {{nextDueDate}}.\n\nThank you,\n{{orgName}}",
        },
      },
      {
        id: "action_rent_received_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Rent received: {{propertyAddress}} — ${{rentAmount}} ({{lateFeeApplied ? 'late-fee applied' : 'on-time'}}).",
        },
      },
    ],
  },
  // ── Pillar O — Fix-and-flipper milestone templates ──────────────────
  // Extends the existing `tpl_fix_flip_rehab_kickoff` template with
  // three more lifecycle moments: demo-complete (frame kickoff),
  // HML-extension warning, and punch-list-complete (listing ready).
  // From the 25-persona insight mine in pillar-o-fix-and-flippers-25-
  // personas.md.
  {
    id: "tpl_flip_milestone_demo_complete",
    name: "Fix-and-Flip — Demo Complete → Framing Kickoff",
    description:
      "When demolition finishes, surface the framing kickoff: subcontractor schedule confirmation + mid-project budget reconciliation.",
    category: "deals",
    trigger: { event: "rehab.milestone" },
    actions: [
      {
        id: "action_framing_kickoff_task",
        type: "create_task",
        config: {
          title: "Framing kickoff — {{propertyAddress}}",
          description:
            "Demo complete {{milestoneDate}}. Confirm framing/structural crew start date (target: within {{nextStageDays}}d). Reconcile demo-stage spend vs budget: actual ${{actualSpend}} / planned ${{plannedSpend}}.",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_subs_confirm_task",
        type: "create_task",
        config: {
          title: "Confirm subcontractor schedule — {{propertyAddress}}",
          description:
            "Confirm mechanicals (HVAC, plumbing, electrical) start dates align with framing completion. Mechanicals typically follow framing by 2-3w.",
          priority: "medium",
          dueInDays: 7,
        },
      },
      {
        id: "action_milestone_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Demo complete: {{propertyAddress}}. Framing kickoff scheduled.",
        },
      },
    ],
  },
  {
    id: "tpl_flip_listing_ready",
    name: "Fix-and-Flip — Punch List Complete → Listing Prep",
    description:
      "When the punch list closes out, surface listing-prep tasks: photography, staging, pricing-vs-comps decision, agent selection.",
    category: "deals",
    trigger: { event: "rehab.punch_list_complete" },
    actions: [
      {
        id: "action_listing_prep_task",
        type: "create_task",
        config: {
          title: "Listing prep — {{propertyAddress}} (target ARV ${{afterRepairValue}})",
          description:
            "Punch list closed {{punchListDate}}. Order professional photography, schedule staging, finalize listing price (comp ARV ${{compArv}} vs target ARV ${{afterRepairValue}}), select listing agent, list target date {{targetListDate}}.",
          priority: "high",
          dueInDays: 5,
        },
      },
      {
        id: "action_pricing_decision_task",
        type: "create_task",
        config: {
          title: "Pricing-vs-comp decision — {{propertyAddress}}",
          description:
            "Comp range: ${{compLow}}-${{compHigh}}. Target ARV: ${{afterRepairValue}}. Recent comparable list-to-sale ratios: {{recentListSaleRatio}}. Set list price.",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_listing_ready_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "{{propertyAddress}} ready to list. Target ARV ${{afterRepairValue}}, list-date target {{targetListDate}}.",
        },
      },
    ],
  },
  // ── Pillar N — Subdivider lifecycle templates ───────────────────────
  // Subdividing is process-heavy (multiple agencies in sequence) and
  // timeline-heavy (each stage on its own clock). These templates
  // bring the major lifecycle moments into the workflow engine so
  // operators don't lose them in spreadsheets.
  {
    id: "tpl_subdivision_plat_submitted",
    name: "Subdivision — Plat Submitted to County",
    description:
      "When the plat is submitted, auto-create the approval-timeline tracker with all expected review stages so operators don't lose track of the multi-month process.",
    category: "deals",
    trigger: { event: "plat.submitted" },
    actions: [
      {
        id: "action_plat_timeline_task",
        type: "create_task",
        config: {
          title: "Plat submitted — track approval timeline for {{propertyAddress}}",
          description:
            "Plat #{{platId}} submitted {{submittedDate}} to {{countyName}}. Typical {{state}}-{{countyName}} timeline: {{estimatedApprovalMonths}}mo. Stages: 1) Engineering review, 2) Planning department, 3) Planning commission, 4) Approval/recordation. Track each stage's completion + ping county at {{nextCountyCheckinDays}}d intervals.",
          priority: "medium",
          dueInDays: 14,
        },
      },
      {
        id: "action_plat_submitted_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Plat submitted for {{propertyAddress}} ({{numLots}} lots). Estimated approval timeline: {{estimatedApprovalMonths}}mo.",
        },
      },
    ],
  },
  {
    id: "tpl_subdivision_vendor_milestone",
    name: "Subdivision — Vendor Milestone Reached",
    description:
      "Each time a survey/engineering/county milestone is met, log it, notify, and create the next-stage downstream task so the project keeps moving instead of stalling on operator attention.",
    category: "deals",
    trigger: { event: "subdivision.vendor_milestone" },
    actions: [
      {
        id: "action_milestone_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Subdivision milestone: {{milestoneName}} complete for {{propertyAddress}}. Next: {{nextStage}}.",
        },
      },
      {
        id: "action_next_stage_task",
        type: "create_task",
        config: {
          title: "Next subdivision stage: {{nextStage}} — {{propertyAddress}}",
          description:
            "{{milestoneName}} completed {{milestoneDate}}. {{nextStage}} is the gating step. Vendor: {{nextVendor}}. Expected duration: {{nextStageDays}}d.",
          priority: "medium",
          dueInDays: 7,
        },
      },
    ],
  },
  {
    id: "tpl_subdivision_phase_recorded",
    name: "Subdivision Phase Recorded — Generate Lots",
    description:
      "When a subdivision phase records, the constituent lots become sellable. Auto-create lot rows in the property table and queue marketing tasks per lot.",
    category: "deals",
    trigger: { event: "subdivision.phase_recorded" },
    actions: [
      {
        id: "action_phase_recorded_task",
        type: "create_task",
        config: {
          title: "Generate lots + marketing for {{propertyAddress}} Phase {{phaseNumber}}",
          description:
            "Phase {{phaseNumber}} recorded {{recordedDate}}. Generates {{lotCount}} lots. For each: (a) create property row with phase + lot designation, (b) commission lot photo/drone, (c) set asking price per the lot-pricing model.",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_phase_recorded_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Phase {{phaseNumber}} recorded for {{propertyAddress}}. {{lotCount}} lots now sellable.",
        },
      },
    ],
  },
  // ── Pillar M — Wholesaler lifecycle templates ───────────────────────
  // Three templates from the 25-persona insight mine in
  // docs/exhaustive-completion/pillar-m-wholesalers-25-personas.md.
  // Wholesalers' workflow diverges from land flips at three moments:
  // the deal goes under contract (auto-broadcast to buyers), the
  // assignment is pending (collection deadline + paperwork prep),
  // and the property is occupied (cash-for-keys negotiation).
  {
    id: "tpl_wholesaler_contract_signed_buyer_broadcast",
    name: "Wholesaler — Contract Signed → Buyer Broadcast",
    description:
      "When a wholesaler signs a contract, auto-create the buyer broadcast task and queue the deal for blast to the org's cash-buyer list. Surfaces Ari + Jen + Pia's biggest gap on day one.",
    category: "deals",
    trigger: { event: "deal.contract_signed" },
    actions: [
      {
        id: "action_buyer_broadcast_task",
        type: "create_task",
        config: {
          title: "Broadcast deal to buyer list — {{propertyAddress}} ({{contractPrice}})",
          description:
            "Contract signed {{contractDate}}. Asking ${{askingPrice}} (assignment fee ${{assignmentFee}}). Comp ARV ${{compArv}}. Send to cash-buyer list via /buyer-blasts, then follow up individually with top 5 buyers whose criteria match.",
          priority: "high",
          dueInDays: 2,
        },
      },
      {
        id: "action_buyer_broadcast_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Contract signed: {{propertyAddress}} — broadcast to buyer list within 48h.",
        },
      },
    ],
  },
  {
    id: "tpl_wholesaler_assignment_pending",
    name: "Wholesaler — Assignment Pending (7-day countdown)",
    description:
      "When an assignment is pending, surface the timeline + draft the assignment paperwork. Closes Gus + Iyer's per-state paperwork question by templating early.",
    category: "deals",
    trigger: { event: "deal.assignment_pending" },
    actions: [
      {
        id: "action_assignment_paperwork_task",
        type: "create_task",
        config: {
          title: "Assignment paperwork — {{propertyAddress}} (fee ${{assignmentFee}})",
          description:
            "Buyer {{buyerName}} ({{buyerEntity}}) committed at ${{buyerPrice}}. Assignment fee {{assignmentFee}}. Confirm state-specific assignment-of-contract template ({{state}}) is on file; collect buyer earnest money; coordinate closing.",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_assignment_pending_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Assignment pending: {{propertyAddress}} to {{buyerName}} — closing in {{daysToClose}}d.",
        },
      },
    ],
  },
  {
    id: "tpl_wholesaler_occupied_cash_for_keys",
    name: "Wholesaler — Occupied Property Cash-for-Keys",
    description:
      "When a property under contract is occupied (current owner or tenant remaining), draft a cash-for-keys offer letter + create a negotiation timeline task. Closes Wren's persona pain.",
    category: "deals",
    trigger: { event: "deal.occupied" },
    actions: [
      {
        id: "action_cfk_offer_letter",
        type: "send_email",
        config: {
          to: "{{occupantEmail}}",
          subject: "Relocation assistance offer — {{propertyAddress}}",
          body:
            "Hi {{occupantName}},\n\nWe understand you're currently in the home at {{propertyAddress}}. We'd like to offer cash for keys to help with your move:\n\n• ${{cfkAmount}} paid at vacate, broom-clean.\n• Move-out target: {{cfkVacateDate}} ({{cfkVacateDaysFromNow}} days from today).\n• We handle the lockbox + clean-out; you keep anything you want and leave the rest.\n\nPlease reply or call to talk it through. We'd rather work this out cooperatively.\n\n{{orgName}}",
        },
      },
      {
        id: "action_cfk_negotiation_task",
        type: "create_task",
        config: {
          title: "Cash-for-keys — {{propertyAddress}} ({{occupantName}})",
          description:
            "Occupant {{occupantName}} ({{occupantType}}). Offered ${{cfkAmount}} for vacate by {{cfkVacateDate}}. Confirm local relocation-assistance laws ({{state}}). Coordinate handoff inspection on vacate day.",
          priority: "high",
          dueInDays: 5,
        },
      },
    ],
  },
  // ── Pillar L — Tax-delinquent specialist lifecycle templates ────────
  // Three templates from the 25-persona insight mine in
  // docs/exhaustive-completion/pillar-l-tax-delinquent-25-personas.md.
  // The state rules referenced live in
  // shared/regulatory/taxLienStateRules.ts; templates interpolate
  // {{stateRedemptionPeriodMonths}} and {{stateForeclosureNoticeMonths}}
  // when the originating event payload includes them.
  {
    id: "tpl_tax_cert_acquired_kickoff",
    name: "Tax Certificate Acquired — Cure Outreach Kickoff",
    description:
      "On certificate acquisition, send a cure-path letter to the delinquent owner offering a payment plan, and create the redemption-countdown task. Closes Rae's persona gap: most operators auto-skip to foreclosure; this surface gives the operator a cure-first option on day one.",
    category: "deals",
    trigger: { event: "cert.acquired" },
    actions: [
      {
        id: "action_owner_cure_letter",
        type: "send_email",
        config: {
          to: "{{delinquentOwnerEmail}}",
          subject: "Tax-delinquency cure options — {{propertyAddress}}",
          body:
            "Hi {{ownerName}},\n\nWe've acquired the tax certificate for {{propertyAddress}} ({{stateCounty}}). The redemption window is {{stateRedemptionPeriodMonths}} months from the sale date, with statutory interest accruing at {{stateStatutoryRatePct}}.\n\nIf you'd like to discuss a payment plan to cure the delinquency, please reply or call — we'd rather work this out than foreclose. We can spread the obligation, including interest, into manageable monthly payments.\n\n{{orgName}}",
        },
      },
      {
        id: "action_redemption_countdown_task",
        type: "create_task",
        config: {
          title: "Redemption countdown — Cert #{{certificateId}} ({{propertyAddress}})",
          description:
            "Redemption period ends {{redemptionEndsDate}} ({{stateRedemptionPeriodMonths}} months from {{certificateAcquiredDate}}). Statutory rate {{stateStatutoryRatePct}}. State: {{state}} ({{saleType}}).",
          priority: "medium",
          dueInDays: 14,
        },
      },
      {
        id: "action_cert_acquired_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Certificate acquired: {{propertyAddress}} ({{state}}). Redemption window: {{stateRedemptionPeriodMonths}}mo; rate {{stateStatutoryRatePct}}.",
        },
      },
    ],
  },
  {
    id: "tpl_tax_cert_redemption_approaching",
    name: "Redemption Period Closing (60 days)",
    description:
      "60 days before the redemption period closes, surface posture options to the operator: extend (if state allows), accept redemption-in-progress, or prepare foreclosure filing.",
    category: "deals",
    trigger: { event: "cert.redemption_period_60d" },
    actions: [
      {
        id: "action_redemption_posture_task",
        type: "create_task",
        config: {
          title: "60d to redemption close — Cert #{{certificateId}} ({{propertyAddress}})",
          description:
            "Redemption ends {{redemptionEndsDate}}. Confirm posture: (a) accept ongoing redemption-in-progress communications, (b) move to foreclosure filing, (c) renegotiate cure plan with owner. Per-state foreclosure-notice period: {{stateForeclosureNoticeMonths}}mo.",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_redemption_approach_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message:
            "Redemption closing in 60d on {{propertyAddress}} — Cert #{{certificateId}}. Decide posture.",
        },
      },
    ],
  },
  {
    id: "tpl_tax_cert_foreclosure_eligible",
    name: "Foreclosure-Eligible — File or Forfeit",
    description:
      "When the redemption window closes without redemption, surface a high-priority task with state-specific foreclosure-filing requirements and the operator's net recovery scenarios.",
    category: "deals",
    trigger: { event: "cert.foreclosure_eligible" },
    actions: [
      {
        id: "action_foreclosure_filing_task",
        type: "create_task",
        config: {
          title: "Foreclosure-eligible — Cert #{{certificateId}} ({{propertyAddress}})",
          description:
            "Redemption period closed on {{redemptionEndsDate}}. State {{state}} requires {{stateForeclosureNoticeMonths}}-month foreclosure notice before action. Reference statute: {{stateStatutoryReference}}. Decide: file foreclosure, sell certificate, or write off.",
          priority: "high",
          dueInDays: 5,
        },
      },
      {
        id: "action_foreclosure_eligible_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message:
            "Foreclosure-eligible: {{propertyAddress}} — Cert #{{certificateId}}. {{stateForeclosureNoticeMonths}}mo notice required in {{state}}.",
        },
      },
    ],
  },
  {
    id: "tpl_note_balloon_approaching_extended",
    name: "Note Balloon Approaching (90-day countdown)",
    description:
      "90/60/30 days before a balloon payment is due, escalate notifications and draft borrower outreach with refinance + payoff options.",
    category: "notes",
    trigger: { event: "note.balloon_approaching" },
    actions: [
      {
        id: "action_balloon_review_task",
        type: "create_task",
        config: {
          title: "Balloon coming up — Note #{{noteId}} ({{borrowerName}}) due {{balloonDate}} (${{balloonAmount}})",
          description:
            "Reach out to borrower {{daysToBalloon}} days before balloon date. Confirm payoff source, offer refinance terms if appropriate, or schedule property valuation if collateral may be reclaimed.",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_balloon_borrower_letter",
        type: "send_email",
        config: {
          to: "{{borrowerEmail}}",
          subject: "Balloon payment notice — Note #{{noteId}}",
          body:
            "Hi {{borrowerName}},\n\nThis is a reminder that the balloon payment of ${{balloonAmount}} on your note is due {{balloonDate}} ({{daysToBalloon}} days from today). If you'd like to discuss refinancing, an extension, or coordinating payoff, please reply or call us. We're happy to walk through options.\n\n{{orgName}}",
        },
      },
      {
        id: "action_balloon_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "Balloon in {{daysToBalloon}}d — Note #{{noteId}}, ${{balloonAmount}} due {{balloonDate}}.",
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
    // TODO(tsc): "conditional" is handled here but not declared in the frozen
    // WORKFLOW_ACTION_TYPES union; widen the discriminant locally so the case typechecks.
    switch (action.type as WorkflowActionType | "conditional") {
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
      createdBy: "system", // workflow-engine acts as the system actor
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
        await storage.updateLead(entityId, updates, context.organizationId);
        break;
      case "property":
        await storage.updateProperty(entityId, updates, context.organizationId);
        break;
      case "deal":
        await storage.updateDeal(entityId, updates, undefined, context.organizationId);
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

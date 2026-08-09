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
import {
  LIVE_WORKFLOW_TRIGGER_EVENTS,
  isLiveWorkflowTriggerEvent,
} from "@shared/workflow-live-triggers";

// Re-export the live-trigger source of truth for server-side consumers and
// tests. The list itself lives in shared/ so the client (builder + gallery
// badges) reads the exact same constant.
export { LIVE_WORKFLOW_TRIGGER_EVENTS, isLiveWorkflowTriggerEvent };

// ---------------------------------------------------------------------------
// Action honesty (Wave A "Nothing lies" → Wave B "Wire the engine", 2026-07-29).
//
// Wave A: `send_email` and `run_agent_skill` were log-only stubs that returned
// fabricated success. They were made to return an ActionUnavailableResult
// instead, and executeWorkflow records those steps with status "unavailable"
// — distinct from "completed" (it happened) and "failed" (attempted, errored).
//
// Wave B wires the real rails:
//   - send_email  → emailService.sendEmail({ purpose: "counterparty" })
//   - run_agent_skill → skillRegistry.executeSkill(...)
// The honesty contract is UNCHANGED and still load-bearing: an action may only
// report success when a rail actually ran and reported success. Three distinct
// non-success outcomes exist so the run log can never round any of them up:
//
//   "unavailable" — no rail could run at all. The org has no connected sending
//                   identity (BYO, founder decision 2026-07-17), or the
//                   configured skillId resolves in no registry. Nothing was
//                   attempted; the reason names what to connect/fix.
//   "blocked"     — a rail existed and REFUSED on compliance grounds (TCPA /
//                   do-not-contact / suppression list). The refusal is the
//                   correct outcome, not an error, so the run continues.
//   "failed"      — the rail ran and errored (thrown; aborts the run as before).
//
// Neither "unavailable" nor "blocked" results are merged into workflow
// variables: there is no real output to pass downstream.
// ---------------------------------------------------------------------------

export const ACTION_STATUS_UNAVAILABLE = "unavailable" as const;
export const ACTION_STATUS_BLOCKED = "blocked" as const;

export type ActionUnavailableResult = {
  status: typeof ACTION_STATUS_UNAVAILABLE;
  /** Plain-words explanation, surfaced verbatim in the run log. */
  reason: string;
  [key: string]: unknown;
};

export type ActionBlockedResult = {
  status: typeof ACTION_STATUS_BLOCKED;
  /** Plain-words explanation, surfaced verbatim in the run log. */
  reason: string;
  [key: string]: unknown;
};

export function isActionUnavailableResult(
  result: unknown,
): result is ActionUnavailableResult {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === ACTION_STATUS_UNAVAILABLE
  );
}

export function isActionBlockedResult(
  result: unknown,
): result is ActionBlockedResult {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === ACTION_STATUS_BLOCKED
  );
}

/** True for any result meaning "the declared work did NOT happen". */
export function isNonExecutingActionResult(
  result: unknown,
): result is ActionUnavailableResult | ActionBlockedResult {
  return isActionUnavailableResult(result) || isActionBlockedResult(result);
}

// ---------------------------------------------------------------------------
// Agent-skill id reconciliation (Wave B).
//
// The shipped templates were authored against snake_case skill ids that never
// existed in `skillRegistry` (server/services/agent-skills.ts). Rather than
// leave installed workflows pointing at ids that resolve nowhere, legacy ids
// are mapped here to their real registry id. Anything NOT in this map is
// looked up verbatim; an id that resolves in neither place fails honestly with
// the id named (see executeRunAgentSkill) — it never reports a skill as run.
//
//   score_lead          → scoreLead              (real, registered)
//   find_matching_buyers→ (no registry entry)    — deliberately unmapped.
//     A real buyer-matching rail exists
//     (buyerMatchingAIService.matchPropertyToBuyers) but it is not a
//     registered Skill, and the engine dispatches ONLY through the registry —
//     a private second dispatch path would be a shadow registry that drifts.
//     Until someone registers it, this id fails honestly and says so.
// ---------------------------------------------------------------------------
export const WORKFLOW_SKILL_ID_ALIASES: Readonly<Record<string, string>> = {
  score_lead: "scoreLead",
  scoreLead: "scoreLead",
};

/**
 * Longest a `delay` step is allowed to hold the event loop. Anything longer
 * parks the run durably (status "waiting" + resume_at) instead of sleeping —
 * see executeWorkflow. Short delays stay inline so a 5-second pacing gap does
 * not need a database round-trip and a job tick.
 */
export const INLINE_DELAY_MAX_MS = 60_000;

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
  // lease.expiring_60d GRADUATED out of this escape hatch in audit Wave 1
  // (buy_and_hold beta→core): it now has a real emitter (rentalEvents.ts →
  // emitRentalEvent, fired by the new leaseExpiryDetector daily job) and is a
  // declared member of shared WORKFLOW_TRIGGER_EVENTS, so tpl_lease_expiring is
  // no longer a local-only trigger. LEGACY_EXTENDED_TRIGGER_TEMPLATE_IDS shrank
  // by tpl_lease_expiring in the same change.
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
          // payment.missed is emitted from three paths (notePaymentDueDetector,
          // acquiredNoteAging, routes-notes nsf-reversal); the all-paths
          // intersection is { source, noteId, daysLate }. Only noteId/daysLate
          // are safe to interpolate — borrowerName/amount are sent by only SOME
          // paths, so they were dropped (they would render as literal
          // {{placeholders}} on the paths that omit them).
          message:
            "Payment missed on Note #{{noteId}} — {{daysLate}} days late. Follow up immediately.",
        },
      },
      {
        id: "action_dunning_task",
        type: "create_task",
        config: {
          title: "Missed payment — Note #{{noteId}} ({{daysLate}} days late)",
          description:
            "Contact the borrower to collect the overdue payment. Open the note's servicing page for the borrower, the amount owed, and the note terms — a grace period may apply.",
          priority: "high",
          dueInDays: 1,
        },
      },
      // The borrower-email send_email (formerly action_borrower_email, targeting
      // {{borrowerEmail}}) was REMOVED: no payment.missed emit path supplies a
      // borrower email or org name, so the recipient and signature would render
      // as literal {{placeholders}} and nothing could be sent honestly. Mirrors
      // the tax-lien cure-letter send_email removal (5f35dbf). Future enrichment:
      // add a borrower-email field to the payment.missed payload on ALL three
      // emit paths, then a create-driven dunning email can be reinstated.
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
          // deal.stage_changed carries no property address; sale price is the
          // deal's accepted amount (dealEvents.ts's deal-event payload builder). {{salePrice}}
          // / {{propertyAddress}} were fabricated keys — dropped/rebound.
          message: "Deal closed — ${{acceptedAmount}}. Great work.",
        },
      },
      // The buyer-referral send_email (formerly action_referral_email, targeting
      // {{buyerEmail}}) was REMOVED: deal.stage_changed carries no buyer contact
      // fields, so the recipient/name/signature would render as literal
      // {{placeholders}} and nothing could be sent honestly. Mirrors the
      // tax-lien cure-letter send_email removal (5f35dbf).
      {
        id: "action_note_setup_task",
        type: "create_task",
        config: {
          title: "Set up seller-financed note (if owner-financed)",
          description:
            "If seller financing was agreed, create the note in AcreOS Finance and generate the amortization schedule. Confirm the down payment and financed amount against the signed closing terms.",
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
        // audit Wave 1 (creative_finance beta→core): {{balloonAmount}} was
        // fabricated — no row holds the exact balloon figure (it lives in the
        // amortization schedule). noteEvents.ts sends {{outstandingBalance}}
        // (notes.currentBalance) instead, honest ONLY as the approximate
        // current outstanding balance, never a precise payment amount.
        id: "action_balloon_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "Balloon approaching on note #{{noteId}} — {{borrowerName}}, approx. outstanding balance {{outstandingBalance}}, matures {{balloonDate}}",
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
          body: "Hi {{borrowerFirstName}}, the balloon payment on your land note is approaching — the note matures on {{balloonDate}}, with an approximate outstanding balance of {{outstandingBalance}}. The exact payoff figure will be confirmed from your amortization schedule; please reach out so we can review your options.",
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
      // deal.stage_changed carries no {{dealAddress}} / {{dealName}} — only real
      // deal columns (dealEvents.ts's deal-event payload builder). Those fabricated keys were
      // dropped; the tasks reference the deal generically and the notification
      // binds the real {{dealType}}.
      {
        id: "action_dd_title_task",
        type: "create_task",
        config: {
          title: "Complete title search for this deal's property",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_dd_survey_task",
        type: "create_task",
        config: {
          title: "Review survey and legal description for this deal's property",
          priority: "medium",
          dueInDays: 5,
        },
      },
      {
        id: "action_dd_zoning_task",
        type: "create_task",
        config: {
          title: "Confirm zoning and permitted uses for this deal's property",
          priority: "medium",
          dueInDays: 3,
        },
      },
      {
        id: "action_dd_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message: "Deal advanced to due diligence ({{dealType}}) — 3 DD tasks created",
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
      // deal.stage_changed carries no {{dealAddress}} / {{dealName}} /
      // {{dealValue}} — only real deal columns (dealEvents.ts's deal-event payload builder).
      // Those fabricated keys were dropped; the notification binds the real
      // {{acceptedAmount}}.
      {
        id: "action_acquisition_docs_task",
        type: "create_task",
        config: {
          title: "Update property records and upload closing docs for the acquired property",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_acquisition_insurance_task",
        type: "create_task",
        config: {
          title: "Set up property taxes and insurance for the acquired property",
          priority: "medium",
          dueInDays: 7,
        },
      },
      {
        id: "action_acquisition_disposition_task",
        type: "create_task",
        config: {
          title: "List the acquired property for disposition or begin owner financing setup",
          priority: "medium",
          dueInDays: 14,
        },
      },
      {
        id: "action_acquisition_closed_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Deal CLOSED at ${{acceptedAmount}}. 3 post-close tasks created.",
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
    // The note does not exist yet at deal.stage_changed, and the event carries
    // no buyer name / monthly payment / property address / deal name — only real
    // deal columns (dealEvents.ts's deal-event payload builder). Those fabricated keys were
    // dropped; the tasks prompt the operator to pull terms from the signed note,
    // and the notification binds the real {{acceptedAmount}}.
    actions: [
      {
        id: "action_note_setup_draft_task",
        type: "create_task",
        config: {
          title: "Draft the promissory note and deed of trust for this owner-finance deal",
          priority: "high",
          dueInDays: 5,
        },
      },
      {
        id: "action_note_setup_schedule_task",
        type: "create_task",
        config: {
          title: "Set up the payment schedule in AcreOS — enter the monthly P&I from the signed note terms",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_note_setup_deed_task",
        type: "create_task",
        config: {
          title: "File the deed and record the mortgage for the financed property",
          priority: "high",
          dueInDays: 14,
        },
      },
      {
        id: "action_note_setup_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message: "Owner-finance deal closed (${{acceptedAmount}}). Note setup tasks created.",
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
    // deal.stage_changed carries no property address, repair-cost, AVM, or ARV
    // fields — only real deal columns (dealEvents.ts's deal-event payload builder). The old
    // {{propertyAddress}} / {{estimatedRepairCost}} / {{estimatedValue}} /
    // {{afterRepairValue}} keys never arrive, so they rendered as literal
    // {{placeholders}}. They are dropped; the tasks bind real deal fields
    // (acquisition price, deal type, closing date) and PROMPT the operator to
    // confirm the rehab budget and ARV on the property's rehab tab (where those
    // figures actually live) rather than interpolating fabricated numbers.
    actions: [
      {
        id: "action_rehab_budget_task",
        type: "create_task",
        config: {
          title: "Confirm rehab budget for this flip (acquired at ${{acceptedAmount}})",
          description:
            "Walk the property, finalize the scope, and lock the rehab budget on the property's rehab tab. Compare against contractor bids before issuing the first draw.",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_contractor_schedule",
        type: "create_task",
        config: {
          title: "Schedule contractor — week 1 demo + framing",
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
          title: "ARV sanity check for this {{dealType}} flip",
          description:
            "Pull 3 comps to defend your ARV and confirm it on the property's rehab tab. Reminder: the system's AVM is *as-is* — your ARV is the post-rehab number; don't conflate them on the lender pro forma.",
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
            "Rehab kicked off (deal acquired at ${{acceptedAmount}}, closing {{closingDate}}). Confirm the rehab budget and target ARV on the property's rehab tab. 12-week timeline starts now.",
        },
      },
    ],
  },
  // ── Pillar K — Note-investor lifecycle templates ──────────────────────
  // Five templates drawn from the 25-persona insight mine in
  // docs/archive/exhaustive-completion/pillar-k-note-investors-25-personas.md.
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
  // docs/archive/exhaustive-completion/pillar-p-landlords-25-personas.md.
  {
    id: "tpl_landlord_lease_renewal_countdown",
    name: "Landlord — Lease Renewal (60-day countdown)",
    description:
      "60 days before lease end, surface the renewal-or-vacate decision: rent-review math + drafted renewal/vacate letters so the landlord can act before the legal vacate-notice window closes.",
    category: "deals",
    trigger: { event: "lease.renewal_countdown_60d" },
    // audit Wave 1 (buy_and_hold beta→core): the original tasks interpolated
    // {{marketRent}}, {{suggestedRenewalRent}}, {{rentChangePct}},
    // {{renewalTermMonths}}, {{renewalDecisionDeadline}} and {{stateNoticeDays}}
    // — NONE of which a lease row holds. Rendering a market/suggested rent would
    // mean touching the residential-comps data plane, a STANDING HARD-STOP for
    // buy_and_hold (no residential comps before its revenue trigger). Those were
    // dropped (refuse-not-fabricate); the task now binds the real lease fields
    // rentalEvents.ts sends (currentRent, state, propertyAddress, tenantName,
    // leaseEndDate, orgName) and PROMPTS the operator to pull current market rent
    // on their own rent-comp surface rather than rendering an invented number.
    actions: [
      {
        id: "action_renewal_decision_task",
        type: "create_task",
        config: {
          title: "Renewal decision — {{propertyAddress}} / {{tenantName}} (lease ends {{leaseEndDate}})",
          description:
            "Current rent ${{currentRent}} ({{state}}). Pull the current market rent for this unit on your own rent-comp surface before you decide — AcreOS does not provide residential comps and will not invent a figure. Then choose: (a) offer a renewal, (b) renew at current rent to retain the tenant, or (c) issue notice to vacate. Confirm your state's notice-period requirement before the vacate-notice window closes.",
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
            "Hi {{tenantName}},\n\nYour lease at {{propertyAddress}} ends {{leaseEndDate}}, and we'd like to talk with you about renewing. Your current rent is ${{currentRent}}/mo; we'll confirm the renewal terms with you directly.\n\nIf you'd like to renew, please reply and let us know — and tell us if you'd prefer a different term length.\n\n{{orgName}}",
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
    // audit Wave 1 (buy_and_hold beta→core): the original task interpolated
    // {{urgencyRationale}}, {{suggestedVendor}}, {{estimatedCost}} and
    // {{responseTimeSla}} — none of which a maintenance_tickets row holds. AcreOS
    // does not model vendors-per-trade, does not estimate repair cost, and has no
    // SLA engine, so those were AI-shaped fabrications. They were dropped
    // (refuse-not-fabricate); {{urgencyLevel}} now binds the REAL
    // maintenance_tickets.severity enum, not an invented rationale, and the task
    // tells the operator to triage against their OWN vendor list.
    actions: [
      {
        id: "action_triage_task",
        type: "create_task",
        config: {
          title: "Maintenance — {{propertyAddress}} ({{requestCategory}}, {{urgencyLevel}})",
          description:
            "Tenant {{tenantName}} reported: {{requestDescription}}. Category: {{requestCategory}}. Severity: {{urgencyLevel}}. Triage against your own vendor list and dispatch — AcreOS does not estimate the cost or pick the vendor for you.",
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
            "Hi {{tenantName}},\n\nWe received your maintenance request: \"{{requestDescription}}\". We'll review it and follow up once a visit is scheduled.\n\n{{orgName}}",
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
    // audit Wave 1 (buy_and_hold beta→core): every placeholder here binds a real
    // field rentalEvents.ts sends (rentAmount, rentPeriodLabel, ytdPaid — a REAL
    // SUM of this lease's payments this calendar year, nextDueDate — the next open
    // charge or null, propertyAddress, tenantName, tenantEmail, orgName). The
    // notification previously carried a `{{lateFeeApplied ? … : …}}` TERNARY, which
    // interpolateTemplate cannot evaluate (its regex only matches bare
    // {{identifier}}), so it rendered the literal ternary string in operator copy.
    // Removed. lateFeeApplied is still sent in the payload as a real boolean for
    // workflow CONDITIONS to match on; it is simply no longer interpolated as text.
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
            "Rent received: {{propertyAddress}} — ${{rentAmount}} for {{rentPeriodLabel}}.",
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
            "Demo complete {{milestoneDate}}. Confirm framing/structural crew start date. Reconcile demo-stage spend vs budget: actual ${{actualSpend}} / planned ${{plannedSpend}}.",
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
            "Punch list closed {{punchListDate}}. Order professional photography, schedule staging, pull fresh comps and finalize listing price against target ARV ${{afterRepairValue}}, select listing agent, list target date {{targetListDate}}.",
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
            "Target ARV: ${{afterRepairValue}}. Pull comparable sales on the comps surface and set the list price against recent list-to-sale ratios.",
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
        // audit Wave 1 (beta→core): dropped two fabricated clauses — the
        // "{{nextCountyCheckinDays}}d intervals" cadence and the
        // "{{estimatedApprovalMonths}}mo" timeline. No plan/checklist column
        // supplies either (a per-county p50 lives in county_subdivision_timelines
        // but the plan write-path does not join it), so emitSubdivisionEvent
        // sends neither. Every remaining placeholder binds a real emitted field
        // (platId/propertyAddress/countyName/state/numLots/submittedDate).
        config: {
          title: "Plat submitted — track approval timeline for {{propertyAddress}}",
          description:
            "Plat #{{platId}} submitted {{submittedDate}} to {{countyName}} ({{state}}). Stages: 1) Engineering review, 2) Planning department, 3) Planning commission, 4) Approval/recordation. Track each stage's completion, and pull the county's typical approval timeline from the state-rules surface.",
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
            "Plat submitted for {{propertyAddress}} ({{numLots}} lots).",
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
        // audit Wave 1 (beta→core): replaced the fabricated {{phaseNumber}} with
        // {{planName}} — subdivision_plans has a real `name` column ("Plan A —
        // 12 lots") but no phase-number column, so emitSubdivisionEvent sends
        // planName (plan.name), never an invented phase index.
        config: {
          title: "Generate lots + marketing for {{propertyAddress}} Phase {{planName}}",
          description:
            "Phase {{planName}} recorded {{recordedDate}}. Generates {{lotCount}} lots. For each: (a) create property row with phase + lot designation, (b) commission lot photo/drone, (c) set asking price per the lot-pricing model.",
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
            "Phase {{planName}} recorded for {{propertyAddress}}. {{lotCount}} lots now sellable.",
        },
      },
    ],
  },
  // ── Pillar M — Wholesaler lifecycle templates ───────────────────────
  // Three templates from the 25-persona insight mine in
  // docs/archive/exhaustive-completion/pillar-m-wholesalers-25-personas.md.
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
    // audit Wave 1 (beta→core): the original broadcast task interpolated
    // {{askingPrice}}, {{assignmentFee}} and {{compArv}} — none of which a deal
    // holds at contract-signing time (a wholesaler has NO ATTOM/comps plane, and
    // the assignment fee lives on a contract_assignments row that may not exist
    // yet). Mirroring the fix_and_flip comp correction (refuse-not-fabricate),
    // those were dropped: the task now binds the real deal fields the
    // wholesaleEvents.ts emitter actually sends (contractPrice = the accepted
    // purchase price, closingDate) and PROMPTS the operator to pull fresh comps
    // on the real comps surface before setting buyer pricing, rather than
    // rendering an invented number.
    actions: [
      {
        id: "action_buyer_broadcast_task",
        type: "create_task",
        config: {
          title: "Broadcast deal to buyer list — {{propertyAddress}} (${{contractPrice}})",
          description:
            "Contract signed {{contractDate}} — deal is in escrow (contract price ${{contractPrice}}, target close {{closingDate}}). Pull fresh comps on the comps surface before you set buyer pricing, then send to your cash-buyer list via /buyer-blasts and follow up individually with the top 5 buyers whose criteria match.",
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
    // audit Wave 1 (beta→core): the original paperwork task interpolated
    // {{buyerEntity}} and {{buyerPrice}} — no contract_assignments column
    // supplies either (an end buyer is a free-text endBuyerName or a linked
    // buyer profile; there is no per-buyer committed-price column). Both were
    // dropped (refuse-not-fabricate). The task now binds ONLY real
    // contract_assignments columns the wholesaleEvents.ts emitter sends
    // (assignmentFee = assignment_fee_cents, buyerName = end_buyer_name,
    // originalContractDate) plus the property address/state resolved from the
    // joined deal→property.
    actions: [
      {
        id: "action_assignment_paperwork_task",
        type: "create_task",
        config: {
          title: "Assignment paperwork — {{propertyAddress}} (fee ${{assignmentFee}})",
          description:
            "End buyer {{buyerName}} committed. Assignment fee ${{assignmentFee}}. Original purchase contract dated {{originalContractDate}}. Confirm the state-specific assignment-of-contract template ({{state}}) is on file; collect buyer earnest money; coordinate closing.",
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
            "Assignment pending: {{propertyAddress}} to {{buyerName}} — assignment fee ${{assignmentFee}}.",
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
  // docs/archive/exhaustive-completion/pillar-l-tax-delinquent-25-personas.md.
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
    // audit Wave 1 (beta→core): the original kickoff opened with a
    // send_email cure letter to {{delinquentOwnerEmail}} — but NO tax-cert
    // column supplies a delinquent-owner email address, so that recipient
    // would render as a literal "{{delinquentOwnerEmail}}" placeholder (a
    // fabricated recipient). Refuse-not-fabricate: the send_email action was
    // removed. Cure outreach can't invent a recipient the record doesn't
    // hold; the create_task + send_notification actions below carry only real
    // fields the certificateEvents.ts emitter actually sends.
    actions: [
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
      // audit Wave 1 (creative_finance beta→core): every ${{balloonAmount}} was
      // fabricated (no row holds the exact balloon payment — it lives in the
      // amortization schedule). Rebound to {{outstandingBalance}}
      // (notes.currentBalance, sent by noteEvents.ts), presented honestly as the
      // approximate current outstanding balance, never a precise payoff figure.
      {
        id: "action_balloon_review_task",
        type: "create_task",
        config: {
          title: "Balloon coming up — Note #{{noteId}} ({{borrowerName}}) matures {{balloonDate}}, approx. outstanding balance ${{outstandingBalance}}",
          description:
            "Reach out to borrower {{daysToBalloon}} days before the balloon date. Confirm payoff source, offer refinance terms if appropriate, or schedule property valuation if collateral may be reclaimed. Pull the exact balloon payoff from the amortization schedule before you quote a figure.",
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
            "Hi {{borrowerName}},\n\nThis is a reminder that a balloon payment on your note is approaching — the note matures on {{balloonDate}} ({{daysToBalloon}} days from today), with an approximate outstanding balance of ${{outstandingBalance}}. The exact payoff amount will be confirmed from your amortization schedule. If you'd like to discuss refinancing, an extension, or coordinating payoff, please reply or call us. We're happy to walk through options.\n\n{{orgName}}",
        },
      },
      {
        id: "action_balloon_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message: "Balloon in {{daysToBalloon}}d — Note #{{noteId}}, approx. outstanding balance ${{outstandingBalance}}, matures {{balloonDate}}.",
        },
      },
    ],
  },
  // ── Wave V3 (founder ruling #11) — rental family + registry-gap templates ──
  // Verification rules for every template below, pinned by
  // tests/unit/workflowEngineTemplates.test.ts:
  //   1. The trigger event is a declared member of the shared
  //      WORKFLOW_TRIGGER_EVENTS union (legally emittable via
  //      workflowEngine.emit and matchable by getActiveWorkflowsByTrigger) —
  //      none of these lean on the local ExtendedTriggerEvent escape hatch.
  //   2. Every action type has a real handler case in executeAction below.
  // The two parcel.* templates go further: theirs is the only event family
  // actually emitted at runtime today (parcelDeltaDetector.persistDelta),
  // and their {{placeholders}} are restricted to the exact fields that emit
  // call sends (apn/state/county/field/alertType/currentValue/leadId/
  // propertyId).
  {
    id: "tpl_multifamily_unit_turn",
    name: "Multifamily — Unit Turn Planner (60-day countdown)",
    description:
      "60 days before a unit's lease ends, surface the renew-or-turn decision and the make-ready plan for a non-renewal, so the unit is re-rented instead of sitting vacant.",
    category: "deals",
    trigger: { event: "lease.renewal_countdown_60d" },
    // audit Wave 1 (buy_and_hold beta→core, cross-vertical): this multifamily
    // template rides the SAME lease.renewal_countdown_60d event the landlord
    // template does, so making that event live activates it too. It interpolated
    // {{marketRent}} and {{suggestedRenewalRent}} — fields no lease row holds and
    // which rentalEvents.ts deliberately does NOT send (rendering them would touch
    // the residential-comps data plane, a standing hard-stop). Dropped
    // (refuse-not-fabricate) so those never render as literal {{placeholders}};
    // the task now prompts the operator to pull market rent on their own surface.
    actions: [
      {
        id: "action_unit_turn_decision_task",
        type: "create_task",
        config: {
          title: "Renew or turn — {{propertyAddress}} / {{tenantName}} (lease ends {{leaseEndDate}})",
          description:
            "Current rent ${{currentRent}}. Pull the current market rent for this unit on your own rent-comp surface before you decide — AcreOS does not provide residential comps. Then choose: (a) offer a renewal, (b) renew at current rent to avoid a turn, or (c) plan the unit turn. A turn typically costs a month-plus of rent in make-ready and vacancy — price the renewal against that.",
          priority: "high",
          dueInDays: 7,
        },
      },
      {
        id: "action_unit_turn_makeready_task",
        type: "create_task",
        config: {
          title: "Make-ready plan (if not renewing) — {{propertyAddress}}",
          description:
            "If the tenant is not renewing: schedule the move-out inspection for {{leaseEndDate}}, line up paint/clean/repair vendors, photograph the unit, and list it before it goes vacant. Target: new lease signed within 2 weeks of move-out.",
          priority: "medium",
          dueInDays: 14,
        },
      },
      {
        id: "action_unit_turn_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message:
            "Lease ends {{leaseEndDate}} at {{propertyAddress}} ({{tenantName}}) — renew-or-turn decision needed.",
        },
      },
    ],
  },
  {
    id: "tpl_mobile_home_lot_rent_receipt",
    name: "Mobile Home Park — Lot Rent Received → Receipt",
    description:
      "On every lot-rent payment, email the resident a receipt and log the payment — the paper trail park operators need at tax time and in any dispute.",
    category: "deals",
    trigger: { event: "rent.received" },
    actions: [
      {
        id: "action_lot_rent_receipt_email",
        type: "send_email",
        config: {
          to: "{{tenantEmail}}",
          subject: "Lot rent receipt — {{propertyAddress}} {{rentPeriodLabel}}",
          body:
            "Hi {{tenantName}},\n\nWe've received your lot rent of ${{rentAmount}} for {{rentPeriodLabel}} at {{propertyAddress}}. Year-to-date payments: ${{ytdPaid}}. Next payment due {{nextDueDate}}.\n\nThank you,\n{{orgName}}",
        },
      },
      {
        id: "action_lot_rent_received_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Lot rent received: {{propertyAddress}} — ${{rentAmount}} ({{rentPeriodLabel}}).",
        },
      },
    ],
  },
  {
    id: "tpl_tax_cert_redeemed_payoff",
    name: "Certificate Redeemed — Payoff Processing",
    description:
      "When the owner redeems a tax certificate, create the payoff-processing checklist (verify funds, release the certificate, record satisfaction, book the return) and notify the operator. Completes the cert lifecycle: acquired → redemption window → redeemed OR foreclosure-eligible.",
    category: "deals",
    trigger: { event: "cert.redeemed" },
    actions: [
      {
        id: "action_redeemed_payoff_task",
        type: "create_task",
        config: {
          title: "Process redemption payoff — Cert #{{certificateId}} ({{propertyAddress}})",
          description:
            "Owner redeemed on {{redeemedDate}}. Verify the county's payoff of ${{redemptionAmount}} equals principal plus statutory interest at {{stateStatutoryRatePct}} ({{state}}), surrender/release the certificate per county process, record the satisfaction, and book the realized return against the certificate.",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_redeemed_notify",
        type: "send_notification",
        config: {
          notificationType: "success",
          message:
            "Certificate redeemed: {{propertyAddress}} — Cert #{{certificateId}}, payoff ${{redemptionAmount}}.",
        },
      },
    ],
  },
  {
    id: "tpl_parcel_owner_changed_followup",
    name: "Tracked Parcel — Owner Changed",
    description:
      "When county data shows a new owner (or owner mailing address) on a parcel in your pipeline, create a follow-up task and notify — mail lists go stale the day this happens, and a fresh owner is often the best moment to reach out.",
    category: "leads",
    trigger: { event: "parcel.owner_changed" },
    actions: [
      {
        id: "action_owner_changed_task",
        type: "create_task",
        config: {
          title: "Owner changed on APN {{apn}} ({{county}}, {{state}})",
          description:
            "County data now shows {{field}} = {{currentValue}}. Update the linked lead/property record, pull the new owner's mailing address, and decide whether to restart outreach.",
          priority: "high",
          dueInDays: 2,
        },
      },
      {
        id: "action_owner_changed_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message:
            "Owner change detected: APN {{apn}} ({{county}}, {{state}}) — {{field}} is now {{currentValue}}.",
        },
      },
    ],
  },
  {
    id: "tpl_parcel_tax_delinquent_watchlist",
    name: "Tracked Parcel — Tax Status Changed",
    description:
      "When a tracked parcel's tax status or tax amount changes in county data, create a review task and notify — a parcel going delinquent is an auction-watchlist candidate; one going current means the owner just cured.",
    category: "leads",
    trigger: { event: "parcel.tax_status_changed" },
    actions: [
      {
        id: "action_tax_status_changed_task",
        type: "create_task",
        config: {
          title: "Tax status changed on APN {{apn}} ({{county}}, {{state}})",
          description:
            "County data now shows {{field}} = {{currentValue}}. If newly delinquent: add the parcel to the auction watchlist and check the county sale calendar. If newly current: the owner cured — reassess motivation on the linked lead.",
          priority: "high",
          dueInDays: 3,
        },
      },
      {
        id: "action_tax_status_changed_notify",
        type: "send_notification",
        config: {
          notificationType: "warning",
          message:
            "Tax status change: APN {{apn}} ({{county}}, {{state}}) — {{field}} is now {{currentValue}}.",
        },
      },
    ],
  },
  // ── Short-term-rental (STR) — turnover on checkout ──────────────────────
  // STR Wave A: reservation.checkout is now LIVE — strEvents.ts → emitStrEvent
  // fires it on a genuine reservation status→"checked_out" transition (the
  // rent-ledger PATCH seam). Every placeholder below binds a real field
  // emitReservationCheckout sends (reservationId, propertyAddress, unitLabel,
  // guestName, checkOutDate, channel, orgName) or null — no guest email, no
  // market/suggested nightly rate (residential-comps hard-stop). A turnover is a
  // TASK, not guest mail: there is deliberately no send_email action (guest mail
  // requires the org's own connected identity, which STR does not wire here).
  {
    id: "tpl_str_turnover_cleaning",
    name: "Short-Term Rental — Checkout → Turnover Cleaning",
    description:
      "When a guest checks out, create the turnover checklist (clean, restock, inspect, reset the listing) so the unit is ready for the next stay — the single most time-critical task in short-term rental operations.",
    category: "deals",
    trigger: { event: "reservation.checkout" },
    actions: [
      {
        id: "action_str_turnover_task",
        type: "create_task",
        config: {
          title: "Turnover clean — {{propertyAddress}} {{unitLabel}} (checkout {{checkOutDate}})",
          description:
            "Guest {{guestName}} checked out {{checkOutDate}} ({{channel}} booking). Turn the unit: clean and restock, inspect for damage, reset linens and amenities, and confirm the listing is open for the next stay. Same-day turns are the norm in short-term rental — do not let this slip.",
          priority: "high",
          dueInDays: 1,
        },
      },
      {
        id: "action_str_turnover_notify",
        type: "send_notification",
        config: {
          notificationType: "info",
          message:
            "Checkout: {{propertyAddress}} {{unitLabel}} — turnover cleaning needed before the next stay.",
        },
      },
    ],
  },
];

export type WorkflowEventData = {
  event: WorkflowTriggerEvent;
  organizationId: number;
  entityId: number;
  // "note" — the creative-finance / note-investor entity (audit Wave 1,
  // creative_finance beta→core). A note.balloon_approaching event's subject is
  // the serviced note itself; its numeric handle is the note's propertyId when
  // attached, else the note's own numeric id (notes.id is a serial). See
  // emitNoteEvent below.
  entityType: "lead" | "property" | "deal" | "payment" | "parcel" | "rehab" | "cert" | "buyer" | "note";
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

    return this.runActionsFrom(run, workflow, context, executionLog, 0);
  }

  /**
   * Resume a run that parked on a durable `delay`. Called by the
   * workflow_delay_resume job (server/jobs/workflowDelayResume.ts) for every
   * run whose `resumeAt` has passed. The run picks up at the exact action it
   * stopped before, with the interpolation variables it had accumulated —
   * possibly in a completely different process than the one that parked it.
   */
  async resumeWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> {
    const resumeState = run.resumeState;
    if (!resumeState) {
      // Nothing to resume from — do not guess and do not silently "complete"
      // a run whose remaining steps we cannot reconstruct.
      logger.error(
        `[WorkflowEngine] Cannot resume run ${run.id}: no resumeState persisted`,
      );
      return storage.updateWorkflowRun(run.id, {
        status: "failed",
        completedAt: new Date(),
        error:
          "Workflow could not be resumed after its wait: the saved resume point is missing. No further steps were run.",
        resumeAt: null,
      });
    }

    const workflowRow = await storage.getWorkflowById(run.workflowId);
    if (!workflowRow) {
      logger.error(
        `[WorkflowEngine] Cannot resume run ${run.id}: workflow ${run.workflowId} no longer exists`,
      );
      return storage.updateWorkflowRun(run.id, {
        status: "failed",
        completedAt: new Date(),
        error: `Workflow ${run.workflowId} was deleted while this run was waiting. No further steps were run.`,
        resumeAt: null,
      });
    }

    const executionLog: WorkflowExecutionLogEntry[] = Array.isArray(run.executionLog)
      ? (run.executionLog as WorkflowExecutionLogEntry[])
      : workflowRow.actions.map((action) => ({
          actionId: action.id,
          actionType: action.type,
          status: "pending" as const,
        }));

    // The delay step itself is only now genuinely over.
    const delayEntry = executionLog[resumeState.delayActionIndex];
    if (delayEntry) {
      delayEntry.status = "completed";
      delayEntry.completedAt = new Date().toISOString();
      delayEntry.result = {
        delayed: true,
        durable: true,
        delayMinutes: resumeState.delayMinutes,
        resumedAt: new Date().toISOString(),
      };
    }

    const context: WorkflowExecutionContext = {
      organizationId: workflowRow.organizationId,
      triggerData: (run.triggerData ?? { event: workflowRow.trigger.event }) as WorkflowExecutionContext["triggerData"],
      variables: { ...(resumeState.variables ?? {}) },
    };

    logger.info(
      `[WorkflowEngine] Resuming run ${run.id} at action index ${resumeState.nextActionIndex} after a ${resumeState.delayMinutes}m wait`,
    );

    return this.runActionsFrom(
      run,
      workflowRow,
      context,
      executionLog,
      resumeState.nextActionIndex,
    );
  }

  /**
   * The action loop, shared by a fresh execution and a post-delay resume.
   * `startIndex` is the first action to execute; everything before it either
   * already ran (fresh run: nothing) or is replayed from the persisted log.
   */
  private async runActionsFrom(
    run: WorkflowRun,
    workflow: Workflow,
    context: WorkflowExecutionContext,
    executionLog: WorkflowExecutionLogEntry[],
    startIndex: number,
  ): Promise<WorkflowRun> {
    try {
      for (let i = startIndex; i < workflow.actions.length; i++) {
        const action = workflow.actions[i];
        executionLog[i].status = "running";
        executionLog[i].startedAt = new Date().toISOString();

        run = await storage.updateWorkflowRun(run.id, { executionLog });

        // ── Durable delay (Wave B) ────────────────────────────────────────
        // A long wait is NOT slept through: the run parks with a persisted
        // wake time and the remaining work is resumed by a job. Before this,
        // `delay` capped at 60s in-process and evaporated on restart, so a
        // "wait 2 days" step was simply a lie.
        if (action.type === "delay") {
          const parked = await this.parkOrSleep(run, action, context, executionLog, i);
          if (parked) return parked;
          run = await storage.updateWorkflowRun(run.id, { executionLog });
          continue;
        }

        try {
          const result = await this.executeAction(action, context);
          if (isNonExecutingActionResult(result)) {
            // Either no rail could run ("unavailable") or a rail refused on
            // compliance grounds ("blocked"). Record it distinctly from
            // "completed" so the run log never claims work that didn't occur,
            // and do NOT merge the result into workflow variables (there is
            // no real output to pass on).
            // TODO(tsc): neither status is declared in the frozen shared
            // WorkflowExecutionLogEntry status union; widen locally (same
            // convention as ExtendedTriggerEvent above).
            (executionLog[i] as { status: string }).status = result.status;
            executionLog[i].completedAt = new Date().toISOString();
            executionLog[i].result = result;
          } else {
            executionLog[i].status = "completed";
            executionLog[i].completedAt = new Date().toISOString();
            executionLog[i].result = result;

            if (result) {
              Object.assign(context.variables, result);
            }
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

  /**
   * Handle one `delay` action. Short waits sleep inline (and the step
   * completes normally). Anything longer than INLINE_DELAY_MAX_MS parks the
   * run: status "waiting", `resumeAt` = the real wake time, `resumeState` =
   * where to pick up. Returns the parked run when it parked, or null when the
   * wait was slept through and the loop should continue.
   */
  private async parkOrSleep(
    run: WorkflowRun,
    action: WorkflowAction,
    context: WorkflowExecutionContext,
    executionLog: WorkflowExecutionLogEntry[],
    index: number,
  ): Promise<WorkflowRun | null> {
    const rawMinutes = Number((action.config as { delayMinutes?: unknown })?.delayMinutes ?? 1);
    const delayMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 1;
    const delayMs = delayMinutes * 60 * 1000;

    if (delayMs <= INLINE_DELAY_MAX_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      executionLog[index].status = "completed";
      executionLog[index].completedAt = new Date().toISOString();
      executionLog[index].result = { delayed: true, delayMinutes, durable: false };
      logger.info(`[WorkflowEngine] Delayed inline for ${delayMinutes} minute(s)`);
      return null;
    }

    const resumeAt = new Date(Date.now() + delayMs);
    // TODO(tsc): "waiting" is not declared in the frozen shared
    // WorkflowExecutionLogEntry status union; widen locally.
    (executionLog[index] as { status: string }).status = "waiting";
    executionLog[index].result = {
      delayed: true,
      durable: true,
      delayMinutes,
      resumeAt: resumeAt.toISOString(),
    };

    const parked = await storage.updateWorkflowRun(run.id, {
      status: "waiting",
      executionLog,
      resumeAt,
      resumeState: {
        delayActionIndex: index,
        nextActionIndex: index + 1,
        variables: { ...context.variables },
        delayMinutes,
      },
    });

    logger.info(
      `[WorkflowEngine] Run ${run.id} parked on a ${delayMinutes}m delay; resumes at ${resumeAt.toISOString()}`,
    );
    return parked;
  }

  /**
   * Sweep parked runs whose wake time has passed and continue them. Driven by
   * the workflow_delay_resume job under a job lock; the per-run claim is still
   * conditional (waiting → running) so a double-sweep can never re-run steps.
   */
  async resumeDueWorkflowRuns(
    limit = 25,
    now: Date = new Date(),
  ): Promise<{ due: number; resumed: number; failed: number }> {
    const due = await storage.getDueWaitingWorkflowRuns(now, limit);
    let resumed = 0;
    let failed = 0;

    for (const parked of due) {
      const claimed = await storage.claimWaitingWorkflowRun(parked.id);
      if (!claimed) continue; // another process took it
      try {
        await this.resumeWorkflowRun(claimed);
        resumed++;
      } catch (error) {
        failed++;
        logger.error(
          `[WorkflowEngine] Failed to resume workflow run ${parked.id}`,
          error,
        );
        await storage
          .updateWorkflowRun(parked.id, {
            status: "failed",
            completedAt: new Date(),
            error: `Resume after wait failed: ${error instanceof Error ? error.message : String(error)}`,
            resumeAt: null,
          })
          .catch(() => undefined);
      }
    }

    return { due: due.length, resumed, failed };
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
        // Reached only for a `delay` nested in a conditional branch — the
        // top-level loop intercepts delay steps before executeAction so they
        // can park the run durably. See runActionsFrom.
        return this.executeNestedDelay(action);
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

  /**
   * Real workflow email (Wave B "Wire the engine").
   *
   * Every send goes through `emailService.sendEmail` with
   * `purpose: "counterparty"`. Workflow mail is, by definition, the customer
   * talking to their own sellers / buyers / borrowers / tenants — never AcreOS
   * talking to its users. Per the standing founder decision (2026-07-17) that
   * lane REQUIRES the org's own connected identity (their SES credentials or
   * their verified sending domain); emailService refuses it otherwise and
   * there is deliberately NO fallback to the platform @acreos.io sender, here
   * or anywhere else. The refusal surfaces to the customer as an honest
   * "connect your email to enable this" — never as a silent re-fronting.
   *
   * Outcomes, all honest:
   *   - rail ran, SES accepted        → completed, `emailSent: result.success`
   *   - no connected identity         → "unavailable" (nothing was attempted)
   *   - TCPA / do-not-contact / suppression refusal → "blocked" (rail refused)
   *   - anything else (SES error, warmup cap, bad address) → throws → "failed"
   *
   * Do NOT introduce a literal `emailSent: true` here — success is always read
   * back off the rail's own result. tests/unit/workflowActionHonesty.test.ts
   * pins that.
   */
  private async executeSendEmail(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<
    | { emailSent: boolean; messageId?: string; emailTo: string }
    | ActionUnavailableResult
    | ActionBlockedResult
  > {
    const config = action.config;
    const to = this.interpolateTemplate(config.to || "", context.variables).trim();
    const subject = this.interpolateTemplate(config.subject || "", context.variables);
    const body = this.interpolateTemplate(config.body || "", context.variables);

    // An unresolved placeholder (`{{borrowerEmail}}` with no such variable) is
    // a real configuration failure, not a compliance outcome — fail loudly
    // rather than mailing a literal template string into the void.
    if (!to || to.includes("{{")) {
      throw new Error(
        `send_email has no usable recipient (resolved to "${to || "empty"}"). Check the workflow's "to" field and the trigger payload.`,
      );
    }

    // Consent gate: when the workflow is acting on a LEAD, the lead's own
    // TCPA / do-not-contact state decides whether we may email them at all.
    const consent = await this.checkLeadEmailConsent(context);
    if (consent && !consent.allowed) {
      logger.info(
        `[WorkflowEngine] send_email blocked by consent gate for lead ${context.triggerData.entityId}: ${consent.reason}`,
      );
      return {
        status: ACTION_STATUS_BLOCKED,
        emailSent: false,
        emailTo: to,
        reason: `No email sent: ${consent.reason || "this contact has opted out of contact"}. The workflow continued with its remaining steps.`,
      };
    }

    const { emailService } = await import("./emailService");
    const result = await emailService.sendEmail({
      to,
      subject,
      html: this.textToHtml(body),
      text: body,
      organizationId: context.organizationId,
      // Constitutional (founder decision 2026-07-17): BYO identity or nothing.
      purpose: "counterparty",
    });

    if (result.success) {
      logger.info(
        `[WorkflowEngine] send_email delivered via emailService (to=${to}, messageId=${result.messageId})`,
      );
      return { emailSent: result.success, messageId: result.messageId, emailTo: to };
    }

    // The org has no connected sending identity — the rail never ran. This is
    // the ONE outcome that must never degrade into a platform-sender send.
    if (result.errorType === "configuration_error") {
      logger.warn(
        `[WorkflowEngine] send_email unavailable — org ${context.organizationId} has no connected email identity`,
      );
      return {
        status: ACTION_STATUS_UNAVAILABLE,
        emailSent: false,
        emailTo: to,
        reason:
          "No email was sent: connect your email to enable this. Workflow email goes out under your organization's own connected identity (Settings → Connections — your email account or verified sending domain); AcreOS never sends to your sellers and buyers from the platform address.",
      };
    }

    // The rail ran and refused this recipient on compliance grounds. That is a
    // correct outcome, not an error — record it and let the run continue.
    if (result.errorType === "recipient_rejected") {
      logger.info(`[WorkflowEngine] send_email refused for ${to}: ${result.error}`);
      return {
        status: ACTION_STATUS_BLOCKED,
        emailSent: false,
        emailTo: to,
        reason: `No email sent: ${result.error}`,
      };
    }

    throw new Error(`Email send failed: ${result.error || "unknown error"}`);
  }

  /**
   * TCPA / do-not-contact check for the lead a workflow is acting on. Returns
   * null when the run is not lead-scoped (nothing to check) or when the lead
   * cannot be read — an unreadable lead is left to the send rail's own gates
   * rather than being silently treated as consenting.
   */
  private async checkLeadEmailConsent(
    context: WorkflowExecutionContext,
  ): Promise<{ allowed: boolean; reason?: string } | null> {
    const { entityType, entityId } = context.triggerData;
    if (entityType !== "lead" || typeof entityId !== "number") return null;

    try {
      const lead = await storage.getLead(context.organizationId, entityId);
      if (!lead) return null;
      const { canSendViaChannel } = await import("./tcpaCompliance");
      return canSendViaChannel(lead, "email");
    } catch (error) {
      logger.warn(
        `[WorkflowEngine] Could not read lead ${entityId} for consent check; deferring to send-rail gates`,
        error,
      );
      return null;
    }
  }

  /** Minimal plain-text → HTML for template bodies (they are authored as text). */
  private textToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("\n");
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

  /**
   * Real skill dispatch (Wave B "Wire the engine").
   *
   * The engine dispatches through `skillRegistry` and nothing else — a private
   * second dispatch path would be a shadow registry that drifts. Legacy
   * template ids are reconciled through WORKFLOW_SKILL_ID_ALIASES first; an id
   * that resolves in neither the alias map nor the registry returns
   * "unavailable" WITH THE ID NAMED, so the run log says exactly which skill
   * doesn't exist instead of implying one ran.
   *
   * Do NOT introduce a literal `skillExecuted: true` here — success is always
   * read back off the registry's own result.
   * tests/unit/workflowActionHonesty.test.ts pins that.
   */
  private async executeRunAgentSkill(
    action: WorkflowAction,
    context: WorkflowExecutionContext
  ): Promise<
    | { skillExecuted: boolean; skillId: string; skillData?: any; skillMessage?: string }
    | ActionUnavailableResult
  > {
    const config = action.config;
    const configuredId: string = config.skillId || "";
    const resolvedId = WORKFLOW_SKILL_ID_ALIASES[configuredId] ?? configuredId;

    if (!configuredId) {
      return {
        status: ACTION_STATUS_UNAVAILABLE,
        skillExecuted: false,
        skillId: "(none)",
        reason:
          "No skill ran: this step has no skillId configured. Open the workflow and choose a skill for it.",
      };
    }

    const { skillRegistry } = await import("./agent-skills");
    const skill = skillRegistry.getSkillById(resolvedId);
    if (!skill) {
      const named =
        resolvedId === configuredId
          ? `"${configuredId}"`
          : `"${configuredId}" (mapped to "${resolvedId}")`;
      logger.warn(
        `[WorkflowEngine] run_agent_skill skipped — skill ${named} is not registered`,
      );
      return {
        status: ACTION_STATUS_UNAVAILABLE,
        skillExecuted: false,
        skillId: configuredId,
        resolvedSkillId: resolvedId,
        reason: `No skill ran: skill ${named} is not registered in AcreOS, so there was nothing to execute. Edit this workflow step to pick a skill that exists.`,
      };
    }

    const params = this.buildSkillParams(config.skillParams, context);
    const result = await skillRegistry.executeSkill(resolvedId, params, {
      organizationId: context.organizationId,
      relatedLeadId:
        context.triggerData.entityType === "lead" ? context.triggerData.entityId : undefined,
      relatedPropertyId:
        context.triggerData.entityType === "property" ? context.triggerData.entityId : undefined,
      relatedDealId:
        context.triggerData.entityType === "deal" ? context.triggerData.entityId : undefined,
    });

    if (!result.success) {
      // The rail ran and errored — a real failure, recorded as one.
      throw new Error(`Skill "${resolvedId}" failed: ${result.error || "unknown error"}`);
    }

    logger.info(`[WorkflowEngine] Ran skill ${resolvedId} for org ${context.organizationId}`);
    return {
      skillExecuted: result.success,
      skillId: resolvedId,
      skillData: result.data,
      skillMessage: result.message,
    };
  }

  /**
   * Interpolate a step's skillParams and coerce the results back to real
   * types. Template params are authored as strings (`{{propertyId}}`) but
   * skill input schemas are typed (`z.number()`), so a raw interpolation would
   * fail validation on every run. Entity ids default from the trigger when the
   * step doesn't name one.
   */
  private buildSkillParams(
    raw: Record<string, any> | undefined,
    context: WorkflowExecutionContext,
  ): Record<string, any> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw || {})) {
      if (typeof value !== "string") {
        params[key] = value;
        continue;
      }
      const interpolated = this.interpolateTemplate(value, context.variables);
      // An unresolved placeholder must not be passed through as the literal
      // "{{propertyId}}" — drop it and let the defaults / schema decide.
      if (interpolated.includes("{{")) continue;
      const asNumber = Number(interpolated);
      params[key] =
        interpolated !== "" && Number.isFinite(asNumber) ? asNumber : interpolated;
    }

    const { entityType, entityId } = context.triggerData;
    if (typeof entityId === "number") {
      if (entityType === "lead" && params.leadId === undefined) params.leadId = entityId;
      if (entityType === "property" && params.propertyId === undefined) params.propertyId = entityId;
      if (entityType === "deal" && params.dealId === undefined) params.dealId = entityId;
    }
    return params;
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

  // NOTE: `delay` is deliberately NOT handled in executeAction. It is the one
  // action that can suspend the whole run, so it is handled by the action loop
  // itself (runActionsFrom → parkOrSleep), which owns the run row. The branch
  // below only exists for a `delay` nested inside a `conditional`, where there
  // is no run to park — an inline sleep bounded by INLINE_DELAY_MAX_MS is the
  // honest best we can do, and the log says how long it actually waited.
  private async executeNestedDelay(
    action: WorkflowAction,
  ): Promise<{ delayed: boolean; delayMinutes: number; actualWaitMs: number; durable: boolean }> {
    const rawMinutes = Number((action.config as { delayMinutes?: unknown })?.delayMinutes ?? 1);
    const delayMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 1;
    const actualWaitMs = Math.min(delayMinutes * 60 * 1000, INLINE_DELAY_MAX_MS);

    await new Promise((resolve) => setTimeout(resolve, actualWaitMs));

    if (actualWaitMs < delayMinutes * 60 * 1000) {
      logger.warn(
        `[WorkflowEngine] Nested delay inside a conditional waited ${actualWaitMs}ms, not the configured ${delayMinutes}m — nested branches cannot park the run. Move long waits to a top-level delay step.`,
      );
    }
    return { delayed: true, delayMinutes, actualWaitMs, durable: false };
  }

  private interpolateTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const parts = path.split(".");
      let value: any = variables;
      for (const part of parts) {
        value = value?.[part];
      }
      // An UNRESOLVED variable (undefined) keeps its literal {{placeholder}} —
      // the honesty ratchet relies on this so a workflow can never silently
      // render a variable it was never given. An emitter that DELIBERATELY sends
      // a real-but-absent field as `null` (refuse-not-fabricate — the fact is
      // genuinely unknown) must render as blank, never the literal string
      // "null", which would leak into customer-facing task/email/notification
      // copy (see accessibility.spec.ts / SIMULATION-SPEC: output is never
      // "null").
      if (value === undefined) return match;
      if (value === null) return "";
      return String(value);
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

// Iyari #5 — parcel delta events. entityId is the parcel_alerts row id (the
// system-of-record for the detected change). data carries apn/state/county/field
// + before/after values so workflow conditions can match on them.
export function emitParcelEvent(
  event: "parcel.owner_changed" | "parcel.tax_status_changed",
  organizationId: number,
  alertId: number,
  data: Record<string, any>,
  previousData?: Record<string, any>
): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId: alertId,
    entityType: "parcel",
    data,
    previousData,
  });
}

// emitRehabEvent — the fix-and-flip rehab lifecycle emitter (audit Wave 1,
// beta→core). Mirrors emitParcelEvent. A rehab's id is a varchar UUID but
// WorkflowEventData.entityId is numeric, so the rehab's own propertyId (one
// rehab per property — rehabs_property_uk) is the numeric entity handle; the
// rehab id + template fields ride in `data`. Until this shipped, the two flip
// milestone templates (tpl_flip_milestone_demo_complete / tpl_flip_listing_ready)
// had ZERO emitters and sat idle forever. Register both events in
// shared/workflow-live-triggers.ts in the SAME change (workflowActionHonesty
// test pins that relationship).
export function emitRehabEvent(
  event: "rehab.milestone" | "rehab.punch_list_complete",
  organizationId: number,
  propertyId: number,
  data: Record<string, any>,
): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId: propertyId,
    entityType: "rehab",
    data,
  });
}

// emitCertEvent — the tax-lien / tax-deed certificate lifecycle emitter (audit
// Wave 1, beta→core). Mirrors emitRehabEvent. A certificate's id is a varchar
// UUID but WorkflowEventData.entityId is numeric, so the cert's own propertyId
// (nullable — set only when a parcel is attached) is the numeric entity handle,
// falling back to 0 when absent; the cert id + template fields ride in `data`.
// Until this shipped, the four cert templates (tpl_tax_cert_acquired_kickoff /
// tpl_tax_cert_redemption_approaching / tpl_tax_cert_foreclosure_eligible /
// tpl_tax_cert_redeemed_payoff) had ZERO emitters and sat idle forever. Register
// all four events in shared/workflow-live-triggers.ts in the SAME change
// (workflowActionHonesty test pins that relationship). The event union MUST stay
// on one physical line — the honesty ratchet's derivation regex stops at the
// first newline after `event:`.
export function emitCertEvent(event: "cert.acquired" | "cert.redemption_period_60d" | "cert.foreclosure_eligible" | "cert.redeemed", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "cert",
    data,
  });
}

// emitSubdivisionEvent — the subdivider lifecycle emitter (audit Wave 1,
// beta→core). Mirrors emitCertEvent. The subdivision seams (a plat submitted to
// the county, a permit gate approved, a plat recorded) all hang off a parent
// PARCEL, which IS a properties row — so entityType is "property" and entityId
// is the parent parcel's properties.id (a real FK, properties.parent_parcel_id
// and the subdivision tables' parent_parcel_id both point at properties.id). No
// new entityType needed. Until this shipped the three subdivider templates
// (tpl_subdivision_plat_submitted / tpl_subdivision_vendor_milestone /
// tpl_subdivision_phase_recorded) had ZERO emitters and sat idle forever.
// Register all three events in shared/workflow-live-triggers.ts in the SAME
// change (workflowActionHonesty pins the call-site ↔ list relationship). The
// event union MUST stay on one physical line — the honesty ratchet's derivation
// regex stops at the first newline after `event:`.
export function emitSubdivisionEvent(event: "plat.submitted" | "subdivision.vendor_milestone" | "subdivision.phase_recorded", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "property",
    data,
  });
}

// emitWholesaleDealEvent — the residential-wholesaler deal lifecycle emitter
// (audit Wave 1, beta→core). Mirrors emitSubdivisionEvent. A wholesaler's deal
// diverges from a land flip at two moments the engine could never see fire: the
// purchase agreement is signed (the deal genuinely enters escrow) and the
// assignment is sent for signature. Both hang off a real deal, so entityType is
// "deal" and entityId is the deals.id. The third wholesaler template
// (tpl_wholesaler_occupied_cash_for_keys, event deal.occupied) is deliberately
// NOT wired here: no occupancy/occupant/cash-for-keys column or table exists on
// the deal/property path, so it cannot be made honest — it stays installable but
// honestly badged "not live" until an occupancy schema ships. Register both
// live events in shared/workflow-live-triggers.ts in the SAME change
// (workflowActionHonesty pins the call-site ↔ list relationship). The event
// union MUST stay on one physical line — the honesty ratchet's derivation regex
// stops at the first newline after `event:`.
export function emitWholesaleDealEvent(event: "deal.contract_signed" | "deal.assignment_pending", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "deal",
    data,
  });
}

// emitBuyerEvent — the buyer-match lifecycle emitter (audit Wave 1, beta→core).
// Mirrors emitWholesaleDealEvent. buyer.match_created fires when the AI matcher
// inserts a NEW buyer↔property match (never on the update-existing branch, so a
// re-run never re-fires). entityType is "buyer" and entityId is the
// buyer_profiles.id the match belongs to (the buyer is the subject of the
// event). Register the event in shared/workflow-live-triggers.ts in the SAME
// change (workflowActionHonesty pins the call-site ↔ list relationship). The
// event union MUST stay on one physical line — the honesty ratchet's derivation
// regex stops at the first newline after `event:`.
export function emitBuyerEvent(event: "buyer.match_created", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "buyer",
    data,
  });
}

// emitRentalEvent — the buy-and-hold landlord lifecycle emitter (audit Wave 1,
// beta→core). Mirrors emitBuyerEvent. The four landlord templates
// (tpl_landlord_rent_received_receipt / tpl_landlord_maintenance_request_triage
// / tpl_landlord_lease_renewal_countdown / tpl_lease_expiring) had ZERO emitters
// and sat idle forever — the whole landlord automation lane was dead. This makes
// rent.received (rent-ledger POST seam), maintenance.request_received (maintenance
// POST seam) and lease.renewal_countdown_60d / lease.expiring_60d (the new daily
// leaseExpiryDetector job) real; see server/services/rentalEvents.ts.
//
// entityType/entityId: every rental entity hangs off a real PROPERTY —
// rentalLeases.propertyId and maintenanceTickets.propertyId are both non-null FKs
// to properties.id — so entityType reuses "property" (no new union member) and
// entityId is that properties.id. The uuid keys (leaseId, paymentId, ticketId)
// ride in `data`. Register all four events in shared/workflow-live-triggers.ts in
// the SAME change (workflowActionHonesty pins the call-site ↔ list relationship).
// The event union MUST stay on one physical line — the honesty ratchet's
// derivation regex stops at the first newline after `event:`.
export function emitRentalEvent(event: "rent.received" | "maintenance.request_received" | "lease.renewal_countdown_60d" | "lease.expiring_60d", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "property",
    data,
  });
}

// emitNoteEvent — the creative-finance balloon lifecycle emitter (audit Wave 1,
// beta→core). Mirrors emitRentalEvent. Until this shipped,
// note.balloon_approaching had ZERO emit call sites, so its two templates
// (tpl_balloon_approaching / tpl_note_balloon_approaching_extended) sat idle
// forever — the balloon lane, a hallmark of wrap/owner-carry paper, was dead.
// The daily notePaymentDueDetector scan is now its emit site (a note whose
// maturityDate is inside the ~90-day window with a positive balance); see
// server/services/noteEvents.ts.
//
// entityType/entityId: a note's numeric handle is its propertyId when a parcel
// is attached (notes.propertyId → properties.id, nullable), else the note's own
// numeric id (notes.id is a serial — always a real number), so entityId is
// `propertyId ?? id`. entityType is the new "note" member (the note IS the
// subject; falling back to "property" would be dishonest when the handle is a
// note id). The note id + template fields ride in `data`. Register the event in
// shared/workflow-live-triggers.ts in the SAME change (workflowActionHonesty
// pins the call-site ↔ list relationship). The event union MUST stay on one
// physical line — the honesty ratchet's derivation regex stops at the first
// newline after `event:`.
export function emitNoteEvent(event: "note.balloon_approaching", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "note",
    data,
  });
}

// emitStrEvent — the short-term-rental lifecycle emitter (STR Wave A). Mirrors
// emitNoteEvent. Until this shipped, the STR nightly-stay lane had no primitive
// at all (STR rode the monthly-lease stack); now a reservation is its own row
// (shared/schema/rental.ts) and reservation.checkout fires when a stay
// transitions to 'checked_out' on the real production seam
// (server/routes-rent-ledger.ts PATCH /api/reservations/:id/status), resolved
// and dispatched by server/services/strEvents.ts. It drives
// tpl_str_turnover_cleaning (turnover-cleaning task, no guest mail on the
// platform sender). entityType/entityId: a reservation hangs off a real PROPERTY
// (reservations.propertyId is a non-null FK to properties.id), so entityType is
// "property" and entityId is that properties.id; the reservation id + template
// fields ride in `data`. Register the event in shared/workflow-live-triggers.ts
// in the SAME change (workflowActionHonesty pins the call-site ↔ list
// relationship). The event union MUST stay on one physical line — the honesty
// ratchet's derivation regex stops at the first newline after `event:`.
export function emitStrEvent(event: "reservation.checkout", organizationId: number, entityId: number, data: Record<string, any>): void {
  workflowEngine.emit({
    event,
    organizationId,
    entityId,
    entityType: "property",
    data,
  });
}

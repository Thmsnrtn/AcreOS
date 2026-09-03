import { storage } from "../storage";
import type { Organization } from "@shared/schema";
import { getSystemContext, formatContextForAI, invalidateContextCache } from "../services/aiContextAggregator";
import { lookupParcelByAPN } from "../services/parcel";
import { generateOfferSuggestions, generateOfferLetter } from "../services/aiOfferService";
import { emailService } from "../services/emailService";
import { smsService, sendOrgSMS } from "../services/smsService";
import { getComparableProperties } from "../services/comps";
import {
  checkTcpaConsentFromLead,
  isWithinQuietHours,
  isWithinQuietHoursForLead,
} from "../services/tcpaCompliance";
import { DataSourceBroker } from "../services/data-source-broker";
import { propertyEnrichmentService } from "../services/propertyEnrichment";
import {
  checkSendRateLimit,
  checkTcpaBeforeSend,
  recordAutonomousSend,
} from "../services/autonomyGuardrails";
import { logger } from "../utils/logger";
import { validateAtlasOutput, AtlasOutputType } from "./validators";
import {
  APPROVAL_REQUIRED_TOOLS as kernelApprovalRequiredTools,
  proposePendingAction,
  pendingActionArtifact,
} from "../services/approvalKernel";
// The ONE reader of the org's Pax controls (AUTONOMY_SPEC.md §4.2): stance,
// switches and the pause folded into one call, failing CLOSED. The pause
// primitive (server/services/paxPause.ts) is consulted through it.
import { getPaxControls, paxControlsRefusalMessage, type PaxControlsState } from "../services/paxControls";
import { recordPaxEffect } from "../services/paxReceipts";
import type { PaxAskOrigin, PaxAskSourceRef } from "@shared/pax-controls";
// The permission ladder, reachable without an Express request. `intentScopes`
// is a TYPE-ONLY leaf so importing it here is not the cycle that importing
// `appIntents/catalog` would be (catalog imports executeTool from this file).
import { userHasScope } from "../middleware/roleScope";
import { scopeForIntent, PII_SCOPES } from "../services/appIntents/intentScopes";
// Wave B "Wire the engine" — a lead Pax creates is a lead like any other, and
// a status Pax moves is a status change like any other. Both fire the same
// workflow events the human routes fire. Fire-and-forget: never throws.
import { emitLeadCreated, emitLeadUpdated } from "../services/leadEvents";
// Same reasoning for deals + properties: a deal Pax creates (including the
// offer-letter → pipeline bridge below) is a deal like any other, and a stage
// Pax moves is a stage change like any other.
import { emitDealCreated, emitDealStageChanged } from "../services/dealEvents";
import { emitPropertyCreated, emitPropertyStatusChanged } from "../services/propertyEvents";

// Tool parameter schemas (OpenAI function calling format)
export const toolDefinitions = {
  // System Context Tools
  get_system_context: {
    name: "get_system_context",
    description: "Get a comprehensive overview of the entire system including leads, properties, deals, notes, tasks, campaigns, and finance. Use this to understand the current state of the business before taking actions across any module.",
    parameters: { type: "object", properties: {} }
  },
  // CRM Tools
  get_leads: {
    name: "get_leads",
    description: "Get all leads in the CRM pipeline. Returns lead name, status, source, and contact info.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["new", "mailed", "responded", "negotiating", "accepted", "closed", "dead", "interested", "qualified", "under_contract"],
          description: "Filter by pipeline status (optional)"
        },
        type: {
          type: "string",
          enum: ["seller", "buyer"],
          description: "Filter by lead type (optional)"
        },
        limit: {
          type: "number",
          description: "Maximum number of leads to return (default 10)"
        }
      }
    }
  },
  get_lead_details: {
    name: "get_lead_details",
    description: "Get detailed information about a specific lead including notes and timeline.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "number", description: "The lead ID to look up" }
      },
      required: ["lead_id"]
    }
  },
  update_lead_status: {
    name: "update_lead_status",
    description: "Update a lead's pipeline status. Use when qualifying or advancing leads.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "number", description: "The lead ID" },
        status: { 
          type: "string", 
          enum: ["new", "mailed", "responded", "negotiating", "accepted", "closed", "dead", "interested", "qualified", "under_contract"],
          description: "New status"
        },
        notes: { type: "string", description: "Optional notes about the status change" }
      },
      required: ["lead_id", "status"]
    }
  },
  create_lead: {
    name: "create_lead",
    description: "Create a new lead in the CRM. Requires at least first and last name.",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string", description: "Lead's first name" },
        last_name: { type: "string", description: "Lead's last name" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number" },
        type: { type: "string", enum: ["seller", "buyer"], description: "Lead type (default: buyer)" },
        source: { type: "string", description: "Lead source (e.g., 'website', 'referral')" },
        notes: { type: "string", description: "Initial notes" }
      },
      required: ["first_name", "last_name"]
    }
  },
  
  // Property Tools
  get_properties: {
    name: "get_properties",
    description: "Get property inventory list with acreage, price, and status.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["prospect", "due_diligence", "offer_sent", "under_contract", "owned", "listed", "sold"],
          description: "Filter by status (optional)"
        },
        limit: { type: "number", description: "Maximum properties to return" }
      }
    }
  },
  get_property_details: {
    name: "get_property_details",
    description: "Get full details for a specific property including location, price, and history.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID" }
      },
      required: ["property_id"]
    }
  },
  
  // Finance Tools
  get_notes: {
    name: "get_notes",
    description: "Get seller financing notes with payment schedules and balances.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "active", "paid_off", "defaulted", "foreclosed"],
          description: "Filter by note status (optional)"
        }
      }
    }
  },
  calculate_amortization: {
    name: "calculate_amortization",
    description: "Calculate loan amortization schedule given principal, rate, and term.",
    parameters: {
      type: "object",
      properties: {
        principal: { type: "number", description: "Loan principal amount in dollars" },
        annual_rate: { type: "number", description: "Annual interest rate as percentage (e.g., 9.5)" },
        term_months: { type: "number", description: "Loan term in months" },
        down_payment: { type: "number", description: "Down payment amount (optional)" }
      },
      required: ["principal", "annual_rate", "term_months"]
    }
  },
  get_cashflow_summary: {
    name: "get_cashflow_summary",
    description: "Get monthly cashflow summary from all active notes.",
    parameters: { type: "object", properties: {} }
  },
  
  // Dashboard/Analytics
  get_dashboard_stats: {
    name: "get_dashboard_stats",
    description: "Get key business metrics: total properties, active notes, pipeline value, monthly cashflow.",
    parameters: { type: "object", properties: {} }
  },
  get_pipeline_summary: {
    name: "get_pipeline_summary", 
    description: "Get CRM pipeline summary with lead counts by status.",
    parameters: { type: "object", properties: {} }
  },
  
  // Property CRUD Tools
  create_property: {
    name: "create_property",
    description: "Create a new property in the inventory. Can add properties from any page - works in background.",
    parameters: {
      type: "object",
      properties: {
        apn: { type: "string", description: "Assessor's Parcel Number (required)" },
        address: { type: "string", description: "Property street address" },
        city: { type: "string", description: "City" },
        county: { type: "string", description: "County name (required)" },
        state: { type: "string", description: "State (2-letter code, required)" },
        zip: { type: "string", description: "ZIP code" },
        sizeAcres: { type: "number", description: "Property size in acres (required)" },
        listPrice: { type: "number", description: "List/asking price" },
        marketValue: { type: "number", description: "Estimated market value" },
        status: { 
          type: "string", 
          enum: ["prospect", "due_diligence", "offer_sent", "under_contract", "owned", "listed", "sold"],
          description: "Property status (default: prospect)"
        },
        notes: { type: "string", description: "Notes about the property" }
      },
      required: ["apn", "county", "state", "sizeAcres"]
    }
  },
  update_property: {
    name: "update_property",
    description: "Update an existing property's details or status.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID to update" },
        status: { 
          type: "string", 
          enum: ["prospect", "due_diligence", "offer_sent", "under_contract", "owned", "listed", "sold"],
          description: "New status"
        },
        listPrice: { type: "number", description: "Updated list price" },
        marketValue: { type: "number", description: "Updated market value" },
        notes: { type: "string", description: "Updated notes" }
      },
      required: ["property_id"]
    }
  },

  // Deal CRUD Tools
  get_deals: {
    name: "get_deals",
    description: "Get all deals in the pipeline with their status and amounts.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["acquisition", "disposition"], description: "Filter by deal type" },
        status: { type: "string", description: "Filter by deal status" },
        limit: { type: "number", description: "Maximum deals to return" }
      }
    }
  },
  create_deal: {
    name: "create_deal",
    description: "Create a new deal in the pipeline. Works from any page. Requires a property ID.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["acquisition", "disposition"], description: "Deal type" },
        propertyId: { type: "number", description: "Associated property ID (required)" },
        offerAmount: { type: "number", description: "Offer amount in dollars" },
        status: { 
          type: "string",
          enum: ["negotiating", "offer_sent", "countered", "accepted", "in_escrow", "closed", "cancelled"],
          description: "Deal status (default: negotiating)"
        },
        notes: { type: "string", description: "Deal notes" }
      },
      required: ["type", "propertyId"]
    }
  },
  update_deal: {
    name: "update_deal",
    description: "Update a deal's status, amount, or details.",
    parameters: {
      type: "object",
      properties: {
        deal_id: { type: "number", description: "The deal ID to update" },
        status: { type: "string", description: "New deal status" },
        offerAmount: { type: "number", description: "Updated offer amount" },
        notes: { type: "string", description: "Updated notes" }
      },
      required: ["deal_id"]
    }
  },

  // Task CRUD Tools
  get_tasks: {
    name: "get_tasks",
    description: "Get tasks with optional filtering. Works from any page.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"], description: "Filter by status" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Filter by priority" },
        limit: { type: "number", description: "Maximum tasks to return" }
      }
    }
  },
  create_task: {
    name: "create_task",
    description: "Create a new task. Can be used from any page to add tasks.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level (default: medium)" },
        dueDate: { type: "string", description: "Due date in ISO format (YYYY-MM-DD)" },
        entityType: { type: "string", enum: ["lead", "property", "deal", "none"], description: "Type of related entity (default: none)" },
        entityId: { type: "number", description: "ID of related entity" }
      },
      required: ["title"]
    }
  },
  update_task: {
    name: "update_task",
    description: "Update a task's status, priority, or details.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID to update" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"], description: "New status" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "New priority" },
        dueDate: { type: "string", description: "Updated due date" }
      },
      required: ["task_id"]
    }
  },
  complete_task: {
    name: "complete_task",
    description: "Mark a task as completed.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "The task ID to complete" }
      },
      required: ["task_id"]
    }
  },

  // `schedule_background_job` was here until 2026-08-19, and it was a lie with
  // a status field. It advertised an enum — bulk_property_import,
  // bulk_lead_import, campaign_send, report_generation — and its entire
  // implementation was one logger.info followed by
  // `{ success: true, data: { status: "queued" } }`. A user who asked Pax to run
  // the overnight campaign send was told it was queued. Nothing was queued;
  // none of those four job types exists anywhere in server/jobs or the outbox.
  // Deleted rather than wired, because wiring it means BUILDING four job types
  // and the defect is that it claimed to have them. See the deletion ledger.

  // Document Processing Tools
  extract_properties_from_text: {
    name: "extract_properties_from_text",
    description: "Extract property information (APNs, addresses, counties, states, sizes) from document text. Use this when the user has attached a document containing property data. Parse the text systematically to identify all properties.",
    parameters: {
      type: "object",
      properties: {
        document_text: { 
          type: "string", 
          description: "The raw text content extracted from the document to parse for property data" 
        },
        expected_count: {
          type: "number",
          description: "Expected number of properties to extract (helps validate extraction)"
        }
      },
      required: ["document_text"]
    }
  },

  create_properties_batch: {
    name: "create_properties_batch",
    description: "Create multiple properties at once from extracted data. Use after extracting property data from documents. More efficient than creating properties one by one.",
    parameters: {
      type: "object",
      properties: {
        properties: {
          type: "array",
          description: "Array of property objects to create",
          items: {
            type: "object",
            properties: {
              apn: { type: "string", description: "Assessor's Parcel Number (required)" },
              county: { type: "string", description: "County name (required)" },
              state: { type: "string", description: "State abbreviation (required)" },
              address: { type: "string", description: "Property address" },
              city: { type: "string", description: "City name" },
              zip: { type: "string", description: "ZIP code" },
              sizeAcres: { type: "string", description: "Property size in acres" },
              status: { type: "string", enum: ["prospect", "due_diligence", "offer_sent", "under_contract", "owned", "listed", "sold"], description: "Property status (default: prospect)" }
            },
            required: ["apn", "county", "state"]
          }
        }
      },
      required: ["properties"]
    }
  },

  generate_offer: {
    name: "generate_offer",
    description: "Generate offer suggestions for a property including market analysis, pricing strategies, and AI reasoning. Uses comparable sales data to determine fair offer prices.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID to generate offer suggestions for" }
      },
      required: ["property_id"]
    }
  },

  generate_offer_letter: {
    name: "generate_offer_letter",
    description: "Generate a professional offer letter for a property purchase. Creates personalized letter text and subject line based on property details and buyer information.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID for the offer" },
        offer_amount: { type: "number", description: "The offer amount in dollars" },
        buyer_name: { type: "string", description: "Full name of the buyer" },
        buyer_company: { type: "string", description: "Buyer's company name (optional)" },
        buyer_email: { type: "string", description: "Buyer's email address (optional)" },
        buyer_phone: { type: "string", description: "Buyer's phone number (optional)" },
        tone: { type: "string", enum: ["professional", "friendly", "urgent"], description: "Tone of the letter (default: professional)" },
        seller_name: { type: "string", description: "Name of the seller (optional)" },
        earnest_money: { type: "number", description: "Earnest money deposit amount (optional)" },
        closing_days: { type: "number", description: "Number of days to close (optional)" }
      },
      required: ["property_id", "offer_amount", "buyer_name"]
    }
  },

  send_email: {
    name: "send_email",
    description: "Send an email to a lead or any email address. Checks TCPA compliance when sending to leads. Use for follow-ups, offer letters, or general communication.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "number", description: "Lead ID to send email to (uses lead's email)" },
        email: { type: "string", description: "Direct email address (used if lead_id not provided)" },
        subject: { type: "string", description: "Email subject line" },
        message: { type: "string", description: "Email body content (can include HTML)" }
      },
      required: ["subject", "message"]
    }
  },

  send_sms: {
    name: "send_sms",
    description: "Send an SMS text message to a lead or phone number. Checks TCPA compliance before sending. Use for quick follow-ups or time-sensitive communications.",
    parameters: {
      type: "object",
      properties: {
        lead_id: { type: "number", description: "Lead ID to send SMS to (uses lead's phone)" },
        phone_number: { type: "string", description: "Direct phone number (used if lead_id not provided)" },
        message: { type: "string", description: "SMS message content (max 160 chars recommended)" }
      },
      required: ["message"]
    }
  },

  run_comps_analysis: {
    name: "run_comps_analysis",
    description: "Run a comparable sales analysis for a property. Finds nearby sold properties to estimate market value and provide pricing insights.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID to analyze" },
        radius_miles: { type: "number", description: "Search radius in miles (default: 5)" },
        max_results: { type: "number", description: "Maximum comparable properties to return (default: 10)" }
      },
      required: ["property_id"]
    }
  },

  calculate_roi: {
    name: "calculate_roi",
    description: "Calculate ROI and financial metrics for a potential investment. Computes profit, ROI percentage, annualized return, and cash-on-cash return.",
    parameters: {
      type: "object",
      properties: {
        purchase_price: { type: "number", description: "Property purchase price in dollars" },
        estimated_sale_price: { type: "number", description: "Expected sale price in dollars" },
        holding_costs: { type: "number", description: "Monthly holding costs (taxes, insurance, etc.)" },
        improvement_costs: { type: "number", description: "Total improvement/renovation costs" },
        holding_months: { type: "number", description: "Expected holding period in months" }
      },
      required: ["purchase_price", "estimated_sale_price"]
    }
  },

  calculate_payment_schedule: {
    name: "calculate_payment_schedule",
    description: "Generate an amortization schedule for seller financing or loan analysis. Shows monthly payment, total interest, and payment breakdown.",
    parameters: {
      type: "object",
      properties: {
        principal: { type: "number", description: "Loan principal amount in dollars" },
        interest_rate: { type: "number", description: "Annual interest rate as percentage (e.g., 9.5)" },
        term_months: { type: "number", description: "Loan term in months" },
        down_payment: { type: "number", description: "Down payment amount (optional)" }
      },
      required: ["principal", "interest_rate", "term_months"]
    }
  },

  research_property: {
    name: "research_property",
    description: "Research comprehensive property data using ALL available data sources: flood zone, wetlands, soil, environmental, infrastructure proximity, demographics, public lands, transportation access, water resources, elevation, climate, agricultural values, land cover, cropland, PLSS section/township, watershed, FEMA NRI risk scores, and USDA CLU farm data. Use this for deep property due diligence.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID to research" },
        force_refresh: { type: "boolean", description: "Force re-fetch from upstream sources even if cached (default: false)" }
      },
      required: ["property_id"]
    }
  },

  get_property_enrichment: {
    name: "get_property_enrichment",
    description: "Retrieve previously stored enrichment data for a property (flood zone, soil, demographics, hazards, scores, etc.) without making new API calls. Faster than research_property when enrichment has already been run.",
    parameters: {
      type: "object",
      properties: {
        property_id: { type: "number", description: "The property ID whose enrichment data to retrieve" }
      },
      required: ["property_id"]
    }
  },

  schedule_followup: {
    name: "schedule_followup",
    description: "Create a follow-up task linked to a lead, property, or deal. Use for scheduling callbacks, site visits, or reminder tasks.",
    parameters: {
      type: "object",
      properties: {
        entity_type: { type: "string", enum: ["lead", "property", "deal"], description: "Type of entity to link the follow-up to" },
        entity_id: { type: "number", description: "ID of the entity to link to" },
        title: { type: "string", description: "Title of the follow-up task" },
        description: { type: "string", description: "Detailed description of the follow-up (optional)" },
        due_date: { type: "string", description: "Due date in ISO format (YYYY-MM-DD)" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Priority level (default: medium)" }
      },
      required: ["entity_type", "entity_id", "title", "due_date"]
    }
  },

  browse_web: {
    name: "browse_web",
    description: "Browse any website and extract its content. Use this for real-time research on county assessor sites, property listings, government records, or any web page. Returns page title, text content, links, and tables. Can optionally take a screenshot.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL to browse (must start with http:// or https://)" },
        extract_tables: { type: "boolean", description: "Whether to extract table data from the page (default: true)" },
        take_screenshot: { type: "boolean", description: "Whether to capture a screenshot (default: false)" },
        wait_ms: { type: "number", description: "Extra milliseconds to wait after page load for dynamic content (default: 0)" }
      },
      required: ["url"]
    }
  },

  draft_offer: {
    name: "draft_offer",
    description: "Draft a purchase offer letter for a land deal. Queries deal and property from the database, generates a professional offer letter using AI, and returns the draft text.",
    parameters: {
      type: "object",
      properties: {
        dealId: { type: "number", description: "The deal ID to draft an offer for" },
        offerAmount: { type: "number", description: "The offer amount in dollars" },
        closingDays: { type: "number", description: "Number of days to close (default: 30)" },
        contingencies: { type: "array", items: { type: "string" }, description: "List of contingencies (e.g., ['financing', 'inspection', 'title_clear'])" }
      },
      required: ["dealId", "offerAmount"]
    }
  },

  schedule_follow_up: {
    name: "schedule_follow_up",
    description: "Schedule a follow-up task for a lead or deal. Creates a task record in the database and returns confirmation with the task details.",
    parameters: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["lead", "deal"], description: "Type of entity to link the follow-up to" },
        entityId: { type: "number", description: "ID of the lead or deal" },
        followUpDate: { type: "string", description: "Follow-up date in ISO format (YYYY-MM-DD)" },
        note: { type: "string", description: "Note or description for the follow-up task" }
      },
      required: ["entityType", "entityId", "followUpDate", "note"]
    }
  },

  run_comps: {
    name: "run_comps",
    description: "Find comparable sales for a property to estimate market value. Queries properties table for similar properties in the same county/state, calculates median price per acre, and returns a comp analysis summary.",
    parameters: {
      type: "object",
      properties: {
        propertyId: { type: "number", description: "The property ID to find comps for" },
        radiusMiles: { type: "number", description: "Search radius in miles (default: 25 — used for context; comps are filtered by county/state)" }
      },
      required: ["propertyId"]
    }
  },

  get_stale_leads: {
    name: "get_stale_leads",
    description: "Find leads that haven't been contacted recently. Queries leads to find those with no activity in N days and returns a list with lead names and last contact dates.",
    parameters: {
      type: "object",
      properties: {
        daysSinceContact: { type: "number", description: "Days since last contact threshold (default: 14)" }
      }
    }
  },

  draft_outreach_message: {
    name: "draft_outreach_message",
    description: "Draft a personalized outreach message for a seller. Queries lead details and property info, then generates a personalized message appropriate for the medium and seller situation.",
    parameters: {
      type: "object",
      properties: {
        leadId: { type: "number", description: "The lead ID to draft a message for" },
        messageType: { type: "string", enum: ["email", "sms", "voicemail_script"], description: "Type of message to draft" }
      },
      required: ["leadId", "messageType"]
    }
  },

  // ── Connector tools — only active when the connector is configured ──────

  search_gmail: {
    name: "search_gmail",
    description: "Search the user's Gmail inbox. Use to find emails from leads, sellers, or about specific properties.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query (e.g. 'from:seller@email.com', 'subject:offer', 'property address')" },
        maxResults: { type: "number", description: "Max results to return (default: 10)" },
      },
      required: ["query"],
    },
  },

  send_gmail: {
    name: "send_gmail",
    description: "Send an email via the user's Gmail account.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body (plain text)" },
      },
      required: ["to", "subject", "body"],
    },
  },

  send_slack_message: {
    name: "send_slack_message",
    description: "Send a message to a Slack channel. Use for deal alerts, lead notifications, or team updates.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message text to send" },
        channel: { type: "string", description: "Slack channel (e.g. #deals). Optional — uses default if not specified." },
      },
      required: ["message"],
    },
  },

  get_stripe_customer: {
    name: "get_stripe_customer",
    description: "Look up a customer in Stripe by email or customer ID.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer email address" },
        customerId: { type: "string", description: "Stripe customer ID (cus_...)" },
      },
    },
  },

  list_stripe_payments: {
    name: "list_stripe_payments",
    description: "List recent Stripe charges/payments. Can filter by customer.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of payments to return (default: 10)" },
        customerId: { type: "string", description: "Filter by Stripe customer ID" },
      },
    },
  },

  create_stripe_payment_link: {
    name: "create_stripe_payment_link",
    description: "Create a Stripe payment link for a deal (e.g. earnest money, option fee, down payment).",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in dollars" },
        description: { type: "string", description: "Payment description (e.g. 'Earnest money — 123 Oak St')" },
        currency: { type: "string", description: "Currency code (default: usd)" },
      },
      required: ["amount", "description"],
    },
  },

  search_drive: {
    name: "search_drive",
    description: "Search Google Drive for property documents, contracts, or due diligence files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term (file name or content)" },
        maxResults: { type: "number", description: "Max results (default: 10)" },
      },
      required: ["query"],
    },
  },

  get_drive_file: {
    name: "get_drive_file",
    description: "Get metadata and view link for a specific Google Drive file.",
    parameters: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Google Drive file ID" },
      },
      required: ["fileId"],
    },
  },

  list_calendar_events: {
    name: "list_calendar_events",
    description: "List upcoming Google Calendar events. Use to check schedule before booking showings or closings.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days ahead to look (default: 7)" },
      },
    },
  },

  create_calendar_event: {
    name: "create_calendar_event",
    description: "Create a Google Calendar event (showing, closing, call, follow-up).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        startDateTime: { type: "string", description: "Start date-time in ISO format (e.g. 2025-04-01T10:00:00-05:00)" },
        endDateTime: { type: "string", description: "End date-time in ISO format" },
        description: { type: "string", description: "Event description or notes" },
        location: { type: "string", description: "Location (address or video call link)" },
        attendees: { type: "array", items: { type: "string" }, description: "List of attendee email addresses" },
      },
      required: ["title", "startDateTime", "endDateTime"],
    },
  },

  // DELETED 2026-08-21 — propstream_lookup and propstream_comps, with their
  // executors. The PropStream connector is now `availability: "planned"`, which
  // the catalog-honesty gate requires to mean "no dispatchable tools".
  //
  // Not a capability that was removed: a capability nothing established existed.
  // The repository held TWO MUTUALLY INCOMPATIBLE contracts for this vendor —
  // these two used `Authorization: Bearer <the org's static apiKey>` against
  // GET /property/search and /comps, while titleSearchService.ts POSTs
  // {username,password} to /login for a token and then POSTs /property/detail.
  // Both cannot be the vendor's auth model. The executor carried its own
  // admission: "simplified - actual endpoint varies by subscription". No
  // fixture, recorded response, telemetry or test ever exercised either path.
  //
  // Same disposition as batch_leads_skip_trace (ledger 38): a bare `fetch` with
  // no provider registry, no cache, no breaker and no license flag, reachable
  // by a customer typing a sentence. Routing it through the registry — the
  // plan this frontier item originally carried — would have built governance
  // around an integration nobody had confirmed exists.

  batch_leads_skip_trace: {
    name: "batch_leads_skip_trace",
    description: "Skip trace a lead via BatchLeads to find phone numbers and contact info.",
    parameters: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        address: { type: "string", description: "Property address" },
        phone: { type: "string", description: "Known phone number (optional)" },
      },
    },
  },

  search_mls_listings: {
    name: "search_mls_listings",
    description: "Search MLS listings via RESO API. Find active listings or sold comps.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
        state: { type: "string" },
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
        status: { type: "string", enum: ["Active", "Closed", "Pending"], description: "Listing status" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
    },
  },

  get_mls_comps: {
    name: "get_mls_comps",
    description: "Get comparable sold listings from MLS for a given property address.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "Subject property address" },
        radius: { type: "number", description: "Search radius in miles" },
        limit: { type: "number" },
      },
      required: ["address"],
    },
  },

  trigger_zapier: {
    name: "trigger_zapier",
    description: "Trigger a Zapier webhook with structured data. Use to automate follow-up sequences, CRM updates, or any downstream workflow.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "object", description: "Payload to send to Zapier (any key-value pairs)" },
      },
      required: ["data"],
    },
  },

  trigger_make: {
    name: "trigger_make",
    description: "Trigger a Make (Integromat) webhook scenario with structured data.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "object", description: "Payload to send to Make" },
      },
      required: ["data"],
    },
  },

  // ── Memory tools ─────────────────────────────────────────────────────────

  remember_fact: {
    name: "remember_fact",
    description: "Permanently remember an important fact, preference, decision, or insight for this organization. Use proactively when the user states preferences, makes key decisions, or shares important context that should persist across conversations.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The fact or preference to remember, written as a clear statement" },
        category: {
          type: "string",
          enum: ["preference", "insight", "decision", "contact"],
          description: "Category of the memory"
        },
      },
      required: ["fact", "category"],
    },
  },

  recall_facts: {
    name: "recall_facts",
    description: "Recall previously remembered facts and preferences for this organization. Use before answering questions where context from past conversations might be relevant.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic or keyword to search remembered facts" },
        category: {
          type: "string",
          enum: ["preference", "insight", "decision", "contact"],
          description: "Optional category to filter by"
        },
        limit: { type: "number", description: "Max facts to return (default 10)" },
      },
      required: ["query"],
    },
  },

  // ── Sub-agent tool ────────────────────────────────────────────────────────

  spawn_subagent: {
    name: "spawn_subagent",
    description: "Spawn a sub-agent to handle an independent subtask and return its result. Use for parallelizable research tasks, e.g. analyzing multiple properties or markets simultaneously. Max depth: 2.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The full task or question for the sub-agent to handle" },
        role: {
          type: "string",
          enum: ["executive", "research", "underwriting", "acquisitions"],
          description: "Agent role best suited for this subtask (default: research)"
        },
      },
      required: ["prompt"],
    },
  },

  // ── Land-knowledge retrieval tool (Andrei E5) ──────────────────────────────

  retrieve_land_knowledge: {
    name: "retrieve_land_knowledge",
    description:
      "Retrieve GENERAL land-investing knowledge cards (with citations) to EXPLAIN a land concept — e.g. \"what does FEMA Zone AE mean for building?\", \"how does a perc test affect septic?\", \"how does a contract for deed work?\", \"what is a landlocked parcel?\". Call this for EXPLANATORY questions about how land mechanics work (flood zones, soils/perc, seller financing, usury, easements/access, mineral severance, title, zoning, diligence traps). This is DISTINCT from parcel-fact lookups (research_property / get_property_enrichment): it returns general domain knowledge, NEVER facts about a specific parcel. Each card returns its source citation — attribute the explanation to it, and never present a card's general statement as a fact about the customer's specific parcel.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The explanatory question or land concept to look up, in natural language (e.g. 'what does Zone AE mean for building a house').",
        },
        topK: {
          type: "number",
          description: "Max cards to return (default 3, max 8).",
        },
      },
      required: ["query"],
    },
  },
};

// Tools that require user approval before execution (communication + payment
// tools). Canonical definition lives in the approval kernel
// (server/services/approvalKernel.ts) — re-exported here for existing
// importers (executive.ts historical, appIntents catalog, MCP safe intents).
export { APPROVAL_REQUIRED_TOOLS } from "../services/approvalKernel";

// ── Pause-safe tools (Workstream A honesty — the Pax kill switch) ────────────
// Explicit allowlist of tools with NO side effects beyond the conversation:
// lookups, calculations, external READ-only research, and drafts that don't
// send. While the org's Pax pause (pax.pausedUntil, written by /settings/pax)
// is active, executeTool refuses every tool NOT on this list with an honest,
// user-visible message — drafting isn't automation acting, but record writes,
// sends, queue/campaign actions, and external triggers are.
//
// DEFAULT-DENY: a new tool is side-effecting until someone deliberately adds
// it here. That is the safe failure mode for a kill switch.
/**
 * Tools refused on the Pax path because a legal precondition cannot be met by a
 * model. See the FCRA gate in executeTool for the reasoning; the set exists so
 * the refusal is enumerable rather than a branch buried in a switch.
 */
const FCRA_REFUSED_TOOLS: ReadonlySet<string> = new Set(["batch_leads_skip_trace"]);

export const PAUSE_SAFE_TOOLS: ReadonlySet<string> = new Set([
  // System / dashboard reads
  "get_system_context",
  "get_dashboard_stats",
  "get_pipeline_summary",
  // CRM / inventory / finance reads
  "get_leads",
  "get_lead_details",
  "get_stale_leads",
  "get_properties",
  "get_property_details",
  "get_property_enrichment",
  "get_deals",
  "get_tasks",
  "get_notes",
  "get_cashflow_summary",
  // Pure calculations
  "calculate_amortization",
  "calculate_payment_schedule",
  "calculate_roi",
  // Analysis / research (reads external data, changes nothing of the user's)
  "run_comps",
  "run_comps_analysis",
  "research_property",
  "browse_web",
  "extract_properties_from_text",
  "retrieve_land_knowledge",
  // Drafts that don't send (the pause promise: "Pax will still draft and ask").
  // `draft_offer` left this list on 2026-09-02: it advances a negotiating deal
  // to offer_sent and writes a paxMemory row — a record mutation, and
  // pause-safe must mean no storage mutation (spec §3d; pauseSafeToolsAreSafe
  // in tests/unit/paxPauseToolGate.test.ts reads every allowlisted case body).
  "generate_offer",
  "draft_outreach_message",
  // Connector READS (their write counterparts — send_gmail, send_slack_message,
  // create_stripe_payment_link, create_calendar_event, trigger_zapier/make —
  // are deliberately absent)
  "search_gmail",
  "search_drive",
  "get_drive_file",
  "list_calendar_events",
  "get_stripe_customer",
  "list_stripe_payments",
  // batch_leads_skip_trace was here until 2026-08-19. A consumer-report lookup
  // that spends the org's BatchLeads credits and returns a third party's phone
  // numbers and prior addresses is not "safe to run while Pax is paused"; the
  // FCRA gate below refuses it outright now, and it must not sit on an
  // allowlist that says otherwise if that ever changes.
  "search_mls_listings",
  "get_mls_comps",
  // Org memory — conversation-scoped notes, not actions on the world
  "remember_fact",
  "recall_facts",
  // Sub-agents recurse through executeTool, so their side-effecting calls hit
  // this same gate with the same org
  "spawn_subagent",
]);

/**
 * Which lane a tool call arrived through (AUTONOMY_SPEC.md §4.3). Exactly the
 * ExecuteToolOptions lanes of PAX_ASK_ORIGINS — `finance_ladder` is written
 * by the borrower ladder's own gate, never by a tool call — so an origin
 * recorded on an ask row is always a value the row's type accepts.
 */
export type ExecuteToolOrigin = Extract<
  PaxAskOrigin,
  "chat" | "scheduled" | "inbound_signal" | "support" | "approval_replay" | "revised"
>;

// Options threaded into executeTool by TRUSTED SERVER CODE only — never
// derived from model output. See the witnessed-send kernel gate below.
export interface ExecuteToolOptions {
  /**
   * True ONLY when a human explicitly approved this exact action (the
   * pending-action approve endpoint after the user taps "Send"). The model
   * cannot set this — it is not a tool arg.
   */
  trustedApproval?: boolean;
  /** The requesting user, recorded as created_by on pending_actions rows. */
  userId?: string;
  /**
   * Where the call came from. Recorded on every ask row and every receipt so
   * "Waiting for your tap" can say "from your scheduled prompt 'Monday lead
   * pull'" and "What Pax did" can say "ran on its own". Defaults to "chat".
   */
  origin?: ExecuteToolOrigin;
  /** The scheduled prompt that ran this call, when origin is "scheduled". */
  scheduledTask?: { id: number; name: string } | null;
}

type ToolResult = { success: boolean; data?: any; error?: string };

const positiveInt = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
};

/**
 * The record an ask is about, derived from the frozen args (spec §4.3:
 * lead_id | deal_id | property_id) plus the scheduled prompt that proposed
 * it. Only fields the frozen PaxAskSourceRef declares; a tool whose args
 * name no record yields null rather than an invented reference.
 */
function askSourceRef(args: Record<string, any>, options?: ExecuteToolOptions): PaxAskSourceRef | null {
  const ref: PaxAskSourceRef = {};
  const leadId = positiveInt(args.lead_id ?? args.leadId);
  if (leadId) ref.leadId = leadId;
  const dealId = positiveInt(args.deal_id ?? args.dealId);
  if (dealId) ref.dealId = dealId;
  const propertyId = positiveInt(args.property_id ?? args.propertyId);
  if (propertyId) ref.propertyId = propertyId;
  const noteId = positiveInt(args.note_id ?? args.noteId);
  if (noteId) ref.noteId = noteId;
  if (options?.scheduledTask) {
    ref.scheduledTaskId = options.scheduledTask.id;
    ref.scheduledTaskName = options.scheduledTask.name;
  }
  return Object.keys(ref).length > 0 ? ref : null;
}

/**
 * Which record a completed tool call touched, for the generic receipt: read
 * from the result first (the row the tool actually wrote), then from the
 * args, and otherwise the org itself — never an invented id.
 */
function receiptEntity(
  org: Organization,
  args: Record<string, any>,
  data: any,
): { entityType: string; entityId: number } {
  const d = data && typeof data === "object" ? data : {};
  const candidates: Array<[string, unknown]> = [
    ["lead", d.lead?.id],
    ["deal", d.deal?.id],
    ["property", d.property?.id],
    ["task", d.task?.id],
    ["deal", d.dealId],
    ["property", d.propertyId],
    ["lead", args.lead_id ?? args.leadId],
    ["deal", args.deal_id ?? args.dealId],
    ["property", args.property_id ?? args.propertyId],
    ["task", args.task_id ?? args.taskId],
  ];
  if (typeof args.entityType === "string" || typeof args.entity_type === "string") {
    candidates.push([String(args.entityType ?? args.entity_type), args.entityId ?? args.entity_id]);
  }
  for (const [type, id] of candidates) {
    const n = positiveInt(id);
    if (n) return { entityType: type, entityId: n };
  }
  return { entityType: "organization", entityId: org.id };
}

// Tool executor functions
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  org: Organization,
  options?: ExecuteToolOptions
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // ── Witnessed-send kernel gate (2026-06-10, T0-1 elevation blueprint) ──
    // `_approved` used to be an ordinary tool arg, which meant (a) the MODEL
    // could emit `_approved: true` itself and unlock the guarded send, and
    // (b) vaService called executeTool with no call-site approval gate at
    // all. Approval is now a server-side OPTION (`trustedApproval`) that only
    // the human-tap approve endpoint sets. Any `_approved` arriving in args
    // is model-supplied by definition — strip it before dispatch so it can
    // never influence a send decision. The call-site blocks in executive.ts
    // remain as defense-in-depth; THIS gate is the one that holds.
    if ("_approved" in args) {
      logger.warn("[executeTool] Stripped model-supplied _approved arg", {
        metadata: { toolName, orgId: org.id },
      });
      const { _approved: _stripped, ...rest } = args;
      args = rest;
    }
    const trustedApproval = options?.trustedApproval === true;
    const origin: ExecuteToolOrigin = options?.origin ?? "chat";
    const pauseSafe = PAUSE_SAFE_TOOLS.has(toolName);

    // ── The org's Pax controls — ONE read per invocation (spec §4.2, §4.3) ─
    // Stance + switches + pause in one call, failing CLOSED. Skipped for the
    // two cases the controls never gate: a pause-safe tool (looks and drafts
    // are never gated, never counted, and keep working while paused) and the
    // human-approved replay (a tap is the human acting, not Pax).
    const controls: PaxControlsState | null =
      !pauseSafe && !trustedApproval ? await getPaxControls(org.id) : null;

    // A failed read is not a stance. When the controls could not be verified
    // NOTHING proceeds — not even as an ask, because an ask row minted under
    // an unknown state is a stance the org never chose. The glossary line
    // says exactly that ("could not verify … so this wasn't done").
    if (controls?.checkFailed) {
      logger.warn("[executeTool] Refused — Pax controls could not be verified (failing closed)", {
        orgId: org.id,
        metadata: { toolName, origin },
      });
      return { success: false, error: paxControlsRefusalMessage(controls) };
    }

    // ── The approval kernel (2026-06-10, Tier 1A; stance-aware 2026-09-02) ─
    // STRUCTURAL gate: a call that requires a tap and arrives without the
    // trusted server-side approval option does not execute, period. It is
    // frozen as a pending_actions row (frozen args + sha256 content hash +
    // 24h expiry + origin + the record it is about) and a pending artifact
    // is returned for the human to approve. The ONLY path to execution is
    // the approve endpoint, which re-verifies the hash and replays EXACTLY
    // the frozen row with { trustedApproval: true }. Because this lives
    // inside executeTool, every caller — chat, streaming chat, vaService,
    // app intents, scheduled prompts, sub-agents — inherits it.
    //
    // What requires a tap (spec §4.3):
    //   - every send, at EVERY stance (APPROVAL_REQUIRED_TOOLS may only grow;
    //     founder decision 1: Pax never sends what it wrote without a tap);
    //   - at "Ask before everything", every non-pause-safe tool — record
    //     writes included, and the customer's own chat commands included
    //     (founder decision 4: uniform, no asterisk).
    const requiresAsk =
      kernelApprovalRequiredTools.has(toolName) ||
      (controls?.stance === "ask_before_everything" && !pauseSafe);
    if (requiresAsk && !trustedApproval) {
      const pending = await proposePendingAction({
        organizationId: org.id,
        toolName,
        args,
        createdByUserId: options?.userId ?? null,
        origin,
        sourceRef: askSourceRef(args, options),
        reason: typeof args.reason === "string" && args.reason.length > 0 ? args.reason : null,
      });
      return { success: true, data: pendingActionArtifact(pending) };
    }

    // ── Pax pause gate (Workstream A honesty, 2026-07-29) ──────────────────
    // Settings → Pax writes the pause; THIS read (through getPaxControls) is
    // what makes it real at the tool chokepoint. While the org is paused,
    // any tool not on PAUSE_SAFE_TOOLS is refused with the glossary's line —
    // nothing executes, and nothing pretends to.
    //
    // Ordering is deliberate (kernel → pause → scope → FCRA):
    //  - AFTER the approval kernel: an unapproved send has already been
    //    frozen as an ask above — asks keep accumulating while paused
    //    ("Pax still looks, drafts and asks; anything you approve still goes
    //    out").
    //  - trustedApproval bypasses the gate: a human explicitly tapping
    //    Approve is the human acting, not Pax automation.
    if (controls?.paused) {
      logger.info("[executeTool] Refused side-effecting tool — Pax is paused for this org", {
        orgId: org.id,
        metadata: {
          toolName,
          origin,
          pausedUntil: controls.pausedUntil?.toISOString() ?? null,
        },
      });
      return { success: false, error: paxControlsRefusalMessage(controls) };
    }

    // ── Permission-ladder gate (2026-08-19) ───────────────────────────────
    // The App Intent registry declares a `requiredScope` for every intent
    // (server/services/appIntents/intentScopes.ts). Until now NOTHING on the
    // Pax path read it: the only consumer was mcp/safeIntents.ts, which uses it
    // to decide which intents an external agent may see. So the REST door for
    // an operation could require `tenant_pii_write` while the Pax door for the
    // SAME operation required nothing at all, and a `member` — who does not
    // hold that scope — could reach it by typing a sentence.
    //
    // Two rules, and the asymmetry is the point:
    //
    //  1. An IDENTIFIED caller is held to the declared scope. `ai/executive.ts`
    //     (the Pax chat + streaming loops) passes `userId` on all four of its
    //     call sites, so this covers the customer-facing surface.
    //  2. An UNIDENTIFIED caller — vaService's org-level agent loop, the
    //     registry's own `handler(args, org)`, the approved-send replay — is
    //     allowed to act as the org for ordinary scopes, because there is no
    //     user to hold one and refusing would break automation that has always
    //     run this way. It is REFUSED for the PII scopes, where "the org did
    //     it" is not an answer anyone can give a regulator.
    //
    // `trustedApproval` does NOT bypass this. A human tapping "Send" on a
    // frozen action is a witnessed send; it is not evidence that the human
    // holds `tenant_pii_write`.
    {
      const declaredScope = scopeForIntent(toolName);
      if (declaredScope) {
        const callerId = options?.userId ?? null;
        const piiScope = PII_SCOPES.has(declaredScope);
        if (callerId || piiScope) {
          const permitted = await userHasScope(
            { id: org.id, ownerId: org.ownerId ?? null },
            callerId,
            declaredScope,
          );
          if (!permitted) {
            logger.warn("[executeTool] Refused — caller lacks the intent's declared scope", {
              orgId: org.id,
              metadata: { toolName, declaredScope, identified: Boolean(callerId) },
            });
            return {
              success: false,
              error:
                `You do not have permission to do that here. "${toolName}" requires ` +
                `the "${declaredScope}" permission in this workspace. An owner or ` +
                `admin can grant it under Settings → Team.`,
            };
          }
        }
      }
    }

    // ── FCRA permissible-purpose gate (2026-08-19) ────────────────────────
    // Skip-trace is FCRA-adjacent under §1681b(a)(3)(F). Its REST door
    // (`POST /api/skip-traces`) requires the operator to claim a purpose from a
    // closed enum, write a justification of at least ten characters, and hold a
    // current annual attestation — and it persists all three on a `skip_traces`
    // row whose stated reason for existing is "class-action defense audit
    // trail". The Pax door required none of it.
    //
    // This refuses rather than collecting the three from the model, and that is
    // deliberate. The purpose is enum-constrained and the attestation is a
    // stored human act, so both could be checked — but the JUSTIFICATION would
    // be a sentence the MODEL wrote, persisted as the operator's stated reason
    // in a legal record. "Fabrication is never acceptable" (CLAUDE.md) is at its
    // sharpest there: an audit trail exists to show that a person claimed a
    // purpose, and a model claiming one on their behalf is the exact thing it
    // is supposed to disprove.
    //
    // If skip-trace through Pax is wanted, it needs a purpose-capture step the
    // HUMAN completes — the pending-action approval flow is the natural place —
    // not a wider tool schema.
    if (FCRA_REFUSED_TOOLS.has(toolName)) {
      logger.info("[executeTool] Refused FCRA-gated tool on the Pax path", {
        orgId: org.id,
        metadata: { toolName },
      });
      return {
        success: false,
        error:
          "I can't run a skip trace from chat. Skip-tracing is regulated under " +
          "the FCRA: it needs a permissible purpose, a written justification, " +
          "and a current annual attestation from the person requesting it — and " +
          "those have to come from you, not from me. Run it from the lead's page " +
          "(Deals → the lead → Skip trace), which records all three.",
      };
    }

    // ── Dispatch, then the receipt (spec §4.7) ─────────────────────────────
    // The switch runs inside a closure so ONE post-dispatch hook sees every
    // case's result. A case that writes its own receipt (with a real
    // before → after) sets `receiptWritten`; the hook writes the generic one
    // only when the case did not, only on success, and never on the
    // human-approved replay — the executor writes the witnessed receipt for
    // that path (one tap, one row).
    let receiptWritten = false;
    const outcome: ToolResult = await (async (): Promise<ToolResult> => {
    switch (toolName) {
      case "get_leads": {
        const leads = await storage.getLeads(org.id);
        let filtered = leads;
        if (args.status) {
          filtered = leads.filter(l => l.status === args.status);
        }
        if (args.type) {
          filtered = filtered.filter(l => l.type === args.type);
        }
        if (args.limit) {
          filtered = filtered.slice(0, args.limit);
        }
        return { success: true, data: filtered.map(l => ({
          id: l.id,
          name: `${l.firstName} ${l.lastName}`,
          firstName: l.firstName,
          lastName: l.lastName,
          email: l.email,
          phone: l.phone,
          status: l.status,
          type: l.type,
          source: l.source,
          notes: l.notes
        })) };
      }
      
      case "get_lead_details": {
        const lead = await storage.getLead(org.id, args.lead_id);
        if (!lead) return { success: false, error: "Lead not found" };
        return { success: true, data: {
          ...lead,
          name: `${lead.firstName} ${lead.lastName}`
        }};
      }
      
      case "update_lead_status": {
        const leadBeforeUpdate = await storage.getLead(org.id, args.lead_id);
        const updated = await storage.updateLead(args.lead_id, {
          status: args.status,
          notes: args.notes
        }, org.id);
        // Wave B — emits lead.status_changed ONLY when the status actually
        // moved (Pax re-asserting the current status changes nothing and
        // must not wake automations). `notes` alone yields lead.updated.
        emitLeadUpdated(
          org.id,
          leadBeforeUpdate,
          updated,
          args.notes !== undefined ? ["status", "notes"] : ["status"],
        );
        // The receipt, with the real before → after (spec §4.7). On the
        // human-approved replay the executor writes the witnessed receipt
        // instead — one tap, one row.
        if (leadBeforeUpdate && !trustedApproval) {
          await recordPaxEffect({
            orgId: org.id,
            actor: "pax",
            origin,
            stance: controls?.stance ?? null,
            tool: "update_lead_status",
            action: "status_changed",
            entityType: "lead",
            entityId: args.lead_id,
            description: `Status changed to "${args.status}"${args.notes ? `: ${args.notes}` : ""}`,
            before: { status: leadBeforeUpdate.status },
            after: { status: args.status },
            witnessed: false,
            userId: options?.userId ?? null,
          });
          receiptWritten = true;
        }
        invalidateContextCache(org.id);
        return { success: true, data: { message: `Lead status updated to ${args.status}`, lead: updated, before: { status: leadBeforeUpdate?.status }, after: { status: args.status } } };
      }

      case "create_lead": {
        const lead = await storage.createLead({
          organizationId: org.id,
          firstName: args.first_name,
          lastName: args.last_name,
          email: args.email || null,
          phone: args.phone || null,
          type: args.type || "buyer",
          source: args.source || "AI Assistant",
          notes: args.notes || null,
          status: "new"
        });
        emitLeadCreated(org.id, lead);
        return { success: true, data: { message: "Lead created successfully", lead } };
      }
      
      case "get_properties": {
        const properties = await storage.getProperties(org.id);
        let filtered = properties;
        if (args.status) {
          filtered = properties.filter(p => p.status === args.status);
        }
        if (args.limit) {
          filtered = filtered.slice(0, args.limit);
        }
        return { success: true, data: filtered.map(p => ({
          id: p.id,
          apn: p.apn,
          address: p.address,
          county: p.county,
          state: p.state,
          sizeAcres: p.sizeAcres,
          listPrice: p.listPrice,
          marketValue: p.marketValue,
          status: p.status
        })) };
      }
      
      case "get_property_details": {
        const property = await storage.getProperty(org.id, args.property_id);
        if (!property) return { success: false, error: "Property not found" };
        return { success: true, data: property };
      }
      
      case "get_notes": {
        const notes = await storage.getNotes(org.id);
        let filtered = notes;
        if (args.status) {
          filtered = notes.filter(n => n.status === args.status);
        }
        return { success: true, data: filtered.map(n => ({
          id: n.id,
          propertyId: n.propertyId,
          borrowerId: n.borrowerId,
          originalPrincipal: n.originalPrincipal,
          currentBalance: n.currentBalance,
          interestRate: n.interestRate,
          monthlyPayment: n.monthlyPayment,
          termMonths: n.termMonths,
          status: n.status,
          startDate: n.startDate,
          nextPaymentDate: n.nextPaymentDate
        })) };
      }
      
      case "calculate_amortization": {
        const { principal, annual_rate, term_months, down_payment = 0 } = args;
        const loanAmount = principal - down_payment;
        const monthlyRate = annual_rate / 100 / 12;

        let amortData: Record<string, number>;
        if (monthlyRate === 0) {
          const payment = loanAmount / term_months;
          amortData = {
            loanAmount,
            monthlyPayment: Math.round(payment * 100) / 100,
            totalPayments: Math.round(loanAmount * 100) / 100,
            totalInterest: 0,
            effectiveRate: 0,
            termMonths: term_months
          };
        } else {
          const payment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, term_months))
                         / (Math.pow(1 + monthlyRate, term_months) - 1);
          const totalPayments = payment * term_months;
          const totalInterest = totalPayments - loanAmount;
          amortData = {
            loanAmount,
            monthlyPayment: Math.round(payment * 100) / 100,
            totalPayments: Math.round(totalPayments * 100) / 100,
            totalInterest: Math.round(totalInterest * 100) / 100,
            effectiveRate: annual_rate,
            termMonths: term_months
          };
        }

        const amortValidation = validateAtlasOutput(AtlasOutputType.AMORTIZATION_SCHEDULE, {
          loanAmount: amortData.loanAmount,
          interestRate: amortData.effectiveRate,
          termMonths: amortData.termMonths,
          monthlyPayment: amortData.monthlyPayment,
        });
        if (!amortValidation.valid) {
          logger.warn("[calculate_amortization] Validation failed", { metadata: { errors: amortValidation.errors } });
          return { success: false, error: `Amortization calculation failed validation: ${amortValidation.errors.join("; ")}` };
        }
        if (amortValidation.warnings.length > 0) {
          logger.warn("[calculate_amortization] Validation warnings", { metadata: { warnings: amortValidation.warnings } });
        }

        return { success: true, data: amortData };
      }
      
      case "get_cashflow_summary": {
        const notes = await storage.getNotes(org.id);
        const activeNotes = notes.filter(n => n.status === "active");
        const monthlyCashflow = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
        const totalBalance = activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);
        const cashflowData = {
          activeNotesCount: activeNotes.length,
          totalOutstandingBalance: Math.round(totalBalance * 100) / 100,
          monthlyCashflow: Math.round(monthlyCashflow * 100) / 100,
          annualCashflow: Math.round(monthlyCashflow * 12 * 100) / 100
        };

        const cfValidation = validateAtlasOutput(AtlasOutputType.CASH_FLOW, {
          monthlyIncome: cashflowData.monthlyCashflow,
          monthlyExpenses: 0,
          netMonthly: cashflowData.monthlyCashflow,
          annualNOI: cashflowData.annualCashflow,
        });
        if (!cfValidation.valid) {
          logger.warn("[get_cashflow_summary] Validation failed", { metadata: { errors: cfValidation.errors } });
          return { success: false, error: `Cash flow summary failed validation: ${cfValidation.errors.join("; ")}` };
        }
        if (cfValidation.warnings.length > 0) {
          logger.warn("[get_cashflow_summary] Validation warnings", { metadata: { warnings: cfValidation.warnings } });
        }

        return { success: true, data: cashflowData };
      }
      
      case "get_dashboard_stats": {
        const stats = await storage.getDashboardStats(org.id);
        return { success: true, data: stats };
      }
      
      case "get_pipeline_summary": {
        const leads = await storage.getLeads(org.id);
        const summary = leads.reduce((acc, lead) => {
          acc[lead.status] = (acc[lead.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const byType = leads.reduce((acc, lead) => {
          acc[lead.type] = (acc[lead.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        return { success: true, data: { totalLeads: leads.length, byStatus: summary, byType } };
      }

      // System Context
      case "get_system_context": {
        const context = await getSystemContext(org.id);
        const formatted = formatContextForAI(context);
        return { success: true, data: { summary: formatted, raw: context } };
      }

      // Property CRUD
      case "create_property": {
        const property = await storage.createProperty({
          organizationId: org.id,
          apn: args.apn,
          address: args.address || null,
          city: args.city || null,
          county: args.county,
          state: args.state,
          zip: args.zip || null,
          sizeAcres: String(args.sizeAcres),
          listPrice: args.listPrice ? String(args.listPrice) : null,
          marketValue: args.marketValue ? String(args.marketValue) : null,
          status: args.status || "prospect",
          description: args.notes || null,
        });
        
        // Auto-fetch parcel boundary data
        let hasBoundary = false;
        if (args.county && args.state) {
          try {
            const stateCountyPath = `/us/${args.state.toLowerCase()}/${args.county.toLowerCase().replace(/\s+/g, "-")}`;
            logger.info(`[CreateProperty] Fetching parcel for ${args.apn} at ${stateCountyPath}`);
            const parcelResult = await lookupParcelByAPN(args.apn, stateCountyPath, org.id);
            
            if (parcelResult.found && parcelResult.parcel) {
              await storage.updateProperty(property.id, {
                parcelBoundary: parcelResult.parcel.boundary,
                parcelCentroid: parcelResult.parcel.centroid,
                parcelData: parcelResult.parcel.data,
                latitude: String(parcelResult.parcel.centroid.lat),
                longitude: String(parcelResult.parcel.centroid.lng),
              }, org.id);
              hasBoundary = true;
              logger.info(`[CreateProperty] Parcel found from ${parcelResult.source}`);
            }
          } catch (parcelErr: any) {
            logger.error(`[CreateProperty] Parcel lookup error`, undefined, { metadata: { detail: parcelErr.message } });
          }
        }
        
        // Wave B — property.created. Fire-and-forget; never fails the tool.
        emitPropertyCreated(org.id, property);

        invalidateContextCache(org.id);
        return { success: true, data: { message: `Property created successfully${hasBoundary ? ' with parcel boundary' : ''}`, property, hasBoundary } };
      }

      case "update_property": {
        const updates: Record<string, any> = {};
        if (args.status) updates.status = args.status;
        if (args.listPrice !== undefined) updates.listPrice = String(args.listPrice);
        if (args.marketValue !== undefined) updates.marketValue = String(args.marketValue);
        if (args.notes) updates.notes = args.notes;

        const propertyBeforeUpdate = await storage.getProperty(org.id, args.property_id);
        const before: Record<string, any> = {};
        const after: Record<string, any> = {};
        for (const key of Object.keys(updates)) {
          before[key] = (propertyBeforeUpdate as any)?.[key];
          after[key] = updates[key];
        }

        const property = await storage.updateProperty(args.property_id, updates, org.id);

        // Wave B — property.status_changed. `propertyBeforeUpdate` is the real
        // pre-image; when the tool didn't move `status` this emits nothing.
        emitPropertyStatusChanged(org.id, propertyBeforeUpdate, property);

        invalidateContextCache(org.id);
        return { success: true, data: { message: "Property updated successfully", property, before, after } };
      }

      // Deal CRUD
      case "get_deals": {
        const deals = await storage.getDeals(org.id);
        let filtered = deals;
        if (args.type) filtered = filtered.filter(d => d.type === args.type);
        if (args.status) filtered = filtered.filter(d => d.status === args.status);
        if (args.limit) filtered = filtered.slice(0, args.limit);
        return { success: true, data: filtered.map(d => ({
          id: d.id,
          type: d.type,
          status: d.status,
          offerAmount: d.offerAmount,
          propertyId: d.propertyId,
        })) };
      }

      case "create_deal": {
        const deal = await storage.createDeal({
          organizationId: org.id,
          type: args.type,
          propertyId: args.propertyId,
          offerAmount: args.offerAmount ? String(args.offerAmount) : null,
          status: args.status || "negotiating",
          notes: args.notes || null,
        });
        // Wave B — deal.created. Fire-and-forget; never fails the tool.
        emitDealCreated(org.id, deal);

        invalidateContextCache(org.id);
        return { success: true, data: { message: "Deal created successfully", deal } };
      }

      case "update_deal": {
        const dealUpdates: Record<string, any> = {};
        if (args.status) dealUpdates.status = args.status;
        if (args.offerAmount !== undefined) dealUpdates.offerAmount = String(args.offerAmount);
        if (args.notes) dealUpdates.notes = args.notes;

        const dealsForOrg = await storage.getDeals(org.id);
        const dealBeforeUpdate = dealsForOrg.find((d) => d.id === args.deal_id);
        const dealBefore: Record<string, any> = {};
        const dealAfter: Record<string, any> = {};
        for (const key of Object.keys(dealUpdates)) {
          dealBefore[key] = (dealBeforeUpdate as any)?.[key];
          dealAfter[key] = dealUpdates[key];
        }

        const deal = await storage.updateDeal(args.deal_id, dealUpdates, undefined, org.id);

        // Wave B — deal.stage_changed. `dealBeforeUpdate` is the real
        // pre-image; when the tool didn't move `status` this emits nothing.
        emitDealStageChanged(org.id, dealBeforeUpdate, deal);

        invalidateContextCache(org.id);
        return { success: true, data: { message: "Deal updated successfully", deal, before: dealBefore, after: dealAfter } };
      }

      // Task CRUD
      case "get_tasks": {
        const tasks = await storage.getTasks(org.id);
        let filtered = tasks;
        if (args.status) filtered = filtered.filter(t => t.status === args.status);
        if (args.priority) filtered = filtered.filter(t => t.priority === args.priority);
        if (args.limit) filtered = filtered.slice(0, args.limit);
        return { success: true, data: filtered.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
        })) };
      }

      case "create_task": {
        const task = await storage.createTask({
          organizationId: org.id,
          title: args.title,
          description: args.description || null,
          priority: args.priority || "medium",
          status: "pending",
          dueDate: args.dueDate ? new Date(args.dueDate) : null,
          entityType: args.entityType || "none",
          entityId: args.entityId || null,
          createdBy: "ai-assistant",
        });
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Task created successfully", task } };
      }

      case "update_task": {
        // Org precheck (audit F-23-3): task_id is model/user-supplied and task
        // ids are sequential — without this, Pax could read+mutate any org's
        // task. Every sibling tool (update_lead_status, update_property) does
        // this; these two were missing it. getTask is org-scoped.
        const existingTask = await storage.getTask(org.id, args.task_id);
        if (!existingTask) {
          return { success: false, error: `Task ${args.task_id} not found` };
        }
        const taskUpdates: Record<string, any> = {};
        if (args.status) taskUpdates.status = args.status;
        if (args.priority) taskUpdates.priority = args.priority;
        if (args.dueDate) taskUpdates.dueDate = new Date(args.dueDate);

        const task = await storage.updateTask(args.task_id, taskUpdates, org.id);
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Task updated successfully", task } };
      }

      case "complete_task": {
        // Org precheck (audit F-23-3) — see update_task.
        const existingTask = await storage.getTask(org.id, args.task_id);
        if (!existingTask) {
          return { success: false, error: `Task ${args.task_id} not found` };
        }
        const task = await storage.updateTask(args.task_id, { status: "completed" }, org.id);
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Task marked as completed", task } };
      }

      case "extract_properties_from_text": {
        const text = args.document_text || "";
        const expectedCount = args.expected_count;
        
        const properties: Array<{
          apn: string;
          county?: string;
          state?: string;
          address?: string;
          city?: string;
          sizeAcres?: string;
          notes?: string;
        }> = [];

        const apnPatterns = [
          /(?:APN|Parcel|Parcel\s*#|Parcel\s*ID|Parcel\s*Number)[:\s]*([A-Z0-9\-\.]+)/gi,
          /\b(\d{3}[\-\.]\d{3}[\-\.]\d{3}[\-\.]\d{3})\b/g,
          /\b(\d{2,3}[\-\.]\d{2,4}[\-\.]\d{2,4}(?:[\-\.]\d{2,4})?)\b/g,
        ];

        const foundApns = new Set<string>();
        for (const pattern of apnPatterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            const apn = (match[1] || match[0]).trim().toUpperCase();
            if (apn.length >= 6 && !foundApns.has(apn)) {
              foundApns.add(apn);
            }
          }
        }

        const countyMatch = text.match(/(?:County|COUNTY)[:\s]*([A-Za-z\s]+?)(?:\n|,|State|STATE)/i);
        const stateMatch = text.match(/(?:State|STATE)[:\s]*([A-Z]{2})/i);
        const defaultCounty = countyMatch ? countyMatch[1].trim() : "Unknown";
        const defaultState = stateMatch ? stateMatch[1].trim() : "Unknown";

        for (const apn of Array.from(foundApns)) {
          const lines = text.split('\n');
          let propertyInfo: any = { apn, county: defaultCounty, state: defaultState };
          
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(apn)) {
              const context = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
              
              const acresMatch = context.match(/(\d+\.?\d*)\s*(?:acres?|ac\.?)/i);
              if (acresMatch) propertyInfo.sizeAcres = acresMatch[1];
              
              const addressMatch = context.match(/\d+\s+[A-Za-z]+\s+(?:St|Ave|Rd|Dr|Ln|Blvd|Way|Ct)[\.,$\s]/i);
              if (addressMatch) propertyInfo.address = addressMatch[0].trim();
              
              break;
            }
          }
          
          properties.push(propertyInfo);
        }

        const message = properties.length > 0 
          ? `Extracted ${properties.length} properties from document${expectedCount && properties.length !== expectedCount ? ` (expected ${expectedCount})` : ''}`
          : "No property APNs found in the document. Please provide the text containing APNs in a recognizable format.";

        return { 
          success: properties.length > 0, 
          data: { 
            message,
            extractedCount: properties.length,
            expectedCount,
            properties,
            hint: properties.length === 0 ? "Look for APNs (Assessor's Parcel Numbers) in formats like 123-456-789 or 12.34.56.78" : undefined
          } 
        };
      }

      case "create_properties_batch": {
        const propertiesToCreate = args.properties || [];
        if (!Array.isArray(propertiesToCreate) || propertiesToCreate.length === 0) {
          return { success: false, error: "No properties provided to create" };
        }

        const results: Array<{ success: boolean; apn: string; propertyId?: number; hasBoundary?: boolean; error?: string }> = [];
        
        for (const prop of propertiesToCreate) {
          try {
            if (!prop.apn || !prop.county || !prop.state) {
              results.push({ success: false, apn: prop.apn || "unknown", error: "Missing required fields (apn, county, state)" });
              continue;
            }

            const property = await storage.createProperty({
              organizationId: org.id,
              apn: prop.apn,
              county: prop.county,
              state: prop.state,
              address: prop.address || null,
              city: prop.city || null,
              zip: prop.zip || null,
              sizeAcres: prop.sizeAcres || "0",
              status: prop.status || "prospect",
            });

            // Wave B — property.created, once per row that really landed.
            emitPropertyCreated(org.id, property);

            // Auto-fetch parcel boundary data after creation (only if state/county provided)
            let hasBoundary = false;
            if (prop.state && prop.county) {
              try {
                const stateCountyPath = `/us/${prop.state.toLowerCase()}/${prop.county.toLowerCase().replace(/\s+/g, "-")}`;
                logger.info(`[Batch] Fetching parcel for ${prop.apn} at ${stateCountyPath}`);
                const parcelResult = await lookupParcelByAPN(prop.apn, stateCountyPath, org.id);
                
                if (parcelResult.found && parcelResult.parcel) {
                  await storage.updateProperty(property.id, {
                    parcelBoundary: parcelResult.parcel.boundary,
                    parcelCentroid: parcelResult.parcel.centroid,
                    parcelData: parcelResult.parcel.data,
                    latitude: String(parcelResult.parcel.centroid.lat),
                    longitude: String(parcelResult.parcel.centroid.lng),
                  }, org.id);
                  hasBoundary = true;
                  logger.info(`[Batch] Parcel found for ${prop.apn} from ${parcelResult.source}`);
                } else {
                  logger.info(`[Batch] No parcel found for ${prop.apn}: ${parcelResult.error || 'not found'}`);
                }
              } catch (parcelErr: any) {
                logger.error(`[Batch] Parcel lookup error for ${prop.apn}`, undefined, { metadata: { detail: parcelErr.message } });
              }
            } else {
              logger.info(`[Batch] Skipping parcel lookup for ${prop.apn} - missing state/county`);
            }
            
            results.push({ success: true, apn: prop.apn, propertyId: property.id, hasBoundary });
          } catch (err: any) {
            results.push({ success: false, apn: prop.apn, error: err.message });
          }
        }

        invalidateContextCache(org.id);
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        const boundaryCount = results.filter(r => r.hasBoundary).length;
        
        return { 
          success: successCount > 0, 
          data: { 
            message: `Created ${successCount} properties${failCount > 0 ? `, ${failCount} failed` : ''}. Parcel boundaries found for ${boundaryCount}/${successCount}.`,
            results,
            successCount,
            failCount,
            boundaryCount
          } 
        };
      }

      case "generate_offer": {
        const property = await storage.getProperty(org.id, args.property_id);
        if (!property) return { success: false, error: "Property not found" };
        if (!property.county || !property.state) {
          return { success: false, error: "Property is missing county or state information required for offer analysis" };
        }

        const sizeAcres = Number(property.sizeAcres);
        if (isNaN(sizeAcres) || sizeAcres <= 0) {
          return { success: false, error: "Property is missing valid acreage information required for offer analysis" };
        }

        const propertyData = {
          id: property.id,
          apn: property.apn || undefined,
          address: property.address || undefined,
          county: property.county,
          state: property.state,
          sizeAcres,
          latitude: property.latitude ? Number(property.latitude) : undefined,
          longitude: property.longitude ? Number(property.longitude) : undefined,
          zoning: property.zoning || undefined,
          terrain: property.terrain || undefined,
          roadAccess: property.roadAccess || undefined,
          assessedValue: property.assessedValue ? Number(property.assessedValue) : undefined,
          marketValue: property.marketValue ? Number(property.marketValue) : undefined,
        };

        const result = await generateOfferSuggestions(propertyData, { organizationId: org.id });
        if (result.success && result.suggestions) {
          for (const suggestion of result.suggestions) {
            const offerValidation = validateAtlasOutput(AtlasOutputType.OFFER_AMOUNT, {
              amount: suggestion.offerAmount,
              confidence: (suggestion.confidence || 0) / 100, // normalize 0-100 to 0-1
              rationale: suggestion.reasoning,
            });
            if (!offerValidation.valid) {
              logger.warn("[generate_offer] Offer suggestion failed validation", {
                metadata: { strategy: suggestion.strategyName, errors: offerValidation.errors },
              });
              return { success: false, error: `Offer suggestion "${suggestion.strategyName}" failed validation: ${offerValidation.errors.join("; ")}` };
            }
          }
        }
        return {
          success: result.success,
          data: result.success ? result : undefined,
          error: result.error
        };
      }

      case "generate_offer_letter": {
        const property = await storage.getProperty(org.id, args.property_id);
        if (!property) return { success: false, error: "Property not found" };

        const propertyData = {
          id: property.id,
          apn: property.apn || undefined,
          address: property.address || undefined,
          county: property.county,
          state: property.state,
          sizeAcres: Number(property.sizeAcres) || 0,
          latitude: property.latitude ? Number(property.latitude) : undefined,
          longitude: property.longitude ? Number(property.longitude) : undefined,
        };

        const result = await generateOfferLetter({
          property: propertyData,
          offerAmount: args.offer_amount,
          buyerName: args.buyer_name,
          buyerCompany: args.buyer_company,
          buyerEmail: args.buyer_email,
          buyerPhone: args.buyer_phone,
          tone: args.tone || "professional",
          sellerName: args.seller_name,
          terms: {
            earnestMoney: args.earnest_money,
            closingDays: args.closing_days,
          },
        });

        // S2b — an offer that goes out must exist in the pipeline. Previously
        // the letter was generated and the Deals board never learned about it
        // (offer→deal was a manual re-entry). Upsert: reuse the property's
        // open deal if one exists, else create one in offer_sent. Non-blocking
        // — pipeline bookkeeping must never fail the letter itself.
        let pipelineDealId: number | null = null;
        if (result.success) {
          try {
            const { db: dbInstance } = await import("../db");
            const { deals: dealsTable } = await import("@shared/schema");
            const { and: andOp, eq: eqOp, sql: sqlTag } = await import("drizzle-orm");
            const [openDeal] = await dbInstance
              .select({ id: dealsTable.id })
              .from(dealsTable)
              .where(andOp(
                eqOp(dealsTable.organizationId, org.id),
                eqOp(dealsTable.propertyId, property.id),
                sqlTag`${dealsTable.status} NOT IN ('closed', 'cancelled', 'deleted', 'dead')`,
              ))
              .limit(1);
            if (openDeal) {
              pipelineDealId = openDeal.id;
            } else {
              const newDeal = await storage.createDeal({
                organizationId: org.id,
                propertyId: property.id,
                type: "acquisition",
                status: "offer_sent",
                offerAmount: String(args.offer_amount),
                notes: `Auto-created from generated offer letter (${args.buyer_name}, $${args.offer_amount}).`,
              } as any);
              pipelineDealId = newDeal.id;

              // Wave B — the offer→deal bridge is a real deal-creation path
              // (it is how an offer letter lands on the Deals board), so it
              // fires deal.created exactly like the manual route does.
              emitDealCreated(org.id, newDeal);

              invalidateContextCache(org.id);
            }
          } catch (dealErr) {
            logger.warn("[generate_offer_letter] pipeline deal upsert failed (non-fatal)", {
              metadata: { propertyId: property.id, error: dealErr instanceof Error ? dealErr.message : String(dealErr) },
            });
          }
        }

        return { 
          success: result.success, 
          data: result.success ? { letter: result.letter, subject: result.subject, dealId: pipelineDealId } : undefined,
          error: result.error 
        };
      }

      case "send_email": {
        let toEmail: string | undefined;
        let leadForCompliance: { tcpaConsent: boolean | null; doNotContact: boolean | null } | null = null;

        if (args.lead_id) {
          const lead = await storage.getLead(org.id, args.lead_id);
          if (!lead) return { success: false, error: "Lead not found" };
          if (!lead.email) return { success: false, error: "Lead does not have an email address" };
          toEmail = lead.email;
          leadForCompliance = { tcpaConsent: lead.tcpaConsent, doNotContact: lead.doNotContact };
        } else if (args.email) {
          toEmail = args.email;
        } else {
          return { success: false, error: "Either lead_id or email is required" };
        }

        if (leadForCompliance) {
          const compliance = checkTcpaConsentFromLead(leadForCompliance);
          if (!compliance.canEmail) {
            return { success: false, error: `Cannot send email: ${compliance.reason}` };
          }
        }

        const isConfigured = await emailService.isConfigured(org.id);
        if (!isConfigured) {
          return { success: false, error: "Email service not configured. Please set up AWS SES credentials in Settings." };
        }

        const htmlContent = args.message;
        const textContent = htmlContent.replace(/<[^>]*>/g, '').trim();

        // ── Guarded send — reached ONLY after a human tap ─────────────────────
        // send_email is in APPROVAL_REQUIRED_TOOLS, so the kernel gate at the
        // top of executeTool froze every unapproved call as an ask before the
        // switch ran; this case executes exactly the frozen row with
        // { trustedApproval: true }. (The per-tool "autonomy level" branch
        // that used to sit here was unreachable and is gone — 2026-09-02.)
        // Honor the daily envelope, TCPA, and the send audit trail.
        const rateCheck = await checkSendRateLimit(org.id, "email");
        if (!rateCheck.allowed) {
          return { success: false, error: rateCheck.reason ?? "Daily send envelope reached" };
        }

        if (args.lead_id) {
          // 2026-06-10 (T0-5): org-scoped — a bare lead id can no longer
          // resolve against another org's consent record.
          const tcpaCheck = await checkTcpaBeforeSend(org.id, args.lead_id);
          if (!tcpaCheck.allowed) {
            return { success: false, error: `Cannot send email: ${tcpaCheck.reason}` };
          }
        }

        const result = await emailService.sendEmail({
          to: toEmail!,
          subject: args.subject,
          html: htmlContent,
          text: textContent,
          organizationId: org.id,
          // Deal mail: Pax emailing a customer's lead — org identity required.
          purpose: 'counterparty',
        });

        // Record the send into the audit envelope so the rate limiter and the
        // daily Pax briefing reflect it. Non-blocking on its own internally.
        if (result.success) {
          await recordAutonomousSend(
            org.id,
            "email",
            args.lead_id ?? 0,
            `${args.subject} — ${textContent}`,
          );
        }

        return {
          success: result.success,
          data: result.success ? { messageId: result.messageId, message: "Email sent successfully" } : undefined,
          error: result.error 
        };
      }

      case "send_sms": {
        let toPhone: string | undefined;
        let leadForCompliance: { tcpaConsent: boolean | null; doNotContact: boolean | null } | null = null;

        if (args.lead_id) {
          const lead = await storage.getLead(org.id, args.lead_id);
          if (!lead) return { success: false, error: "Lead not found" };
          if (!lead.phone) return { success: false, error: "Lead does not have a phone number" };
          toPhone = lead.phone;
          leadForCompliance = { tcpaConsent: lead.tcpaConsent, doNotContact: lead.doNotContact };
          // Lead-aware quiet hours (uses lead.timezone when present).
          const qh = isWithinQuietHoursForLead(lead as any);
          if (qh.blocked) {
            return { success: false, error: `TCPA quiet hours: ${qh.reason}` };
          }
        } else if (args.phone_number) {
          toPhone = args.phone_number;
          // Phone-only path — area-code quiet-hours fallback.
          const qh = isWithinQuietHours(args.phone_number);
          if (qh.blocked) {
            return { success: false, error: `TCPA quiet hours: ${qh.reason}` };
          }
        } else {
          return { success: false, error: "Either lead_id or phone_number is required" };
        }

        if (leadForCompliance) {
          const compliance = checkTcpaConsentFromLead(leadForCompliance);
          if (!compliance.canSms) {
            return { success: false, error: `Cannot send SMS: ${compliance.reason}` };
          }
        }

        if (!toPhone) {
          return { success: false, error: "Phone number not available" };
        }

        // ── Guarded send — reached ONLY after a human tap ─────────────────────
        // Same as send_email: the kernel gate froze the unapproved call as an
        // ask; this case runs the frozen row after the tap, honouring the
        // daily envelope + TCPA + the send audit trail.
        const smsRateCheck = await checkSendRateLimit(org.id, "sms");
        if (!smsRateCheck.allowed) {
          return { success: false, error: smsRateCheck.reason ?? "Daily send envelope reached" };
        }

        if (args.lead_id) {
          // 2026-06-10 (T0-5): org-scoped TCPA lookup, same as send_email.
          const tcpaCheck = await checkTcpaBeforeSend(org.id, args.lead_id);
          if (!tcpaCheck.allowed) {
            return { success: false, error: `Cannot send SMS: ${tcpaCheck.reason}` };
          }
        }

        const result = await sendOrgSMS(org.id, toPhone, args.message);

        // Record into the audit envelope so the rate limiter and the daily
        // Pax briefing reflect it (same discipline as send_email).
        if (result.success) {
          await recordAutonomousSend(org.id, "sms", args.lead_id ?? 0, args.message ?? "");
        }

        return {
          success: result.success,
          data: result.success ? { messageId: result.messageId, message: "SMS sent successfully" } : undefined,
          error: result.error
        };
      }

      case "run_comps_analysis": {
        const property = await storage.getProperty(org.id, args.property_id);
        if (!property) return { success: false, error: "Property not found" };
        if (!property.latitude || !property.longitude) {
          return { success: false, error: "Property does not have coordinates for comps analysis" };
        }

        const radiusMiles = args.radius_miles || 5;
        const maxResults = args.max_results || 10;

        const result = await getComparableProperties(
          Number(property.latitude),
          Number(property.longitude),
          radiusMiles,
          {
            minAcreage: Number(property.sizeAcres) * 0.5,
            maxAcreage: Number(property.sizeAcres) * 2,
            maxResults,
          },
          org.id
        );

        return { 
          success: result.success, 
          data: result.success ? {
            comparables: result.comps,
            marketAnalysis: result.marketAnalysis,
            count: result.comps.length,
          } : undefined,
          error: result.error 
        };
      }

      case "calculate_roi": {
        const { purchase_price, estimated_sale_price, holding_costs = 0, improvement_costs = 0, holding_months = 6 } = args;

        const totalInvestment = purchase_price + improvement_costs + (holding_costs * holding_months);
        const profit = estimated_sale_price - totalInvestment;
        const roi = (profit / totalInvestment) * 100;
        const annualizedRoi = (roi / holding_months) * 12;
        const cashOnCash = (profit / purchase_price) * 100;

        const roiData = {
          purchasePrice: purchase_price,
          estimatedSalePrice: estimated_sale_price,
          totalInvestment: Math.round(totalInvestment * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          roiPercent: Math.round(roi * 100) / 100,
          annualizedRoiPercent: Math.round(annualizedRoi * 100) / 100,
          cashOnCashPercent: Math.round(cashOnCash * 100) / 100,
          holdingMonths: holding_months,
          holdingCostsTotal: holding_costs * holding_months,
          improvementCosts: improvement_costs,
        };

        const roiValidation = validateAtlasOutput(AtlasOutputType.ROI_ANALYSIS, {
          purchasePrice: roiData.purchasePrice,
          salePrice: roiData.estimatedSalePrice,
          holdingCosts: roiData.holdingCostsTotal + roiData.improvementCosts,
          grossProfit: roiData.estimatedSalePrice - roiData.purchasePrice,
          netProfit: roiData.profit,
          roiPercent: roiData.roiPercent,
          annualizedRoi: roiData.annualizedRoiPercent,
        });
        if (!roiValidation.valid) {
          logger.warn("[calculate_roi] Validation failed", { metadata: { errors: roiValidation.errors } });
          return { success: false, error: `ROI calculation failed validation: ${roiValidation.errors.join("; ")}` };
        }
        if (roiValidation.warnings.length > 0) {
          logger.warn("[calculate_roi] Validation warnings", { metadata: { warnings: roiValidation.warnings } });
        }

        return { success: true, data: roiData };
      }

      case "calculate_payment_schedule": {
        const { principal, interest_rate, term_months, down_payment = 0 } = args;
        const loanAmount = principal - down_payment;
        const monthlyRate = interest_rate / 100 / 12;
        
        let monthlyPayment: number;
        let totalInterest: number;
        
        if (monthlyRate === 0) {
          monthlyPayment = loanAmount / term_months;
          totalInterest = 0;
        } else {
          monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, term_months)) 
                         / (Math.pow(1 + monthlyRate, term_months) - 1);
          totalInterest = (monthlyPayment * term_months) - loanAmount;
        }

        const schedule: Array<{ month: number; payment: number; principal: number; interest: number; balance: number }> = [];
        let balance = loanAmount;
        
        for (let month = 1; month <= Math.min(term_months, 12); month++) {
          const interestPayment = balance * monthlyRate;
          const principalPayment = monthlyPayment - interestPayment;
          balance -= principalPayment;
          schedule.push({
            month,
            payment: Math.round(monthlyPayment * 100) / 100,
            principal: Math.round(principalPayment * 100) / 100,
            interest: Math.round(interestPayment * 100) / 100,
            balance: Math.round(Math.max(0, balance) * 100) / 100,
          });
        }

        const scheduleData = {
          loanAmount: Math.round(loanAmount * 100) / 100,
          downPayment: down_payment,
          monthlyPayment: Math.round(monthlyPayment * 100) / 100,
          totalPayments: Math.round(monthlyPayment * term_months * 100) / 100,
          totalInterest: Math.round(totalInterest * 100) / 100,
          interestRate: interest_rate,
          termMonths: term_months,
          firstYearSchedule: schedule,
        };

        const scheduleValidation = validateAtlasOutput(AtlasOutputType.AMORTIZATION_SCHEDULE, {
          loanAmount: scheduleData.loanAmount,
          interestRate: scheduleData.interestRate,
          termMonths: scheduleData.termMonths,
          monthlyPayment: scheduleData.monthlyPayment,
          schedule: scheduleData.firstYearSchedule,
        });
        if (!scheduleValidation.valid) {
          logger.warn("[calculate_payment_schedule] Validation failed", { metadata: { errors: scheduleValidation.errors } });
          return { success: false, error: `Payment schedule failed validation: ${scheduleValidation.errors.join("; ")}` };
        }
        if (scheduleValidation.warnings.length > 0) {
          logger.warn("[calculate_payment_schedule] Validation warnings", { metadata: { warnings: scheduleValidation.warnings } });
        }

        return { success: true, data: scheduleData };
      }

      case "research_property": {
        const property = await storage.getProperty(org.id, args.property_id);
        if (!property) return { success: false, error: "Property not found" };
        if (!property.latitude || !property.longitude) {
          return { success: false, error: "Property does not have coordinates for research" };
        }

        const lat = Number(property.latitude);
        const lng = Number(property.longitude);

        // Run full enrichment via the enrichment service (all 20+ categories)
        const enrichment = await propertyEnrichmentService.enrichByCoordinates(lat, lng, {
          propertyId: property.id,
          state: property.state || undefined,
          county: property.county || undefined,
          apn: property.apn || undefined,
          forceRefresh: args.force_refresh === true,
        });

        return {
          success: true,
          data: {
            propertyId: property.id,
            apn: property.apn,
            address: property.address,
            coordinates: { lat, lng },
            enrichment,
            completenessScore: (enrichment as any).completenessScore ?? null,
          },
        };
      }

      case "get_property_enrichment": {
        const property = await storage.getProperty(org.id, args.property_id);
        if (!property) return { success: false, error: "Property not found" };

        const enrichmentData = (property as any).enrichmentData;
        if (!enrichmentData) {
          // r1 Marcus: the tool-call stream labeled this as "→ failed"
          // which looked like a provider error. It's actually just
          // "no enrichment run yet" — a soft empty, not a failure.
          // Return success=true with a null payload + message so the
          // rail renders "→ no data yet" (via tool-call-stream.tsx
          // formatter) instead of "failed."
          return {
            success: true,
            data: {
              propertyId: property.id,
              address: property.address,
              enrichedAt: null,
              completenessScore: 0,
              enrichment: null,
              message: "No enrichment data yet. Use research_property to trigger a first run.",
            },
          };
        }

        return {
          success: true,
          data: {
            propertyId: property.id,
            address: property.address,
            enrichedAt: (property as any).enrichedAt,
            completenessScore: enrichmentData.completenessScore ?? null,
            completenessBreakdown: enrichmentData.completenessBreakdown ?? null,
            enrichment: enrichmentData,
          },
        };
      }

      case "schedule_followup": {
        const task = await storage.createTask({
          organizationId: org.id,
          title: args.title,
          description: args.description || null,
          priority: args.priority || "medium",
          status: "pending",
          dueDate: args.due_date ? new Date(args.due_date) : null,
          entityType: args.entity_type,
          entityId: args.entity_id,
          createdBy: "ai-assistant",
        });
        invalidateContextCache(org.id);
        return { 
          success: true, 
          data: { 
            message: `Follow-up scheduled for ${args.due_date}`,
            task,
          } 
        };
      }

      case "browse_web": {
        const url = args.url as string;
        logger.info(`[browse_web] Starting browse for URL: ${url}`);
        if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
          return { success: false, error: "Invalid URL. Must start with http:// or https://" };
        }

        // Tier 1B — shared SSRF guard at the tool boundary (same validateUrl
        // as webhook dispatch/test, T0-11): rejects non-http(s) schemes and
        // hostnames that ARE or RESOLVE TO private/loopback/link-local/
        // metadata addresses (169.254.169.254 et al). browserAutomation.ts
        // keeps its own per-request interception as defense-in-depth.
        const { validateUrl, SSRFBlockedError } = await import(
          "../middleware/fileUploadSecurity"
        );
        let parsedBrowseUrl: URL;
        try {
          parsedBrowseUrl = await validateUrl(url);
        } catch (ssrfErr) {
          if (ssrfErr instanceof SSRFBlockedError) {
            logger.warn("[browse_web] URL blocked by SSRF guard", {
              metadata: { orgId: org.id, reason: ssrfErr.message },
            });
            return { success: false, error: `URL blocked: ${ssrfErr.message}` };
          }
          throw ssrfErr;
        }

        // Tier 1B — operator domain policy (allowlist/denylist via env).
        const { checkBrowseDomainPolicy } = await import("../utils/browsePolicy");
        const policy = checkBrowseDomainPolicy(parsedBrowseUrl.hostname);
        if (!policy.allowed) {
          logger.warn("[browse_web] URL blocked by domain policy", {
            metadata: { orgId: org.id, reason: policy.reason },
          });
          return { success: false, error: `URL blocked: ${policy.reason}` };
        }

        const browserAutomation = await import("../services/browserAutomation");
        const browseWeb = browserAutomation.browseWeb;
        logger.info(`[browse_web] Calling browseWeb function...`);
        const result = await browseWeb(url, {
          extractTables: args.extract_tables !== false,
          captureScreenshot: args.take_screenshot === true,
          waitMs: args.wait_ms || 0,
        });
        logger.info(`[browse_web] Result: success=${result.success}, title="${result.title}", contentLen=${result.content?.length}, error=${result.error}`);
        
        if (!result.success) {
          return { success: false, error: result.error || "Failed to load page" };
        }
        
        return {
          success: true,
          data: {
            url: result.url,
            title: result.title,
            content: result.content.substring(0, 8000),
            links: result.links.slice(0, 15),
            tables: result.tables.slice(0, 30),
            screenshot: result.screenshot,
            loadTimeMs: result.loadTimeMs,
          }
        };
      }
      
      case "draft_offer": {
        const deal = await storage.getDeal(org.id, Number(args.dealId));
        if (!deal) return { success: false, error: "Deal not found" };
        const property = await storage.getProperty(org.id, deal.propertyId);
        if (!property) return { success: false, error: "Property not found for this deal" };

        // Validate the offer amount before drafting
        const draftOfferValidation = validateAtlasOutput(AtlasOutputType.OFFER_AMOUNT, {
          amount: args.offerAmount,
        });
        if (!draftOfferValidation.valid) {
          logger.warn("[draft_offer] Offer amount validation failed", { metadata: { errors: draftOfferValidation.errors, dealId: deal.id } });
          return { success: false, error: `Offer amount validation failed: ${draftOfferValidation.errors.join("; ")}` };
        }

        const closingDays = args.closingDays || 30;
        const contingencies: string[] = args.contingencies || ["title_clear", "financing"];
        const contingencyText = contingencies.length > 0
          ? `Subject to the following contingencies: ${contingencies.join(", ")}.`
          : "No contingencies.";

        const offerAmountFormatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(args.offerAmount);
        const propertyDesc = [
          property.sizeAcres ? `${property.sizeAcres} acres` : null,
          property.county && property.state ? `${property.county} County, ${property.state}` : null,
          property.apn ? `APN: ${property.apn}` : null,
          property.address || null,
        ].filter(Boolean).join(", ");

        const { selectProviderAndModel, TaskComplexity } = await import("../services/aiRouter");
        const { client, model } = selectProviderAndModel(TaskComplexity.MODERATE);

        const aiResponse = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: "You are a professional real estate offer writer. Draft clear, concise, and professional land purchase offer letters."
            },
            {
              role: "user",
              content: `Draft a professional land purchase offer letter with these details:\n- Property: ${propertyDesc}\n- Offer Amount: ${offerAmountFormatted}\n- Closing Timeline: ${closingDays} days from acceptance\n- ${contingencyText}\n- Deal ID: ${deal.id}\n\nWrite a professional 2-3 paragraph offer letter suitable for sending to a seller. Include the offer amount, closing timeline, and contingencies. Keep it friendly and professional.`
            }
          ],
          max_tokens: 800
        });

        const draftText = aiResponse.choices[0].message.content || "";

        // Store in paxMemory for reference
        try {
          const { db: dbInstance } = await import("../db");
          const { paxMemory } = await import("@shared/schema");
          await dbInstance.insert(paxMemory).values({
            organizationId: org.id,
            userId: "ai-assistant",
            memoryType: "context",
            key: `offer_draft_deal_${deal.id}`,
            value: {
              summary: `Offer draft for deal ${deal.id}: ${offerAmountFormatted}`,
              details: { dealId: deal.id, propertyId: property.id, offerAmount: args.offerAmount, closingDays, contingencies, draftText },
              timestamp: new Date().toISOString(),
            },
            importance: 6,
          });
        } catch (_) { /* non-blocking */ }

        // S2b — drafting an offer on a negotiating deal advances it to
        // offer_sent (a legal state-machine transition) with the drafted
        // amount, so the pipeline reflects the offer without manual re-entry.
        // Any other status is left alone — never fight the state machine.
        if (deal.status === "negotiating") {
          try {
            const advanced = await storage.updateDeal(deal.id, { status: "offer_sent", offerAmount: String(args.offerAmount) } as any, undefined, org.id);
            // 2026-07-29 Wave B completeness audit: this is the "offer bridge"
            // the wave claimed to cover and did not — a negotiating → offer_sent
            // transition is a stage change like any other, and a workflow on
            // deal.stage_changed must not fire for a Kanban drag and stay
            // silent when Pax drafts the offer. Fire-and-forget, no-ops when
            // the status did not actually move.
            emitDealStageChanged(org.id, deal, advanced);
          } catch (advErr) {
            logger.warn("[draft_offer] deal advance to offer_sent failed (non-fatal)", {
              metadata: { dealId: deal.id, error: advErr instanceof Error ? advErr.message : String(advErr) },
            });
          }
        }

        invalidateContextCache(org.id);
        return {
          success: true,
          data: {
            message: `Offer letter drafted for deal #${deal.id}`,
            draftText,
            dealId: deal.id,
            propertyId: property.id,
            offerAmount: args.offerAmount,
            closingDays,
            contingencies,
          }
        };
      }

      case "schedule_follow_up": {
        const entityType = args.entityType as "lead" | "deal";
        const entityId = Number(args.entityId);

        // Validate the entity exists and belongs to this org
        if (entityType === "lead") {
          const lead = await storage.getLead(org.id, entityId);
          if (!lead) return { success: false, error: "Lead not found" };
        } else if (entityType === "deal") {
          const deal = await storage.getDeal(org.id, entityId);
          if (!deal) return { success: false, error: "Deal not found" };
        }

        const task = await storage.createTask({
          organizationId: org.id,
          title: `Follow-up: ${args.note}`,
          description: args.note,
          priority: "medium",
          status: "pending",
          dueDate: args.followUpDate ? new Date(args.followUpDate) : null,
          entityType,
          entityId,
          createdBy: "ai-assistant",
        });

        invalidateContextCache(org.id);
        return {
          success: true,
          data: {
            message: `Follow-up scheduled for ${args.followUpDate}`,
            task: {
              id: task.id,
              title: task.title,
              dueDate: task.dueDate,
              entityType: task.entityType,
              entityId: task.entityId,
              status: task.status,
            }
          }
        };
      }

      case "run_comps": {
        const property = await storage.getProperty(org.id, Number(args.propertyId));
        if (!property) return { success: false, error: "Property not found" };
        if (!property.county || !property.state) {
          return { success: false, error: "Property is missing county or state information" };
        }

        // Query all sold/listed properties in same county+state for this org as internal comps
        const allProperties = await storage.getProperties(org.id);
        const subjectAcres = Number(property.sizeAcres) || 0;

        const comps = allProperties.filter(p => {
          if (p.id === property.id) return false;
          if (p.county !== property.county || p.state !== property.state) return false;
          if (!["sold", "listed", "owned"].includes(p.status)) return false;
          if (!p.listPrice && !p.soldPrice && !p.marketValue) return false;
          return true;
        });

        const compData = comps.map(p => {
          const price = Number(p.soldPrice || p.listPrice || p.marketValue || 0);
          const acres = Number(p.sizeAcres) || 0;
          const pricePerAcre = acres > 0 ? price / acres : 0;
          return {
            id: p.id,
            apn: p.apn,
            address: p.address,
            sizeAcres: acres,
            status: p.status,
            price,
            pricePerAcre: Math.round(pricePerAcre * 100) / 100,
          };
        }).filter(c => c.pricePerAcre > 0);

        let medianPricePerAcre = 0;
        let estimatedValue = 0;
        if (compData.length > 0) {
          const sorted = [...compData].sort((a, b) => a.pricePerAcre - b.pricePerAcre);
          const mid = Math.floor(sorted.length / 2);
          medianPricePerAcre = sorted.length % 2 === 0
            ? (sorted[mid - 1].pricePerAcre + sorted[mid].pricePerAcre) / 2
            : sorted[mid].pricePerAcre;
          estimatedValue = subjectAcres > 0 ? Math.round(medianPricePerAcre * subjectAcres * 100) / 100 : 0;
        }

        return {
          success: true,
          data: {
            subjectProperty: {
              id: property.id,
              apn: property.apn,
              county: property.county,
              state: property.state,
              sizeAcres: subjectAcres,
              currentMarketValue: property.marketValue ? Number(property.marketValue) : null,
            },
            compsFound: compData.length,
            comparables: compData.slice(0, 10),
            analysis: {
              medianPricePerAcre: Math.round(medianPricePerAcre * 100) / 100,
              estimatedValue,
              compsSearchedIn: `${property.county} County, ${property.state}`,
              note: compData.length === 0
                ? "No internal comparable sales found in this county. Consider using run_comps_analysis for external data sources."
                : `Based on ${compData.length} comparable properties in ${property.county} County, ${property.state}.`,
            }
          }
        };
      }

      case "get_stale_leads": {
        const daysSinceContact = Number(args.daysSinceContact) || 14;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysSinceContact);

        const allLeads = await storage.getLeads(org.id);
        const staleLeads = allLeads.filter(lead => {
          if (["closed", "dead"].includes(lead.status)) return false;
          if (!lead.lastContactedAt && !lead.createdAt) return true;
          const lastContact = lead.lastContactedAt || lead.createdAt || new Date();
          return new Date(lastContact) < cutoffDate;
        });

        return {
          success: true,
          data: {
            daysSinceContact,
            staleCount: staleLeads.length,
            staleLeads: staleLeads.map(l => ({
              id: l.id,
              name: `${l.firstName} ${l.lastName}`,
              email: l.email,
              phone: l.phone,
              status: l.status,
              lastContactedAt: l.lastContactedAt || null,
              createdAt: l.createdAt,
              daysSinceContact: Math.floor(
                (Date.now() - new Date(l.lastContactedAt || l.createdAt || new Date()).getTime()) / (1000 * 60 * 60 * 24)
              ),
            })).sort((a, b) => b.daysSinceContact - a.daysSinceContact),
            message: staleLeads.length > 0
              ? `Found ${staleLeads.length} leads with no contact in the last ${daysSinceContact} days.`
              : `All leads have been contacted within the last ${daysSinceContact} days.`,
          }
        };
      }

      case "draft_outreach_message": {
        const lead = await storage.getLead(org.id, Number(args.leadId));
        if (!lead) return { success: false, error: "Lead not found" };

        const messageType = args.messageType as "email" | "sms" | "voicemail_script";
        const sellerName = `${lead.firstName} ${lead.lastName}`.trim();

        // Build context about the lead and their property
        let propertyContext = "";
        const allProperties = await storage.getProperties(org.id);
        const sellerProperty = allProperties.find(p => p.sellerId === lead.id);
        if (sellerProperty) {
          propertyContext = `Property: ${sellerProperty.sizeAcres} acres in ${sellerProperty.county} County, ${sellerProperty.state}${sellerProperty.apn ? ` (APN: ${sellerProperty.apn})` : ""}.`;
        }

        const leadContext = [
          `Lead: ${sellerName}`,
          lead.status ? `Status: ${lead.status}` : null,
          lead.source ? `Source: ${lead.source}` : null,
          lead.notes ? `Notes: ${lead.notes.substring(0, 200)}` : null,
          propertyContext || null,
          lead.lastContactedAt ? `Last contacted: ${new Date(lead.lastContactedAt).toLocaleDateString()}` : "Never contacted",
        ].filter(Boolean).join("\n");

        const mediumInstructions: Record<string, string> = {
          email: "Write a personalized email. Include a subject line on the first line (format: 'Subject: ...'), then a blank line, then the email body. Keep it warm, personal, and focused on the seller's situation. 150-250 words.",
          sms: "Write a brief, friendly SMS text message under 160 characters. Be conversational and include your name/company at the end.",
          voicemail_script: "Write a voicemail script the caller can read aloud. Include: greeting, brief reason for calling, call to action, callback number placeholder [YOUR PHONE], and sign-off. Keep it under 30 seconds when spoken (about 75 words).",
        };

        const { selectProviderAndModel, TaskComplexity } = await import("../services/aiRouter");
        const { client, model } = selectProviderAndModel(TaskComplexity.SIMPLE);

        const aiResponse = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: "You are an expert real estate outreach specialist. Write personalized, empathetic messages that connect with landowners. Never be pushy. Focus on helping the seller understand their options."
            },
            {
              role: "user",
              content: `Draft a ${messageType.replace("_", " ")} for this seller:\n\n${leadContext}\n\n${mediumInstructions[messageType]}`
            }
          ],
          max_tokens: 400
        });

        const draftMessage = aiResponse.choices[0].message.content || "";

        return {
          success: true,
          data: {
            message: `${messageType.replace("_", " ")} draft created for ${sellerName}`,
            leadId: lead.id,
            leadName: sellerName,
            messageType,
            draft: draftMessage,
            hint: messageType === "email" && lead.email
              ? `Ready to send to ${lead.email} using send_email tool`
              : messageType === "sms" && lead.phone
              ? `Ready to send to ${lead.phone} using send_sms tool`
              : undefined,
          }
        };
      }

      // ── Memory tools ─────────────────────────────────────────────────────────

      case "remember_fact": {
        const { paxMemory } = await import("@shared/schema");
        const { db } = await import("../db");
        await db.insert(paxMemory).values({
          organizationId: org.id,
          userId: "pax",
          memoryType: args.category || "insight",
          key: args.fact?.slice(0, 100) || "remembered_fact",
          value: { content: args.fact },
          importance: 8,
          source: "pax_explicit_memory",
        } as any);
        return { success: true, data: { remembered: args.fact } };
      }

      case "recall_facts": {
        const { paxMemory: pm } = await import("@shared/schema");
        const { db: _db } = await import("../db");
        const { ilike, and: _and, eq: _eq } = await import("drizzle-orm");
        const conditions: any[] = [_eq(pm.organizationId, org.id)];
        if (args.category) conditions.push(_eq(pm.memoryType, args.category));
        if (args.query) conditions.push(ilike(pm.key, `%${args.query}%`));
        const facts = await _db.select().from(pm)
          .where(_and(...conditions))
          .limit(args.limit || 10)
          .orderBy(pm.updatedAt);
        return { success: true, data: { facts: facts.map(f => ({ category: f.memoryType, fact: (f.value as any)?.content || f.key, remembered: f.createdAt })) } };
      }

      // ── Sub-agent tool ────────────────────────────────────────────────────────

      case "spawn_subagent": {
        const currentDepth = (org as any).__subAgentDepth ?? 0;
        if (currentDepth >= 2) {
          return { success: false, error: "Sub-agent depth limit reached (max 2)" };
        }
        const { processChat } = await import("./executive");
        const subOrg = { ...org, __subAgentDepth: currentDepth + 1 } as any;
        const subResult = await processChat(args.prompt, subOrg, "pax_subagent", {
          agentRole: (args.role || "research") as any,
          subAgentDepth: currentDepth + 1,
          // A sub-agent's asks belong to the lane that spawned it.
          origin,
          scheduledTask: options?.scheduledTask ?? null,
        });
        return { success: true, data: { response: subResult.response, conversationId: subResult.conversationId } };
      }

      // ── Land-knowledge retrieval (Andrei E5) ───────────────────────────────────

      case "retrieve_land_knowledge": {
        const { isLandKnowledgeEnabled } = await import(
          "../services/pax/landKnowledge/corpus"
        );
        if (!isLandKnowledgeEnabled()) {
          // Belt-and-suspenders: the executive tool-list builder already
          // filters this tool out when the flag is off, but if it's ever
          // invoked anyway, refuse rather than answer ungrounded.
          return {
            success: false,
            error:
              "Land-knowledge retrieval is not enabled. Answer from retrieved parcel facts only.",
          };
        }
        const { retrieveLandKnowledge, buildLandKnowledgePayload } =
          await import("../services/pax/landKnowledge/retrieval");
        const query = typeof args.query === "string" ? args.query : "";
        const topK = typeof args.topK === "number" ? args.topK : undefined;
        const retrieved = await retrieveLandKnowledge(query, { topK });
        return { success: true, data: buildLandKnowledgePayload(retrieved) };
      }

      // ── Connector tools ──────────────────────────────────────────────────────

      case "search_gmail": {
        const { searchGmail } = await import("../services/connectors/executor");
        return searchGmail(org, args as any);
      }
      case "send_gmail": {
        const { sendGmail } = await import("../services/connectors/executor");
        return sendGmail(org, args as any);
      }
      case "send_slack_message": {
        const { sendSlackMessage } = await import("../services/connectors/executor");
        return sendSlackMessage(org, args as any);
      }
      case "get_stripe_customer": {
        const { getStripeCustomer } = await import("../services/connectors/executor");
        return getStripeCustomer(org, args as any);
      }
      case "list_stripe_payments": {
        const { listStripePayments } = await import("../services/connectors/executor");
        return listStripePayments(org, args as any);
      }
      case "create_stripe_payment_link": {
        const { createStripePaymentLink } = await import("../services/connectors/executor");
        return createStripePaymentLink(org, args as any);
      }
      case "search_drive": {
        const { searchDrive } = await import("../services/connectors/executor");
        return searchDrive(org, args as any);
      }
      case "get_drive_file": {
        const { getDriveFile } = await import("../services/connectors/executor");
        return getDriveFile(org, args as any);
      }
      case "list_calendar_events": {
        const { listCalendarEvents } = await import("../services/connectors/executor");
        return listCalendarEvents(org, args as any);
      }
      case "create_calendar_event": {
        const { createCalendarEvent } = await import("../services/connectors/executor");
        return createCalendarEvent(org, args as any);
      }
      // `batch_leads_skip_trace` had a dispatch branch here until 2026-08-20.
      // The FCRA gate above returns before this switch, so it was unreachable
      // the moment that gate landed. The TOOL stays — a refusal that names what
      // it needs and where to do it is better than a tool that vanishes and
      // leaves Pax improvising — but the executor behind it is gone; see the
      // deletion ledger.
      case "search_mls_listings": {
        const { searchMlsListings } = await import("../services/connectors/executor");
        return searchMlsListings(org, args as any);
      }
      case "get_mls_comps": {
        const { getMlsComps } = await import("../services/connectors/executor");
        return getMlsComps(org, args as any);
      }
      case "trigger_zapier": {
        const { triggerZapier } = await import("../services/connectors/executor");
        return triggerZapier(org, args as any);
      }
      case "trigger_make": {
        const { triggerMake } = await import("../services/connectors/executor");
        return triggerMake(org, args as any);
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
    })();

    if (!pauseSafe && !trustedApproval && outcome.success && !receiptWritten) {
      // Never into the tool path: the effect already happened, and a
      // bookkeeping failure must not turn it into an error the model
      // retries. recordPaxEffect swallows its own errors; this guards the
      // derivation around it.
      try {
        const entity = receiptEntity(org, args, outcome.data);
        const d = outcome.data && typeof outcome.data === "object" ? outcome.data : {};
        await recordPaxEffect({
          orgId: org.id,
          actor: "pax",
          origin,
          stance: controls?.stance ?? null,
          tool: toolName,
          entityType: entity.entityType,
          entityId: entity.entityId,
          before: d.before,
          after: d.after,
          witnessed: false,
          userId: options?.userId ?? null,
        });
      } catch (receiptErr) {
        logger.error("[executeTool] Receipt hook failed — the effect stands, the record does not", receiptErr as Error, {
          orgId: org.id,
          metadata: { toolName, origin },
        });
      }
    }

    return outcome;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Get tools formatted for OpenAI
export function getOpenAITools() {
  return Object.values(toolDefinitions).map(tool => ({
    type: "function" as const,
    function: tool
  }));
}

// Get tools for a specific agent role
export function getToolsForRole(role: string) {
  const allTools = Object.keys(toolDefinitions);
  const coreTools = ["get_system_context", "get_dashboard_stats"];
  
  const memoryTools = ["remember_fact", "recall_facts"];
  const roleToolMap: Record<string, string[]> = {
    executive: allTools,
    acquisitions: [...coreTools, ...memoryTools, "get_leads", "get_lead_details", "update_lead_status", "create_lead", "get_properties", "create_property", "get_deals", "create_deal", "get_tasks", "create_task", "get_pipeline_summary", "generate_offer", "generate_offer_letter", "send_email", "send_sms", "run_comps_analysis", "schedule_followup", "draft_offer", "schedule_follow_up", "run_comps", "get_stale_leads", "draft_outreach_message"],
    underwriting: [...coreTools, ...memoryTools, "get_properties", "get_property_details", "update_property", "get_notes", "calculate_amortization", "get_cashflow_summary", "get_deals", "update_deal", "run_comps_analysis", "run_comps", "calculate_roi", "calculate_payment_schedule", "research_property", "draft_offer"],
    marketing: [...coreTools, ...memoryTools, "get_leads", "get_properties", "get_pipeline_summary", "create_task", "send_email", "send_sms", "get_stale_leads", "draft_outreach_message"],
    research: [...coreTools, ...memoryTools, "get_properties", "get_property_details", "get_leads", "create_property", "update_property", "run_comps_analysis", "run_comps", "research_property", "calculate_roi", "browse_web"],
    documents: [...coreTools, "get_leads", "get_lead_details", "get_properties", "get_property_details", "get_notes", "get_deals", "generate_offer_letter", "draft_offer"],
    assistant: allTools // Full access for the main assistant
  };
  
  const allowedTools = roleToolMap[role] || roleToolMap.executive;
  return Object.entries(toolDefinitions)
    .filter(([name]) => allowedTools.includes(name))
    .map(([_, tool]) => ({ type: "function" as const, function: tool }));
}

// Export type for tool names
export type ToolName = keyof typeof toolDefinitions;

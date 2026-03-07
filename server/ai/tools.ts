import { storage } from "../storage";
import type { Organization } from "@shared/schema";
import { getSystemContext, formatContextForAI, invalidateContextCache } from "../services/aiContextAggregator";
import { lookupParcelByAPN } from "../services/parcel";
import { generateOfferSuggestions, generateOfferLetter } from "../services/aiOfferService";
import { emailService } from "../services/emailService";
import { smsService, sendOrgSMS } from "../services/smsService";
import { getComparableProperties } from "../services/comps";
import { checkTcpaConsentFromLead } from "../services/tcpaCompliance";
import { DataSourceBroker } from "../services/data-source-broker";
import { propertyEnrichmentService } from "../services/propertyEnrichment";

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

  // Background Job Tools
  schedule_background_job: {
    name: "schedule_background_job",
    description: "Schedule a background job that runs independently. Use for bulk operations or long-running tasks.",
    parameters: {
      type: "object",
      properties: {
        job_type: { 
          type: "string", 
          enum: ["bulk_property_import", "bulk_lead_import", "campaign_send", "report_generation"],
          description: "Type of background job" 
        },
        data: { type: "object", description: "Job-specific data" },
        description: { type: "string", description: "Human-readable description of what this job does" }
      },
      required: ["job_type", "description"]
    }
  },

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
  }
};

// Tool executor functions
export async function executeTool(
  toolName: string, 
  args: Record<string, any>,
  org: Organization
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
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
        const updated = await storage.updateLead(args.lead_id, { 
          status: args.status,
          notes: args.notes 
        });
        return { success: true, data: { message: `Lead status updated to ${args.status}`, lead: updated } };
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
        
        if (monthlyRate === 0) {
          const payment = loanAmount / term_months;
          return { success: true, data: {
            loanAmount,
            monthlyPayment: Math.round(payment * 100) / 100,
            totalPayments: Math.round(loanAmount * 100) / 100,
            totalInterest: 0,
            effectiveRate: 0,
            termMonths: term_months
          }};
        }
        
        const payment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, term_months)) 
                       / (Math.pow(1 + monthlyRate, term_months) - 1);
        const totalPayments = payment * term_months;
        const totalInterest = totalPayments - loanAmount;
        
        return { success: true, data: {
          loanAmount,
          monthlyPayment: Math.round(payment * 100) / 100,
          totalPayments: Math.round(totalPayments * 100) / 100,
          totalInterest: Math.round(totalInterest * 100) / 100,
          effectiveRate: annual_rate,
          termMonths: term_months
        }};
      }
      
      case "get_cashflow_summary": {
        const notes = await storage.getNotes(org.id);
        const activeNotes = notes.filter(n => n.status === "active");
        const monthlyCashflow = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
        const totalBalance = activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);
        return { success: true, data: {
          activeNotesCount: activeNotes.length,
          totalOutstandingBalance: Math.round(totalBalance * 100) / 100,
          monthlyCashflow: Math.round(monthlyCashflow * 100) / 100,
          annualCashflow: Math.round(monthlyCashflow * 12 * 100) / 100
        }};
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
            console.log(`[CreateProperty] Fetching parcel for ${args.apn} at ${stateCountyPath}`);
            const parcelResult = await lookupParcelByAPN(args.apn, stateCountyPath, org.id);
            
            if (parcelResult.found && parcelResult.parcel) {
              await storage.updateProperty(property.id, {
                parcelBoundary: parcelResult.parcel.boundary,
                parcelCentroid: parcelResult.parcel.centroid,
                parcelData: parcelResult.parcel.data,
                latitude: String(parcelResult.parcel.centroid.lat),
                longitude: String(parcelResult.parcel.centroid.lng),
              });
              hasBoundary = true;
              console.log(`[CreateProperty] Parcel found from ${parcelResult.source}`);
            }
          } catch (parcelErr: any) {
            console.error(`[CreateProperty] Parcel lookup error:`, parcelErr.message);
          }
        }
        
        invalidateContextCache(org.id);
        return { success: true, data: { message: `Property created successfully${hasBoundary ? ' with parcel boundary' : ''}`, property, hasBoundary } };
      }

      case "update_property": {
        const updates: Record<string, any> = {};
        if (args.status) updates.status = args.status;
        if (args.listPrice !== undefined) updates.listPrice = String(args.listPrice);
        if (args.marketValue !== undefined) updates.marketValue = String(args.marketValue);
        if (args.notes) updates.notes = args.notes;
        
        const property = await storage.updateProperty(args.property_id, updates);
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Property updated successfully", property } };
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
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Deal created successfully", deal } };
      }

      case "update_deal": {
        const dealUpdates: Record<string, any> = {};
        if (args.status) dealUpdates.status = args.status;
        if (args.offerAmount !== undefined) dealUpdates.offerAmount = String(args.offerAmount);
        if (args.notes) dealUpdates.notes = args.notes;
        
        const deal = await storage.updateDeal(args.deal_id, dealUpdates);
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Deal updated successfully", deal } };
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
        const taskUpdates: Record<string, any> = {};
        if (args.status) taskUpdates.status = args.status;
        if (args.priority) taskUpdates.priority = args.priority;
        if (args.dueDate) taskUpdates.dueDate = new Date(args.dueDate);
        
        const task = await storage.updateTask(args.task_id, taskUpdates);
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Task updated successfully", task } };
      }

      case "complete_task": {
        const task = await storage.updateTask(args.task_id, { status: "completed" });
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Task marked as completed", task } };
      }

      case "schedule_background_job": {
        console.log(`[AI Tools] Background job scheduled: ${args.job_type} - ${args.description}`);
        return { 
          success: true, 
          data: { 
            message: `Background job scheduled: ${args.description}`,
            jobType: args.job_type,
            status: "queued"
          } 
        };
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
            
            // Auto-fetch parcel boundary data after creation (only if state/county provided)
            let hasBoundary = false;
            if (prop.state && prop.county) {
              try {
                const stateCountyPath = `/us/${prop.state.toLowerCase()}/${prop.county.toLowerCase().replace(/\s+/g, "-")}`;
                console.log(`[Batch] Fetching parcel for ${prop.apn} at ${stateCountyPath}`);
                const parcelResult = await lookupParcelByAPN(prop.apn, stateCountyPath, org.id);
                
                if (parcelResult.found && parcelResult.parcel) {
                  await storage.updateProperty(property.id, {
                    parcelBoundary: parcelResult.parcel.boundary,
                    parcelCentroid: parcelResult.parcel.centroid,
                    parcelData: parcelResult.parcel.data,
                    latitude: String(parcelResult.parcel.centroid.lat),
                    longitude: String(parcelResult.parcel.centroid.lng),
                  });
                  hasBoundary = true;
                  console.log(`[Batch] Parcel found for ${prop.apn} from ${parcelResult.source}`);
                } else {
                  console.log(`[Batch] No parcel found for ${prop.apn}: ${parcelResult.error || 'not found'}`);
                }
              } catch (parcelErr: any) {
                console.error(`[Batch] Parcel lookup error for ${prop.apn}:`, parcelErr.message);
              }
            } else {
              console.log(`[Batch] Skipping parcel lookup for ${prop.apn} - missing state/county`);
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

        const result = await generateOfferSuggestions(propertyData);
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

        return { 
          success: result.success, 
          data: result.success ? { letter: result.letter, subject: result.subject } : undefined,
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

        const result = await emailService.sendEmail({
          to: toEmail!,
          subject: args.subject,
          html: htmlContent,
          text: textContent,
          organizationId: org.id,
        });

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
        } else if (args.phone_number) {
          toPhone = args.phone_number;
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

        const result = await sendOrgSMS(org.id, toPhone, args.message);

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

        return { 
          success: true, 
          data: {
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
          }
        };
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

        return { 
          success: true, 
          data: {
            loanAmount: Math.round(loanAmount * 100) / 100,
            downPayment: down_payment,
            monthlyPayment: Math.round(monthlyPayment * 100) / 100,
            totalPayments: Math.round(monthlyPayment * term_months * 100) / 100,
            totalInterest: Math.round(totalInterest * 100) / 100,
            interestRate: interest_rate,
            termMonths: term_months,
            firstYearSchedule: schedule,
          }
        };
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
          return {
            success: false,
            error: "No enrichment data found for this property. Run research_property first to fetch data.",
            hint: "Use research_property tool to trigger enrichment.",
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
        console.log(`[browse_web] Starting browse for URL: ${url}`);
        if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
          return { success: false, error: "Invalid URL. Must start with http:// or https://" };
        }
        
        const browserAutomation = await import("../services/browserAutomation");
        const browseWeb = browserAutomation.browseWeb;
        console.log(`[browse_web] Calling browseWeb function...`);
        const result = await browseWeb(url, {
          extractTables: args.extract_tables !== false,
          captureScreenshot: args.take_screenshot === true,
          waitMs: args.wait_ms || 0,
        });
        console.log(`[browse_web] Result: success=${result.success}, title="${result.title}", contentLen=${result.content?.length}, error=${result.error}`);
        
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
      
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
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
  
  const roleToolMap: Record<string, string[]> = {
    executive: allTools,
    acquisitions: [...coreTools, "get_leads", "get_lead_details", "update_lead_status", "create_lead", "get_properties", "create_property", "get_deals", "create_deal", "get_tasks", "create_task", "get_pipeline_summary", "generate_offer", "generate_offer_letter", "send_email", "send_sms", "run_comps_analysis", "schedule_followup"],
    underwriting: [...coreTools, "get_properties", "get_property_details", "update_property", "get_notes", "calculate_amortization", "get_cashflow_summary", "get_deals", "update_deal", "run_comps_analysis", "calculate_roi", "calculate_payment_schedule", "research_property"],
    marketing: [...coreTools, "get_leads", "get_properties", "get_pipeline_summary", "create_task", "send_email", "send_sms"],
    research: [...coreTools, "get_properties", "get_property_details", "get_leads", "create_property", "update_property", "run_comps_analysis", "research_property", "calculate_roi", "browse_web"],
    documents: [...coreTools, "get_leads", "get_lead_details", "get_properties", "get_property_details", "get_notes", "get_deals", "generate_offer_letter"],
    assistant: allTools // Full access for the main assistant
  };
  
  const allowedTools = roleToolMap[role] || roleToolMap.executive;
  return Object.entries(toolDefinitions)
    .filter(([name]) => allowedTools.includes(name))
    .map(([_, tool]) => ({ type: "function" as const, function: tool }));
}

// Export type for tool names
export type ToolName = keyof typeof toolDefinitions;

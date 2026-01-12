import { storage } from "../storage";
import type { Organization } from "@shared/schema";
import { getSystemContext, formatContextForAI, invalidateContextCache } from "../services/aiContextAggregator";

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
        invalidateContextCache(org.id);
        return { success: true, data: { message: "Property created successfully", property } };
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

        const results: Array<{ success: boolean; apn: string; propertyId?: number; error?: string }> = [];
        
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
            
            results.push({ success: true, apn: prop.apn, propertyId: property.id });
          } catch (err: any) {
            results.push({ success: false, apn: prop.apn, error: err.message });
          }
        }

        invalidateContextCache(org.id);
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        return { 
          success: successCount > 0, 
          data: { 
            message: `Created ${successCount} properties${failCount > 0 ? `, ${failCount} failed` : ''}`,
            results,
            successCount,
            failCount
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
    acquisitions: [...coreTools, "get_leads", "get_lead_details", "update_lead_status", "create_lead", "get_properties", "create_property", "get_deals", "create_deal", "get_tasks", "create_task", "get_pipeline_summary"],
    underwriting: [...coreTools, "get_properties", "get_property_details", "update_property", "get_notes", "calculate_amortization", "get_cashflow_summary", "get_deals", "update_deal"],
    marketing: [...coreTools, "get_leads", "get_properties", "get_pipeline_summary", "create_task"],
    research: [...coreTools, "get_properties", "get_property_details", "get_leads", "create_property", "update_property"],
    documents: [...coreTools, "get_leads", "get_lead_details", "get_properties", "get_property_details", "get_notes", "get_deals"],
    assistant: allTools // Full access for the main assistant
  };
  
  const allowedTools = roleToolMap[role] || roleToolMap.executive;
  return Object.entries(toolDefinitions)
    .filter(([name]) => allowedTools.includes(name))
    .map(([_, tool]) => ({ type: "function" as const, function: tool }));
}

// Export type for tool names
export type ToolName = keyof typeof toolDefinitions;

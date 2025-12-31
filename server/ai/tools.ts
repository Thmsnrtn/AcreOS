import { storage } from "../storage";
import type { Organization } from "@shared/schema";

// Tool parameter schemas (OpenAI function calling format)
export const toolDefinitions = {
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
  const roleToolMap: Record<string, string[]> = {
    executive: Object.keys(toolDefinitions),
    acquisitions: ["get_leads", "get_lead_details", "update_lead_status", "create_lead", "get_properties", "get_pipeline_summary"],
    underwriting: ["get_properties", "get_property_details", "get_notes", "calculate_amortization", "get_cashflow_summary"],
    marketing: ["get_leads", "get_properties", "get_pipeline_summary"],
    research: ["get_properties", "get_property_details", "get_leads"],
    documents: ["get_leads", "get_lead_details", "get_properties", "get_property_details", "get_notes"]
  };
  
  const allowedTools = roleToolMap[role] || roleToolMap.executive;
  return Object.entries(toolDefinitions)
    .filter(([name]) => allowedTools.includes(name))
    .map(([_, tool]) => ({ type: "function" as const, function: tool }));
}

// Export type for tool names
export type ToolName = keyof typeof toolDefinitions;

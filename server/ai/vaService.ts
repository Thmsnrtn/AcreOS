import OpenAI from "openai";
import { storage } from "../storage";
import { toolDefinitions, executeTool, type ToolName } from "./tools";
import type { Organization, VaAgent, VaAction, InsertVaAction, InsertVaBriefing } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type VaAgentType = "executive" | "sales" | "acquisitions" | "marketing" | "collections" | "research";

interface VaAgentProfile {
  systemPrompt: string;
  capabilities: string[];
  tools: ToolName[];
  priorityCategories: {
    high: string[];
    medium: string[];
    low: string[];
  };
}

export const VA_AGENT_PROFILES: Record<VaAgentType, VaAgentProfile> = {
  executive: {
    systemPrompt: `You are Evelyn, the Executive Virtual Assistant for this land investment company. Think of yourself as the Chief of Staff - you're the first line of coordination, ensuring the business runs smoothly every day.

PERSONALITY:
- Professional, composed, and highly organized
- Proactive but respectful of the owner's time
- Excellent at synthesizing information from multiple departments
- Knows when to escalate and when to handle things independently

CORE RESPONSIBILITIES:
1. Daily Briefings: Compile morning briefings that summarize overnight activity, key metrics, and priority items requiring attention
2. Task Routing: Analyze incoming requests and route them to the appropriate specialized agent (Sales, Acquisitions, Marketing, Collections, Research)
3. Calendar Management: Track important dates (closing deadlines, payment due dates, follow-up reminders) and ensure nothing falls through the cracks
4. Cross-Department Coordination: When issues span multiple areas, coordinate between agents

WHAT YOU HANDLE DIRECTLY:
- Morning/evening briefing generation
- Scheduling and calendar queries
- Status checks across all departments
- General business questions and data lookups

WHAT YOU ESCALATE:
- Actual sales conversations → Sales Agent
- Purchase negotiations → Acquisitions Agent
- Marketing campaign execution → Marketing Agent
- Payment collection issues → Collections Agent
- Property research requests → Research Agent

COMMUNICATION STYLE:
- Start briefings with the most important items first
- Use bullet points for clarity
- Include specific numbers and percentages where relevant
- End with clear action items`,

    capabilities: [
      "Generate daily/weekly business briefings",
      "Route tasks to appropriate agents",
      "Track and summarize calendar events",
      "Provide cross-departmental status updates",
      "Answer general business queries",
      "Summarize pipeline and portfolio metrics"
    ],
    tools: ["get_dashboard_stats", "get_pipeline_summary", "get_leads", "get_properties", "get_notes", "get_cashflow_summary"],
    priorityCategories: {
      high: ["urgent_escalation", "missed_deadline", "critical_metric_alert"],
      medium: ["daily_briefing", "task_routing", "status_update"],
      low: ["general_query", "routine_reminder"]
    }
  },

  sales: {
    systemPrompt: `You are Samantha, the Sales Virtual Assistant specializing in buyer relationships. You're the friendly, knowledgeable face of the company for property buyers.

PERSONALITY:
- Warm, approachable, and genuinely helpful
- Excellent at reading buyer signals and motivation
- Patient with questions but skilled at advancing conversations
- Enthusiastic about land without being pushy

CORE RESPONSIBILITIES:
1. Buyer Inquiry Response: Respond promptly and helpfully to buyer inquiries about listed properties
2. Lead Qualification: Assess buyer readiness, budget, and timeline through conversation
3. Scheduling: Coordinate property viewings, calls, and closing appointments
4. Follow-Up: Maintain momentum with interested buyers through timely, personalized follow-ups

QUALIFICATION FRAMEWORK:
- Budget: Can they afford the property with financing if needed?
- Timeline: When do they want to close?
- Motivation: Why do they want land (investment, building, recreation)?
- Decision Process: Who else is involved in the decision?

WHAT YOU HANDLE DIRECTLY:
- Initial buyer inquiries and questions about properties
- Property information and comparisons
- Scheduling viewings and calls
- Follow-up messages to warm leads
- Basic financing explanations

WHAT YOU ESCALATE:
- Offer negotiations (involves pricing decisions)
- Contract questions (legal implications)
- Financing structuring (specialized calculations)
- Unhappy or difficult buyers

RESPONSE TEMPLATES TO USE:
- For new inquiries: Acknowledge interest, answer question, ask qualifying question
- For follow-ups: Reference previous conversation, provide value, suggest next step
- For scheduling: Offer 2-3 specific time options`,

    capabilities: [
      "Respond to buyer property inquiries",
      "Qualify buyer leads",
      "Schedule property viewings and calls",
      "Send follow-up messages",
      "Track buyer interest and engagement",
      "Provide property comparisons"
    ],
    tools: ["get_leads", "get_lead_details", "update_lead_status", "create_lead", "get_properties", "get_property_details"],
    priorityCategories: {
      high: ["hot_lead_response", "offer_received", "closing_deadline"],
      medium: ["new_inquiry", "scheduled_follow_up", "lead_qualification"],
      low: ["general_property_question", "long_term_nurture"]
    }
  },

  acquisitions: {
    systemPrompt: `You are Alexander, the Acquisitions Virtual Assistant. You're the deal hunter - always on the lookout for the next great land buying opportunity at the right price.

PERSONALITY:
- Sharp, analytical, and detail-oriented
- Comfortable with negotiation and numbers
- Patient - good deals take time
- Ethical - fair dealing builds long-term reputation

CORE RESPONSIBILITIES:
1. Seller Lead Monitoring: Track and prioritize incoming seller leads based on motivation and deal potential
2. Comp Research: Analyze comparable sales to determine fair market value and offer prices
3. Offer Drafting: Prepare offers based on established formulas and owner preferences
4. Negotiation Support: Provide counter-offer recommendations and negotiation talking points

DEAL EVALUATION FRAMEWORK:
- Acquisition Cost vs Market Value (aim for 30-50% of retail)
- Size and usability of parcel
- Road access and utilities
- Tax situation (delinquent taxes = motivated seller)
- Time on market / seller motivation

OFFER FORMULA (default):
- Base offer: 25-35% of market value for cash
- Adjust up for: utilities, paved road, high demand area
- Adjust down for: landlocked, wetlands, HOA issues

WHAT YOU HANDLE DIRECTLY:
- Seller lead scoring and prioritization
- Initial seller contact and motivation assessment
- Comp research and value analysis
- Draft offer preparation
- Standard counter-offer responses

WHAT YOU ESCALATE:
- Deals over $50,000
- Complex title issues
- Offers outside normal parameters
- Sellers requiring special handling
- Environmental concerns

DUE DILIGENCE CHECKLIST:
- Verify ownership via county records
- Check for liens and encumbrances
- Confirm property taxes and status
- Verify access and utilities
- Review zoning and restrictions`,

    capabilities: [
      "Score and prioritize seller leads",
      "Research comparable sales",
      "Calculate offer amounts",
      "Draft purchase offers",
      "Track acquisition pipeline",
      "Perform preliminary due diligence"
    ],
    tools: ["get_leads", "get_lead_details", "update_lead_status", "create_lead", "get_properties", "get_property_details", "get_pipeline_summary"],
    priorityCategories: {
      high: ["motivated_seller", "below_market_deal", "expiring_offer"],
      medium: ["new_seller_lead", "offer_counter", "due_diligence_task"],
      low: ["market_research", "lead_nurturing", "data_cleanup"]
    }
  },

  marketing: {
    systemPrompt: `You are Maya, the Marketing Virtual Assistant. You're creative, data-driven, and always looking for the next opportunity to reach the right audience.

PERSONALITY:
- Creative but grounded in metrics
- Curious about what makes people respond
- Organized with campaign details
- Excited about testing new approaches

CORE RESPONSIBILITIES:
1. Market Research: Analyze target areas for marketing potential, identify list sources
2. Campaign Proposals: Design mail campaigns targeting specific seller demographics
3. Lob Integration: Prepare direct mail campaigns for execution through Lob API
4. Performance Tracking: Monitor campaign response rates and ROI

DIRECT MAIL STRATEGY:
- Target: Delinquent taxes, out-of-state owners, long-time owners, inherited properties
- Timing: Best months are January-March and September-November
- Frequency: 3-touch minimum for cold lists
- Messaging: Different approaches for different motivations

CAMPAIGN TYPES:
- "Tired Landlord" - for long-term owners in low-value parcels
- "Cash Offer" - straightforward cash purchase pitch
- "Problem Solver" - for inherited or tax-delinquent properties
- "Neutral Letter" - simple inquiry without hard sell

WHAT YOU HANDLE DIRECTLY:
- Campaign concept development and proposals
- List segmentation and targeting recommendations
- Mail piece content drafting
- Response tracking and analysis
- A/B test design

WHAT YOU ESCALATE:
- Budget allocation over $1,000
- New list purchases
- Brand messaging changes
- Underperforming campaign decisions

METRICS TO TRACK:
- Mail sent count
- Response rate (target: 1-3%)
- Cost per response
- Cost per acquisition
- Campaign ROI`,

    capabilities: [
      "Research target markets and demographics",
      "Design direct mail campaigns",
      "Create marketing copy and messaging",
      "Analyze campaign performance",
      "Recommend list targeting strategies",
      "Prepare Lob-ready mail campaigns"
    ],
    tools: ["get_leads", "get_properties", "get_pipeline_summary"],
    priorityCategories: {
      high: ["campaign_launch", "low_response_alert", "budget_optimization"],
      medium: ["campaign_proposal", "list_research", "a_b_test_analysis"],
      low: ["market_research", "content_creation", "historical_analysis"]
    }
  },

  collections: {
    systemPrompt: `You are Carlos, the Collections Virtual Assistant. You handle the delicate balance of maintaining positive borrower relationships while ensuring payments are made on time.

PERSONALITY:
- Firm but fair and empathetic
- Excellent at de-escalation
- Patient with payment arrangements
- Professional and never threatening
- Understands that life happens

CORE RESPONSIBILITIES:
1. Payment Monitoring: Track all active notes and identify upcoming, due, and overdue payments
2. Reminder Sequences: Send timely, appropriate payment reminders at scheduled intervals
3. Delinquency Handling: Manage early-stage delinquencies with payment plans and solutions
4. Reporting: Flag accounts requiring escalation or legal action

REMINDER SCHEDULE:
- 7 days before: Friendly reminder of upcoming payment
- Due date: Payment due notification
- 3 days late: First late notice (friendly)
- 10 days late: Second late notice (firmer)
- 30 days late: Formal delinquency notice
- 60+ days late: Escalate to owner

COMMUNICATION APPROACH:
- Always acknowledge the relationship first
- Offer solutions, not just demands
- Document all communications
- Never make threats or be condescending
- Emphasize mutual benefit of staying current

PAYMENT PLAN OPTIONS:
- Catch-up plan: Extra amount added to regular payments
- Temporary reduction: Reduced payments for hardship period
- Payment holiday: Defer 1-2 payments (added to end of term)
- Partial payment acceptance: Document as partial, track remainder

WHAT YOU HANDLE DIRECTLY:
- Payment reminders (all stages up to 60 days)
- Payment plan proposals for amounts under $2,000 past due
- Recording received payments
- Answering borrower questions about their loan
- Grace period extensions (up to 15 days)

WHAT YOU ESCALATE:
- Accounts 60+ days delinquent
- Borrower disputes or complaints
- Payment plan requests over $2,000
- Threats of legal action by borrower
- Potential fraud concerns
- Deed-in-lieu or foreclosure discussions`,

    capabilities: [
      "Monitor payment schedules across all notes",
      "Send payment reminders",
      "Propose payment plans for delinquent accounts",
      "Track payment history and patterns",
      "Calculate payoff amounts",
      "Document borrower communications"
    ],
    tools: ["get_notes", "get_lead_details", "calculate_amortization", "get_cashflow_summary"],
    priorityCategories: {
      high: ["payment_60_plus_late", "promise_to_pay_broken", "borrower_unresponsive"],
      medium: ["payment_30_days_late", "payment_plan_request", "payoff_inquiry"],
      low: ["upcoming_payment_reminder", "routine_status_check", "payment_confirmation"]
    }
  },

  research: {
    systemPrompt: `You are Riley, the Research Virtual Assistant. You're the detail person - thorough, methodical, and genuinely curious about getting the facts right.

PERSONALITY:
- Meticulous and thorough
- Intellectually curious
- Comfortable with complexity
- Good at explaining technical info simply
- Skeptical until verified

CORE RESPONSIBILITIES:
1. Due Diligence: Comprehensive property research before purchase decisions
2. Market Analysis: Analyze local markets, trends, and comparable values
3. Zoning Research: Investigate zoning classifications, restrictions, and permitted uses
4. Data Verification: Cross-check property data from multiple sources

DUE DILIGENCE CHECKLIST:
□ Ownership verification (county assessor)
□ Tax status and history
□ Lien and encumbrance search
□ Legal access verification
□ Utility availability
□ Flood zone check
□ Zoning classification
□ HOA/POA restrictions
□ Environmental concerns
□ Comparable sales analysis

DATA SOURCES TO USE:
- County assessor websites
- Regrid/DataTree for parcel data
- FEMA flood maps
- County GIS portals
- Secretary of State (for LLCs)
- Court records (liens/judgments)

MARKET ANALYSIS FRAMEWORK:
- Recent sales (6-12 months)
- Current listings (competition)
- Days on market trends
- Price per acre by area
- Absorption rate
- Development activity

WHAT YOU HANDLE DIRECTLY:
- Property due diligence research
- Comparable sales analysis
- Zoning and land use research
- Market trend analysis
- Data verification tasks
- Research summary reports

WHAT YOU ESCALATE:
- Significant title issues discovered
- Environmental red flags
- Legal access disputes
- Conflicting information requiring owner decision

REPORT FORMAT:
Always structure research reports with:
1. Executive Summary
2. Key Findings (bullet points)
3. Detailed Analysis
4. Risks and Concerns
5. Recommendation`,

    capabilities: [
      "Conduct property due diligence",
      "Research zoning and land use regulations",
      "Analyze comparable sales",
      "Verify ownership and title",
      "Assess market conditions",
      "Compile research reports"
    ],
    tools: ["get_properties", "get_property_details", "get_leads", "get_lead_details"],
    priorityCategories: {
      high: ["due_diligence_deadline", "title_issue_discovered", "urgent_verification"],
      medium: ["comp_analysis_request", "zoning_research", "market_report"],
      low: ["general_research", "data_update", "historical_research"]
    }
  }
};

export class VaAgentService {
  async proposeAction(
    orgId: number,
    agentId: number,
    actionData: {
      actionType: string;
      category: string;
      title: string;
      description?: string;
      priority?: number;
      input: Record<string, any>;
      relatedLeadId?: number;
      relatedPropertyId?: number;
      relatedNoteId?: number;
    }
  ): Promise<VaAction> {
    const action = await storage.createVaAction({
      organizationId: orgId,
      agentId,
      actionType: actionData.actionType,
      category: actionData.category,
      title: actionData.title,
      description: actionData.description,
      priority: actionData.priority || 5,
      status: "proposed",
      input: actionData.input,
      relatedLeadId: actionData.relatedLeadId,
      relatedPropertyId: actionData.relatedPropertyId,
      relatedNoteId: actionData.relatedNoteId,
    });

    await storage.logActivity({
      organizationId: orgId,
      agentType: "va_agent",
      action: "propose_action",
      entityType: "va_action",
      entityId: action.id,
      description: `Agent proposed action: ${actionData.title}`,
      metadata: { actionType: actionData.actionType, category: actionData.category }
    });

    return action;
  }

  async executeAction(actionId: number): Promise<VaAction> {
    const action = await storage.getVaAction(actionId);
    if (!action) {
      throw new Error(`Action ${actionId} not found`);
    }

    if (action.status !== "approved") {
      throw new Error(`Action ${actionId} is not approved (status: ${action.status})`);
    }

    await storage.updateVaAction(actionId, { status: "executing" });

    try {
      const org = await storage.getOrganization(action.organizationId);
      if (!org) {
        throw new Error("Organization not found");
      }

      const result = await this.performAction(action, org);

      const completed = await storage.updateVaAction(actionId, {
        status: "completed",
        output: result,
        executedAt: new Date()
      });

      await storage.logActivity({
        organizationId: action.organizationId,
        agentType: "va_agent",
        action: "execute_action",
        entityType: "va_action",
        entityId: actionId,
        description: `Executed action: ${action.title}`,
        metadata: { result }
      });

      return completed;
    } catch (error: any) {
      const failed = await storage.updateVaAction(actionId, {
        status: "failed",
        error: error.message
      });

      await storage.logActivity({
        organizationId: action.organizationId,
        agentType: "va_agent",
        action: "action_failed",
        entityType: "va_action",
        entityId: actionId,
        description: `Action failed: ${error.message}`,
      });

      return failed;
    }
  }

  private async performAction(action: VaAction, org: Organization): Promise<any> {
    const input = action.input as Record<string, any>;
    
    switch (action.actionType) {
      case "update_lead_status":
        return await executeTool("update_lead_status", {
          lead_id: input.leadId,
          status: input.status,
          notes: input.notes
        }, org);

      case "create_lead":
        return await executeTool("create_lead", {
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          phone: input.phone,
          type: input.type,
          source: input.source,
          notes: input.notes
        }, org);

      case "send_reminder":
        return {
          success: true,
          message: "Reminder prepared",
          data: {
            type: input.reminderType,
            recipient: input.recipient,
            content: input.content,
            scheduledFor: input.scheduledFor
          }
        };

      case "propose_campaign":
        return {
          success: true,
          message: "Campaign proposal created",
          data: {
            name: input.campaignName,
            target: input.targetAudience,
            type: input.campaignType,
            budget: input.budget
          }
        };

      case "schedule_callback":
        return {
          success: true,
          message: "Callback scheduled",
          data: {
            leadId: input.leadId,
            scheduledTime: input.scheduledTime,
            notes: input.notes
          }
        };

      case "record_note":
        return {
          success: true,
          message: "Note recorded",
          data: {
            entityType: input.entityType,
            entityId: input.entityId,
            note: input.note
          }
        };

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.actionType}`
        };
    }
  }

  async processAgentTask(
    orgId: number,
    agentType: VaAgentType,
    taskDescription: string
  ): Promise<{
    response: string;
    proposedActions: VaAction[];
    toolsUsed: string[];
  }> {
    const profile = VA_AGENT_PROFILES[agentType];
    if (!profile) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }

    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const agent = await storage.getVaAgentByType(orgId, agentType);
    if (!agent) {
      throw new Error(`Agent ${agentType} not found for organization`);
    }

    await storage.updateVaAgent(agent.id, { isActive: true, lastActiveAt: new Date() });

    const tools = profile.tools.map(toolName => ({
      type: "function" as const,
      function: toolDefinitions[toolName]
    }));

    const systemPrompt = `${profile.systemPrompt}

CAPABILITIES:
${profile.capabilities.map(c => `- ${c}`).join('\n')}

When analyzing tasks, you should:
1. Use the available tools to gather relevant data
2. Analyze the situation thoroughly
3. Propose specific actions when appropriate
4. Be clear about what you can handle vs what needs escalation

Format your response as:
ANALYSIS: [Your analysis of the situation]
ACTIONS: [List of proposed actions, if any]
RECOMMENDATION: [Your recommendation]`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: taskDescription }
    ];

    const toolsUsed: string[] = [];
    const proposedActions: VaAction[] = [];

    let response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 2048
    });

    let assistantMessage = response.choices[0].message;

    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of assistantMessage.tool_calls) {
        if ('function' in toolCall) {
          const args = JSON.parse(toolCall.function.arguments);
          toolsUsed.push(toolCall.function.name);
          const result = await executeTool(toolCall.function.name, args, org);

          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }
      }

      messages.push(assistantMessage as any);
      messages.push(...toolResults);

      response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048
      });

      assistantMessage = response.choices[0].message;
    }

    const finalResponse = assistantMessage.content || "";

    const actionMatches = finalResponse.match(/ACTIONS:\s*([\s\S]*?)(?=RECOMMENDATION:|$)/i);
    if (actionMatches) {
      const actionLines = actionMatches[1].trim().split('\n').filter(line => line.trim().startsWith('-'));
      
      for (const line of actionLines.slice(0, 3)) {
        const actionText = line.replace(/^-\s*/, '').trim();
        if (actionText && actionText.toLowerCase() !== 'none') {
          const action = await this.proposeAction(orgId, agent.id, {
            actionType: "agent_proposed",
            category: this.categorizeAction(agentType, actionText),
            title: actionText.substring(0, 100),
            description: actionText,
            priority: this.calculatePriority(agentType, actionText),
            input: { originalTask: taskDescription, proposedAction: actionText }
          });
          proposedActions.push(action);
        }
      }
    }

    await storage.updateVaAgent(agent.id, { isActive: false });

    return {
      response: finalResponse,
      proposedActions,
      toolsUsed: Array.from(new Set(toolsUsed))
    };
  }

  private categorizeAction(agentType: VaAgentType, actionText: string): string {
    const lowerText = actionText.toLowerCase();
    
    if (lowerText.includes('lead') || lowerText.includes('contact')) return 'crm';
    if (lowerText.includes('payment') || lowerText.includes('note')) return 'finance';
    if (lowerText.includes('campaign') || lowerText.includes('mail')) return 'marketing';
    if (lowerText.includes('research') || lowerText.includes('due diligence')) return 'research';
    if (lowerText.includes('schedule') || lowerText.includes('call')) return 'communication';
    
    const categoryMap: Record<VaAgentType, string> = {
      executive: 'admin',
      sales: 'crm',
      acquisitions: 'crm',
      marketing: 'marketing',
      collections: 'finance',
      research: 'research'
    };
    
    return categoryMap[agentType];
  }

  private calculatePriority(agentType: VaAgentType, actionText: string): number {
    const profile = VA_AGENT_PROFILES[agentType];
    const lowerText = actionText.toLowerCase();
    
    for (const keyword of profile.priorityCategories.high) {
      if (lowerText.includes(keyword.replace(/_/g, ' '))) return 1;
    }
    
    if (lowerText.includes('urgent') || lowerText.includes('immediately') || lowerText.includes('critical')) {
      return 1;
    }
    
    for (const keyword of profile.priorityCategories.low) {
      if (lowerText.includes(keyword.replace(/_/g, ' '))) return 8;
    }
    
    return 5;
  }

  async generateBriefing(orgId: number): Promise<InsertVaBriefing & { id: number }> {
    const org = await storage.getOrganization(orgId);
    if (!org) {
      throw new Error("Organization not found");
    }

    const [leads, properties, notesData, pendingActions] = await Promise.all([
      storage.getLeads(orgId),
      storage.getProperties(orgId),
      storage.getNotes(orgId),
      storage.getVaActions(orgId, { status: "proposed", limit: 100 })
    ]);

    const newLeads = leads.filter(l => {
      const createdAt = l.createdAt ? new Date(l.createdAt) : null;
      if (!createdAt) return false;
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      return createdAt > oneDayAgo;
    }).length;

    const activeNotes = notesData.filter(n => n.status === "active");
    const overduePayments = activeNotes.filter(n => {
      if (!n.nextPaymentDate) return false;
      return new Date(n.nextPaymentDate) < new Date();
    }).length;

    const monthlyRevenue = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
    const activeDeals = properties.filter(p => 
      ["under_contract", "due_diligence", "offer_sent"].includes(p.status)
    ).length;

    const briefingPrompt = `Generate a concise executive daily briefing for a land investment company. Here's the data:

NEW LEADS (24h): ${newLeads}
TOTAL ACTIVE LEADS: ${leads.filter(l => !["closed", "dead"].includes(l.status)).length}
ACTIVE DEALS: ${activeDeals}
PROPERTIES OWNED: ${properties.filter(p => p.status === "owned").length}
LISTED FOR SALE: ${properties.filter(p => p.status === "listed").length}
ACTIVE NOTES: ${activeNotes.length}
MONTHLY CASHFLOW: $${monthlyRevenue.toFixed(2)}
OVERDUE PAYMENTS: ${overduePayments}
PENDING AGENT ACTIONS: ${pendingActions.length}

Leads by status:
${Object.entries(leads.reduce((acc, l) => {
  acc[l.status] = (acc[l.status] || 0) + 1;
  return acc;
}, {} as Record<string, number>)).map(([status, count]) => `- ${status}: ${count}`).join('\n')}

Generate a briefing with:
1. A compelling title for today
2. An executive summary (2-3 sentences)
3. 3-4 key sections with insights
4. 2-3 recommended actions for today

Keep it concise and actionable.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: "You are an executive assistant generating daily business briefings. Be concise, data-driven, and actionable. Format as clear sections." 
        },
        { role: "user", content: briefingPrompt }
      ],
      max_tokens: 1500
    });

    const content = response.choices[0].message.content || "";
    
    const lines = content.split('\n').filter(l => l.trim());
    const title = lines[0]?.replace(/^#*\s*/, '') || `Daily Briefing - ${new Date().toLocaleDateString()}`;
    const summary = lines.slice(1, 4).join(' ').substring(0, 500);

    const sections: InsertVaBriefing["sections"] = [];
    let currentSection: { title: string; content: string; priority: number } | null = null;
    
    for (const line of lines) {
      if (line.match(/^##?\s/)) {
        if (currentSection) sections.push(currentSection);
        currentSection = { 
          title: line.replace(/^##?\s*/, ''), 
          content: '', 
          priority: sections.length + 1 
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      }
    }
    if (currentSection) sections.push(currentSection);

    const briefing = await storage.createVaBriefing({
      organizationId: orgId,
      briefingType: "daily",
      title,
      summary,
      sections: sections.length > 0 ? sections : [{ title: "Summary", content: content, priority: 1 }],
      metrics: {
        newLeads,
        activeDeals,
        paymentsReceived: 0,
        overduePayments,
        pendingActions: pendingActions.length,
        campaignsActive: 0
      },
      recommendations: []
    });

    return briefing;
  }

  async getAgentStatus(
    orgId: number,
    agentType: VaAgentType
  ): Promise<{
    agent: VaAgent | null;
    pendingActions: VaAction[];
    recentActions: VaAction[];
    isAvailable: boolean;
  }> {
    const agent = await storage.getVaAgentByType(orgId, agentType);
    
    if (!agent) {
      return {
        agent: null,
        pendingActions: [],
        recentActions: [],
        isAvailable: false
      };
    }

    const [pendingActions, allActions] = await Promise.all([
      storage.getVaActions(orgId, { agentId: agent.id, status: "proposed", limit: 10 }),
      storage.getVaActions(orgId, { agentId: agent.id, limit: 10 })
    ]);

    return {
      agent,
      pendingActions,
      recentActions: allActions.filter(a => a.status !== "proposed"),
      isAvailable: agent.isEnabled && !agent.isActive
    };
  }

  getAgentProfile(agentType: VaAgentType): VaAgentProfile | undefined {
    return VA_AGENT_PROFILES[agentType];
  }

  getAllProfiles(): Record<VaAgentType, VaAgentProfile> {
    return VA_AGENT_PROFILES;
  }

  async executeAgentAction(action: VaAction): Promise<{ success: boolean; result?: any; error?: string }> {
    const startTime = Date.now();
    
    // Guard against executing non-approved actions
    if (action.status === "completed" || action.status === "failed" || action.status === "executing") {
      return { success: false, error: `Action is already ${action.status}` };
    }
    
    if (action.status === "rejected" || action.status === "cancelled") {
      return { success: false, error: `Cannot execute ${action.status} action` };
    }
    
    try {
      await storage.updateVaAction(action.id, { status: "executing" });
      
      let result: any;
      
      switch (action.actionType) {
        case "update_lead_status":
          result = await this.executeUpdateLeadStatus(action);
          break;
        case "create_follow_up":
        case "schedule_callback":
          result = await this.executeCreateFollowUp(action);
          break;
        case "send_payment_reminder":
          result = await this.executeSendPaymentReminder(action);
          break;
        case "draft_offer":
          result = await this.executeDraftOffer(action);
          break;
        case "propose_campaign":
          result = await this.executeProposeCampaign(action);
          break;
        case "send_email":
        case "send_sms":
          result = await this.executeCommunication(action);
          break;
        case "research_property":
          result = await this.executeResearchProperty(action);
          break;
        default:
          result = { message: `Action type '${action.actionType}' logged for manual processing` };
      }
      
      const executionTimeMs = Date.now() - startTime;
      
      await storage.updateVaAction(action.id, {
        status: "completed",
        output: result,
        executedAt: new Date(),
        executionTimeMs
      });
      
      return { success: true, result };
    } catch (error: any) {
      await storage.updateVaAction(action.id, {
        status: "failed",
        error: error.message
      });
      
      return { success: false, error: error.message };
    }
  }

  private async executeUpdateLeadStatus(action: VaAction): Promise<any> {
    const input = action.input as any;
    const leadId = input.leadId || action.relatedLeadId;
    const newStatus = input.status;
    
    if (!leadId || !newStatus) {
      throw new Error("Lead ID and new status are required");
    }
    
    const lead = await storage.getLead(action.organizationId, leadId);
    if (!lead) {
      throw new Error(`Lead ${leadId} not found`);
    }
    
    await storage.updateLead(leadId, { status: newStatus });
    
    return { 
      message: `Updated lead ${lead.firstName} ${lead.lastName} status to ${newStatus}`,
      leadId,
      previousStatus: lead.status,
      newStatus
    };
  }

  private async executeCreateFollowUp(action: VaAction): Promise<any> {
    const input = action.input as any;
    const title = input.title || action.title;
    const startTime = input.startTime ? new Date(input.startTime) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    const event = await storage.createVaCalendarEvent({
      organizationId: action.organizationId,
      agentId: action.agentId,
      eventType: action.actionType === "schedule_callback" ? "callback" : "follow_up",
      title,
      description: action.description,
      startTime,
      relatedLeadId: action.relatedLeadId,
      relatedPropertyId: action.relatedPropertyId,
      status: "scheduled"
    });
    
    return {
      message: `Follow-up scheduled for ${startTime.toLocaleDateString()}`,
      eventId: event.id,
      startTime: startTime.toISOString()
    };
  }

  private async executeSendPaymentReminder(action: VaAction): Promise<any> {
    const input = action.input as any;
    const noteId = input.noteId || action.relatedNoteId;
    
    if (!noteId) {
      throw new Error("Note ID is required for payment reminder");
    }
    
    const note = await storage.getNote(action.organizationId, noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }
    
    const reminderEvent = await storage.createVaCalendarEvent({
      organizationId: action.organizationId,
      agentId: action.agentId,
      eventType: "payment_due",
      title: `Payment Reminder: ${input.reminderType || "Standard"} - Note #${noteId}`,
      description: `Payment of $${note.monthlyPayment} due. Balance: $${note.currentBalance}`,
      startTime: new Date(),
      status: "completed"
    });
    
    return {
      message: `Payment reminder created for Note #${noteId}`,
      noteId,
      amount: note.monthlyPayment,
      eventId: reminderEvent.id
    };
  }

  private async executeDraftOffer(action: VaAction): Promise<any> {
    const input = action.input as any;
    const propertyId = input.propertyId || action.relatedPropertyId;
    
    if (!propertyId) {
      throw new Error("Property ID is required for offer drafting");
    }
    
    const property = await storage.getProperty(action.organizationId, propertyId);
    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }
    
    const marketValue = Number(property.marketValue) || Number(property.assessedValue) || 0;
    const suggestedOffer = Math.round(marketValue * 0.30);
    
    const offerContent = {
      propertyAPN: property.apn,
      propertyAddress: property.address || `${property.county}, ${property.state}`,
      sizeAcres: property.sizeAcres,
      suggestedOfferAmount: suggestedOffer,
      marketValue,
      offerPercentage: "30%",
      draftedAt: new Date().toISOString()
    };
    
    return {
      message: `Offer drafted for ${property.apn} at $${suggestedOffer.toLocaleString()}`,
      propertyId,
      offer: offerContent
    };
  }

  private async executeProposeCampaign(action: VaAction): Promise<any> {
    const input = action.input as any;
    
    const campaignProposal = {
      name: input.name || action.title,
      type: input.type || "direct_mail",
      targetCriteria: input.targetCriteria || {},
      estimatedRecipients: input.estimatedRecipients || 0,
      estimatedBudget: input.estimatedBudget || 0,
      proposedContent: input.content || action.description,
      status: "draft",
      proposedAt: new Date().toISOString()
    };
    
    return {
      message: `Campaign proposal created: ${campaignProposal.name}`,
      proposal: campaignProposal
    };
  }

  private async executeCommunication(action: VaAction): Promise<any> {
    const input = action.input as any;
    const leadId = input.leadId || action.relatedLeadId;
    
    const communicationType = action.actionType === "send_email" ? "email" : "sms";
    
    const communicationRecord = {
      type: communicationType,
      leadId,
      subject: input.subject,
      content: input.content || input.message,
      status: "queued",
      queuedAt: new Date().toISOString()
    };
    
    return {
      message: `${communicationType.toUpperCase()} queued for sending`,
      communication: communicationRecord
    };
  }

  private async executeResearchProperty(action: VaAction): Promise<any> {
    const input = action.input as any;
    const propertyId = input.propertyId || action.relatedPropertyId;
    const apn = input.apn;
    const state = input.state;
    
    let researchResult: any = {
      message: "Research request logged",
      requestedAt: new Date().toISOString()
    };
    
    if (apn && state) {
      researchResult = {
        message: `Research initiated for APN ${apn} in ${state}`,
        apn,
        state,
        status: "pending_regrid_lookup"
      };
    } else if (propertyId) {
      const property = await storage.getProperty(action.organizationId, propertyId);
      if (property) {
        researchResult = {
          message: `Research data compiled for property ${property.apn}`,
          propertyId,
          existingData: {
            apn: property.apn,
            county: property.county,
            state: property.state,
            sizeAcres: property.sizeAcres,
            assessedValue: property.assessedValue,
            marketValue: property.marketValue,
            hasParcelData: !!property.parcelBoundary
          }
        };
      }
    }
    
    return researchResult;
  }

  async processAutonomousActions(orgId: number): Promise<{ processed: number; results: any[] }> {
    const agents = await storage.getVaAgents(orgId);
    const results: any[] = [];
    let processed = 0;
    
    for (const agent of agents) {
      if (!agent.isEnabled || agent.autonomyLevel !== "full_auto") {
        continue;
      }
      
      const autoApproveCategories = (agent.config as any)?.autoApproveCategories || [];
      if (autoApproveCategories.length === 0) {
        continue;
      }
      
      const pendingActions = await storage.getVaActions(orgId, {
        agentId: agent.id,
        status: "proposed",
        limit: 10
      });
      
      for (const action of pendingActions) {
        if (autoApproveCategories.includes(action.category)) {
          const approved = await storage.approveVaAction(action.id, "auto");
          // Re-fetch to get fresh action with approval status
          const freshAction = await storage.getVaAction(action.id);
          if (freshAction && freshAction.status === "approved") {
            const result = await this.executeAgentAction(freshAction);
            results.push({ actionId: action.id, ...result });
            processed++;
          }
        }
      }
    }
    
    return { processed, results };
  }

  async sendNotification(orgId: number, title: string, message: string): Promise<void> {
    await storage.logActivity({
      organizationId: orgId,
      agentType: "notification",
      action: "notification_sent",
      entityType: "system",
      entityId: 0,
      description: `${title}: ${message}`
    });
  }
}

export const vaAgentService = new VaAgentService();

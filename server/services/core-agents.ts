import { storage } from "../storage";
import { dataSourceBroker, type LookupCategory } from "./data-source-broker";
import OpenAI from "openai";

const openai = new OpenAI();

export type CoreAgentType = "research" | "deals" | "communications" | "operations";

interface AgentContext {
  organizationId: number;
  userId?: string;
  relatedLeadId?: number;
  relatedPropertyId?: number;
  relatedDealId?: number;
}

interface AgentTaskInput {
  action: string;
  parameters: Record<string, any>;
  context: AgentContext;
}

interface AgentTaskResult {
  success: boolean;
  data?: any;
  message?: string;
  actions?: AgentAction[];
  requiresApproval?: boolean;
}

interface AgentAction {
  type: string;
  description: string;
  parameters: Record<string, any>;
  executed: boolean;
  result?: any;
}

abstract class CoreAgent {
  abstract type: CoreAgentType;
  abstract name: string;
  abstract description: string;
  abstract capabilities: string[];

  protected async getSystemPrompt(): Promise<string> {
    return `You are ${this.name}, an AI agent for AcreOS land investment platform.
Your capabilities include: ${this.capabilities.join(", ")}.
Always be helpful, accurate, and focused on land investment operations.
When asked to perform actions, analyze the request and determine the best approach.`;
  }

  protected async callOpenAI(prompt: string, systemPrompt?: string): Promise<string> {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt || await this.getSystemPrompt() },
        { role: "user", content: prompt },
      ],
      max_tokens: 2000,
    });
    return response.choices[0]?.message?.content || "";
  }

  abstract execute(input: AgentTaskInput): Promise<AgentTaskResult>;
}

export class ResearchIntelligenceAgent extends CoreAgent {
  type: CoreAgentType = "research";
  name = "Research & Intelligence Agent";
  description = "Handles property research, due diligence, environmental analysis, and data enrichment";
  capabilities = [
    "Property due diligence",
    "Environmental risk assessment (flood, wetlands, soil, EPA sites)",
    "Market data analysis",
    "Parcel data lookup",
    "Tax assessment research",
    "Zoning verification",
    "Investment scoring",
    "Comparable sales analysis",
  ];

  async execute(input: AgentTaskInput): Promise<AgentTaskResult> {
    const { action, parameters, context } = input;

    switch (action) {
      case "run_due_diligence":
        return this.runDueDiligence(parameters.propertyId, context);
      
      case "lookup_environmental":
        return this.lookupEnvironmental(parameters, context);
      
      case "enrich_property":
        return this.enrichProperty(parameters.propertyId, context);
      
      case "analyze_investment":
        return this.analyzeInvestment(parameters, context);
      
      case "research_query":
        return this.handleResearchQuery(parameters.query, context);
      
      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  private async runDueDiligence(propertyId: number, context: AgentContext): Promise<AgentTaskResult> {
    const property = await storage.getProperty(context.organizationId, propertyId);
    if (!property) {
      return { success: false, message: "Property not found" };
    }

    const lat = property.latitude ? parseFloat(property.latitude) : null;
    const lng = property.longitude ? parseFloat(property.longitude) : null;

    if (!lat || !lng) {
      return { success: false, message: "Property missing coordinates" };
    }

    const categories: LookupCategory[] = ["flood_zone", "wetlands", "soil", "environmental"];
    const results: Record<string, any> = {};
    const actions: AgentAction[] = [];

    for (const category of categories) {
      try {
        const result = await dataSourceBroker.lookup(category, {
          latitude: lat,
          longitude: lng,
          state: property.state || undefined,
          county: property.county || undefined,
        });

        results[category] = result;
        actions.push({
          type: "data_lookup",
          description: `Retrieved ${category} data from ${result.source.title}`,
          parameters: { category, latitude: lat, longitude: lng },
          executed: true,
          result: result.success ? "success" : "failed",
        });
      } catch (error: any) {
        results[category] = { success: false, error: error.message };
      }
    }

    const riskAssessment = this.assessRisks(results);

    return {
      success: true,
      data: {
        propertyId,
        lookupResults: results,
        riskAssessment,
        timestamp: new Date().toISOString(),
      },
      actions,
    };
  }

  private assessRisks(results: Record<string, any>): { level: string; factors: string[] } {
    const factors: string[] = [];
    let riskScore = 0;

    if (results.flood_zone?.data?.riskLevel === "high") {
      factors.push("High flood risk zone");
      riskScore += 3;
    } else if (results.flood_zone?.data?.riskLevel === "medium") {
      factors.push("Moderate flood risk");
      riskScore += 1;
    }

    if (results.wetlands?.data?.hasWetlands) {
      factors.push("Wetlands present on property");
      riskScore += 2;
    }

    if (results.environmental?.data?.riskLevel === "high") {
      factors.push("EPA sites nearby");
      riskScore += 2;
    }

    const level = riskScore >= 4 ? "high" : riskScore >= 2 ? "medium" : "low";
    return { level, factors: factors.length > 0 ? factors : ["No significant risk factors identified"] };
  }

  private async lookupEnvironmental(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { latitude, longitude, categories } = params;
    
    if (!latitude || !longitude) {
      return { success: false, message: "Latitude and longitude required" };
    }

    const lookupCategories: LookupCategory[] = categories || ["flood_zone", "wetlands", "soil", "environmental"];
    const results: Record<string, any> = {};

    for (const category of lookupCategories) {
      try {
        results[category] = await dataSourceBroker.lookup(category, { latitude, longitude });
      } catch (error: any) {
        results[category] = { success: false, error: error.message };
      }
    }

    return { success: true, data: results };
  }

  private async enrichProperty(propertyId: number, context: AgentContext): Promise<AgentTaskResult> {
    return this.runDueDiligence(propertyId, context);
  }

  private async analyzeInvestment(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { propertyId, purchasePrice, targetRoi } = params;
    
    const property = await storage.getProperty(context.organizationId, propertyId);
    if (!property) {
      return { success: false, message: "Property not found" };
    }

    const dueDiligence = await this.runDueDiligence(propertyId, context);
    
    const prompt = `Analyze this land investment opportunity:
Property: ${property.address || "Unknown"}, ${property.city}, ${property.state}
Acreage: ${(property as any).acreage || "Unknown"}
Purchase Price: $${purchasePrice || "Unknown"}
Target ROI: ${targetRoi || "Not specified"}%

Environmental Assessment:
${JSON.stringify(dueDiligence.data?.riskAssessment, null, 2)}

Provide a brief investment analysis including:
1. Risk assessment summary
2. Potential concerns
3. Recommended next steps
4. Overall recommendation (buy/hold/pass)`;

    const analysis = await this.callOpenAI(prompt);

    return {
      success: true,
      data: {
        propertyId,
        analysis,
        dueDiligenceData: dueDiligence.data,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async handleResearchQuery(query: string, context: AgentContext): Promise<AgentTaskResult> {
    const prompt = `As a land investment research expert, answer this query:
${query}

Provide practical, actionable information relevant to land investing.`;

    const response = await this.callOpenAI(prompt);
    return { success: true, data: { query, response } };
  }
}

export class DealsAcquisitionAgent extends CoreAgent {
  type: CoreAgentType = "deals";
  name = "Deals & Acquisition Agent";
  description = "Handles deal analysis, offer generation, valuations, and acquisition workflows";
  capabilities = [
    "Offer letter generation",
    "Deal structuring",
    "Comparable sales analysis",
    "Property valuation",
    "Seller financing calculations",
    "Negotiation strategy",
    "Contract review assistance",
    "Profit projection",
  ];

  async execute(input: AgentTaskInput): Promise<AgentTaskResult> {
    const { action, parameters, context } = input;

    switch (action) {
      case "generate_offer":
        return this.generateOffer(parameters, context);
      
      case "analyze_deal":
        return this.analyzeDeal(parameters, context);
      
      case "calculate_financing":
        return this.calculateFinancing(parameters, context);
      
      case "suggest_strategy":
        return this.suggestStrategy(parameters, context);
      
      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  private async generateOffer(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { leadId, propertyId, offerPrice, terms } = params;

    const lead = leadId ? await storage.getLead(context.organizationId, leadId) : null;
    const property = propertyId ? await storage.getProperty(context.organizationId, propertyId) : null;

    const prompt = `Generate a professional land purchase offer letter with these details:
Buyer: [Organization Name]
Seller: ${lead ? `${lead.firstName} ${lead.lastName}` : "[Seller Name]"}
Property: ${property?.address || "[Property Address]"}, ${property?.city || ""}, ${property?.state || ""}
Offer Price: $${offerPrice || "[Offer Price]"}
Terms: ${terms || "Cash purchase, 30-day close"}

Create a professional, legally-minded (but not legal advice) offer letter that:
1. Is warm but professional in tone
2. Clearly states the offer terms
3. Includes standard contingencies
4. Has a response deadline`;

    const offerLetter = await this.callOpenAI(prompt);

    return {
      success: true,
      data: {
        offerLetter,
        offerPrice,
        leadId,
        propertyId,
        generatedAt: new Date().toISOString(),
      },
      requiresApproval: true,
    };
  }

  private async analyzeDeal(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { dealId, propertyId, purchasePrice, estimatedValue, repairCosts } = params;

    const prompt = `Analyze this land deal:
Purchase Price: $${purchasePrice || 0}
Estimated Market Value: $${estimatedValue || 0}
Additional Costs: $${repairCosts || 0}

Calculate and provide:
1. Gross profit margin
2. ROI percentage
3. Deal rating (A, B, C, D)
4. Key considerations
5. Recommendation`;

    const analysis = await this.callOpenAI(prompt);

    const grossProfit = (estimatedValue || 0) - (purchasePrice || 0) - (repairCosts || 0);
    const roi = purchasePrice > 0 ? ((grossProfit / purchasePrice) * 100).toFixed(1) : 0;

    return {
      success: true,
      data: {
        analysis,
        metrics: {
          grossProfit,
          roi: `${roi}%`,
          purchasePrice,
          estimatedValue,
        },
      },
    };
  }

  private async calculateFinancing(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { principal, interestRate, termMonths, downPayment } = params;

    const loanAmount = principal - (downPayment || 0);
    const monthlyRate = (interestRate || 10) / 100 / 12;
    const payment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                   (Math.pow(1 + monthlyRate, termMonths) - 1);
    const totalPayments = payment * termMonths;
    const totalInterest = totalPayments - loanAmount;

    return {
      success: true,
      data: {
        loanAmount,
        monthlyPayment: payment.toFixed(2),
        totalPayments: totalPayments.toFixed(2),
        totalInterest: totalInterest.toFixed(2),
        termMonths,
        interestRate,
      },
    };
  }

  private async suggestStrategy(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { scenario, constraints } = params;

    const prompt = `As a land acquisition strategist, suggest the best approach for:
Scenario: ${scenario}
Constraints: ${constraints || "None specified"}

Provide:
1. Recommended acquisition strategy
2. Negotiation tactics
3. Risk mitigation steps
4. Timeline estimate`;

    const strategy = await this.callOpenAI(prompt);
    return { success: true, data: { strategy } };
  }
}

export class CommunicationsAgent extends CoreAgent {
  type: CoreAgentType = "communications";
  name = "Communications Agent";
  description = "Handles all lead communication, nurturing sequences, and marketing content";
  capabilities = [
    "Lead nurturing sequences",
    "Email composition",
    "SMS messaging",
    "Marketing content creation",
    "Response handling",
    "Follow-up scheduling",
    "Personalized outreach",
    "Campaign content generation",
  ];

  async execute(input: AgentTaskInput): Promise<AgentTaskResult> {
    const { action, parameters, context } = input;

    switch (action) {
      case "compose_email":
        return this.composeEmail(parameters, context);
      
      case "compose_sms":
        return this.composeSms(parameters, context);
      
      case "nurture_lead":
        return this.nurtureLead(parameters, context);
      
      case "generate_campaign_content":
        return this.generateCampaignContent(parameters, context);
      
      case "draft_response":
        return this.draftResponse(parameters, context);
      
      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  private async composeEmail(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { leadId, purpose, tone, customDetails } = params;
    
    const lead = leadId ? await storage.getLead(context.organizationId, leadId) : null;

    const prompt = `Compose a professional email for land acquisition:
Recipient: ${lead ? `${lead.firstName} ${lead.lastName}` : "Landowner"}
Purpose: ${purpose || "Initial outreach"}
Tone: ${tone || "Professional and friendly"}
Additional context: ${customDetails || "None"}

Write a compelling email that:
1. Has a strong subject line
2. Is personalized and warm
3. Clearly states the purpose
4. Has a clear call to action
5. Is concise (under 200 words)`;

    const email = await this.callOpenAI(prompt);
    
    const subjectMatch = email.match(/Subject:?\s*(.+)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : "Regarding Your Property";
    const body = email.replace(/Subject:?\s*.+\n?/i, "").trim();

    return {
      success: true,
      data: { subject, body, leadId },
      requiresApproval: true,
    };
  }

  private async composeSms(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { leadId, purpose } = params;
    
    const lead = leadId ? await storage.getLead(context.organizationId, leadId) : null;

    const prompt = `Write a brief SMS message for land acquisition:
Recipient: ${lead ? lead.firstName : "Landowner"}
Purpose: ${purpose || "Follow-up"}

Requirements:
- Under 160 characters
- Professional but friendly
- Clear call to action`;

    const message = await this.callOpenAI(prompt);

    return {
      success: true,
      data: { message: message.slice(0, 160), leadId },
      requiresApproval: true,
    };
  }

  private async nurtureLead(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { leadId, stage, previousInteractions } = params;
    
    const lead = leadId ? await storage.getLead(context.organizationId, leadId) : null;
    if (!lead) {
      return { success: false, message: "Lead not found" };
    }

    const prompt = `Plan the next nurturing touchpoint for this lead:
Lead: ${lead.firstName} ${lead.lastName}
Current Stage: ${stage || lead.status}
Previous Interactions: ${previousInteractions || "Unknown"}

Suggest:
1. Best channel (email/SMS/call)
2. Timing
3. Message approach
4. Goal for this touchpoint`;

    const plan = await this.callOpenAI(prompt);

    return {
      success: true,
      data: { leadId, nurturePlan: plan },
    };
  }

  private async generateCampaignContent(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { campaignType, targetAudience, goals } = params;

    const prompt = `Generate marketing content for a land acquisition campaign:
Campaign Type: ${campaignType || "Direct mail"}
Target Audience: ${targetAudience || "Rural landowners"}
Goals: ${goals || "Generate motivated seller leads"}

Create:
1. Headline
2. Main message (2-3 paragraphs)
3. Call to action
4. Subject line (if email)`;

    const content = await this.callOpenAI(prompt);

    return {
      success: true,
      data: { content, campaignType },
      requiresApproval: true,
    };
  }

  private async draftResponse(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { incomingMessage, leadId, channel } = params;

    const lead = leadId ? await storage.getLead(context.organizationId, leadId) : null;

    const prompt = `Draft a response to this incoming ${channel || "message"}:
"${incomingMessage}"

Context: This is from ${lead ? `${lead.firstName} ${lead.lastName}` : "a landowner"} regarding potential property sale.

Write a helpful, professional response that:
1. Acknowledges their message
2. Answers any questions
3. Moves the conversation forward`;

    const response = await this.callOpenAI(prompt);

    return {
      success: true,
      data: { response, leadId, channel },
      requiresApproval: true,
    };
  }
}

export class OperationsAgent extends CoreAgent {
  type: CoreAgentType = "operations";
  name = "Operations Agent";
  description = "Handles finance operations, campaign optimization, alerts, and system automation";
  capabilities = [
    "Payment tracking",
    "Delinquency management",
    "Campaign performance analysis",
    "Alert generation",
    "Workflow automation",
    "Report generation",
    "System health monitoring",
    "Batch operations",
  ];

  async execute(input: AgentTaskInput): Promise<AgentTaskResult> {
    const { action, parameters, context } = input;

    switch (action) {
      case "check_delinquencies":
        return this.checkDelinquencies(context);
      
      case "optimize_campaign":
        return this.optimizeCampaign(parameters, context);
      
      case "generate_alert":
        return this.generateAlert(parameters, context);
      
      case "run_digest":
        return this.runDigest(context);
      
      case "analyze_performance":
        return this.analyzePerformance(parameters, context);
      
      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  private async checkDelinquencies(context: AgentContext): Promise<AgentTaskResult> {
    const notes = await storage.getNotes(context.organizationId);
    const today = new Date();
    const delinquent: any[] = [];

    for (const note of notes) {
      if (note.status === "active" && note.nextPaymentDate) {
        const nextPayment = new Date(note.nextPaymentDate);
        const daysPastDue = Math.floor((today.getTime() - nextPayment.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysPastDue > 0) {
          delinquent.push({
            noteId: note.id,
            daysPastDue,
            buyerName: (note as any).buyerName || "Unknown",
            propertyId: note.propertyId,
          });
        }
      }
    }

    return {
      success: true,
      data: {
        delinquentCount: delinquent.length,
        delinquencies: delinquent,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  private async optimizeCampaign(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { campaignId, metrics } = params;

    const prompt = `Analyze these campaign metrics and suggest optimizations:
${JSON.stringify(metrics, null, 2)}

Provide:
1. Performance assessment
2. Top 3 optimization recommendations
3. Budget reallocation suggestions
4. Expected impact of changes`;

    const recommendations = await this.callOpenAI(prompt);

    return {
      success: true,
      data: { campaignId, recommendations },
    };
  }

  private async generateAlert(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { type, severity, details } = params;

    return {
      success: true,
      data: {
        alert: {
          type,
          severity: severity || "medium",
          message: details,
          createdAt: new Date().toISOString(),
        },
      },
    };
  }

  private async runDigest(context: AgentContext): Promise<AgentTaskResult> {
    const leads = await storage.getLeads(context.organizationId);
    const properties = await storage.getProperties(context.organizationId);
    const deals = await storage.getDeals(context.organizationId);

    const activeLeads = leads.filter(l => l.status === "active" || l.status === "new").length;
    const activeDeals = deals.filter(d => d.status !== "closed_won" && d.status !== "closed_lost").length;

    return {
      success: true,
      data: {
        summary: {
          totalLeads: leads.length,
          activeLeads,
          totalProperties: properties.length,
          activeDeals,
        },
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private async analyzePerformance(params: Record<string, any>, context: AgentContext): Promise<AgentTaskResult> {
    const { timeframe, metrics } = params;

    const prompt = `Analyze business performance for ${timeframe || "this month"}:
Metrics: ${JSON.stringify(metrics, null, 2)}

Provide:
1. Key insights
2. Trends identified
3. Areas for improvement
4. Recommended actions`;

    const analysis = await this.callOpenAI(prompt);

    return {
      success: true,
      data: { analysis, timeframe },
    };
  }
}

export const coreAgents = {
  research: new ResearchIntelligenceAgent(),
  deals: new DealsAcquisitionAgent(),
  communications: new CommunicationsAgent(),
  operations: new OperationsAgent(),
};

export async function executeAgentTask(
  agentType: CoreAgentType,
  input: AgentTaskInput
): Promise<AgentTaskResult> {
  const agent = coreAgents[agentType];
  if (!agent) {
    return { success: false, message: `Unknown agent type: ${agentType}` };
  }
  return agent.execute(input);
}

export function getAgentInfo(agentType: CoreAgentType) {
  const agent = coreAgents[agentType];
  if (!agent) return null;
  
  return {
    type: agent.type,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
  };
}

export function getAllAgentsInfo() {
  return Object.values(coreAgents).map(agent => ({
    type: agent.type,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
  }));
}

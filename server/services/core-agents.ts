import { storage } from "../storage";
import { dataSourceBroker, type LookupCategory } from "./data-source-broker";
import { type InsertAgentMemory, type AgentMemory } from "@shared/schema";
import { routeAITask, TaskComplexity, classifyTaskComplexity, MODEL_SIMPLE } from "./aiRouter";
import { skillRegistry, type Skill, type SkillResult, type AgentContext as SkillAgentContext } from "./agent-skills";

export type CoreAgentType = "research" | "deals" | "communications" | "operations";

export interface AgentContext {
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
  learnings?: { key: string; value: any; memoryType: string }[];
  /** 0–1: how confident the agent is in this result (1 = certain, 0 = guessing) */
  confidence?: number;
  /** If < 0.6 confidence, this message explains what the agent is uncertain about */
  uncertaintyNote?: string;
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

  protected async getRelevantMemories(context: AgentContext): Promise<AgentMemory[]> {
    try {
      const memories = await storage.getAgentMemories(context.organizationId, this.type, 20);
      for (const memory of memories) {
        await storage.updateAgentMemoryUsage(memory.id);
      }
      return memories;
    } catch (error) {
      console.error(`Error fetching memories for ${this.type} agent:`, error);
      return [];
    }
  }

  protected formatMemoriesForPrompt(memories: AgentMemory[]): string {
    if (memories.length === 0) return "";

    const grouped = {
      facts: memories.filter(m => m.memoryType === "fact"),
      preferences: memories.filter(m => m.memoryType === "preference"),
      successPatterns: memories.filter(m => m.memoryType === "success_pattern"),
      failurePatterns: memories.filter(m => m.memoryType === "failure_pattern"),
    };

    let memoryContext = "\n\n--- LEARNED CONTEXT ---\n";
    
    if (grouped.facts.length > 0) {
      memoryContext += "\nKnown Facts:\n";
      grouped.facts.forEach(m => {
        memoryContext += `- ${m.key}: ${JSON.stringify(m.value)}\n`;
      });
    }
    
    if (grouped.preferences.length > 0) {
      memoryContext += "\nUser Preferences:\n";
      grouped.preferences.forEach(m => {
        memoryContext += `- ${m.key}: ${JSON.stringify(m.value)}\n`;
      });
    }
    
    if (grouped.successPatterns.length > 0) {
      memoryContext += "\nSuccessful Patterns:\n";
      grouped.successPatterns.forEach(m => {
        memoryContext += `- ${m.key}: ${JSON.stringify(m.value)}\n`;
      });
    }
    
    if (grouped.failurePatterns.length > 0) {
      memoryContext += "\nPatterns to Avoid:\n";
      grouped.failurePatterns.forEach(m => {
        memoryContext += `- ${m.key}: ${JSON.stringify(m.value)}\n`;
      });
    }

    return memoryContext;
  }

  protected async getSystemPrompt(context?: AgentContext): Promise<string> {
    let basePrompt = `You are ${this.name}, an AI agent for AcreOS land investment platform.
Your capabilities include: ${this.capabilities.join(", ")}.
Always be helpful, accurate, and focused on land investment operations.
When asked to perform actions, analyze the request and determine the best approach.`;

    basePrompt += skillRegistry.getSkillDescriptionsForAgent(this.type);

    if (context) {
      const memories = await this.getRelevantMemories(context);
      basePrompt += this.formatMemoriesForPrompt(memories);
    }

    return basePrompt;
  }

  getAvailableSkills(): Skill[] {
    return skillRegistry.getSkillsForAgent(this.type);
  }

  async executeSkill(skillId: string, params: any, context: AgentContext): Promise<SkillResult> {
    const skill = skillRegistry.getSkillById(skillId);
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }
    if (!skill.agentTypes.includes(this.type)) {
      return { success: false, error: `Skill ${skillId} is not available for ${this.type} agent` };
    }
    return skillRegistry.executeSkill(skillId, params, context as SkillAgentContext);
  }

  protected async callOpenAI(
    prompt: string,
    systemPrompt?: string,
    context?: AgentContext,
    taskType?: string,
    complexity?: TaskComplexity
  ): Promise<string> {
    const finalSystemPrompt = systemPrompt || await this.getSystemPrompt(context);
    const resolvedTaskType = taskType || `${this.type}_task`;
    const resolvedComplexity = complexity ?? classifyTaskComplexity(resolvedTaskType, prompt.length);

    const response = await routeAITask({
      taskType: resolvedTaskType,
      complexity: resolvedComplexity,
      messages: [
        { role: "system", content: finalSystemPrompt },
        { role: "user", content: prompt },
      ],
      maxTokens: 2000,
    }, {
      orgId: context?.organizationId,
    });

    return response.content;
  }

  /**
   * Self-critique: run a lightweight review of a generated output and return
   * a refined version if the critique score is below threshold.
   *
   * Uses DeepSeek (cheapest model, ~$0.003 per critique) so the overhead is
   * minimal.  Only triggered for high-stakes output types (offers, analyses,
   * legal documents, strategies).
   *
   * @returns { refined: string; confidence: number; changed: boolean }
   */
  protected async selfCritique(
    original: string,
    taskType: string,
    context?: string
  ): Promise<{ refined: string; confidence: number; changed: boolean }> {
    const HIGH_STAKES_TASKS = [
      "legal_document", "offer", "deal_analysis", "contract_review",
      "negotiation_strategy", "market_valuation", "financial_modeling",
      "risk_assessment", "strategy",
    ];

    if (!HIGH_STAKES_TASKS.some(t => taskType.includes(t))) {
      return { refined: original, confidence: 0.8, changed: false };
    }

    const critiquePrompt = `You are a professional editor reviewing AI-generated content for a land investment platform.

TASK TYPE: ${taskType}
${context ? `CONTEXT: ${context}` : ""}

CONTENT TO REVIEW:
${original.slice(0, 1500)}

Evaluate:
1. Accuracy and factual soundness (for land investment)
2. Completeness — does it address the task fully?
3. Clarity and professionalism
4. Any missing critical information

Respond with JSON:
{
  "score": <1-10>,
  "issues": ["<issue 1>", ...],
  "refined": "<improved version, or exact same text if score >= 8>",
  "confidence": <0.0-1.0>
}`;

    try {
      const response = await routeAITask({
        taskType: "critique",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: "You are a content quality reviewer. Respond only with valid JSON." },
          { role: "user", content: critiquePrompt },
        ],
        responseFormat: "json",
        temperature: 0.1,
        maxTokens: 1500,
      });

      const parsed = JSON.parse(response.content);
      const score = Math.max(1, Math.min(10, parsed.score || 8));
      const confidence = Math.max(0, Math.min(1, parsed.confidence || 0.8));
      const refined = (score < 8 && parsed.refined && parsed.refined.length > 50) ? parsed.refined : original;

      return {
        refined,
        confidence,
        changed: refined !== original,
      };
    } catch {
      return { refined: original, confidence: 0.75, changed: false };
    }
  }

  /**
   * Auto-extract learnable memories from a task result.
   * Called after every successful task.  Uses DeepSeek to identify:
   *   - facts (objective truths discovered)
   *   - preferences (what the user / org seems to want)
   *   - success_patterns (what worked)
   *   - failure_patterns (what didn't)
   *
   * Silently fails — memory extraction is non-critical.
   */
  protected async autoExtractMemories(
    input: { action: string; parameters: Record<string, any> },
    result: { success: boolean; data?: any; message?: string },
    context: AgentContext
  ): Promise<void> {
    if (!result.success) {
      // Record failure pattern
      try {
        await this.recordLearning(
          context,
          `failure:${input.action}`,
          { action: input.action, reason: result.message || "unknown", params: input.parameters },
          "failure_pattern",
          0.6
        );
      } catch { /* non-critical */ }
      return;
    }

    // Only extract memories for substantive results (not trivial lookups)
    const SKIP_ACTIONS = ["calculate_financing", "generate_alert", "check_delinquencies"];
    if (SKIP_ACTIONS.includes(input.action)) return;

    const resultSummary = JSON.stringify(result.data || {}).slice(0, 400);

    const extractPrompt = `A land investment AI agent just completed a task. Extract any learnable insights.

Agent: ${this.type}
Action: ${input.action}
Parameters: ${JSON.stringify(input.parameters).slice(0, 200)}
Result summary: ${resultSummary}

List 0-3 concise learnings. Only include high-value insights worth remembering.
Respond with JSON array (can be empty):
[{"key":"<short key>","value":"<what was learned>","type":"fact|preference|success_pattern"}]`;

    try {
      const response = await routeAITask({
        taskType: "extract_data",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: "You are a memory extraction assistant. Respond only with valid JSON array." },
          { role: "user", content: extractPrompt },
        ],
        responseFormat: "json",
        temperature: 0.1,
        maxTokens: 300,
      });

      const learnings = JSON.parse(response.content);
      if (!Array.isArray(learnings)) return;

      for (const learning of learnings.slice(0, 3)) {
        if (learning.key && learning.value) {
          await this.recordLearning(
            context,
            learning.key,
            { value: learning.value, source: input.action },
            (learning.type as any) || "fact",
            0.65
          ).catch(() => {});
        }
      }
    } catch { /* non-critical */ }
  }

  async recordLearning(
    context: AgentContext, 
    key: string, 
    value: Record<string, any>, 
    memoryType: "fact" | "preference" | "success_pattern" | "failure_pattern",
    confidence: number = 0.5
  ): Promise<AgentMemory> {
    const memory: InsertAgentMemory = {
      organizationId: context.organizationId,
      agentType: this.type,
      memoryType,
      key,
      value,
      confidence: confidence.toString(),
    };
    return await storage.createAgentMemory(memory);
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

    const rawAnalysis = await this.callOpenAI(prompt, undefined, context, "deal_analysis", TaskComplexity.COMPLEX);
    const { refined: analysis, confidence } = await this.selfCritique(rawAnalysis, "deal_analysis", `Property ${property.address}`);

    const result: AgentTaskResult = {
      success: true,
      data: {
        propertyId,
        analysis,
        dueDiligenceData: dueDiligence.data,
        timestamp: new Date().toISOString(),
      },
      confidence,
      uncertaintyNote: confidence < 0.6 ? "Investment analysis confidence is low — manual review recommended" : undefined,
    };

    await this.autoExtractMemories({ action: "analyze_investment", parameters: params }, result, context);
    return result;
  }

  private async handleResearchQuery(query: string, context: AgentContext): Promise<AgentTaskResult> {
    const prompt = `As a land investment research expert, answer this query:
${query}

Provide practical, actionable information relevant to land investing.`;

    const response = await this.callOpenAI(prompt, undefined, context, "basic_analysis");
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

    const rawOfferLetter = await this.callOpenAI(prompt, undefined, context, "legal_document", TaskComplexity.COMPLEX);

    // Self-critique: review and refine the offer letter before presenting it
    const critiqueCtx = `Offer for property ${property?.address || "unknown"} at $${offerPrice}`;
    const { refined: offerLetter, confidence, changed } = await this.selfCritique(rawOfferLetter, "legal_document", critiqueCtx);

    if (changed) {
      console.log(`[DealsAgent] Offer letter refined by self-critique (confidence=${confidence.toFixed(2)})`);
    }

    const result: AgentTaskResult = {
      success: true,
      data: {
        offerLetter,
        offerPrice,
        leadId,
        propertyId,
        generatedAt: new Date().toISOString(),
        selfCritiqueApplied: changed,
      },
      requiresApproval: true,
      confidence,
      uncertaintyNote: confidence < 0.6 ? "Offer letter may need manual review — low confidence on completeness" : undefined,
    };

    // Auto-learn from this offer generation
    await this.autoExtractMemories({ action: "generate_offer", parameters: params }, result, context);
    return result;
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

    const rawAnalysis = await this.callOpenAI(prompt, undefined, context, "deal_analysis", TaskComplexity.COMPLEX);
    const { refined: analysis, confidence } = await this.selfCritique(rawAnalysis, "deal_analysis");

    const grossProfit = (estimatedValue || 0) - (purchasePrice || 0) - (repairCosts || 0);
    const roi = purchasePrice > 0 ? ((grossProfit / purchasePrice) * 100).toFixed(1) : 0;

    const result: AgentTaskResult = {
      success: true,
      data: {
        analysis,
        metrics: { grossProfit, roi: `${roi}%`, purchasePrice, estimatedValue },
      },
      confidence,
    };

    await this.autoExtractMemories({ action: "analyze_deal", parameters: params }, result, context);
    return result;
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

    const strategy = await this.callOpenAI(prompt, undefined, context, "negotiation_strategy", TaskComplexity.COMPLEX);
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

    const email = await this.callOpenAI(prompt, undefined, context, "draft_email");
    
    const subjectMatch = email.match(/Subject:?\s*(.+)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : "Regarding Your Property";
    const body = email.replace(/Subject:?\s*.+\n?/i, "").trim();

    const result: AgentTaskResult = {
      success: true,
      data: { subject, body, leadId },
      requiresApproval: true,
      confidence: 0.85,
    };
    await this.autoExtractMemories({ action: "compose_email", parameters: params }, result, context);
    return result;
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

    const message = await this.callOpenAI(prompt, undefined, context, "draft_email");

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

    const plan = await this.callOpenAI(prompt, undefined, context, "recommendation");

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

    const content = await this.callOpenAI(prompt, undefined, context, "creative");

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

    const response = await this.callOpenAI(prompt, undefined, context, "draft_email");

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

    const recommendations = await this.callOpenAI(prompt, undefined, context, "optimization", TaskComplexity.COMPLEX);

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

    const analysis = await this.callOpenAI(prompt, undefined, context, "evaluation", TaskComplexity.MODERATE);

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
  
  if (input.action === "execute_skill") {
    const { skillId, params } = input.parameters;
    if (!skillId) {
      return { success: false, message: "skillId is required for execute_skill action" };
    }
    const result = await agent.executeSkill(skillId, params || {}, input.context);
    return {
      success: result.success,
      data: result.data,
      message: result.message || result.error,
    };
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
    availableSkills: agent.getAvailableSkills().map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      costEstimate: s.costEstimate,
    })),
  };
}

export function getAllAgentsInfo() {
  return Object.values(coreAgents).map(agent => ({
    type: agent.type,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
    availableSkills: agent.getAvailableSkills().map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      costEstimate: s.costEstimate,
    })),
  }));
}

export function getAgentSkills(agentType: CoreAgentType) {
  const agent = coreAgents[agentType];
  if (!agent) return null;
  return agent.getAvailableSkills().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    agentTypes: s.agentTypes,
    costEstimate: s.costEstimate,
    examples: s.examples,
  }));
}

export function getAllSkills() {
  return skillRegistry.getSkillsMetadata();
}

export { skillRegistry };

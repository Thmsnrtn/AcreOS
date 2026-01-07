import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

export type CoreAgentType = "research" | "deals" | "communications" | "operations";

export interface IntentClassification {
  agentType: CoreAgentType;
  action: string;
  confidence: number;
  extractedParams: Record<string, any>;
  skillLabel: string;
}

const intentPatterns: Record<CoreAgentType, { patterns: RegExp[]; actions: string[]; skillLabel: string }> = {
  research: {
    patterns: [
      /due\s*diligence/i,
      /research|analyze|investigate|look\s*up|find\s*out/i,
      /flood\s*zone|wetland|soil|environmental/i,
      /property\s*info|parcel|apn/i,
      /market\s*analysis|investment\s*analysis/i,
      /zoning|title|deed/i,
    ],
    actions: ["run_due_diligence", "lookup_environmental", "analyze_investment", "enrich_property"],
    skillLabel: "Research & Intelligence",
  },
  deals: {
    patterns: [
      /offer|proposal|bid/i,
      /deal|acquisition|purchase/i,
      /comp|comparable|valuation/i,
      /financing|loan|terms/i,
      /negotiate|counter/i,
      /contract|agreement/i,
    ],
    actions: ["generate_offer", "analyze_deal", "lookup_comps", "calculate_financing"],
    skillLabel: "Deals & Acquisition",
  },
  communications: {
    patterns: [
      /email|message|write|compose|draft/i,
      /sms|text|call/i,
      /follow\s*up|reach\s*out|contact/i,
      /campaign\s*content|marketing\s*copy/i,
      /letter|template/i,
      /nurture|engage/i,
    ],
    actions: ["compose_email", "compose_sms", "nurture_lead", "generate_campaign_content"],
    skillLabel: "Communications",
  },
  operations: {
    patterns: [
      /delinquen|overdue|late\s*payment/i,
      /campaign\s*optimize|campaign\s*performance/i,
      /alert|notification|remind/i,
      /report|digest|summary|brief/i,
      /performance|metrics|analytics/i,
      /schedule|automate/i,
    ],
    actions: ["check_delinquencies", "optimize_campaign", "generate_alert", "run_digest", "analyze_performance"],
    skillLabel: "Operations",
  },
};

export function classifyIntentSimple(userMessage: string): IntentClassification {
  const message = userMessage.toLowerCase();
  
  let bestMatch: { agentType: CoreAgentType; score: number } | null = null;
  
  for (const [agentType, config] of Object.entries(intentPatterns) as [CoreAgentType, typeof intentPatterns.research][]) {
    let score = 0;
    for (const pattern of config.patterns) {
      if (pattern.test(message)) {
        score += 1;
      }
    }
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { agentType, score };
    }
  }

  const agentType = bestMatch?.agentType || "research";
  const config = intentPatterns[agentType];
  
  const extractedParams = extractParameters(userMessage);
  const action = determineAction(message, config.actions);

  return {
    agentType,
    action,
    confidence: bestMatch?.score ? Math.min(bestMatch.score / 3, 1) : 0.3,
    extractedParams,
    skillLabel: config.skillLabel,
  };
}

function extractParameters(message: string): Record<string, any> {
  const params: Record<string, any> = {};
  
  const apnMatch = message.match(/\b(\d{3}[-\s]?\d{2,3}[-\s]?\d{2,4})\b/);
  if (apnMatch) {
    params.apn = apnMatch[1];
  }
  
  const priceMatch = message.match(/\$[\d,]+(?:\.\d{2})?|\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:dollars?|k|K)/i);
  if (priceMatch) {
    const priceStr = priceMatch[0].replace(/[$,]/g, '');
    let price = parseFloat(priceStr);
    if (/k/i.test(priceMatch[0])) {
      price *= 1000;
    }
    params.price = price;
  }
  
  const acreageMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:acre|ac)/i);
  if (acreageMatch) {
    params.acreage = parseFloat(acreageMatch[1]);
  }
  
  const stateMatch = message.match(/\b(Arizona|AZ|Texas|TX|Florida|FL|Nevada|NV|Colorado|CO|New Mexico|NM|California|CA)\b/i);
  if (stateMatch) {
    params.state = stateMatch[1];
  }
  
  const countyMatch = message.match(/(\w+)\s+county/i);
  if (countyMatch) {
    params.county = countyMatch[1];
  }

  return params;
}

function determineAction(message: string, actions: string[]): string {
  if (/due\s*diligence|research\s*property/i.test(message)) return "run_due_diligence";
  if (/flood|wetland|environmental|soil/i.test(message)) return "lookup_environmental";
  if (/investment\s*analysis|roi|return/i.test(message)) return "analyze_investment";
  
  if (/offer|proposal/i.test(message)) return "generate_offer";
  if (/comp|comparable/i.test(message)) return "lookup_comps";
  if (/financing|loan|payment/i.test(message)) return "calculate_financing";
  if (/deal\s*analysis/i.test(message)) return "analyze_deal";
  
  if (/email/i.test(message)) return "compose_email";
  if (/sms|text\s*message/i.test(message)) return "compose_sms";
  if (/nurture|follow\s*up/i.test(message)) return "nurture_lead";
  if (/campaign\s*content|marketing\s*copy/i.test(message)) return "generate_campaign_content";
  
  if (/delinquen|overdue|late/i.test(message)) return "check_delinquencies";
  if (/optimize|improve\s*campaign/i.test(message)) return "optimize_campaign";
  if (/report|digest|summary/i.test(message)) return "run_digest";
  if (/performance|metrics/i.test(message)) return "analyze_performance";
  
  return actions[0] || "general_query";
}

export async function classifyIntentWithAI(userMessage: string): Promise<IntentClassification> {
  const simpleResult = classifyIntentSimple(userMessage);
  
  if (simpleResult.confidence >= 0.7) {
    return simpleResult;
  }

  const openai = getOpenAI();
  if (!openai) {
    return simpleResult;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an intent classifier for a land investment platform. Classify user messages into one of these agent types:

- research: Due diligence, property research, environmental lookups, market analysis
- deals: Offer generation, deal analysis, comparables, financing calculations  
- communications: Email/SMS composition, lead nurturing, marketing content
- operations: Payment tracking, campaign optimization, reports, performance analysis

Also identify the specific action and extract any relevant parameters (property IDs, APNs, prices, locations).

Respond in JSON format:
{
  "agentType": "research|deals|communications|operations",
  "action": "specific_action_name",
  "confidence": 0.0-1.0,
  "extractedParams": { ... }
}`
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 200,
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      const parsed = JSON.parse(content);
      return {
        agentType: parsed.agentType || simpleResult.agentType,
        action: parsed.action || simpleResult.action,
        confidence: parsed.confidence || 0.8,
        extractedParams: { ...simpleResult.extractedParams, ...parsed.extractedParams },
        skillLabel: intentPatterns[parsed.agentType as CoreAgentType]?.skillLabel || simpleResult.skillLabel,
      };
    }
  } catch (error) {
    console.error("AI intent classification error:", error);
  }

  return simpleResult;
}

export function getSkillLabel(agentType: CoreAgentType): string {
  return intentPatterns[agentType]?.skillLabel || "General";
}

export function getAllSkills() {
  return Object.entries(intentPatterns).map(([type, config]) => ({
    type,
    label: config.skillLabel,
    capabilities: config.actions,
  }));
}

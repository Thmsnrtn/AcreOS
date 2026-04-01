import OpenAI from "openai";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { toolDefinitions, executeTool, getOpenAITools, getToolsForRole, APPROVAL_REQUIRED_TOOLS } from "./tools";
import { aiConversations, aiMessages, agentMemory, type Organization, type AiConversation, type AiMessage } from "@shared/schema";
import {
  selectProviderAndModel,
  classifyFromMessages,
  TaskComplexity,
  AIProvider,
} from "../services/aiRouter";
import { buildConnectorContextBlock } from "../services/connectors/registry";
import mammoth from "mammoth";
import { storage } from "../storage";

// ── Quality Feedback Loop ────────────────────────────────────────────────────
// Fire-and-forget: scores each Pax response quality via DeepSeek and writes
// success/failure patterns to agentMemory so future responses improve over time.
async function scoreAndLearnFromResponse(
  orgId: number,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const openrouterKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    if (!openrouterKey) return;
    const scorer = new OpenAI({
      apiKey: openrouterKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://acreos.fly.dev", "X-Title": "AcreOS" },
    });
    const scoringPrompt = `Rate this AI assistant response for a real estate platform on a scale of 1-10.
User asked: "${userMessage.slice(0, 300)}"
Assistant responded: "${assistantResponse.slice(0, 500)}"
Return ONLY valid JSON: {"score": <number 1-10>, "reasons": ["<reason>"], "improvements": ["<suggestion>"]}`;

    const result = await scorer.chat.completions.create({
      model: "deepseek/deepseek-chat",
      messages: [{ role: "user", content: scoringPrompt }],
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(result.choices[0].message.content || "{}");
    const score = Number(parsed.score) || 0;
    if (score < 1 || score > 10) return;

    const memoryType = score >= 9 ? "success_pattern" : score < 7 ? "failure_pattern" : null;
    if (!memoryType) return;

    await db.insert(agentMemory).values({
      organizationId: orgId,
      agentType: "pax",
      memoryType,
      key: "response_quality_pattern",
      value: {
        score,
        queryPattern: userMessage.slice(0, 150),
        responsePattern: assistantResponse.slice(0, 150),
        reasons: parsed.reasons || [],
        improvements: parsed.improvements || [],
        recordedAt: new Date().toISOString(),
      },
      confidence: String(Math.min(1, score / 10)),
    } as any);
  } catch {
    // Never block a response over scoring failure
  }
}

// ── Calibration Context Loader ───────────────────────────────────────────────
// Loads outcome calibration data (from outcomeAnalyzer) into the system prompt
// so Pax knows which score buckets actually convert and which price estimates drift.
async function loadCalibrationContext(orgId: number): Promise<string> {
  try {
    const calibrations = await db
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.organizationId, orgId))
      .orderBy(desc(agentMemory.createdAt))
      .limit(3);
    const calibration = calibrations.find(m => m.memoryType === "calibration");
    if (!calibration || !calibration.value) return "";
    const data = calibration.value as any;
    if (!data.buckets) return "";
    const lines = data.buckets
      .filter((b: any) => b.sampleSize >= 5)
      .map((b: any) => `Score ${b.range}: actual conversion rate ${(b.actualRate * 100).toFixed(1)}% (expected ${(b.expectedRate * 100).toFixed(1)}%, n=${b.sampleSize})`);
    if (lines.length === 0) return "";
    return `\n\n--- LEAD SCORE CALIBRATION (from closed deals) ---\n${lines.join("\n")}\nUse this to calibrate which leads to prioritize.\n--- END CALIBRATION ---`;
  } catch {
    return "";
  }
}

function getChatProviderAndModel(complexity: TaskComplexity): { client: OpenAI; provider: AIProvider; model: string } {
  try {
    const result = selectProviderAndModel(complexity);
    console.log(`[AI Chat] Selected provider: ${result.provider}/${result.model}`);
    return result;
  } catch (error: any) {
    console.error('[AI Chat] Failed to get AI provider:', error.message);
    throw new Error("AI service not available. Please check configuration.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATLAS — Real Estate Intelligence Executive AI
// ─────────────────────────────────────────────────────────────────────────────
//
// Atlas is the strategic intelligence layer of AcreOS. He is the operator's
// right hand — a tireless, brilliant, and deeply knowledgeable real estate
// executive who combines world-class data science with deep field experience.
//
// Atlas is NOT a support agent. He does NOT handle billing questions, password
// resets, or general app troubleshooting. That is Sophie's domain. Atlas is
// purely focused on making the real estate BUSINESS perform at peak.
//
// SOPHIE is the customer success / support companion. She handles:
//   • Support tickets and onboarding guidance
//   • Account diagnostics and common issue resolution
//   • Knowledge base search and user education
//   • Escalation to the founder when needed
//
// When users ask Atlas support-type questions, he should warmly redirect:
//   "For account or billing questions, Sophie handles those — she's in the
//    Support section. I'm your real estate strategist — let me help you
//    find your next deal or optimize your portfolio."
//
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_LAND_GEEK_WISDOM = `
REAL ESTATE MASTERY — ATLAS CORE KNOWLEDGE BASE
====================================================
You have internalized the complete methodology of expert real estate investors. This
wisdom informs every recommendation, analysis, and strategy you provide.

FUNDAMENTAL PRINCIPLES:
• Raw land has NEVER gone to zero in US history — it is the bedrock asset class
• The real estate business is a SYSTEMS business — consistency beats cleverness every time
• Your freedom number is a math problem, not a dream. It is solved by stacking notes.
• Owner financing raw land is one of the most powerful wealth-building strategies available
• Tax delinquency is not a problem — it is an opportunity wearing a disguise
• The mailer you send today is the passive income arriving next quarter
• Every rejected offer is market data. Study it, adapt, move on.
• The seller who says no today calls back in 6 months. Follow up relentlessly.
• Build systems that run whether you are watching or not

COUNTY SELECTION — THE MOST IMPORTANT DECISION:
• Target counties with: low median home values ($50k–$200k range), population 25k–250k
• Look for counties where land SELLS (not just lists) — check DOM and sold data
• Avoid: densely populated counties, hurricane/flood zones as primary markets
• Sweet spot counties: rural recreational, Sun Belt growth corridors, hunting/agriculture states
• Research: 3 months of comparable sold properties before committing to a county
• One great county can fund your freedom number — know your counties deeply
• Multi-county strategy: 3–5 proven counties provides deal flow consistency
• AZ, NM, TX, FL, CO, TN, NC, GA are historically strong land states
• Check county redemption periods — longer = more motivated sellers at auction
• Low property tax states often yield lower acquisition costs on delinquent lists

TAX DELINQUENT LIST STRATEGY:
• Contact county tax assessor/collector for delinquent tax lists (most public record)
• Filter: 2–5 years delinquent, out-of-state owners (highest motivation), 1–40 acres
• Scrub against county GIS data — remove wetlands, landlocked, non-buildable
• Out-of-state + delinquent = seller who has psychologically surrendered the property
• Target: owners paying taxes on a property worth less than $30k they never visit
• Redemption period timing: target 6–18 months before tax auction for maximum leverage
• Stack signals: delinquent taxes + out of state + no mortgage + multiple years = hot lead
• Batch requests: many counties allow monthly or quarterly list purchases for $25–$100

PRICING & OFFER STRATEGY — THE BLIND OFFER FORMULA:
• Offer at 10–30% of retail market value (FMV) — this IS the business model
• For seller financing resell: target 3–5x your acquisition cost at the spread
• Down payment formula: collect enough to cover your acquisition cost at minimum
• Monthly note payments: $100–$400/mo is the "impulse buy" range for land buyers
• Amortize over 3–10 years at 9–12% interest (higher than banks, justified by no credit check)
• Price for the PAYMENT, not the total price — buyers shop by monthly payment
• Rule of thumb: buy at $500–$2000/acre, sell owner-financed at $2000–$8000/acre
• Blind offer strategy: send offers before getting too much data — volume beats analysis
• Tiered pricing matrix: small lots ($5k–$15k), mid-size (5–20 acres: $15k–$50k), large (20+ acres: $50k+)
• Always include "as-is" clause and inspection period in purchase contract

DUE DILIGENCE — NON-NEGOTIABLE CHECKLIST:
• Access: is there legal road access? Easements? Landlocked = deal killer
• Wetlands: check USFWS wetland mapper — wetlands severely limit usability
• Flood zone: FEMA FIRM maps — 100-year flood plain dramatically reduces value
• Zoning: confirm allowed uses match your buyer pool (residential/recreational/agricultural)
• Back taxes owed: who pays them at close? Negotiate seller pays, or factor into offer
• Liens: title search for IRS liens, HOA liens, judgment liens
• Utilities: are power/water/septic available or feasible?
• Soil/percolation: if residential, can it support a septic system?
• Survey: is the parcel properly described? Boundary disputes are expensive
• Environmental: EPA brownfields, contaminated sites (rare for rural, but verify)
• APN verification: confirm parcel ID matches county GIS records exactly

LEAD NURTURING & FOLLOW-UP SYSTEM:
• 80% of land deals close after the 4th–12th contact attempt
• Multi-touch sequence: blind offer letter → postcard → phone → email → voicemail
• Response rates: 1–5% on direct mail is excellent — don't get discouraged
• Personalize letters: handwritten font, local references, empathy for their situation
• Call scripts: "Hi, I sent you a letter about your property in [County] — did you receive it?"
• Voicemail strategy: short, professional, leave callback number twice
• SMS follow-up (with TCPA consent): highest open rates after initial contact
• Drip sequence: 8–12 touches over 90 days before moving to archive
• Seller motivation signals: mentions divorce, death in family, financial hardship, moving
• Never pressure — position yourself as solving a problem for them

SELLER FINANCING & NOTE PORTFOLIO STRATEGY:
• Never sell for cash when you can sell on terms — recurring income compounds
• Structure deals with 10–20% down payment, 9–12% interest, 3–10 year term
• Dodd-Frank compliance: follow safe harbor rules for owner-financed properties
• Note portfolio = your passive income engine. Every note is a brick in your moat.
• Track: total note count, monthly note income, default rate, payoff velocity
• Reinvest note income to mail more, acquire faster — the flywheel effect
• Default management: communication first, work out payment plans, foreclosure as last resort
• Note seasoning: after 12+ payments, notes become sellable assets (note buyers exist)
• Freedom number = monthly passive expenses / average note payment = number of notes needed
• 10 notes at $200/mo = $2,000/mo passive. 50 notes = $10,000/mo passive.

MARKETING & SELLING LAND:
• List on: AcreValue, Land.com, LandWatch, LandSearch, Lands of America, Zillow, Facebook Marketplace
• Facebook groups: local "land for sale" groups drive significant buyer traffic
• Your own buyer list is your most valuable marketing asset — build it with every sale
• Seller financing listings convert 3–5x better than cash-only listings
• Photos: drone photography dramatically increases inquiries on parcels over 5 acres
• Descriptions: lead with USES (hunting, camping, homesite, investment, farming)
• Price at the note payment: "$199/mo, $500 down" sells faster than "$8,500"
• Craigslist still works for cheap parcels under $10k — don't overlook it
• Remarketing: if a property sits 60+ days, lower price or improve terms

MARKET ANALYSIS & INTELLIGENCE:
• Study DOM (days on market) for sold properties — under 90 days = liquid market
• Price-per-acre comps: pull last 12 months, filter to same parcel size range (±50%)
• Seasonal patterns: land inquiries peak March–July, slow Oct–Dec
• Migration trends: track US Census migration data — growing counties = growing land demand
• Infrastructure signals: new highways, Amazon warehouses, data centers all lift land value
• Remote work trend: accelerated demand for recreational/rural land since 2020
• Solar/wind lease potential: check NREL wind/solar maps for energy development value
• Recreational value: proximity to hunting, fishing, camping = premium pricing
• Water rights: wells, springs, creek frontage = significant value multipliers
• Timber value: check if standing timber has marketable value (separate from land)

AUTOMATION & SYSTEMS:
• Automate: lead import → scoring → offer generation → mail queue → follow-up sequences
• KPIs to track weekly: mailers sent, response rate, offers made, deals under contract, deals closed
• Your deal conversion funnel: list pulled → scrubbed → mailed → responded → offered → accepted → closed
• VA leverage: hire VAs for list scrubbing, data entry, response handling at $3–$8/hr
• CRM discipline: every lead gets a status, every status has a next action
• Monday morning routine: check notes received, review follow-up queue, mail count for week
• Nite Cap review: every evening — notes paid, pipeline velocity, one win of the day
• 80/20 rule: 20% of counties produce 80% of deals — double down on what works
• Batch processing: run comps, generate offers, queue mail in weekly batches for efficiency

FINANCIAL & BUSINESS METRICS:
• Target: 100%+ cash-on-cash ROI on every deal (buy at $1k, sell for $2k+ cash, or $3k+ on terms)
• Portfolio health: default rate < 5%, average note age < 30 months, reinvestment rate > 50%
• Operating costs: track all mail costs, skip trace costs, closing costs vs. revenue
• Tax strategy: dealer vs. investor status, depreciation, 1031 exchange potential
• Business structure: LLC per county or per strategy (consult tax attorney)
• Exit strategies: sell the note portfolio, sell the business, IPO the note stream
• Bookkeeping: track every acquisition cost, every payment received, every expense
`;

export const agentProfiles = {
  executive: {
    name: "Pax",
    role: "executive",
    displayName: "Executive Assistant",
    description: "Your AI-powered executive assistant for real estate operations",
    systemPrompt: `You are Pax, an AI executive assistant for a real estate company using AcreOS.

IDENTITY & ROLE:
You are NOT a generic assistant. You are a deeply specialized real estate expert with encyclopedic knowledge of property acquisition and investment. You think like a seasoned operator who has done hundreds of deals, studied the best real estate investors in the country, and built systems that generate passive income at scale.

You are the STRATEGIC brain of the operation. Your role is to help the user:
• Find, analyze, and close deals — land, residential, commercial, STR, multifamily, or any asset class
• Build and optimize their portfolio for cash flow and passive income
• Automate and systematize their real estate business
• Make data-driven decisions on markets, pricing, and timing
• Achieve their financial goals — whether that's freedom number, cash flow targets, or portfolio growth

IMPORTANT — BOUNDARY WITH SOPHIE:
You are NOT a support agent. For billing questions, account issues, password problems, or platform troubleshooting, warmly redirect the user to Sophie (Support section). Say something like: "Sophie handles account support — I'm your real estate strategist. Let me help you find your next deal."

${ATLAS_LAND_GEEK_WISDOM}

PLATFORM ACCESS — YOU CAN ACT:
You have FULL ACCESS to all AcreOS modules and can take action, not just advise:
- Create and manage Leads in the CRM (get_leads, create_lead, update_lead_status)
- Add and update Properties in Inventory (get_properties, create_property, update_property)
- Create and manage Deals in the Pipeline (get_deals, create_deal, update_deal)
- Create and complete Tasks (get_tasks, create_task, update_task)
- Analyze Finance and seller notes (calculate_roi, calculate_payment_schedule)
- Run property research and comps (research_property, run_comps_analysis)
- Generate and send offer letters (generate_offer, generate_offer_letter)
- Send TCPA-compliant communications (send_email, send_sms)
- Get system overviews (get_system_context)

DOCUMENT PROCESSING — CRITICAL:
When a document (Word, PDF, CSV) with property data is attached:
1. IMMEDIATELY scan for APNs (123-456-789 or 12.34.56.78 or 1234567890 formats)
2. Look for county names, state abbreviations, addresses, acreage
3. Use create_properties_batch to add all properties in one operation
4. DO NOT ask the user to re-paste data — it is already in your context
5. Report back: "Created X properties from [County], [State]. Ready to research or generate offers."

REAL ESTATE ANALYSIS FRAMEWORK:
When evaluating any deal or county, apply this framework:
1. COUNTY HEALTH: recent sold comps count, average DOM, price-per-acre trend
2. DEAL MATH: acquisition cost → resell price → down payment → monthly note → ROI
3. DUE DILIGENCE FLAGS: flood zone, wetlands, access, zoning, back taxes, liens
4. SELLER MOTIVATION: years delinquent + out-of-state + no mortgage = hot signal
5. PORTFOLIO FIT: does this move the needle on the freedom number?

WORKFLOW DEFAULTS:
1. Use get_system_context first when you need the full business picture
2. Always think in terms of the freedom number and passive income optimization
3. Flag deals that don't pass the due diligence checklist with specific concerns
4. When generating offers, use the blind offer formula (10–30% of FMV)
5. Format all dollar amounts as currency; format acreage with decimal precision
6. Be decisive and direct — give concrete recommendations, not endless options
7. After completing any action, suggest the logical next step in the workflow

Keep responses sharp, business-focused, and grounded in real estate reality. You speak the language of the real estate professional: APNs, comps, blind offers, owner financing, delinquent lists, freedom numbers, note portfolios. This is your world.`,
    icon: "Bot"
  },
  acquisitions: {
    name: "Alex",
    role: "acquisitions",
    displayName: "Acquisitions Specialist",
    description: "Expert in lead qualification, deal sourcing, and pipeline management across all real estate strategies",
    systemPrompt: `You are Alex, an AI Acquisitions Specialist working within the AcreOS real estate platform.

YOUR FOCUS: Finding, qualifying, and moving deals through the pipeline — whether land, residential, commercial, multifamily, STR, or any other strategy the user pursues.

CORE RESPONSIBILITIES:
- Qualify and score leads using seller motivation signals (delinquency, out-of-state, no mortgage)
- Analyze acquisition opportunities using the blind offer formula (10–30% of FMV)
- Manage the sales pipeline from cold lead to signed purchase agreement
- Research properties and sellers for due diligence signals
- Calculate deal math: buy price → sell price → down payment → monthly note → ROI

DUE DILIGENCE CHECKLIST (apply to every deal):
1. Access — legal road access? Easements? Landlocked?
2. Wetlands — USFWS mapper check
3. Flood zone — FEMA FIRM check
4. Zoning — allowed uses match buyer pool?
5. Back taxes — who pays at close?
6. Liens — title search complete?
7. Utilities — power/water/septic feasibility

ACQUISITION TARGETS: Out-of-state owners, 2–5 years tax delinquent, 1–40 acres, counties with proven sell-through.

Be concise, deal-focused, and always move toward a close. Quote specific numbers.`,
    icon: "Target"
  },
  underwriting: {
    name: "Uma",
    role: "underwriting",
    displayName: "Underwriting Analyst",
    description: "Financial analysis, deal structuring, and portfolio optimization across all real estate strategies",
    systemPrompt: `You are Uma, an AI Underwriting Analyst for real estate deals in AcreOS.

YOUR FOCUS: Numbers, deal structuring, and passive income optimization.

CORE RESPONSIBILITIES:
- Analyze deal financials with precision (acquisition cost, carry cost, sell price, ROI)
- Structure seller financing terms: down payment (cover acquisition cost minimum), monthly note, interest rate, term
- Calculate payment schedules and amortization for owner-financed deals
- Assess risk: flood zone, wetlands, access issues, lien exposure, title risk
- Optimize note portfolio for maximum passive income vs. risk

OWNER FINANCING DEFAULTS:
- Interest rate: 9–12% (higher than bank rates; justified by no credit check)
- Term: 3–10 years (shorter = less default exposure; longer = lower payment)
- Down payment: minimum covers your acquisition cost
- Monthly payment sweet spot: $100–$400 for "impulse buy" positioning

DEAL MATH FORMULA:
- Cash deal ROI: (sell price - buy price - costs) / buy price × 100
- Note deal ROI: (down payment + total note payments - buy price - costs) / buy price × 100
- Freedom number: monthly expenses / average note payment = notes needed

Quote precise numbers always. Show your math. Flag any deal that doesn't pencil.`,
    icon: "Calculator"
  },
  marketing: {
    name: "Maya",
    role: "marketing",
    displayName: "Marketing Specialist",
    description: "Direct mail, digital campaigns, and real estate buyer/seller outreach",
    systemPrompt: `You are Maya, an AI Marketing Specialist for real estate in AcreOS.

YOUR FOCUS: Generating seller responses and finding qualified buyers across all property types.

CORE RESPONSIBILITIES:
- Create high-response direct mail campaigns (blind offer letters, postcards)
- Draft outreach messages with emotional resonance and seller empathy
- Plan multi-touch follow-up sequences (letter → postcard → call → email → SMS)
- Analyze campaign performance: response rate, cost per response, cost per deal
- Build and leverage the buyer list for seller-financed land

DIRECT MAIL BEST PRACTICES:
- Personalize with handwritten-style fonts and local county references
- Lead with empathy: acknowledge they may not want the property anymore
- Include a specific cash offer (blind offer) — vague letters get ignored
- Yellow letters or typed letters: both work, test and track
- Send at least 3 touches before abandoning a prospect
- Best days to mail land: Tuesday–Thursday delivery for maximum response

DIGITAL MARKETING:
- List on AcreValue, Land.com, LandWatch, Lands of America, Zillow, Facebook Marketplace
- Facebook groups for local areas drive significant organic buyer traffic
- Lead with the monthly payment in all ads: "$199/mo, $500 down" not "$8,500"
- Drone photos dramatically increase conversions on parcels over 5 acres

Craft compelling copy. Every word in a campaign should earn its place. Write for the motivated seller who is ready to let go.`,
    icon: "Megaphone"
  },
  research: {
    name: "Riley",
    role: "research",
    displayName: "Research Analyst",
    description: "Property research, market analysis, and location intelligence across all real estate asset classes",
    systemPrompt: `You are Riley, an AI Research Analyst for real estate in AcreOS.

YOUR FOCUS: Deep, accurate intelligence on properties, markets, counties, and neighborhoods across all asset classes — land, residential, commercial, multifamily, STR, mobile home parks, and more.

CORE RESPONSIBILITIES:
- Property due diligence: flood zone (FEMA), wetlands (USFWS), zoning, access, utilities
- Market analysis: DOM trends, price-per-acre comps, sold-vs-listed ratios
- County intelligence: population trends, tax sale data, GIS endpoint verification
- Comparable sales research: filter by parcel size ±50%, last 12 months, same county
- Environmental and regulatory overlays: EPA, state environmental agencies

DATA SOURCES TO LEVERAGE:
- FEMA FIRM maps for flood risk
- USFWS National Wetlands Inventory
- USGS topographic and elevation data
- Census Bureau for population/migration trends
- County GIS portals for parcel data
- NREL for solar/wind potential
- FSA for farmland classifications

RESEARCH STANDARDS:
- Always note data source and last update date
- Flag any conflicting data between sources
- Give confidence score on any estimate
- Never extrapolate beyond available data without clear caveats
- County-level data is your foundation; parcel-level data is your verification

Be thorough, cite your sources, and always flag uncertainty clearly.`,
    icon: "Search"
  },
  documents: {
    name: "Dana",
    role: "documents",
    displayName: "Documents Specialist",
    description: "Contract drafting, offer letters, and closing documents",
    systemPrompt: `You are Dana, an AI Documents Specialist for land deals in AcreOS.

YOUR FOCUS: Professional, legally sound documents that close deals.

CORE RESPONSIBILITIES:
- Draft purchase and sale agreements for raw land transactions
- Create personalized offer letters (professional, friendly, or urgent tone)
- Generate seller financing contracts and promissory notes
- Manage closing documents and title transfer paperwork
- Maintain document templates for efficiency and consistency

DOCUMENT STANDARDS:
- Always include: property description (legal and APN), purchase price, earnest money, closing date, contingencies, "as-is" clause with inspection period
- Seller financing addenda: interest rate, term, payment schedule, default provisions, acceleration clause
- TCPA compliance language on all communication templates
- State-specific requirements: some states require attorney review — always note this

TONE MATCHING:
- Motivated seller / empathy letters: warm, non-threatening, solution-focused
- Investor-to-investor: direct, professional, number-focused
- Listing descriptions: benefit-focused, use-case driven, note payment prominent

Draft clean, concise documents. Legal language where required, plain English where possible.`,
    icon: "FileText"
  }
};

export type AgentRole = keyof typeof agentProfiles;

interface FileAttachment {
  name: string;
  content: string; // base64 encoded
  size: number;
}

interface ChatOptions {
  conversationId?: number;
  agentRole?: AgentRole;
  stream?: boolean;
  files?: FileAttachment[];
  propertyId?: number;
  mentionedEntities?: { type: string; id: number; name: string; preview: string }[];
  activeProjectId?: number;
  modelOverride?: string; // Override automatic model selection
  subAgentDepth?: number; // Internal: depth counter for spawn_subagent recursion guard
}

function decodeBase64ToText(base64: string): string {
  try {
    // Handle data URLs (e.g., data:text/csv;base64,...)
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    return Buffer.from(base64Data, 'base64').toString('utf-8');
  } catch {
    return '[Unable to decode file content]';
  }
}

function parseCSV(content: string): { headers: string[]; rows: string[][]; totalRows: number } {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return { headers: [], rows: [], totalRows: 0 };
  
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };
  
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1, 31).map(parseRow); // Limit to 30 data rows for context
  
  return { headers, rows, totalRows: lines.length - 1 };
}

// Detect if a file is an image
function isImageFile(file: { name: string; mimeType?: string }): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return (file as any).mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(ext);
}

// Build an image content part for vision-capable models
function buildImageContentPart(file: FileAttachment): { type: "image_url"; image_url: { url: string } } {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpeg';
  const mimeType = (file as any).mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } };
}

async function formatFileContentAsync(file: FileAttachment): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  // Images are handled separately as content parts — return a placeholder
  if (isImageFile(file)) {
    return `[Image file attached: ${file.name}]`;
  }

  // For DOCX files, use mammoth to extract text
  if (extension === 'docx') {
    try {
      const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value;
      const preview = text.slice(0, 15000);
      return `--- File: ${file.name} (Word Document) ---\n${preview}${text.length > 15000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
    } catch (err: any) {
      console.error(`[AI] Error parsing DOCX file ${file.name}:`, err.message);
      return `--- File: ${file.name} ---\n[Error: Could not parse DOCX file. The file may be corrupted or in an unsupported format.]\n--- End of ${file.name} ---`;
    }
  }
  
  const content = decodeBase64ToText(file.content);
  
  // For CSV files, parse into structured format
  if (extension === 'csv') {
    const { headers, rows, totalRows } = parseCSV(content);
    
    if (headers.length === 0) {
      return `--- File: ${file.name} (CSV, empty) ---\nNo data found.\n--- End of ${file.name} ---`;
    }
    
    let result = `--- File: ${file.name} (CSV with ${totalRows} records) ---\n`;
    result += `COLUMNS: ${headers.join(', ')}\n\n`;
    result += `DATA (showing ${Math.min(rows.length, 30)} of ${totalRows} records):\n`;
    
    // Format as readable records
    for (let i = 0; i < rows.length; i++) {
      result += `\nRecord ${i + 1}:\n`;
      for (let j = 0; j < headers.length; j++) {
        const value = rows[i][j] || '';
        if (value) {
          result += `  ${headers[j]}: ${value}\n`;
        }
      }
    }
    
    if (totalRows > 30) {
      result += `\n[...${totalRows - 30} more records not shown...]\n`;
    }
    result += `--- End of ${file.name} ---`;
    return result;
  }
  
  // For text files
  if (['txt', 'text', 'md', 'json'].includes(extension)) {
    const preview = content.slice(0, 10000);
    return `--- File: ${file.name} ---\n${preview}${content.length > 10000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
  }
  
  // For other files, show what we can
  return `--- File: ${file.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
}

// Sync wrapper for backward compatibility
function formatFileContent(file: FileAttachment): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  
  // For DOCX files, return a placeholder - use formatFileContentAsync instead
  if (extension === 'docx') {
    return `--- File: ${file.name} (Word Document) ---\n[Processing DOCX...]\n--- End of ${file.name} ---`;
  }
  
  const content = decodeBase64ToText(file.content);
  
  // For CSV files, parse into structured format
  if (extension === 'csv') {
    const { headers, rows, totalRows } = parseCSV(content);
    
    if (headers.length === 0) {
      return `--- File: ${file.name} (CSV, empty) ---\nNo data found.\n--- End of ${file.name} ---`;
    }
    
    let result = `--- File: ${file.name} (CSV with ${totalRows} records) ---\n`;
    result += `COLUMNS: ${headers.join(', ')}\n\n`;
    result += `DATA (showing ${Math.min(rows.length, 30)} of ${totalRows} records):\n`;
    
    for (let i = 0; i < rows.length; i++) {
      result += `\nRecord ${i + 1}:\n`;
      for (let j = 0; j < headers.length; j++) {
        const value = rows[i][j] || '';
        if (value) {
          result += `  ${headers[j]}: ${value}\n`;
        }
      }
    }
    
    if (totalRows > 30) {
      result += `\n[...${totalRows - 30} more records not shown...]\n`;
    }
    result += `--- End of ${file.name} ---`;
    return result;
  }
  
  // For text files
  if (['txt', 'text', 'md', 'json'].includes(extension)) {
    const preview = content.slice(0, 10000);
    return `--- File: ${file.name} ---\n${preview}${content.length > 10000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
  }
  
  // For other files, show what we can
  return `--- File: ${file.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
}

async function getConversation(id: number): Promise<AiConversation | undefined> {
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
  return conv;
}

async function createConversation(data: { organizationId: number; userId: string; title: string; agentRole: string }): Promise<AiConversation> {
  const [conv] = await db.insert(aiConversations).values(data).returning();
  return conv;
}

async function updateConversation(id: number, updates: Partial<{ title: string }>): Promise<void> {
  await db.update(aiConversations).set({ ...updates, updatedAt: new Date() }).where(eq(aiConversations.id, id));
}

async function getMessages(conversationId: number): Promise<AiMessage[]> {
  return db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(aiMessages.createdAt);
}

async function createMessage(data: { conversationId: number; role: string; content: string; toolCalls?: any[] }): Promise<AiMessage> {
  const [msg] = await db.insert(aiMessages).values(data).returning();
  return msg;
}

/**
 * Load user preference memories from agentMemory and format them for system prompt injection.
 * Preferences teach the AI about the user's communication style, deal criteria, and workflow habits.
 */
async function loadUserPreferenceContext(orgId: number): Promise<string> {
  try {
    const memories = await storage.getAgentMemories(orgId, undefined, 50);
    const preferences = memories.filter(m => m.memoryType === "preference");
    if (preferences.length === 0) return "";

    const lines = preferences.map(m => `- ${m.key}: ${JSON.stringify(m.value)}`).join("\n");
    return `\n\n--- USER PREFERENCES (learned from past interactions) ---\n${lines}\n--- END USER PREFERENCES ---`;
  } catch {
    return ""; // Non-blocking — never fail a chat request over a missing preference
  }
}

async function loadOrgKnowledgeContext(orgId: number): Promise<string> {
  try {
    const files = await storage.getActiveKnowledgeFiles(orgId);
    if (files.length === 0) return "";
    const sections = files.map(f =>
      `--- KNOWLEDGE: ${f.name} ---\n${f.extractedContent}\n--- END: ${f.name} ---`
    ).join("\n\n");
    // Non-blocking usage tracking
    process.nextTick(() => storage.incrementKnowledgeFileUsage(orgId).catch(() => {}));
    return `\n\n=== COMPANY KNOWLEDGE BASE ===\n${sections}\n=== END COMPANY KNOWLEDGE ===`;
  } catch {
    return "";
  }
}

async function loadProjectContext(projectId: number): Promise<string> {
  try {
    const project = await storage.getPaxProject(projectId);
    if (!project) return "";
    const files = await storage.getPaxProjectFiles(projectId);
    const sections = files
      .map(f => `--- File: ${f.fileName} ---\n${f.extractedContent}\n--- End: ${f.fileName} ---`)
      .join("\n\n");
    return `\n\n=== PROJECT: ${project.name} ===\n${project.description ? `Description: ${project.description}\n` : ""}${sections}\n=== END PROJECT ===`;
  } catch {
    return "";
  }
}

// Exported helper used by knowledge/project upload routes
export async function formatFileContentFromBase64(file: { name: string; content: string; mimeType: string }): Promise<string> {
  return formatFileContentAsync({ name: file.name, content: file.content, size: 0 } as FileAttachment);
}

// Auto-compaction: summarize old messages when conversation grows too long
async function compactConversationIfNeeded(
  conversationId: number,
  messages: AiMessage[]
): Promise<AiMessage[]> {
  if (messages.length < 20) return messages;
  const totalChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  if (totalChars < 80_000) return messages; // ~20k tokens threshold

  const compactUpTo = Math.floor(messages.length / 2);
  const toCompact = messages.slice(0, compactUpTo);
  const toKeep = messages.slice(compactUpTo);

  try {
    const { selectProviderAndModel, TaskComplexity: TC } = await import('../services/aiRouter');
    const { client: sc, model: sm } = selectProviderAndModel(TC.SIMPLE);
    const res = await sc.chat.completions.create({
      model: sm,
      messages: [
        { role: "system", content: "Summarize this conversation as concise bullet points. Preserve all property details, deal terms, decisions made, and action items. Be specific, not generic." },
        { role: "user", content: toCompact.map(m => `${m.role.toUpperCase()}: ${m.content?.slice(0, 600)}`).join('\n\n') }
      ],
      max_tokens: 1200
    });
    const summary = res.choices[0]?.message?.content || "";
    // Store summary async (non-blocking)
    process.nextTick(() => {
      db.update(aiConversations)
        .set({ contextSummary: summary } as any)
        .where(eq(aiConversations.id, conversationId))
        .catch(() => {});
    });
    console.log(`[AI] Auto-compacted ${compactUpTo} messages for conversation ${conversationId}`);
    return [
      { id: -1, conversationId, role: "assistant", content: `=== CONVERSATION SUMMARY (auto-compacted) ===\n${summary}\n=== END SUMMARY ===`, createdAt: new Date() } as AiMessage,
      ...toKeep
    ];
  } catch {
    return messages; // Non-blocking — if compaction fails, use original
  }
}

export async function getOrCreateConversation(
  orgId: number,
  userId: string,
  conversationId?: number
): Promise<AiConversation> {
  if (conversationId) {
    const conv = await getConversation(conversationId);
    if (conv && conv.organizationId === orgId) {
      return conv;
    }
  }

  return await createConversation({
    organizationId: orgId,
    userId,
    title: "New Conversation",
    agentRole: "executive"
  });
}

export async function processChat(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): Promise<{ response: string; toolCalls?: any[]; conversationId: number; model?: string; provider?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number }> {
  const { agentRole = "executive", files, propertyId } = options;
  // Map "assistant" to "executive" and fallback to executive for unknown roles
  const roleStr = agentRole as string;
  const normalizedRole = (roleStr === "assistant" || !agentProfiles[roleStr as keyof typeof agentProfiles]) 
    ? "executive" 
    : roleStr as keyof typeof agentProfiles;
  const profile = agentProfiles[normalizedRole];
  const tools = getToolsForRole(normalizedRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  // Build the full message including file contents for AI, but store only original message in DB
  let fullMessage = message;
  let displayMessage = message; // What we show in DB and chat history
  
  if (files && files.length > 0) {
    // Add file names to display message for reference
    const fileNames = files.map(f => f.name).join(', ');
    displayMessage = `${message}\n\n[Attached files: ${fileNames}]`;
    
    // Full message with content for AI processing (async for DOCX support)
    const fileContentsArray = await Promise.all(files.map(f => formatFileContentAsync(f)));
    const fileContents = fileContentsArray.join('\n\n');
    fullMessage = `${message}\n\nThe user has attached the following file(s). Please analyze and process them according to their request:\n\n${fileContents}`;
    console.log(`[AI Chat] Processing ${files.length} file attachment(s)`);
  }

  // Store only the display message (without binary content) in the database
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: displayMessage
  });

  let messages = await getMessages(conversation.id);
  messages = await compactConversationIfNeeded(conversation.id, messages);

  // Inject property enrichment context into the system prompt when a property is open
  let _enrichCtx = "";
  const _pid = (options as ChatOptions).propertyId;
  if (_pid) {
    try {
      const _prop = await storage.getProperty(org.id, _pid);
      if (_prop) {
        const _ed = (_prop as any).enrichmentData;
        const _lines: string[] = [
          `\n\n--- ACTIVE PROPERTY CONTEXT (ID: ${_prop.id}) ---`,
          `Address: ${_prop.address || "N/A"}`,
          `Size: ${_prop.sizeAcres ? `${_prop.sizeAcres} acres` : "N/A"}`,
          `State: ${_prop.state || "N/A"}, County: ${_prop.county || "N/A"}`,
          `APN: ${_prop.apn || "N/A"}`,
        ];
        if (_ed) {
          _lines.push(`Enrichment Completeness: ${_ed.completenessScore ?? "?"}%`);
          if (_ed.hazards?.floodZone) _lines.push(`Flood Zone: ${_ed.hazards.floodZone}`);
          if (_ed.environment?.soilType) _lines.push(`Soil: ${_ed.environment.soilType}`);
          if (_ed.demographics?.population) _lines.push(`Tract Population: ${_ed.demographics.population}, Median Income: $${_ed.demographics.medianHouseholdIncome?.toLocaleString() ?? "N/A"}`);
          if (_ed.scores) _lines.push(`Scores: ${JSON.stringify(_ed.scores)}`);
          if (_ed.hazards?.wetlandsPresent !== undefined) _lines.push(`Wetlands Present: ${_ed.hazards.wetlandsPresent}`);
          if (_ed.elevation?.elevationFeet) _lines.push(`Elevation: ${_ed.elevation.elevationFeet} ft`);
          if (_ed.transportation?.nearestHighwayMiles !== undefined) _lines.push(`Nearest Highway: ${_ed.transportation.nearestHighwayMiles} mi`);
        } else {
          _lines.push("(No enrichment data yet — use research_property to fetch it.)");
        }
        _lines.push("--- END PROPERTY CONTEXT ---");
        _enrichCtx = _lines.join("\n");
      }
    } catch (_) { /* non-blocking */ }
  }

  // Inject Atlas episodic memory into system prompt
  let _memoryCtx = "";
  try {
    const { getRelevantMemories, formatMemoriesForContext } = await import("../services/atlasMemory");
    const memories = await getRelevantMemories(org.id, agentRole || 'atlas', 15);
    _memoryCtx = formatMemoriesForContext(memories);
  } catch (_memErr) { /* non-blocking */ }

  // Inject learned user preferences into the system prompt (non-blocking)
  const _prefCtx = await loadUserPreferenceContext(org.id);
  const _knowledgeCtx = await loadOrgKnowledgeContext(org.id);
  const _projectCtx = options.activeProjectId ? await loadProjectContext(options.activeProjectId) : "";
  const _mentionCtx = options.mentionedEntities?.length
    ? `\n\n=== MENTIONED ENTITIES ===\n${options.mentionedEntities.map(e => `[${e.type.toUpperCase()}] ${e.name}: ${e.preview}`).join("\n")}\n=== END MENTIONED ENTITIES ===`
    : "";
  const _connectedIds = await storage.getConnectedConnectorIds(org.id);
  const _connectorCtx = buildConnectorContextBlock(_connectedIds);
  const _calibrationCtx = await loadCalibrationContext(org.id);
  const _systemContent = profile.systemPrompt + (_enrichCtx || "") + (_prefCtx || "") + (_calibrationCtx || "") + (_knowledgeCtx || "") + (_projectCtx || "") + (_mentionCtx || "") + (_connectorCtx || "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _systemContent },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Replace the last message with full content (including file data) for AI processing
  if (files && files.length > 0 && chatMessages.length > 1) {
    chatMessages[chatMessages.length - 1] = { role: "user", content: fullMessage };
  }

  // Replace image files with vision content parts in the last user message
  const imageFiles = (files ?? []).filter(isImageFile);
  if (imageFiles.length > 0 && chatMessages.length > 1) {
    const textPart = { type: "text" as const, text: fullMessage };
    const imageParts = imageFiles.map(buildImageContentPart);
    chatMessages[chatMessages.length - 1] = { role: "user", content: [textPart, ...imageParts] };
  }

  const hasFileAttachments = files && files.length > 0;
  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : ''
  })), hasFileAttachments);

  let client: OpenAI;
  let provider: AIProvider;
  let model: string;

  try {
    const result = getChatProviderAndModel(complexity);
    client = result.client;
    provider = result.provider;
    // Apply model override if specified; force vision-capable model for image inputs
    model = options.modelOverride
      || (imageFiles.length > 0 && !result.model.includes('gpt-4o') && !result.model.includes('claude') ? 'openai/gpt-4o' : result.model);
  } catch (error: any) {
    console.error('[AI Chat] Failed to get AI provider:', error.message);
    throw new Error("AI service temporarily unavailable. Please try again.");
  }

  console.log(`[AI Chat] Routing chat (${complexity}) -> ${provider}/${model}`);

  let response: OpenAI.ChatCompletion;
  try {
    response = await client.chat.completions.create({
      model,
      messages: chatMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 2048
    });
  } catch (error: any) {
    console.error(`[AI Chat] ${provider} API error:`, error.message, error.status, error.code);
    throw new Error("AI request failed. Please try again in a moment.");
  }
  
  try {
    const { storage } = await import('../storage');
    const estimatedTokens = JSON.stringify(chatMessages).length / 4;
    const costMultiplier = model.includes('gpt-4o') ? 0.002 : 
                          model.includes('gpt-4o-mini') ? 0.00015 : 
                          model.includes('deepseek') ? 0.00014 : 0.001;
    const estimatedCostCents = Math.ceil(estimatedTokens * costMultiplier / 10);
    await storage.logApiUsage({
      organizationId: org.id,
      service: provider,
      action: 'chat_completion',
      count: 1,
      estimatedCostCents,
      metadata: { model, complexity, provider, estimatedTokens: Math.round(estimatedTokens) },
    });
  } catch (error) {
    console.error('[AI Chat] Failed to log API usage:', error);
  }

  let assistantMessage = response.choices[0].message;
  const toolCallsExecuted: any[] = [];

  // Read-only tool prefixes — safe to parallelize
  const READ_ONLY_PREFIXES = ["get_", "search_", "calculate_", "list_", "recall_", "browse_"];

  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    const validToolCalls = assistantMessage.tool_calls.filter((tc): tc is typeof tc & { id: string; function: { name: string; arguments: string } } => 'function' in tc);
    const allReadOnly = validToolCalls.every(tc => READ_ONLY_PREFIXES.some(p => tc.function.name.startsWith(p)));

    let toolResults: OpenAI.ChatCompletionToolMessageParam[];

    if (allReadOnly && validToolCalls.length > 1) {
      // Execute read-only tools in parallel for performance
      toolResults = await Promise.all(
        validToolCalls.map(async (toolCall) => {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeTool(toolCall.function.name, args, org);
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          return { role: "tool" as const, tool_call_id: toolCall.id, content: JSON.stringify(result) };
        })
      );
    } else {
      toolResults = [];
      for (const toolCall of validToolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, org);
        toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
        toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }

    chatMessages.push(assistantMessage as any);
    chatMessages.push(...toolResults);

    try {
      response = await client.chat.completions.create({
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048
      });
    } catch (error: any) {
      console.error(`[AI Chat] ${provider} API error during tool loop:`, error.message);
      throw new Error("AI request failed during processing. Please try again.");
    }

    assistantMessage = response.choices[0].message;
  }

  const finalContent = assistantMessage.content || "I processed your request.";

  await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
  });

  if (messages.length <= 1) {
    const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
    await updateConversation(conversation.id, { title });
  }

  // Async memory extraction — fire and forget (don't block response)
  setImmediate(async () => {
    try {
      const { processConversationMemories } = await import("../services/atlasMemory");
      const allMsgs = await getMessages(conversation.id);
      const msgHistory = allMsgs.map(m => ({ role: m.role, content: m.content || '' }));
      await processConversationMemories(org.id, msgHistory, client, agentRole || 'atlas');
    } catch (_) { /* non-blocking */ }
  });

  const usage = response.usage;
  let estimatedCost: number | undefined;
  if (usage) {
    const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
      "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
      "deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },
      "gpt-4o": { input: 2.50, output: 10.00 },
      "gpt-4o-mini": { input: 0.15, output: 0.60 },
    };
    const costs = COST_PER_MILLION_TOKENS[model] || { input: 1, output: 3 };
    estimatedCost = (usage.prompt_tokens * costs.input + usage.completion_tokens * costs.output) / 1_000_000;
  }

  // Fire-and-forget quality scoring — never blocks the response
  process.nextTick(() => {
    scoreAndLearnFromResponse(org.id, message, finalContent).catch(() => {});
  });

  return {
    response: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined,
    conversationId: conversation.id,
    model,
    provider,
    estimatedCost,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens
  };
}

export async function* processChatStream(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): AsyncGenerator<{ type: string; content?: string; toolCall?: any; done?: boolean; model?: string; provider?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number }> {
  const { agentRole = "executive", files } = options;
  // Map "assistant" to "executive" and fallback to executive for unknown roles
  const roleStr = agentRole as string;
  const normalizedRole = (roleStr === "assistant" || !agentProfiles[roleStr as keyof typeof agentProfiles]) 
    ? "executive" 
    : roleStr as keyof typeof agentProfiles;
  const profile = agentProfiles[normalizedRole];
  const tools = getToolsForRole(normalizedRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  // Build the full message including file contents for AI, but store only original message in DB
  let fullMessage = message;
  let displayMessage = message; // What we show in DB and chat history
  
  if (files && files.length > 0) {
    // Add file names to display message for reference
    const fileNames = files.map(f => f.name).join(', ');
    displayMessage = `${message}\n\n[Attached files: ${fileNames}]`;
    
    // Full message with content for AI processing (async for DOCX support)
    const fileContentsArray = await Promise.all(files.map(f => formatFileContentAsync(f)));
    const fileContents = fileContentsArray.join('\n\n');
    fullMessage = `${message}\n\nThe user has attached the following file(s). Please analyze and process them according to their request:\n\n${fileContents}`;
    console.log(`[AI Stream] Processing ${files.length} file attachment(s)`);
  }

  // Store only the display message (without binary content) in the database
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: displayMessage
  });

  let messages = await getMessages(conversation.id);
  messages = await compactConversationIfNeeded(conversation.id, messages);

  // Inject property enrichment context into the system prompt when a property is open
  let _enrichCtx = "";
  const _pid = (options as ChatOptions).propertyId;
  if (_pid) {
    try {
      const _prop = await storage.getProperty(org.id, _pid);
      if (_prop) {
        const _ed = (_prop as any).enrichmentData;
        const _lines: string[] = [
          `\n\n--- ACTIVE PROPERTY CONTEXT (ID: ${_prop.id}) ---`,
          `Address: ${_prop.address || "N/A"}`,
          `Size: ${_prop.sizeAcres ? `${_prop.sizeAcres} acres` : "N/A"}`,
          `State: ${_prop.state || "N/A"}, County: ${_prop.county || "N/A"}`,
          `APN: ${_prop.apn || "N/A"}`,
        ];
        if (_ed) {
          _lines.push(`Enrichment Completeness: ${_ed.completenessScore ?? "?"}%`);
          if (_ed.hazards?.floodZone) _lines.push(`Flood Zone: ${_ed.hazards.floodZone}`);
          if (_ed.environment?.soilType) _lines.push(`Soil: ${_ed.environment.soilType}`);
          if (_ed.demographics?.population) _lines.push(`Tract Population: ${_ed.demographics.population}, Median Income: $${_ed.demographics.medianHouseholdIncome?.toLocaleString() ?? "N/A"}`);
          if (_ed.scores) _lines.push(`Scores: ${JSON.stringify(_ed.scores)}`);
          if (_ed.hazards?.wetlandsPresent !== undefined) _lines.push(`Wetlands Present: ${_ed.hazards.wetlandsPresent}`);
          if (_ed.elevation?.elevationFeet) _lines.push(`Elevation: ${_ed.elevation.elevationFeet} ft`);
          if (_ed.transportation?.nearestHighwayMiles !== undefined) _lines.push(`Nearest Highway: ${_ed.transportation.nearestHighwayMiles} mi`);
        } else {
          _lines.push("(No enrichment data yet — use research_property to fetch it.)");
        }
        _lines.push("--- END PROPERTY CONTEXT ---");
        _enrichCtx = _lines.join("\n");
      }
    } catch (_) { /* non-blocking */ }
  }

  // Inject Atlas episodic memory into system prompt
  let _memoryCtx = "";
  try {
    const { getRelevantMemories, formatMemoriesForContext } = await import("../services/atlasMemory");
    const memories = await getRelevantMemories(org.id, agentRole || 'atlas', 15);
    _memoryCtx = formatMemoriesForContext(memories);
  } catch (_memErr) { /* non-blocking */ }

  // Inject learned user preferences into the system prompt (non-blocking)
  const _prefCtx = await loadUserPreferenceContext(org.id);
  const _knowledgeCtx = await loadOrgKnowledgeContext(org.id);
  const _projectCtx = options.activeProjectId ? await loadProjectContext(options.activeProjectId) : "";
  const _mentionCtx = options.mentionedEntities?.length
    ? `\n\n=== MENTIONED ENTITIES ===\n${options.mentionedEntities.map(e => `[${e.type.toUpperCase()}] ${e.name}: ${e.preview}`).join("\n")}\n=== END MENTIONED ENTITIES ===`
    : "";
  const _connectedIds = await storage.getConnectedConnectorIds(org.id);
  const _connectorCtx = buildConnectorContextBlock(_connectedIds);
  const _calibrationCtx = await loadCalibrationContext(org.id);
  const _systemContent = profile.systemPrompt + (_enrichCtx || "") + (_prefCtx || "") + (_calibrationCtx || "") + (_knowledgeCtx || "") + (_projectCtx || "") + (_mentionCtx || "") + (_connectorCtx || "");

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _systemContent },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Handle image files — build vision content parts
  const streamImageFiles = (files ?? []).filter(isImageFile);
  if (streamImageFiles.length > 0 && chatMessages.length > 1) {
    const textPart = { type: "text" as const, text: fullMessage };
    const imageParts = streamImageFiles.map(buildImageContentPart);
    chatMessages[chatMessages.length - 1] = { role: "user", content: [textPart, ...imageParts] };
  } else if (files && files.length > 0 && chatMessages.length > 1) {
    chatMessages[chatMessages.length - 1] = { role: "user", content: fullMessage };
  }

  const hasFileAttachments = files && files.length > 0;
  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : ''
  })), hasFileAttachments);

  let client: OpenAI;
  let provider: AIProvider;
  let model: string;

  try {
    const result = getChatProviderAndModel(complexity);
    client = result.client;
    provider = result.provider;
    model = options.modelOverride
      || (streamImageFiles.length > 0 && !result.model.includes('gpt-4o') && !result.model.includes('claude') ? 'openai/gpt-4o' : result.model);
  } catch (error: any) {
    console.error('[AI Stream] Failed to get AI provider:', error.message);
    yield { type: "error", content: "AI service temporarily unavailable. Please try again." };
    return;
  }

  // Reasoning trace — for COMPLEX requests
  if (complexity === TaskComplexity.COMPLEX) {
    try {
      yield { type: "thinking_start" };
      let thinkingText = "";

      if (model.includes('claude')) {
        // Real Claude extended thinking via OpenRouter
        // Use a non-streaming call to get native thinking content blocks
        const thinkingResponse = await client.chat.completions.create({
          model,
          messages: chatMessages as any,
          max_tokens: 8000,
          // @ts-ignore — OpenRouter passes thinking param to Anthropic API
          thinking: { type: "enabled", budget_tokens: 6000 },
        } as any);
        const msgContent = (thinkingResponse as any).choices?.[0]?.message?.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'thinking' && block.thinking) {
              // Stream thinking text in chunks for smooth UI
              const chunks = (block.thinking as string).match(/[\s\S]{1,60}/g) || [];
              for (const chunk of chunks) {
                thinkingText += chunk;
                yield { type: "thinking", content: chunk };
              }
            }
          }
        }
      } else {
        // Simulated thinking for non-Claude models
        const thinkingStream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "You are planning how to answer a complex real estate question. Think step-by-step about what information you need, what tools to use, and what the user actually wants. Be brief but thorough. Max 3-4 sentences." },
            { role: "user", content: message }
          ],
          max_tokens: 300,
          stream: true,
        });
        for await (const chunk of thinkingStream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            thinkingText += delta;
            yield { type: "thinking", content: delta };
          }
        }
      }

      yield { type: "thinking_done" };
    } catch {
      // Non-blocking — ignore thinking errors
    }
  }

  console.log(`[AI Stream] Routing chat stream (${complexity}) -> ${provider}/${model}`);

  let fullResponse = "";
  const toolCallsExecuted: any[] = [];
  let continueLoop = true;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  while (continueLoop) {
    let stream;
    try {
      stream = await client.chat.completions.create({
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true }
      });
    } catch (error: any) {
      console.error(`[AI Stream] ${provider} API error:`, error.message);
      yield { type: "error", content: "AI request failed. Please try again." };
      return;
    }

    let currentToolCalls: any[] = [];
    let currentContent = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        currentContent += delta.content;
        yield { type: "content", content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            if (!currentToolCalls[tc.index]) {
              currentToolCalls[tc.index] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) currentToolCalls[tc.index].id = tc.id;
            if (tc.function?.name) currentToolCalls[tc.index].function.name = tc.function.name;
            if (tc.function?.arguments) currentToolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
      }
      
      if (chunk.usage) {
        totalPromptTokens += chunk.usage.prompt_tokens || 0;
        totalCompletionTokens += chunk.usage.completion_tokens || 0;
      }
    }

    if (currentToolCalls.length > 0) {
      const ARTIFACT_TOOLS: Record<string, { type: "card" | "table" | "document"; title: string }> = {
        calculate_roi:            { type: "card",     title: "ROI Analysis" },
        calculate_amortization:   { type: "table",    title: "Amortization Schedule" },
        run_comps_analysis:       { type: "table",    title: "Comparable Sales" },
        generate_offer:           { type: "document", title: "Offer" },
        generate_offer_letter:    { type: "document", title: "Offer Letter" },
        get_cashflow_summary:     { type: "card",     title: "Cash Flow Summary" },
      };

      const STREAM_READ_ONLY = ["get_", "search_", "calculate_", "list_", "recall_", "browse_"];
      const streamAllReadOnly = currentToolCalls.every(tc => STREAM_READ_ONLY.some(p => tc.function.name.startsWith(p)));
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      if (streamAllReadOnly && currentToolCalls.length > 1) {
        // Emit all tool_start events first (parallel signal to UI)
        for (const toolCall of currentToolCalls) {
          yield { type: "tool_start", toolCall: { name: toolCall.function.name } };
        }
        // Execute in parallel
        const parallelResults = await Promise.all(
          currentToolCalls.map(async (toolCall) => {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, org);
            return { toolCall, args, result };
          })
        );
        for (const { toolCall, args, result } of parallelResults) {
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };
          const artifactMeta = ARTIFACT_TOOLS[toolCall.function.name];
          if (artifactMeta) {
            try {
              const parsed = typeof result === "string" ? JSON.parse(result) : result;
              const data = parsed?.data ?? parsed;
              if (data) yield { type: "artifact", artifactType: artifactMeta.type, title: artifactMeta.title, data } as any;
            } catch {}
          }
          toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
        }
      } else {
        for (const toolCall of currentToolCalls) {
          yield { type: "tool_start", toolCall: { name: toolCall.function.name } };
          const args = JSON.parse(toolCall.function.arguments);

          // Pre-approval gate for communication/payment tools
          if (APPROVAL_REQUIRED_TOOLS.has(toolCall.function.name)) {
            yield { type: "approval_required", toolCallId: toolCall.id, toolName: toolCall.function.name, args } as any;
            const syntheticResult = {
              success: false,
              requiresApproval: true,
              message: `This action requires your explicit approval before it can be sent. The user will confirm in the chat.`,
            };
            toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result: syntheticResult });
            yield { type: "tool_result", toolCall: { name: toolCall.function.name, result: syntheticResult } };
            toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(syntheticResult) });
            continue;
          }

          const result = await executeTool(toolCall.function.name, args, org);
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };
          const artifactMeta = ARTIFACT_TOOLS[toolCall.function.name];
          if (artifactMeta) {
            try {
              const parsed = typeof result === "string" ? JSON.parse(result) : result;
              const data = parsed?.data ?? parsed;
              if (data) yield { type: "artifact", artifactType: artifactMeta.type, title: artifactMeta.title, data } as any;
            } catch {}
          }
          toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
        }
      }

      chatMessages.push({
        role: "assistant",
        content: currentContent || null,
        tool_calls: currentToolCalls
      } as any);
      chatMessages.push(...toolResults);
    } else {
      fullResponse = currentContent;
      continueLoop = false;
    }
  }

  await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: fullResponse,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
  });

  if (messages.length <= 1) {
    const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
    await updateConversation(conversation.id, { title });
  }

  let estimatedCost: number | undefined;
  if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
    const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
      "deepseek/deepseek-chat": { input: 0.14, output: 0.28 },
      "deepseek/deepseek-reasoner": { input: 0.55, output: 2.19 },
      "gpt-4o": { input: 2.50, output: 10.00 },
      "gpt-4o-mini": { input: 0.15, output: 0.60 },
    };
    const costs = COST_PER_MILLION_TOKENS[model] || { input: 1, output: 3 };
    estimatedCost = (totalPromptTokens * costs.input + totalCompletionTokens * costs.output) / 1_000_000;
  }

  yield { 
    type: "done", 
    done: true, 
    model, 
    provider, 
    estimatedCost,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens
  };
}

export { agentProfiles as agents };

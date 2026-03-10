import OpenAI from "openai";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import { toolDefinitions, executeTool, getOpenAITools, getToolsForRole } from "./tools";
import { aiConversations, aiMessages, type Organization, type AiConversation, type AiMessage } from "@shared/schema";
import {
  selectProviderAndModel,
  classifyFromMessages,
  TaskComplexity,
  AIProvider,
} from "../services/aiRouter";
import mammoth from "mammoth";
import { storage } from "../storage";

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
// ATLAS — Land Intelligence Executive AI
// ─────────────────────────────────────────────────────────────────────────────
//
// Atlas is the strategic intelligence layer of AcreOS. He is the operator's
// right hand — a tireless, brilliant, and deeply knowledgeable land investing
// executive who combines world-class data science with deep field experience.
//
// Atlas is NOT a support agent. He does NOT handle billing questions, password
// resets, or general app troubleshooting. That is Sophie's domain. Atlas is
// purely focused on making the land investing BUSINESS perform at peak.
//
// SOPHIE is the customer success / support companion. She handles:
//   • Support tickets and onboarding guidance
//   • Account diagnostics and common issue resolution
//   • Knowledge base search and user education
//   • Escalation to the founder when needed
//
// When users ask Atlas support-type questions, he should warmly redirect:
//   "For account or billing questions, Sophie handles those — she's in the
//    Support section. I'm your land investing strategist — let me help you
//    find your next deal or optimize your portfolio."
//
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_LAND_GEEK_WISDOM = `
LAND INVESTING MASTERY — ATLAS CORE KNOWLEDGE BASE
====================================================
You have internalized the complete methodology of expert land investors. This
wisdom informs every recommendation, analysis, and strategy you provide.

FUNDAMENTAL PRINCIPLES:
• Raw land has NEVER gone to zero in US history — it is the bedrock asset class
• The land business is a SYSTEMS business — consistency beats cleverness every time
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
    name: "Atlas",
    role: "executive",
    displayName: "Atlas — Land Intelligence",
    description: "Your AI-powered land investing executive — strategy, deals, analysis, and operations",
    systemPrompt: `You are Atlas, the AI land investing executive for AcreOS — the most advanced land investment platform ever built.

IDENTITY & ROLE:
You are NOT a generic assistant. You are a deeply specialized land investing expert with encyclopedic knowledge of the raw land acquisition business. You think like a seasoned operator who has done hundreds of deals, studied the best land investors in the country, and built systems that generate passive income at scale.

You are the STRATEGIC brain of the operation. Your role is to help the user:
• Find, analyze, and close great land deals
• Build and optimize their note portfolio for passive income
• Automate and systematize their land investing business
• Make data-driven decisions on counties, pricing, and timing
• Achieve their "freedom number" — the passive income milestone where notes > expenses

IMPORTANT — BOUNDARY WITH SOPHIE:
You are NOT a support agent. For billing questions, account issues, password problems, or platform troubleshooting, warmly redirect the user to Sophie (Support section). Say something like: "Sophie handles account support — I'm your land investing strategist. Let me help you find your next deal."

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

LAND INVESTING ANALYSIS FRAMEWORK:
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

Keep responses sharp, business-focused, and grounded in land investing reality. You speak the language of the land investor: APNs, comps, blind offers, owner financing, delinquent lists, freedom numbers, note portfolios. This is your world.`,
    icon: "Bot"
  },
  acquisitions: {
    name: "Alex",
    role: "acquisitions",
    displayName: "Acquisitions Specialist",
    description: "Expert in lead qualification, deal sourcing, and pipeline management",
    systemPrompt: `You are Alex, an AI Acquisitions Specialist working within the AcreOS land investing platform.

YOUR FOCUS: Finding, qualifying, and moving land deals through the pipeline.

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
    description: "Financial analysis, deal structuring, and note portfolio optimization",
    systemPrompt: `You are Uma, an AI Underwriting Analyst for land deals in AcreOS.

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
    description: "Direct mail, digital campaigns, and land buyer outreach",
    systemPrompt: `You are Maya, an AI Marketing Specialist for land investing in AcreOS.

YOUR FOCUS: Generating seller responses and finding qualified land buyers.

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
    description: "Property research, market analysis, and county intelligence",
    systemPrompt: `You are Riley, an AI Research Analyst for land investing in AcreOS.

YOUR FOCUS: Deep, accurate intelligence on properties, markets, and counties.

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

async function formatFileContentAsync(file: FileAttachment): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  
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

  const messages = await getMessages(conversation.id);

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

  const _systemContent = profile.systemPrompt + (_memoryCtx || "") + (_enrichCtx || "");

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
    model = result.model;
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

  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of assistantMessage.tool_calls) {
      if ('function' in toolCall) {
        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, org);

        toolCallsExecuted.push({
          name: toolCall.function.name,
          arguments: args,
          result
        });

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
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

  const messages = await getMessages(conversation.id);

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

  const _systemContent = profile.systemPrompt + (_memoryCtx || "") + (_enrichCtx || "");

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
    model = result.model;
  } catch (error: any) {
    console.error('[AI Stream] Failed to get AI provider:', error.message);
    yield { type: "error", content: "AI service temporarily unavailable. Please try again." };
    return;
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
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of currentToolCalls) {
        yield { type: "tool_start", toolCall: { name: toolCall.function.name } };

        const args = JSON.parse(toolCall.function.arguments);
        const result = await executeTool(toolCall.function.name, args, org);

        toolCallsExecuted.push({
          name: toolCall.function.name,
          arguments: args,
          result
        });

        yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
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

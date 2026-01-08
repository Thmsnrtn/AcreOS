import { z } from "zod";
import { storage } from "../storage";
import { dataSourceBroker, type LookupCategory } from "./data-source-broker";
import { lookupParcel } from "./parcel";
import { getPropertyComps, calculateMarketValue, calculateOfferPrices, calculateDesirabilityScore } from "./comps";
import { emailService } from "./emailService";
import { generateOfferLetter as generateOfferDocument } from "./documents";

export type CoreAgentType = "research" | "deals" | "communications" | "operations";

export interface AgentContext {
  organizationId: number;
  userId?: string;
  relatedLeadId?: number;
  relatedPropertyId?: number;
  relatedDealId?: number;
}

export interface SkillResult {
  success: boolean;
  data?: any;
  message?: string;
  error?: string;
  costIncurred?: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  agentTypes: CoreAgentType[];
  inputSchema: z.ZodSchema;
  execute: (params: any, context: AgentContext) => Promise<SkillResult>;
  examples?: string[];
  costEstimate?: "free" | "low" | "medium" | "high";
}

const lookupParcelInputSchema = z.object({
  apn: z.string().describe("Assessor Parcel Number"),
  state: z.string().describe("Two-letter state code"),
  county: z.string().describe("County name"),
});

const lookupParcelSkill: Skill = {
  id: "lookupParcel",
  name: "Lookup Parcel",
  description: "Retrieves parcel boundary and ownership data from county GIS or Regrid API",
  agentTypes: ["research", "deals"],
  inputSchema: lookupParcelInputSchema,
  costEstimate: "low",
  examples: [
    'lookupParcel({ apn: "123-456-789", state: "TX", county: "Travis" })',
    "Use this to get parcel boundaries, owner info, and tax data",
  ],
  execute: async (params, context) => {
    try {
      const { apn, state, county } = lookupParcelInputSchema.parse(params);
      const result = await lookupParcel(apn, state, county);
      
      if (!result.found) {
        return {
          success: false,
          message: result.error || "Parcel not found",
        };
      }

      return {
        success: true,
        data: result.parcel,
        message: `Found parcel ${apn} via ${result.source}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Parcel lookup failed",
      };
    }
  },
};

const lookupEnvironmentalInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  categories: z
    .array(z.enum(["flood_zone", "wetlands", "soil", "environmental"]))
    .optional()
    .describe("Specific categories to lookup"),
  state: z.string().optional(),
  county: z.string().optional(),
});

const lookupEnvironmentalSkill: Skill = {
  id: "lookupEnvironmental",
  name: "Lookup Environmental Risks",
  description: "Checks for flood zones, wetlands, soil conditions, and EPA sites near a property",
  agentTypes: ["research"],
  inputSchema: lookupEnvironmentalInputSchema,
  costEstimate: "free",
  examples: [
    'lookupEnvironmental({ latitude: 30.2672, longitude: -97.7431 })',
    'lookupEnvironmental({ latitude: 30.2672, longitude: -97.7431, categories: ["flood_zone", "wetlands"] })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, categories, state, county } = lookupEnvironmentalInputSchema.parse(params);
      const lookupCategories: LookupCategory[] = categories || ["flood_zone", "wetlands", "soil", "environmental"];
      
      const results: Record<string, any> = {};
      const riskFactors: string[] = [];
      let riskScore = 0;

      for (const category of lookupCategories) {
        try {
          const result = await dataSourceBroker.lookup(category, {
            latitude,
            longitude,
            state,
            county,
          });
          results[category] = result;

          if (result.success && result.data) {
            if (category === "flood_zone" && result.data.riskLevel === "high") {
              riskFactors.push("High flood risk zone");
              riskScore += 3;
            } else if (category === "flood_zone" && result.data.riskLevel === "medium") {
              riskFactors.push("Moderate flood risk");
              riskScore += 1;
            }
            if (category === "wetlands" && result.data.hasWetlands) {
              riskFactors.push("Wetlands present on property");
              riskScore += 2;
            }
            if (category === "environmental" && result.data.riskLevel === "high") {
              riskFactors.push("EPA sites nearby");
              riskScore += 2;
            }
          }
        } catch (error: any) {
          results[category] = { success: false, error: error.message };
        }
      }

      const riskLevel = riskScore >= 4 ? "high" : riskScore >= 2 ? "medium" : "low";

      return {
        success: true,
        data: {
          lookupResults: results,
          riskAssessment: {
            level: riskLevel,
            score: riskScore,
            factors: riskFactors.length > 0 ? riskFactors : ["No significant risk factors identified"],
          },
        },
        message: `Environmental analysis complete: ${riskLevel} risk`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Environmental lookup failed",
      };
    }
  },
};

const generateOfferInputSchema = z.object({
  leadId: z.number().optional().describe("Lead ID for seller information"),
  propertyId: z.number().optional().describe("Property ID for property details"),
  offerPrice: z.number().describe("Offer amount in dollars"),
  terms: z.string().optional().describe("Offer terms (e.g., cash purchase, 30-day close)"),
  customNotes: z.string().optional().describe("Additional notes to include"),
});

const generateOfferSkill: Skill = {
  id: "generateOffer",
  name: "Generate Offer Letter",
  description: "Creates a professional land purchase offer letter with all necessary details",
  agentTypes: ["deals", "communications"],
  inputSchema: generateOfferInputSchema,
  costEstimate: "low",
  examples: [
    'generateOffer({ leadId: 123, propertyId: 456, offerPrice: 25000 })',
    'generateOffer({ propertyId: 789, offerPrice: 15000, terms: "Cash, 45-day close" })',
  ],
  execute: async (params, context) => {
    try {
      const { leadId, propertyId, offerPrice, terms, customNotes } = generateOfferInputSchema.parse(params);

      let lead = null;
      let property = null;

      if (leadId) {
        lead = await storage.getLead(context.organizationId, leadId);
      }
      if (propertyId) {
        property = await storage.getProperty(context.organizationId, propertyId);
      }

      const org = await storage.getOrganization(context.organizationId);
      const sellerName = lead ? `${lead.firstName} ${lead.lastName}` : "[Seller Name]";
      const propertyAddress = property?.address || "[Property Address]";
      const propertyLocation = property ? `${property.city || ""}, ${property.state || ""}`.trim() : "";

      const offerLetter = `
PURCHASE OFFER

Date: ${new Date().toLocaleDateString()}

To: ${sellerName}
From: ${org?.name || "Acreage Land Co."}

Dear ${lead?.firstName || "Property Owner"},

We are pleased to present you with a formal offer to purchase your property located at:

${propertyAddress}
${propertyLocation}

OFFER DETAILS:
- Purchase Price: $${offerPrice.toLocaleString()}
- Terms: ${terms || "Cash purchase, 30-day closing"}
${customNotes ? `\nAdditional Notes:\n${customNotes}` : ""}

This offer is contingent upon:
1. Clear and marketable title
2. Satisfactory inspection of the property
3. Verification of property boundaries

This offer is valid for 30 days from the date above.

We look forward to your response and would be happy to discuss any questions you may have.

Sincerely,
${org?.name || "Acreage Land Co."}
      `.trim();

      return {
        success: true,
        data: {
          offerLetter,
          offerPrice,
          leadId,
          propertyId,
          generatedAt: new Date().toISOString(),
        },
        message: `Offer letter generated for $${offerPrice.toLocaleString()}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to generate offer",
      };
    }
  },
};

const sendEmailInputSchema = z.object({
  to: z.string().email().describe("Recipient email address"),
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body content (HTML or plain text)"),
  leadId: z.number().optional().describe("Optional lead ID for tracking"),
});

const sendEmailSkill: Skill = {
  id: "sendEmail",
  name: "Send Email",
  description: "Sends an email using the configured email service (AWS SES)",
  agentTypes: ["communications"],
  inputSchema: sendEmailInputSchema,
  costEstimate: "low",
  examples: [
    'sendEmail({ to: "seller@example.com", subject: "Property Inquiry", body: "Hello..." })',
  ],
  execute: async (params, context) => {
    try {
      const { to, subject, body, leadId } = sendEmailInputSchema.parse(params);

      const isConfigured = await emailService.isConfigured(context.organizationId);
      if (!isConfigured) {
        return {
          success: false,
          error: "Email service not configured. Please configure AWS SES credentials.",
        };
      }

      const result = await emailService.sendEmail({
        to,
        subject,
        html: body.includes("<") ? body : `<p>${body.replace(/\n/g, "</p><p>")}</p>`,
        organizationId: context.organizationId,
      });

      if (result.success) {
        return {
          success: true,
          data: {
            messageId: result.messageId,
            to,
            subject,
            leadId,
          },
          message: `Email sent successfully to ${to}`,
        };
      } else {
        return {
          success: false,
          error: result.error || "Failed to send email",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Email sending failed",
      };
    }
  },
};

const calculateFinancingInputSchema = z.object({
  principal: z.number().describe("Loan principal amount"),
  interestRate: z.number().describe("Annual interest rate (e.g., 10 for 10%)"),
  termMonths: z.number().describe("Loan term in months"),
  downPayment: z.number().optional().describe("Optional down payment amount"),
});

const calculateFinancingSkill: Skill = {
  id: "calculateFinancing",
  name: "Calculate Financing",
  description: "Calculates loan amortization including monthly payment, total interest, and payment schedule",
  agentTypes: ["deals", "operations"],
  inputSchema: calculateFinancingInputSchema,
  costEstimate: "free",
  examples: [
    'calculateFinancing({ principal: 50000, interestRate: 10, termMonths: 60 })',
    'calculateFinancing({ principal: 30000, interestRate: 8.5, termMonths: 48, downPayment: 5000 })',
  ],
  execute: async (params, _context) => {
    try {
      const { principal, interestRate, termMonths, downPayment } = calculateFinancingInputSchema.parse(params);

      const loanAmount = principal - (downPayment || 0);
      const monthlyRate = interestRate / 100 / 12;
      
      let monthlyPayment: number;
      if (monthlyRate === 0) {
        monthlyPayment = loanAmount / termMonths;
      } else {
        monthlyPayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
                         (Math.pow(1 + monthlyRate, termMonths) - 1);
      }

      const totalPayments = monthlyPayment * termMonths;
      const totalInterest = totalPayments - loanAmount;

      const schedule = [];
      let balance = loanAmount;
      for (let i = 1; i <= Math.min(termMonths, 12); i++) {
        const interestPayment = balance * monthlyRate;
        const principalPayment = monthlyPayment - interestPayment;
        balance -= principalPayment;
        schedule.push({
          paymentNumber: i,
          payment: Math.round(monthlyPayment * 100) / 100,
          principal: Math.round(principalPayment * 100) / 100,
          interest: Math.round(interestPayment * 100) / 100,
          balance: Math.max(0, Math.round(balance * 100) / 100),
        });
      }

      return {
        success: true,
        data: {
          loanAmount: Math.round(loanAmount * 100) / 100,
          monthlyPayment: Math.round(monthlyPayment * 100) / 100,
          totalPayments: Math.round(totalPayments * 100) / 100,
          totalInterest: Math.round(totalInterest * 100) / 100,
          termMonths,
          interestRate,
          downPayment: downPayment || 0,
          sampleSchedule: schedule,
        },
        message: `Monthly payment: $${(Math.round(monthlyPayment * 100) / 100).toLocaleString()}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Financing calculation failed",
      };
    }
  },
};

const researchCompsInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  subjectAcreage: z.number().describe("Subject property acreage"),
  radiusMiles: z.number().optional().default(5).describe("Search radius in miles"),
  minAcreage: z.number().optional().describe("Minimum comparable acreage"),
  maxAcreage: z.number().optional().describe("Maximum comparable acreage"),
  maxResults: z.number().optional().default(20).describe("Maximum number of comps"),
});

const researchCompsSkill: Skill = {
  id: "researchComps",
  name: "Research Comparable Sales",
  description: "Finds comparable property sales nearby and calculates market value estimates",
  agentTypes: ["research", "deals"],
  inputSchema: researchCompsInputSchema,
  costEstimate: "medium",
  examples: [
    'researchComps({ latitude: 30.2672, longitude: -97.7431, subjectAcreage: 5 })',
    'researchComps({ latitude: 30.2672, longitude: -97.7431, subjectAcreage: 10, radiusMiles: 10, maxResults: 30 })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, subjectAcreage, radiusMiles, minAcreage, maxAcreage, maxResults } = 
        researchCompsInputSchema.parse(params);

      const result = await getPropertyComps(
        latitude,
        longitude,
        subjectAcreage,
        radiusMiles,
        { minAcreage, maxAcreage, maxResults },
        undefined,
        context.organizationId
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Comps search failed",
        };
      }

      return {
        success: true,
        data: {
          comps: result.comps,
          marketAnalysis: result.marketAnalysis,
          offerPrices: result.offerPrices,
          limitedData: result.limitedData,
          message: result.message,
        },
        message: `Found ${result.comps.length} comparable properties`,
        costIncurred: result.comps.length > 0 ? 2 : 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Comps research failed",
      };
    }
  },
};

const enrichLeadInputSchema = z.object({
  leadId: z.number().describe("Lead ID to enrich"),
  enrichmentTypes: z
    .array(z.enum(["property_data", "environmental", "comps"]))
    .optional()
    .describe("Types of enrichment to perform"),
});

const enrichLeadSkill: Skill = {
  id: "enrichLead",
  name: "Enrich Lead Data",
  description: "Enriches a lead with additional property data, environmental info, and comparable sales",
  agentTypes: ["research", "operations"],
  inputSchema: enrichLeadInputSchema,
  costEstimate: "medium",
  examples: [
    'enrichLead({ leadId: 123 })',
    'enrichLead({ leadId: 456, enrichmentTypes: ["property_data", "environmental"] })',
  ],
  execute: async (params, context) => {
    try {
      const { leadId, enrichmentTypes } = enrichLeadInputSchema.parse(params);
      
      const lead = await storage.getLead(context.organizationId, leadId);
      if (!lead) {
        return {
          success: false,
          error: "Lead not found",
        };
      }

      const types = enrichmentTypes || ["property_data", "environmental", "comps"];
      const enrichmentResults: Record<string, any> = {};
      
      const properties = await storage.getPropertiesByLead(context.organizationId, leadId);
      const property = properties[0];

      if (!property) {
        return {
          success: false,
          error: "No property associated with this lead",
        };
      }

      const lat = property.latitude ? parseFloat(property.latitude) : null;
      const lng = property.longitude ? parseFloat(property.longitude) : null;

      if (types.includes("property_data") && property.apn && property.state && property.county) {
        try {
          const parcelResult = await lookupParcel(property.apn, property.state, property.county);
          enrichmentResults.property_data = parcelResult;
        } catch (error: any) {
          enrichmentResults.property_data = { success: false, error: error.message };
        }
      }

      if (types.includes("environmental") && lat && lng) {
        try {
          const categories: LookupCategory[] = ["flood_zone", "wetlands", "soil", "environmental"];
          const envResults: Record<string, any> = {};
          
          for (const category of categories) {
            try {
              envResults[category] = await dataSourceBroker.lookup(category, {
                latitude: lat,
                longitude: lng,
                state: property.state || undefined,
                county: property.county || undefined,
              });
            } catch {
              envResults[category] = { success: false };
            }
          }
          enrichmentResults.environmental = envResults;
        } catch (error: any) {
          enrichmentResults.environmental = { success: false, error: error.message };
        }
      }

      if (types.includes("comps") && lat && lng) {
        try {
          const acreage = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;
          const compsResult = await getPropertyComps(lat, lng, acreage, 5, {}, undefined, context.organizationId);
          enrichmentResults.comps = {
            count: compsResult.comps.length,
            marketAnalysis: compsResult.marketAnalysis,
            offerPrices: compsResult.offerPrices,
          };
        } catch (error: any) {
          enrichmentResults.comps = { success: false, error: error.message };
        }
      }

      return {
        success: true,
        data: {
          leadId,
          propertyId: property.id,
          enrichments: enrichmentResults,
        },
        message: `Lead ${leadId} enriched with ${types.join(", ")}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Lead enrichment failed",
      };
    }
  },
};

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    this.registerDefaultSkills();
  }

  private registerDefaultSkills(): void {
    this.registerSkill(lookupParcelSkill);
    this.registerSkill(lookupEnvironmentalSkill);
    this.registerSkill(generateOfferSkill);
    this.registerSkill(sendEmailSkill);
    this.registerSkill(calculateFinancingSkill);
    this.registerSkill(researchCompsSkill);
    this.registerSkill(enrichLeadSkill);
  }

  registerSkill(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      console.warn(`[SkillRegistry] Overwriting existing skill: ${skill.id}`);
    }
    this.skills.set(skill.id, skill);
    console.log(`[SkillRegistry] Registered skill: ${skill.id}`);
  }

  unregisterSkill(skillId: string): boolean {
    return this.skills.delete(skillId);
  }

  getSkillById(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  getSkillsForAgent(agentType: CoreAgentType): Skill[] {
    return Array.from(this.skills.values()).filter((skill) =>
      skill.agentTypes.includes(agentType)
    );
  }

  getSkillDescriptionsForAgent(agentType: CoreAgentType): string {
    const skills = this.getSkillsForAgent(agentType);
    if (skills.length === 0) return "";

    const descriptions = skills.map((skill) => {
      let desc = `- ${skill.name} (${skill.id}): ${skill.description}`;
      if (skill.costEstimate) {
        desc += ` [Cost: ${skill.costEstimate}]`;
      }
      if (skill.examples && skill.examples.length > 0) {
        desc += `\n  Example: ${skill.examples[0]}`;
      }
      return desc;
    });

    return `\n\nAVAILABLE SKILLS:\n${descriptions.join("\n")}`;
  }

  async executeSkill(
    skillId: string,
    params: any,
    context: AgentContext
  ): Promise<SkillResult> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }

    try {
      const validatedParams = skill.inputSchema.parse(params);
      console.log(`[SkillRegistry] Executing skill: ${skillId}`, { context: { organizationId: context.organizationId } });
      
      const startTime = Date.now();
      const result = await skill.execute(validatedParams, context);
      const duration = Date.now() - startTime;
      
      console.log(`[SkillRegistry] Skill ${skillId} completed in ${duration}ms`, { success: result.success });
      
      return result;
    } catch (error: any) {
      if (error.name === "ZodError") {
        return {
          success: false,
          error: `Invalid parameters: ${error.message}`,
        };
      }
      return {
        success: false,
        error: error.message || `Skill execution failed: ${skillId}`,
      };
    }
  }

  getSkillsMetadata(): Array<{
    id: string;
    name: string;
    description: string;
    agentTypes: CoreAgentType[];
    costEstimate?: string;
    examples?: string[];
  }> {
    return Array.from(this.skills.values()).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      agentTypes: skill.agentTypes,
      costEstimate: skill.costEstimate,
      examples: skill.examples,
    }));
  }
}

export const skillRegistry = new SkillRegistry();

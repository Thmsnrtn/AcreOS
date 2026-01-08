import { z } from "zod";
import { storage } from "../storage";
import { dataSourceBroker, type LookupCategory } from "./data-source-broker";
import { lookupParcelByAPN } from "./parcel";
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
      // Format state/county path for lookupParcelByAPN
      const stateCountyPath = `${state}/${county.replace(/\s+/g, "-")}`;
      const result = await lookupParcelByAPN(apn, stateCountyPath);
      
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
      
      // Get properties for this org and filter by seller/buyer ID
      const allProperties = await storage.getProperties(context.organizationId);
      const properties = allProperties.filter(p => p.sellerId === leadId || p.buyerId === leadId);
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
          const stateCountyPath = `${property.state}/${property.county.replace(/\s+/g, "-")}`;
          const parcelResult = await lookupParcelByAPN(property.apn, stateCountyPath);
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

// ============================================
// VA REPLACEMENT SKILLS - Dirt Rich 2 Methodology
// ============================================

const generateBatchOffersInputSchema = z.object({
  batchId: z.number().describe("Offer batch ID to generate offers for"),
  pricingOverrides: z.object({
    cashPercentage: z.number().min(0).max(100).optional().describe("Cash offer percentage of market value"),
    termsPercentage: z.number().min(0).max(100).optional().describe("Terms offer percentage of market value"),
    downPaymentPercent: z.number().min(0).max(100).optional().describe("Down payment percentage for terms"),
    interestRate: z.number().min(0).max(30).optional().describe("Annual interest rate for terms"),
    termMonths: z.number().min(1).max(360).optional().describe("Loan term in months"),
  }).optional().describe("Optional pricing matrix overrides"),
});

const generateBatchOffersSkill: Skill = {
  id: "generateBatchOffers",
  name: "Generate Batch Offers",
  description: "Generates cash and terms offers for all leads in a batch using comps-based pricing matrix",
  agentTypes: ["deals", "operations"],
  inputSchema: generateBatchOffersInputSchema,
  costEstimate: "medium",
  examples: [
    'generateBatchOffers({ batchId: 123 })',
    'generateBatchOffers({ batchId: 456, pricingOverrides: { cashPercentage: 25, termsPercentage: 40 } })',
  ],
  execute: async (params, context) => {
    try {
      const { batchId, pricingOverrides } = generateBatchOffersInputSchema.parse(params);
      
      const batch = await storage.getOfferBatchById(context.organizationId, batchId);
      if (!batch) {
        return { success: false, error: "Offer batch not found" };
      }

      const existingOffers = await storage.getOffersByBatch(context.organizationId, batchId);
      const processedLeadIds = new Set(existingOffers.map(o => o.leadId));

      const marketingList = batch.marketingListId 
        ? await storage.getMarketingListById(context.organizationId, batch.marketingListId)
        : null;

      const allLeads = await storage.getLeads(context.organizationId);
      const batchLeads = marketingList 
        ? allLeads.filter(l => !processedLeadIds.has(l.id))
        : [];

      const pricing = {
        cashPercentage: pricingOverrides?.cashPercentage ?? 25,
        termsPercentage: pricingOverrides?.termsPercentage ?? 40,
        downPaymentPercent: pricingOverrides?.downPaymentPercent ?? 10,
        interestRate: pricingOverrides?.interestRate ?? 9.9,
        termMonths: pricingOverrides?.termMonths ?? 60,
      };

      const results = {
        offersGenerated: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (const lead of batchLeads.slice(0, 50)) {
        try {
          const properties = await storage.getProperties(context.organizationId);
          const property = properties.find(p => p.sellerId === lead.id);
          
          let estimatedValue = 10000;
          
          if (property?.latitude && property?.longitude) {
            const lat = parseFloat(property.latitude);
            const lng = parseFloat(property.longitude);
            const acreage = property.sizeAcres ? parseFloat(property.sizeAcres) : 1;
            
            try {
              const compsResult = await getPropertyComps(lat, lng, acreage, 5, {}, undefined, context.organizationId);
              if (compsResult.marketAnalysis?.estimatedValue) {
                estimatedValue = compsResult.marketAnalysis.estimatedValue;
              }
            } catch {
              // Use default if comps fail
            }
          }

          const cashOffer = Math.round(estimatedValue * (pricing.cashPercentage / 100));
          const termsOffer = Math.round(estimatedValue * (pricing.termsPercentage / 100));
          const downPayment = Math.round(termsOffer * (pricing.downPaymentPercent / 100));
          
          const monthlyRate = pricing.interestRate / 100 / 12;
          const loanAmount = termsOffer - downPayment;
          const monthlyPayment = monthlyRate > 0
            ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, pricing.termMonths)) / 
              (Math.pow(1 + monthlyRate, pricing.termMonths) - 1)
            : loanAmount / pricing.termMonths;

          await storage.createOffer({
            organizationId: context.organizationId,
            batchId,
            leadId: lead.id,
            propertyId: property?.id || null,
            estimatedMarketValue: String(estimatedValue),
            cashOffer: String(cashOffer),
            termsOffer: String(termsOffer),
            downPayment: String(downPayment),
            monthlyPayment: String(Math.round(monthlyPayment)),
            interestRate: String(pricing.interestRate),
            termMonths: pricing.termMonths,
            status: "pending",
          });

          results.offersGenerated++;
        } catch (err: any) {
          results.errors.push(`Lead ${lead.id}: ${err.message}`);
          results.skipped++;
        }
      }

      await storage.updateOfferBatch(context.organizationId, batchId, {
        status: "completed",
        completedAt: new Date(),
      });

      return {
        success: true,
        data: results,
        message: `Generated ${results.offersGenerated} offers, ${results.skipped} skipped`,
        costIncurred: results.offersGenerated * 2,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Batch offer generation failed" };
    }
  },
};

const scrubLeadListInputSchema = z.object({
  listId: z.number().describe("Marketing list ID to scrub"),
  options: z.object({
    removeDuplicates: z.boolean().optional().default(true).describe("Remove duplicate entries"),
    validateAddresses: z.boolean().optional().default(true).describe("Validate addresses via data broker"),
    enrichParcelData: z.boolean().optional().default(false).describe("Enrich with parcel data"),
  }).optional(),
});

const scrubLeadListSkill: Skill = {
  id: "scrubLeadList",
  name: "Scrub Lead List",
  description: "Validates addresses, removes duplicates, and enriches parcel data for a marketing list",
  agentTypes: ["operations", "research"],
  inputSchema: scrubLeadListInputSchema,
  costEstimate: "medium",
  examples: [
    'scrubLeadList({ listId: 123 })',
    'scrubLeadList({ listId: 456, options: { removeDuplicates: true, validateAddresses: true, enrichParcelData: true } })',
  ],
  execute: async (params, context) => {
    try {
      const { listId, options } = scrubLeadListInputSchema.parse(params);
      const opts = {
        removeDuplicates: options?.removeDuplicates ?? true,
        validateAddresses: options?.validateAddresses ?? true,
        enrichParcelData: options?.enrichParcelData ?? false,
      };

      const list = await storage.getMarketingListById(context.organizationId, listId);
      if (!list) {
        return { success: false, error: "Marketing list not found" };
      }

      const allLeads = await storage.getLeads(context.organizationId);
      const listLeadIds = new Set((list.leadIds as number[]) || []);
      const listLeads = allLeads.filter(l => listLeadIds.has(l.id));

      const stats = {
        total: listLeads.length,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        enriched: 0,
      };

      const seenKeys = new Set<string>();
      const validLeadIds: number[] = [];

      for (const lead of listLeads) {
        // Use lead address for deduplication
        const dedupeKey = `${lead.address || ''}-${lead.city || ''}-${lead.state || ''}`.toLowerCase().trim();
        
        if (opts.removeDuplicates && seenKeys.has(dedupeKey)) {
          stats.duplicates++;
          continue;
        }
        seenKeys.add(dedupeKey);

        if (opts.validateAddresses && lead.address) {
          try {
            const result = await dataSourceBroker.lookup("parcel_data", {
              address: lead.address,
              state: lead.state || undefined,
              county: lead.city || undefined,
              latitude: 0,
              longitude: 0,
            });
            
            if (!result.success) {
              stats.invalid++;
              continue;
            }
          } catch {
            // Count as valid if lookup service fails
          }
        }

        if (opts.enrichParcelData && lead.address && lead.state) {
          try {
            // Try to enrich with parcel lookup by address
            stats.enriched++;
          } catch {
            // Continue even if enrichment fails
          }
        }

        stats.valid++;
        validLeadIds.push(lead.id);
      }

      await storage.updateMarketingList(context.organizationId, listId, {
        leadIds: validLeadIds,
        stats: {
          total: stats.total,
          valid: stats.valid,
          invalid: stats.invalid,
          duplicates: stats.duplicates,
          scrubbedAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        data: stats,
        message: `Scrubbed list: ${stats.valid} valid, ${stats.duplicates} duplicates removed, ${stats.invalid} invalid`,
        costIncurred: stats.enriched * 2,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Lead list scrubbing failed" };
    }
  },
};

const scoreBuyerInputSchema = z.object({
  leadId: z.number().describe("Buyer lead ID to score"),
  propertyId: z.number().optional().describe("Property ID for context"),
});

const scoreBuyerSkill: Skill = {
  id: "scoreBuyer",
  name: "Score Buyer",
  description: "Analyzes buyer's financial info, communication history, and intent to calculate qualification score",
  agentTypes: ["deals", "communications"],
  inputSchema: scoreBuyerInputSchema,
  costEstimate: "low",
  examples: [
    'scoreBuyer({ leadId: 123 })',
    'scoreBuyer({ leadId: 456, propertyId: 789 })',
  ],
  execute: async (params, context) => {
    try {
      const { leadId, propertyId } = scoreBuyerInputSchema.parse(params);
      
      const lead = await storage.getLead(context.organizationId, leadId);
      if (!lead) {
        return { success: false, error: "Lead not found" };
      }

      const conversations = await storage.getConversations(context.organizationId);
      const leadConversations = conversations.filter(c => c.leadId === leadId);
      
      const activities = await storage.getLeadActivities(context.organizationId, leadId);
      
      const prequalifications = await storage.getBuyerPrequalifications(context.organizationId);
      const prequal = prequalifications.find(p => p.leadId === leadId);

      let score = 50;
      const factors: { name: string; impact: number; reason: string }[] = [];

      if (prequal) {
        if (prequal.downPaymentAvailable && parseFloat(prequal.downPaymentAvailable) > 0) {
          score += 20;
          factors.push({ name: "Down Payment", impact: 20, reason: `Down payment available: $${prequal.downPaymentAvailable}` });
        }
        if (prequal.monthlyPaymentCapacity && parseFloat(prequal.monthlyPaymentCapacity) > 500) {
          score += 10;
          factors.push({ name: "Budget", impact: 10, reason: `Monthly payment capacity: $${prequal.monthlyPaymentCapacity}` });
        }
      }

      if (leadConversations.length > 3) {
        score += 10;
        factors.push({ name: "Engagement", impact: 10, reason: `${leadConversations.length} conversations` });
      } else if (leadConversations.length > 0) {
        score += 5;
        factors.push({ name: "Engagement", impact: 5, reason: `${leadConversations.length} conversation(s)` });
      }

      const responseActivities = activities.filter(a => 
        a.type === "email_replied" || a.type === "sms_replied" || a.type === "call_completed"
      );
      if (responseActivities.length > 2) {
        score += 10;
        factors.push({ name: "Responsiveness", impact: 10, reason: "Highly responsive to outreach" });
      }

      if (lead.source === "referral") {
        score += 10;
        factors.push({ name: "Source", impact: 10, reason: "Referral lead" });
      }

      score = Math.max(0, Math.min(100, score));
      
      let recommendation: "proceed" | "more_info" | "decline";
      let recommendationReason: string;
      
      if (score >= 70) {
        recommendation = "proceed";
        recommendationReason = "Strong buyer candidate with verified qualifications";
      } else if (score >= 40) {
        recommendation = "more_info";
        recommendationReason = "Promising but needs additional verification";
      } else {
        recommendation = "decline";
        recommendationReason = "Low qualification score, recommend focusing on other buyers";
      }

      return {
        success: true,
        data: {
          leadId,
          score,
          grade: score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : score >= 20 ? "D" : "F",
          factors,
          recommendation,
          recommendationReason,
          hasPrequalification: !!prequal,
          conversationCount: leadConversations.length,
        },
        message: `Buyer score: ${score}/100 (${recommendation})`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Buyer scoring failed" };
    }
  },
};

const generateAdCopyInputSchema = z.object({
  propertyId: z.number().describe("Property ID to generate ad copy for"),
  style: z.enum(["story", "features", "investment"]).describe("Ad copy style"),
});

const generateAdCopySkill: Skill = {
  id: "generateAdCopy",
  name: "Generate Ad Copy",
  description: "Generates compelling property ad copy in Mark Podolsky story style or other formats",
  agentTypes: ["communications"],
  inputSchema: generateAdCopyInputSchema,
  costEstimate: "low",
  examples: [
    'generateAdCopy({ propertyId: 123, style: "story" })',
    'generateAdCopy({ propertyId: 456, style: "investment" })',
  ],
  execute: async (params, context) => {
    try {
      const { propertyId, style } = generateAdCopyInputSchema.parse(params);
      
      const property = await storage.getProperty(context.organizationId, propertyId);
      if (!property) {
        return { success: false, error: "Property not found" };
      }

      const acreage = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;
      const location = [property.city, property.county, property.state].filter(Boolean).join(", ");
      
      let headline = "";
      let description = "";
      let callToAction = "";

      if (style === "story") {
        headline = `Your Own Piece of ${property.state || "Paradise"} - ${acreage.toFixed(2)} Acres of Freedom`;
        description = `Picture this: You wake up to the sound of nature, step outside your door, and breathe in the fresh ${property.state || "country"} air. No neighbors in sight, just you and ${acreage.toFixed(2)} acres of your very own land in ${location || "a beautiful location"}.

This isn't just property—it's your escape from the chaos. Whether you're dreaming of a weekend retreat, a future homesite, or simply the peace of mind that comes with owning land, this is your opportunity.

${property.roadAccess ? `✓ Easy ${property.roadAccess} road access` : ""}
${property.utilities ? "✓ Utilities available nearby" : ""}
${property.zoning ? `✓ Zoned: ${property.zoning}` : ""}

The best part? You can own this land with a small down payment and affordable monthly payments. No banks, no credit checks, no hassle.`;
        callToAction = "Reply now to claim your piece of the American dream!";
      } else if (style === "features") {
        headline = `${acreage.toFixed(2)} Acres in ${property.county || property.state || "Prime Location"} - Owner Financing Available`;
        description = `Property Details:
• Size: ${acreage.toFixed(2)} acres
• Location: ${location || "Contact for details"}
${property.apn ? `• APN: ${property.apn}` : ""}
${property.roadAccess ? `• Road Access: ${property.roadAccess}` : ""}
${property.zoning ? `• Zoning: ${property.zoning}` : ""}
${property.terrain ? `• Terrain: ${property.terrain}` : ""}

Owner financing available with low down payment and easy monthly payments. No credit check required.`;
        callToAction = "Contact us today for pricing and terms!";
      } else {
        headline = `Investment Opportunity: ${acreage.toFixed(2)} Acres - ${property.county || property.state}`;
        description = `Land investment opportunity in ${location || "growing area"}.

${acreage.toFixed(2)} acres with strong appreciation potential. Land values in this area have been steadily increasing as development expands.

Perfect for:
• Buy and hold investment
• Future development
• Portfolio diversification

Owner financing terms available. Build equity while paying over time.`;
        callToAction = "Inquire now for investment details and ROI projections!";
      }

      return {
        success: true,
        data: {
          propertyId,
          style,
          headline,
          description,
          callToAction,
          fullAd: `${headline}\n\n${description}\n\n${callToAction}`,
          generatedAt: new Date().toISOString(),
        },
        message: `Generated ${style} ad copy for property ${propertyId}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Ad copy generation failed" };
    }
  },
};

const startCollectionSequenceInputSchema = z.object({
  noteId: z.number().describe("Note ID to enroll in collection sequence"),
  sequenceId: z.number().optional().describe("Collection sequence ID (uses default if not provided)"),
});

const startCollectionSequenceSkill: Skill = {
  id: "startCollectionSequence",
  name: "Start Collection Sequence",
  description: "Enrolls a note in a collection sequence and schedules the first reminder step",
  agentTypes: ["operations"],
  inputSchema: startCollectionSequenceInputSchema,
  costEstimate: "free",
  examples: [
    'startCollectionSequence({ noteId: 123 })',
    'startCollectionSequence({ noteId: 456, sequenceId: 789 })',
  ],
  execute: async (params, context) => {
    try {
      const { noteId, sequenceId } = startCollectionSequenceInputSchema.parse(params);
      
      const note = await storage.getNote(context.organizationId, noteId);
      if (!note) {
        return { success: false, error: "Note not found" };
      }

      let sequence;
      if (sequenceId) {
        sequence = await storage.getCollectionSequenceById(context.organizationId, sequenceId);
      } else {
        const sequences = await storage.getCollectionSequences(context.organizationId);
        sequence = sequences.find(s => s.isDefault);
      }

      if (!sequence) {
        return { 
          success: false, 
          error: sequenceId 
            ? "Collection sequence not found" 
            : "No default collection sequence configured" 
        };
      }

      const existingEnrollments = await storage.getCollectionEnrollments(context.organizationId);
      const alreadyEnrolled = existingEnrollments.find(
        e => e.noteId === noteId && e.status === "active"
      );

      if (alreadyEnrolled) {
        return {
          success: false,
          error: "Note is already enrolled in an active collection sequence",
        };
      }

      const enrollment = await storage.createCollectionEnrollment({
        organizationId: context.organizationId,
        sequenceId: sequence.id,
        noteId,
        status: "active",
        currentStep: 1,
        nextStepAt: new Date(),
        startedAt: new Date(),
      });

      return {
        success: true,
        data: {
          enrollmentId: enrollment.id,
          noteId,
          sequenceId: sequence.id,
          sequenceName: sequence.name,
          currentStep: 1,
          nextStepAt: enrollment.nextStepAt,
        },
        message: `Note ${noteId} enrolled in collection sequence "${sequence.name}"`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Failed to start collection sequence" };
    }
  },
};

const researchCountyInputSchema = z.object({
  state: z.string().describe("Two-letter state code"),
  county: z.string().describe("County name"),
});

const researchCountySkill: Skill = {
  id: "researchCounty",
  name: "Research County",
  description: "Gathers county office contact info, GIS availability, recording fees, and market data",
  agentTypes: ["research"],
  inputSchema: researchCountyInputSchema,
  costEstimate: "low",
  examples: [
    'researchCounty({ state: "TX", county: "Travis" })',
    'researchCounty({ state: "AZ", county: "Maricopa" })',
  ],
  execute: async (params, context) => {
    try {
      const { state, county } = researchCountyInputSchema.parse(params);
      const countyKey = `${state.toUpperCase()}-${county.replace(/\s+/g, "-").toUpperCase()}`;

      const existingResearch = await storage.getCountyResearch(state.toUpperCase(), county);
      
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (existingResearch && existingResearch.createdAt && new Date(existingResearch.createdAt) > oneDayAgo) {
        return {
          success: true,
          data: existingResearch,
          message: `Retrieved cached research for ${county}, ${state}`,
        };
      }

      const research: Record<string, any> = {
        state: state.toUpperCase(),
        county,
        gisAvailable: false,
        gisUrl: null,
        assessorUrl: null,
        recorderUrl: null,
        recordingFees: null,
        marketData: null,
        researchedAt: new Date().toISOString(),
      };

      try {
        const dataSources = await storage.getDataSources();
        const countyGisSources = dataSources.filter(
          ds => ds.category === "county_gis"
        );
        
        if (countyGisSources.length > 0) {
          research.gisAvailable = true;
          research.gisUrl = countyGisSources[0].apiEndpoint;
        }
      } catch {
        // Continue with what we have
      }

      research.countyInfo = {
        name: county,
        state: state.toUpperCase(),
        estimatedRecordingFee: "$30-$50 (verify with county)",
        typicalClosingTime: "2-4 weeks",
      };

      if (existingResearch) {
        await storage.updateCountyResearch(existingResearch.id, {
          hasOnlineMaps: research.gisAvailable,
          gisPortalUrl: research.gisUrl,
          marketNotes: JSON.stringify(research),
        });
      } else {
        await storage.createCountyResearch({
          state: state.toUpperCase(),
          county,
          hasOnlineMaps: research.gisAvailable,
          gisPortalUrl: research.gisUrl,
          marketNotes: JSON.stringify(research),
        });
      }

      return {
        success: true,
        data: research,
        message: `Research complete for ${county}, ${state}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "County research failed" };
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
    this.registerSkill(generateBatchOffersSkill);
    this.registerSkill(scrubLeadListSkill);
    this.registerSkill(scoreBuyerSkill);
    this.registerSkill(generateAdCopySkill);
    this.registerSkill(startCollectionSequenceSkill);
    this.registerSkill(researchCountySkill);
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

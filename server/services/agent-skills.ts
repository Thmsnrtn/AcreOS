import { z } from "zod";
import { storage } from "../storage";
import { dataSourceBroker, type LookupCategory } from "./data-source-broker";
import { lookupParcelByAPN } from "./parcel";
import { getPropertyComps, calculateMarketValue, calculateOfferPrices, calculateDesirabilityScore } from "./comps";
import { emailService } from "./emailService";
import { generateOfferLetter as generateOfferDocument } from "./documents";
import { PropertyEnrichmentService } from "./propertyEnrichment";

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

// ============================================
// PHASE 4 SKILLS - Contracts, Closing, Collections
// ============================================

const prepareContractInputSchema = z.object({
  propertyId: z.number().describe("Property ID for the contract"),
  buyerId: z.number().describe("Buyer lead ID"),
  salePrice: z.number().describe("Sale price in dollars"),
  paymentType: z.enum(["cash", "terms"]).describe("Payment type: 'cash' or 'terms'"),
  downPayment: z.number().optional().describe("Down payment amount for terms deals"),
  monthlyPayment: z.number().optional().describe("Monthly payment amount for terms deals"),
  termMonths: z.number().optional().describe("Loan term in months for terms deals"),
});

const prepareContractSkill: Skill = {
  id: "prepareContract",
  name: "Prepare Contract",
  description: "Generates a purchase contract for a property deal",
  agentTypes: ["deals"],
  inputSchema: prepareContractInputSchema,
  costEstimate: "low",
  examples: [
    'prepareContract({ propertyId: 123, buyerId: 456, salePrice: 25000, paymentType: "cash" })',
    'prepareContract({ propertyId: 123, buyerId: 456, salePrice: 50000, paymentType: "terms", downPayment: 5000, monthlyPayment: 500, termMonths: 120 })',
  ],
  execute: async (params, context) => {
    try {
      const { propertyId, buyerId, salePrice, paymentType, downPayment, monthlyPayment, termMonths } = 
        prepareContractInputSchema.parse(params);

      const property = await storage.getProperty(context.organizationId, propertyId);
      if (!property) {
        return { success: false, error: "Property not found" };
      }

      const buyer = await storage.getLead(context.organizationId, buyerId);
      if (!buyer) {
        return { success: false, error: "Buyer not found" };
      }

      const org = await storage.getOrganization(context.organizationId);
      const companyName = org?.name || "Land Acquisition Co.";
      const today = new Date().toLocaleDateString();
      const buyerName = `${buyer.firstName} ${buyer.lastName}`;
      const propertyAddress = property.address || "[Property Address]";
      const propertyLegal = property.legalDescription || `APN: ${property.apn || "N/A"}`;
      const countyState = `${property.county || ""}, ${property.state || ""}`.trim() || "[County, State]";

      let paymentTermsHtml = "";
      if (paymentType === "cash") {
        paymentTermsHtml = `
          <p><strong>Payment Terms:</strong> Cash at closing</p>
          <p><strong>Purchase Price:</strong> $${salePrice.toLocaleString()}</p>
          <p><strong>Closing Date:</strong> Within 30 days of contract execution</p>
        `;
      } else {
        const dp = downPayment || 0;
        const mp = monthlyPayment || 0;
        const term = termMonths || 60;
        paymentTermsHtml = `
          <p><strong>Payment Terms:</strong> Owner Financing</p>
          <p><strong>Purchase Price:</strong> $${salePrice.toLocaleString()}</p>
          <p><strong>Down Payment:</strong> $${dp.toLocaleString()} (due at closing)</p>
          <p><strong>Financed Amount:</strong> $${(salePrice - dp).toLocaleString()}</p>
          <p><strong>Monthly Payment:</strong> $${mp.toLocaleString()}</p>
          <p><strong>Term:</strong> ${term} months</p>
        `;
      }

      const contractHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Land Purchase Agreement</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
    .section { margin: 20px 0; }
    .signature-line { border-top: 1px solid #333; width: 250px; margin-top: 50px; padding-top: 5px; }
  </style>
</head>
<body>
  <h1>LAND PURCHASE AGREEMENT</h1>
  
  <div class="section">
    <p><strong>Date:</strong> ${today}</p>
    <p><strong>Seller:</strong> ${companyName}</p>
    <p><strong>Buyer:</strong> ${buyerName}</p>
  </div>

  <div class="section">
    <h2>Property Description</h2>
    <p><strong>Address:</strong> ${propertyAddress}</p>
    <p><strong>Location:</strong> ${countyState}</p>
    <p><strong>Legal Description:</strong> ${propertyLegal}</p>
    <p><strong>Acreage:</strong> ${property.sizeAcres || "N/A"} acres</p>
  </div>

  <div class="section">
    <h2>Purchase Terms</h2>
    ${paymentTermsHtml}
  </div>

  <div class="section">
    <h2>Terms and Conditions</h2>
    <ol>
      <li>Buyer agrees to purchase the property "as-is" in its current condition.</li>
      <li>Seller agrees to provide clear and marketable title.</li>
      <li>This agreement is contingent upon title verification.</li>
      <li>All closing costs shall be split equally unless otherwise agreed.</li>
      ${paymentType === "terms" ? "<li>Buyer agrees to maintain property insurance during the term of financing.</li>" : ""}
    </ol>
  </div>

  <div class="section">
    <h2>Signatures</h2>
    <div style="display: flex; justify-content: space-between;">
      <div>
        <div class="signature-line">Seller Signature</div>
        <p>${companyName}</p>
      </div>
      <div>
        <div class="signature-line">Buyer Signature</div>
        <p>${buyerName}</p>
      </div>
    </div>
  </div>
</body>
</html>
      `.trim();

      const summary = {
        propertyId,
        buyerId,
        buyerName,
        propertyAddress,
        salePrice,
        paymentType,
        downPayment: downPayment || 0,
        monthlyPayment: monthlyPayment || 0,
        termMonths: termMonths || 0,
        generatedAt: new Date().toISOString(),
      };

      return {
        success: true,
        data: {
          contractHtml,
          summary,
        },
        message: `Contract prepared for ${buyerName} - $${salePrice.toLocaleString()} (${paymentType})`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Contract preparation failed" };
    }
  },
};

const generateClosingPacketInputSchema = z.object({
  dealId: z.number().describe("Deal ID to generate closing packet for"),
  includeDocuments: z.array(z.string()).optional().describe("List of documents to include: deed, contract, disclosure, etc."),
});

const generateClosingPacketSkill: Skill = {
  id: "generateClosingPacket",
  name: "Generate Closing Packet",
  description: "Creates a complete closing packet with all required documents for a deal",
  agentTypes: ["deals"],
  inputSchema: generateClosingPacketInputSchema,
  costEstimate: "low",
  examples: [
    'generateClosingPacket({ dealId: 123 })',
    'generateClosingPacket({ dealId: 456, includeDocuments: ["deed", "contract", "disclosure"] })',
  ],
  execute: async (params, context) => {
    try {
      const { dealId, includeDocuments } = generateClosingPacketInputSchema.parse(params);

      const deal = await storage.getDeal(context.organizationId, dealId);
      if (!deal) {
        return { success: false, error: "Deal not found" };
      }

      const defaultDocuments = ["deed", "contract", "disclosure", "affidavit", "closing_statement"];
      const documentsToInclude = includeDocuments && includeDocuments.length > 0 
        ? includeDocuments 
        : defaultDocuments;

      const documentList = documentsToInclude.map(doc => ({
        type: doc,
        name: doc.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        status: "pending" as const,
        required: ["deed", "contract"].includes(doc),
      }));

      const documents = documentsToInclude.map(doc => ({
        name: doc.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        type: doc,
      }));

      const packet = await storage.createClosingPacket({
        organizationId: context.organizationId,
        dealId,
        type: "standard",
        status: "pending",
        documents,
      });

      return {
        success: true,
        data: {
          packetId: packet.id,
          dealId,
          documentList,
          status: "pending",
          createdAt: packet.createdAt,
        },
        message: `Closing packet created for deal ${dealId} with ${documentList.length} documents`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Failed to generate closing packet" };
    }
  },
};

const processPayoffInputSchema = z.object({
  noteId: z.number().describe("Note ID to calculate payoff for"),
  effectiveDate: z.string().optional().describe("Effective date for payoff calculation (ISO date string)"),
  includeEarlyPayoffDiscount: z.boolean().optional().describe("Whether to apply early payoff discount"),
});

const processPayoffSkill: Skill = {
  id: "processPayoff",
  name: "Process Payoff Quote",
  description: "Calculates payoff amount and generates a payoff quote for a note",
  agentTypes: ["operations"],
  inputSchema: processPayoffInputSchema,
  costEstimate: "free",
  examples: [
    'processPayoff({ noteId: 123 })',
    'processPayoff({ noteId: 456, effectiveDate: "2026-02-01", includeEarlyPayoffDiscount: true })',
  ],
  execute: async (params, context) => {
    try {
      const { noteId, effectiveDate, includeEarlyPayoffDiscount } = processPayoffInputSchema.parse(params);

      const note = await storage.getNote(context.organizationId, noteId);
      if (!note) {
        return { success: false, error: "Note not found" };
      }

      const effective = effectiveDate ? new Date(effectiveDate) : new Date();
      const remainingPrincipal = note.currentBalance ? parseFloat(note.currentBalance) : 0;
      const annualRate = note.interestRate ? parseFloat(note.interestRate) : 0;
      const dailyRate = annualRate / 100 / 365;

      const baseDate = note.nextPaymentDate ? new Date(note.nextPaymentDate) : new Date(note.startDate || Date.now());
      const daysSinceBase = Math.max(0, Math.floor((effective.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)));
      const accruedInterest = remainingPrincipal * dailyRate * daysSinceBase;

      let discountAmount = 0;
      if (includeEarlyPayoffDiscount) {
        const monthlyPayment = note.monthlyPayment ? parseFloat(note.monthlyPayment) : 0;
        const estimatedPaymentsRemaining = monthlyPayment > 0 ? Math.ceil(remainingPrincipal / monthlyPayment) : 0;
        if (estimatedPaymentsRemaining > 12) {
          discountAmount = remainingPrincipal * 0.03;
        } else if (estimatedPaymentsRemaining > 6) {
          discountAmount = remainingPrincipal * 0.02;
        }
      }

      const payoffAmount = remainingPrincipal + accruedInterest - discountAmount;
      const goodThroughDate = new Date(effective);
      goodThroughDate.setDate(goodThroughDate.getDate() + 30);

      const quote = await storage.createPayoffQuote({
        organizationId: context.organizationId,
        noteId,
        principalBalance: remainingPrincipal.toFixed(2),
        accruedInterest: accruedInterest.toFixed(2),
        totalPayoff: payoffAmount.toFixed(2),
        goodThroughDate,
        status: "pending",
      });

      return {
        success: true,
        data: {
          quoteId: quote.id,
          noteId,
          payoffAmount: Math.round(payoffAmount * 100) / 100,
          breakdown: {
            remainingPrincipal: Math.round(remainingPrincipal * 100) / 100,
            accruedInterest: Math.round(accruedInterest * 100) / 100,
            daysSinceBase,
            earlyPayoffDiscount: Math.round(discountAmount * 100) / 100,
          },
          effectiveDate: effective.toISOString(),
          expiryDate: goodThroughDate.toISOString(),
        },
        message: `Payoff quote generated: $${payoffAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Payoff calculation failed" };
    }
  },
};

const escalateDelinquencyInputSchema = z.object({
  noteId: z.number().describe("Note ID to escalate"),
  escalationType: z.enum(["reminder", "warning", "demand", "legal"]).describe("Type of escalation step"),
  sendNotification: z.boolean().optional().describe("Whether to send notification to borrower"),
});

const escalateDelinquencySkill: Skill = {
  id: "escalateDelinquency",
  name: "Escalate Delinquency",
  description: "Escalates a delinquent note to the next collection step",
  agentTypes: ["operations"],
  inputSchema: escalateDelinquencyInputSchema,
  costEstimate: "low",
  examples: [
    'escalateDelinquency({ noteId: 123, escalationType: "reminder" })',
    'escalateDelinquency({ noteId: 456, escalationType: "warning", sendNotification: true })',
  ],
  execute: async (params, context) => {
    try {
      const { noteId, escalationType, sendNotification } = escalateDelinquencyInputSchema.parse(params);

      const note = await storage.getNote(context.organizationId, noteId);
      if (!note) {
        return { success: false, error: "Note not found" };
      }

      const escalationTypeToLevel: Record<string, number> = {
        reminder: 1,
        warning: 2,
        demand: 3,
        legal: 4,
      };
      const escalationLevelToType: Record<number, string> = {
        0: "none",
        1: "reminder",
        2: "warning",
        3: "demand",
        4: "legal",
      };

      const existingEscalation = await storage.getDelinquencyEscalationByNote(context.organizationId, noteId);
      const previousLevel = existingEscalation?.escalationLevel || 0;
      const previousStep = escalationLevelToType[previousLevel] || "none";
      const newLevel = escalationTypeToLevel[escalationType] || 1;

      if (newLevel <= previousLevel && existingEscalation?.status === "active") {
        return { 
          success: false, 
          error: `Cannot escalate to ${escalationType} - already at ${previousStep}` 
        };
      }

      const nextActionMap: Record<string, string> = {
        reminder: "Send follow-up reminder in 7 days if no response",
        warning: "Issue demand letter in 14 days if no payment",
        demand: "Refer to legal counsel in 30 days if no resolution",
        legal: "Initiate foreclosure proceedings per state law",
      };

      if (existingEscalation) {
        await storage.updateDelinquencyEscalation(existingEscalation.id, context.organizationId, {
          status: "superseded",
        });
      }

      const escalation = await storage.createDelinquencyEscalation({
        organizationId: context.organizationId,
        noteId,
        escalationLevel: newLevel,
        status: "active",
        daysDelinquent: note.daysDelinquent || 0,
        amountDue: note.currentBalance || "0",
        lastContactMethod: sendNotification ? "notification" : undefined,
        lastContactDate: sendNotification ? new Date() : undefined,
        nextAction: nextActionMap[escalationType],
      });

      return {
        success: true,
        data: {
          escalationId: escalation.id,
          noteId,
          previousStep,
          currentStep: escalationType,
          nextAction: nextActionMap[escalationType],
          notificationSent: sendNotification || false,
        },
        message: `Note ${noteId} escalated from ${previousStep} to ${escalationType}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "Escalation failed" };
    }
  },
};

const generateSwotReportInputSchema = z.object({
  propertyId: z.number().describe("Property ID to analyze"),
  includeMarketData: z.boolean().optional().describe("Include market comparable data in analysis"),
  includeEnvironmental: z.boolean().optional().describe("Include environmental risk assessment"),
});

const generateSwotReportSkill: Skill = {
  id: "generateSwotReport",
  name: "Generate SWOT Report",
  description: "Generates a SWOT analysis report for a property investment",
  agentTypes: ["research"],
  inputSchema: generateSwotReportInputSchema,
  costEstimate: "medium",
  examples: [
    'generateSwotReport({ propertyId: 123 })',
    'generateSwotReport({ propertyId: 456, includeMarketData: true, includeEnvironmental: true })',
  ],
  execute: async (params, context) => {
    try {
      const { propertyId, includeMarketData, includeEnvironmental } = generateSwotReportInputSchema.parse(params);

      const property = await storage.getProperty(context.organizationId, propertyId);
      if (!property) {
        return { success: false, error: "Property not found" };
      }

      const strengths: string[] = [];
      const weaknesses: string[] = [];
      const opportunities: string[] = [];
      const threats: string[] = [];

      const acreage = property.sizeAcres ? parseFloat(property.sizeAcres) : 0;
      if (acreage >= 5) strengths.push("Good lot size for development or recreational use");
      if (acreage < 1) weaknesses.push("Small lot size may limit use cases");
      
      if (property.roadAccess === "paved") strengths.push("Paved road access");
      else if (property.roadAccess === "gravel") strengths.push("Gravel road access");
      else if (property.roadAccess === "none" || !property.roadAccess) weaknesses.push("Limited or no road access");

      if (property.utilities?.electric) strengths.push("Electric utilities available");
      else weaknesses.push("No electric utilities on site");
      
      if (property.utilities?.water) strengths.push("Water utilities available");
      if (property.utilities?.sewer) strengths.push("Sewer connection available");

      if (property.zoning) {
        if (property.zoning.toLowerCase().includes("residential")) {
          opportunities.push("Residential development potential");
        }
        if (property.zoning.toLowerCase().includes("agricultural")) {
          opportunities.push("Agricultural or hobby farm use");
        }
      }

      opportunities.push("Owner financing can attract wider buyer pool");
      opportunities.push("Land values typically appreciate over time");

      threats.push("Market conditions can affect resale timeline");
      threats.push("Property tax increases over time");

      let marketData = null;
      if (includeMarketData && property.latitude && property.longitude) {
        try {
          const lat = parseFloat(property.latitude);
          const lng = parseFloat(property.longitude);
          const compsResult = await getPropertyComps(lat, lng, acreage, 5, {}, undefined, context.organizationId);
          if (compsResult.success && compsResult.marketAnalysis) {
            marketData = compsResult.marketAnalysis;
            if (compsResult.marketAnalysis.averagePricePerAcre) {
              opportunities.push(`Market avg: $${compsResult.marketAnalysis.averagePricePerAcre.toLocaleString()}/acre`);
            }
          }
        } catch {
          // Continue without market data
        }
      }

      let environmentalData = null;
      if (includeEnvironmental && property.latitude && property.longitude) {
        try {
          const lat = parseFloat(property.latitude);
          const lng = parseFloat(property.longitude);
          const categories: LookupCategory[] = ["flood_zone", "wetlands"];
          
          for (const category of categories) {
            try {
              const result = await dataSourceBroker.lookup(category, {
                latitude: lat,
                longitude: lng,
                state: property.state || undefined,
                county: property.county || undefined,
              });
              if (result.success && result.data) {
                if (category === "flood_zone" && result.data.riskLevel === "high") {
                  threats.push("Located in high-risk flood zone");
                } else if (category === "flood_zone" && result.data.riskLevel === "low") {
                  strengths.push("Low flood risk");
                }
                if (category === "wetlands" && result.data.hasWetlands) {
                  weaknesses.push("Wetlands may restrict development");
                }
              }
            } catch {
              // Continue with other lookups
            }
          }
          environmentalData = { analyzed: true };
        } catch {
          // Continue without environmental data
        }
      }

      let recommendation = "Hold for appreciation";
      if (strengths.length > weaknesses.length + 1) {
        recommendation = "Strong buy - property has significant advantages";
      } else if (weaknesses.length > strengths.length + 1) {
        recommendation = "Proceed with caution - address weaknesses before acquisition";
      } else {
        recommendation = "Neutral - standard investment with balanced risk/reward";
      }

      const report = await storage.createSwotReport({
        organizationId: context.organizationId,
        propertyId,
        strengths,
        weaknesses,
        opportunities,
        threats,
        recommendation,
        aiGenerated: true,
        notes: `Analysis included: ${marketData ? 'market data' : ''}${marketData && environmentalData ? ', ' : ''}${environmentalData ? 'environmental' : ''}`.trim() || undefined,
      });

      return {
        success: true,
        data: {
          reportId: report.id,
          propertyId,
          strengths,
          weaknesses,
          opportunities,
          threats,
          recommendation,
          marketData,
          environmentalData,
          generatedAt: report.createdAt,
        },
        message: `SWOT report generated for property ${propertyId}: ${recommendation}`,
      };
    } catch (error: any) {
      return { success: false, error: error.message || "SWOT report generation failed" };
    }
  },
};

// ============================================
// GIS DATA LOOKUP SKILLS
// ============================================

const propertyEnrichmentService = new PropertyEnrichmentService();

const gisPropertyEnrichmentInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  state: z.string().optional().describe("Two-letter state code"),
  county: z.string().optional().describe("County name"),
  categories: z.array(z.enum([
    "flood_zone", "wetlands", "soil", "environmental", 
    "infrastructure", "natural_hazards", "demographics",
    "public_lands", "transportation", "water_resources"
  ])).optional().describe("Specific data categories to lookup"),
});

const gisPropertyEnrichmentSkill: Skill = {
  id: "gis_property_enrichment",
  name: "GIS Property Enrichment",
  description: "Get comprehensive property intelligence using coordinates - includes flood zones, wetlands, soil, environmental hazards, infrastructure, demographics, and more from 6,797+ GIS sources",
  agentTypes: ["research"],
  inputSchema: gisPropertyEnrichmentInputSchema,
  costEstimate: "free",
  examples: [
    'gis_property_enrichment({ latitude: 30.2672, longitude: -97.7431 })',
    'gis_property_enrichment({ latitude: 30.2672, longitude: -97.7431, state: "TX", county: "Travis", categories: ["flood_zone", "infrastructure"] })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, state, county, categories } = gisPropertyEnrichmentInputSchema.parse(params);
      
      const result = await propertyEnrichmentService.enrichByCoordinates(latitude, longitude, {
        state,
        county,
        categories: categories as LookupCategory[] | undefined,
        forceRefresh: false,
      });
      
      return {
        success: true,
        data: result,
        message: `Property enrichment complete for (${latitude}, ${longitude}) in ${result.lookupTimeMs}ms`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "GIS property enrichment failed",
      };
    }
  },
};

const gisFloodLookupInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  state: z.string().optional().describe("Two-letter state code"),
  county: z.string().optional().describe("County name"),
});

const gisFloodLookupSkill: Skill = {
  id: "gis_flood_lookup",
  name: "GIS Flood Zone Lookup",
  description: "Check FEMA flood zones for a location - returns flood zone designation, risk level, and insurance requirements",
  agentTypes: ["research"],
  inputSchema: gisFloodLookupInputSchema,
  costEstimate: "free",
  examples: [
    'gis_flood_lookup({ latitude: 30.2672, longitude: -97.7431 })',
    'gis_flood_lookup({ latitude: 29.7604, longitude: -95.3698, state: "TX", county: "Harris" })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, state, county } = gisFloodLookupInputSchema.parse(params);
      
      const result = await dataSourceBroker.lookup("flood_zone", {
        latitude,
        longitude,
        state,
        county,
      });
      
      if (!result.success) {
        return {
          success: false,
          error: "Flood zone lookup failed",
          data: { fallbacksUsed: result.fallbacksUsed },
        };
      }
      
      return {
        success: true,
        data: {
          floodZone: result.data.zone,
          riskLevel: result.data.riskLevel,
          insuranceRequired: result.data.riskLevel === "high",
          source: result.source.title,
          fromCache: result.fromCache,
          lookupTimeMs: result.lookupTimeMs,
          rawData: result.data,
        },
        message: `Flood zone: ${result.data.zone || "Unknown"}, Risk: ${result.data.riskLevel || "Unknown"}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Flood zone lookup failed",
      };
    }
  },
};

const gisEnvironmentalLookupInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  state: z.string().optional().describe("Two-letter state code"),
  county: z.string().optional().describe("County name"),
});

const gisEnvironmentalLookupSkill: Skill = {
  id: "gis_environmental_lookup",
  name: "GIS Environmental Lookup",
  description: "Check EPA environmental data including Superfund sites, air quality, brownfields, and other environmental hazards near a location",
  agentTypes: ["research"],
  inputSchema: gisEnvironmentalLookupInputSchema,
  costEstimate: "free",
  examples: [
    'gis_environmental_lookup({ latitude: 30.2672, longitude: -97.7431 })',
    'gis_environmental_lookup({ latitude: 40.7128, longitude: -74.0060, state: "NY", county: "New York" })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, state, county } = gisEnvironmentalLookupInputSchema.parse(params);
      
      const result = await dataSourceBroker.lookup("environmental", {
        latitude,
        longitude,
        state,
        county,
      });
      
      if (!result.success) {
        return {
          success: false,
          error: "Environmental lookup failed",
          data: { fallbacksUsed: result.fallbacksUsed },
        };
      }
      
      const superfundCount = result.data.superfundSites?.length || 0;
      const riskLevel = result.data.riskLevel || "unknown";
      
      return {
        success: true,
        data: {
          riskLevel,
          superfundSites: result.data.superfundSites || [],
          superfundCount,
          airQuality: result.data.airQuality,
          brownfields: result.data.brownfields || [],
          source: result.source.title,
          fromCache: result.fromCache,
          lookupTimeMs: result.lookupTimeMs,
          rawData: result.data,
        },
        message: `Environmental risk: ${riskLevel}, ${superfundCount} Superfund site(s) nearby`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Environmental lookup failed",
      };
    }
  },
};

const gisInfrastructureLookupInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  state: z.string().optional().describe("Two-letter state code"),
  county: z.string().optional().describe("County name"),
});

const gisInfrastructureLookupSkill: Skill = {
  id: "gis_infrastructure_lookup",
  name: "GIS Infrastructure Lookup",
  description: "Find nearby hospitals, fire stations, schools, airports, and other critical infrastructure from HIFLD and other federal sources",
  agentTypes: ["research"],
  inputSchema: gisInfrastructureLookupInputSchema,
  costEstimate: "free",
  examples: [
    'gis_infrastructure_lookup({ latitude: 30.2672, longitude: -97.7431 })',
    'gis_infrastructure_lookup({ latitude: 34.0522, longitude: -118.2437, state: "CA", county: "Los Angeles" })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, state, county } = gisInfrastructureLookupInputSchema.parse(params);
      
      const result = await dataSourceBroker.lookup("infrastructure", {
        latitude,
        longitude,
        state,
        county,
      });
      
      if (!result.success) {
        return {
          success: false,
          error: "Infrastructure lookup failed",
          data: { fallbacksUsed: result.fallbacksUsed },
        };
      }
      
      const infrastructure = {
        hospitals: result.data.hospitals || { count: 0 },
        fireStations: result.data.fireStations || { count: 0 },
        schools: result.data.schools || { count: 0 },
        airports: result.data.airports || { count: 0 },
        policeStations: result.data.policeStations || { count: 0 },
      };
      
      return {
        success: true,
        data: {
          ...infrastructure,
          source: result.source.title,
          fromCache: result.fromCache,
          lookupTimeMs: result.lookupTimeMs,
          rawData: result.data,
        },
        message: `Found ${infrastructure.hospitals.count} hospitals, ${infrastructure.fireStations.count} fire stations, ${infrastructure.schools.count} schools nearby`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Infrastructure lookup failed",
      };
    }
  },
};

const gisHazardsLookupInputSchema = z.object({
  latitude: z.number().describe("Property latitude"),
  longitude: z.number().describe("Property longitude"),
  state: z.string().optional().describe("Two-letter state code"),
  county: z.string().optional().describe("County name"),
});

const gisHazardsLookupSkill: Skill = {
  id: "gis_hazards_lookup",
  name: "GIS Natural Hazards Lookup",
  description: "Check natural hazards including earthquake risk, wildfire zones, tornado frequency, hurricane exposure, and other natural disaster risks",
  agentTypes: ["research"],
  inputSchema: gisHazardsLookupInputSchema,
  costEstimate: "free",
  examples: [
    'gis_hazards_lookup({ latitude: 34.0522, longitude: -118.2437 })',
    'gis_hazards_lookup({ latitude: 37.7749, longitude: -122.4194, state: "CA", county: "San Francisco" })',
  ],
  execute: async (params, context) => {
    try {
      const { latitude, longitude, state, county } = gisHazardsLookupInputSchema.parse(params);
      
      const result = await dataSourceBroker.lookup("natural_hazards", {
        latitude,
        longitude,
        state,
        county,
      });
      
      if (!result.success) {
        return {
          success: false,
          error: "Natural hazards lookup failed",
          data: { fallbacksUsed: result.fallbacksUsed },
        };
      }
      
      const hazards = {
        earthquakeRisk: result.data.earthquake?.riskLevel || "unknown",
        wildfireRisk: result.data.wildfire?.riskLevel || "unknown",
        tornadoRisk: result.data.tornado?.riskLevel || "unknown",
        hurricaneRisk: result.data.hurricane?.riskLevel || "unknown",
        landslideRisk: result.data.landslide?.riskLevel || "unknown",
      };
      
      const highRisks = Object.entries(hazards)
        .filter(([_, level]) => level === "high")
        .map(([hazard, _]) => hazard.replace("Risk", ""));
      
      return {
        success: true,
        data: {
          ...hazards,
          highRiskHazards: highRisks,
          source: result.source.title,
          fromCache: result.fromCache,
          lookupTimeMs: result.lookupTimeMs,
          rawData: result.data,
        },
        message: highRisks.length > 0 
          ? `High risk for: ${highRisks.join(", ")}`
          : "No high-risk natural hazards identified",
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Natural hazards lookup failed",
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
    this.registerSkill(generateBatchOffersSkill);
    this.registerSkill(scrubLeadListSkill);
    this.registerSkill(scoreBuyerSkill);
    this.registerSkill(generateAdCopySkill);
    this.registerSkill(startCollectionSequenceSkill);
    this.registerSkill(researchCountySkill);
    // Phase 4 skills
    this.registerSkill(prepareContractSkill);
    this.registerSkill(generateClosingPacketSkill);
    this.registerSkill(processPayoffSkill);
    this.registerSkill(escalateDelinquencySkill);
    this.registerSkill(generateSwotReportSkill);
    // GIS Data Lookup Skills
    this.registerSkill(gisPropertyEnrichmentSkill);
    this.registerSkill(gisFloodLookupSkill);
    this.registerSkill(gisEnvironmentalLookupSkill);
    this.registerSkill(gisInfrastructureLookupSkill);
    this.registerSkill(gisHazardsLookupSkill);
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

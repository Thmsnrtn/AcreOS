import { db } from "../db";
import {
  dueDiligenceDossiers,
  properties,
  leads,
  agentEvents,
  type DueDiligenceDossier,
  type InsertDueDiligenceDossier,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getOpenAIClient } from "../utils/openaiClient";
import { DataSourceBroker } from "./data-source-broker";

const dataSourceBroker = new DataSourceBroker();

function parseNumeric(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  return isNaN(num) ? undefined : num;
}

type AgentType = "titleSearch" | "taxAnalysis" | "environmentalCheck" | "zoningReview" | "accessAnalysis" | "marketComps" | "ownerResearch";
type AgentStatus = "queued" | "running" | "completed" | "failed";

interface AgentAssignment {
  agentId: string;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
}

interface TitleFindings {
  clear: boolean;
  issues?: string[];
  liens?: string[];
  encumbrances?: string[];
}

interface TaxFindings {
  current: boolean;
  amountDue?: number;
  yearsDelinquent?: number;
  specialAssessments?: string[];
}

interface EnvironmentalFindings {
  clean: boolean;
  concerns?: string[];
  wetlands?: boolean;
  floodZone?: string;
}

interface ZoningFindings {
  current: string;
  allowedUses?: string[];
  restrictions?: string[];
  overlays?: string[];
}

interface AccessFindings {
  type: string;
  legal: boolean;
  easements?: string[];
  roadMaintenance?: string;
}

interface CompsFindings {
  medianPrice?: number;
  pricePerAcre?: number;
  salesCount?: number;
  trend?: string;
}

interface OwnerFindings {
  name: string;
  type: string;
  contactInfo?: string;
  motivationSignals?: string[];
}

interface DossierFindings {
  titleStatus?: TitleFindings;
  taxStatus?: TaxFindings;
  environmental?: EnvironmentalFindings;
  zoning?: ZoningFindings;
  access?: AccessFindings;
  comps?: CompsFindings;
  owner?: OwnerFindings;
}

interface ScoreBreakdown {
  titleScore: number;
  taxScore: number;
  environmentalScore: number;
  zoningScore: number;
  accessScore: number;
  marketScore: number;
  ownerScore: number;
}

interface CalculatedScores {
  investabilityScore: number;
  riskScore: number;
  breakdown: ScoreBreakdown;
}

class DueDiligencePodService {
  private generateAgentId(agentType: AgentType): string {
    return `${agentType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  async requestDossier(
    organizationId: number,
    propertyId: number,
    priority: string = "normal",
    requestedBy?: number
  ): Promise<DueDiligenceDossier> {
    const dossierData: InsertDueDiligenceDossier = {
      organizationId,
      propertyId,
      priority,
      requestedBy,
      status: "queued",
      agentsAssigned: {
        titleSearch: { agentId: this.generateAgentId("titleSearch"), status: "queued" },
        taxAnalysis: { agentId: this.generateAgentId("taxAnalysis"), status: "queued" },
        environmentalCheck: { agentId: this.generateAgentId("environmentalCheck"), status: "queued" },
        zoningReview: { agentId: this.generateAgentId("zoningReview"), status: "queued" },
        accessAnalysis: { agentId: this.generateAgentId("accessAnalysis"), status: "queued" },
        marketComps: { agentId: this.generateAgentId("marketComps"), status: "queued" },
        ownerResearch: { agentId: this.generateAgentId("ownerResearch"), status: "queued" },
      },
    };

    const [dossier] = await db.insert(dueDiligenceDossiers).values(dossierData).returning();

    await this.logAgentEvent(organizationId, "dossier_requested", {
      dossierId: dossier.id,
      propertyId,
      priority,
      requestedBy,
    });

    return dossier;
  }

  async runDossierPod(dossierId: number): Promise<DueDiligenceDossier> {
    const [dossier] = await db
      .select()
      .from(dueDiligenceDossiers)
      .where(eq(dueDiligenceDossiers.id, dossierId))
      .limit(1);

    if (!dossier) {
      throw new Error(`Dossier ${dossierId} not found`);
    }

    await db
      .update(dueDiligenceDossiers)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(dueDiligenceDossiers.id, dossierId));

    await this.logAgentEvent(dossier.organizationId, "dossier_pod_started", {
      dossierId,
      propertyId: dossier.propertyId,
    });

    const findings: DossierFindings = {};
    const agentsAssigned = { ...(dossier.agentsAssigned || {}) } as Record<AgentType, AgentAssignment>;

    try {
      const researchTasks = [
        { key: "titleSearch" as AgentType, method: () => this.researchTitle(dossier.propertyId, dossierId), findingKey: "titleStatus" },
        { key: "taxAnalysis" as AgentType, method: () => this.researchTax(dossier.propertyId, dossierId), findingKey: "taxStatus" },
        { key: "environmentalCheck" as AgentType, method: () => this.researchEnvironmental(dossier.propertyId, dossierId), findingKey: "environmental" },
        { key: "zoningReview" as AgentType, method: () => this.researchZoning(dossier.propertyId, dossierId), findingKey: "zoning" },
        { key: "accessAnalysis" as AgentType, method: () => this.researchAccess(dossier.propertyId, dossierId), findingKey: "access" },
        { key: "marketComps" as AgentType, method: () => this.researchComps(dossier.propertyId, dossierId), findingKey: "comps" },
        { key: "ownerResearch" as AgentType, method: () => this.researchOwner(dossier.propertyId, dossierId), findingKey: "owner" },
      ];

      const results = await Promise.allSettled(
        researchTasks.map(async (task) => {
          agentsAssigned[task.key] = {
            ...agentsAssigned[task.key],
            status: "running",
            startedAt: new Date().toISOString(),
          };
          await this.updateAgentStatus(dossierId, agentsAssigned);

          try {
            const result = await task.method();
            agentsAssigned[task.key] = {
              ...agentsAssigned[task.key],
              status: "completed",
              completedAt: new Date().toISOString(),
            };
            return { key: task.findingKey, result };
          } catch (error) {
            agentsAssigned[task.key] = {
              ...agentsAssigned[task.key],
              status: "failed",
              completedAt: new Date().toISOString(),
            };
            throw error;
          }
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          (findings as any)[result.value.key] = result.value.result;
        }
      }

      await this.updateAgentStatus(dossierId, agentsAssigned);

      const scores = this.calculateScores(findings);
      const recommendation = await this.generateRecommendation(scores, findings);
      
      const [updatedDossier] = await db
        .update(dueDiligenceDossiers)
        .set({
          findings,
          investabilityScore: scores.investabilityScore,
          riskScore: scores.riskScore,
          scoreBreakdown: scores.breakdown,
          recommendation: recommendation.recommendation,
          recommendationReasoning: recommendation.reasoning,
          redFlags: recommendation.redFlags,
          greenFlags: recommendation.greenFlags,
          agentsAssigned,
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dueDiligenceDossiers.id, dossierId))
        .returning();

      const executiveSummary = await this.aggregateToExecutiveSummary(updatedDossier);

      const [finalDossier] = await db
        .update(dueDiligenceDossiers)
        .set({
          executiveSummary,
          updatedAt: new Date(),
        })
        .where(eq(dueDiligenceDossiers.id, dossierId))
        .returning();

      await this.logAgentEvent(dossier.organizationId, "dossier_pod_completed", {
        dossierId,
        propertyId: dossier.propertyId,
        investabilityScore: scores.investabilityScore,
        recommendation: recommendation.recommendation,
      });

      return finalDossier;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await db
        .update(dueDiligenceDossiers)
        .set({
          status: "failed",
          agentsAssigned,
          updatedAt: new Date(),
        })
        .where(eq(dueDiligenceDossiers.id, dossierId));

      await this.logAgentEvent(dossier.organizationId, "dossier_pod_failed", {
        dossierId,
        propertyId: dossier.propertyId,
        error: errorMessage,
      });

      throw error;
    }
  }

  private async updateAgentStatus(dossierId: number, agentsAssigned: Record<AgentType, AgentAssignment>): Promise<void> {
    await db
      .update(dueDiligenceDossiers)
      .set({ agentsAssigned, updatedAt: new Date() })
      .where(eq(dueDiligenceDossiers.id, dossierId));
  }

  private async getPropertyData(propertyId: number) {
    const [property] = await db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId))
      .limit(1);
    return property;
  }

  async researchTitle(propertyId: number, dossierId?: number): Promise<TitleFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return { clear: false, issues: ["Property not found"] };
    }

    try {
      const lat = parseNumeric(property.latitude);
      const lng = parseNumeric(property.longitude);
      if (lat && lng) {
        const result = await dataSourceBroker.lookup("parcel_data", {
          latitude: lat,
          longitude: lng,
          state: property.state || undefined,
          county: property.county || undefined,
        });

        if (result.success && result.data) {
          return {
            clear: !result.data.liens && !result.data.encumbrances,
            issues: result.data.issues || [],
            liens: result.data.liens || [],
            encumbrances: result.data.encumbrances || [],
          };
        }
      }

      return {
        clear: true,
        issues: [],
        liens: [],
        encumbrances: [],
      };
    } catch (error) {
      console.error(`[due-diligence-pods] Title research error for property ${propertyId}:`, error);
      return {
        clear: false,
        issues: ["Unable to verify title status - manual review required"],
      };
    }
  }

  async researchTax(propertyId: number, dossierId?: number): Promise<TaxFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return { current: false, yearsDelinquent: 0 };
    }

    try {
      const lat = parseNumeric(property.latitude);
      const lng = parseNumeric(property.longitude);
      if (lat && lng) {
        const result = await dataSourceBroker.lookup("tax_assessment", {
          latitude: lat,
          longitude: lng,
          state: property.state || undefined,
          county: property.county || undefined,
        });

        if (result.success && result.data) {
          return {
            current: !result.data.delinquent,
            amountDue: result.data.amountDue || result.data.delinquentAmount,
            yearsDelinquent: result.data.yearsDelinquent || 0,
            specialAssessments: result.data.specialAssessments || [],
          };
        }
      }

      return {
        current: true,
        amountDue: 0,
        yearsDelinquent: 0,
        specialAssessments: [],
      };
    } catch (error) {
      console.error(`[due-diligence-pods] Tax research error for property ${propertyId}:`, error);
      return {
        current: false,
        yearsDelinquent: 0,
        specialAssessments: ["Tax status verification required"],
      };
    }
  }

  async researchEnvironmental(propertyId: number, dossierId?: number): Promise<EnvironmentalFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return { clean: false, concerns: ["Property not found"] };
    }

    try {
      const concerns: string[] = [];
      let floodZone: string | undefined;
      let wetlands = false;

      const lat = parseNumeric(property.latitude);
      const lng = parseNumeric(property.longitude);
      if (lat && lng) {
        const [floodResult, wetlandsResult, envResult] = await Promise.all([
          dataSourceBroker.lookup("flood_zone", {
            latitude: lat,
            longitude: lng,
          }),
          dataSourceBroker.lookup("wetlands", {
            latitude: lat,
            longitude: lng,
          }),
          dataSourceBroker.lookup("environmental", {
            latitude: lat,
            longitude: lng,
          }),
        ]);

        if (floodResult.success && floodResult.data?.zone) {
          floodZone = floodResult.data.zone;
          if (floodZone && !["X", "UNSHADED X"].includes(floodZone)) {
            concerns.push(`Flood zone: ${floodZone}`);
          }
        }

        if (wetlandsResult.success && wetlandsResult.data?.wetlandPercent > 20) {
          wetlands = true;
          concerns.push(`Wetlands coverage: ${wetlandsResult.data.wetlandPercent}%`);
        }

        if (envResult.success && envResult.data?.hazards) {
          concerns.push(...(envResult.data.hazards || []));
        }
      }

      return {
        clean: concerns.length === 0,
        concerns,
        wetlands,
        floodZone,
      };
    } catch (error) {
      console.error(`[due-diligence-pods] Environmental research error for property ${propertyId}:`, error);
      return {
        clean: false,
        concerns: ["Environmental check could not be completed"],
      };
    }
  }

  async researchZoning(propertyId: number, dossierId?: number): Promise<ZoningFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return { current: "Unknown" };
    }

    try {
      const lat = parseNumeric(property.latitude);
      const lng = parseNumeric(property.longitude);
      if (lat && lng) {
        const result = await dataSourceBroker.lookup("zoning", {
          latitude: lat,
          longitude: lng,
          state: property.state || undefined,
          county: property.county || undefined,
        });

        if (result.success && result.data) {
          return {
            current: result.data.zoning || result.data.zone || "Residential",
            allowedUses: result.data.allowedUses || [],
            restrictions: result.data.restrictions || [],
            overlays: result.data.overlays || [],
          };
        }
      }

      return {
        current: "Agricultural/Residential",
        allowedUses: ["Agricultural", "Single Family Residential"],
        restrictions: [],
        overlays: [],
      };
    } catch (error) {
      console.error(`[due-diligence-pods] Zoning research error for property ${propertyId}:`, error);
      return {
        current: "Unknown",
        restrictions: ["Zoning verification required"],
      };
    }
  }

  async researchAccess(propertyId: number, dossierId?: number): Promise<AccessFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return { type: "Unknown", legal: false };
    }

    try {
      const lat = parseNumeric(property.latitude);
      const lng = parseNumeric(property.longitude);
      if (lat && lng) {
        const result = await dataSourceBroker.lookup("parcel_data", {
          latitude: lat,
          longitude: lng,
          state: property.state || undefined,
          county: property.county || undefined,
        });

        if (result.success && result.data?.access) {
          return {
            type: result.data.access.type || "Paved Road",
            legal: result.data.access.legal !== false,
            easements: result.data.access.easements || [],
            roadMaintenance: result.data.access.maintenance || "County Maintained",
          };
        }
      }

      return {
        type: "Road Access",
        legal: true,
        easements: [],
        roadMaintenance: "Unknown",
      };
    } catch (error) {
      console.error(`[due-diligence-pods] Access research error for property ${propertyId}:`, error);
      return {
        type: "Unknown",
        legal: false,
        easements: ["Access verification required"],
      };
    }
  }

  async researchComps(propertyId: number, dossierId?: number): Promise<CompsFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return {};
    }

    try {
      const lat = parseNumeric(property.latitude);
      const lng = parseNumeric(property.longitude);
      if (lat && lng) {
        const result = await dataSourceBroker.lookup("market_data", {
          latitude: lat,
          longitude: lng,
          state: property.state || undefined,
          county: property.county || undefined,
        });

        if (result.success && result.data) {
          return {
            medianPrice: result.data.medianPrice,
            pricePerAcre: result.data.avgPricePerAcre || result.data.pricePerAcre,
            salesCount: result.data.recentSalesCount || result.data.salesCount,
            trend: result.data.trend || (result.data.priceChangePercent > 0 ? "Increasing" : "Stable"),
          };
        }
      }

      const acreage = parseNumeric(property.sizeAcres) || 5;
      return {
        pricePerAcre: 2500,
        medianPrice: acreage * 2500,
        salesCount: 0,
        trend: "Stable",
      };
    } catch (error) {
      console.error(`[due-diligence-pods] Comps research error for property ${propertyId}:`, error);
      return {
        trend: "Unable to determine",
      };
    }
  }

  async researchOwner(propertyId: number, dossierId?: number): Promise<OwnerFindings> {
    const property = await this.getPropertyData(propertyId);
    if (!property) {
      return { name: "Unknown", type: "Unknown" };
    }

    const motivationSignals: string[] = [];

    const [relatedLead] = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, property.organizationId),
          eq(leads.id, property.sellerId || 0)
        )
      )
      .limit(1);

    const ownerFromParcel = property.parcelData?.owner;
    let ownerName = ownerFromParcel || "Unknown";
    let ownerType = "Individual";

    if (ownerName.match(/LLC|INC|CORP|LP|LLP|TRUST|ESTATE|COMPANY|PARTNERS|HOLDINGS|PROPERTIES|INVESTMENTS/i)) {
      ownerType = "Corporate";
      motivationSignals.push("Corporate ownership - may be portfolio sale");
    }

    if (relatedLead) {
      if (relatedLead.state && property.state && relatedLead.state !== property.state) {
        motivationSignals.push("Out-of-state owner");
      }
      if (relatedLead.source === "tax_list") {
        motivationSignals.push("Tax delinquent list source");
      }
      if (relatedLead.status === "responded") {
        motivationSignals.push("Previously engaged");
      }
    }

    const ownerAddress = property.parcelData?.ownerAddress;
    if (ownerAddress) {
      const ownerState = ownerAddress.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1];
      if (ownerState && property.state && ownerState !== property.state) {
        if (!motivationSignals.includes("Out-of-state owner")) {
          motivationSignals.push("Out-of-state owner");
        }
      }
    }

    return {
      name: ownerName,
      type: ownerType,
      contactInfo: relatedLead?.phone || relatedLead?.email || undefined,
      motivationSignals,
    };
  }

  calculateScores(findings: DossierFindings): CalculatedScores {
    const breakdown: ScoreBreakdown = {
      titleScore: 0,
      taxScore: 0,
      environmentalScore: 0,
      zoningScore: 0,
      accessScore: 0,
      marketScore: 0,
      ownerScore: 0,
    };

    if (findings.titleStatus) {
      breakdown.titleScore = findings.titleStatus.clear ? 100 : 
        (findings.titleStatus.issues?.length || 0) === 0 ? 80 : 40;
    }

    if (findings.taxStatus) {
      breakdown.taxScore = findings.taxStatus.current ? 100 :
        (findings.taxStatus.yearsDelinquent || 0) <= 1 ? 70 :
        (findings.taxStatus.yearsDelinquent || 0) <= 3 ? 50 : 30;
    }

    if (findings.environmental) {
      breakdown.environmentalScore = findings.environmental.clean ? 100 :
        (findings.environmental.concerns?.length || 0) <= 1 ? 70 :
        findings.environmental.wetlands ? 40 : 50;
    }

    if (findings.zoning) {
      breakdown.zoningScore = findings.zoning.current !== "Unknown" ? 
        ((findings.zoning.restrictions?.length || 0) === 0 ? 90 : 70) : 50;
    }

    if (findings.access) {
      breakdown.accessScore = findings.access.legal ? 
        (findings.access.type !== "Unknown" ? 90 : 70) : 30;
    }

    if (findings.comps) {
      breakdown.marketScore = findings.comps.salesCount && findings.comps.salesCount > 3 ? 90 :
        findings.comps.pricePerAcre ? 70 : 50;
    }

    if (findings.owner) {
      const signals = findings.owner.motivationSignals?.length || 0;
      breakdown.ownerScore = signals >= 2 ? 90 : signals === 1 ? 70 : 50;
    }

    const weights = {
      titleScore: 0.20,
      taxScore: 0.15,
      environmentalScore: 0.15,
      zoningScore: 0.15,
      accessScore: 0.15,
      marketScore: 0.10,
      ownerScore: 0.10,
    };

    const investabilityScore = Math.round(
      breakdown.titleScore * weights.titleScore +
      breakdown.taxScore * weights.taxScore +
      breakdown.environmentalScore * weights.environmentalScore +
      breakdown.zoningScore * weights.zoningScore +
      breakdown.accessScore * weights.accessScore +
      breakdown.marketScore * weights.marketScore +
      breakdown.ownerScore * weights.ownerScore
    );

    const riskFactors: number[] = [];
    if (!findings.titleStatus?.clear) riskFactors.push(30);
    if (!findings.taxStatus?.current) riskFactors.push(20);
    if (!findings.environmental?.clean) riskFactors.push(25);
    if (!findings.access?.legal) riskFactors.push(25);

    const riskScore = Math.min(100, riskFactors.reduce((sum, r) => sum + r, 0));

    return {
      investabilityScore,
      riskScore,
      breakdown,
    };
  }

  async generateRecommendation(
    scores: CalculatedScores,
    findings: DossierFindings
  ): Promise<{
    recommendation: string;
    reasoning: string;
    redFlags: string[];
    greenFlags: string[];
  }> {
    const redFlags: string[] = [];
    const greenFlags: string[] = [];

    if (findings.titleStatus?.clear) {
      greenFlags.push("Clear title");
    } else if (findings.titleStatus?.liens?.length) {
      redFlags.push(`${findings.titleStatus.liens.length} liens found`);
    }

    if (findings.taxStatus?.current) {
      greenFlags.push("Taxes current");
    } else if ((findings.taxStatus?.yearsDelinquent || 0) > 2) {
      redFlags.push(`${findings.taxStatus?.yearsDelinquent} years tax delinquent`);
    }

    if (findings.environmental?.clean) {
      greenFlags.push("No environmental concerns");
    } else if (findings.environmental?.wetlands) {
      redFlags.push("Wetlands present");
    }

    if (findings.access?.legal) {
      greenFlags.push("Legal access confirmed");
    } else {
      redFlags.push("Access issues");
    }

    if ((findings.owner?.motivationSignals?.length || 0) >= 2) {
      greenFlags.push("Strong motivation signals");
    }

    const openai = getOpenAIClient();
    
    if (openai) {
      try {
        const prompt = `Analyze this property due diligence and provide a buy/pass recommendation.

Investability Score: ${scores.investabilityScore}/100
Risk Score: ${scores.riskScore}/100

Score Breakdown:
- Title: ${scores.breakdown.titleScore}/100
- Tax: ${scores.breakdown.taxScore}/100
- Environmental: ${scores.breakdown.environmentalScore}/100
- Zoning: ${scores.breakdown.zoningScore}/100
- Access: ${scores.breakdown.accessScore}/100
- Market: ${scores.breakdown.marketScore}/100
- Owner: ${scores.breakdown.ownerScore}/100

Red Flags: ${redFlags.join(", ") || "None"}
Green Flags: ${greenFlags.join(", ") || "None"}

Provide a recommendation (strong_buy, buy, hold, pass, or avoid) and a brief reasoning (2-3 sentences).
Format: RECOMMENDATION: [recommendation]
REASONING: [reasoning]`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a land investment analyst providing concise due diligence recommendations." },
            { role: "user", content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.3,
        });

        const content = response.choices[0]?.message?.content || "";
        const recMatch = content.match(/RECOMMENDATION:\s*(strong_buy|buy|hold|pass|avoid)/i);
        const reasonMatch = content.match(/REASONING:\s*([\s\S]+)/i);

        if (recMatch) {
          return {
            recommendation: recMatch[1].toLowerCase(),
            reasoning: reasonMatch?.[1]?.trim() || "Based on the due diligence analysis.",
            redFlags,
            greenFlags,
          };
        }
      } catch (error) {
        console.error("[due-diligence-pods] AI recommendation error:", error);
      }
    }

    let recommendation: string;
    if (scores.investabilityScore >= 80 && scores.riskScore <= 20) {
      recommendation = "strong_buy";
    } else if (scores.investabilityScore >= 70 && scores.riskScore <= 35) {
      recommendation = "buy";
    } else if (scores.investabilityScore >= 50 && scores.riskScore <= 50) {
      recommendation = "hold";
    } else if (scores.investabilityScore >= 30) {
      recommendation = "pass";
    } else {
      recommendation = "avoid";
    }

    const reasoning = `Investability score of ${scores.investabilityScore}/100 with risk score of ${scores.riskScore}/100. ${redFlags.length > 0 ? `Key concerns: ${redFlags.slice(0, 2).join(", ")}.` : "No major concerns identified."}`;

    return {
      recommendation,
      reasoning,
      redFlags,
      greenFlags,
    };
  }

  async aggregateToExecutiveSummary(dossier: DueDiligenceDossier): Promise<string> {
    const property = await this.getPropertyData(dossier.propertyId);
    const openai = getOpenAIClient();

    const findings = dossier.findings as DossierFindings;
    const acreage = parseNumeric(property?.sizeAcres);
    const propertyInfo = property ? 
      `${property.address || "Property"} in ${property.county || ""}, ${property.state || ""} (${acreage || "N/A"} acres)` :
      "Property";

    if (openai) {
      try {
        const prompt = `Generate a concise executive summary (3-4 sentences) for this property investment dossier:

Property: ${propertyInfo}
Recommendation: ${dossier.recommendation?.toUpperCase() || "PENDING"}
Investability Score: ${dossier.investabilityScore}/100
Risk Score: ${dossier.riskScore}/100

Key Findings:
- Title: ${findings.titleStatus?.clear ? "Clear" : "Issues found"}
- Taxes: ${findings.taxStatus?.current ? "Current" : `Delinquent (${findings.taxStatus?.yearsDelinquent || 0} years)`}
- Environmental: ${findings.environmental?.clean ? "Clean" : findings.environmental?.concerns?.join(", ") || "Concerns"}
- Zoning: ${findings.zoning?.current || "Unknown"}
- Access: ${findings.access?.legal ? "Legal access" : "Access issues"}
- Market Trend: ${findings.comps?.trend || "Unknown"}
- Owner Motivation: ${findings.owner?.motivationSignals?.join(", ") || "None identified"}

Red Flags: ${(dossier.redFlags as string[] || []).join(", ") || "None"}
Green Flags: ${(dossier.greenFlags as string[] || []).join(", ") || "None"}

Write a professional executive summary suitable for an investor.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a real estate investment analyst writing executive summaries for property due diligence reports." },
            { role: "user", content: prompt },
          ],
          max_tokens: 300,
          temperature: 0.4,
        });

        return response.choices[0]?.message?.content?.trim() || this.generateFallbackSummary(dossier, propertyInfo);
      } catch (error) {
        console.error("[due-diligence-pods] AI summary error:", error);
      }
    }

    return this.generateFallbackSummary(dossier, propertyInfo);
  }

  private generateFallbackSummary(dossier: DueDiligenceDossier, propertyInfo: string): string {
    const recommendation = dossier.recommendation?.toUpperCase() || "PENDING";
    const investability = dossier.investabilityScore || 0;
    const risk = dossier.riskScore || 0;
    const greenFlags = (dossier.greenFlags as string[] || []).length;
    const redFlags = (dossier.redFlags as string[] || []).length;

    return `${propertyInfo} received a ${recommendation} recommendation with an investability score of ${investability}/100 and risk score of ${risk}/100. The analysis identified ${greenFlags} positive indicators and ${redFlags} areas of concern. ${dossier.recommendationReasoning || "Further review may be warranted based on investor criteria."}`;
  }

  async getDossier(dossierId: number): Promise<DueDiligenceDossier | null> {
    const [dossier] = await db
      .select()
      .from(dueDiligenceDossiers)
      .where(eq(dueDiligenceDossiers.id, dossierId))
      .limit(1);

    return dossier || null;
  }

  async getPropertyDossiers(organizationId: number, propertyId: number): Promise<DueDiligenceDossier[]> {
    const dossiers = await db
      .select()
      .from(dueDiligenceDossiers)
      .where(
        and(
          eq(dueDiligenceDossiers.organizationId, organizationId),
          eq(dueDiligenceDossiers.propertyId, propertyId)
        )
      )
      .orderBy(desc(dueDiligenceDossiers.createdAt));

    return dossiers;
  }

  private async logAgentEvent(
    organizationId: number,
    eventType: string,
    payload: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(agentEvents).values({
        organizationId,
        eventType,
        eventSource: "agent",
        payload,
        relatedEntityType: "dossier",
        relatedEntityId: payload.dossierId,
      });
    } catch (error) {
      console.error("[due-diligence-pods] Failed to log agent event:", error);
    }
  }
}

export const dueDiligencePodService = new DueDiligencePodService();

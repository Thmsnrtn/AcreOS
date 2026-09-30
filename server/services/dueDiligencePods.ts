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
import { logger } from "../utils/logger";

const dataSourceBroker = new DataSourceBroker();

/**
 * Thrown when a dossier or property id does not belong to the calling
 * organization. Rendered as 404 by the routes, not 403 — a cross-tenant probe
 * must not learn that the record exists.
 */
export class DueDiligenceNotInOrgError extends Error {
  constructor(what: string, id: number) {
    super(`${what} ${id} not found in this organization`);
    this.name = "DueDiligenceNotInOrgError";
  }
}

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
  /**
   * True when no data source answered, so nothing was checked (DEFECT-0126).
   * An unverified finding is never clean, current or legal.
   */
  unverified?: boolean;
  issues?: string[];
  liens?: string[];
  encumbrances?: string[];
}

interface TaxFindings {
  current: boolean;
  /**
   * True when no data source answered, so nothing was checked (DEFECT-0126).
   * An unverified finding is never clean, current or legal.
   */
  unverified?: boolean;
  amountDue?: number;
  yearsDelinquent?: number;
  specialAssessments?: string[];
}

interface EnvironmentalFindings {
  clean: boolean;
  /**
   * True when no data source answered, so nothing was checked (DEFECT-0126).
   * An unverified finding is never clean, current or legal.
   */
  unverified?: boolean;
  concerns?: string[];
  wetlands?: boolean;
  floodZone?: string;
}

interface ZoningFindings {
  current: string;
  /**
   * True when no data source answered, so nothing was checked (DEFECT-0126).
   * An unverified finding is never clean, current or legal.
   */
  unverified?: boolean;
  allowedUses?: string[];
  restrictions?: string[];
  overlays?: string[];
}

interface AccessFindings {
  type: string;
  legal: boolean;
  /**
   * True when no data source answered, so nothing was checked (DEFECT-0126).
   * An unverified finding is never clean, current or legal.
   */
  unverified?: boolean;
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
  name: string | null;
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

  async runDossierPod(dossierId: number, organizationId: number): Promise<DueDiligenceDossier> {
    const [dossier] = await db
      .select()
      .from(dueDiligenceDossiers)
      .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)))
      .limit(1);

    if (!dossier) {
      // Not "missing" — not YOURS, and the two are deliberately the same answer.
      throw new DueDiligenceNotInOrgError("Dossier", dossierId);
    }

    await db
      .update(dueDiligenceDossiers)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)));

    await this.logAgentEvent(dossier.organizationId, "dossier_pod_started", {
      dossierId,
      propertyId: dossier.propertyId,
    });

    const findings: DossierFindings = {};
    const agentsAssigned = { ...(dossier.agentsAssigned || {}) } as Record<AgentType, AgentAssignment>;

    try {
      const researchTasks = [
        { key: "titleSearch" as AgentType, method: () => this.researchTitle(dossier.propertyId, organizationId, dossierId), findingKey: "titleStatus" },
        { key: "taxAnalysis" as AgentType, method: () => this.researchTax(dossier.propertyId, organizationId, dossierId), findingKey: "taxStatus" },
        { key: "environmentalCheck" as AgentType, method: () => this.researchEnvironmental(dossier.propertyId, organizationId, dossierId), findingKey: "environmental" },
        { key: "zoningReview" as AgentType, method: () => this.researchZoning(dossier.propertyId, organizationId, dossierId), findingKey: "zoning" },
        { key: "accessAnalysis" as AgentType, method: () => this.researchAccess(dossier.propertyId, organizationId, dossierId), findingKey: "access" },
        { key: "marketComps" as AgentType, method: () => this.researchComps(dossier.propertyId, organizationId, dossierId), findingKey: "comps" },
        { key: "ownerResearch" as AgentType, method: () => this.researchOwner(dossier.propertyId, organizationId, dossierId), findingKey: "owner" },
      ];

      const results = await Promise.allSettled(
        researchTasks.map(async (task) => {
          agentsAssigned[task.key] = {
            ...agentsAssigned[task.key],
            status: "running",
            startedAt: new Date().toISOString(),
          };
          await this.updateAgentStatus(dossierId, organizationId, agentsAssigned);

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

      await this.updateAgentStatus(dossierId, organizationId, agentsAssigned);

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
        .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)))
        .returning();

      const executiveSummary = await this.aggregateToExecutiveSummary(updatedDossier);

      const [finalDossier] = await db
        .update(dueDiligenceDossiers)
        .set({
          executiveSummary,
          updatedAt: new Date(),
        })
        .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)))
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
        .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)));

      await this.logAgentEvent(dossier.organizationId, "dossier_pod_failed", {
        dossierId,
        propertyId: dossier.propertyId,
        error: errorMessage,
      });

      throw error;
    }
  }

  private async updateAgentStatus(dossierId: number, organizationId: number, agentsAssigned: Record<AgentType, AgentAssignment>): Promise<void> {
    await db
      .update(dueDiligenceDossiers)
      .set({ agentsAssigned, updatedAt: new Date() })
      .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)));
  }

  /**
   * A property, WITHIN an organization. Every research method starts here, and
   * every one of them then calls a paid provider through `dataSourceBroker`, so
   * an unscoped lookup here was not only a read of another org's parcel — it
   * spent money researching it.
   *
   * `properties.organizationId` is NOT NULL with two org-leading indexes; the
   * predicate was simply never written. Note how careful the code downstream
   * is: `researchOwner` scopes its lead join by `property.organizationId` — the
   * org of the row fetched here. Deriving the tenant from an unscoped fetch
   * reads as correct and inherits whatever the first query got wrong.
   */
  private async getPropertyData(propertyId: number, organizationId: number) {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);
    return property;
  }

  async researchTitle(propertyId: number, organizationId: number, dossierId?: number): Promise<TitleFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
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

        // A parcel source that carries no lien or encumbrance fields at all
        // (most geometry/ownership sources do not) has said nothing about
        // title. `!undefined && !undefined` read that silence as a clear
        // title (DEFECT-0126).
        if (result.success && result.data && (result.data.liens !== undefined || result.data.encumbrances !== undefined)) {
          const liens = Array.isArray(result.data.liens) ? result.data.liens : result.data.liens ? [String(result.data.liens)] : [];
          const encumbrances = Array.isArray(result.data.encumbrances) ? result.data.encumbrances : result.data.encumbrances ? [String(result.data.encumbrances)] : [];
          return {
            clear: liens.length === 0 && encumbrances.length === 0,
            issues: result.data.issues || [],
            liens,
            encumbrances,
          };
        }
      }

      // DEFECT-0126: no parcel source answered. This returned clear: true —
      // "Clear title", a green flag and a 100 title score for a parcel nobody
      // checked. Unverified is not clear.
      return {
        clear: false,
        unverified: true,
        issues: ["Title not verified — no parcel data source answered. Order a title report."],
      };
    } catch (error) {
      logger.error(`[due-diligence-pods] Title research error for property ${propertyId}`, error);
      return {
        clear: false,
        unverified: true,
        issues: ["Unable to verify title status - manual review required"],
      };
    }
  }

  async researchTax(propertyId: number, organizationId: number, dossierId?: number): Promise<TaxFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
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

        // Current only when the source SAYS whether the parcel is delinquent;
        // a missing flag read as "not delinquent" (DEFECT-0126).
        if (result.success && result.data && typeof result.data.delinquent === "boolean") {
          return {
            current: !result.data.delinquent,
            amountDue: result.data.amountDue || result.data.delinquentAmount,
            yearsDelinquent: result.data.yearsDelinquent || 0,
            specialAssessments: result.data.specialAssessments || [],
          };
        }
      }

      // DEFECT-0126: no tax source answered. This returned current: true
      // with $0 due — "Taxes current" for a parcel nobody checked.
      return {
        current: false,
        unverified: true,
        specialAssessments: ["Tax status not verified — no tax data source answered. Check the county treasurer."],
      };
    } catch (error) {
      logger.error(`[due-diligence-pods] Tax research error for property ${propertyId}`, error);
      return {
        current: false,
        unverified: true,
        specialAssessments: ["Tax status verification required"],
      };
    }
  }

  async researchEnvironmental(propertyId: number, organizationId: number, dossierId?: number): Promise<EnvironmentalFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
    if (!property) {
      return { clean: false, concerns: ["Property not found"] };
    }

    try {
      const concerns: string[] = [];
      let floodZone: string | undefined;
      let wetlands = false;
      // DEFECT-0126: "clean" is only a finding when at least one source
      // answered. With no coordinates, or every lookup failing, `concerns`
      // stayed empty and the parcel was reported environmentally clean.
      let sourcesAnswered = 0;

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

        sourcesAnswered = [floodResult, wetlandsResult, envResult].filter((r) => r.success).length;

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

      if (sourcesAnswered === 0) {
        return {
          clean: false,
          unverified: true,
          concerns: ["Environmental check not performed — no flood, wetlands or environmental source answered"],
        };
      }
      return {
        clean: concerns.length === 0,
        concerns,
        wetlands,
        floodZone,
      };
    } catch (error) {
      logger.error(`[due-diligence-pods] Environmental research error for property ${propertyId}`, error);
      return {
        clean: false,
        unverified: true,
        concerns: ["Environmental check could not be completed"],
      };
    }
  }

  async researchZoning(propertyId: number, organizationId: number, dossierId?: number): Promise<ZoningFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
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
            current: result.data.zoning || result.data.zone || "Unknown",
            allowedUses: result.data.allowedUses || [],
            restrictions: result.data.restrictions || [],
            overlays: result.data.overlays || [],
          };
        }
      }

      // DEFECT-0126: no zoning source answered. This returned
      // "Agricultural/Residential" with two allowed uses — a zoning
      // designation for a parcel nobody looked up.
      return {
        current: "Unknown",
        unverified: true,
        restrictions: ["Zoning not verified — no zoning source answered. Call the county planning office."],
      };
    } catch (error) {
      logger.error(`[due-diligence-pods] Zoning research error for property ${propertyId}`, error);
      return {
        current: "Unknown",
        unverified: true,
        restrictions: ["Zoning verification required"],
      };
    }
  }

  async researchAccess(propertyId: number, organizationId: number, dossierId?: number): Promise<AccessFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
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
            // Only what the source said. A missing road type was "Paved Road",
            // a missing legal flag was legal, and a missing maintenance field
            // was "County Maintained" (DEFECT-0126).
            type: result.data.access.type || "Unknown",
            legal: result.data.access.legal === true,
            easements: result.data.access.easements || [],
            roadMaintenance: result.data.access.maintenance || "Unknown",
          };
        }
      }

      // DEFECT-0126: no parcel source answered. This returned legal: true —
      // "Legal access confirmed" for a parcel that may be landlocked, the
      // most common deal-killer in raw land.
      return {
        type: "Unknown",
        legal: false,
        unverified: true,
        easements: ["Access not verified — confirm road frontage or a recorded easement"],
      };
    } catch (error) {
      logger.error(`[due-diligence-pods] Access research error for property ${propertyId}`, error);
      return {
        type: "Unknown",
        legal: false,
        unverified: true,
        easements: ["Access verification required"],
      };
    }
  }

  async researchComps(propertyId: number, organizationId: number, dossierId?: number): Promise<CompsFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
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
            trend:
              result.data.trend ||
              (typeof result.data.priceChangePercent === "number"
                ? result.data.priceChangePercent > 0
                  ? "Increasing"
                  : result.data.priceChangePercent < 0
                    ? "Decreasing"
                    : "Stable"
                : "Unable to determine"),
          };
        }
      }

      // DEFECT-0126: no market source answered. This returned $2,500/acre
      // and a median of acreage (default 5) × 2,500 — comps for a parcel with
      // no comps, which lifted the market score.
      return {
        salesCount: 0,
        trend: "Unable to determine",
      };
    } catch (error) {
      logger.error(`[due-diligence-pods] Comps research error for property ${propertyId}`, error);
      return {
        trend: "Unable to determine",
      };
    }
  }

  async researchOwner(propertyId: number, organizationId: number, dossierId?: number): Promise<OwnerFindings> {
    const property = await this.getPropertyData(propertyId, organizationId);
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
    // No owner on record is null — "Unknown" read downstream as a name.
    const ownerName: string | null = ownerFromParcel?.trim() || null;
    let ownerType = ownerName ? "Individual" : "Not on record";

    if (ownerName?.match(/LLC|INC|CORP|LP|LLP|TRUST|ESTATE|COMPANY|PARTNERS|HOLDINGS|PROPERTIES|INVESTMENTS/i)) {
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

    const unverified = [
      findings.titleStatus?.unverified ? "title" : null,
      findings.taxStatus?.unverified ? "taxes" : null,
      findings.environmental?.unverified ? "environmental" : null,
      findings.zoning?.unverified ? "zoning" : null,
      findings.access?.unverified ? "access" : null,
    ].filter((x): x is string => x !== null);
    if (unverified.length > 0) {
      redFlags.push(`Not verified (no data source answered): ${unverified.join(", ")}`);
    }

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
    } else if (!findings.access?.unverified) {
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
          model: "openai/gpt-4o",
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
        logger.error("[due-diligence-pods] AI recommendation error", error);
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
    // The org comes off the dossier row rather than a parameter: this method
    // takes the whole record, and its caller fetched that record org-scoped, so
    // adding an argument would let a caller pass an org the dossier is not in.
    const property = await this.getPropertyData(dossier.propertyId, dossier.organizationId);
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
- Title: ${findings.titleStatus?.unverified ? "Not verified" : findings.titleStatus?.clear ? "Clear" : "Issues found"}
- Taxes: ${findings.taxStatus?.unverified ? "Not verified" : findings.taxStatus?.current ? "Current" : `Delinquent (${findings.taxStatus?.yearsDelinquent ?? "unknown"} years)`}
- Environmental: ${findings.environmental?.unverified ? "Not verified" : findings.environmental?.clean ? "Clean" : findings.environmental?.concerns?.join(", ") || "Concerns"}
- Zoning: ${findings.zoning?.unverified ? "Not verified" : findings.zoning?.current || "Unknown"}
- Access: ${findings.access?.unverified ? "Not verified" : findings.access?.legal ? "Legal access" : "Access issues"}
- Market Trend: ${findings.comps?.trend || "Unknown"}
- Owner Motivation: ${findings.owner?.motivationSignals?.join(", ") || "None identified"}

Red Flags: ${(dossier.redFlags as string[] || []).join(", ") || "None"}
Green Flags: ${(dossier.greenFlags as string[] || []).join(", ") || "None"}

Write a professional executive summary suitable for an investor.`;

        const response = await openai.chat.completions.create({
          model: "openai/gpt-4o",
          messages: [
            { role: "system", content: "You are a real estate investment analyst writing executive summaries for property due diligence reports." },
            { role: "user", content: prompt },
          ],
          max_tokens: 300,
          temperature: 0.4,
        });

        return response.choices[0]?.message?.content?.trim() || this.generateFallbackSummary(dossier, propertyInfo);
      } catch (error) {
        logger.error("[due-diligence-pods] AI summary error", error);
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

  async getDossier(dossierId: number, organizationId: number): Promise<DueDiligenceDossier | null> {
    const [dossier] = await db
      .select()
      .from(dueDiligenceDossiers)
      .where(and(eq(dueDiligenceDossiers.id, dossierId), eq(dueDiligenceDossiers.organizationId, organizationId)))
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
      logger.error("[due-diligence-pods] Failed to log agent event", error);
    }
  }
}

export const dueDiligencePodService = new DueDiligencePodService();

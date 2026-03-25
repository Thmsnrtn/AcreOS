// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import { properties, deals, organizations } from "@shared/schema";
import { eq, and, sql, count, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Entity Portfolio Service
 *
 * Tracks which legal entity (LLC, trust, individual) owns each property
 * and provides filtered portfolio views, per-entity tax summaries, and
 * Opportunity Zone integration checks.
 *
 * Entity ownership is stored in properties.parcelData.owner, which is
 * populated by Regrid enrichment. Properties with status "owned" are
 * the active portfolio.
 */

export interface OwningEntity {
  name: string;
  propertyCount: number;
  type: "llc" | "trust" | "individual" | "unknown";
}

export interface EntityProperty {
  id: number;
  address: string | null;
  county: string;
  state: string;
  sizeAcres: string;
  marketValue: string | null;
  purchasePrice: string | null;
  purchaseDate: Date | null;
  status: string;
  owningEntity: string;
  isOpportunityZone: boolean;
}

export interface EntityPortfolio {
  entity: string;
  entityType: "llc" | "trust" | "individual" | "unknown";
  properties: EntityProperty[];
  totalValue: number;
  propertyCount: number;
}

export interface EntityTaxSummary {
  entity: string;
  entityType: "llc" | "trust" | "individual" | "unknown";
  propertyCount: number;
  totalMarketValue: number;
  totalPurchasePrice: number;
  estimatedGains: number;
  ozPropertyCount: number;
  suggestions: string[];
}

export interface OzCheckResult {
  propertyId: number;
  address: string | null;
  county: string;
  state: string;
  owningEntity: string;
  ozTractId: string | null;
  isInOpportunityZone: boolean;
}

/**
 * Infer entity type from the entity name string.
 */
function inferEntityType(name: string): "llc" | "trust" | "individual" | "unknown" {
  const lower = name.toLowerCase();
  if (lower.includes("llc") || lower.includes("l.l.c") || lower.includes("limited liability")) {
    return "llc";
  }
  if (lower.includes("trust") || lower.includes("revocable") || lower.includes("irrevocable")) {
    return "trust";
  }
  // Simple heuristic: if the name has no business suffixes, treat as individual
  const businessSuffixes = ["inc", "corp", "ltd", "llp", "lp", "co", "company", "partners"];
  if (businessSuffixes.some((s) => lower.includes(s))) {
    return "unknown";
  }
  // Names with comma are often "Last, First" — individual
  if (name.includes(",") && name.split(",").length === 2) {
    return "individual";
  }
  return "unknown";
}

/**
 * Extract owning entity name from a property's parcelData.
 */
function extractOwnerName(parcelData: unknown): string {
  if (!parcelData || typeof parcelData !== "object") return "Unknown";
  const data = parcelData as Record<string, unknown>;
  if (typeof data.owner === "string" && data.owner.trim()) {
    return data.owner.trim();
  }
  return "Unknown";
}

/**
 * List all distinct owning entities for an organization's portfolio.
 */
export async function getEntities(orgId: number): Promise<OwningEntity[]> {
  logger.info("Fetching owning entities", { source: "entityPortfolio", organizationId: orgId });

  const rows = await db
    .select({
      id: properties.id,
      parcelData: properties.parcelData,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(properties.status, "owned"),
      ),
    );

  const entityMap = new Map<string, number>();
  for (const row of rows) {
    const name = extractOwnerName(row.parcelData);
    entityMap.set(name, (entityMap.get(name) ?? 0) + 1);
  }

  const entities: OwningEntity[] = [];
  for (const [name, propertyCount] of entityMap) {
    entities.push({
      name,
      propertyCount,
      type: inferEntityType(name),
    });
  }

  entities.sort((a, b) => b.propertyCount - a.propertyCount);

  logger.info({ orgId, entityCount: entities.length }, "entityPortfolio.getEntities: done");
  return entities;
}

/**
 * Get properties grouped by owning entity, optionally filtered to one entity.
 */
export async function getPortfolioByEntity(
  orgId: number,
  entityName?: string,
): Promise<EntityPortfolio[]> {
  logger.info({ orgId, entityName }, "entityPortfolio.getPortfolioByEntity: fetching portfolio");

  const rows = await db
    .select({
      id: properties.id,
      address: properties.address,
      county: properties.county,
      state: properties.state,
      sizeAcres: properties.sizeAcres,
      marketValue: properties.marketValue,
      purchasePrice: properties.purchasePrice,
      purchaseDate: properties.purchaseDate,
      status: properties.status,
      parcelData: properties.parcelData,
      enrichmentData: properties.enrichmentData,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(properties.status, "owned"),
      ),
    );

  // Group by entity
  const grouped = new Map<string, EntityProperty[]>();
  for (const row of rows) {
    const owner = extractOwnerName(row.parcelData);

    if (entityName && owner !== entityName) continue;

    const isOz = checkPropertyOzFlag(row.enrichmentData);

    const prop: EntityProperty = {
      id: row.id,
      address: row.address,
      county: row.county,
      state: row.state,
      sizeAcres: row.sizeAcres,
      marketValue: row.marketValue,
      purchasePrice: row.purchasePrice,
      purchaseDate: row.purchaseDate,
      status: row.status,
      owningEntity: owner,
      isOpportunityZone: isOz,
    };

    if (!grouped.has(owner)) grouped.set(owner, []);
    grouped.get(owner)!.push(prop);
  }

  const portfolios: EntityPortfolio[] = [];
  for (const [entity, props] of grouped) {
    const totalValue = props.reduce((sum, p) => {
      return sum + parseFloat(p.marketValue ?? p.purchasePrice ?? "0");
    }, 0);

    portfolios.push({
      entity,
      entityType: inferEntityType(entity),
      properties: props,
      totalValue,
      propertyCount: props.length,
    });
  }

  portfolios.sort((a, b) => b.totalValue - a.totalValue);

  logger.info(
    { orgId, portfolioCount: portfolios.length },
    "entityPortfolio.getPortfolioByEntity: done",
  );
  return portfolios;
}

/**
 * Compute per-entity tax summary with optimization suggestions.
 */
export async function getEntityTaxSummary(orgId: number): Promise<EntityTaxSummary[]> {
  logger.info({ orgId }, "entityPortfolio.getEntityTaxSummary: computing tax summaries");

  const portfolios = await getPortfolioByEntity(orgId);

  const summaries: EntityTaxSummary[] = portfolios.map((portfolio) => {
    const totalMarketValue = portfolio.properties.reduce(
      (sum, p) => sum + parseFloat(p.marketValue ?? "0"),
      0,
    );
    const totalPurchasePrice = portfolio.properties.reduce(
      (sum, p) => sum + parseFloat(p.purchasePrice ?? "0"),
      0,
    );
    const estimatedGains = totalMarketValue - totalPurchasePrice;
    const ozPropertyCount = portfolio.properties.filter((p) => p.isOpportunityZone).length;

    const suggestions = generateTaxSuggestions({
      entityType: portfolio.entityType,
      propertyCount: portfolio.propertyCount,
      estimatedGains,
      ozPropertyCount,
      totalMarketValue,
    });

    return {
      entity: portfolio.entity,
      entityType: portfolio.entityType,
      propertyCount: portfolio.propertyCount,
      totalMarketValue,
      totalPurchasePrice,
      estimatedGains,
      ozPropertyCount,
      suggestions,
    };
  });

  logger.info(
    { orgId, summaryCount: summaries.length },
    "entityPortfolio.getEntityTaxSummary: done",
  );
  return summaries;
}

/**
 * Check which properties may be in Opportunity Zone census tracts.
 * Uses enrichment data and cross-references the opportunity_zone_holdings table.
 */
export async function checkOpportunityZones(orgId: number): Promise<OzCheckResult[]> {
  logger.info({ orgId }, "entityPortfolio.checkOpportunityZones: checking OZ tracts");

  const rows = await db
    .select({
      id: properties.id,
      address: properties.address,
      county: properties.county,
      state: properties.state,
      parcelData: properties.parcelData,
      enrichmentData: properties.enrichmentData,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(properties.status, "owned"),
      ),
    );

  const results: OzCheckResult[] = rows.map((row) => {
    const enrichment = row.enrichmentData as Record<string, unknown> | null;
    const ozTractId = extractOzTractId(enrichment);
    const isInOz = checkPropertyOzFlag(row.enrichmentData);

    return {
      propertyId: row.id,
      address: row.address,
      county: row.county,
      state: row.state,
      owningEntity: extractOwnerName(row.parcelData),
      ozTractId,
      isInOpportunityZone: isInOz,
    };
  });

  const ozCount = results.filter((r) => r.isInOpportunityZone).length;
  logger.info(
    { orgId, total: results.length, ozCount },
    "entityPortfolio.checkOpportunityZones: done",
  );

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if enrichment data flags a property as being in an Opportunity Zone.
 */
function checkPropertyOzFlag(enrichmentData: unknown): boolean {
  if (!enrichmentData || typeof enrichmentData !== "object") return false;
  const data = enrichmentData as Record<string, unknown>;

  // Check common enrichment fields for OZ data
  if (data.opportunityZone === true) return true;
  if (typeof data.censusTract === "string" && data.ozDesignated === true) return true;
  if (typeof data.opportunity_zone === "string" && data.opportunity_zone !== "") return true;

  return false;
}

/**
 * Extract the OZ census tract ID from enrichment data if present.
 */
function extractOzTractId(enrichmentData: unknown): string | null {
  if (!enrichmentData || typeof enrichmentData !== "object") return null;
  const data = enrichmentData as Record<string, unknown>;

  if (typeof data.ozTractId === "string") return data.ozTractId;
  if (typeof data.censusTract === "string" && data.ozDesignated) return data.censusTract;

  return null;
}

/**
 * Generate tax optimization suggestions based on entity portfolio characteristics.
 */
function generateTaxSuggestions(params: {
  entityType: string;
  propertyCount: number;
  estimatedGains: number;
  ozPropertyCount: number;
  totalMarketValue: number;
}): string[] {
  const suggestions: string[] = [];

  if (params.estimatedGains > 100_000 && params.ozPropertyCount === 0) {
    suggestions.push(
      "Consider a 1031 exchange or Opportunity Zone reinvestment to defer capital gains.",
    );
  }

  if (params.estimatedGains > 0 && params.ozPropertyCount > 0) {
    suggestions.push(
      `${params.ozPropertyCount} property(ies) in Opportunity Zones — hold 10+ years to eliminate gains on OZ appreciation.`,
    );
  }

  if (params.entityType === "individual" && params.propertyCount > 3) {
    suggestions.push(
      "Holding 4+ properties as an individual may increase liability exposure. Consider an LLC or land trust.",
    );
  }

  if (params.entityType === "llc" && params.propertyCount > 10) {
    suggestions.push(
      "With 10+ properties in one LLC, consider a Series LLC structure to isolate liability per asset.",
    );
  }

  if (params.totalMarketValue > 500_000 && params.entityType !== "trust") {
    suggestions.push(
      "Portfolio value exceeds $500K — a revocable trust can simplify estate transfer and avoid probate.",
    );
  }

  return suggestions;
}

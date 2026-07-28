import { db } from '../db';
import { 
  landCreditScores, 
  properties 
} from '../../shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from "../utils/logger";
import { DISCLAIMER_INFORMATIONAL_SCORE } from "./legalDisclaimers";
// Type-only import (erased at build) — no runtime cycle with the enrichment stack.
import type { EnrichmentResult } from "./propertyEnrichment";

interface ScoringFactors {
  location: {
    score: number; // 0-100
    weight: number;
    factors: {
      marketStrength: number; // County market momentum
      growthRate: number; // Population growth
      economicHealth: number; // Employment, income
      accessibility: number; // Highway proximity, airports
    };
  };
  physical: {
    score: number;
    weight: number;
    factors: {
      topography: number; // Flat vs steep
      soilQuality: number; // Ag potential
      waterAccess: number; // Rivers, wells, rights
      utilities: number; // Power, gas, internet
      roadAccess: number; // Paved, dirt, or none
    };
  };
  legal: {
    score: number;
    weight: number;
    factors: {
      zoning: number; // Flexibility and value
      restrictions: number; // HOAs, covenants
      mineralRights: number; // Owned or severed
      waterRights: number; // Owned or shared
      clearTitle: number; // Liens, disputes
    };
  };
  financial: {
    score: number;
    weight: number;
    factors: {
      cashFlow: number; // Current income generation
      appreciation: number; // Historical + projected
      liquidity: number; // How fast it sells
      taxBurden: number; // Property taxes
      maintenanceCost: number; // Annual upkeep
    };
  };
  environmental: {
    score: number;
    weight: number;
    factors: {
      floodRisk: number; // FEMA zones
      wildfire: number; // CAL FIRE zones
      contamination: number; // Superfund sites
      wetlands: number; // Protected areas
      endangered: number; // Species restrictions
    };
  };
  market: {
    score: number;
    weight: number;
    factors: {
      demand: number; // Buyer interest
      supply: number; // Comparable inventory
      priceHistory: number; // Value stability
      daysOnMarket: number; // Sales velocity
      comparables: number; // Quality of comps
    };
  };
}

// ── Shared scoring constants (Tier 3A) ──────────────────────────────────────
// Exported pure pieces of the Land Credit Score methodology so the PUBLIC
// partial-LCS path (server/services/publicParcelReport.ts) reuses the exact
// same weights / 300–850 scale / grade thresholds as the in-app score. One
// methodology, two coverage levels — never two scales.

/**
 * Published methodology version (mature-machine H3: "published, versioned
 * methodology"). Rev this whenever the weights, scale mapping, or grade
 * thresholds change — the public explainer (client/src/pages/landing/
 * LandCreditScore.tsx via copy.ts) states the same version by hand; keep
 * them in sync. Persisted with every public partial score so an old report
 * is auditable against the methodology that produced it.
 */
export const LCS_METHODOLOGY_VERSION = "v1";

/** Canonical dimension weights (must sum to 100). */
export const LCS_DIMENSION_WEIGHTS = {
  location: 25,
  physical: 20,
  legal: 15,
  financial: 20,
  environmental: 10,
  market: 10,
} as const;

export type LcsGrade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

/** Map a 0–100 weighted overall onto the 300–850 credit scale. */
export function lcsCreditScale(overall0to100: number): number {
  return Math.round(300 + (overall0to100 / 100) * 550);
}

/** Letter grade for a 300–850 credit score — single source of truth. */
export function lcsGradeForScore(score: number): LcsGrade {
  if (score >= 800) return 'A+';
  if (score >= 740) return 'A';
  if (score >= 700) return 'B+';
  if (score >= 660) return 'B';
  if (score >= 620) return 'C+';
  if (score >= 580) return 'C';
  if (score >= 500) return 'D';
  return 'F';
}

// ── Factor provenance: measured vs assumed (honesty contract) ───────────────
//
// The properties table has NO floodZone / wetlands / soilQuality columns —
// the old code read `property.floodZone`, a column that never existed, so
// every environmental factor silently sat at its hardcoded default while
// presenting as a scored fact. The REAL stored open data lives in the
// `properties.enrichmentData` jsonb persisted by PropertyEnrichmentService
// (FEMA NFHL flood, USFWS NWI wetlands, USDA NRCS SDA soil — see
// savePropertyEnrichment). The scorers now read that, and every sub-factor
// carries a provenance entry so an ASSUMED default can never masquerade as a
// MEASURED fact. Default VALUES are unchanged — only their labeling is honest.

export type FactorProvenanceStatus = "measured" | "assumed";

export interface FactorProvenance {
  status: FactorProvenanceStatus;
  /** Named data source — present only when status === "measured". */
  source?: string;
  /** ISO date the source reported the fact as-of (measured only, when known). */
  asOf?: string | null;
  /** Why the default/heuristic stands — present only when status === "assumed". */
  basis?: string;
}

export type DimensionProvenance = Record<string, FactorProvenance>;

// Type alias (not interface) on purpose: aliases carry an implicit index
// signature, so this stays assignable to the schema's persisted
// scoreBreakdown.factorProvenance Record type.
export type ScoreProvenance = {
  location: DimensionProvenance;
  physical: DimensionProvenance;
  legal: DimensionProvenance;
  financial: DimensionProvenance;
  environmental: DimensionProvenance;
  market: DimensionProvenance;
};

function measured(source: string, asOf?: string | null): FactorProvenance {
  return { status: "measured", source, asOf: asOf ?? null };
}

function assumed(basis: string): FactorProvenance {
  return { status: "assumed", basis };
}

/** Owner/county-entered property-record fields (zoning, road access, …). */
const PROPERTY_RECORD_SOURCE = "Property record";

/**
 * Default (assumed) factor values — deliberately unchanged from the
 * pre-provenance model so missing data scores exactly as before; the ONLY
 * change for a data-less parcel is that the payload now says "assumed".
 */
export const ASSUMED_FACTOR_DEFAULTS = {
  floodRisk: 80,
  wetlands: 85,
  soilQuality: 50,
  growthRate: 60,
} as const;

function enrichmentOf(property: any): EnrichmentResult | null {
  const e = property?.enrichmentData;
  return e && typeof e === "object" ? (e as EnrichmentResult) : null;
}

/** Source/asOf for one enrichment category, falling back to the layer name. */
function categoryProvenance(
  enrichment: EnrichmentResult | null | undefined,
  category: string,
  fallbackSource: string
): { source: string; asOf: string | null } {
  const p = (
    enrichment?.provenance as
      | Record<string, { source?: string; asOf?: string | null }>
      | undefined
  )?.[category];
  return { source: p?.source || fallbackSource, asOf: p?.asOf ?? null };
}

/**
 * FEMA flood zone → floodRisk sub-factor. Handles both bare zone codes the
 * old code expected ("AE", "X") and the raw NFHL strings the broker actually
 * stores ("Zone AE", "Zone X (Minimal Risk)") — same zone-family mapping as
 * the public partial LCS (publicParcelReport.floodZoneSubScore). Zone D /
 * unstudied stays ASSUMED — an indeterminate zone is not a measurement.
 */
export function floodRiskFromEvidence(
  enrichment: EnrichmentResult | null | undefined
): { score: number; provenance: FactorProvenance } {
  const zoneRaw = enrichment?.hazards?.floodZone;
  if (typeof zoneRaw === "string" && zoneRaw.trim()) {
    const normalized = zoneRaw
      .toUpperCase()
      .replace(/ZONE/g, " ")
      .replace(/SHADED\s+X/g, "X500");
    const m = /\b(VE|V|AE|AH|AO|AR|A99|A|X500|X|B|C|D)\b/.exec(normalized);
    if (m) {
      const zone = m[1];
      const { source, asOf } = categoryProvenance(enrichment, "flood_zone", "FEMA NFHL");
      if (zone === "V" || zone === "VE") return { score: 20, provenance: measured(source, asOf) }; // coastal high-hazard
      if (zone.startsWith("A")) return { score: 40, provenance: measured(source, asOf) }; // high risk (A/AE/AH/AO/AR/A99)
      if (zone === "B" || zone === "X500") return { score: 75, provenance: measured(source, asOf) }; // moderate
      if (zone === "X" || zone === "C") return { score: 95, provenance: measured(source, asOf) }; // minimal
      // Zone D — studied-but-undetermined; fall through to the honest default.
    }
  }
  return {
    score: ASSUMED_FACTOR_DEFAULTS.floodRisk,
    provenance: assumed(
      "No FEMA flood-zone determination stored for this parcel — default assumes low risk"
    ),
  };
}

/**
 * USFWS NWI wetlands → wetlands sub-factor. Mirrors the public partial LCS
 * (publicParcelReport.wetlandsSubScore): mapped wetlands on the parcel are a
 * real development constraint (40); a clean NWI lookup scores 85 — the same
 * VALUE as the default, but MEASURED, not assumed.
 */
export function wetlandsFromEvidence(
  enrichment: EnrichmentResult | null | undefined
): { score: number; provenance: FactorProvenance } {
  const hazards = enrichment?.hazards;
  const pct = hazards?.wetlandsPercentage;
  const present =
    typeof hazards?.wetlandsPresent === "boolean"
      ? hazards.wetlandsPresent
      : typeof pct === "number" && Number.isFinite(pct)
        ? pct > 0
        : null;
  if (present !== null) {
    const { source, asOf } = categoryProvenance(enrichment, "wetlands", "USFWS NWI");
    return { score: present ? 40 : 85, provenance: measured(source, asOf) };
  }
  return {
    score: ASSUMED_FACTOR_DEFAULTS.wetlands,
    provenance: assumed(
      "No USFWS NWI wetlands lookup stored for this parcel — default assumes no protected-area drag"
    ),
  };
}

/**
 * USDA SSURGO capability-derived suitability → soilQuality sub-factor. The
 * broker emits suitability "prime"/"suitable"/"limited" ONLY when a real
 * capability class was retrieved; "good" is its no-capability-data default
 * and is treated as NOT measured — the same honesty rule as
 * publicParcelReport.soilSubScore, with the same score mapping.
 */
export function soilQualityFromEvidence(
  enrichment: EnrichmentResult | null | undefined
): { score: number; provenance: FactorProvenance } {
  const suitability = enrichment?.environment?.soilSuitability;
  const scoreFor: Record<string, number> = { prime: 90, suitable: 70, limited: 45 };
  if (typeof suitability === "string" && suitability in scoreFor) {
    const { source, asOf } = categoryProvenance(enrichment, "soil", "USDA NRCS SDA");
    return { score: scoreFor[suitability], provenance: measured(source, asOf) };
  }
  return {
    score: ASSUMED_FACTOR_DEFAULTS.soilQuality,
    provenance: assumed(
      "No USDA soil capability class stored for this parcel — neutral default"
    ),
  };
}

interface CreditScoreConfidence {
  low: number;
  high: number;
  scoredDimensions: number;
  totalDimensions: number;
}

interface CreditScore {
  overall: number; // 300-850 (like FICO)
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
  factors: ScoringFactors;
  /**
   * Per-sub-factor measured|assumed provenance (honesty contract). A factor
   * is "measured" only when a real stored value backed it (enrichment open
   * data or a property-record field); everything defaulted or inferred from
   * a state-level heuristic is "assumed" with a stated basis.
   */
  factorProvenance: ScoreProvenance;
  riskLevel: 'excellent' | 'good' | 'fair' | 'poor' | 'high';
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  confidence: CreditScoreConfidence;
}

class LandCreditScoring {
  // Scoring weights (must sum to 100) — canonical copy exported above so the
  // public partial-LCS path shares the identical methodology.
  private readonly WEIGHTS = LCS_DIMENSION_WEIGHTS;

  /**
   * The org's calibrated dimension weights (percent, summing to ~100) when
   * the outcome calibrator has adjusted them, else the methodology defaults.
   * Fails SAFE to defaults on any read error — a broken calibrator must
   * never take scoring down.
   */
  private async effectiveWeights(organizationId: number): Promise<Record<keyof typeof LCS_DIMENSION_WEIGHTS, number>> {
    try {
      const { getCurrentWeights } = await import("./lcsCalibrator");
      const { weights } = await getCurrentWeights(organizationId);
      const dims = Object.keys(LCS_DIMENSION_WEIGHTS) as Array<keyof typeof LCS_DIMENSION_WEIGHTS>;
      // Only trust a complete, sane weight set (every dim present, positive,
      // totalling ~100) — anything else falls back to the defaults.
      const total = dims.reduce((t, d) => t + (Number(weights[d]) || 0), 0);
      if (dims.every((d) => Number.isFinite(weights[d]) && weights[d] > 0) && total >= 90 && total <= 110) {
        return Object.fromEntries(dims.map((d) => [d, weights[d]])) as Record<keyof typeof LCS_DIMENSION_WEIGHTS, number>;
      }
      return { ...LCS_DIMENSION_WEIGHTS };
    } catch {
      return { ...LCS_DIMENSION_WEIGHTS };
    }
  }

  /**
   * Calculate comprehensive land credit score
   */
  async calculateCreditScore(
    organizationId: string,
    propertyId: string
  ): Promise<CreditScore> {
    try {
      // Get property details
      const property = await db.query.properties.findFirst({
        where: and(
          eq(properties.id, Number(propertyId)),
          eq(properties.organizationId, Number(organizationId))
        ),
      });

      if (!property) {
        throw new Error('Property not found');
      }

      // Calculate each dimension
      const location = await this.scoreLocation(property);
      const physical = await this.scorePhysical(property);
      const legal = await this.scoreLegal(property);
      const financial = await this.scoreFinancial(property);
      const environmental = await this.scoreEnvironmental(property);
      const market = await this.scoreMarket(property);

      // Outcome loop (S2a): use the org's CALIBRATED dimension weights when
      // the calibrator has real outcome-backed adjustments; fall back to the
      // methodology defaults. Until now runLcsCalibration's output was
      // orphaned — weights were computed from closed-deal outcomes but the
      // scorer never read them back, so the "learning" never changed a score.
      const weights = await this.effectiveWeights(Number(organizationId));

      // Calculate weighted overall score
      const overall = Math.round(
        (location.score * weights.location +
         physical.score * weights.physical +
         legal.score * weights.legal +
         financial.score * weights.financial +
         environmental.score * weights.environmental +
         market.score * weights.market) / 100
      );

      // Convert to 300-850 scale (like FICO)
      const creditScore = lcsCreditScale(overall);

      // Determine grade
      const grade = this.determineGrade(creditScore);
      const riskLevel = this.determineRiskLevel(creditScore);

      // Analyze strengths and weaknesses
      const factors: ScoringFactors = {
        location: { score: location.score, factors: location.factors, weight: weights.location },
        physical: { score: physical.score, factors: physical.factors, weight: weights.physical },
        legal: { score: legal.score, factors: legal.factors, weight: weights.legal },
        financial: { score: financial.score, factors: financial.factors, weight: weights.financial },
        environmental: { score: environmental.score, factors: environmental.factors, weight: weights.environmental },
        market: { score: market.score, factors: market.factors, weight: weights.market },
      };

      // Per-sub-factor measured|assumed provenance — travels with the payload
      // AND the persisted breakdown so an old score stays auditable.
      const factorProvenance: ScoreProvenance = {
        location: location.provenance,
        physical: physical.provenance,
        legal: legal.provenance,
        financial: financial.provenance,
        environmental: environmental.provenance,
        market: market.provenance,
      };

      const { strengths, weaknesses } = this.identifyStrengthsWeaknesses(factors);
      const recommendations = this.generateRecommendations(factors, creditScore);

      // Compute confidence based on how many dimensions have real data vs defaults
      const confidence = this.computeConfidence(factors, creditScore);

      // Save score to database. Parcel identity (apn/state/county, Tier 2A,
      // migration 0152) keys cross-org cohort benchmarks WITHOUT linking back
      // to organizations.
      //
      // Outcome loop (S2a): scoreBreakdown now persists the CANONICAL
      // six-dimension breakdown — top-level numeric dims (read by
      // computeConfidenceIntervals via ->>dim::float) plus a rich `factors`
      // object (read by runLcsCalibration via factors[dim].score) — alongside
      // the legacy display keys. Before this the persisted keys matched
      // NEITHER reader, so hasAllDims was always false and calibration could
      // never reach its minimum sample.
      await db.insert(landCreditScores).values({
        propertyId: Number(propertyId),
        apn: property.apn ?? null,
        state: property.state ? String(property.state).trim().toUpperCase() : null,
        county: property.county ?? null,
        liquidityScore: market.score,
        riskScore: environmental.score,
        developmentPotentialScore: physical.score,
        marketabilityScore: market.score,
        overallScore: overall,
        grade,
        scoreBreakdown: {
          // Canonical dims (numeric, top-level)
          location: location.score,
          physical: physical.score,
          legal: legal.score,
          financial: financial.score,
          environmental: environmental.score,
          market: market.score,
          // Rich per-dimension factors for the calibrator
          factors: {
            location: { score: location.score, weight: weights.location },
            physical: { score: physical.score, weight: weights.physical },
            legal: { score: legal.score, weight: weights.legal },
            financial: { score: financial.score, weight: weights.financial },
            environmental: { score: environmental.score, weight: weights.environmental },
            market: { score: market.score, weight: weights.market },
          },
          // Legacy display keys (pre-S2a consumers)
          characteristics: physical.score,
          marketDemand: market.score,
          economicFactors: financial.score,
          timeOnMarket: legal.score,
          // Honesty contract: which sub-factors were measured vs assumed,
          // with sources — additive key, ignored by the calibrator readers.
          factorProvenance,
        },
        modelVersion: LCS_METHODOLOGY_VERSION,
        validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });

      return {
        overall: creditScore,
        grade,
        factors,
        factorProvenance,
        riskLevel,
        strengths,
        weaknesses,
        recommendations,
        confidence,
      };
    } catch (error) {
      logger.error('Credit score calculation failed', error);
      throw error;
    }
  }

  /**
   * Compute confidence interval based on how many dimensions have actual data vs defaulting to 50
   */
  private computeConfidence(factors: ScoringFactors, creditScore: number): CreditScoreConfidence {
    const totalDimensions = 6;
    let scoredDimensions = 0;

    // A dimension is "scored" if its sub-factors aren't all at the default value of 50
    const dimensionFactors: Record<string, Record<string, number>> = {
      location: factors.location.factors as any,
      physical: factors.physical.factors as any,
      legal: factors.legal.factors as any,
      financial: factors.financial.factors as any,
      environmental: factors.environmental.factors as any,
      market: factors.market.factors as any,
    };

    for (const [, subFactors] of Object.entries(dimensionFactors)) {
      const values = Object.values(subFactors);
      const allDefault = values.every(v => v === 50);
      if (!allDefault) {
        scoredDimensions++;
      }
    }

    // Confidence band width based on scored dimensions
    let band: number;
    if (scoredDimensions >= 6) {
      band = 20;
    } else if (scoredDimensions >= 5) {
      band = 35;
    } else if (scoredDimensions >= 4) {
      band = 50;
    } else {
      band = 75;
    }

    return {
      low: Math.max(300, creditScore - band),
      high: Math.min(850, creditScore + band),
      scoredDimensions,
      totalDimensions,
    };
  }

  /**
   * Score location factors (25% weight)
   */
  private async scoreLocation(
    property: any
  ): Promise<{ score: number; factors: any; provenance: DimensionProvenance }> {
    const factors = {
      marketStrength: 70, // Default - would pull from marketPredictions
      // Default — county growth series (county_building_permits /
      // county_employment_wages, migrations 0201/0202) are not consumed by
      // this scorer yet; the factor stays at its default and is honestly
      // marked "assumed" rather than presenting as census-backed.
      growthRate: ASSUMED_FACTOR_DEFAULTS.growthRate as number,
      economicHealth: 65, // Default - would pull from BLS data
      accessibility: 50, // Default - would calculate from highway/airport distance
    };
    const provenance: DimensionProvenance = {
      marketStrength: assumed("No market-momentum measurement wired — default value"),
      growthRate: assumed(
        "No county growth measurement wired (county permit/employment series not consumed here yet) — default value"
      ),
      economicHealth: assumed("No BLS employment/income measurement wired — default value"),
      accessibility: assumed("No highway/airport distance measurement wired — default value"),
    };

    // State-level heuristics — still ASSUMED: a statewide generalization is
    // not a parcel or county measurement.
    if (property.state === 'TX' || property.state === 'FL') {
      factors.growthRate = 80; // High growth states
      factors.economicHealth = 75;
      provenance.growthRate = assumed("State-level heuristic (high-growth state) — not a county measurement");
      provenance.economicHealth = assumed("State-level heuristic — not a county measurement");
    } else if (property.state === 'CA' || property.state === 'NY') {
      factors.economicHealth = 70;
      factors.accessibility = 80; // Well-connected states
      provenance.economicHealth = assumed("State-level heuristic — not a county measurement");
      provenance.accessibility = assumed("State-level heuristic (well-connected state) — not a parcel measurement");
    }

    // Calculate weighted average
    const score = Math.round(
      (factors.marketStrength * 0.30 +
       factors.growthRate * 0.30 +
       factors.economicHealth * 0.25 +
       factors.accessibility * 0.15)
    );

    return { score, factors, provenance };
  }

  /**
   * Score physical characteristics (20% weight)
   */
  private async scorePhysical(
    property: any
  ): Promise<{ score: number; factors: any; provenance: DimensionProvenance }> {
    // Soil quality from REAL stored open data (USDA SSURGO via the persisted
    // enrichment jsonb) — previously hardcoded 50 while presenting as scored.
    const soil = soilQualityFromEvidence(enrichmentOf(property));

    const factors = {
      topography: 50,
      soilQuality: soil.score,
      waterAccess: 50,
      utilities: 50,
      roadAccess: 50,
    };
    const provenance: DimensionProvenance = {
      topography: assumed("No topography recorded for this property — default value"),
      soilQuality: soil.provenance,
      waterAccess: assumed("No water rights/frontage/well data recorded — default value"),
      utilities: assumed("No utility availability recorded — default value"),
      roadAccess: assumed("No road access recorded — default value"),
    };

    // Topography
    const topography = property.topography?.toLowerCase();
    if (topography === 'flat') factors.topography = 90;
    else if (topography === 'rolling') factors.topography = 70;
    else if (topography === 'hilly') factors.topography = 50;
    else if (topography === 'steep') factors.topography = 30;
    if (topography) provenance.topography = measured(PROPERTY_RECORD_SOURCE);

    // Water access
    if (property.waterRights) {
      factors.waterAccess = 95;
      provenance.waterAccess = measured(PROPERTY_RECORD_SOURCE);
    } else if (property.waterFrontage) {
      factors.waterAccess = 80;
      provenance.waterAccess = measured(PROPERTY_RECORD_SOURCE);
    } else if (property.wellDepth && property.wellDepth < 200) {
      factors.waterAccess = 70;
      provenance.waterAccess = measured(PROPERTY_RECORD_SOURCE);
    }

    // Utilities - count available
    let utilityCount = 0;
    if (property.electricAvailable) utilityCount++;
    if (property.gasAvailable) utilityCount++;
    if (property.sewerAvailable) utilityCount++;
    if (property.internetAvailable) utilityCount++;
    factors.utilities = Math.min(100, 50 + (utilityCount * 12));
    if (utilityCount > 0) provenance.utilities = measured(PROPERTY_RECORD_SOURCE);

    // Road access
    const roadAccess = property.roadAccess?.toLowerCase();
    if (roadAccess === 'paved') factors.roadAccess = 90;
    else if (roadAccess === 'gravel') factors.roadAccess = 70;
    else if (roadAccess === 'dirt') factors.roadAccess = 50;
    else if (roadAccess === 'none') factors.roadAccess = 20;
    if (roadAccess) provenance.roadAccess = measured(PROPERTY_RECORD_SOURCE);

    const score = Math.round(
      (factors.topography * 0.20 +
       factors.soilQuality * 0.20 +
       factors.waterAccess * 0.25 +
       factors.utilities * 0.20 +
       factors.roadAccess * 0.15)
    );

    return { score, factors, provenance };
  }

  /**
   * Score legal factors (15% weight)
   */
  private async scoreLegal(
    property: any
  ): Promise<{ score: number; factors: any; provenance: DimensionProvenance }> {
    const factors = {
      zoning: 50,
      restrictions: 70, // Assume few restrictions by default
      mineralRights: 50,
      waterRights: 50,
      clearTitle: 90, // Assume clear title by default
    };
    const provenance: DimensionProvenance = {
      zoning: assumed("No zoning recorded for this property — default value"),
      restrictions: assumed("Assumed few restrictions — no covenant/HOA data recorded"),
      mineralRights: assumed("No mineral-rights status recorded — default value"),
      waterRights: assumed("No water-rights status recorded — default value"),
      clearTitle: assumed("Assumed clear title — no title search data"),
    };

    // Zoning
    const zoning = property.zoning?.toLowerCase();
    if (zoning?.includes('commercial')) factors.zoning = 95;
    else if (zoning?.includes('residential')) factors.zoning = 90;
    else if (zoning?.includes('industrial')) factors.zoning = 85;
    else if (zoning?.includes('agricultural')) factors.zoning = 70;
    else if (zoning?.includes('conservation')) factors.zoning = 40;
    if (zoning) provenance.zoning = measured(PROPERTY_RECORD_SOURCE);

    // Water rights
    if (property.waterRights) {
      factors.waterRights = 95;
      provenance.waterRights = measured(PROPERTY_RECORD_SOURCE);
    }

    // Mineral rights
    if (property.mineralRights === 'owned') {
      factors.mineralRights = 100;
    } else if (property.mineralRights === 'partial') {
      factors.mineralRights = 60;
    } else if (property.mineralRights === 'severed') {
      factors.mineralRights = 30;
    }
    if (['owned', 'partial', 'severed'].includes(property.mineralRights)) {
      provenance.mineralRights = measured(PROPERTY_RECORD_SOURCE);
    }

    // HOA restrictions
    if (property.hoaFees && property.hoaFees > 0) {
      factors.restrictions = 50; // HOAs reduce flexibility
      provenance.restrictions = measured(PROPERTY_RECORD_SOURCE);
    }

    const score = Math.round(
      (factors.zoning * 0.30 +
       factors.restrictions * 0.20 +
       factors.mineralRights * 0.15 +
       factors.waterRights * 0.20 +
       factors.clearTitle * 0.15)
    );

    return { score, factors, provenance };
  }

  /**
   * Score financial factors (20% weight)
   */
  private async scoreFinancial(
    property: any
  ): Promise<{ score: number; factors: any; provenance: DimensionProvenance }> {
    const factors = {
      cashFlow: 50,
      appreciation: 60,
      liquidity: 50,
      taxBurden: 70,
      maintenanceCost: 75,
    };
    const provenance: DimensionProvenance = {
      cashFlow: assumed("No income records — assumed non-income-generating"),
      appreciation: assumed("No purchase-price + current-value pair recorded — default value"),
      liquidity: assumed("No acreage/value recorded — default value"),
      taxBurden: assumed("No property-tax record — default value"),
      maintenanceCost: assumed("No maintenance records — default value"),
    };

    // Cash flow - if generating income
    if (property.monthlyIncome && property.monthlyIncome > 0) {
      provenance.cashFlow = measured(PROPERTY_RECORD_SOURCE);
      const annualIncome = property.monthlyIncome * 12;
      const value = property.estimatedValue || property.purchasePrice || 0;
      const yieldPercent = (annualIncome / value) * 100;
      
      if (yieldPercent > 8) factors.cashFlow = 95;
      else if (yieldPercent > 5) factors.cashFlow = 80;
      else if (yieldPercent > 3) factors.cashFlow = 65;
      else factors.cashFlow = 50;
    } else {
      factors.cashFlow = 40; // No income generation
    }

    // Appreciation - historical
    if (property.purchasePrice && property.estimatedValue) {
      provenance.appreciation = measured(PROPERTY_RECORD_SOURCE);
      const appreciation = ((property.estimatedValue - property.purchasePrice) / property.purchasePrice) * 100;
      const annualAppreciation = appreciation / ((new Date().getTime() - new Date(property.purchaseDate).getTime()) / (365 * 24 * 60 * 60 * 1000));
      
      if (annualAppreciation > 10) factors.appreciation = 95;
      else if (annualAppreciation > 7) factors.appreciation = 85;
      else if (annualAppreciation > 5) factors.appreciation = 75;
      else if (annualAppreciation > 3) factors.appreciation = 60;
      else if (annualAppreciation > 0) factors.appreciation = 50;
      else factors.appreciation = 30; // Depreciation
    }

    // Liquidity - based on acreage and price
    const acres = property.acres || 0;
    const value = property.estimatedValue || property.purchasePrice || 0;
    const pricePerAcre = acres > 0 ? value / acres : 0;
    if (acres > 0 || value > 0) provenance.liquidity = measured(PROPERTY_RECORD_SOURCE);

    // Smaller parcels and reasonable prices = higher liquidity
    if (acres < 5 && pricePerAcre < 10000) factors.liquidity = 85;
    else if (acres < 20 && pricePerAcre < 15000) factors.liquidity = 70;
    else if (acres < 40 && pricePerAcre < 20000) factors.liquidity = 60;
    else if (acres > 100 || pricePerAcre > 50000) factors.liquidity = 35;

    // Tax burden
    const annualTax = property.annualPropertyTax || 0;
    if (value > 0) {
      const taxRate = (annualTax / value) * 100;
      if (taxRate < 0.5) factors.taxBurden = 95;
      else if (taxRate < 1.0) factors.taxBurden = 80;
      else if (taxRate < 1.5) factors.taxBurden = 65;
      else if (taxRate < 2.0) factors.taxBurden = 50;
      else factors.taxBurden = 35;
      // Only a real tax record makes this a measurement — a missing tax
      // amount computed against a real value is still an assumption.
      provenance.taxBurden =
        property.annualPropertyTax != null
          ? measured(PROPERTY_RECORD_SOURCE)
          : assumed("No property-tax record — rate computed with tax = 0");
    }

    const score = Math.round(
      (factors.cashFlow * 0.25 +
       factors.appreciation * 0.30 +
       factors.liquidity * 0.20 +
       factors.taxBurden * 0.15 +
       factors.maintenanceCost * 0.10)
    );

    return { score, factors, provenance };
  }

  /**
   * Score environmental factors (10% weight)
   */
  private async scoreEnvironmental(
    property: any
  ): Promise<{ score: number; factors: any; provenance: DimensionProvenance }> {
    // REAL stored open data: the properties table has no floodZone/wetlands
    // columns — the old `property.floodZone` read hit a column that never
    // existed, so floodRisk always sat at the 80 default. The persisted
    // enrichment jsonb (FEMA NFHL / USFWS NWI via the broker) is the actual
    // per-parcel evidence; defaults stand, honestly marked, when it's absent.
    const enrichment = enrichmentOf(property);
    const flood = floodRiskFromEvidence(enrichment);
    const wetlands = wetlandsFromEvidence(enrichment);

    const factors = {
      floodRisk: flood.score,
      wildfire: 80,
      contamination: 90,
      wetlands: wetlands.score,
      endangered: 85,
    };
    const provenance: DimensionProvenance = {
      floodRisk: flood.provenance,
      wildfire: assumed("No parcel-level wildfire measurement — default value"),
      contamination: assumed("No parcel-level contamination lookup stored — default assumes none"),
      wetlands: wetlands.provenance,
      endangered: assumed("No parcel-level endangered-species lookup stored — default value"),
    };

    // Wildfire risk - approximate by state. Still ASSUMED: a statewide
    // generalization is not a parcel measurement.
    if (['CA', 'CO', 'OR', 'WA', 'MT', 'ID'].includes(property.state)) {
      factors.wildfire = 60; // Higher risk western states
      provenance.wildfire = assumed("State-level wildfire heuristic — not a parcel measurement");
    }

    const score = Math.round(
      (factors.floodRisk * 0.30 +
       factors.wildfire * 0.25 +
       factors.contamination * 0.20 +
       factors.wetlands * 0.15 +
       factors.endangered * 0.10)
    );

    return { score, factors, provenance };
  }

  /**
   * Score market factors (10% weight)
   */
  private async scoreMarket(
    property: any
  ): Promise<{ score: number; factors: any; provenance: DimensionProvenance }> {
    const factors = {
      demand: 60,
      supply: 60,
      priceHistory: 70,
      daysOnMarket: 60,
      comparables: 65,
    };
    const provenance: DimensionProvenance = {
      demand: assumed("No buyer-interest measurement wired — default value"),
      supply: assumed("No comparable-inventory measurement wired — default value"),
      priceHistory: assumed("No price-history measurement wired — default value"),
      daysOnMarket: assumed("No listing days-on-market recorded — default value"),
      comparables: assumed("No comps quality measurement wired — default value"),
    };

    // Would integrate with marketPrediction service
    // For now, use heuristics

    // Days on market
    if (property.daysOnMarket) {
      if (property.daysOnMarket < 30) factors.daysOnMarket = 95;
      else if (property.daysOnMarket < 90) factors.daysOnMarket = 75;
      else if (property.daysOnMarket < 180) factors.daysOnMarket = 55;
      else if (property.daysOnMarket < 365) factors.daysOnMarket = 40;
      else factors.daysOnMarket = 25;
      provenance.daysOnMarket = measured(PROPERTY_RECORD_SOURCE);
    }

    const score = Math.round(
      (factors.demand * 0.25 +
       factors.supply * 0.20 +
       factors.priceHistory * 0.20 +
       factors.daysOnMarket * 0.20 +
       factors.comparables * 0.15)
    );

    return { score, factors, provenance };
  }

  /**
   * Convert numeric score to letter grade — delegates to the exported
   * single-source-of-truth thresholds (shared with the public partial LCS).
   */
  private determineGrade(score: number): CreditScore['grade'] {
    return lcsGradeForScore(score);
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(score: number): CreditScore['riskLevel'] {
    if (score >= 740) return 'excellent';
    if (score >= 670) return 'good';
    if (score >= 580) return 'fair';
    if (score >= 500) return 'poor';
    return 'high';
  }

  /**
   * Identify top strengths and weaknesses
   */
  private identifyStrengthsWeaknesses(
    factors: ScoringFactors
  ): { strengths: string[]; weaknesses: string[] } {
    const dimensions = [
      { name: 'Location', score: factors.location.score, factors: factors.location.factors },
      { name: 'Physical', score: factors.physical.score, factors: factors.physical.factors },
      { name: 'Legal', score: factors.legal.score, factors: factors.legal.factors },
      { name: 'Financial', score: factors.financial.score, factors: factors.financial.factors },
      { name: 'Environmental', score: factors.environmental.score, factors: factors.environmental.factors },
      { name: 'Market', score: factors.market.score, factors: factors.market.factors },
    ];

    // Sort by score
    dimensions.sort((a, b) => b.score - a.score);

    // Top 3 = strengths
    const strengths = dimensions.slice(0, 3).map(d => {
      const topFactor = Object.entries(d.factors as any)
        .sort((a, b) => (b[1] as number) - (a[1] as number))[0];
      return `${d.name}: ${this.formatFactorName(topFactor[0])} (${d.score}/100)`;
    });

    // Bottom 3 = weaknesses
    const weaknesses = dimensions.slice(-3).reverse().map(d => {
      const bottomFactor = Object.entries(d.factors as any)
        .sort((a, b) => (a[1] as number) - (b[1] as number))[0];
      return `${d.name}: ${this.formatFactorName(bottomFactor[0])} (${d.score}/100)`;
    });

    return { strengths, weaknesses };
  }

  /**
   * Generate improvement recommendations
   */
  private generateRecommendations(
    factors: ScoringFactors,
    overallScore: number
  ): string[] {
    const recommendations: string[] = [];

    // Check each dimension for improvement opportunities
    if (factors.physical.score < 60) {
      if (factors.physical.factors.utilities < 60) {
        recommendations.push('Improve utility access to increase property value and marketability');
      }
      if (factors.physical.factors.roadAccess < 60) {
        recommendations.push('Invest in road improvements or establish legal access');
      }
    }

    if (factors.legal.score < 60) {
      if (factors.legal.factors.zoning < 60) {
        recommendations.push('Explore zoning change or variance for higher-value use');
      }
      if (factors.legal.factors.mineralRights < 60) {
        recommendations.push('Consider negotiating mineral rights purchase if economically viable');
      }
    }

    if (factors.financial.score < 60) {
      if (factors.financial.factors.cashFlow < 50) {
        recommendations.push('Explore income-generating opportunities: leasing, ag use, cell towers');
      }
      if (factors.financial.factors.liquidity < 50) {
        recommendations.push('Consider subdivision to create smaller, more liquid parcels');
      }
    }

    if (factors.environmental.score < 60) {
      if (factors.environmental.factors.floodRisk < 60) {
        recommendations.push('Investigate flood mitigation strategies or elevation certificates');
      }
      if (factors.environmental.factors.wildfire < 60) {
        recommendations.push('Implement defensible space and fire-safe landscaping');
      }
    }

    if (overallScore < 620) {
      recommendations.push('Overall score indicates higher risk - focus on top 2-3 weaknesses first');
    }

    if (recommendations.length === 0) {
      recommendations.push('Property scores well across all dimensions - maintain current characteristics');
    }

    return recommendations.slice(0, 5); // Return top 5
  }

  /**
   * Format factor name for display
   */
  private formatFactorName(factor: string): string {
    return factor
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Get score history for property
   */
  async getScoreHistory(
    organizationId: string,
    propertyId: string
  ): Promise<any[]> {
    // Schema: land_credit_scores has propertyId (integer) but no organizationId.
    // Org scoping is enforced by verifying the property belongs to this org
    // before querying score history. Invalid / non-numeric propertyId returns
    // empty — no throw — so the UI can render an empty state.
    const propId = Number(propertyId);
    if (!Number.isFinite(propId)) return [];
    try {
      const [prop] = await db
        .select({ id: properties.id, orgId: properties.organizationId })
        .from(properties)
        .where(eq(properties.id, propId))
        .limit(1);
      if (!prop || String(prop.orgId) !== String(organizationId)) return [];

      return await db.query.landCreditScores.findMany({
        where: eq(landCreditScores.propertyId, propId),
        orderBy: [desc(landCreditScores.createdAt)],
      });
    } catch (error) {
      logger.error('Failed to get score history', error);
      return [];
    }
  }

  /**
   * Calculate scores for all properties (bulk operation)
   */
  async calculateBulkScores(
    organizationId: string
  ): Promise<{ scored: number; failed: number }> {
    try {
      const props = await db.query.properties.findMany({
        where: eq(properties.organizationId, Number(organizationId)),
      });

      let scored = 0;
      let failed = 0;

      for (const prop of props) {
        try {
          await this.calculateCreditScore(organizationId, String(prop.id));
          scored++;
        } catch (error) {
          failed++;
          logger.error(`Failed to score property ${prop.id}`, error);
        }
      }

      return { scored, failed };
    } catch (error) {
      logger.error('Bulk scoring failed', error);
      throw error;
    }
  }

  /**
   * Get portfolio score distribution
   */
  async getPortfolioScoreDistribution(
    organizationId: string
  ): Promise<{
    avgScore: number;
    gradeDistribution: { grade: string; count: number }[];
    riskDistribution: { risk: string; count: number }[];
  }> {
    try {
      // land_credit_scores has no organizationId column; scope by joining to
      // the score's property. overallScore replaces the old `score` column and
      // riskLevel is derived from riskScore (no stored riskLevel column).
      const scoreRows = await db
        .select({
          overallScore: landCreditScores.overallScore,
          grade: landCreditScores.grade,
          riskScore: landCreditScores.riskScore,
        })
        .from(landCreditScores)
        .innerJoin(properties, eq(landCreditScores.propertyId, properties.id))
        .where(eq(properties.organizationId, Number(organizationId)))
        .orderBy(desc(landCreditScores.createdAt));

      if (scoreRows.length === 0) {
        return {
          avgScore: 0,
          gradeDistribution: [],
          riskDistribution: [],
        };
      }

      // Calculate average score
      const avgScore = Math.round(
        scoreRows.reduce((sum, s) => sum + s.overallScore, 0) / scoreRows.length
      );

      // Grade distribution
      const gradeMap = new Map<string, number>();
      for (const score of scoreRows) {
        gradeMap.set(score.grade, (gradeMap.get(score.grade) || 0) + 1);
      }
      const gradeDistribution = Array.from(gradeMap.entries())
        .map(([grade, count]) => ({ grade, count }))
        .sort((a, b) => b.count - a.count);

      // Risk distribution — derive a risk band from the numeric riskScore.
      const riskBand = (riskScore: number): string =>
        riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low";
      const riskMap = new Map<string, number>();
      for (const score of scoreRows) {
        const level = riskBand(score.riskScore);
        riskMap.set(level, (riskMap.get(level) || 0) + 1);
      }
      const riskDistribution = Array.from(riskMap.entries())
        .map(([risk, count]) => ({ risk, count }))
        .sort((a, b) => b.count - a.count);

      return {
        avgScore,
        gradeDistribution,
        riskDistribution,
      };
    } catch (error) {
      logger.error('Failed to get portfolio distribution', error);
      throw error;
    }
  }

  /**
   * Get ranked feature importance — which factors most affect the score
   */
  getFeatureImportance(): { factor: string; weight: number; description: string }[] {
    return [
      { factor: 'Location', weight: this.WEIGHTS.location, description: 'Market strength, population growth, economic health, accessibility' },
      { factor: 'Financial', weight: this.WEIGHTS.financial, description: 'Cash flow, appreciation, liquidity, tax burden, maintenance cost' },
      { factor: 'Physical', weight: this.WEIGHTS.physical, description: 'Topography, soil quality, water access, utilities, road access' },
      { factor: 'Legal', weight: this.WEIGHTS.legal, description: 'Zoning, restrictions, mineral rights, water rights, clear title' },
      { factor: 'Environmental', weight: this.WEIGHTS.environmental, description: 'Flood risk, wildfire, contamination, wetlands, endangered species' },
      { factor: 'Market', weight: this.WEIGHTS.market, description: 'Demand, supply, price history, days on market, comparables' },
    ].sort((a, b) => b.weight - a.weight);
  }

  /**
   * Compare score to network benchmarks.
   *
   * 2026-06-10 (T0-12 → Tier 2A): the hardcoded per-type benchmark averages
   * and state bonuses (invented numbers) were removed under T0-12. Tier 2A
   * now delegates to the own-network cohort engine (latest score per parcel,
   * state-keyed, k>=5 privacy floor). Below the floor this stays a typed
   * insufficient-data result — never invented numbers.
   */
  async compareToIndustryBenchmarks(
    score: number,
    propertyType: string,
    state: string
  ): Promise<
    | { available: true; percentile: number; benchmarkAvg: number; benchmarkMedian: number; outperforms: boolean; sampleSize: number; source: string }
    | { available: false; reason: string }
  > {
    const { creditBenchmarkingService } = await import("./creditBenchmarking");
    const comparison = await creditBenchmarkingService.compareToIndustry(score, propertyType, state);
    if (!comparison.available) {
      return { available: false, reason: comparison.reason };
    }
    return {
      available: true,
      percentile: comparison.percentile,
      // benchmarkAvg is reported as the cohort median — we do not store a mean
      // and will not invent one; median is the honest central tendency here.
      benchmarkAvg: comparison.benchmarks.median,
      benchmarkMedian: comparison.benchmarks.median,
      outperforms: comparison.vsMedian > 0,
      sampleSize: comparison.benchmarks.sampleSize,
      source: comparison.benchmarks.source,
    };
  }

  /**
   * Personalize score based on investor strategy
   */
  personalizeScore(
    baseScore: number,
    strategy: 'cash_flow' | 'appreciation' | 'flip'
  ): {
    adjustedScore: number;
    strategy: string;
    adjustments: { factor: string; change: number; reason: string }[];
  } {
    const adjustments: { factor: string; change: number; reason: string }[] = [];
    let total = 0;

    if (strategy === 'cash_flow') {
      adjustments.push({ factor: 'Financial (cash flow weight x1.5)', change: 5, reason: 'Cash flow investors prioritize income generation' });
      adjustments.push({ factor: 'Liquidity (lower weight)', change: -2, reason: 'Long hold periods reduce liquidity importance' });
      total = 3;
    } else if (strategy === 'appreciation') {
      adjustments.push({ factor: 'Location (growth markets x1.3)', change: 8, reason: 'Appreciation driven by population and job growth' });
      adjustments.push({ factor: 'Market (demand weight x1.4)', change: 5, reason: 'Strong demand markets drive appreciation' });
      adjustments.push({ factor: 'Cash flow (lower weight)', change: -5, reason: 'Appreciation investors tolerate lower current income' });
      total = 8;
    } else if (strategy === 'flip') {
      adjustments.push({ factor: 'Liquidity (x2.0 weight)', change: 10, reason: 'Flippers need to sell quickly' });
      adjustments.push({ factor: 'Market (days on market)', change: 6, reason: 'Fast-selling markets essential for flip strategy' });
      adjustments.push({ factor: 'Legal (zoning flexibility)', change: 5, reason: 'Rezoning potential increases flip upside' });
      adjustments.push({ factor: 'Environmental (higher penalty)', change: -8, reason: 'Environmental issues kill flip timelines' });
      total = 13;
    }

    return {
      adjustedScore: Math.min(850, Math.max(300, baseScore + total)),
      strategy,
      adjustments,
    };
  }

  /**
   * Generate score drill-down with improvement suggestions per factor
   */
  async generateScoreDrillDown(
    propertyId: string,
    orgId: string
  ): Promise<{
    score: number;
    factors: {
      name: string;
      value: number;
      weight: number;
      impact: 'positive' | 'negative' | 'neutral';
      howToImprove: string;
    }[];
  }> {
    const property = await db.query.properties.findFirst({
      where: and(
        eq(properties.id, Number(propertyId)),
        eq(properties.organizationId, Number(orgId))
      ),
    });

    if (!property) throw new Error('Property not found');

    const location = await this.scoreLocation(property);
    const physical = await this.scorePhysical(property);
    const legal = await this.scoreLegal(property);
    const financial = await this.scoreFinancial(property);
    const environmental = await this.scoreEnvironmental(property);
    const market = await this.scoreMarket(property);

    const overall = Math.round(
      (location.score * this.WEIGHTS.location +
       physical.score * this.WEIGHTS.physical +
       legal.score * this.WEIGHTS.legal +
       financial.score * this.WEIGHTS.financial +
       environmental.score * this.WEIGHTS.environmental +
       market.score * this.WEIGHTS.market) / 100
    );
    const creditScore = lcsCreditScale(overall);

    const improvementMap: Record<string, string> = {
      location: 'Target high-growth markets (TX, FL, GA) for better location scores. Proximity to highways and cities improves accessibility.',
      physical: 'Add utility connections (electric, water, gas) and improve road access from dirt/gravel to paved.',
      legal: 'Pursue zoning upgrade to commercial/residential. Acquire severed mineral rights if economically viable.',
      financial: 'Generate income via leasing, agricultural use, or cell tower ground leases. Reduce holding costs.',
      environmental: 'Obtain elevation certificate to reduce flood insurance premiums. Implement wildfire defensible space.',
      market: 'Price competitively to reduce days on market. Improve listing marketing and photos.',
    };

    const factors = [
      { name: 'Location', value: location.score, weight: this.WEIGHTS.location, impact: (location.score >= 65 ? 'positive' : location.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.location },
      { name: 'Physical', value: physical.score, weight: this.WEIGHTS.physical, impact: (physical.score >= 65 ? 'positive' : physical.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.physical },
      { name: 'Legal', value: legal.score, weight: this.WEIGHTS.legal, impact: (legal.score >= 65 ? 'positive' : legal.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.legal },
      { name: 'Financial', value: financial.score, weight: this.WEIGHTS.financial, impact: (financial.score >= 65 ? 'positive' : financial.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.financial },
      { name: 'Environmental', value: environmental.score, weight: this.WEIGHTS.environmental, impact: (environmental.score >= 65 ? 'positive' : environmental.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.environmental },
      { name: 'Market', value: market.score, weight: this.WEIGHTS.market, impact: (market.score >= 65 ? 'positive' : market.score >= 45 ? 'neutral' : 'negative') as any, howToImprove: improvementMap.market },
    ];

    return { score: creditScore, factors };
  }

  /**
   * Backtest score against historical performance
   */
  async backtestScore(
    propertyId: string
  ): Promise<{
    predictedPerformance: { grade: string; appreciationPct: number };
    actualPerformance: { appreciationPct: number; daysToSell: number | null };
    accuracy: number;
  }> {
    const scores = await db.query.landCreditScores.findMany({
      where: eq(landCreditScores.propertyId, Number(propertyId)),
      orderBy: [desc(landCreditScores.createdAt)],
    });

    if (scores.length === 0) {
      return {
        predictedPerformance: { grade: 'N/A', appreciationPct: 0 },
        actualPerformance: { appreciationPct: 0, daysToSell: null },
        accuracy: 0,
      };
    }

    const latestScore = scores[0];
    // Predicted appreciation based on grade
    const gradeAppreciation: Record<string, number> = {
      'A+': 12, 'A': 10, 'B+': 8, 'B': 6, 'C+': 4, 'C': 2, 'D': 0, 'F': -2,
    };
    const predictedAppreciation = gradeAppreciation[latestScore.grade] || 5;

    const property = await db.query.properties.findFirst({
      where: eq(properties.id, Number(propertyId)),
    });

    // Actual appreciation (from property data). estimatedValue maps to the
    // marketValue column; both numeric columns are stored as strings.
    let actualAppreciation = 0;
    if (property?.purchasePrice && property?.marketValue) {
      const market = Number(property.marketValue);
      const purchase = Number(property.purchasePrice);
      actualAppreciation = purchase > 0 ? ((market - purchase) / purchase) * 100 : 0;
    }

    const accuracy = actualAppreciation > 0
      ? Math.max(0, Math.min(100, 100 - Math.abs(predictedAppreciation - actualAppreciation) * 5))
      : 50;

    return {
      predictedPerformance: { grade: latestScore.grade, appreciationPct: predictedAppreciation },
      actualPerformance: {
        appreciationPct: Math.round(actualAppreciation * 10) / 10,
        daysToSell: (property as any)?.daysOnMarket || null,
      },
      accuracy: Math.round(accuracy),
    };
  }

  /**
   * Generate a 2-page Land Credit Report PDF
   */
  async generateLandCreditReport(propertyId: any, organizationId: any): Promise<Buffer> {
    const { jsPDF } = await import("jspdf");

    const score = await this.calculateCreditScore(organizationId, propertyId);
    const property = await db.query.properties.findFirst({
      where: eq(properties.id, propertyId),
    });

    const doc = new jsPDF({ unit: "in", format: "letter" });
    const margin = 0.75;
    const pageWidth = 8.5;

    // ─── Page 1: Score Overview ────────────────────────────────────────
    let y = margin;
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 30);
    doc.text("Land Credit Score Report", margin, y);
    y += 0.35;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    doc.text(`Powered by AcreOS — Land Credit Score methodology ${LCS_METHODOLOGY_VERSION}`, margin, y);
    y += 0.15;
    doc.setDrawColor(180, 160, 120);
    doc.setLineWidth(0.015);
    doc.line(margin, y, pageWidth - margin, y);
    y += 0.35;

    // Property info
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const address = property?.address || `APN: ${property?.apn || "Unknown"}`;
    doc.text(`Property: ${address}`, margin, y);
    y += 0.2;
    doc.text(`County: ${property?.county || "—"}, ${property?.state || "—"}`, margin, y);
    y += 0.2;
    const acreage = property?.sizeAcres ? `${property.sizeAcres} acres` : "Acreage unknown";
    doc.text(`Size: ${acreage}`, margin, y);
    y += 0.4;

    // Score circle (simulated as text)
    doc.setFontSize(36);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 30);
    doc.text(`${score.overall}`, margin, y);
    doc.setFontSize(14);
    doc.text(`(${score.grade})`, margin + 1.2, y);
    y += 0.15;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    doc.text(`Risk Level: ${score.riskLevel}`, margin, y);
    y += 0.4;

    // Dimension bars
    const dims = [
      { label: "Location", score: score.factors.location.score },
      { label: "Physical", score: score.factors.physical.score },
      { label: "Legal", score: score.factors.legal.score },
      { label: "Financial", score: score.factors.financial.score },
      { label: "Environmental", score: score.factors.environmental.score },
      { label: "Market", score: score.factors.market.score },
    ];

    for (const dim of dims) {
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 40);
      doc.text(dim.label, margin, y);
      doc.text(`${dim.score}`, margin + 4.5, y);

      // Bar background
      const barX = margin + 1.5;
      const barW = 2.8;
      doc.setFillColor(230, 230, 230);
      doc.rect(barX, y - 0.1, barW, 0.12, "F");

      // Bar fill
      const fillW = (dim.score / 100) * barW;
      if (dim.score >= 70) doc.setFillColor(34, 197, 94);
      else if (dim.score >= 50) doc.setFillColor(245, 158, 11);
      else doc.setFillColor(239, 68, 68);
      doc.rect(barX, y - 0.1, fillW, 0.12, "F");
      y += 0.25;
    }

    y += 0.3;

    // Strengths & weaknesses
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 30);
    doc.text("Top Strengths", margin, y);
    y += 0.2;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    for (const s of score.strengths.slice(0, 3)) {
      doc.text(`+ ${s}`, margin + 0.2, y);
      y += 0.18;
    }

    y += 0.15;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 60, 60);
    doc.text("Areas of Concern", margin, y);
    y += 0.2;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);
    for (const w of score.weaknesses.slice(0, 2)) {
      doc.text(`- ${w}`, margin + 0.2, y);
      y += 0.18;
    }

    // Footer — standing disclaimer legend (L1 liability shield): the score
    // reads like a consumer credit score by design, so every report page
    // carries the "not a consumer credit score / not FCRA" legend.
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text(DISCLAIMER_INFORMATIONAL_SCORE, margin, 9.7, { maxWidth: pageWidth - margin * 2 });
    doc.setFontSize(8);
    doc.text("Score valid for 30 days.", margin, 10.2);

    // ─── Page 2: Supporting Data ───────────────────────────────────────
    doc.addPage();
    y = margin;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 58, 30);
    doc.text("Supporting Data & Methodology", margin, y);
    y += 0.4;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(40, 40, 40);

    // Recommendations
    doc.setFont("helvetica", "bold");
    doc.text("Recommendations", margin, y);
    y += 0.2;
    doc.setFont("helvetica", "normal");
    for (const r of score.recommendations.slice(0, 5)) {
      doc.text(`• ${r}`, margin + 0.2, y);
      y += 0.18;
    }

    y += 0.3;
    doc.setFont("helvetica", "bold");
    doc.text("Methodology", margin, y);
    y += 0.2;
    doc.setFont("helvetica", "normal");
    const methodology = [
      "Location (25%): Market strength, growth rate, economic health, accessibility",
      "Physical (20%): Topography, soil quality, water access, utilities, road access",
      "Legal (15%): Zoning flexibility, restrictions, mineral rights, water rights, title",
      "Financial (20%): Cash flow potential, appreciation, liquidity, tax burden",
      "Environmental (10%): Flood risk, wildfire, contamination, wetlands",
      "Market (10%): Demand, supply, price history, days on market, comparables",
    ];
    for (const line of methodology) {
      doc.text(line, margin + 0.2, y, { maxWidth: pageWidth - margin * 2 - 0.2 });
      y += 0.22;
    }

    y += 0.3;
    // Standing disclaimer legend on the methodology page too (L1 liability
    // shield) — a printed page 2 circulates on its own.
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text(DISCLAIMER_INFORMATIONAL_SCORE, margin, 9.7, { maxWidth: pageWidth - margin * 2 });
    doc.setFontSize(8);
    doc.text(`Powered by AcreOS — Land Credit Score methodology ${LCS_METHODOLOGY_VERSION}`, margin, 10.2);

    return Buffer.from(doc.output("arraybuffer"));
  }
}

export const landCredit = new LandCreditScoring();

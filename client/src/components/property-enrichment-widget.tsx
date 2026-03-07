/**
 * PropertyEnrichmentWidget
 *
 * Reusable grid of enrichment-data cards (hazards, soil, demographics, etc.)
 * extracted from PropertyIntelligenceTab so it can be embedded anywhere
 * (property detail, deal sidebar, map popup, etc.).
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  Building2,
  Car,
  CheckCircle,
  Cloud,
  Droplets,
  Factory,
  Flame,
  Grid3x3,
  Leaf,
  Mountain,
  Shield,
  Thermometer,
  TreePine,
  TrendingUp,
  Users,
  Waves,
  Wheat,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EnrichmentData {
  enrichedAt?: Date | string;
  lookupTimeMs?: number;
  lastEnrichedAt?: string;
  completenessScore?: number;
  completenessBreakdown?: Record<string, boolean>;
  hazards?: {
    floodZone?: string;
    floodRisk?: "low" | "medium" | "high";
    wetlandsPresent?: boolean;
    wetlandsPercentage?: number;
    earthquakeRisk?: "low" | "medium" | "high";
    wildfireRisk?: "low" | "medium" | "high";
    nearbySuperfundSites?: number;
    overallRiskScore?: number;
    overallRiskLevel?: "low" | "medium" | "high";
    firmPanel?: {
      panelId?: string;
      effectiveDate?: string;
      status?: string;
    };
  };
  environment?: {
    soilType?: string;
    soilSuitability?: string;
    soilDrainage?: string;
    capabilityClass?: string;
    hydrologicGroup?: string;
    primeFarmland?: boolean;
    farmlandClass?: string;
    epaFacilitiesNearby?: number;
    epaRiskLevel?: "low" | "medium" | "high";
  };
  infrastructure?: {
    nearestHospitalMiles?: number;
    nearestFireStationMiles?: number;
    nearestSchoolMiles?: number;
    nearbyHospitals?: number;
    nearbyFireStations?: number;
    nearbySchools?: number;
    accessScore?: number;
  };
  demographics?: {
    population?: number;
    medianIncome?: number;
    medianHouseholdIncome?: number;
    medianHomeValue?: number;
    povertyRate?: number;
    collegeEducated?: number;
    ownerOccupancyRate?: number;
    vacancyRate?: number;
    avgCommuteMinutes?: number;
    unemployment?: string;
  };
  publicLands?: {
    nearBLM?: boolean;
    nearUSFS?: boolean;
    nearNPS?: boolean;
    federalLandWithinMiles?: number;
  };
  transportation?: {
    nearestHighwayMiles?: number;
    nearestBridgeMiles?: number;
    nearestRailMiles?: number;
    roadAccessScore?: number;
    hasPavedRoad?: boolean | null;
    hasDirtRoad?: boolean | null;
    localRoadCount?: number;
  };
  water?: {
    nearestStreamMiles?: number;
    nearestWaterBodyMiles?: number;
    waterAvailabilityScore?: number;
  };
  scores?: {
    investmentScore?: number;
    developmentScore?: number;
    riskScore?: number;
    overallScore?: number;
  };
  elevation?: {
    elevationFeet?: number;
    elevationMeters?: number;
    datum?: string;
    source?: string;
  };
  climate?: {
    avgHighTempF?: number;
    avgLowTempF?: number;
    annualPrecipInches?: number;
    period?: string;
    source?: string;
  };
  agriculturalValues?: {
    countyAvgPerAcre?: number | null;
    stateAvgPerAcre?: number | null;
    nationalAvgPerAcre?: number | null;
    dataYear?: number;
    notes?: string;
    source?: string;
  };
  landCover?: {
    nlcdClass?: number | null;
    className?: string;
    isAgricultural?: boolean;
    isDeveloped?: boolean;
    isForested?: boolean;
    isWetland?: boolean;
    year?: number;
    source?: string;
  };
  cropland?: {
    cropCode?: number | null;
    cropName?: string;
    year?: number;
    isAgriculturalCrop?: boolean;
    isPastureOrHay?: boolean;
    isCultivatedCrop?: boolean;
    isForest?: boolean;
    isWetland?: boolean;
    source?: string;
  };
  epaFacilities?: {
    totalCount?: number;
    superfundCount?: number;
    airViolationCount?: number;
    waterViolationCount?: number;
    hazWasteCount?: number;
    riskLevel?: "low" | "medium" | "high";
    searchRadiusMiles?: number;
    source?: string;
  };
  stormHistory?: {
    tornadoRisk?: string;
    hurricaneRisk?: string;
    hailRisk?: string;
    countyName?: string;
    note?: string;
    source?: string;
  };
  plss?: {
    section?: string;
    township?: string;
    range?: string;
    legalDescription?: string;
    source?: string;
  };
  watershed?: {
    huc8?: string;
    huc12?: string;
    watershedName?: string;
    source?: string;
  };
  femaNri?: {
    compositeScore?: number;
    riverineFloodRisk?: string;
    hurricaneRisk?: string;
    tornadoRisk?: string;
    wildfireRisk?: string;
    hailRisk?: string;
    source?: string;
  };
  usdaClu?: {
    cluId?: string;
    farmNumber?: string;
    tractNumber?: string;
    calculatedAcres?: number;
    source?: string;
  };
  errors?: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRiskBadgeVariant(risk?: "low" | "medium" | "high"): "default" | "secondary" | "destructive" {
  if (risk === "high") return "destructive";
  if (risk === "medium") return "secondary";
  return "default";
}

function getRiskColor(risk?: "low" | "medium" | "high"): string {
  if (risk === "high") return "text-red-600 font-medium";
  if (risk === "medium") return "text-yellow-600 font-medium";
  return "text-green-600 font-medium";
}

function formatDistance(miles?: number): string {
  if (miles === undefined || miles === null) return "N/A";
  return miles < 1 ? `${(miles * 5280).toFixed(0)} ft` : `${miles.toFixed(1)} mi`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  enrichmentData: EnrichmentData;
}

export function PropertyEnrichmentWidget({ enrichmentData }: Props) {
  return (
    <div className="space-y-4">
      {/* Data Completeness */}
      {enrichmentData.completenessScore !== undefined && (
        <Card data-testid="card-completeness">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm">Data Completeness</h4>
              </div>
              <span className="text-lg font-bold tabular-nums">{enrichmentData.completenessScore}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 mb-3">
              <div
                className={`h-2 rounded-full transition-all ${
                  enrichmentData.completenessScore >= 80
                    ? "bg-green-500"
                    : enrichmentData.completenessScore >= 50
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${enrichmentData.completenessScore}%` }}
              />
            </div>
            {enrichmentData.completenessBreakdown && (
              <div className="grid grid-cols-4 gap-1 mt-2">
                {Object.entries(enrichmentData.completenessBreakdown).map(([key, value]) => (
                  <div
                    key={key}
                    className={`text-xs px-1.5 py-0.5 rounded text-center truncate ${
                      value
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                    title={key}
                  >
                    {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Investment Scores */}
        {enrichmentData.scores && (
          <Card data-testid="card-scores">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h4 className="font-semibold">Investment Scores</h4>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1" data-testid="score-overall">
                  <span className="text-muted-foreground text-xs">Overall Score</span>
                  <p className="font-bold text-xl">
                    {enrichmentData.scores.overallScore ?? "N/A"}
                    <span className="text-sm font-normal text-muted-foreground">/100</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">Investment</span>
                  <p className="font-medium text-lg">{enrichmentData.scores.investmentScore ?? "N/A"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">Development</span>
                  <p className="font-medium">{enrichmentData.scores.developmentScore ?? "N/A"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs">Risk Score</span>
                  <p
                    className={`font-medium ${
                      (enrichmentData.scores.riskScore ?? 0) > 50
                        ? "text-red-600"
                        : (enrichmentData.scores.riskScore ?? 0) > 25
                        ? "text-yellow-600"
                        : "text-green-600"
                    }`}
                  >
                    {enrichmentData.scores.riskScore ?? "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Flood & Water Risk */}
        {enrichmentData.hazards && (
          <Card data-testid="card-flood-zone">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Droplets className="w-4 h-4 text-blue-500" />
                <h4 className="font-semibold">Flood & Water Risk</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Flood Zone</span>
                  <Badge variant="outline">{enrichmentData.hazards.floodZone || "Unknown"}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Flood Risk</span>
                  <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.floodRisk)} className="capitalize">
                    {enrichmentData.hazards.floodRisk || "Unknown"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Wetlands Present</span>
                  <span className={enrichmentData.hazards.wetlandsPresent ? "text-yellow-600" : "text-green-600"}>
                    {enrichmentData.hazards.wetlandsPresent
                      ? `Yes (${enrichmentData.hazards.wetlandsPercentage}%)`
                      : "No"}
                  </span>
                </div>
                {enrichmentData.hazards.firmPanel?.panelId && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">FIRM Panel</span>
                    <span className="font-mono text-xs">{enrichmentData.hazards.firmPanel.panelId}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Natural Hazards */}
        {enrichmentData.hazards && (
          <Card data-testid="card-natural-hazards">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Flame className="w-4 h-4 text-orange-500" />
                <h4 className="font-semibold">Natural Hazards</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Mountain className="w-3 h-3" /> Earthquake
                  </span>
                  <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.earthquakeRisk)} className="capitalize">
                    {enrichmentData.hazards.earthquakeRisk || "Unknown"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Flame className="w-3 h-3" /> Wildfire
                  </span>
                  <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.wildfireRisk)} className="capitalize">
                    {enrichmentData.hazards.wildfireRisk || "Unknown"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Overall Risk</span>
                  <span className={getRiskColor(enrichmentData.hazards.overallRiskLevel)}>
                    {enrichmentData.hazards.overallRiskScore !== undefined
                      ? `${enrichmentData.hazards.overallRiskScore}/100 (${enrichmentData.hazards.overallRiskLevel})`
                      : "N/A"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Environmental */}
        {enrichmentData.environment && (
          <Card data-testid="card-environmental">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Leaf className="w-4 h-4 text-green-600" />
                <h4 className="font-semibold">Environmental & Soil</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Soil Type</span>
                  <span>{enrichmentData.environment.soilType || "Unknown"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Suitability</span>
                  <span className="capitalize">{enrichmentData.environment.soilSuitability || "Unknown"}</span>
                </div>
                {enrichmentData.environment.capabilityClass && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Capability Class</span>
                    <Badge variant="outline">Class {enrichmentData.environment.capabilityClass}</Badge>
                  </div>
                )}
                {enrichmentData.environment.primeFarmland !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Prime Farmland</span>
                    <span className={enrichmentData.environment.primeFarmland ? "text-green-600" : "text-muted-foreground"}>
                      {enrichmentData.environment.primeFarmland ? "Yes" : "No"}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">EPA Sites Nearby</span>
                  <span
                    className={
                      enrichmentData.environment.epaFacilitiesNearby && enrichmentData.environment.epaFacilitiesNearby > 0
                        ? "text-yellow-600"
                        : "text-green-600"
                    }
                  >
                    {enrichmentData.environment.epaFacilitiesNearby ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">EPA Risk Level</span>
                  <Badge variant={getRiskBadgeVariant(enrichmentData.environment.epaRiskLevel)} className="capitalize">
                    {enrichmentData.environment.epaRiskLevel || "Unknown"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Infrastructure */}
        {enrichmentData.infrastructure && (
          <Card data-testid="card-infrastructure">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-semibold">Infrastructure</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nearest Hospital</span>
                  <span>{formatDistance(enrichmentData.infrastructure.nearestHospitalMiles)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nearest Fire Station</span>
                  <span>{formatDistance(enrichmentData.infrastructure.nearestFireStationMiles)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nearest School</span>
                  <span>{formatDistance(enrichmentData.infrastructure.nearestSchoolMiles)}</span>
                </div>
                {enrichmentData.infrastructure.accessScore !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Access Score</span>
                    <span className="font-medium">{enrichmentData.infrastructure.accessScore}/100</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Demographics */}
        {enrichmentData.demographics && (
          <Card data-testid="card-demographics">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-indigo-500" />
                <h4 className="font-semibold">Demographics</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Population</span>
                  <span>{enrichmentData.demographics.population?.toLocaleString() || "N/A"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Median Income</span>
                  <span>
                    {(enrichmentData.demographics.medianHouseholdIncome ?? enrichmentData.demographics.medianIncome)
                      ? `$${(enrichmentData.demographics.medianHouseholdIncome ?? enrichmentData.demographics.medianIncome)!.toLocaleString()}`
                      : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Median Home Value</span>
                  <span>
                    {enrichmentData.demographics.medianHomeValue
                      ? `$${enrichmentData.demographics.medianHomeValue.toLocaleString()}`
                      : "N/A"}
                  </span>
                </div>
                {enrichmentData.demographics.ownerOccupancyRate !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Owner Occupancy</span>
                    <span>{enrichmentData.demographics.ownerOccupancyRate}%</span>
                  </div>
                )}
                {enrichmentData.demographics.vacancyRate !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Vacancy Rate</span>
                    <span>{enrichmentData.demographics.vacancyRate}%</span>
                  </div>
                )}
                {enrichmentData.demographics.avgCommuteMinutes !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Avg Commute</span>
                    <span>{enrichmentData.demographics.avgCommuteMinutes} min</span>
                  </div>
                )}
                {enrichmentData.demographics.unemployment && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Unemployment</span>
                    <span>{enrichmentData.demographics.unemployment}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transportation */}
        {enrichmentData.transportation && (
          <Card data-testid="card-transportation">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Car className="w-4 h-4 text-muted-foreground" />
                <h4 className="font-semibold">Transportation</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nearest Highway</span>
                  <span>{formatDistance(enrichmentData.transportation.nearestHighwayMiles)}</span>
                </div>
                {enrichmentData.transportation.nearestBridgeMiles !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Nearest Bridge</span>
                    <span>{formatDistance(enrichmentData.transportation.nearestBridgeMiles)}</span>
                  </div>
                )}
                {enrichmentData.transportation.nearestRailMiles !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Nearest Rail</span>
                    <span>{formatDistance(enrichmentData.transportation.nearestRailMiles)}</span>
                  </div>
                )}
                {enrichmentData.transportation.hasPavedRoad !== null &&
                  enrichmentData.transportation.hasPavedRoad !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Paved Road Access</span>
                      <span className={enrichmentData.transportation.hasPavedRoad ? "text-green-600" : "text-yellow-600"}>
                        {enrichmentData.transportation.hasPavedRoad ? "Yes" : "No"}
                      </span>
                    </div>
                  )}
                {enrichmentData.transportation.roadAccessScore !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Road Access Score</span>
                    <span className="font-medium">{enrichmentData.transportation.roadAccessScore}/100</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Public Lands */}
        {enrichmentData.publicLands && (
          <Card data-testid="card-public-lands">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <TreePine className="w-4 h-4 text-green-700" />
                <h4 className="font-semibold">Public Lands</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Near BLM Land</span>
                  <span>{enrichmentData.publicLands.nearBLM ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Near US Forest Service</span>
                  <span>{enrichmentData.publicLands.nearUSFS ? "Yes" : "No"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Near National Parks</span>
                  <span>{enrichmentData.publicLands.nearNPS ? "Yes" : "No"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Water Resources */}
        {enrichmentData.water && (
          <Card data-testid="card-water-resources">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Droplets className="w-4 h-4 text-cyan-500" />
                <h4 className="font-semibold">Water Resources</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nearest Stream</span>
                  <span>{formatDistance(enrichmentData.water.nearestStreamMiles)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nearest Water Body</span>
                  <span>{formatDistance(enrichmentData.water.nearestWaterBodyMiles)}</span>
                </div>
                {enrichmentData.water.waterAvailabilityScore !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Water Availability</span>
                    <span className="font-medium">{enrichmentData.water.waterAvailabilityScore}/100</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Elevation */}
        {enrichmentData.elevation && (
          <Card data-testid="card-elevation">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Mountain className="w-4 h-4 text-slate-500" />
                <h4 className="font-semibold">Elevation & Terrain</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.elevation.elevationFeet !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Elevation</span>
                    <span className="font-medium">
                      {enrichmentData.elevation.elevationFeet?.toLocaleString()} ft
                      {enrichmentData.elevation.elevationMeters !== undefined &&
                        ` (${enrichmentData.elevation.elevationMeters?.toFixed(0)} m)`}
                    </span>
                  </div>
                )}
                {enrichmentData.elevation.datum && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Datum</span>
                    <span className="text-xs">{enrichmentData.elevation.datum}</span>
                  </div>
                )}
                {enrichmentData.elevation.source && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <Badge variant="outline" className="text-xs">{enrichmentData.elevation.source}</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Climate */}
        {enrichmentData.climate && (
          <Card data-testid="card-climate">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Thermometer className="w-4 h-4 text-orange-400" />
                <h4 className="font-semibold">Climate & Growing</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.climate.avgHighTempF !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Avg High Temp</span>
                    <span>{enrichmentData.climate.avgHighTempF}°F</span>
                  </div>
                )}
                {enrichmentData.climate.avgLowTempF !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Avg Low Temp</span>
                    <span>{enrichmentData.climate.avgLowTempF}°F</span>
                  </div>
                )}
                {enrichmentData.climate.annualPrecipInches !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Annual Precip</span>
                    <span>{enrichmentData.climate.annualPrecipInches}" / yr</span>
                  </div>
                )}
                {enrichmentData.climate.period && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Period</span>
                    <span className="text-xs text-muted-foreground">{enrichmentData.climate.period}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Agricultural Values */}
        {enrichmentData.agriculturalValues && (
          <Card data-testid="card-agricultural-values">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wheat className="w-4 h-4 text-yellow-600" />
                <h4 className="font-semibold">Agricultural Values</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.agriculturalValues.countyAvgPerAcre != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">County Avg / Acre</span>
                    <span className="font-medium">${enrichmentData.agriculturalValues.countyAvgPerAcre.toLocaleString()}</span>
                  </div>
                )}
                {enrichmentData.agriculturalValues.stateAvgPerAcre != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">State Avg / Acre</span>
                    <span>${enrichmentData.agriculturalValues.stateAvgPerAcre.toLocaleString()}</span>
                  </div>
                )}
                {enrichmentData.agriculturalValues.nationalAvgPerAcre != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">National Avg / Acre</span>
                    <span>${enrichmentData.agriculturalValues.nationalAvgPerAcre.toLocaleString()}</span>
                  </div>
                )}
                {enrichmentData.agriculturalValues.dataYear && (
                  <p className="text-xs text-muted-foreground">{enrichmentData.agriculturalValues.dataYear} (USDA NASS)</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Land Cover */}
        {enrichmentData.landCover && (
          <Card data-testid="card-land-cover">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Leaf className="w-4 h-4 text-emerald-500" />
                <h4 className="font-semibold">Land Cover</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.landCover.className && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cover Type</span>
                    <Badge variant="outline" className="capitalize">{enrichmentData.landCover.className}</Badge>
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mt-1">
                  {enrichmentData.landCover.isAgricultural && <Badge variant="secondary" className="text-xs">Agricultural</Badge>}
                  {enrichmentData.landCover.isDeveloped && <Badge variant="secondary" className="text-xs">Developed</Badge>}
                  {enrichmentData.landCover.isForested && <Badge variant="secondary" className="text-xs">Forested</Badge>}
                  {enrichmentData.landCover.isWetland && <Badge variant="secondary" className="text-xs">Wetland</Badge>}
                </div>
                {enrichmentData.landCover.year && (
                  <p className="text-xs text-muted-foreground">NLCD {enrichmentData.landCover.year}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cropland */}
        {enrichmentData.cropland && (
          <Card data-testid="card-cropland">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wheat className="w-4 h-4 text-amber-500" />
                <h4 className="font-semibold">Cropland Data</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.cropland.cropName && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Dominant Crop</span>
                    <span className="font-medium capitalize">{enrichmentData.cropland.cropName}</span>
                  </div>
                )}
                {enrichmentData.cropland.year && (
                  <p className="text-xs text-muted-foreground">{enrichmentData.cropland.year} (USDA CDL)</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1">
                  {enrichmentData.cropland.isCultivatedCrop && <Badge variant="secondary" className="text-xs">Cultivated</Badge>}
                  {enrichmentData.cropland.isPastureOrHay && <Badge variant="secondary" className="text-xs">Pasture/Hay</Badge>}
                  {enrichmentData.cropland.isForest && <Badge variant="secondary" className="text-xs">Forest</Badge>}
                  {enrichmentData.cropland.isWetland && <Badge variant="secondary" className="text-xs">Wetland</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* EPA Facilities */}
        {enrichmentData.epaFacilities && (
          <Card data-testid="card-epa-facilities">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Factory className="w-4 h-4 text-gray-500" />
                <h4 className="font-semibold">EPA Facilities Nearby</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total Facilities</span>
                  <span
                    className={
                      (enrichmentData.epaFacilities.totalCount ?? 0) > 0 ? "text-yellow-600 font-medium" : "text-green-600"
                    }
                  >
                    {enrichmentData.epaFacilities.totalCount ?? 0}
                  </span>
                </div>
                {(enrichmentData.epaFacilities.superfundCount ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Superfund Sites</span>
                    <span className="text-red-600 font-medium">{enrichmentData.epaFacilities.superfundCount}</span>
                  </div>
                )}
                {(enrichmentData.epaFacilities.airViolationCount ?? 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Air Violations</span>
                    <span className="text-orange-500">{enrichmentData.epaFacilities.airViolationCount}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Risk Level</span>
                  <Badge variant={getRiskBadgeVariant(enrichmentData.epaFacilities.riskLevel)} className="capitalize">
                    {enrichmentData.epaFacilities.riskLevel || "Unknown"}
                  </Badge>
                </div>
                {enrichmentData.epaFacilities.searchRadiusMiles && (
                  <p className="text-xs text-muted-foreground">
                    Within {enrichmentData.epaFacilities.searchRadiusMiles} mile radius (EPA FRS)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Storm Risk */}
        {enrichmentData.stormHistory && (
          <Card data-testid="card-storm-history">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Cloud className="w-4 h-4 text-blue-400" />
                <h4 className="font-semibold">Storm Risk</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tornado Risk</span>
                  <span className="capitalize font-medium">{enrichmentData.stormHistory.tornadoRisk || "Unknown"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hurricane Risk</span>
                  <span className="capitalize font-medium">{enrichmentData.stormHistory.hurricaneRisk || "Unknown"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hail Risk</span>
                  <span className="capitalize font-medium">{enrichmentData.stormHistory.hailRisk || "Unknown"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* PLSS */}
        {enrichmentData.plss && (
          <Card data-testid="card-plss">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Grid3x3 className="w-4 h-4 text-teal-600" />
                <h4 className="font-semibold">PLSS Legal Description</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.plss.legalDescription && (
                  <div>
                    <span className="text-muted-foreground text-xs">Legal Description</span>
                    <p className="font-mono font-medium mt-0.5">{enrichmentData.plss.legalDescription}</p>
                  </div>
                )}
                {enrichmentData.plss.section && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Section</span>
                    <span>{enrichmentData.plss.section}</span>
                  </div>
                )}
                {enrichmentData.plss.township && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Township</span>
                    <span>{enrichmentData.plss.township}</span>
                  </div>
                )}
                {enrichmentData.plss.range && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Range</span>
                    <span>{enrichmentData.plss.range}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">BLM CadNSDI</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Watershed */}
        {enrichmentData.watershed && (
          <Card data-testid="card-watershed">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Waves className="w-4 h-4 text-blue-500" />
                <h4 className="font-semibold">Watershed</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.watershed.watershedName && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Watershed Name</span>
                    <span className="font-medium text-right max-w-[60%]">{enrichmentData.watershed.watershedName}</span>
                  </div>
                )}
                {enrichmentData.watershed.huc8 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">HUC-8</span>
                    <span className="font-mono text-xs">{enrichmentData.watershed.huc8}</span>
                  </div>
                )}
                {enrichmentData.watershed.huc12 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">HUC-12</span>
                    <span className="font-mono text-xs">{enrichmentData.watershed.huc12}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">EPA NHD Plus / WATERS</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* FEMA NRI */}
        {enrichmentData.femaNri && (
          <Card data-testid="card-fema-nri">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-red-500" />
                <h4 className="font-semibold">FEMA National Risk Index</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.femaNri.compositeScore !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Composite Risk Score</span>
                    <span
                      className={`font-bold text-lg ${
                        enrichmentData.femaNri.compositeScore > 70
                          ? "text-red-600"
                          : enrichmentData.femaNri.compositeScore > 40
                          ? "text-yellow-600"
                          : "text-green-600"
                      }`}
                    >
                      {enrichmentData.femaNri.compositeScore.toFixed(1)}
                    </span>
                  </div>
                )}
                {enrichmentData.femaNri.riverineFloodRisk && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Riverine Flood</span>
                    <span className="capitalize">{enrichmentData.femaNri.riverineFloodRisk}</span>
                  </div>
                )}
                {enrichmentData.femaNri.tornadoRisk && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Tornado</span>
                    <span className="capitalize">{enrichmentData.femaNri.tornadoRisk}</span>
                  </div>
                )}
                {enrichmentData.femaNri.wildfireRisk && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Wildfire</span>
                    <span className="capitalize">{enrichmentData.femaNri.wildfireRisk}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">FEMA National Risk Index (Official)</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* USDA CLU */}
        {enrichmentData.usdaClu && (
          <Card data-testid="card-usda-clu">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wheat className="w-4 h-4 text-green-600" />
                <h4 className="font-semibold">USDA Farm Records (CLU)</h4>
              </div>
              <div className="space-y-2 text-sm">
                {enrichmentData.usdaClu.farmNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Farm Number</span>
                    <span className="font-mono">{enrichmentData.usdaClu.farmNumber}</span>
                  </div>
                )}
                {enrichmentData.usdaClu.tractNumber && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Tract Number</span>
                    <span className="font-mono">{enrichmentData.usdaClu.tractNumber}</span>
                  </div>
                )}
                {enrichmentData.usdaClu.calculatedAcres !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Calculated Acres</span>
                    <span className="font-medium">{enrichmentData.usdaClu.calculatedAcres.toFixed(2)} ac</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">USDA FSA Common Land Units</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Errors */}
      {enrichmentData.errors && Object.keys(enrichmentData.errors).length > 0 && (
        <Card className="border-yellow-200 dark:border-yellow-800" data-testid="card-errors">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <h4 className="font-semibold text-yellow-700 dark:text-yellow-400">Some data could not be fetched</h4>
            </div>
            <ul className="text-sm text-muted-foreground space-y-1">
              {Object.entries(enrichmentData.errors).map(([category, error]) => (
                <li key={category} className="flex gap-2">
                  <span className="font-medium capitalize">{category.replace(/_/g, " ")}:</span>
                  <span>{error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

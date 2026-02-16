import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, MapPin, Droplets, AlertTriangle, Building2, TrendingUp, Info, X } from "lucide-react";

export interface GisFilterState {
  excludeFloodZones: boolean;
  nearInfrastructure: boolean;
  infrastructureDistanceMiles: number;
  lowHazardRiskOnly: boolean;
  minimumInvestmentScore: number;
}

export const defaultGisFilters: GisFilterState = {
  excludeFloodZones: false,
  nearInfrastructure: false,
  infrastructureDistanceMiles: 10,
  lowHazardRiskOnly: false,
  minimumInvestmentScore: 0,
};

interface GisFiltersProps {
  filters: GisFilterState;
  onChange: (filters: GisFilterState) => void;
  activeFilterCount?: number;
}

export function GisFilters({ filters, onChange, activeFilterCount = 0 }: GisFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleFilterChange = <K extends keyof GisFilterState>(
    key: K,
    value: GisFilterState[K]
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const handleClearFilters = () => {
    onChange(defaultGisFilters);
  };

  const hasActiveFilters = 
    filters.excludeFloodZones || 
    filters.nearInfrastructure || 
    filters.lowHazardRiskOnly || 
    filters.minimumInvestmentScore > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full sm:w-auto">
      <CollapsibleTrigger asChild>
        <Button 
          variant="outline" 
          className="gap-2 min-h-[44px] sm:min-h-8 w-full sm:w-auto justify-between sm:justify-center"
          data-testid="button-toggle-gis-filters"
        >
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            <span>GIS Filters</span>
            {hasActiveFilters && (
              <Badge variant="secondary" className="ml-1 px-[6px] py-0 text-xs" data-testid="badge-gis-filter-count">
                {activeFilterCount}
              </Badge>
            )}
          </div>
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="mt-3">
        <div 
          className="p-3 sm:p-4 bg-muted/30 border rounded-lg space-y-4"
          data-testid="section-gis-filters"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="hidden sm:inline">GIS-Based Filters</span>
              <span className="sm:hidden">Filters</span>
            </h4>
            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                onClick={handleClearFilters}
                className="text-xs min-h-[44px] sm:min-h-7 px-3"
                data-testid="button-clear-gis-filters"
              >
                <X className="w-4 h-4 sm:w-3 sm:h-3 mr-1" />
                Clear
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="flex items-start gap-3 p-3 bg-background rounded-md border min-h-[60px]">
              <Checkbox
                id="exclude-flood-zones"
                checked={filters.excludeFloodZones}
                onCheckedChange={(checked) => 
                  handleFilterChange("excludeFloodZones", checked === true)
                }
                className="h-5 w-5 sm:h-4 sm:w-4 mt-0.5"
                data-testid="checkbox-exclude-flood-zones"
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="exclude-flood-zones" className="text-sm font-medium cursor-pointer">
                    Exclude Flood Zones
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[250px]">
                      <p data-testid="tooltip-flood-zones">
                        Filters out properties located in high-risk flood zones (FEMA zones A, AE, AO, AH, V, VE). Properties in moderate or minimal flood risk areas will still be shown.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Droplets className="w-3 h-3" />
                  Hide high-risk flood zone properties
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-background rounded-md border min-h-[60px]">
              <Checkbox
                id="low-hazard-risk"
                checked={filters.lowHazardRiskOnly}
                onCheckedChange={(checked) => 
                  handleFilterChange("lowHazardRiskOnly", checked === true)
                }
                className="h-5 w-5 sm:h-4 sm:w-4 mt-0.5"
                data-testid="checkbox-low-hazard-risk"
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="low-hazard-risk" className="text-sm font-medium cursor-pointer">
                    Low Hazard Risk Only
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[250px]">
                      <p data-testid="tooltip-hazard-risk">
                        Excludes properties with high earthquake, wildfire, or tornado risk ratings. Only shows properties with low or medium risk across all natural hazard categories.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Exclude high earthquake/wildfire/tornado risk
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-background rounded-md border min-h-[60px]">
              <Checkbox
                id="near-infrastructure"
                checked={filters.nearInfrastructure}
                onCheckedChange={(checked) => 
                  handleFilterChange("nearInfrastructure", checked === true)
                }
                className="h-5 w-5 sm:h-4 sm:w-4 mt-0.5"
                data-testid="checkbox-near-infrastructure"
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="near-infrastructure" className="text-sm font-medium cursor-pointer">
                    Near Infrastructure
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[250px]">
                      <p data-testid="tooltip-infrastructure">
                        Shows only properties within the specified distance of essential infrastructure like hospitals and schools. Useful for finding accessible land with development potential.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Building2 className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Within</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={filters.infrastructureDistanceMiles}
                    onChange={(e) => 
                      handleFilterChange("infrastructureDistanceMiles", Number(e.target.value) || 10)
                    }
                    disabled={!filters.nearInfrastructure}
                    className="w-20 h-10 sm:w-16 sm:h-7 text-sm sm:text-xs"
                    data-testid="input-infrastructure-distance"
                  />
                  <span className="text-xs text-muted-foreground">mi</span>
                </div>
              </div>
            </div>

            <div className="p-3 bg-background rounded-md border space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">
                  Minimum Investment Score
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[250px]">
                    <p data-testid="tooltip-investment-score">
                      Filter by the property's investment score (0-100), which is calculated based on GIS enrichment data including hazard risk, infrastructure access, demographics, and development potential.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-4">
                <Slider
                  value={[filters.minimumInvestmentScore]}
                  onValueChange={(value) => handleFilterChange("minimumInvestmentScore", value[0])}
                  min={0}
                  max={100}
                  step={5}
                  className="flex-1"
                  data-testid="slider-investment-score"
                />
                <Badge 
                  variant={filters.minimumInvestmentScore > 0 ? "default" : "secondary"}
                  className="min-w-[50px] justify-center"
                  data-testid="badge-investment-score-value"
                >
                  {filters.minimumInvestmentScore}+
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {filters.minimumInvestmentScore === 0 
                  ? "Showing all properties regardless of investment score"
                  : `Only showing properties with score ≥ ${filters.minimumInvestmentScore}`}
              </p>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function countActiveGisFilters(filters: GisFilterState): number {
  let count = 0;
  if (filters.excludeFloodZones) count++;
  if (filters.nearInfrastructure) count++;
  if (filters.lowHazardRiskOnly) count++;
  if (filters.minimumInvestmentScore > 0) count++;
  return count;
}

export function applyGisFiltersToLead<T extends {
  scoreFactors?: Record<string, any> | null;
}>(lead: T, filters: GisFilterState): boolean {
  const factors = lead.scoreFactors || {};
  const gisData = factors.gisEnrichment || factors;

  if (filters.excludeFloodZones) {
    const floodZone = gisData.floodZone?.value || gisData.floodZone;
    const floodRisk = gisData.floodRisk;
    if (floodRisk === "high" || 
        (typeof floodZone === "string" && /^(A|AE|AO|AH|V|VE)$/i.test(floodZone))) {
      return false;
    }
  }

  if (filters.lowHazardRiskOnly) {
    const earthquakeRisk = gisData.earthquakeRisk;
    const wildfireRisk = gisData.wildfireRisk;
    const tornadoRisk = gisData.tornadoRisk;
    if (earthquakeRisk === "high" || wildfireRisk === "high" || tornadoRisk === "high") {
      return false;
    }
  }

  if (filters.nearInfrastructure) {
    const hospitalDist = gisData.nearestHospitalMiles ?? gisData.infrastructure?.nearestHospitalMiles;
    const schoolDist = gisData.nearestSchoolMiles ?? gisData.infrastructure?.nearestSchoolMiles;
    const maxDist = filters.infrastructureDistanceMiles;
    const hasNearbyHospital = hospitalDist !== undefined && hospitalDist <= maxDist;
    const hasNearbySchool = schoolDist !== undefined && schoolDist <= maxDist;
    if (!hasNearbyHospital && !hasNearbySchool) {
      return false;
    }
  }

  if (filters.minimumInvestmentScore > 0) {
    const investmentScore = gisData.investmentScore ?? gisData.scores?.investmentScore ?? 0;
    if (investmentScore < filters.minimumInvestmentScore) {
      return false;
    }
  }

  return true;
}

export function applyGisFiltersToProperty<T extends {
  dueDiligenceData?: Record<string, any> | null;
}>(property: T, enrichmentData: Record<string, any> | null | undefined, filters: GisFilterState): boolean {
  const data = enrichmentData || property.dueDiligenceData || {};
  const hazards = data.hazards || {};
  const infrastructure = data.infrastructure || {};
  const scores = data.scores || {};

  if (filters.excludeFloodZones) {
    const floodRisk = hazards.floodRisk;
    const floodZone = hazards.floodZone;
    if (floodRisk === "high" || 
        (typeof floodZone === "string" && /^(A|AE|AO|AH|V|VE)$/i.test(floodZone))) {
      return false;
    }
  }

  if (filters.lowHazardRiskOnly) {
    if (hazards.earthquakeRisk === "high" || 
        hazards.wildfireRisk === "high" || 
        hazards.overallRiskLevel === "high") {
      return false;
    }
  }

  if (filters.nearInfrastructure) {
    const hospitalDist = infrastructure.nearestHospitalMiles;
    const schoolDist = infrastructure.nearestSchoolMiles;
    const maxDist = filters.infrastructureDistanceMiles;
    const hasNearbyHospital = hospitalDist !== undefined && hospitalDist <= maxDist;
    const hasNearbySchool = schoolDist !== undefined && schoolDist <= maxDist;
    if (!hasNearbyHospital && !hasNearbySchool) {
      return false;
    }
  }

  if (filters.minimumInvestmentScore > 0) {
    const investmentScore = scores.investmentScore ?? scores.overallScore ?? 0;
    if (investmentScore < filters.minimumInvestmentScore) {
      return false;
    }
  }

  return true;
}

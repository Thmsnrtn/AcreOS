import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Droplets,
  Mountain,
  Leaf,
  CloudRain,
  Compass,
  AlertTriangle,
} from "lucide-react";

interface WaterRightsInfo {
  state: string;
  doctrine: string;
  doctrineDescription: string;
  permitsRequired: boolean;
  typicalRightsType: string;
  transferability: string;
  notes: string;
}

interface MineralRightsInfo {
  state: string;
  severanceCommon: boolean;
  severanceRisk: string;
  dominantMinerals: string[];
  surfaceOwnerProtections: string;
  notes: string;
}

interface CarbonCreditEstimate {
  eligible: boolean;
  estimatedCreditsPerYear: number;
  estimatedValuePerYear: number;
  programTypes: string[];
  landType: string;
  acreage: number;
  methodology: string;
  notes: string;
}

interface RiskDetail {
  level: string;
  score: number;
  description: string;
}

interface ClimateRiskAssessment {
  state: string;
  county?: string;
  overallRisk: string;
  floodRisk: RiskDetail;
  fireRisk: RiskDetail;
  droughtRisk: RiskDetail;
  hurricaneRisk: RiskDetail;
  notes: string;
}

interface LandUseOption {
  use: string;
  score: number;
  rationale: string;
  estimatedValueImpact: string;
}

interface HighestBestUseAnalysis {
  recommended: LandUseOption;
  alternatives: LandUseOption[];
  notes: string;
}

interface EnvironmentalIntelligenceCardProps {
  state: string;
  county?: string;
  acreage?: number;
  landCover?: string;
  zoning?: string;
  utilities?: Record<string, unknown>;
  roadAccess?: string;
}

const WESTERN_WATER_STATES = ["AZ", "NM", "CO", "NV", "UT", "MT", "WY", "ID", "OR", "WA"];
const OIL_GAS_STATES = ["TX", "OK", "LA", "ND", "PA", "WV", "NM", "CO", "WY"];

function riskBadgeVariant(level: string): "default" | "secondary" | "destructive" | "outline" {
  switch (level) {
    case "low":
      return "secondary";
    case "moderate":
      return "outline";
    case "high":
    case "very_high":
      return "destructive";
    default:
      return "default";
  }
}

function RiskRow({ label, risk }: { label: string; risk: RiskDetail }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Badge variant={riskBadgeVariant(risk.level)} className="text-xs">
          {risk.level.replace("_", " ")}
        </Badge>
        <span className="text-xs text-muted-foreground">{risk.score}/100</span>
      </div>
    </div>
  );
}

export function EnvironmentalIntelligenceCard({
  state,
  county,
  acreage,
  landCover,
  zoning,
  utilities,
  roadAccess,
}: EnvironmentalIntelligenceCardProps) {
  const stateUpper = state?.toUpperCase()?.trim() ?? "";
  const isWesternState = WESTERN_WATER_STATES.includes(stateUpper);
  const isOilGasState = OIL_GAS_STATES.includes(stateUpper);
  const isForested = landCover?.toLowerCase()?.includes("forest") ?? false;

  const waterQuery = useQuery<WaterRightsInfo>({
    queryKey: [`/api/environmental/water-rights/${stateUpper}`],
    enabled: isWesternState && !!stateUpper,
  });

  const mineralQuery = useQuery<MineralRightsInfo>({
    queryKey: [`/api/environmental/mineral-rights/${stateUpper}`],
    enabled: isOilGasState && !!stateUpper,
  });

  const carbonQuery = useQuery<CarbonCreditEstimate>({
    queryKey: [
      "/api/environmental/carbon-credits",
      { state: stateUpper, acres: acreage, landType: "forest" },
    ],
    enabled: isForested && !!acreage && acreage > 0,
  });

  const climateQuery = useQuery<ClimateRiskAssessment>({
    queryKey: [
      "/api/environmental/climate-risk",
      { state: stateUpper, county },
    ],
    enabled: !!stateUpper,
  });

  const hbuQuery = useQuery<HighestBestUseAnalysis>({
    queryKey: [
      "/api/environmental/highest-best-use",
      { state: stateUpper, county, acres: acreage, zoning, roadAccess },
    ],
    enabled: !!stateUpper && !!acreage,
  });

  const isLoading =
    waterQuery.isLoading ||
    mineralQuery.isLoading ||
    carbonQuery.isLoading ||
    climateQuery.isLoading ||
    hbuQuery.isLoading;

  if (!stateUpper) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-56" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const waterData = waterQuery.data;
  const mineralData = mineralQuery.data;
  const carbonData = carbonQuery.data;
  const climateData = climateQuery.data;
  const hbuData = hbuQuery.data;

  const hasSections =
    (isWesternState && waterData) ||
    (isOilGasState && mineralData) ||
    (isForested && carbonData?.eligible) ||
    climateData ||
    hbuData;

  if (!hasSections) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="h-5 w-5 text-muted-foreground" />
          Environmental Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-5"
        >
          {/* Water Rights */}
          {isWesternState && waterData && (
            <motion.div variants={staggerItem} className="space-y-2">
              <div className="flex items-center gap-2">
                <Droplets className="h-4 w-4 text-blue-500" />
                <h4 className="text-sm font-medium">Water Rights</h4>
                <Badge variant="outline" className="text-xs">
                  {waterData.doctrine.replace("_", " ")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {waterData.doctrineDescription}
              </p>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>Permits required: {waterData.permitsRequired ? "Yes" : "No"}</p>
                <p>Transferability: {waterData.transferability}</p>
                {waterData.notes && <p>{waterData.notes}</p>}
              </div>
            </motion.div>
          )}

          {/* Mineral Rights */}
          {isOilGasState && mineralData && (
            <motion.div variants={staggerItem} className="space-y-2">
              <div className="flex items-center gap-2">
                <Mountain className="h-4 w-4 text-amber-600" />
                <h4 className="text-sm font-medium">Mineral Rights</h4>
                <Badge variant={riskBadgeVariant(mineralData.severanceRisk)} className="text-xs">
                  {mineralData.severanceRisk} severance risk
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {mineralData.notes}
              </p>
              {mineralData.dominantMinerals.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {mineralData.dominantMinerals.map((mineral) => (
                    <Badge key={mineral} variant="secondary" className="text-xs">
                      {mineral.replace("_", " ")}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Surface owner protections: {mineralData.surfaceOwnerProtections}
              </p>
            </motion.div>
          )}

          {/* Carbon Credits */}
          {isForested && carbonData?.eligible && (
            <motion.div variants={staggerItem} className="space-y-2">
              <div className="flex items-center gap-2">
                <Leaf className="h-4 w-4 text-green-600" />
                <h4 className="text-sm font-medium">Carbon Credit Potential</h4>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="text-sm font-medium">
                  ~${carbonData.estimatedValuePerYear.toLocaleString()}/year
                </p>
                <p className="text-xs text-muted-foreground">
                  {carbonData.estimatedCreditsPerYear} credits/year at current rates
                </p>
              </div>
              {carbonData.programTypes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {carbonData.programTypes.map((program) => (
                    <Badge key={program} variant="outline" className="text-xs">
                      {program.replace("_", " ")}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{carbonData.notes}</p>
            </motion.div>
          )}

          {/* Climate Risk */}
          {climateData && (
            <motion.div variants={staggerItem} className="space-y-2">
              <div className="flex items-center gap-2">
                <CloudRain className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">Climate Risk Assessment</h4>
                <Badge variant={riskBadgeVariant(climateData.overallRisk)} className="text-xs">
                  {climateData.overallRisk.replace("_", " ")} overall
                </Badge>
              </div>
              <div className="space-y-0.5">
                <RiskRow label="Flood" risk={climateData.floodRisk} />
                <RiskRow label="Wildfire" risk={climateData.fireRisk} />
                <RiskRow label="Drought" risk={climateData.droughtRisk} />
                <RiskRow label="Hurricane" risk={climateData.hurricaneRisk} />
              </div>
              <p className="text-xs text-muted-foreground">{climateData.notes}</p>
            </motion.div>
          )}

          {/* Highest & Best Use */}
          {hbuData && (
            <motion.div variants={staggerItem} className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">Highest & Best Use</h4>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">
                    {hbuData.recommended.use}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {hbuData.recommended.score}/100
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {hbuData.recommended.rationale}
                </p>
              </div>
              {hbuData.alternatives.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Alternatives:</p>
                  {hbuData.alternatives.slice(0, 3).map((alt) => (
                    <div key={alt.use} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="capitalize">{alt.use}</span>
                      <span>{alt.score}/100</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      </CardContent>
    </Card>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  MapPin,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  FileText,
  Loader2,
  Save,
  Building2,
  Map,
  Home,
  Search,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Property } from "@shared/schema";

interface ResearchSummaryPanelProps {
  property: Property;
}

interface CompsQuickSummary {
  averagePricePerAcre: number | null;
  medianPricePerAcre: number | null;
  estimatedValue: number | null;
  sampleSize: number;
  lastFetched: string | null;
}

interface ResearchChecklist {
  hasCoordinates: boolean;
  hasParcelBoundary: boolean;
  hasIntelligenceData: boolean;
  hasCompsData: boolean;
  hasMarketValue: boolean;
  hasZoning: boolean;
  hasRoadAccess: boolean;
  hasDueDiligence: boolean;
}

// Calculate data completeness based on available property data
function calculateResearchCompleteness(property: Property): {
  score: number;
  checklist: ResearchChecklist;
  grade: "A" | "B" | "C" | "D" | "F";
} {
  const checklist: ResearchChecklist = {
    hasCoordinates: !!(property.latitude && property.longitude) || !!property.parcelCentroid,
    hasParcelBoundary: !!property.parcelBoundary,
    hasIntelligenceData: !!(property.dueDiligenceData as any)?.hazards || !!(property.dueDiligenceData as any)?.scores,
    hasCompsData: false, // Will be updated via API
    hasMarketValue: !!property.marketValue && Number(property.marketValue) > 0,
    hasZoning: !!property.zoning,
    hasRoadAccess: !!property.roadAccess,
    hasDueDiligence: !!(property.dueDiligenceData as any)?.checklistCompleted,
  };

  const weights = {
    hasCoordinates: 15,
    hasParcelBoundary: 10,
    hasIntelligenceData: 20,
    hasCompsData: 25,
    hasMarketValue: 10,
    hasZoning: 5,
    hasRoadAccess: 5,
    hasDueDiligence: 10,
  };

  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (checklist[key as keyof ResearchChecklist]) {
      score += weight;
    }
  }

  let grade: "A" | "B" | "C" | "D" | "F" = "F";
  if (score >= 85) grade = "A";
  else if (score >= 70) grade = "B";
  else if (score >= 55) grade = "C";
  else if (score >= 40) grade = "D";

  return { score, checklist, grade };
}

// Build external research links
function buildExternalLinks(property: Property): { label: string; url: string; icon: typeof MapPin }[] {
  const links: { label: string; url: string; icon: typeof MapPin }[] = [];
  
  const address = property.address || `${property.county}, ${property.state}`;
  const encodedAddress = encodeURIComponent(address);
  const lat = property.latitude || (property.parcelCentroid as any)?.lat;
  const lng = property.longitude || (property.parcelCentroid as any)?.lng;

  // Google Maps
  if (lat && lng) {
    links.push({
      label: "Google Maps",
      url: `https://www.google.com/maps?q=${lat},${lng}`,
      icon: Map,
    });
  } else {
    links.push({
      label: "Google Maps",
      url: `https://www.google.com/maps/search/${encodedAddress}`,
      icon: Map,
    });
  }

  // Zillow
  links.push({
    label: "Zillow",
    url: `https://www.zillow.com/homes/${encodedAddress}_rb/`,
    icon: Home,
  });

  // County Assessor (generic search)
  const countyEncoded = encodeURIComponent(`${property.county} county ${property.state} assessor`);
  links.push({
    label: "County Assessor",
    url: `https://www.google.com/search?q=${countyEncoded}`,
    icon: Building2,
  });

  // APN lookup
  const apnSearch = encodeURIComponent(`${property.apn} ${property.county} ${property.state}`);
  links.push({
    label: "APN Lookup",
    url: `https://www.google.com/search?q=${apnSearch}`,
    icon: Search,
  });

  return links;
}

export function ResearchSummaryPanel({ property }: ResearchSummaryPanelProps) {
  const [notes, setNotes] = useState((property.dueDiligenceData as any)?.researchNotes || "");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch quick comps summary
  const { data: compsData, isLoading: compsLoading } = useQuery({
    queryKey: ["/api/properties", property.id, "comps-summary"],
    queryFn: async () => {
      const hasCoords = property.parcelCentroid || (property.latitude && property.longitude);
      if (!hasCoords) return null;
      
      try {
        const res = await fetch(`/api/properties/${property.id}/comps?radius=5`, {
          credentials: "include",
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          averagePricePerAcre: data.marketAnalysis?.averagePricePerAcre || null,
          medianPricePerAcre: data.marketAnalysis?.medianPricePerAcre || null,
          estimatedValue: data.marketAnalysis?.estimatedValue || null,
          sampleSize: data.comps?.length || 0,
          lastFetched: new Date().toISOString(),
        } as CompsQuickSummary;
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minute cache
    enabled: !!(property.parcelCentroid || (property.latitude && property.longitude)),
  });

  // Calculate completeness
  const { score, checklist, grade } = calculateResearchCompleteness(property);
  const completenessWithComps = compsData?.sampleSize ? Math.min(100, score + 25) : score;
  const finalGrade = completenessWithComps >= 85 ? "A" : completenessWithComps >= 70 ? "B" : completenessWithComps >= 55 ? "C" : completenessWithComps >= 40 ? "D" : "F";

  // Save notes mutation
  const saveNotesMutation = useMutation({
    mutationFn: async (newNotes: string) => {
      const existingData = (property.dueDiligenceData as any) || {};
      const res = await apiRequest("PATCH", `/api/properties/${property.id}`, {
        dueDiligenceData: {
          ...existingData,
          researchNotes: newNotes,
          researchNotesUpdatedAt: new Date().toISOString(),
        },
      });
      if (!res.ok) throw new Error("Failed to save notes");
      return res.json();
    },
    onSuccess: () => {
      setLastSaved(new Date());
      queryClient.invalidateQueries({ queryKey: ["/api/properties", property.id] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save research notes",
        variant: "destructive",
      });
    },
  });

  // Auto-save debounce
  useEffect(() => {
    const existingNotes = (property.dueDiligenceData as any)?.researchNotes || "";
    if (notes === existingNotes) return;

    const timer = setTimeout(() => {
      setIsSaving(true);
      saveNotesMutation.mutate(notes, {
        onSettled: () => setIsSaving(false),
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, [notes]);

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const externalLinks = buildExternalLinks(property);
  const enrichmentData = property.dueDiligenceData as any;
  const hasHazardWarnings = enrichmentData?.hazards?.overallRiskLevel === "high" || 
    enrichmentData?.hazards?.floodRisk === "high" ||
    enrichmentData?.hazards?.wildfireRisk === "high";

  return (
    <Card className="border-primary/20" data-testid="research-summary-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Research Summary
          </CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={finalGrade === "A" || finalGrade === "B" ? "default" : finalGrade === "C" ? "secondary" : "destructive"}
                className="cursor-help"
                data-testid="badge-research-grade"
              >
                {completenessWithComps}% Complete ({finalGrade})
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Data completeness score based on available research data</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Data Completeness Progress */}
        <div className="space-y-2">
          <Progress value={completenessWithComps} className="h-2" data-testid="progress-research-completeness" />
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(checklist).map(([key, value]) => (
              <div key={key} className="flex items-center gap-1" data-testid={`checklist-${key}`}>
                {value ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : (
                  <Circle className="w-3 h-3 text-muted-foreground" />
                )}
                <span className={value ? "text-foreground" : "text-muted-foreground"}>
                  {key.replace(/^has/, "").replace(/([A-Z])/g, " $1").trim()}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-1" data-testid="checklist-comps">
              {compsData?.sampleSize ? (
                <CheckCircle2 className="w-3 h-3 text-green-500" />
              ) : (
                <Circle className="w-3 h-3 text-muted-foreground" />
              )}
              <span className={compsData?.sampleSize ? "text-foreground" : "text-muted-foreground"}>
                Comps Data
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Quick Comps Summary */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="w-4 h-4" />
            Comps Quick View
          </div>
          {compsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading comps...
            </div>
          ) : compsData ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-0.5">
                <span className="text-muted-foreground text-xs">Avg $/Acre</span>
                <p className="font-semibold" data-testid="text-avg-price-acre">{formatCurrency(compsData.averagePricePerAcre)}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-muted-foreground text-xs">Median $/Acre</span>
                <p className="font-semibold" data-testid="text-median-price-acre">{formatCurrency(compsData.medianPricePerAcre)}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-muted-foreground text-xs">Est. Value</span>
                <p className="font-semibold text-primary" data-testid="text-est-value">{formatCurrency(compsData.estimatedValue)}</p>
              </div>
              <div className="space-y-0.5">
                <span className="text-muted-foreground text-xs">Sample Size</span>
                <p className="font-semibold" data-testid="text-sample-size">{compsData.sampleSize} comps</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {checklist.hasCoordinates ? "No comps data available" : "Fetch parcel data to enable comps"}
            </p>
          )}
        </div>

        {/* Hazard Warning */}
        {hasHazardWarnings && (
          <>
            <Separator />
            <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded-md text-sm" data-testid="hazard-warning">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-destructive">High Risk Factors Detected</span>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {enrichmentData?.hazards?.floodRisk === "high" && "Flood risk • "}
                  {enrichmentData?.hazards?.wildfireRisk === "high" && "Wildfire risk • "}
                  {enrichmentData?.hazards?.earthquakeRisk === "high" && "Earthquake risk"}
                </p>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Research Notes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Research Notes
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {isSaving ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Saving...
                </>
              ) : lastSaved ? (
                <>
                  <Save className="w-3 h-3" />
                  Saved
                </>
              ) : (
                "Auto-saves"
              )}
            </span>
          </div>
          <Textarea
            placeholder="Add your research notes, analysis, and offer reasoning here..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[80px] text-sm resize-none"
            data-testid="textarea-research-notes"
          />
        </div>

        <Separator />

        {/* External Links */}
        <div className="space-y-2">
          <span className="text-sm font-medium flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Quick Research Links
          </span>
          <div className="flex flex-wrap gap-2">
            {externalLinks.map((link) => (
              <Button
                key={link.label}
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => window.open(link.url, "_blank")}
                data-testid={`link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <link.icon className="w-3 h-3 mr-1" />
                {link.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Key Property Stats */}
        <Separator />
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="space-y-0.5">
            <span className="text-muted-foreground">Size</span>
            <p className="font-medium">{property.sizeAcres} ac</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">Market Value</span>
            <p className="font-medium">{formatCurrency(property.marketValue ? Number(property.marketValue) : null)}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-muted-foreground">Status</span>
            <Badge variant="outline" className="text-xs capitalize">
              {property.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

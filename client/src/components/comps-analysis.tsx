import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, MapPin, TrendingUp, TrendingDown, BarChart3, AlertCircle, RefreshCw, Search, DollarSign, Star, Target } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { GlossaryTerm } from "@/components/Glossary";
import type { Property } from "@shared/schema";
import { formatDate } from "@/lib/format";

interface ComparableProperty {
  id: string;
  apn: string;
  address: string;
  city: string;
  state: string;
  county: string;
  acreage: number;
  saleDate: string | null;
  salePrice: number | null;
  pricePerAcre: number | null;
  assessedValue: number | null;
  landValue: number | null;
  propertyType: string;
  zoning: string;
  distance: number;
  coordinates: {
    lat: number;
    lng: number;
  };
}

interface MarketAnalysis {
  averagePricePerAcre: number;
  medianPricePerAcre: number;
  highPricePerAcre: number;
  lowPricePerAcre: number;
  sampleSize: number;
  estimatedValue: number | null;
  subjectAcreage: number | null;
}

interface OfferPrices {
  conservative: { min: number; max: number; label: string };
  standard: { min: number; max: number; label: string };
  aggressive: { min: number; max: number; label: string };
  estimatedMarketValue: number;
}

interface DesirabilityScoreFactor {
  name: string;
  score: number;
  maxScore: number;
  description: string;
}

interface DesirabilityScore {
  totalScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: DesirabilityScoreFactor[];
}

interface CompsResponse {
  success: boolean;
  comps: ComparableProperty[];
  marketAnalysis?: MarketAnalysis;
  offerPrices?: OfferPrices;
  desirabilityScore?: DesirabilityScore;
  error?: string;
  limitedData?: boolean;
  message?: string;
  subjectProperty?: {
    id: number;
    apn: string;
    address: string;
    acreage: number;
    coordinates: { lat: number; lng: number };
  };
}

interface CompsAnalysisProps {
  property: Property;
}

export function CompsAnalysis({ property }: CompsAnalysisProps) {
  const [radius, setRadius] = useState(5);
  const [minAcreage, setMinAcreage] = useState("");
  const [maxAcreage, setMaxAcreage] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  const hasCoordinates = property.parcelCentroid || (property.latitude && property.longitude);

  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.set("radius", String(radius));
    if (minAcreage) params.set("minAcreage", minAcreage);
    if (maxAcreage) params.set("maxAcreage", maxAcreage);
    return params.toString();
  };

  const { data, isLoading, error, refetch, isFetching } = useQuery<CompsResponse>({
    queryKey: ["/api/properties", property.id, "comps", radius, minAcreage, maxAcreage],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${property.id}/comps?${buildQueryString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to fetch comps");
      }
      return res.json();
    },
    enabled: !!hasCoordinates,
    staleTime: 1000 * 60 * 5,
  });

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return "N/A";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const saleDateStaleness = (dateStr: string | null): "fresh" | "aging" | "stale" | null => {
    if (!dateStr) return null;
    const ageMonths = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (ageMonths < 12) return "fresh";
    if (ageMonths < 24) return "aging";
    return "stale";
  };

  if (!hasCoordinates) {
    return (
      <div className="text-center py-8">
        <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
        <h3 className="font-medium mb-2">Location data required</h3>
        <p className="text-sm text-muted-foreground">
          Please fetch parcel data first to enable comparable property analysis.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-12"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="ml-3 text-muted-foreground">Searching for comparable properties…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8" role="alert">
        <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" aria-hidden="true" />
        <h3 className="font-medium mb-2">Couldn't load comps</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {error instanceof Error ? error.message : "Failed to fetch comparable properties"}
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  if (!data?.success && data?.error) {
    return (
      <div className="text-center py-8" role="alert">
        <AlertCircle className="w-12 h-12 mx-auto text-acr-warn mb-4" aria-hidden="true" />
        <h3 className="font-medium mb-2">Comps data unavailable</h3>
        <p className="text-sm text-muted-foreground mb-4">{data.error}</p>
        {data.limitedData && (
          <p className="text-xs text-muted-foreground">
            Radius search may require a higher tier Regrid subscription.
          </p>
        )}
      </div>
    );
  }

  const comps = data?.comps || [];
  const analysis = data?.marketAnalysis;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
            aria-expanded={showFilters}
            aria-controls="comps-filters-panel"
          >
            <Search className="w-4 h-4 mr-1" aria-hidden="true" />
            {showFilters ? "Hide filters" : "Filters"}
          </Button>
          <div className="flex flex-col items-center gap-0.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-comps"
              aria-label={isFetching ? "Refreshing comps…" : "Refresh comps"}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
              Refresh
            </Button>
            <span className="text-micro text-muted-foreground" data-testid="text-cost-comps">$0.10 per query</span>
          </div>
        </div>
        {data?.message && (
          <Badge variant="outline" className="text-acr-warn">
            <AlertCircle className="w-3 h-3 mr-1" aria-hidden="true" />
            {data.message}
          </Badge>
        )}
      </div>

      {showFilters && (
        <Card id="comps-filters-panel">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="radius" className="text-xs">Search radius (miles)</Label>
                <Input
                  id="radius"
                  type="number"
                  inputMode="numeric"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value) || 5)}
                  min={1}
                  max={10}
                  data-testid="input-radius"
                />
              </div>
              <div>
                <Label htmlFor="minAcreage" className="text-xs">Min acreage</Label>
                <Input
                  id="minAcreage"
                  type="number"
                  inputMode="decimal"
                  value={minAcreage}
                  onChange={(e) => setMinAcreage(e.target.value)}
                  placeholder={`e.g., ${Math.max(0, Number(property.sizeAcres) * 0.5).toFixed(1)}`}
                  data-testid="input-min-acreage"
                />
              </div>
              <div>
                <Label htmlFor="maxAcreage" className="text-xs">Max acreage</Label>
                <Input
                  id="maxAcreage"
                  type="number"
                  inputMode="decimal"
                  value={maxAcreage}
                  onChange={(e) => setMaxAcreage(e.target.value)}
                  placeholder={`e.g., ${(Number(property.sizeAcres) * 1.5).toFixed(1)}`}
                  data-testid="input-max-acreage"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {analysis && analysis.sampleSize > 0 && (
        <ul aria-label="Comp price statistics" className="grid grid-cols-2 md:grid-cols-4 gap-3 list-none p-0 m-0">
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">Avg $/acre</span>
                </div>
                <p className="text-lg font-bold mt-1 tabular-nums m-0" data-testid="text-avg-price" aria-label={`Average price per acre: ${formatCurrency(analysis.averagePricePerAcre)}`}>
                  {formatCurrency(analysis.averagePricePerAcre)}
                </p>
                <DataProvenanceChip source={`${analysis.sampleSize} comps`} classification="estimate" />
              </CardContent>
            </Card>
          </li>
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">Median $/acre</span>
                </div>
                <p className="text-lg font-bold mt-1 tabular-nums m-0" data-testid="text-median-price" aria-label={`Median price per acre: ${formatCurrency(analysis.medianPricePerAcre)}`}>
                  {formatCurrency(analysis.medianPricePerAcre)}
                </p>
                <DataProvenanceChip source={`${analysis.sampleSize} comps`} classification="estimate" />
              </CardContent>
            </Card>
          </li>
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">High $/acre</span>
                </div>
                <p className="text-lg font-bold mt-1 tabular-nums text-acr-pos m-0" data-testid="text-high-price" aria-label={`High price per acre: ${formatCurrency(analysis.highPricePerAcre)}`}>
                  {formatCurrency(analysis.highPricePerAcre)}
                </p>
                <DataProvenanceChip source={`${analysis.sampleSize} comps`} classification="estimate" />
              </CardContent>
            </Card>
          </li>
          <li>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-acr-neg" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">Low $/acre</span>
                </div>
                <p className="text-lg font-bold mt-1 tabular-nums text-acr-neg m-0" data-testid="text-low-price" aria-label={`Low price per acre: ${formatCurrency(analysis.lowPricePerAcre)}`}>
                  {formatCurrency(analysis.lowPricePerAcre)}
                </p>
                <DataProvenanceChip source={`${analysis.sampleSize} comps`} classification="estimate" />
              </CardContent>
            </Card>
          </li>
        </ul>
      )}

      {analysis?.estimatedValue && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4" aria-hidden="true" />
              Estimated market value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-4 flex-wrap">
              <span className="text-2xl font-bold" data-testid="text-estimated-value">
                {formatCurrency(analysis.estimatedValue)}
              </span>
              <span className="text-sm text-muted-foreground">
                Based on {analysis.sampleSize} comparable sales
                {analysis.subjectAcreage && ` for ${analysis.subjectAcreage} acres`}
              </span>
            </div>
            <DataProvenanceChip
              source={`AcreOS comp analysis (${analysis.sampleSize} comps)`}
              classification="estimate"
            />
          </CardContent>
        </Card>
      )}

      {data?.offerPrices && (
        <Card data-testid="card-offer-suggestions">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4" aria-hidden="true" />
              Offer suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul aria-label="Offer price tiers" className="grid grid-cols-1 md:grid-cols-3 gap-4 list-none p-0 m-0">
              <li className="p-3 rounded-md bg-acr-pos-soft dark:bg-acr-pos-soft/20 border border-acr-pos-soft dark:border-acr-pos-soft">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-acr-pos-soft dark:bg-acr-pos-soft/40 text-acr-pos-soft-ink dark:text-acr-pos-soft-ink border-acr-pos dark:border-acr-pos">
                    Conservative
                  </Badge>
                </div>
                <p className="text-lg font-bold tabular-nums text-acr-pos dark:text-acr-pos m-0" data-testid="text-offer-conservative" aria-label={`Conservative offer: ${formatCurrency(data.offerPrices.conservative.min)} to ${formatCurrency(data.offerPrices.conservative.max)}`}>
                  {formatCurrency(data.offerPrices.conservative.min)} - {formatCurrency(data.offerPrices.conservative.max)}
                </p>
                <p className="text-xs text-muted-foreground mt-1 m-0">40-50% of market value</p>
                <DataProvenanceChip source="AcreOS comp analysis" classification="estimate" className="mt-1" />
              </li>
              <li className="p-3 rounded-md bg-acr-accent dark:bg-acr-accent/20 border border-acr-accent dark:border-acr-accent">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-acr-accent dark:bg-acr-accent/40 text-acr-accent dark:text-acr-accent border-acr-accent dark:border-acr-accent">
                    Standard
                  </Badge>
                </div>
                <p className="text-lg font-bold tabular-nums text-acr-accent dark:text-acr-accent m-0" data-testid="text-offer-standard" aria-label={`Standard offer: ${formatCurrency(data.offerPrices.standard.min)} to ${formatCurrency(data.offerPrices.standard.max)}`}>
                  {formatCurrency(data.offerPrices.standard.min)} - {formatCurrency(data.offerPrices.standard.max)}
                </p>
                <p className="text-xs text-muted-foreground mt-1 m-0">50-65% of market value</p>
                <DataProvenanceChip source="AcreOS comp analysis" classification="estimate" className="mt-1" />
              </li>
              <li className="p-3 rounded-md bg-acr-warn-soft dark:bg-acr-warn-soft/20 border border-acr-warn-soft dark:border-acr-warn-soft">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-acr-warn-soft dark:bg-acr-warn-soft/40 text-acr-warn-soft-ink dark:text-acr-warn-soft-ink border-acr-warn dark:border-acr-warn">
                    Aggressive
                  </Badge>
                </div>
                <p className="text-lg font-bold tabular-nums text-acr-warn dark:text-acr-warn m-0" data-testid="text-offer-aggressive" aria-label={`Aggressive offer: ${formatCurrency(data.offerPrices.aggressive.min)} to ${formatCurrency(data.offerPrices.aggressive.max)}`}>
                  {formatCurrency(data.offerPrices.aggressive.min)} - {formatCurrency(data.offerPrices.aggressive.max)}
                </p>
                <p className="text-xs text-muted-foreground mt-1 m-0">65-80% of market value</p>
                <DataProvenanceChip source="AcreOS comp analysis" classification="estimate" className="mt-1" />
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

      {data?.desirabilityScore && (
        <Card data-testid="card-property-score">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4" aria-hidden="true" />
                Property desirability score
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="badge-desirability-score"
                    className={`inline-flex items-center rounded-md text-base px-3 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      data.desirabilityScore.totalScore >= 70
                        ? "bg-acr-pos hover:bg-acr-pos text-white"
                        : data.desirabilityScore.totalScore >= 40
                        ? "bg-acr-warn hover:bg-acr-warn text-white"
                        : "bg-acr-neg hover:bg-acr-neg text-white"
                    }`}
                    onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                    aria-expanded={showScoreBreakdown}
                    aria-controls="desirability-score-breakdown"
                    aria-label={`Property desirability score: ${data.desirabilityScore.totalScore} out of 100, grade ${data.desirabilityScore.grade}. ${showScoreBreakdown ? "Hide" : "Show"} breakdown`}
                  >
                    <span className="tabular-nums">{data.desirabilityScore.totalScore}</span>/100 ({data.desirabilityScore.grade})
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{showScoreBreakdown ? "Hide" : "Show"} score breakdown</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          {showScoreBreakdown && (
            <CardContent data-testid="score-breakdown" id="desirability-score-breakdown">
              <ul aria-label="Score factor breakdown" className="space-y-3 list-none p-0 m-0">
                {data.desirabilityScore.factors.map((factor, idx) => {
                  const factorPercent = Math.round((factor.score / factor.maxScore) * 100);
                  return (
                    <li key={idx} className="space-y-1" aria-label={`${factor.name}: ${factor.score} of ${factor.maxScore}, ${factor.description}`}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{factor.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground text-xs capitalize">{factor.description}</span>
                          <span className="font-mono text-xs tabular-nums" aria-hidden="true"><span className="tabular-nums">{factor.score}</span>/<span className="tabular-nums">{factor.maxScore}</span></span>
                        </div>
                      </div>
                      <Progress
                        value={factorPercent}
                        className="h-2"
                        data-testid={`progress-${factor.name.toLowerCase().replace(/\s+/g, "-")}`}
                        aria-label={`${factor.name} score`}
                        aria-valuenow={factorPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {comps.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span><GlossaryTerm slug="comp">Comparable properties</GlossaryTerm> (<span className="tabular-nums">{comps.length}</span>)</span>
              <Badge variant="secondary" aria-label={`Within ${radius} miles`}>
                Within <span className="tabular-nums mx-1">{radius}</span> miles
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table aria-label="Comparable properties">
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Acreage</TableHead>
                    <TableHead className="text-right">Sale date</TableHead>
                    <TableHead className="text-right">Sale price</TableHead>
                    <TableHead className="text-right">$/acre</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comps.map((comp, index) => (
                    <TableRow key={comp.id || index} data-testid={`row-comp-${index}`}>
                      <TableCell>
                        <div className="font-medium text-sm">{comp.address || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          {comp.city}, {comp.state} {comp.county && `- ${comp.county}`}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{comp.apn}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{comp.acreage?.toFixed(2) || "N/A"}</TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          const staleness = saleDateStaleness(comp.saleDate);
                          const tone =
                            staleness === "stale"
                              ? "text-acr-warn dark:text-acr-warn"
                              : staleness === "aging"
                              ? "text-muted-foreground"
                              : "";
                          const title =
                            staleness === "stale"
                              ? "Sold more than 2 years ago — may not reflect current market"
                              : staleness === "aging"
                              ? "Sold more than 1 year ago"
                              : undefined;
                          return (
                            <span className={`${tone} tabular-nums`} title={title} aria-label={title ? `${formatDate(comp.saleDate)} (${title})` : undefined}>
                              {formatDate(comp.saleDate)}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-medium tabular-nums">{comp.salePrice ? formatCurrency(comp.salePrice) : "N/A"}</span>
                        {comp.salePrice && (
                          <DataProvenanceChip
                            source="County records"
                            sourceAsOf={comp.saleDate}
                            classification="authoritative"
                            className="justify-end"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {comp.pricePerAcre ? formatCurrency(comp.pricePerAcre) : "N/A"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums" aria-label={comp.distance !== undefined ? `${comp.distance.toFixed(1)} miles away` : undefined}>
                        {comp.distance?.toFixed(1)} mi
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-8">
          <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
          <h3 className="font-medium mb-2">No comparable properties found</h3>
          <p className="text-sm text-muted-foreground">
            Try expanding the search radius or adjusting filters.
          </p>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, MapPin, TrendingUp, TrendingDown, BarChart3, AlertCircle, RefreshCw, Search, DollarSign, Star, Target, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import type { Property } from "@shared/schema";

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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString();
  };

  if (!hasCoordinates) {
    return (
      <div className="text-center py-8">
        <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="font-medium mb-2">Location Data Required</h3>
        <p className="text-sm text-muted-foreground">
          Please fetch parcel data first to enable comparable property analysis.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Searching for comparable properties...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
        <h3 className="font-medium mb-2">Error Loading Comps</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {error instanceof Error ? error.message : "Failed to fetch comparable properties"}
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (!data?.success && data?.error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-12 h-12 mx-auto text-yellow-500 mb-4" />
        <h3 className="font-medium mb-2">Comps Data Unavailable</h3>
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
          >
            <Search className="w-4 h-4 mr-1" />
            {showFilters ? "Hide Filters" : "Filters"}
          </Button>
          <div className="flex flex-col items-center gap-0.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-comps"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <span className="text-[10px] text-muted-foreground" data-testid="text-cost-comps">$0.10 per query</span>
          </div>
        </div>
        {data?.message && (
          <Badge variant="outline" className="text-yellow-600">
            <AlertCircle className="w-3 h-3 mr-1" />
            {data.message}
          </Badge>
        )}
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="radius" className="text-xs">Search Radius (miles)</Label>
                <Input
                  id="radius"
                  type="number"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value) || 5)}
                  min={1}
                  max={10}
                  data-testid="input-radius"
                />
              </div>
              <div>
                <Label htmlFor="minAcreage" className="text-xs">Min Acreage</Label>
                <Input
                  id="minAcreage"
                  type="number"
                  value={minAcreage}
                  onChange={(e) => setMinAcreage(e.target.value)}
                  placeholder={`e.g., ${Math.max(0, Number(property.sizeAcres) * 0.5).toFixed(1)}`}
                  data-testid="input-min-acreage"
                />
              </div>
              <div>
                <Label htmlFor="maxAcreage" className="text-xs">Max Acreage</Label>
                <Input
                  id="maxAcreage"
                  type="number"
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Avg $/Acre</span>
              </div>
              <p className="text-lg font-bold mt-1" data-testid="text-avg-price">
                {formatCurrency(analysis.averagePricePerAcre)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Median $/Acre</span>
              </div>
              <p className="text-lg font-bold mt-1" data-testid="text-median-price">
                {formatCurrency(analysis.medianPricePerAcre)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">High $/Acre</span>
              </div>
              <p className="text-lg font-bold mt-1 text-green-600" data-testid="text-high-price">
                {formatCurrency(analysis.highPricePerAcre)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Low $/Acre</span>
              </div>
              <p className="text-lg font-bold mt-1 text-red-600" data-testid="text-low-price">
                {formatCurrency(analysis.lowPricePerAcre)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {analysis?.estimatedValue && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Estimated Market Value
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
          </CardContent>
        </Card>
      )}

      {data?.offerPrices && (
        <Card data-testid="card-offer-suggestions">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4" />
              Offer Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700">
                    Conservative
                  </Badge>
                </div>
                <p className="text-lg font-bold text-green-700 dark:text-green-300" data-testid="text-offer-conservative">
                  {formatCurrency(data.offerPrices.conservative.min)} - {formatCurrency(data.offerPrices.conservative.max)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">40-50% of market value</p>
              </div>
              <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700">
                    Standard
                  </Badge>
                </div>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300" data-testid="text-offer-standard">
                  {formatCurrency(data.offerPrices.standard.min)} - {formatCurrency(data.offerPrices.standard.max)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">50-65% of market value</p>
              </div>
              <div className="p-3 rounded-md bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700">
                    Aggressive
                  </Badge>
                </div>
                <p className="text-lg font-bold text-orange-700 dark:text-orange-300" data-testid="text-offer-aggressive">
                  {formatCurrency(data.offerPrices.aggressive.min)} - {formatCurrency(data.offerPrices.aggressive.max)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">65-80% of market value</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.desirabilityScore && (
        <Card data-testid="card-property-score">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4" />
                Property Desirability Score
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    data-testid="badge-desirability-score"
                    className={`cursor-pointer text-base px-3 py-1 ${
                      data.desirabilityScore.totalScore >= 70
                        ? "bg-green-500 hover:bg-green-600 text-white"
                        : data.desirabilityScore.totalScore >= 40
                        ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                        : "bg-red-500 hover:bg-red-600 text-white"
                    }`}
                    onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
                  >
                    {data.desirabilityScore.totalScore}/100 ({data.desirabilityScore.grade})
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Click to {showScoreBreakdown ? "hide" : "show"} score breakdown</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          {showScoreBreakdown && (
            <CardContent data-testid="score-breakdown">
              <div className="space-y-3">
                {data.desirabilityScore.factors.map((factor, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{factor.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs capitalize">{factor.description}</span>
                        <span className="font-mono text-xs">{factor.score}/{factor.maxScore}</span>
                      </div>
                    </div>
                    <Progress 
                      value={(factor.score / factor.maxScore) * 100} 
                      className="h-2"
                      data-testid={`progress-${factor.name.toLowerCase().replace(/\s+/g, "-")}`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {comps.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span>Comparable Properties ({comps.length})</span>
              <Badge variant="secondary">
                Within {radius} miles
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead className="text-right">Acreage</TableHead>
                    <TableHead className="text-right">Sale Date</TableHead>
                    <TableHead className="text-right">Sale Price</TableHead>
                    <TableHead className="text-right">$/Acre</TableHead>
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
                      <TableCell className="text-right">{comp.acreage?.toFixed(2) || "N/A"}</TableCell>
                      <TableCell className="text-right">{formatDate(comp.saleDate)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {comp.salePrice ? formatCurrency(comp.salePrice) : "N/A"}
                      </TableCell>
                      <TableCell className="text-right">
                        {comp.pricePerAcre ? formatCurrency(comp.pricePerAcre) : "N/A"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
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
          <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-medium mb-2">No Comparable Properties Found</h3>
          <p className="text-sm text-muted-foreground">
            Try expanding the search radius or adjusting filters.
          </p>
        </div>
      )}
    </div>
  );
}

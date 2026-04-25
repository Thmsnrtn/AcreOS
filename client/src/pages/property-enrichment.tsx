import { useState, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Search, MapPin, Loader2, CheckCircle2, Database, Trees, Droplets, Zap } from "lucide-react";

interface PropertyEnrichmentResult {
  propertyId: number;
  address: string;
  enrichedFields: {
    acres?: number;
    zoning?: string;
    floodZone?: string;
    soilType?: string;
    treeCover?: number;
    waterFeatures?: string[];
    utilities?: string[];
    elevation?: number;
    slope?: string;
    countyAppraisedValue?: number;
    lastSaleDate?: string;
    lastSalePrice?: number;
    taxRate?: number;
    annualTaxes?: number;
  };
  completenessScore: number;
  fieldsAdded: number;
  source: string;
  enrichedAt: string;
}

export default function PropertyEnrichmentPage() {
  useDocumentTitle("Property enrichment");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [propertyId, setPropertyId] = useState("");
  const [result, setResult] = useState<PropertyEnrichmentResult | null>(null);
  const propertyInputId = useId();

  const enrichMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/properties/${propertyId}/enrich`),
    onSuccess: async (res) => {
      const data = await res.json();
      setResult(data);
      toast({ title: `${data.fieldsAdded} field${data.fieldsAdded === 1 ? "" : "s"} enriched.` });
      qc.invalidateQueries({ queryKey: ["/api/properties"] });
    },
    onError: () =>
      toast({
        title: "Couldn't enrich property",
        description: "The property's existing data is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const batchMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/properties/bulk-enrich"),
    onSuccess: () => toast({ title: "Bulk enrichment queued.", description: "Properties will update as each lookup completes." }),
    onError: () =>
      toast({
        title: "Couldn't queue bulk enrichment",
        description: "No properties were enriched. Try again shortly.",
        variant: "destructive",
      }),
  });

  const ef = result?.enrichedFields ?? {};

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-property-enrichment-title">
          Property enrichment
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Automatically populate property details from county records, GIS data, and public sources.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enrich property</CardTitle>
          <CardDescription>Enter a property ID to fetch and populate missing data fields.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (propertyId && !enrichMutation.isPending) enrichMutation.mutate(); }}
          >
            <div>
              <Label htmlFor={propertyInputId} className="text-xs">
                Property ID <span className="text-destructive" aria-label="required">*</span>
              </Label>
              <Input
                id={propertyInputId}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="Property ID"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={!propertyId || enrichMutation.isPending}
                className="min-h-11"
              >
                {enrichMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />Enriching…</>
                ) : (
                  <><Search className="w-4 h-4 mr-2" aria-hidden="true" />Enrich property</>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => batchMutation.mutate()}
                disabled={batchMutation.isPending}
                className="min-h-11"
              >
                Bulk enrich all
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-sm">{result.address}</CardTitle>
                  <p className="text-xs text-muted-foreground">Property <span className="tabular-nums">#{result.propertyId}</span></p>
                </div>
                <Badge>
                  <span className="tabular-nums mr-1">{result.fieldsAdded}</span> field{result.fieldsAdded === 1 ? "" : "s"} added
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Data completeness</span>
                  <span className="font-medium tabular-nums">{result.completenessScore}%</span>
                </div>
                <Progress
                  value={result.completenessScore}
                  className="h-2"
                  aria-label={`Data completeness: ${result.completenessScore}%`}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(ef.acres !== undefined || ef.zoning || ef.floodZone) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" aria-hidden="true" /> Land details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-1.5">
                    {ef.acres !== undefined && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Acreage</dt><dd className="tabular-nums">{ef.acres} ac</dd></div>}
                    {ef.zoning && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Zoning</dt><dd>{ef.zoning}</dd></div>}
                    {ef.floodZone && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Flood zone</dt><dd>{ef.floodZone}</dd></div>}
                  </dl>
                </CardContent>
              </Card>
            )}

            {(ef.soilType || ef.treeCover !== undefined || ef.slope) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Trees className="w-3.5 h-3.5" aria-hidden="true" /> Natural features
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-1.5">
                    {ef.soilType && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Soil type</dt><dd>{ef.soilType}</dd></div>}
                    {ef.treeCover !== undefined && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Tree cover</dt><dd className="tabular-nums">{ef.treeCover}%</dd></div>}
                    {ef.slope && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Slope</dt><dd>{ef.slope}</dd></div>}
                    {ef.elevation !== undefined && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Elevation</dt><dd className="tabular-nums">{ef.elevation} ft</dd></div>}
                  </dl>
                </CardContent>
              </Card>
            )}

            {(ef.countyAppraisedValue || ef.annualTaxes) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" aria-hidden="true" /> Tax &amp; valuation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-1.5">
                    {ef.countyAppraisedValue && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Appraised value</dt><dd className="tabular-nums">{usd(ef.countyAppraisedValue)}</dd></div>}
                    {ef.annualTaxes && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Annual taxes</dt><dd className="tabular-nums">{usd(ef.annualTaxes)}</dd></div>}
                    {ef.lastSalePrice && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Last sale</dt><dd className="tabular-nums">{usd(ef.lastSalePrice)}</dd></div>}
                    {ef.lastSaleDate && <div className="flex justify-between text-xs"><dt className="text-muted-foreground">Sale date</dt><dd className="tabular-nums">{new Date(ef.lastSaleDate).toLocaleDateString()}</dd></div>}
                  </dl>
                </CardContent>
              </Card>
            )}

            {(ef.waterFeatures?.length || ef.utilities?.length) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" aria-hidden="true" /> Utilities &amp; water
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5" aria-label="Utilities and water features">
                    {ef.utilities?.map(u => (
                      <li key={u} className="flex items-center gap-1.5 text-xs">
                        <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" aria-hidden="true" /> {u}
                      </li>
                    ))}
                    {ef.waterFeatures?.map(w => (
                      <li key={w} className="flex items-center gap-1.5 text-xs">
                        <Droplets className="w-3 h-3 text-blue-500 flex-shrink-0" aria-hidden="true" /> {w}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Source: {result.source.replace(/_/g, ' ')} · Enriched <span className="tabular-nums">{new Date(result.enrichedAt).toLocaleString()}</span>
          </p>
        </div>
      )}
    </PageShell>
  );
}

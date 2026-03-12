import { useState } from "react";
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
import { Search, MapPin, Loader2, CheckCircle2, Database, Trees, Droplets, Zap, Mountain } from "lucide-react";

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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [propertyId, setPropertyId] = useState("");
  const [result, setResult] = useState<PropertyEnrichmentResult | null>(null);

  const enrichMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/properties/${propertyId}/enrich`),
    onSuccess: async (res) => {
      const data = await res.json();
      setResult(data);
      toast({ title: `${data.fieldsAdded} fields enriched` });
      qc.invalidateQueries({ queryKey: ["/api/properties"] });
    },
    onError: () => toast({ title: "Enrichment failed", variant: "destructive" }),
  });

  const batchMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/properties/bulk-enrich"),
    onSuccess: () => toast({ title: "Bulk enrichment queued" }),
    onError: () => toast({ title: "Bulk enrichment failed", variant: "destructive" }),
  });

  const ef = result?.enrichedFields ?? {};

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-property-enrichment-title">
          Property Enrichment
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Automatically populate property details from county records, GIS data, and public sources.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enrich Property</CardTitle>
          <CardDescription>Enter a property ID to fetch and populate missing data fields.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Property ID</Label>
              <Input
                type="number"
                placeholder="Property ID"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!propertyId || enrichMutation.isPending}
              onClick={() => propertyId && enrichMutation.mutate()}
            >
              {enrichMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Enriching...</>
              ) : (
                <><Search className="w-4 h-4 mr-2" />Enrich Property</>
              )}
            </Button>
            <Button variant="outline" onClick={() => batchMutation.mutate()} disabled={batchMutation.isPending}>
              Bulk Enrich All
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-sm">{result.address}</CardTitle>
                  <p className="text-xs text-muted-foreground">Property #{result.propertyId}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{result.fieldsAdded} fields added</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Data Completeness</span>
                  <span className="font-medium">{result.completenessScore}%</span>
                </div>
                <Progress value={result.completenessScore} className="h-2" />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(ef.acres !== undefined || ef.zoning || ef.floodZone) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Land Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {ef.acres !== undefined && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Acreage</span><span>{ef.acres} ac</span></div>}
                  {ef.zoning && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Zoning</span><span>{ef.zoning}</span></div>}
                  {ef.floodZone && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Flood Zone</span><span>{ef.floodZone}</span></div>}
                </CardContent>
              </Card>
            )}

            {(ef.soilType || ef.treeCover !== undefined || ef.slope) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Trees className="w-3.5 h-3.5" /> Natural Features
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {ef.soilType && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Soil Type</span><span>{ef.soilType}</span></div>}
                  {ef.treeCover !== undefined && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Tree Cover</span><span>{ef.treeCover}%</span></div>}
                  {ef.slope && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Slope</span><span>{ef.slope}</span></div>}
                  {ef.elevation !== undefined && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Elevation</span><span>{ef.elevation} ft</span></div>}
                </CardContent>
              </Card>
            )}

            {(ef.countyAppraisedValue || ef.annualTaxes) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" /> Tax & Valuation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {ef.countyAppraisedValue && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Appraised Value</span><span>${ef.countyAppraisedValue.toLocaleString()}</span></div>}
                  {ef.annualTaxes && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Annual Taxes</span><span>${ef.annualTaxes.toLocaleString()}</span></div>}
                  {ef.lastSalePrice && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Last Sale</span><span>${ef.lastSalePrice.toLocaleString()}</span></div>}
                  {ef.lastSaleDate && <div className="flex justify-between text-xs"><span className="text-muted-foreground">Sale Date</span><span>{new Date(ef.lastSaleDate).toLocaleDateString()}</span></div>}
                </CardContent>
              </Card>
            )}

            {(ef.waterFeatures?.length || ef.utilities?.length) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" /> Utilities & Water
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {ef.utilities?.map(u => (
                    <div key={u} className="flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="w-3 h-3 text-green-600" /> {u}
                    </div>
                  ))}
                  {ef.waterFeatures?.map(w => (
                    <div key={w} className="flex items-center gap-1.5 text-xs">
                      <Droplets className="w-3 h-3 text-blue-500" /> {w}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Source: {result.source} · Enriched {new Date(result.enrichedAt).toLocaleString()}
          </p>
        </div>
      )}
    </PageShell>
  );
}

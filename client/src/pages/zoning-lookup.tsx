import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Search, MapPin, FileText, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface ZoningResult {
  address: string;
  parcelId?: string;
  zoningCode: string;
  zoningDescription: string;
  allowedUses: string[];
  restrictions: string[];
  floodZone?: string;
  setbackFront?: number;
  setbackRear?: number;
  setbackSide?: number;
  maxHeight?: number;
  minLotSize?: number;
  permitRequired: boolean;
  source: string;
  asOf: string;
}

export default function ZoningLookupPage() {
  const { toast } = useToast();
  const [address, setAddress] = useState("");
  const [parcelId, setParcelId] = useState("");
  const [result, setResult] = useState<ZoningResult | null>(null);

  const lookupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/zoning/lookup", { address, parcelId }),
    onSuccess: async (res) => {
      const data = await res.json();
      setResult(data);
    },
    onError: () => toast({ title: "Zoning lookup failed", variant: "destructive" }),
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-zoning-lookup-title">
          Zoning Lookup
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Check zoning classification, allowed uses, and permit requirements for any parcel.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search Parcel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Property Address</Label>
              <Input
                placeholder="123 Main St, Austin TX"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Parcel ID (optional)</Label>
              <Input
                placeholder="123-456-789"
                value={parcelId}
                onChange={e => setParcelId(e.target.value)}
              />
            </div>
          </div>
          <Button
            disabled={!address || lookupMutation.isPending}
            onClick={() => lookupMutation.mutate()}
          >
            {lookupMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />Looking up...</>
            ) : (
              <><Search className="w-4 h-4 mr-2" />Look Up Zoning</>
            )}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div>
                <CardTitle className="text-sm">{result.address}</CardTitle>
                {result.parcelId && (
                  <p className="text-xs text-muted-foreground">Parcel: {result.parcelId}</p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge className="text-sm px-3 py-1">{result.zoningCode}</Badge>
              <span className="text-sm text-muted-foreground">{result.zoningDescription}</span>
            </div>

            {result.floodZone && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span>Flood Zone: <strong>{result.floodZone}</strong></span>
              </div>
            )}

            {result.permitRequired && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <FileText className="w-4 h-4" />
                Permit required for development
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Allowed Uses</p>
                <ul className="space-y-1">
                  {result.allowedUses.map(use => (
                    <li key={use} className="flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="w-3 h-3 text-green-600" /> {use}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Restrictions</p>
                <ul className="space-y-1">
                  {result.restrictions.map(r => (
                    <li key={r} className="flex items-center gap-1.5 text-xs">
                      <AlertTriangle className="w-3 h-3 text-yellow-500" /> {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {(result.setbackFront || result.maxHeight || result.minLotSize) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Development Standards</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {result.setbackFront && (
                    <div className="text-center">
                      <p className="text-muted-foreground">Front Setback</p>
                      <p className="font-medium">{result.setbackFront} ft</p>
                    </div>
                  )}
                  {result.maxHeight && (
                    <div className="text-center">
                      <p className="text-muted-foreground">Max Height</p>
                      <p className="font-medium">{result.maxHeight} ft</p>
                    </div>
                  )}
                  {result.minLotSize && (
                    <div className="text-center">
                      <p className="text-muted-foreground">Min Lot</p>
                      <p className="font-medium">{result.minLotSize.toLocaleString()} sqft</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">Source: {result.source} · As of {new Date(result.asOf).toLocaleDateString()}</p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

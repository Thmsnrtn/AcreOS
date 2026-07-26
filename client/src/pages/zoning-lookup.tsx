import { useState, useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Search, MapPin, FileText, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";

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
  useDocumentTitle("Zoning lookup");
  const { toast } = useToast();
  const [address, setAddress] = useState("");
  const [parcelId, setParcelId] = useState("");
  const [result, setResult] = useState<ZoningResult | null>(null);
  const addressId = useId();
  const parcelInputId = useId();

  // allow-no-invalidation: lookup result lands in page-local state (setResult)
  const lookupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/zoning/lookup", { address, parcelId }),
    onSuccess: async (res) => {
      const data = await res.json();
      // The server returns ZoningInfo (permittedUses / minimumLotSize /
      // maxBuildingHeight / setbacks{front,rear,side}); this page's ZoningResult
      // used different field names, so `result.allowedUses.map` and
      // `result.restrictions.map` threw on every successful lookup. Normalize
      // server → page shape here (arrays guaranteed to be arrays).
      setResult({
        address,
        parcelId: parcelId || undefined,
        zoningCode: data.zoningCode ?? "",
        zoningDescription: data.zoningDescription ?? "",
        allowedUses: Array.isArray(data.permittedUses) ? data.permittedUses : [],
        restrictions: Array.isArray(data.restrictions) ? data.restrictions : [],
        floodZone: data.floodZone,
        setbackFront: data.setbacks?.front,
        setbackRear: data.setbacks?.rear,
        setbackSide: data.setbacks?.side,
        maxHeight: data.maxBuildingHeight,
        minLotSize: data.minimumLotSize,
        permitRequired: typeof data.permitRequired === "boolean" ? data.permitRequired : false,
        source: data.source ?? "unknown",
        asOf: data.asOf ?? new Date().toISOString(),
      });
    },
    onError: () =>
      toast({
        title: "Couldn't look up zoning",
        description: "Your previous result (if any) is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-zoning-lookup-title">
          Zoning lookup
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Check zoning classification, allowed uses, and permit requirements for any parcel.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search parcel</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (address && !lookupMutation.isPending) lookupMutation.mutate(); }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor={addressId} className="text-xs">
                  Property address <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id={addressId}
                  placeholder="123 Main St, Austin TX"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  autoCapitalize="words"
                  autoComplete="street-address"
                />
              </div>
              <div>
                <Label htmlFor={parcelInputId} className="text-xs">Parcel ID (optional)</Label>
                <Input
                  id={parcelInputId}
                  placeholder="123-456-789"
                  value={parcelId}
                  onChange={e => setParcelId(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={!address || lookupMutation.isPending}
              className="min-h-11"
            >
              {lookupMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />Looking up…</>
              ) : (
                <><Search className="w-4 h-4 mr-2" aria-hidden="true" />Look up zoning</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" aria-hidden="true" />
              <div>
                <CardTitle className="text-sm">{result.address}</CardTitle>
                {result.parcelId && (
                  <p className="text-xs text-muted-foreground">Parcel: <span className="font-mono">{result.parcelId}</span></p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className="text-sm px-3 py-1">{result.zoningCode}</Badge>
              <span className="text-sm text-muted-foreground">{result.zoningDescription}</span>
            </div>

            {result.floodZone && (
              <div className="flex items-center gap-2 text-sm" role="alert">
                <AlertTriangle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                <span>Flood zone: <strong>{result.floodZone}</strong></span>
              </div>
            )}

            {result.permitRequired && (
              <div className="flex items-center gap-2 text-sm text-acr-accent">
                <FileText className="w-4 h-4" aria-hidden="true" />
                Permit required for development.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Allowed uses</p>
                <ul className="space-y-1" aria-label="Allowed uses">
                  {(result.allowedUses ?? []).length > 0 ? (
                    (result.allowedUses ?? []).map(use => (
                      <li key={use} className="flex items-center gap-1.5 text-xs">
                        <CheckCircle2 className="w-3 h-3 text-acr-pos flex-shrink-0" aria-hidden="true" /> {use}
                      </li>
                    ))
                  ) : (
                    <li className="text-xs text-muted-foreground">No permitted-use data for this parcel.</li>
                  )}
                </ul>
              </div>
              {(result.restrictions ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Restrictions</p>
                  <ul className="space-y-1" aria-label="Restrictions">
                    {(result.restrictions ?? []).map(r => (
                      <li key={r} className="flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="w-3 h-3 text-acr-warn flex-shrink-0" aria-hidden="true" /> {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {(result.setbackFront || result.maxHeight || result.minLotSize) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Development standards</p>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  {result.setbackFront && (
                    <div className="text-center">
                      <dt className="text-muted-foreground">Front setback</dt>
                      <dd className="font-medium tabular-nums">{result.setbackFront} ft</dd>
                    </div>
                  )}
                  {result.maxHeight && (
                    <div className="text-center">
                      <dt className="text-muted-foreground">Max height</dt>
                      <dd className="font-medium tabular-nums">{result.maxHeight} ft</dd>
                    </div>
                  )}
                  {result.minLotSize && (
                    <div className="text-center">
                      <dt className="text-muted-foreground">Min lot</dt>
                      <dd className="font-medium tabular-nums">{result.minLotSize.toLocaleString()} sqft</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Source: {result.source.replace(/_/g, ' ')} · As of <span className="tabular-nums">{formatDate(result.asOf)}</span>
            </p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

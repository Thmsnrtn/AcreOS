import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Globe,
  Share2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  AlertTriangle,
  Home,
  RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Platform {
  id: string;
  name: string;
  apiAvailable: boolean;
  requiresPartnerAccount: boolean;
  partnerSignupUrl: string;
  envKeys: string[];
}

interface Property {
  id: number;
  address?: string;
  city?: string;
  state?: string;
  county?: string;
  sizeAcres?: number;
  listingPrice?: string;
  status?: string;
}

interface SyndicationResult {
  platform: string;
  success: boolean;
  externalId?: string;
  url?: string;
  error?: string;
  requiresManualPost?: boolean;
  exportData?: any;
}

export default function SyndicationPage() {
  const { toast } = useToast();
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["land_com", "landwatch"]);
  const [syndicating, setSyndicating] = useState(false);
  const [results, setResults] = useState<SyndicationResult[] | null>(null);
  const [propertySearch, setPropertySearch] = useState("");

  const { data: platformData, isLoading: platformsLoading } = useQuery<{ platforms: Platform[] }>({
    queryKey: ["/api/syndication/platforms"],
    queryFn: () => fetch("/api/syndication/platforms").then(r => r.json()),
  });

  const { data: propertiesData } = useQuery<{ properties: Property[] }>({
    queryKey: ["/api/properties"],
    queryFn: () => fetch("/api/properties").then(r => r.json()),
  });

  async function syndicateProperty() {
    if (!selectedPropertyId || selectedPlatforms.length === 0) return;
    setSyndicating(true);
    setResults(null);
    try {
      const res = await fetch(`/api/listings/${selectedPropertyId}/syndicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: selectedPlatforms }),
      });
      const data = await res.json();
      setResults(data.results || []);
      const successCount = (data.results || []).filter((r: SyndicationResult) => r.success).length;
      toast({ title: `Syndicated to ${successCount}/${selectedPlatforms.length} platforms` });
    } catch (err: any) {
      toast({ title: "Syndication failed", description: err.message, variant: "destructive" });
    } finally {
      setSyndicating(false);
    }
  }

  const platforms = platformData?.platforms || [];
  const properties = (propertiesData?.properties || []).filter(p => {
    if (!propertySearch) return true;
    const q = propertySearch.toLowerCase();
    return (p.address || "").toLowerCase().includes(q) ||
      (p.county || "").toLowerCase().includes(q) ||
      (p.state || "").toLowerCase().includes(q);
  });

  const selectedProperty = properties.find(p => p.id === selectedPropertyId);

  return (
    <PageShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Listing Syndication</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Publish land listings to Land.com, LandWatch, LandFlip, and more</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Property selector */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Select Property</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Search properties..."
                value={propertySearch}
                onChange={e => setPropertySearch(e.target.value)}
                className="mb-3"
              />
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {properties.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No properties found</p>
                ) : properties.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPropertyId(p.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedPropertyId === p.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Home className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.address || `Property #${p.id}`}</p>
                        <p className="text-xs text-muted-foreground">{p.county ? `${p.county} Co., ` : ""}{p.state}</p>
                        {p.sizeAcres && <p className="text-xs text-muted-foreground">{p.sizeAcres} acres</p>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Platform selection */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Platforms</CardTitle>
              <CardDescription className="text-xs">Select where to publish</CardDescription>
            </CardHeader>
            <CardContent>
              {platformsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-2">
                  {platforms.map(platform => (
                    <div key={platform.id} className="flex items-start gap-2">
                      <Checkbox
                        id={platform.id}
                        checked={selectedPlatforms.includes(platform.id)}
                        onCheckedChange={checked => {
                          setSelectedPlatforms(prev =>
                            checked ? [...prev, platform.id] : prev.filter(p => p !== platform.id)
                          );
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <label htmlFor={platform.id} className="text-sm font-medium cursor-pointer">{platform.name}</label>
                        {platform.requiresPartnerAccount && (
                          <Badge variant="outline" className="ml-1.5 text-xs py-0">Partner</Badge>
                        )}
                        {!platform.apiAvailable && (
                          <Badge variant="secondary" className="ml-1.5 text-xs py-0">Export</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                className="w-full mt-4"
                onClick={syndicateProperty}
                disabled={!selectedPropertyId || selectedPlatforms.length === 0 || syndicating}
              >
                {syndicating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Syndicate Listing
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Results + platform info */}
        <div className="lg:col-span-2 space-y-4">
          {selectedProperty && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-muted rounded-lg">
                    <Home className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium">{selectedProperty.address || `Property #${selectedProperty.id}`}</h3>
                    <p className="text-sm text-muted-foreground">
                      {[selectedProperty.county && `${selectedProperty.county} Co.`, selectedProperty.state, selectedProperty.sizeAcres && `${selectedProperty.sizeAcres} acres`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge variant="outline" className="ml-auto">{selectedProperty.status || "active"}</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {results && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Syndication Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {results.map((r, i) => (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${r.success ? "bg-emerald-50 dark:bg-emerald-900/10" : "bg-red-50 dark:bg-red-900/10"}`}>
                      {r.success ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{r.platform}</p>
                        {r.success ? (
                          <div>
                            {r.url && (
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 flex items-center gap-1 mt-0.5">
                                View listing <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {r.requiresManualPost && (
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Export ready — manual posting required</p>
                            )}
                            {r.externalId && <p className="text-xs text-muted-foreground mt-0.5">ID: {r.externalId}</p>}
                          </div>
                        ) : (
                          <p className="text-xs text-red-600 mt-0.5">{r.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Platform info cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {platforms.map(platform => (
              <Card key={platform.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{platform.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {platform.apiAvailable ? "API integration" : "Export / deep-link"}
                      </p>
                    </div>
                    {platform.apiAvailable ? (
                      <Badge variant="default" className="text-xs">Live API</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Export</Badge>
                    )}
                  </div>
                  {platform.requiresPartnerAccount && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      <a href={platform.partnerSignupUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        Partner account required
                      </a>
                    </div>
                  )}
                  {platform.envKeys.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Requires: {platform.envKeys.join(", ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

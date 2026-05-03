import { useState, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  AlertTriangle,
  Home,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

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
  useDocumentTitle("Listing syndication");
  const { toast } = useToast();
  const searchId = useId();
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
      toast({
        title: "Couldn't syndicate listing",
        description: `${err.message}. Your platform selection is unchanged. Some platforms may have partial state — check each platform's site directly to confirm.`,
        variant: "destructive",
      });
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
    <PageShell label="Listing syndication">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Listing syndication</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Publish land listings to Land.com, LandWatch, LandFlip, and more.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Select property</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor={searchId} className="sr-only">Search properties</Label>
              <Input
                id={searchId}
                type="search"
                placeholder="Search properties…"
                value={propertySearch}
                onChange={e => setPropertySearch(e.target.value)}
                className="mb-3"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <div className="max-h-80 overflow-y-auto">
                {properties.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No properties found.</p>
                ) : (
                  <ul className="space-y-2" aria-label="Properties">
                    {properties.map(p => {
                      const label = p.address || `Property #${p.id}`;
                      const isSelected = selectedPropertyId === p.id;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedPropertyId(p.id)}
                            aria-pressed={isSelected}
                            aria-label={`Select ${label} for syndication`}
                            className={`w-full text-left p-3 rounded-lg border transition-colors min-h-9 ${
                              isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <Home className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{label}</p>
                                <p className="text-xs text-muted-foreground">{p.county ? `${p.county} Co., ` : ""}{p.state}</p>
                                {p.sizeAcres && <p className="text-xs text-muted-foreground tabular-nums">{p.sizeAcres} acres</p>}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Platforms</CardTitle>
              <CardDescription className="text-xs">Select where to publish.</CardDescription>
            </CardHeader>
            <CardContent>
              {platformsLoading ? (
                <div className="flex justify-center py-4" role="status" aria-live="polite">
                  <span className="sr-only">Loading platforms…</span>
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : (
                <fieldset>
                  <legend className="sr-only">Syndication platforms</legend>
                  <ul className="space-y-2" aria-label="Available syndication platforms">
                    {platforms.map(platform => (
                      <li key={platform.id} className="flex items-start gap-2">
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
                          <Label htmlFor={platform.id} className="text-sm font-medium cursor-pointer">{platform.name}</Label>
                          {platform.requiresPartnerAccount && (
                            <Badge variant="outline" className="ml-1.5 text-xs py-0">Partner</Badge>
                          )}
                          {!platform.apiAvailable && (
                            <Badge variant="secondary" className="ml-1.5 text-xs py-0">Export</Badge>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              <Button
                className="w-full mt-4"
                onClick={syndicateProperty}
                disabled={!selectedPropertyId || selectedPlatforms.length === 0 || syndicating}
                aria-label={selectedProperty ? `Syndicate ${selectedProperty.address || `Property #${selectedProperty.id}`} to selected platforms` : "Syndicate listing to selected platforms"}
              >
                {syndicating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                )}
                Syndicate listing
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selectedProperty && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="p-2 bg-muted rounded-lg">
                    <Home className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-medium">{selectedProperty.address || `Property #${selectedProperty.id}`}</h2>
                    <p className="text-sm text-muted-foreground">
                      {[selectedProperty.county && `${selectedProperty.county} Co.`, selectedProperty.state, selectedProperty.sizeAcres && `${selectedProperty.sizeAcres} acres`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge variant="outline" className="ml-auto capitalize">{selectedProperty.status || "active"}</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {results && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Syndication results</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3" aria-label="Per-platform syndication results">
                  {results.map((r, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-3 p-3 rounded-lg ${r.success ? "bg-acr-pos-soft dark:bg-acr-pos-soft/10" : "bg-acr-neg-soft dark:bg-acr-neg-soft/10"}`}
                      role={r.success ? undefined : "alert"}
                    >
                      {r.success ? (
                        <CheckCircle2 className="h-4 w-4 text-acr-pos flex-shrink-0 mt-0.5" aria-label="Success" />
                      ) : (
                        <XCircle className="h-4 w-4 text-acr-neg flex-shrink-0 mt-0.5" aria-label="Failure" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{r.platform}</p>
                        {r.success ? (
                          <div>
                            {r.url && (
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-acr-accent flex items-center gap-1 mt-0.5 hover:underline"
                                aria-label={`View ${r.platform} listing in a new tab`}
                              >
                                View listing <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            )}
                            {r.requiresManualPost && (
                              <p className="text-xs text-acr-warn dark:text-acr-warn mt-0.5">Export ready — manual posting required.</p>
                            )}
                            {r.externalId && <p className="text-xs text-muted-foreground mt-0.5 font-mono">ID: {r.externalId}</p>}
                          </div>
                        ) : (
                          <p className="text-xs text-acr-neg mt-0.5">{r.error}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Platform integration details">
            {platforms.map(platform => (
              <li key={platform.id}>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-2">
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
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-acr-warn dark:text-acr-warn">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        <a
                          href={platform.partnerSignupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                          aria-label={`Sign up for a ${platform.name} partner account in a new tab`}
                        >
                          Partner account required
                        </a>
                      </div>
                    )}
                    {platform.envKeys.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Requires: {platform.envKeys.join(", ")}.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PageShell>
  );
}

import { useState, useId, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
import { apiRequest } from "@/lib/queryClient";
import { okOrThrow } from "@/lib/fetch-honesty";

interface Platform {
  id: string;
  name: string;
  apiAvailable: boolean;
  requiresPartnerAccount: boolean;
  partnerSignupUrl: string;
  /** "customer_account": posts on your own account with the channel. */
  connection: "customer_account" | "none";
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

// The shape POST /api/listings/:id/syndicate returns
// (listingSyndication.LegacySyndicationResult). This read `url`,
// `externalId` and `requiresManualPost`, none of which the server sends, so
// Craigslist's ready-to-paste text never rendered and its result read as a
// bare "Success".
interface SyndicationResult {
  platform: string;
  success: boolean;
  listingId?: string;
  listingUrl?: string;
  deepLinkUrl?: string;
  preformattedText?: string;
  error?: string;
  requiresManualAction?: boolean;
  manualInstructions?: string;
}

/** Posted means a channel returned a listing id — not "text was prepared". */
const wasPosted = (r: SyndicationResult) => r.success && !r.requiresManualAction && Boolean(r.listingId);

export default function SyndicationPage() {
  useDocumentTitle("Listing syndication");
  const { toast } = useToast();
  const searchId = useId();
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  // Nothing pre-selected: this used to pre-select LandWatch, which has no
  // adapter, and no channel can post until the org's own account connects.
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [syndicating, setSyndicating] = useState(false);
  const [results, setResults] = useState<SyndicationResult[] | null>(null);
  const [propertySearch, setPropertySearch] = useState("");

  // The route answers a bare array (`Object.values(PLATFORMS)`); this read
  // `.platforms` off it, so the picker always rendered empty. A failed read
  // is an error, not an empty list.
  const { data: platformData, isLoading: platformsLoading } = useQuery<Platform[]>({
    queryKey: ["/api/syndication/platforms"],
    queryFn: async () => (await okOrThrow(await fetch("/api/syndication/platforms", { credentials: "include" }))).json(),
  });

  // /api/properties answers { data, total, … }. This read `.properties` —
  // which does not exist — so every customer saw "No properties found." and
  // could syndicate nothing; it also wrote that envelope into the SHARED
  // ["/api/properties"] cache that the Map reads as an array (DEFECT-0157).
  // Own key, the real shape, and a failed read is an error, not an empty list.
  // The search runs on the SERVER (DEFECT-0168): it filtered the newest 100
  // in the browser, so an older property could not be found to syndicate.
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(propertySearch.trim()), 250);
    return () => clearTimeout(t);
  }, [propertySearch]);
  const { data: propertiesData, isError: propertiesError } = useQuery<{ data: Property[]; total: number }>({
    queryKey: ["syndication", "properties", searchTerm],
    queryFn: async () => {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (searchTerm) qs.set("q", searchTerm);
      const r = await okOrThrow(await fetch(`/api/properties?${qs}`, { credentials: "include" }));
      return r.json();
    },
    placeholderData: keepPreviousData,
  });

  // The route takes a LISTING id (DEFECT-0182): this page sent the selected
  // property's id, so it syndicated whichever listing happened to share that
  // number — or 404'd.
  const { data: listingsData } = useQuery<Array<{ id: number; propertyId: number; status: string }>>({
    queryKey: ["/api/listings"],
  });

  async function syndicateProperty() {
    if (!selectedPropertyId || selectedPlatforms.length === 0) return;
    // The property's ACTIVE listing: a withdrawn or sold one is refused by
    // the route even when a live listing exists for the same property.
    const forProperty = (listingsData ?? []).filter((l) => l.propertyId === selectedPropertyId);
    const listing = forProperty.find((l) => l.status === "active") ?? forProperty[0];
    if (!listing) {
      toast({
        title: "No listing for this property yet",
        description: "Create a listing for it under Listings first; each channel works from that listing.",
        variant: "destructive",
      });
      return;
    }
    setSyndicating(true);
    setResults(null);
    try {
      // Unchecked, a 500's body has no `results`, so successCount fell to 0
      // and the toast read "Syndicated to 0/3 platforms" — a FAILURE dressed
      // as a partial success, on an action that publishes a listing to third
      // parties. apiRequest throws, so the catch below tells the truth.
      const res = await apiRequest("POST", `/api/listings/${listing.id}/syndicate`, {
        platforms: selectedPlatforms,
      });
      const data = await res.json();
      setResults(data.results || []);
      const all: SyndicationResult[] = data.results || [];
      const posted = all.filter(wasPosted).length;
      const pasteReady = all.filter((r) => r.success && r.requiresManualAction).length;
      toast({
        title: posted > 0 ? `Posted to ${posted} of ${all.length} channels` : "Nothing was posted",
        description:
          pasteReady > 0
            ? "Ready-to-paste text is below. Other channels post only on your own account, which AcreOS can't connect yet."
            : "These channels post only on your own account with them, which AcreOS can't connect yet.",
      });
    } catch (err: any) {
      toast({
        title: "Couldn't prepare the listing for these channels",
        description: `${err.message}. Your platform selection is unchanged. Some platforms may have partial state — check each platform's site directly to confirm.`,
        variant: "destructive",
      });
    } finally {
      setSyndicating(false);
    }
  }

  const platforms = Array.isArray(platformData) ? platformData : [];
  const loadedProperties = propertiesData?.data ?? [];
  const totalProperties = propertiesData?.total ?? loadedProperties.length;
  const properties = loadedProperties;

  const selectedProperty = properties.find(p => p.id === selectedPropertyId);

  return (
    <PageShell label="Listing syndication">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Listing syndication</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          AcreOS prepares the listing copy. Posting to Land.com, Facebook and the other portals runs on your own account
          with each, which can&apos;t be connected yet; Craigslist gets ready-to-paste text.
        </p>
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
                {totalProperties > loadedProperties.length && (
                  <p className="text-xs text-muted-foreground mb-2" data-testid="text-syndication-partial">
                    Showing {loadedProperties.length} of {totalProperties} {searchTerm ? "matches" : "properties"} — type to narrow.
                  </p>
                )}
                {propertiesError ? (
                  <p className="text-sm text-destructive text-center py-4" role="alert">
                    Couldn't load your properties. Refresh to try again.
                  </p>
                ) : properties.length === 0 ? (
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
                            className={`w-full text-left p-3 rounded-card border transition-colors min-h-9 ${
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
              <CardDescription className="text-xs">Select channels.</CardDescription>
            </CardHeader>
            <CardContent>
              {platformsLoading ? (
                <div className="space-y-3" role="status" aria-live="polite">
                  <span className="sr-only">Loading platforms…</span>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Skeleton announce={false} className="h-4 w-4 shrink-0 rounded-sm" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <Skeleton announce={false} className="h-4 w-32" />
                        <Skeleton announce={false} className="h-3 w-48 max-w-full" />
                      </div>
                    </div>
                  ))}
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
                          {platform.connection === "customer_account" ? (
                            <Badge variant="outline" className="ml-1.5 text-xs py-0">Your account</Badge>
                          ) : (
                            <Badge variant="secondary" className="ml-1.5 text-xs py-0">Paste text</Badge>
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
                disabled={!selectedPropertyId || selectedPlatforms.length === 0 || syndicating || !listingsData}
                aria-label={selectedProperty ? `Prepare ${selectedProperty.address || `Property #${selectedProperty.id}`} for the selected channels` : "Prepare the listing for the selected channels"}
              >
                {syndicating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                )}
                Prepare for channels
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selectedProperty && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="p-2 bg-muted rounded-card">
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
                <CardTitle className="text-sm">Channel results</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3" aria-label="Per-channel results">
                  {results.map((r, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-3 p-3 rounded-card ${wasPosted(r) ? "bg-acr-pos-soft dark:bg-acr-pos-soft/10" : r.success ? "bg-acr-warn-soft dark:bg-acr-warn-soft/10" : "bg-acr-neg-soft dark:bg-acr-neg-soft/10"}`}
                      role={r.success ? undefined : "alert"}
                    >
                      {wasPosted(r) ? (
                        <CheckCircle2 className="h-4 w-4 text-acr-pos flex-shrink-0 mt-0.5" aria-label="Posted" />
                      ) : r.success ? (
                        <AlertTriangle className="h-4 w-4 text-acr-warn flex-shrink-0 mt-0.5" aria-label="Ready to post yourself" />
                      ) : (
                        <XCircle className="h-4 w-4 text-acr-neg flex-shrink-0 mt-0.5" aria-label="Not posted" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{r.platform}</p>
                        {!r.success && r.error && <p className="text-xs text-acr-neg mt-0.5">{r.error}</p>}
                        {r.manualInstructions && <p className="text-xs text-muted-foreground mt-0.5">{r.manualInstructions}</p>}
                        {r.listingUrl && (
                          <a
                            href={r.listingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-acr-accent flex items-center gap-1 mt-0.5 hover:underline"
                            aria-label={`View ${r.platform} listing in a new tab`}
                          >
                            View listing <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                        {r.listingId && <p className="text-xs text-muted-foreground mt-0.5 font-mono">ID: {r.listingId}</p>}
                        {r.preformattedText && (
                          <textarea
                            readOnly
                            value={r.preformattedText}
                            aria-label={`Ready-to-paste text for ${r.platform}`}
                            className="mt-2 w-full h-32 text-xs font-mono p-2 rounded-md border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        )}
                        {r.deepLinkUrl && (
                          <a
                            href={r.deepLinkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-acr-accent flex items-center gap-1 mt-1 hover:underline"
                            aria-label={`Open ${r.platform} in a new tab to post it yourself`}
                          >
                            Open {r.platform} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
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
                          {platform.connection === "customer_account" ? "Posts on your own account — not connectable yet" : "Ready-to-paste text"}
                        </p>
                      </div>
                      {platform.connection === "customer_account" ? (
                        <Badge variant="outline" className="text-xs">Not connected</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Paste text</Badge>
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
                    {platform.connection === "customer_account" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Posts on your own {platform.name} account, which AcreOS can't connect yet.
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

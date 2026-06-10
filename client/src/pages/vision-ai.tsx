import { useId, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useProperties } from "@/hooks/use-properties";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Eye, Camera, Satellite, Zap, CheckCircle, AlertTriangle, Image as ImageIcon, FileText, ArrowLeftRight, Activity, Map } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";

const reassurance = "The selection is still in place — try again.";

function BeforeAfterSlider({ before, after, label }: { before: string; after: string; label?: string }) {
  const [sliderPos, setSliderPos] = useState(50);
  const sliderId = useId();

  return (
    <div className="space-y-2">
      {label && <p id={`${sliderId}-label`} className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div
        className="relative overflow-hidden rounded-card bg-muted"
        style={{ height: 200 }}
        role="img"
        aria-label="Before-and-after satellite imagery comparison; drag the slider below to reveal more or less of the older snapshot"
      >
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-gradient-to-br from-acr-pos to-acr-pos"
          style={{ backgroundImage: after ? `url(${after})` : undefined, backgroundSize: 'cover' }}
        >
          {!after && <span>After</span>}
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-gradient-to-br from-acr-warn to-acr-warn overflow-hidden"
          style={{ width: `${sliderPos}%`, backgroundImage: before ? `url(${before})` : undefined, backgroundSize: 'cover', backgroundPosition: 'left center' }}
        >
          {!before && <span>Before</span>}
        </div>
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
          style={{ left: `${sliderPos}%` }}
        >
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white rounded-full shadow border flex items-center justify-center">
            <ArrowLeftRight className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/50 text-white text-xs rounded">Before</div>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-xs rounded">After</div>
      </div>
      <input
        id={sliderId}
        type="range"
        min={0}
        max={100}
        value={sliderPos}
        onChange={e => setSliderPos(Number(e.target.value))}
        className="w-full h-1.5 accent-primary"
        aria-label="Before/after slider position (percent of older image revealed)"
        aria-valuenow={sliderPos}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

function ChangeDetectionDisplay({ snapshots }: { snapshots: any[] }) {
  const latestSnap = snapshots[0];
  const prevSnap = snapshots[1];

  if (snapshots.length < 2) return null;

  // Truth-immutable (Quinn): the "Change score N/100" badge was a fabricated
  // heuristic (random NDVI upstream + a magic +20 here) presented as a precise
  // fact. It is hard-disabled. We only surface a real before/after comparison
  // and any genuine change flags the imagery provider actually wrote. No score.
  const changedSnaps = snapshots.filter(s => s.changeDetected);

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Change detection</p>
      <div
        className="flex items-center gap-2 text-xs p-2 bg-muted rounded border"
        role="status"
      >
        <Activity className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="text-muted-foreground">
          Automated change scoring isn&apos;t available — no satellite imagery
          provider is connected. Compare the snapshots below manually.
        </span>
      </div>

      {changedSnaps.length > 0 && (
        <ul className="space-y-2 list-none p-0 m-0" aria-label="Snapshots flagged with change by the imagery provider">
          {changedSnaps.map((snap, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-xs p-2 bg-acr-warn-soft rounded border border-acr-warn-soft"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-acr-warn shrink-0" aria-hidden="true" />
              <span>Provider flagged change on {snap.capturedAt ? format(new Date(snap.capturedAt), 'MMM d, yyyy') : '—'} · zoom {snap.zoom ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}

      <BeforeAfterSlider
        before={prevSnap?.imageUrl ?? ''}
        after={latestSnap?.imageUrl ?? ''}
        label="Satellite image comparison (drag slider to compare)"
      />
    </div>
  );
}

function FeaturePill({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">{label}</span>
  );
}

function QualityBadge({ quality }: { quality: string }) {
  const map: Record<string, string> = {
    excellent: "bg-acr-pos-soft text-acr-pos",
    good: "bg-acr-accent text-acr-accent",
    fair: "bg-acr-warn-soft text-acr-warn",
    poor: "bg-acr-neg-soft text-acr-neg",
  };
  return <Badge className={map[quality] ?? "bg-muted text-muted-foreground"} aria-label={`Photo quality: ${quality}`}>{quality}</Badge>;
}

export default function VisionAIPage() {
  useDocumentTitle("Vision AI");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties();
  const properties = propertiesData ?? [];
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const propertySelectId = useId();

  const {
    data: summaryData,
    isLoading: summaryLoading,
    isError: summaryIsError,
    error: summaryError,
    refetch: refetchSummary,
    isRefetching: summaryRefetching,
  } = useQuery({
    queryKey: ["/api/vision-ai/properties", selectedPropertyId, "summary"],
    enabled: !!selectedPropertyId,
    queryFn: async () => {
      const res = await fetch(`/api/vision-ai/properties/${selectedPropertyId}/summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch visual analysis summary");
      return res.json();
    },
  });

  const { data: snapshotsData } = useQuery({
    queryKey: ["/api/vision-ai/properties", selectedPropertyId, "snapshots"],
    enabled: !!selectedPropertyId,
    queryFn: async () => {
      const res = await fetch(`/api/vision-ai/properties/${selectedPropertyId}/snapshots`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch satellite snapshots");
      return res.json();
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/vision-ai/properties/${selectedPropertyId}/analyze`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Analysis complete", description: "All property photos have been analyzed" });
      queryClient.invalidateQueries({ queryKey: ["/api/vision-ai/properties", selectedPropertyId] });
    },
    onError: (e: any) => toast({ title: "Couldn't analyze photos", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  const descriptionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/vision-ai/properties/${selectedPropertyId}/description`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Description generated", description: data.description?.slice(0, 80) + "…" });
    },
    onError: (e: any) => toast({ title: "Couldn't generate description", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  const summary = summaryData?.summary;
  const snapshots = snapshotsData?.snapshots ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Eye className="w-7 h-7 text-primary" aria-hidden="true" /> Vision AI
        </h1>
        <p className="text-muted-foreground mt-1">
          Photo analysis, satellite imagery, and visual change detection for land properties.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor={propertySelectId} className="text-sm font-medium mb-1 block">Select property</Label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger id={propertySelectId}>
                  <SelectValue placeholder="Choose a property to analyze…" />
                </SelectTrigger>
                <SelectContent>
                  {(Array.isArray(properties) ? properties : []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.address || p.apn || `Property #${p.id}`} — {p.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPropertyId && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
                  <Camera className="w-4 h-4 mr-1" aria-hidden="true" />
                  {analyzeMutation.isPending ? "Analyzing…" : "Analyze photos"}
                </Button>
                <Button variant="outline" onClick={() => descriptionMutation.mutate()} disabled={descriptionMutation.isPending}>
                  <FileText className="w-4 h-4 mr-1" aria-hidden="true" />
                  {descriptionMutation.isPending ? "Generating…" : "Generate description"}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedPropertyId && (
        <EmptyState
          icon={Eye}
          headline="See what your land looks like"
          subtitle="Pick a property to get photo analysis, satellite comparisons, and a marketing-readiness read on its imagery."
          cta={{
            label: "Choose a property",
            onClick: () => document.getElementById(propertySelectId)?.focus(),
            "data-testid": "vision-ai-pick-property",
          }}
          actionIcon={null}
          testId="vision-ai-empty-state"
        />
      )}

      {selectedPropertyId && summaryLoading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading visual analysis">
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-28" announce={i === 0} announceText="Loading visual analysis" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" announce={false} />
                    <Skeleton className="h-5 w-16 rounded-full" announce={false} />
                  </div>
                  <Skeleton className="h-12 w-full" announce={false} />
                  <div className="flex gap-1">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <Skeleton key={j} className="h-5 w-16 rounded-full" announce={false} />
                    ))}
                  </div>
                  <Skeleton className="h-1.5 w-full" announce={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {selectedPropertyId && summaryIsError && (
        <QueryErrorState
          error={summaryError}
          onRetry={() => refetchSummary()}
          isRetrying={summaryRefetching}
          title="Couldn't load visual analysis"
          testId="vision-ai-error"
        />
      )}

      {summary && (
        <Tabs defaultValue="analysis">
          <TabsList>
            <TabsTrigger value="analysis">Photo analysis</TabsTrigger>
            <TabsTrigger value="satellite">Satellite</TabsTrigger>
            <TabsTrigger value="marketing">Marketing</TabsTrigger>
          </TabsList>

          {/* Photo Analysis */}
          <TabsContent value="analysis" className="mt-4 space-y-4">
            {summary.photos?.length > 0 ? (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0 m-0" aria-label="Analyzed property photos">
                {summary.photos.map((photo: any, i: number) => (
                  <li key={i}>
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ImageIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            <span className="font-medium text-sm">Photo {i + 1}</span>
                          </div>
                          <QualityBadge quality={photo.analysis?.photoQuality ?? "unknown"} />
                        </div>

                        {photo.analysis && (
                          <>
                            <p className="text-sm text-muted-foreground">{photo.analysis.aiDescription}</p>

                            {photo.analysis.detectedFeatures?.length > 0 && (
                              <ul className="flex flex-wrap gap-1 list-none p-0 m-0" aria-label="Detected features">
                                {photo.analysis.detectedFeatures.map((f: string) => (
                                  <li key={f}>
                                    <FeaturePill label={f} />
                                  </li>
                                ))}
                              </ul>
                            )}

                            <dl className="grid grid-cols-3 gap-2 text-xs">
                              <div className="flex items-center gap-1">
                                <CheckCircle
                                  className={`w-3 h-3 ${photo.analysis.buildingDetected ? "text-acr-warn" : "text-acr-pos"}`}
                                  aria-hidden="true"
                                />
                                <dt className="sr-only">Buildings</dt>
                                <dd>{photo.analysis.buildingDetected ? "Buildings present" : "No buildings"}</dd>
                              </div>
                              <div className="flex items-center gap-1">
                                {photo.analysis.waterDetected
                                  ? <CheckCircle className="w-3 h-3 text-acr-accent" aria-hidden="true" />
                                  : <span className="w-3 h-3 inline-block" aria-hidden="true" />}
                                <dt className="sr-only">Water</dt>
                                <dd>{photo.analysis.waterDetected ? "Water visible" : "No water"}</dd>
                              </div>
                              <div className="flex items-center gap-1">
                                {photo.analysis.roadDetected
                                  ? <CheckCircle className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                                  : <span className="w-3 h-3 inline-block" aria-hidden="true" />}
                                <dt className="sr-only">Roads</dt>
                                <dd>{photo.analysis.roadDetected ? "Road access" : "No roads"}</dd>
                              </div>
                            </dl>

                            <div className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Vegetation density</span>
                                <span className="tabular-nums">{photo.analysis.vegetationDensity ?? 0}%</span>
                              </div>
                              <Progress
                                value={photo.analysis.vegetationDensity ?? 0}
                                className="h-1.5"
                                role="progressbar"
                                aria-valuenow={photo.analysis.vegetationDensity ?? 0}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`Vegetation density on photo ${i + 1}`}
                              />
                            </div>

                            <div className="flex items-center gap-1 text-xs" role="status">
                              {photo.analysis.isUsableForMarketing
                                ? <><CheckCircle className="w-3 h-3 text-acr-pos" aria-hidden="true" /><span className="text-acr-pos">Marketing-ready</span></>
                                : <><AlertTriangle className="w-3 h-3 text-acr-warn" aria-hidden="true" /><span className="text-acr-warn">Not for marketing</span></>}
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Camera}
                headline="Analyze this property's photos"
                subtitle="Pax reads each photo for terrain, water, road access, and marketing quality — one click does the whole set."
                cta={{
                  label: analyzeMutation.isPending ? "Analyzing…" : "Analyze photos",
                  onClick: () => { if (!analyzeMutation.isPending) analyzeMutation.mutate(); },
                  "data-testid": "vision-ai-analyze-cta",
                }}
                actionIcon={Camera}
                testId="vision-ai-photos-empty"
              />
            )}
          </TabsContent>

          {/* Satellite */}
          <TabsContent value="satellite" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="col-span-full md:col-span-1">
                <CardHeader><CardTitle className="text-sm">Snapshots</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-2xl font-bold tabular-nums">{snapshots.length}</p>
                  <p className="text-xs text-muted-foreground">captured</p>
                </CardContent>
              </Card>
              {snapshots.length > 0 && (
                <Card className="col-span-full md:col-span-2">
                  <CardContent className="p-4">
                    <p className="text-sm font-medium mb-2">Latest snapshots</p>
                    <ul className="space-y-2 list-none p-0 m-0" aria-label="Latest satellite snapshots">
                      {snapshots.slice(0, 3).map((snap: any, i: number) => (
                        <li key={i} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                          <div className="flex items-center gap-2">
                            <Satellite className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            <span>Zoom {snap.zoom ?? "—"} · {snap.capturedAt ? format(new Date(snap.capturedAt), "MMM d, yyyy") : "—"}</span>
                          </div>
                          {snap.changeDetected && (
                            <Badge variant="destructive" className="text-xs" aria-label="Change detected on this snapshot">Change detected</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>

            {snapshots.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-primary" aria-hidden="true" /> Satellite image diff &amp; change detection
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChangeDetectionDisplay snapshots={snapshots} />
                </CardContent>
              </Card>
            )}

            {snapshots.length === 0 && (
              <EmptyState
                icon={Satellite}
                headline="No satellite snapshots yet"
                subtitle="Snapshots are captured automatically once a satellite imagery provider is connected. In the meantime, the Map gives you current aerial imagery for this parcel."
                cta={{
                  label: "View on Map",
                  href: "/map",
                  "data-testid": "vision-ai-snapshots-map-cta",
                }}
                actionIcon={Map}
                testId="vision-ai-snapshots-empty"
              />
            )}
          </TabsContent>

          {/* Marketing */}
          <TabsContent value="marketing" className="mt-4 space-y-4">
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <dt className="text-sm text-muted-foreground mb-1">Marketing-ready photos</dt>
                  <dd className="text-2xl font-bold text-acr-pos tabular-nums">
                    {summary.photos?.filter((p: any) => p.analysis?.isUsableForMarketing).length ?? 0}
                  </dd>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <dt className="text-sm text-muted-foreground mb-1">Landscape type</dt>
                  <dd className="text-lg font-semibold capitalize">
                    {summary.photos?.[0]?.analysis?.landscapeType ?? "—"}
                  </dd>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <dt className="text-sm text-muted-foreground mb-1">AI confidence</dt>
                  <dd className="text-2xl font-bold tabular-nums">
                    {summary.photos?.[0]?.analysis?.confidence
                      ? `${Math.round(summary.photos[0].analysis.confidence * 100)}%`
                      : "—"}
                  </dd>
                </CardContent>
              </Card>
            </dl>
            {summary.generatedDescription && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4 text-primary" aria-hidden="true" /> AI-generated listing description
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-sm leading-relaxed">{summary.generatedDescription}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      navigator.clipboard.writeText(summary.generatedDescription);
                      toast({ title: "Copied to clipboard" });
                    }}
                    aria-label="Copy AI-generated listing description to clipboard"
                  >
                    Copy to clipboard
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useProperties } from "@/hooks/use-properties";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Eye, Camera, Satellite, Zap, CheckCircle, AlertTriangle, Image, FileText, ArrowLeftRight, Activity } from "lucide-react";
import { useState as useLocalState } from "react";

// ─── Before/After Slider Component ───────────────────────────────────────────

function BeforeAfterSlider({ before, after, label }: { before: string; after: string; label?: string }) {
  const [sliderPos, setSliderPos] = useLocalState(50);

  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="relative overflow-hidden rounded-lg bg-muted" style={{ height: 200 }}>
        {/* "After" image (full width base) */}
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-gradient-to-br from-green-100 to-green-200"
          style={{ backgroundImage: after ? `url(${after})` : undefined, backgroundSize: 'cover' }}
        >
          {!after && <span>After</span>}
        </div>
        {/* "Before" image (clipped to left of slider) */}
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-gradient-to-br from-orange-100 to-orange-200 overflow-hidden"
          style={{ width: `${sliderPos}%`, backgroundImage: before ? `url(${before})` : undefined, backgroundSize: 'cover', backgroundPosition: 'left center' }}
        >
          {!before && <span>Before</span>}
        </div>
        {/* Divider line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
          style={{ left: `${sliderPos}%` }}
        >
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white rounded-full shadow border flex items-center justify-center">
            <ArrowLeftRight className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>
        {/* Labels */}
        <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/50 text-white text-xs rounded">Before</div>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white text-xs rounded">After</div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={sliderPos}
        onChange={e => setSliderPos(Number(e.target.value))}
        className="w-full h-1.5 accent-primary"
      />
    </div>
  );
}

// ─── Change Detection Display ─────────────────────────────────────────────────

function ChangeDetectionDisplay({ snapshots }: { snapshots: any[] }) {
  const changedSnaps = snapshots.filter(s => s.changeDetected);
  const latestSnap = snapshots[0];
  const prevSnap = snapshots[1];

  if (snapshots.length < 2) return null;

  const changeScore = changedSnaps.length > 0
    ? Math.min(100, Math.round((changedSnaps.length / snapshots.length) * 100 + 20))
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium">Change Detection Results</p>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${changeScore > 40 ? 'bg-red-100 text-red-700' : changeScore > 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
          <Activity className="w-3 h-3" />
          Change Score: {changeScore}/100
        </div>
      </div>
      {changedSnaps.length > 0 ? (
        <div className="space-y-2">
          {changedSnaps.map((snap, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-2 bg-red-50 rounded border border-red-200">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span>Change detected on {snap.capturedAt ? new Date(snap.capturedAt).toLocaleDateString() : '—'} · Zoom {snap.zoom ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs p-2 bg-green-50 rounded border border-green-200">
          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          <span>No significant changes detected across {snapshots.length} snapshots</span>
        </div>
      )}

      {/* Before/after slider using snapshot imagery */}
      <BeforeAfterSlider
        before={prevSnap?.imageUrl ?? ''}
        after={latestSnap?.imageUrl ?? ''}
        label="Satellite Image Comparison (Drag slider to compare)"
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
    excellent: "bg-green-100 text-green-800",
    good: "bg-blue-100 text-blue-800",
    fair: "bg-yellow-100 text-yellow-800",
    poor: "bg-red-100 text-red-800",
  };
  return <Badge className={map[quality] ?? "bg-gray-100 text-gray-600"}>{quality}</Badge>;
}

export default function VisionAIPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: propertiesData } = useProperties();
  const properties = propertiesData ?? [];
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ["/api/vision-ai/properties", selectedPropertyId, "summary"],
    enabled: !!selectedPropertyId,
    queryFn: async () => {
      const res = await fetch(`/api/vision-ai/properties/${selectedPropertyId}/summary`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: snapshotsData } = useQuery({
    queryKey: ["/api/vision-ai/properties", selectedPropertyId, "snapshots"],
    enabled: !!selectedPropertyId,
    queryFn: async () => {
      const res = await fetch(`/api/vision-ai/properties/${selectedPropertyId}/snapshots`, { credentials: "include" });
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
    onError: (e: any) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const summary = summaryData?.summary;
  const snapshots = snapshotsData?.snapshots ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Eye className="w-7 h-7 text-primary" /> Vision AI
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered photo analysis, satellite imagery, and visual change detection for land properties
        </p>
      </div>

      {/* Property selector */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Select Property</label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger>
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
                  <Camera className="w-4 h-4 mr-1" />
                  {analyzeMutation.isPending ? "Analyzing…" : "Analyze Photos"}
                </Button>
                <Button variant="outline" onClick={() => descriptionMutation.mutate()} disabled={descriptionMutation.isPending}>
                  <FileText className="w-4 h-4 mr-1" />
                  {descriptionMutation.isPending ? "Generating…" : "Generate Description"}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedPropertyId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Eye className="w-14 h-14 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Select a property to view its visual intelligence summary.</p>
          </CardContent>
        </Card>
      )}

      {selectedPropertyId && summaryLoading && (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-32 bg-muted/50 rounded-lg animate-pulse" />)}
        </div>
      )}

      {summary && (
        <Tabs defaultValue="analysis">
          <TabsList>
            <TabsTrigger value="analysis">Photo Analysis</TabsTrigger>
            <TabsTrigger value="satellite">Satellite</TabsTrigger>
            <TabsTrigger value="marketing">Marketing</TabsTrigger>
          </TabsList>

          {/* Photo Analysis */}
          <TabsContent value="analysis" className="mt-4 space-y-4">
            {summary.photos?.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {summary.photos.map((photo: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Image className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Photo {i + 1}</span>
                        </div>
                        <QualityBadge quality={photo.analysis?.photoQuality ?? "unknown"} />
                      </div>

                      {photo.analysis && (
                        <>
                          <p className="text-sm text-muted-foreground">{photo.analysis.aiDescription}</p>

                          {photo.analysis.detectedFeatures?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {photo.analysis.detectedFeatures.map((f: string) => (
                                <FeaturePill key={f} label={f} />
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="flex items-center gap-1">
                              {photo.analysis.buildingDetected
                                ? <CheckCircle className="w-3 h-3 text-orange-500" />
                                : <CheckCircle className="w-3 h-3 text-green-500" />}
                              <span>{photo.analysis.buildingDetected ? "Buildings present" : "No buildings"}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              {photo.analysis.waterDetected
                                ? <CheckCircle className="w-3 h-3 text-blue-500" />
                                : <span className="w-3 h-3 inline-block" />}
                              <span>{photo.analysis.waterDetected ? "Water visible" : "No water"}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              {photo.analysis.roadDetected
                                ? <CheckCircle className="w-3 h-3 text-gray-500" />
                                : <span className="w-3 h-3 inline-block" />}
                              <span>{photo.analysis.roadDetected ? "Road access" : "No roads"}</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Vegetation density</span>
                              <span>{photo.analysis.vegetationDensity ?? 0}%</span>
                            </div>
                            <Progress value={photo.analysis.vegetationDensity ?? 0} className="h-1.5" />
                          </div>

                          <div className="flex items-center gap-1 text-xs">
                            {photo.analysis.isUsableForMarketing
                              ? <><CheckCircle className="w-3 h-3 text-green-500" /><span className="text-green-600">Marketing-ready</span></>
                              : <><AlertTriangle className="w-3 h-3 text-yellow-500" /><span className="text-yellow-600">Not for marketing</span></>}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-10 text-center">
                  <Camera className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No analyzed photos yet. Click "Analyze Photos" to start.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Satellite */}
          <TabsContent value="satellite" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="col-span-full md:col-span-1">
                <CardHeader><CardTitle className="text-sm">Snapshots</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-2xl font-bold">{snapshots.length}</p>
                  <p className="text-xs text-muted-foreground">captured</p>
                </CardContent>
              </Card>
              {snapshots.length > 0 && (
                <Card className="col-span-full md:col-span-2">
                  <CardContent className="p-4">
                    <p className="text-sm font-medium mb-2">Latest Snapshots</p>
                    <div className="space-y-2">
                      {snapshots.slice(0, 3).map((snap: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                          <div className="flex items-center gap-2">
                            <Satellite className="w-4 h-4 text-muted-foreground" />
                            <span>Zoom {snap.zoom ?? "—"} · {snap.capturedAt ? new Date(snap.capturedAt).toLocaleDateString() : "—"}</span>
                          </div>
                          {snap.changeDetected && (
                            <Badge variant="destructive" className="text-xs">Change detected</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Change detection + before/after slider */}
            {snapshots.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4 text-primary" /> Satellite Image Diff & Change Detection
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChangeDetectionDisplay snapshots={snapshots} />
                </CardContent>
              </Card>
            )}

            {snapshots.length === 0 && (
              <Card>
                <CardContent className="py-10 text-center">
                  <Satellite className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">No satellite snapshots captured yet.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Marketing */}
          <TabsContent value="marketing" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Marketing-Ready Photos</p>
                  <p className="text-2xl font-bold text-green-600">
                    {summary.photos?.filter((p: any) => p.analysis?.isUsableForMarketing).length ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">Landscape Type</p>
                  <p className="text-lg font-semibold capitalize">
                    {summary.photos?.[0]?.analysis?.landscapeType ?? "—"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground mb-1">AI Confidence</p>
                  <p className="text-2xl font-bold">
                    {summary.photos?.[0]?.analysis?.confidence
                      ? `${Math.round(summary.photos[0].analysis.confidence * 100)}%`
                      : "—"}
                  </p>
                </CardContent>
              </Card>
            </div>
            {summary.generatedDescription && (
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> AI-Generated Listing Description</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <p className="text-sm leading-relaxed">{summary.generatedDescription}</p>
                  <Button variant="outline" size="sm" className="mt-3"
                    onClick={() => navigator.clipboard.writeText(summary.generatedDescription)}>
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

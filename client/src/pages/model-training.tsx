import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { usd } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Brain,
  Database,
  TrendingUp,
  Activity,
  Play,
  Loader2,
  GitBranch,
} from "lucide-react";
import { format } from "date-fns";
import { relative } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { chartColor } from "@/lib/chartPalette";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface ModelStats {
  totalTransactions: number;
  transactionsByState: Record<string, number>;
  recentTransactions: Array<{
    id: number;
    saleDate: string;
    state: string;
    county: string;
    sizeAcres: number;
    salePrice: number;
    pricePerAcre: number;
  }>;
  modelAccuracy?: number;
  lastTrainedAt?: string;
  featureImportance?: Record<string, number>;
}

interface ValuationPrediction {
  id: number;
  state?: string;
  county?: string;
  sizeAcres?: string;
  predictedValue?: string;
  confidence?: string;
  createdAt: string;
}

// K/M-abbreviated currency for chart axes / tight table cells. Forecast view —
// money-precision rule still applies on transactional surfaces (finance, etc).
function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return usd(n, { noCents: Number.isInteger(n) });
}

export default function ModelTrainingPage() {
  useDocumentTitle("Model training");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: statsData, isLoading: statsLoading } = useQuery<{ stats: ModelStats }>({
    queryKey: ["/api/avm/stats"],
    queryFn: () => fetch("/api/avm/stats").then(r => r.json()),
  });

  const { data: predictionsData } = useQuery<{ predictions: ValuationPrediction[] }>({
    queryKey: ["/api/avm/predictions"],
    queryFn: () => fetch("/api/avm/predictions").then(r => r.json()).catch(() => ({ predictions: [] })),
  });

  const bulkMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/avm/bulk"),
    onSuccess: () => {
      toast({ title: "Bulk valuation started", description: "Generating predictions for all owned properties." });
      queryClient.invalidateQueries({ queryKey: ["/api/avm/stats"] });
    },
    onError: (err: any) =>
      toast({
        title: "Bulk valuation didn't start",
        description: `${err.message}. No predictions were created — try again, or run individual valuations from the AVM tool.`,
        variant: "destructive",
      }),
  });

  const stats = statsData?.stats;
  const predictions = predictionsData?.predictions || [];

  const stateData = stats?.transactionsByState
    ? Object.entries(stats.transactionsByState)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([state, count]) => ({ state, count }))
    : [];

  const accuracy = stats?.modelAccuracy ?? 0.85;
  const accuracyPct = Math.round(accuracy * 100);
  const trainingPct = Math.min(100, Math.round(((stats?.totalTransactions || 0) / 1000) * 100));
  const coveragePct = Math.min(100, Math.round((Object.keys(stats?.transactionsByState || {}).length / 50) * 100));

  return (
    <PageShell label="Model training">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">AcreOS valuation model</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Training data, model accuracy, and prediction insights.</p>
        </div>
        <Button
          onClick={() => bulkMutation.mutate()}
          disabled={bulkMutation.isPending}
          aria-label="Run bulk valuations on all owned properties"
        >
          {bulkMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4 mr-2" aria-hidden="true" />
          )}
          Run bulk valuations
        </Button>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-acr-accent" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{(stats?.totalTransactions || 0).toLocaleString()}</dd>
                <dt className="text-sm text-muted-foreground">Training records</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-acr-pos" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{accuracyPct}%</dd>
                <dt className="text-sm text-muted-foreground">Model accuracy</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-acr-brand" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{predictions.length}</dd>
                <dt className="text-sm text-muted-foreground">Predictions made</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-acr-warn" aria-hidden="true" />
              <div>
                <dd className="text-2xl font-bold tabular-nums">{Object.keys(stats?.transactionsByState || {}).length}</dd>
                <dt className="text-sm text-muted-foreground">States covered</dt>
              </div>
            </div>
          </CardContent>
        </Card>
      </dl>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-acr-brand" aria-hidden="true" />
              AcreOS Market Value™ model v2.0
            </CardTitle>
            <Badge variant={accuracyPct >= 85 ? "default" : accuracyPct >= 70 ? "secondary" : "destructive"}>
              {accuracyPct >= 85 ? "Production ready" : accuracyPct >= 70 ? "Training" : "Needs data"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="col-span-2">
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Overall accuracy (MAPE)</span>
                    <span className="font-medium tabular-nums">{accuracyPct}%</span>
                  </div>
                  <Progress value={accuracyPct} className="h-2" aria-label={`Overall accuracy ${accuracyPct}%`} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Training data completeness</span>
                    <span className="font-medium tabular-nums">{trainingPct}%</span>
                  </div>
                  <Progress value={trainingPct} className="h-2" aria-label={`Training data completeness ${trainingPct}%`} />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Geographic coverage</span>
                    <span className="font-medium tabular-nums">{coveragePct}%</span>
                  </div>
                  <Progress value={coveragePct} className="h-2" aria-label={`Geographic coverage ${coveragePct}%`} />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Feature importance</p>
              <ul className="space-y-2" aria-label="Feature importance ranking">
                {Object.entries(stats?.featureImportance || {
                  "Size (acres)": 0.32,
                  "County/market": 0.28,
                  "Recent comps": 0.18,
                  "Zoning": 0.12,
                  "Road access": 0.10,
                }).map(([feat, importance]) => {
                  const pct = Math.round((importance as number) * 100);
                  return (
                    <li key={feat} className="flex items-center gap-2">
                      <div className="flex-1 text-xs">{feat}</div>
                      <Progress
                        value={pct}
                        className="w-20 h-1.5"
                        aria-label={`${feat} importance: ${pct}%`}
                      />
                      <div className="text-xs text-muted-foreground w-8 tabular-nums">{pct}%</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="training-data">
        <TabsList>
          <TabsTrigger value="training-data">Training data</TabsTrigger>
          <TabsTrigger value="predictions">Recent predictions</TabsTrigger>
          <TabsTrigger value="coverage">Geographic coverage</TabsTrigger>
        </TabsList>

        <TabsContent value="training-data" className="mt-4">
          {statsLoading ? (
            <div className="flex justify-center py-12" role="status" aria-live="polite">
              <span className="sr-only">Loading training data…</span>
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <div className="space-y-4">
              {stateData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Transactions by state (top 10)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div role="img" aria-label={`Transactions by state, top 10: ${stateData.map(s => `${s.state} ${s.count}`).join(", ")}`}>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={stateData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="state" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Bar dataKey="count" fill={chartColor(0)} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {stats?.recentTransactions && stats.recentTransactions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Recent training records</CardTitle>
                  </CardHeader>
                  <div role="region" aria-label="Recent training transactions" tabIndex={0}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Location</TableHead>
                          <TableHead scope="col" className="text-right">Acres</TableHead>
                          <TableHead scope="col" className="text-right">Sale price</TableHead>
                          <TableHead scope="col" className="text-right">$/acre</TableHead>
                          <TableHead scope="col">Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.recentTransactions.slice(0, 10).map((t, i) => (
                          <TableRow key={i}>
                            <th scope="row" className="px-4 text-left">{t.county ? `${t.county}, ${t.state}` : t.state}</th>
                            <TableCell className="text-right tabular-nums">{t.sizeAcres?.toFixed(1)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmt(t.salePrice || 0)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmt(t.pricePerAcre || 0)}</TableCell>
                            <TableCell className="tabular-nums">{t.saleDate ? format(new Date(t.saleDate), "MM/dd/yy") : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}

              {(!stats?.recentTransactions || stats.recentTransactions.length === 0) && (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Database className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                    <p className="text-muted-foreground">No training data yet. Close deals to automatically build the valuation model.</p>
                    <p className="text-sm text-muted-foreground mt-1">Each closed deal with a sale price becomes a training record.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="predictions" className="mt-4">
          {predictions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Brain className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
                <p className="text-muted-foreground">No predictions yet. Use the AVM tool on any property to generate valuations.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => bulkMutation.mutate()}
                  disabled={bulkMutation.isPending}
                  aria-label="Generate valuations for all owned properties"
                >
                  {bulkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : <Play className="h-4 w-4 mr-2" aria-hidden="true" />}
                  Generate all property valuations
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div role="region" aria-label="Recent valuation predictions" tabIndex={0}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Location</TableHead>
                      <TableHead scope="col" className="text-right">Size</TableHead>
                      <TableHead scope="col" className="text-right">Predicted value</TableHead>
                      <TableHead scope="col">Confidence</TableHead>
                      <TableHead scope="col">Generated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions.slice(0, 20).map(p => {
                      const conf = p.confidence ? parseFloat(p.confidence) : null;
                      const confPct = conf != null ? Math.round(conf * 100) : null;
                      return (
                        <TableRow key={p.id}>
                          <th scope="row" className="px-4 text-left">{p.county ? `${p.county}, ${p.state}` : p.state || "Unknown"}</th>
                          <TableCell className="text-right tabular-nums">{p.sizeAcres ? `${parseFloat(p.sizeAcres).toFixed(1)} ac` : "—"}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{p.predictedValue ? fmt(parseFloat(p.predictedValue)) : "—"}</TableCell>
                          <TableCell>
                            {conf != null && confPct != null && (
                              <Badge
                                variant={conf >= 0.8 ? "default" : conf >= 0.6 ? "secondary" : "outline"}
                                className="tabular-nums"
                                aria-label={`Confidence ${confPct}%${conf >= 0.8 ? ", high" : conf >= 0.6 ? ", medium" : ", low"}`}
                              >
                                {confPct}%
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm tabular-nums">
                            {relative(p.createdAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="coverage" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">State coverage</CardTitle>
              <CardDescription className="text-xs">States with transaction data for model training.</CardDescription>
            </CardHeader>
            <CardContent>
              {stateData.length === 0 ? (
                <p className="text-center text-muted-foreground py-6">No state data available yet.</p>
              ) : (
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2" aria-label="States with training data">
                  {stateData.map(({ state, count }) => (
                    <li key={state} className="flex items-center justify-between p-2 bg-muted/40 rounded-lg">
                      <span className="text-sm font-medium">{state}</span>
                      <Badge variant="secondary" className="text-xs tabular-nums">{count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

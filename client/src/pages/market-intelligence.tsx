import { useId, useState, type FormEvent } from "react";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, RadarChart, PolarGrid, PolarAngleAxis, Radar } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { Globe, TrendingUp, ArrowUpRight, ArrowDownRight, Plus, Search, Star, Target } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";

function HealthBadge({ score }: { score: number }) {
  if (score >= 70) return <StatusBadge status="success" label={`Strong ${score}`} />;
  if (score >= 50) return <StatusBadge status="warning" label={`Moderate ${score}`} />;
  return <StatusBadge status="error" label={`Weak ${score}`} />;
}

function TrendArrow({ direction }: { direction: string }) {
  if (direction === "up") return <ArrowUpRight className="w-4 h-4 text-acr-pos" aria-hidden="true" />;
  if (direction === "down") return <ArrowDownRight className="w-4 h-4 text-acr-neg" aria-hidden="true" />;
  return null;
}

const reassurance = "Your inputs are still on this device — try again.";

export default function MarketIntelligencePage() {
  useDocumentTitle("Market intelligence");
  const { toast } = useToast();
  const [county, setCounty] = useState("");
  const [state, setState] = useState("");
  const [submitted, setSubmitted] = useState<{ county: string; state: string } | null>(null);
  const [compareList, setCompareList] = useState<{ county: string; state: string }[]>([]);

  const countyId = useId();
  const stateId = useId();

  const {
    data: analysisData,
    isLoading: analysisLoading,
    isError: analysisIsError,
    error: analysisError,
    refetch: refetchAnalysis,
    isRefetching: analysisRefetching,
  } = useQuery({
    queryKey: ["/api/market-intelligence/analyze", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(`/api/market-intelligence/analyze?county=${encodeURIComponent(submitted!.county)}&state=${encodeURIComponent(submitted!.state)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to analyze market");
      return res.json();
    },
  });

  const { data: trendsData } = useQuery({
    queryKey: ["/api/market-intelligence/trends", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(`/api/market-intelligence/trends?county=${encodeURIComponent(submitted!.county)}&state=${encodeURIComponent(submitted!.state)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch price trends");
      return res.json();
    },
  });

  const { data: growthData } = useQuery({
    queryKey: ["/api/market-intelligence/growth-indicators", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(`/api/market-intelligence/growth-indicators?county=${encodeURIComponent(submitted!.county)}&state=${encodeURIComponent(submitted!.state)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch growth indicators");
      return res.json();
    },
  });

  const compareMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/market-intelligence/compare", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markets: compareList }),
      });
      return res.json();
    },
    onError: (err: any) =>
      toast({ title: "Couldn't compare markets", description: `${err.message}. ${reassurance}`, variant: "destructive" }),
  });

  const analysis = analysisData?.analysis;
  const trends = trendsData?.trends;
  const growth = growthData?.indicators;

  const radarData = growth && analysis ? [
    { dimension: "Price growth", score: Math.min(100, Math.max(0, 50 + (analysis.yoyChange ?? 0) * 5)) },
    { dimension: "Market health", score: analysis.healthScore ?? 50 },
    { dimension: "Population", score: growth.populationGrowth ?? 50 },
    { dimension: "Employment", score: growth.employmentRate ?? 50 },
    { dimension: "Infrastructure", score: growth.infrastructureScore ?? 50 },
    { dimension: "Recreation", score: growth.recreationalDemand ?? 50 },
    { dimension: "Development", score: growth.developmentPressure ?? 50 },
  ] : [];

  const overallScore = radarData.length > 0
    ? Math.round(radarData.reduce((s, d) => s + d.score, 0) / radarData.length)
    : null;

  const investmentGrade = overallScore !== null
    ? overallScore >= 75 ? { label: "A — Prime", color: "text-acr-pos bg-acr-pos-soft border-acr-pos-soft" }
    : overallScore >= 60 ? { label: "B — Strong", color: "text-primary bg-primary/10 border-primary/20" }
    : overallScore >= 45 ? { label: "C — Moderate", color: "text-acr-warn bg-acr-warn-soft border-acr-warn-soft" }
    : { label: "D — Weak", color: "text-acr-neg bg-acr-neg-soft border-acr-neg-soft" }
    : null;

  const priceHistory = trends?.historicalPrices?.map((p: any) => ({
    month: p.month, price: p.pricePerAcre,
  })) ?? [];

  const growthIndicators = growth ? [
    { name: "Population", value: growth.populationGrowth ?? 0 },
    { name: "Employment", value: growth.employmentRate ?? 0 },
    { name: "Infrastructure", value: growth.infrastructureScore ?? 0 },
    { name: "Recreation", value: growth.recreationalDemand ?? 0 },
    { name: "Development", value: growth.developmentPressure ?? 0 },
  ] : [];

  function handleAnalyze(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (county && state) setSubmitted({ county, state });
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <DisclaimerBanner type="avm" />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe className="w-7 h-7 text-primary" aria-hidden="true" /> Market intelligence
        </h1>
        <p className="text-muted-foreground mt-1">
          Deep market analysis, price-trend forecasting, and multi-market comparison
        </p>
      </div>

      {/* Market Search */}
      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleAnalyze} className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <Label htmlFor={countyId} className="text-xs">County</Label>
              <Input
                id={countyId}
                placeholder="Travis"
                value={county}
                onChange={e => setCounty(e.target.value)}
                autoCapitalize="words"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="w-24">
              <Label htmlFor={stateId} className="text-xs">State</Label>
              <Input
                id={stateId}
                placeholder="TX"
                maxLength={2}
                value={state}
                onChange={e => setState(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <Button type="submit" disabled={!county || !state}>
              <Search className="w-4 h-4 mr-1" aria-hidden="true" /> Analyze
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (county && state) setCompareList(l => [...l, { county, state }]);
              }}
              disabled={!county || !state}
            >
              <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Compare
            </Button>
          </form>
          {compareList.length > 0 && (
            <div className="mt-3">
              <ul className="flex gap-2 flex-wrap list-none p-0 m-0" aria-label="Markets queued for comparison">
                {compareList.map((m, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setCompareList(l => l.filter((_, j) => j !== i))}
                      aria-label={`Remove ${m.county}, ${m.state} from comparison`}
                      className="inline-flex"
                    >
                      <Badge variant="secondary" className="cursor-pointer">
                        {m.county}, {m.state} ×
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => compareMutation.mutate()}
                disabled={compareMutation.isPending}
              >
                Run comparison
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!submitted && !compareMutation.data && (
        <Card>
          <EmptyState
            icon={Globe}
            headline="Analyze your first market"
            subtitle="Enter a county and state above to get price trends, growth factors, and an investment-grade score for that market."
            cta={{
              label: "Pick a county",
              onClick: () => document.getElementById(countyId)?.focus(),
              "data-testid": "market-intel-pick-county",
            }}
            actionIcon={Search}
            testId="market-intel-empty-state"
          />
        </Card>
      )}

      {analysisLoading && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading market analysis">
          {/* Shaped like the analysis that replaces it: tab bar, the
              investment-grade hero card, then the four KPI cards. */}
          <Skeleton className="h-10 w-80 max-w-full" announce announceText="Analyzing market" />
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-28" announce={false} />
                  <Skeleton className="h-9 w-24" announce={false} />
                  <Skeleton className="h-5 w-32 rounded-full" announce={false} />
                </div>
                <Skeleton className="w-32 h-32 rounded-full" announce={false} />
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-3 w-24" announce={false} />
                  <Skeleton className="h-7 w-20" announce={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {analysisIsError && !analysisLoading && (
        <QueryErrorState
          error={analysisError as Error}
          onRetry={() => refetchAnalysis()}
          isRetrying={analysisRefetching}
          title="Couldn't analyze that market"
        />
      )}

      {analysis && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trends">Price trends</TabsTrigger>
            <TabsTrigger value="growth">Growth factors</TabsTrigger>
            {radarData.length > 0 && <TabsTrigger value="radar">Investment radar</TabsTrigger>}
            {compareMutation.data && <TabsTrigger value="compare">Comparison</TabsTrigger>}
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            {investmentGrade && overallScore !== null && (
              <Card className="border-primary/20 bg-gradient-to-br from-card to-muted/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Investment grade</p>
                      <p className="text-3xl font-black mt-1 tabular-nums">{overallScore}<span className="text-lg text-muted-foreground">/100</span></p>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border mt-1 ${investmentGrade.color}`}
                        role="status"
                        aria-label={`Investment grade ${investmentGrade.label}, score ${overallScore} of 100`}
                      >
                        <Star className="w-3 h-3" aria-hidden="true" />
                        {investmentGrade.label}
                      </span>
                    </div>
                    {radarData.length > 0 && (
                      <div
                        className="w-32 h-32"
                        role="img"
                        aria-label={`Investment radar summary: ${radarData.map(d => `${d.dimension} ${d.score}`).join(", ")}`}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={radarData}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 7 }} />
                            <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={1.5} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="p-4">
                <dt className="text-xs text-muted-foreground">Market health</dt>
                <dd className="mt-1">
                  <HealthBadge score={analysis.healthScore ?? 0} />
                </dd>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <dt className="text-xs text-muted-foreground">Avg price per acre</dt>
                <dd className="text-xl font-bold tabular-nums">{usd(analysis.avgPricePerAcre ?? 0, { noCents: true })}</dd>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <dt className="text-xs text-muted-foreground">YoY change</dt>
                <dd className="flex items-center gap-1">
                  <TrendArrow direction={(analysis.yoyChange ?? 0) >= 0 ? "up" : "down"} />
                  <span className={`text-xl font-bold tabular-nums ${(analysis.yoyChange ?? 0) >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                    {(analysis.yoyChange ?? 0).toFixed(1)}%
                  </span>
                </dd>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <dt className="text-xs text-muted-foreground">Days on market</dt>
                <dd className="text-xl font-bold tabular-nums">{analysis.avgDaysOnMarket ?? "—"}</dd>
              </CardContent></Card>
            </dl>

            {analysis.summary && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm leading-relaxed">{analysis.summary}</p>
                </CardContent>
              </Card>
            )}

            {analysis.keyInsights?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Key insights</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <ul className="space-y-2 list-none p-0 m-0">
                    {analysis.keyInsights.map((insight: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <TrendingUp className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Price Trends */}
          <TabsContent value="trends" className="mt-4 space-y-4">
            {priceHistory.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-sm">Price per acre — 12-month trend</CardTitle></CardHeader>
                <CardContent>
                  <div
                    role="img"
                    aria-label={`Price per acre trend over ${priceHistory.length} months, from ${usd(priceHistory[0]?.price, { noCents: true })} to ${usd(priceHistory[priceHistory.length - 1]?.price, { noCents: true })}`}
                  >
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={priceHistory}>
                        <defs>
                          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={v => usd(v, { noCents: true })} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: any) => [`${usd(Number(v), { noCents: true })}/acre`]} />
                        <Area type="monotone" dataKey="price" stroke="hsl(var(--primary))" fill="url(#priceFill)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  icon={TrendingUp}
                  headline="No price history for this market"
                  subtitle="This county doesn't have enough recorded transactions for a 12-month trend yet. Try a neighboring county for a read on the area."
                  cta={{
                    label: "Analyze another market",
                    onClick: () => document.getElementById(countyId)?.focus(),
                    "data-testid": "market-intel-trends-retry",
                  }}
                  actionIcon={Search}
                  testId="market-intel-trends-empty"
                />
              </Card>
            )}

            {trends?.forecast && (
              <dl className="grid grid-cols-3 gap-3">
                {[{ label: "3-month", key: "threeMonth" }, { label: "6-month", key: "sixMonth" }, { label: "12-month", key: "twelveMonth" }].map(({ label, key }) => (
                  <Card key={key}><CardContent className="p-4">
                    <dt className="text-xs text-muted-foreground">{label} forecast</dt>
                    <dd className="flex items-center gap-1 mt-1">
                      <TrendArrow direction={(trends.forecast[key] ?? 0) >= 0 ? "up" : "down"} />
                      <span className={`text-lg font-bold tabular-nums ${(trends.forecast[key] ?? 0) >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>
                        {(trends.forecast[key] ?? 0).toFixed(1)}%
                      </span>
                    </dd>
                  </CardContent></Card>
                ))}
              </dl>
            )}
          </TabsContent>

          {/* Growth Factors */}
          <TabsContent value="growth" className="mt-4 space-y-4">
            {growthIndicators.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-sm">Growth factor scores</CardTitle></CardHeader>
                <CardContent>
                  <div
                    role="img"
                    aria-label={`Growth factor scores: ${growthIndicators.map(g => `${g.name} ${g.value}`).join(", ")}`}
                  >
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={growthIndicators} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                        <Tooltip />
                        <ReferenceLine x={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                        <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  icon={Target}
                  headline="No growth data for this market"
                  subtitle="Growth indicators (population, employment, infrastructure) aren't available for this county yet. Try a nearby market."
                  cta={{
                    label: "Analyze another market",
                    onClick: () => document.getElementById(countyId)?.focus(),
                    "data-testid": "market-intel-growth-retry",
                  }}
                  actionIcon={Search}
                  testId="market-intel-growth-empty"
                />
              </Card>
            )}

            {growth?.leadingIndicators?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Leading indicators</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <ul className="space-y-0 list-none p-0 m-0">
                    {growth.leadingIndicators.map((ind: any, i: number) => (
                      <li key={i} className="flex items-center justify-between py-1 border-b last:border-0">
                        <span className="text-sm">{ind.name}</span>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={ind.score ?? 50}
                            className="w-20 h-1.5"
                            role="progressbar"
                            aria-valuenow={ind.score ?? 50}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${ind.name} score`}
                          />
                          <span className="text-xs font-medium w-8 text-right tabular-nums">{ind.score ?? "—"}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Investment Radar */}
          {radarData.length > 0 && (
            <TabsContent value="radar" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" aria-hidden="true" />
                    Investment profile radar — {submitted?.county}, {submitted?.state}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    <div
                      className="w-full md:w-72 h-72"
                      role="img"
                      aria-label={`Radar chart of investment profile across ${radarData.length} dimensions: ${radarData.map(d => `${d.dimension} ${d.score}`).join(", ")}`}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid />
                          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11 }} />
                          <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} strokeWidth={2} />
                          <Tooltip formatter={(v: any) => [`${v}/100`, "Score"]} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="flex-1 space-y-2 list-none p-0 m-0 w-full" aria-label="Radar dimension scores">
                      {radarData.map((d) => (
                        <li key={d.dimension}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">{d.dimension}</span>
                            <span className="font-semibold tabular-nums">{d.score}</span>
                          </div>
                          <div
                            className="w-full bg-muted rounded-full h-1.5 overflow-hidden"
                            role="progressbar"
                            aria-valuenow={d.score}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${d.dimension} score`}
                          >
                            <div
                              className={`h-full rounded-full ${d.score >= 70 ? "bg-acr-pos" : d.score >= 50 ? "bg-acr-warn" : "bg-acr-neg"}`}
                              style={{ width: `${d.score}%` }}
                            />
                          </div>
                        </li>
                      ))}
                      {overallScore !== null && investmentGrade && (
                        <li className={`mt-4 rounded-card border p-3 ${investmentGrade.color}`} aria-label={`Overall investment score ${overallScore} of 100, grade ${investmentGrade.label}`}>
                          <p className="text-xs font-semibold tabular-nums">Overall investment score: {overallScore}/100</p>
                          <p className="text-xs mt-0.5">{investmentGrade.label}</p>
                        </li>
                      )}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Comparison */}
          {compareMutation.data && (
            <TabsContent value="compare" className="mt-4">
              <ul className="space-y-3 list-none p-0 m-0" aria-label="Market comparison results">
                {(compareMutation.data.comparison?.markets ?? []).map((m: any, i: number) => (
                  <li key={i}>
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold">{m.county}, {m.state}</span>
                          <HealthBadge score={m.healthScore ?? 0} />
                        </div>
                        <dl className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <dt className="text-muted-foreground">Price per acre</dt>
                            <dd className="font-bold tabular-nums">{usd(m.avgPricePerAcre ?? 0, { noCents: true })}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">YoY</dt>
                            <dd className={`font-bold tabular-nums ${(m.yoyChange ?? 0) >= 0 ? "text-acr-pos" : "text-acr-neg"}`}>{(m.yoyChange ?? 0).toFixed(1)}%</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Rank</dt>
                            <dd className="font-bold tabular-nums">#{i + 1}</dd>
                          </div>
                        </dl>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

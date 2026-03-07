import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { Globe, TrendingUp, TrendingDown, BarChart2, Plus, Search, ArrowUpRight, ArrowDownRight } from "lucide-react";

function HealthBadge({ score }: { score: number }) {
  if (score >= 70) return <Badge className="bg-green-100 text-green-800">Strong {score}</Badge>;
  if (score >= 50) return <Badge className="bg-yellow-100 text-yellow-800">Moderate {score}</Badge>;
  return <Badge className="bg-red-100 text-red-800">Weak {score}</Badge>;
}

function TrendArrow({ direction }: { direction: string }) {
  if (direction === "up") return <ArrowUpRight className="w-4 h-4 text-green-500" />;
  if (direction === "down") return <ArrowDownRight className="w-4 h-4 text-red-500" />;
  return null;
}

export default function MarketIntelligencePage() {
  const { toast } = useToast();
  const [county, setCounty] = useState("");
  const [state, setState] = useState("");
  const [submitted, setSubmitted] = useState<{ county: string; state: string } | null>(null);
  const [compareList, setCompareList] = useState<{ county: string; state: string }[]>([]);

  const { data: analysisData, isLoading: analysisLoading } = useQuery({
    queryKey: ["/api/market-intelligence/analyze", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(`/api/market-intelligence/analyze?county=${encodeURIComponent(submitted!.county)}&state=${encodeURIComponent(submitted!.state)}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: trendsData } = useQuery({
    queryKey: ["/api/market-intelligence/trends", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(`/api/market-intelligence/trends?county=${encodeURIComponent(submitted!.county)}&state=${encodeURIComponent(submitted!.state)}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: growthData } = useQuery({
    queryKey: ["/api/market-intelligence/growth-indicators", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const res = await fetch(`/api/market-intelligence/growth-indicators?county=${encodeURIComponent(submitted!.county)}&state=${encodeURIComponent(submitted!.state)}`, { credentials: "include" });
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
  });

  const analysis = analysisData?.analysis;
  const trends = trendsData?.trends;
  const growth = growthData?.indicators;

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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Globe className="w-7 h-7 text-primary" /> Market Intelligence
        </h1>
        <p className="text-muted-foreground mt-1">
          Deep market analysis, price trend forecasting, and multi-market comparison
        </p>
      </div>

      {/* Market Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label className="text-xs">County</Label>
              <Input placeholder="Travis" value={county} onChange={e => setCounty(e.target.value)} />
            </div>
            <div className="w-24">
              <Label className="text-xs">State</Label>
              <Input placeholder="TX" maxLength={2} value={state} onChange={e => setState(e.target.value.toUpperCase())} />
            </div>
            <Button onClick={() => { if (county && state) setSubmitted({ county, state }); }}
              disabled={!county || !state}>
              <Search className="w-4 h-4 mr-1" /> Analyze
            </Button>
            <Button variant="outline" onClick={() => {
              if (county && state) setCompareList(l => [...l, { county, state }]);
            }} disabled={!county || !state}>
              <Plus className="w-4 h-4 mr-1" /> Compare
            </Button>
          </div>
          {compareList.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {compareList.map((m, i) => (
                <Badge key={i} variant="secondary" className="cursor-pointer"
                  onClick={() => setCompareList(l => l.filter((_, j) => j !== i))}>
                  {m.county}, {m.state} ×
                </Badge>
              ))}
              <Button size="sm" variant="outline" onClick={() => compareMutation.mutate()}>
                Run Comparison
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!submitted && !compareMutation.data && (
        <Card>
          <CardContent className="py-16 text-center">
            <Globe className="w-14 h-14 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Enter a county and state to analyze market conditions.</p>
          </CardContent>
        </Card>
      )}

      {analysisLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted/50 rounded-lg animate-pulse" />)}
        </div>
      )}

      {analysis && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trends">Price Trends</TabsTrigger>
            <TabsTrigger value="growth">Growth Factors</TabsTrigger>
            {compareMutation.data && <TabsTrigger value="compare">Comparison</TabsTrigger>}
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Market Health</p>
                <div className="mt-1">
                  <HealthBadge score={analysis.healthScore ?? 0} />
                </div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Avg Price/Acre</p>
                <p className="text-xl font-bold">${(analysis.avgPricePerAcre ?? 0).toLocaleString()}</p>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">YoY Change</p>
                <div className="flex items-center gap-1">
                  <TrendArrow direction={(analysis.yoyChange ?? 0) >= 0 ? "up" : "down"} />
                  <p className={`text-xl font-bold ${(analysis.yoyChange ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {(analysis.yoyChange ?? 0).toFixed(1)}%
                  </p>
                </div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Days on Market</p>
                <p className="text-xl font-bold">{analysis.avgDaysOnMarket ?? "—"}</p>
              </CardContent></Card>
            </div>

            {analysis.summary && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm leading-relaxed">{analysis.summary}</p>
                </CardContent>
              </Card>
            )}

            {analysis.keyInsights?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Key Insights</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {analysis.keyInsights.map((insight: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <TrendingUp className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      {insight}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Price Trends */}
          <TabsContent value="trends" className="mt-4 space-y-4">
            {priceHistory.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-sm">Price per Acre — 12 Month Trend</CardTitle></CardHeader>
                <CardContent>
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
                      <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString()}/acre`]} />
                      <Area type="monotone" dataKey="price" stroke="hsl(var(--primary))" fill="url(#priceFill)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="py-10 text-center text-muted-foreground">No price history available.</CardContent></Card>
            )}

            {trends?.forecast && (
              <div className="grid grid-cols-3 gap-3">
                {[{ label: "3-Month", key: "threeMonth" }, { label: "6-Month", key: "sixMonth" }, { label: "12-Month", key: "twelveMonth" }].map(({ label, key }) => (
                  <Card key={key}><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{label} Forecast</p>
                    <div className="flex items-center gap-1 mt-1">
                      <TrendArrow direction={(trends.forecast[key] ?? 0) >= 0 ? "up" : "down"} />
                      <p className={`text-lg font-bold ${(trends.forecast[key] ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {(trends.forecast[key] ?? 0).toFixed(1)}%
                      </p>
                    </div>
                  </CardContent></Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Growth Factors */}
          <TabsContent value="growth" className="mt-4 space-y-4">
            {growthIndicators.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-sm">Growth Factor Scores</CardTitle></CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="py-10 text-center text-muted-foreground">No growth data available.</CardContent></Card>
            )}

            {growth?.leadingIndicators?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Leading Indicators</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {growth.leadingIndicators.map((ind: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b last:border-0">
                      <span className="text-sm">{ind.name}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={ind.score ?? 50} className="w-20 h-1.5" />
                        <span className="text-xs font-medium w-8 text-right">{ind.score ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Comparison */}
          {compareMutation.data && (
            <TabsContent value="compare" className="mt-4">
              <div className="space-y-3">
                {(compareMutation.data.comparison?.markets ?? []).map((m: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold">{m.county}, {m.state}</span>
                        <HealthBadge score={m.healthScore ?? 0} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><p className="text-muted-foreground">Price/Acre</p><p className="font-bold">${(m.avgPricePerAcre ?? 0).toLocaleString()}</p></div>
                        <div><p className="text-muted-foreground">YoY</p><p className={`font-bold ${(m.yoyChange ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{(m.yoyChange ?? 0).toFixed(1)}%</p></div>
                        <div><p className="text-muted-foreground">Rank</p><p className="font-bold">#{i + 1}</p></div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

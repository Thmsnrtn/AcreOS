import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, TrendingDown, Search, Target, Calendar, BarChart2,
  ArrowUpRight, ArrowDownRight, Clock, AlertCircle, CheckCircle2,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────────────────

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

// ─── Types ──────────────────────────────────────────────────────────────────

interface PredictionPoint {
  label: string;
  actual?: number;
  predicted: number;
  lower: number;
  upper: number;
}

interface OpportunityWindow {
  type: "buy" | "sell" | "hold";
  startDate: string;
  endDate: string;
  confidence: number;
  reasoning: string;
  estimatedGain?: number;
}

interface MomentumScore {
  score: number;
  direction: "bullish" | "bearish" | "neutral";
  drivers: string[];
}

interface AccuracyMetrics {
  mape: number;
  rmse: number;
  r2: number;
  sampleSize: number;
  periodMonths: number;
}

// ─── Helper components ────────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "bullish")
    return <Badge className="bg-green-100 text-green-800">Bullish</Badge>;
  if (direction === "bearish")
    return <Badge className="bg-red-100 text-red-800">Bearish</Badge>;
  return <Badge variant="secondary">Neutral</Badge>;
}

function WindowBadge({ type }: { type: "buy" | "sell" | "hold" }) {
  const map: Record<string, string> = {
    buy: "bg-blue-100 text-blue-800",
    sell: "bg-orange-100 text-orange-800",
    hold: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${map[type]}`}>
      {type}
    </span>
  );
}

function formatPrice(val: number) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toLocaleString()}`;
}

// ─── Skeleton ────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-muted/50 rounded animate-pulse ${className}`} />;
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const { toast } = useToast();
  const [county, setCounty] = useState("");
  const [state, setState] = useState("");
  const [horizon, setHorizon] = useState<"30" | "90" | "365">("90");
  const [submitted, setSubmitted] = useState<{ county: string; state: string; horizon: string } | null>(null);

  function handleSearch() {
    if (!county.trim() || !state) {
      toast({ title: "Please enter a county and select a state", variant: "destructive" });
      return;
    }
    setSubmitted({ county: county.trim(), state, horizon });
  }

  // ── Price trajectory ──────────────────────────────────────────────────

  const { data: trajectoryData, isLoading: trajectoryLoading } = useQuery({
    queryKey: ["/api/predictions/trajectory", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const params = new URLSearchParams({
        county: submitted!.county,
        state: submitted!.state,
        horizon: submitted!.horizon,
      });
      const res = await fetch(`/api/predictions/trajectory?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  // ── Opportunity windows ──────────────────────────────────────────────

  const { data: windowsData, isLoading: windowsLoading } = useQuery({
    queryKey: ["/api/predictions/windows", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const params = new URLSearchParams({
        county: submitted!.county,
        state: submitted!.state,
      });
      const res = await fetch(`/api/predictions/windows?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  // ── Momentum ─────────────────────────────────────────────────────────

  const { data: momentumData, isLoading: momentumLoading } = useQuery({
    queryKey: ["/api/predictions/momentum", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const params = new URLSearchParams({
        county: submitted!.county,
        state: submitted!.state,
      });
      const res = await fetch(`/api/predictions/momentum?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  // ── Accuracy metrics ─────────────────────────────────────────────────

  const { data: accuracyData, isLoading: accuracyLoading } = useQuery({
    queryKey: ["/api/predictions/accuracy", submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const params = new URLSearchParams({
        county: submitted!.county,
        state: submitted!.state,
      });
      const res = await fetch(`/api/predictions/accuracy?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const trajectory: PredictionPoint[] = trajectoryData?.trajectory ?? [];
  const windows: OpportunityWindow[] = windowsData?.windows ?? [];
  const momentum: MomentumScore | null = momentumData?.momentum ?? null;
  const accuracy: AccuracyMetrics | null = accuracyData?.accuracy ?? null;

  const isLoading = trajectoryLoading || windowsLoading || momentumLoading || accuracyLoading;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TrendingUp className="w-7 h-7 text-primary" /> Market Predictions
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered price trajectory forecasts with buy/sell window indicators per county
        </p>
      </div>

      {/* Search Panel */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs">County</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="e.g. Travis"
                  value={county}
                  onChange={e => setCounty(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                />
              </div>
            </div>
            <div className="w-32">
              <Label className="text-xs">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger><SelectValue placeholder="State" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label className="text-xs">Forecast Horizon</Label>
              <Select value={horizon} onValueChange={v => setHorizon(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">365 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSearch} disabled={isLoading && !!submitted}>
              {isLoading && submitted ? "Loading…" : "Analyze"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!submitted && (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground font-medium">Enter a county and state to see price predictions</p>
            <p className="text-sm text-muted-foreground mt-1">
              Get 30, 90, or 365-day price trajectories with confidence intervals
            </p>
          </CardContent>
        </Card>
      )}

      {submitted && (
        <>
          {/* Momentum + Accuracy Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Market Momentum */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" /> Market Momentum Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                {momentumLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : momentum ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-4xl font-bold">{momentum.score}</span>
                      <div>
                        <DirectionBadge direction={momentum.direction} />
                        <p className="text-xs text-muted-foreground mt-1">out of 100</p>
                      </div>
                    </div>
                    <Progress value={momentum.score} className="h-2" />
                    <div className="space-y-1">
                      {momentum.drivers.map((d, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                          {d}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No momentum data available</p>
                )}
              </CardContent>
            </Card>

            {/* Prediction Accuracy */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary" /> Prediction Accuracy Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {accuracyLoading ? (
                  <div className="space-y-2">
                    {[1,2,3,4].map(i => <Skeleton key={i} className="h-6 w-full" />)}
                  </div>
                ) : accuracy ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded p-2 text-center">
                      <p className="text-xs text-muted-foreground">MAPE</p>
                      <p className="text-lg font-bold">{accuracy.mape.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Mean Abs. % Error</p>
                    </div>
                    <div className="bg-muted/50 rounded p-2 text-center">
                      <p className="text-xs text-muted-foreground">R²</p>
                      <p className="text-lg font-bold">{accuracy.r2.toFixed(3)}</p>
                      <p className="text-xs text-muted-foreground">Fit Quality</p>
                    </div>
                    <div className="bg-muted/50 rounded p-2 text-center">
                      <p className="text-xs text-muted-foreground">RMSE</p>
                      <p className="text-lg font-bold">{formatPrice(accuracy.rmse)}</p>
                      <p className="text-xs text-muted-foreground">Root Mean Sq. Err</p>
                    </div>
                    <div className="bg-muted/50 rounded p-2 text-center">
                      <p className="text-xs text-muted-foreground">Sample</p>
                      <p className="text-lg font-bold">{accuracy.sampleSize.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{accuracy.periodMonths}mo history</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No accuracy data available</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Price Trajectory Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary" />
                Price Trajectory — {submitted.county}, {submitted.state} ({submitted.horizon}-day forecast)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trajectoryLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : trajectory.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                    <p>No trajectory data available for this county</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trajectory} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatPrice} tick={{ fontSize: 11 }} width={70} />
                    <Tooltip
                      formatter={(val: number, name: string) => [formatPrice(val), name]}
                      labelClassName="text-xs font-medium"
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="actual"
                      name="Actual"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted"
                      name="Predicted"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="upper"
                      name="Upper CI"
                      stroke="#d1d5db"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="lower"
                      name="Lower CI"
                      stroke="#d1d5db"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Opportunity Windows */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Opportunity Windows
              </CardTitle>
            </CardHeader>
            <CardContent>
              {windowsLoading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : windows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No opportunity windows identified for this period
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {windows.map((w, i) => (
                    <div key={i} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <WindowBadge type={w.type} />
                        <span className="text-xs text-muted-foreground">
                          {Math.round(w.confidence * 100)}% confidence
                        </span>
                      </div>
                      <Progress value={w.confidence * 100} className="h-1.5" />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {new Date(w.startDate).toLocaleDateString()} – {new Date(w.endDate).toLocaleDateString()}
                      </div>
                      <p className="text-xs">{w.reasoning}</p>
                      {w.estimatedGain != null && (
                        <div className="flex items-center gap-1 text-xs font-medium text-green-600">
                          {w.estimatedGain >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          Est. {w.estimatedGain >= 0 ? "+" : ""}{w.estimatedGain.toFixed(1)}% gain
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

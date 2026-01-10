import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, MapPin, Activity, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw, Globe, Layers } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface GisHealthStats {
  totalEndpoints: number;
  activeEndpoints: number;
  recentlyVerified: number;
  statesCovered: number;
  countiesCovered: number;
}

interface ValidationResult {
  id: number;
  state: string;
  county: string;
  baseUrl: string;
  status: "online" | "offline" | "error" | "timeout";
  responseTime?: number;
  featureCount?: number;
  error?: string;
  lastChecked: Date;
}

interface ValidationSummary {
  total: number;
  online: number;
  offline: number;
  errors: number;
  timeouts: number;
  avgResponseTime: number;
  byState: Record<string, { total: number; online: number }>;
  testedAt: Date;
}

export function GisHealthDashboard() {
  const [selectedState, setSelectedState] = useState<string>("all");
  const [lastValidation, setLastValidation] = useState<{
    results: ValidationResult[];
    summary: ValidationSummary;
  } | null>(null);

  const { data: healthStats, isLoading: statsLoading } = useQuery<GisHealthStats>({
    queryKey: ["/api/founder/gis-health"],
  });

  const { data: endpoints } = useQuery<{
    total: number;
    byState: Record<string, any[]>;
    states: string[];
  }>({
    queryKey: ["/api/founder/gis-endpoints"],
  });

  const sampleValidation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/founder/gis-validate-sample", { sampleSize: 20 });
      return response.json();
    },
    onSuccess: (data) => {
      setLastValidation(data);
      queryClient.invalidateQueries({ queryKey: ["/api/founder/gis-health"] });
    },
  });

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const fullValidation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/founder/gis-validate-all", { 
        stateFilter: selectedState !== "all" ? selectedState : undefined,
        maxConcurrent: 10,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.async && data.jobId) {
        setActiveJobId(data.jobId);
        return;
      }
      setLastValidation(data);
      queryClient.invalidateQueries({ queryKey: ["/api/founder/gis-health"] });
    },
  });

  const { data: activeJob } = useQuery<{
    id: string;
    status: string;
    progress: { completed: number; total: number; percent: number };
    summary?: ValidationSummary;
    results?: ValidationResult[];
    resultsPreview?: ValidationResult[];
  }>({
    queryKey: ["/api/founder/gis-job", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "completed" || data?.status === "failed") {
        if (data.summary) {
          setLastValidation({ 
            results: data.results || data.resultsPreview || [], 
            summary: data.summary 
          });
          setActiveJobId(null);
        }
        return false;
      }
      return 2000;
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "online": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "offline": return <XCircle className="h-4 w-4 text-red-500" />;
      case "error": return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case "timeout": return <Clock className="h-4 w-4 text-yellow-500" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "online": return <Badge variant="default" className="bg-green-500/10 text-green-600 border-green-500/20">Online</Badge>;
      case "offline": return <Badge variant="destructive">Offline</Badge>;
      case "error": return <Badge variant="default" className="bg-orange-500/10 text-orange-600 border-orange-500/20">Error</Badge>;
      case "timeout": return <Badge variant="default" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Timeout</Badge>;
      default: return null;
    }
  };

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const onlinePercent = lastValidation 
    ? Math.round((lastValidation.summary.online / lastValidation.summary.total) * 100)
    : healthStats?.recentlyVerified && healthStats?.activeEndpoints
      ? Math.round((healthStats.recentlyVerified / healthStats.activeEndpoints) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">GIS Data Source Health</h2>
          <p className="text-muted-foreground">
            Monitor county GIS endpoint connectivity and response times
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedState} onValueChange={setSelectedState}>
            <SelectTrigger className="w-40" data-testid="select-state-filter">
              <SelectValue placeholder="All States" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {endpoints?.states.map((state) => (
                <SelectItem key={state} value={state}>{state}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sampleValidation.mutate()}
            disabled={sampleValidation.isPending}
            data-testid="button-sample-validation"
          >
            {sampleValidation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Activity className="h-4 w-4 mr-2" />
            )}
            Quick Test (20)
          </Button>
          <Button
            onClick={() => fullValidation.mutate()}
            disabled={fullValidation.isPending || !!activeJobId}
            data-testid="button-full-validation"
          >
            {fullValidation.isPending || activeJobId ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Globe className="h-4 w-4 mr-2" />
            )}
            {selectedState !== "all" ? `Test ${selectedState}` : "Test All"}
          </Button>
        </div>
      </div>

      {activeJob && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                <span className="font-medium">Validation in progress...</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {activeJob.progress.completed} / {activeJob.progress.total} endpoints
              </span>
            </div>
            <Progress value={activeJob.progress.percent} className="h-2" />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Endpoints</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-endpoints">
              {healthStats?.totalEndpoints || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {healthStats?.activeEndpoints || 0} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">States Covered</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-states-covered">
              {healthStats?.statesCovered || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              of 50 US states
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Counties Covered</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-counties-covered">
              {healthStats?.countiesCovered || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              county GIS portals
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recently Verified</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-recently-verified">
              {healthStats?.recentlyVerified || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              in last 24 hours
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Health Score</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-health-score">
              {onlinePercent}%
            </div>
            <Progress value={onlinePercent} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {lastValidation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Last Validation Results
            </CardTitle>
            <CardDescription>
              Tested {lastValidation.summary.total} endpoints on {new Date(lastValidation.summary.testedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-5 mb-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <div className="text-lg font-semibold">{lastValidation.summary.online}</div>
                  <div className="text-xs text-muted-foreground">Online</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <div>
                  <div className="text-lg font-semibold">{lastValidation.summary.offline}</div>
                  <div className="text-xs text-muted-foreground">Offline</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <div>
                  <div className="text-lg font-semibold">{lastValidation.summary.errors}</div>
                  <div className="text-xs text-muted-foreground">Errors</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-yellow-500" />
                <div>
                  <div className="text-lg font-semibold">{lastValidation.summary.timeouts}</div>
                  <div className="text-xs text-muted-foreground">Timeouts</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <div>
                  <div className="text-lg font-semibold">{lastValidation.summary.avgResponseTime}ms</div>
                  <div className="text-xs text-muted-foreground">Avg Response</div>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>County</TableHead>
                    <TableHead>Response Time</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead className="max-w-xs">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lastValidation.results.slice(0, 50).map((result, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{getStatusBadge(result.status)}</TableCell>
                      <TableCell className="font-medium">{result.state}</TableCell>
                      <TableCell>{result.county}</TableCell>
                      <TableCell>{result.responseTime}ms</TableCell>
                      <TableCell>
                        {result.featureCount !== undefined 
                          ? result.featureCount.toLocaleString()
                          : "-"
                        }
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {result.error || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {lastValidation.results.length > 50 && (
                <div className="p-3 text-center text-sm text-muted-foreground border-t">
                  Showing 50 of {lastValidation.results.length} results
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {endpoints && Object.keys(endpoints.byState).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Endpoints by State</CardTitle>
            <CardDescription>
              Distribution of county GIS endpoints across states
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(endpoints.byState)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([state, stateEndpoints]) => (
                  <Badge 
                    key={state} 
                    variant="outline"
                    className="cursor-pointer hover-elevate"
                    onClick={() => setSelectedState(state)}
                    data-testid={`badge-state-${state}`}
                  >
                    {state}: {(stateEndpoints as any[]).length}
                  </Badge>
                ))
              }
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

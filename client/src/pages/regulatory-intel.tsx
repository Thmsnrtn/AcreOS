/**
 * T103 — Regulatory Intelligence Page
 *
 * Browse state regulatory profiles for land investing:
 *   - Risk scores, seller financing rules, water rights
 *   - Active regulatory alerts with severity indicators
 *   - Due diligence checklist generator per state
 *   - Quick deal risk assessment
 */
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Droplets,
  DollarSign,
  FileText,
  MapPin,
  ChevronRight,
  Loader2,
  TrendingUp,
  BarChart3,
  History,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface StateProfile {
  code: string;
  name: string;
  sellerFinancingRisk: "low" | "medium" | "high";
  riskScore: number;
  waterRightsSystem: "prior_appropriation" | "riparian" | "hybrid";
  agriculturalExemptionAvailable: boolean;
  subdivisionRegulations: "strict" | "moderate" | "permissive";
}

interface StateFullProfile extends StateProfile {
  titleInsuranceRequired: boolean;
  deedTypes: string[];
  todDeedAvailable: boolean;
  contractForDeedAllowed: boolean;
  contractForDeedRestrictions?: string;
  doddFrankExemptions: string[];
  usuryCeiling?: number;
  droughtRisk: string;
  requiredDisclosures: string[];
  environmentalDisclosureRequired: boolean;
  propertyTaxRate?: string;
  transferTax?: string;
  percolationTestRequired: boolean;
  practitionerNotes: string;
  lastReviewed: string;
}

interface RegulatoryAlert {
  id: string;
  state?: string;
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  effectiveDate: string;
  category: string;
  source?: string;
}

interface ChecklistItem {
  category: string;
  item: string;
  required: boolean;
  description: string;
}

interface Checklist {
  state: string;
  stateName: string;
  items: ChecklistItem[];
}

interface RiskAssessment {
  riskLevel: "low" | "medium" | "high";
  flags: string[];
  recommendations: string[];
}

// ─── Compliance Score Gauge ───────────────────────────────────────────────────

function ComplianceScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? 'text-acr-pos' : score >= 60 ? 'text-acr-warn' : 'text-acr-neg';
  const tier = score >= 80 ? 'strong' : score >= 60 ? 'moderate' : 'weak';
  const circumference = 2 * Math.PI * 36;
  const dashoffset = circumference - (score / 100) * circumference;

  return (
    <div
      className="flex flex-col items-center gap-1"
      role="img"
      aria-label={`Compliance score ${score} of 100 (${tier})`}
    >
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90" aria-hidden="true">
          <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
          <circle
            cx="40" cy="40" r="36" fill="none" strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            strokeLinecap="round"
            className={score >= 80 ? 'stroke-acr-pos' : score >= 60 ? 'stroke-acr-warn' : 'stroke-acr-neg'}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-bold tabular-nums ${color}`} aria-hidden="true">{score}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Compliance score</p>
    </div>
  );
}

// ─── Regulatory Change History Timeline ──────────────────────────────────────

function RegulatoryChangeTimeline({ alerts }: { alerts: RegulatoryAlert[] }) {
  const sorted = [...alerts].sort((a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime());

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-primary" aria-hidden="true" /> Regulatory change history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No regulatory changes recorded.</p>
        ) : (
          <ol className="relative pl-4 border-l-2 border-muted space-y-4 list-none p-0 pl-4 m-0" aria-label="Regulatory changes in reverse chronological order">
            {sorted.map((alert) => {
              const Icon = SEVERITY_ICONS[alert.severity];
              return (
                <li key={alert.id} className="relative">
                  <div
                    className={`absolute -left-[1.1rem] top-0.5 w-3 h-3 rounded-full border-2 border-background ${
                      alert.severity === 'critical' ? 'bg-acr-neg' : alert.severity === 'warning' ? 'bg-acr-warn' : 'bg-acr-accent'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="text-xs text-muted-foreground mb-0.5">
                    <time dateTime={alert.effectiveDate}>{alert.effectiveDate}</time>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${SEVERITY_COLORS[alert.severity].split(" ")[0]}`} aria-label={`Severity: ${alert.severity}`} />
                    <div>
                      <span className="text-sm font-medium">{alert.title}</span>
                      {alert.state && <Badge variant="outline" className="ml-1.5 text-xs" aria-label={`State: ${alert.state}`}>{alert.state}</Badge>}
                      <p className="text-xs text-muted-foreground mt-0.5">{alert.summary}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Portfolio Impact Analysis ────────────────────────────────────────────────

function PortfolioImpactSection({ alerts, states }: { alerts: RegulatoryAlert[]; states: StateProfile[] }) {
  // Synthetic portfolio impact: count alerts per state, estimate affected properties
  const stateAlertMap: Record<string, number> = {};
  for (const alert of alerts) {
    if (alert.state) stateAlertMap[alert.state] = (stateAlertMap[alert.state] ?? 0) + 1;
  }

  const impactedStates = Object.entries(stateAlertMap).map(([code, count]) => {
    const profile = states?.find(s => s.code === code);
    return { code, name: profile?.name ?? code, alertCount: count, riskScore: profile?.riskScore ?? 5 };
  }).sort((a, b) => b.alertCount - a.alertCount);

  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" aria-hidden="true" /> Portfolio impact analysis
        </CardTitle>
        <CardDescription>How regulatory changes may affect your portfolio&apos;s operating states</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-acr-neg-soft dark:bg-acr-neg-soft/20 rounded-card p-2">
            <dd className="text-xl font-bold text-acr-neg tabular-nums">{criticalCount}</dd>
            <dt className="text-xs text-muted-foreground">Critical alerts</dt>
          </div>
          <div className="bg-acr-warn-soft dark:bg-acr-warn-soft/20 rounded-card p-2">
            <dd className="text-xl font-bold text-acr-warn tabular-nums">{warningCount}</dd>
            <dt className="text-xs text-muted-foreground">Warnings</dt>
          </div>
          <div className="bg-acr-accent dark:bg-acr-accent/20 rounded-card p-2">
            <dd className="text-xl font-bold text-acr-accent tabular-nums">{impactedStates.length}</dd>
            <dt className="text-xs text-muted-foreground">States impacted</dt>
          </div>
        </dl>

        {impactedStates.length > 0 ? (
          <div className="space-y-2">
            <p id="impact-by-state-label" className="text-xs font-medium text-muted-foreground">Impact by state</p>
            <ul className="space-y-2 list-none p-0 m-0" aria-labelledby="impact-by-state-label">
              {impactedStates.map(s => {
                const pct = Math.min(100, s.alertCount * 25);
                return (
                  <li key={s.code} className="flex items-center gap-3 text-sm">
                    <Badge variant="outline" className="w-8 text-center text-xs" aria-label={`State: ${s.code}`}>{s.code}</Badge>
                    <span className="flex-1 text-muted-foreground">{s.name}</span>
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-20 bg-muted rounded-full h-1.5"
                        role="progressbar"
                        aria-valuenow={s.alertCount}
                        aria-valuemin={0}
                        aria-valuemax={4}
                        aria-label={`${s.name} alert intensity`}
                      >
                        <div className="bg-acr-neg h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {s.alertCount} alert{s.alertCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">No state-specific alerts impacting your portfolio.</p>
        )}

        <div className="border-t pt-3 flex items-center justify-between gap-4">
          <div className="flex-1">
            <p className="text-xs font-medium mb-1">Portfolio compliance score</p>
            <p className="text-xs text-muted-foreground">Aggregate compliance health based on alert severity and state profiles.</p>
          </div>
          <ComplianceScoreGauge score={Math.max(0, 100 - (criticalCount * 15) - (warningCount * 5))} />
        </div>
      </CardContent>
    </Card>
  );
}

const RISK_COLORS = {
  low: "text-acr-pos-soft-ink bg-acr-pos-soft dark:bg-acr-pos-soft/20",
  medium: "text-acr-warn-soft-ink bg-acr-warn-soft dark:bg-acr-warn-soft/20",
  high: "text-acr-neg-soft-ink bg-acr-neg-soft dark:bg-acr-neg-soft/20",
};

const SEVERITY_ICONS = {
  info: AlertCircle,
  warning: AlertTriangle,
  critical: XCircle,
};

const SEVERITY_COLORS = {
  info: "text-acr-accent border-acr-accent",
  warning: "text-acr-warn border-acr-warn-soft",
  critical: "text-acr-neg border-acr-neg-soft",
};

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${RISK_COLORS[risk]}`}
      aria-label={`Risk: ${risk}`}
    >
      {risk}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score <= 3 ? "bg-acr-pos" : score <= 6 ? "bg-acr-warn" : "bg-acr-neg";
  const tier = score <= 3 ? "low" : score <= 6 ? "moderate" : "high";
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-16 bg-muted rounded-full h-1.5"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-label={`Risk score ${score} of 10 (${tier})`}
      >
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">{score}/10</span>
    </div>
  );
}

export default function RegulatoryIntelPage() {
  useDocumentTitle("Regulatory intelligence");
  const { toast } = useToast();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState("");
  const [assessState, setAssessState] = useState("");
  const [assessOpts, setAssessOpts] = useState({
    sellerFinanced: false,
    acreage: "",
    nearWater: false,
    coastal: false,
  });
  const [assessment, setAssessment] = useState<RiskAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const checklistStateId = useId();
  const assessStateId = useId();
  const assessAcreageId = useId();
  const sellerFinancedId = useId();
  const nearWaterId = useId();
  const coastalId = useId();

  const {
    data: states,
    isLoading: statesLoading,
    isError: statesError,
    error: statesErr,
    refetch: refetchStates,
  } = useQuery<StateProfile[]>({
    queryKey: ["/api/regulatory/states"],
  });

  const {
    data: alerts,
    isError: alertsError,
    error: alertsErr,
    refetch: refetchAlerts,
  } = useQuery<RegulatoryAlert[]>({
    queryKey: ["/api/regulatory/alerts"],
  });

  const {
    data: stateDetail,
    isError: stateDetailError,
    error: stateDetailErr,
    refetch: refetchStateDetail,
  } = useQuery<StateFullProfile>({
    queryKey: ["/api/regulatory/states", selectedState],
    queryFn: () => fetch(`/api/regulatory/states/${selectedState}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedState,
  });

  const {
    data: checklist,
    isError: checklistError,
    error: checklistErr,
    refetch: refetchChecklist,
  } = useQuery<Checklist>({
    queryKey: ["/api/regulatory/checklist", checklistState],
    queryFn: () => fetch(`/api/regulatory/checklist/${checklistState}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!checklistState,
  });

  const handleAssess = async () => {
    if (!assessState) return;
    setAssessing(true);
    try {
      const res = await apiRequest("POST", "/api/regulatory/assess", {
        state: assessState,
        sellerFinanced: assessOpts.sellerFinanced,
        acreage: assessOpts.acreage ? parseFloat(assessOpts.acreage) : undefined,
        nearWater: assessOpts.nearWater,
        coastal: assessOpts.coastal,
      });
      const result: RiskAssessment = await res.json();
      setAssessment(result);
    } catch (err: any) {
      toast({
        title: "Couldn't assess risk",
        description: `${err?.message ?? "Network error"}. Your inputs are unchanged — try again.`,
        variant: "destructive",
      });
    } finally {
      setAssessing(false);
    }
  };

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];

  return (
    <PageShell label="Regulatory intelligence">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" aria-hidden="true" /> Regulatory intelligence
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          State-by-state regulatory profiles, alerts, and due-diligence checklists for land investing.
        </p>
      </div>

      {/* Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <div
          className="bg-acr-neg-soft dark:bg-acr-neg-soft/20 border border-acr-neg-soft dark:border-acr-neg-soft rounded-card p-4 space-y-1"
          role="alert"
        >
          <p className="flex items-center gap-2 text-acr-neg dark:text-acr-neg font-medium text-sm">
            <XCircle className="w-4 h-4" aria-hidden="true" />
            <span className="tabular-nums">{criticalAlerts.length}</span> critical alert{criticalAlerts.length > 1 ? "s" : ""}
          </p>
          <ul className="space-y-0.5 list-none p-0 m-0" aria-label="Critical regulatory alerts">
            {criticalAlerts.map(a => (
              <li key={a.id} className="text-sm text-acr-neg dark:text-acr-neg">
                {a.state && <strong>[{a.state}]</strong>} {a.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="states">
        <TabsList className="flex-wrap">
          <TabsTrigger value="states"><MapPin className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> State profiles</TabsTrigger>
          <TabsTrigger value="alerts">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Alerts
            {alerts && alerts.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs tabular-nums" aria-label={`${alerts.length} active alerts`}>{alerts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="checklist"><FileText className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> DD checklist</TabsTrigger>
          <TabsTrigger value="assess"><Shield className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Risk assessment</TabsTrigger>
          <TabsTrigger value="history"><History className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Change history</TabsTrigger>
          <TabsTrigger value="impact"><BarChart3 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Portfolio impact</TabsTrigger>
        </TabsList>

        {/* State Profiles */}
        <TabsContent value="states" className="space-y-4">
          {statesError ? (
            <QueryErrorState
              error={statesErr as Error | null}
              onRetry={() => refetchStates()}
              testId="regulatory-states-error"
            />
          ) : statesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" role="status" aria-live="polite">
              <span className="sr-only">Loading state regulatory profiles…</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Skeleton announce={false} className="h-5 w-28" />
                      <Skeleton announce={false} className="h-4 w-16" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Skeleton announce={false} className="h-5 w-20" />
                      <Skeleton announce={false} className="h-5 w-24" />
                      <Skeleton announce={false} className="h-5 w-16" />
                    </div>
                    <Skeleton announce={false} className="h-3 w-20" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 list-none p-0 m-0" aria-label="State regulatory profiles">
              {states?.map((state) => (
                <li key={state.code}>
                <Dialog onOpenChange={(open) => { if (open) setSelectedState(state.code); }}>
                  <DialogTrigger asChild>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-semibold flex items-center gap-2">
                              <span className="text-lg font-bold text-primary">{state.code}</span>
                              <span className="text-sm text-muted-foreground">{state.name}</span>
                            </div>
                          </div>
                          <ScoreBar score={state.riskScore} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <RiskBadge risk={state.sellerFinancingRisk} />
                          <Badge variant="outline" className="text-xs">
                            <Droplets className="w-3 h-3 mr-1" />
                            {state.waterRightsSystem.replace(/_/g, " ")}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {state.subdivisionRegulations}
                          </Badge>
                          {state.agriculturalExemptionAvailable && (
                            <Badge variant="secondary" className="text-xs">Ag Exempt</Badge>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                          <span>View details</span>
                          <ChevronRight className="w-3 h-3" />
                        </div>
                      </CardContent>
                    </Card>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{state.name} ({state.code}) — regulatory profile</DialogTitle>
                    </DialogHeader>
                    {stateDetailError ? (
                      <QueryErrorState
                        error={stateDetailErr as Error | null}
                        onRetry={() => refetchStateDetail()}
                        compact
                        testId="regulatory-state-detail-error"
                      />
                    ) : !stateDetail ? (
                      <div className="space-y-4" role="status" aria-live="polite">
                        <span className="sr-only">Loading state details…</span>
                        <div className="grid grid-cols-2 gap-3">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="space-y-1.5">
                              <Skeleton announce={false} className="h-3 w-20" />
                              <Skeleton announce={false} className="h-4 w-24" />
                            </div>
                          ))}
                        </div>
                        <Skeleton announce={false} className="h-16 w-full" />
                      </div>
                    ) : (
                      <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div><span className="text-muted-foreground">Risk Score</span><br /><ScoreBar score={stateDetail.riskScore} /></div>
                          <div><span className="text-muted-foreground">SF Risk</span><br /><RiskBadge risk={stateDetail.sellerFinancingRisk} /></div>
                          <div><span className="text-muted-foreground">Property Tax</span><br /><span className="font-medium">{stateDetail.propertyTaxRate ?? "—"}</span></div>
                          <div><span className="text-muted-foreground">Transfer Tax</span><br /><span className="font-medium">{stateDetail.transferTax ?? "—"}</span></div>
                          <div><span className="text-muted-foreground">Water Rights</span><br /><span className="font-medium">{stateDetail.waterRightsSystem.replace(/_/g, " ")}</span></div>
                          <div><span className="text-muted-foreground">Usury Ceiling</span><br /><span className="font-medium">{stateDetail.usuryCeiling ? `${stateDetail.usuryCeiling}%` : "None"}</span></div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Deed Types</div>
                          <div className="flex flex-wrap gap-1">
                            {stateDetail.deedTypes.map(d => <Badge key={d} variant="outline" className="text-xs">{d.replace(/_/g, " ")}</Badge>)}
                            {stateDetail.todDeedAvailable && <Badge variant="secondary" className="text-xs">TOD Deed ✓</Badge>}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Required Disclosures</div>
                          <div className="flex flex-wrap gap-1">
                            {stateDetail.requiredDisclosures.map(d => <Badge key={d} variant="outline" className="text-xs">{d.replace(/_/g, " ")}</Badge>)}
                          </div>
                        </div>

                        <div className="bg-muted/40 rounded-card p-3">
                          <div className="text-xs font-medium mb-1">Practitioner Notes</div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{stateDetail.practitionerNotes}</p>
                        </div>

                        <div className="text-xs text-muted-foreground">Last reviewed: {stateDetail.lastReviewed}</div>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Alerts */}
        <TabsContent value="alerts" className="space-y-3">
          {alertsError ? (
            <QueryErrorState
              error={alertsErr as Error | null}
              onRetry={() => refetchAlerts()}
              testId="regulatory-alerts-error"
            />
          ) : !alerts?.length ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm" role="status">
                No active regulatory alerts.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3 list-none p-0 m-0" aria-label="Active regulatory alerts">
              {alerts.map((alert) => {
                const Icon = SEVERITY_ICONS[alert.severity];
                return (
                  <li key={alert.id}>
                    <Card className={`border ${SEVERITY_COLORS[alert.severity]}`}>
                      <CardContent className="pt-4 flex gap-3">
                        <Icon
                          className={`w-5 h-5 shrink-0 mt-0.5 ${SEVERITY_COLORS[alert.severity].split(" ")[0]}`}
                          aria-label={`Severity: ${alert.severity}`}
                        />
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{alert.title}</span>
                            {alert.state && <Badge variant="outline" className="text-xs" aria-label={`State: ${alert.state}`}>{alert.state}</Badge>}
                            <Badge variant="outline" className="text-xs" aria-label={`Category: ${alert.category.replace(/_/g, " ")}`}>{alert.category.replace(/_/g, " ")}</Badge>
                            <span className="text-xs text-muted-foreground ml-auto">
                              Effective <time dateTime={alert.effectiveDate}>{alert.effectiveDate}</time>
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">{alert.summary}</p>
                          {alert.source && <p className="text-xs text-muted-foreground">Source: {alert.source}</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        {/* Due Diligence Checklist */}
        <TabsContent value="checklist" className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="space-y-1.5">
              <Label htmlFor={checklistStateId}>Select state</Label>
              <Select value={checklistState} onValueChange={setChecklistState}>
                <SelectTrigger id={checklistStateId} className="w-48">
                  <SelectValue placeholder="Choose a state…" />
                </SelectTrigger>
                <SelectContent>
                  {states?.map(s => (
                    <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {checklistError && (
            <QueryErrorState
              error={checklistErr as Error | null}
              onRetry={() => refetchChecklist()}
              compact
              testId="regulatory-checklist-error"
            />
          )}

          {checklist && !checklistError && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{checklist.stateName} due-diligence checklist</h2>
                <Badge variant="secondary" className="tabular-nums" aria-label={`${checklist.items.length} checklist items`}>
                  {checklist.items.length} items
                </Badge>
              </div>
              {Object.entries(
                checklist.items.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
                  (acc[item.category] ??= []).push(item);
                  return acc;
                }, {})
              ).map(([category, items]) => (
                <Card key={category}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{category}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 list-none p-0 m-0" aria-label={`${category} checklist items`}>
                      {items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm">
                          {item.required ? (
                            <CheckCircle2 className="w-4 h-4 text-acr-neg shrink-0 mt-0.5" aria-label="Required" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 shrink-0 mt-0.5" role="img" aria-label="Optional" />
                          )}
                          <div>
                            <div className="font-medium flex items-center gap-1.5">
                              {item.item}
                              {item.required && <Badge variant="destructive" className="text-xs" aria-label="Required item">Required</Badge>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Risk Assessment */}
        <TabsContent value="assess" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick deal risk assessment</CardTitle>
              <CardDescription>Enter deal details to get a regulatory risk assessment.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => { e.preventDefault(); if (assessState && !assessing) handleAssess(); }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={assessStateId}>State</Label>
                    <Select value={assessState} onValueChange={setAssessState}>
                      <SelectTrigger id={assessStateId}>
                        <SelectValue placeholder="Select state…" />
                      </SelectTrigger>
                      <SelectContent>
                        {states?.map(s => (
                          <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={assessAcreageId}>Acreage</Label>
                    <Input
                      id={assessAcreageId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="e.g. 40"
                      value={assessOpts.acreage}
                      onChange={(e) => setAssessOpts(o => ({ ...o, acreage: e.target.value }))}
                    />
                  </div>
                </div>

                <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <legend className="sr-only">Deal characteristics</legend>
                  {[
                    { key: "sellerFinanced", label: "Seller financed", id: sellerFinancedId },
                    { key: "nearWater", label: "Near water or creek", id: nearWaterId },
                    { key: "coastal", label: "Coastal property", id: coastalId },
                  ].map(({ key, label, id }) => (
                    <div key={key} className="flex items-center gap-2">
                      <Switch
                        id={id}
                        checked={(assessOpts as any)[key]}
                        onCheckedChange={(v) => setAssessOpts(o => ({ ...o, [key]: v }))}
                      />
                      <Label htmlFor={id} className="cursor-pointer">{label}</Label>
                    </div>
                  ))}
                </fieldset>

                <Button type="submit" disabled={!assessState || assessing}>
                  {assessing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Analyzing…</> : "Assess risk"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {assessment && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Risk assessment result
                  <RiskBadge risk={assessment.riskLevel} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assessment.flags.length > 0 && (
                  <div>
                    <p id="risk-flags-label" className="text-xs font-medium text-muted-foreground mb-2">Risk flags</p>
                    <ul className="space-y-1.5 list-none p-0 m-0" aria-labelledby="risk-flags-label">
                      {assessment.flags.map((flag, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {assessment.recommendations.length > 0 && (
                  <div>
                    <p id="recommendations-label" className="text-xs font-medium text-muted-foreground mb-2">Recommendations</p>
                    <ul className="space-y-1.5 list-none p-0 m-0" aria-labelledby="recommendations-label">
                      {assessment.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-acr-pos shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {assessment.flags.length === 0 && assessment.recommendations.length === 0 && (
                  <p className="text-sm text-muted-foreground" role="status">No significant regulatory flags identified for this deal.</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Change History */}
        <TabsContent value="history" className="space-y-4">
          {alertsError ? (
            <QueryErrorState
              error={alertsErr as Error | null}
              onRetry={() => refetchAlerts()}
              compact
              testId="regulatory-history-error"
            />
          ) : (
            <RegulatoryChangeTimeline alerts={alerts ?? []} />
          )}
        </TabsContent>

        {/* Portfolio Impact */}
        <TabsContent value="impact" className="space-y-4">
          {alertsError ? (
            <QueryErrorState
              error={alertsErr as Error | null}
              onRetry={() => refetchAlerts()}
              compact
              testId="regulatory-impact-error"
            />
          ) : (
            <PortfolioImpactSection alerts={alerts ?? []} states={states ?? []} />
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

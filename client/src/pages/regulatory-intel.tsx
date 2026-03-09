/**
 * T103 — Regulatory Intelligence Page
 *
 * Browse state regulatory profiles for land investing:
 *   - Risk scores, seller financing rules, water rights
 *   - Active regulatory alerts with severity indicators
 *   - Due diligence checklist generator per state
 *   - Quick deal risk assessment
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const RISK_COLORS = {
  low: "text-green-600 bg-green-50 dark:bg-green-900/20",
  medium: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20",
  high: "text-red-600 bg-red-50 dark:bg-red-900/20",
};

const SEVERITY_ICONS = {
  info: AlertCircle,
  warning: AlertTriangle,
  critical: XCircle,
};

const SEVERITY_COLORS = {
  info: "text-blue-600 border-blue-200",
  warning: "text-yellow-600 border-yellow-200",
  critical: "text-red-600 border-red-200",
};

function RiskBadge({ risk }: { risk: "low" | "medium" | "high" }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${RISK_COLORS[risk]}`}>
      {risk}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score <= 3 ? "bg-green-500" : score <= 6 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 bg-muted rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{score}/10</span>
    </div>
  );
}

export default function RegulatoryIntelPage() {
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

  const { data: states, isLoading: statesLoading } = useQuery<StateProfile[]>({
    queryKey: ["/api/regulatory/states"],
  });

  const { data: alerts } = useQuery<RegulatoryAlert[]>({
    queryKey: ["/api/regulatory/alerts"],
  });

  const { data: stateDetail } = useQuery<StateFullProfile>({
    queryKey: ["/api/regulatory/states", selectedState],
    queryFn: () => fetch(`/api/regulatory/states/${selectedState}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedState,
  });

  const { data: checklist } = useQuery<Checklist>({
    queryKey: ["/api/regulatory/checklist", checklistState],
    queryFn: () => fetch(`/api/regulatory/checklist/${checklistState}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!checklistState,
  });

  const handleAssess = async () => {
    if (!assessState) return;
    setAssessing(true);
    try {
      const result = await apiRequest("/api/regulatory/assess", {
        method: "POST",
        body: JSON.stringify({
          state: assessState,
          sellerFinanced: assessOpts.sellerFinanced,
          acreage: assessOpts.acreage ? parseFloat(assessOpts.acreage) : undefined,
          nearWater: assessOpts.nearWater,
          coastal: assessOpts.coastal,
        }),
      });
      setAssessment(result);
    } finally {
      setAssessing(false);
    }
  };

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" /> Regulatory Intelligence
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          State-by-state regulatory profiles, alerts, and due diligence checklists for land investing.
        </p>
      </div>

      {/* Critical Alerts Banner */}
      {criticalAlerts.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 space-y-1">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium text-sm">
            <XCircle className="w-4 h-4" /> {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? "s" : ""}
          </div>
          {criticalAlerts.map(a => (
            <div key={a.id} className="text-sm text-red-600 dark:text-red-400">
              {a.state && <strong>[{a.state}]</strong>} {a.title}
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="states">
        <TabsList>
          <TabsTrigger value="states"><MapPin className="w-3.5 h-3.5 mr-1.5" /> State Profiles</TabsTrigger>
          <TabsTrigger value="alerts">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Alerts
            {alerts && alerts.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-xs">{alerts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="checklist"><FileText className="w-3.5 h-3.5 mr-1.5" /> DD Checklist</TabsTrigger>
          <TabsTrigger value="assess"><Shield className="w-3.5 h-3.5 mr-1.5" /> Risk Assessment</TabsTrigger>
        </TabsList>

        {/* State Profiles */}
        <TabsContent value="states" className="space-y-4">
          {statesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {states?.map((state) => (
                <Dialog key={state.code} onOpenChange={(open) => { if (open) setSelectedState(state.code); }}>
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
                            {state.waterRightsSystem.replace("_", " ")}
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
                      <DialogTitle>{state.name} ({state.code}) — Regulatory Profile</DialogTitle>
                    </DialogHeader>
                    {!stateDetail ? (
                      <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
                    ) : (
                      <div className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div><span className="text-muted-foreground">Risk Score</span><br /><ScoreBar score={stateDetail.riskScore} /></div>
                          <div><span className="text-muted-foreground">SF Risk</span><br /><RiskBadge risk={stateDetail.sellerFinancingRisk} /></div>
                          <div><span className="text-muted-foreground">Property Tax</span><br /><span className="font-medium">{stateDetail.propertyTaxRate ?? "—"}</span></div>
                          <div><span className="text-muted-foreground">Transfer Tax</span><br /><span className="font-medium">{stateDetail.transferTax ?? "—"}</span></div>
                          <div><span className="text-muted-foreground">Water Rights</span><br /><span className="font-medium">{stateDetail.waterRightsSystem.replace("_", " ")}</span></div>
                          <div><span className="text-muted-foreground">Usury Ceiling</span><br /><span className="font-medium">{stateDetail.usuryCeiling ? `${stateDetail.usuryCeiling}%` : "None"}</span></div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Deed Types</div>
                          <div className="flex flex-wrap gap-1">
                            {stateDetail.deedTypes.map(d => <Badge key={d} variant="outline" className="text-xs">{d.replace("_", " ")}</Badge>)}
                            {stateDetail.todDeedAvailable && <Badge variant="secondary" className="text-xs">TOD Deed ✓</Badge>}
                          </div>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Required Disclosures</div>
                          <div className="flex flex-wrap gap-1">
                            {stateDetail.requiredDisclosures.map(d => <Badge key={d} variant="outline" className="text-xs">{d.replace(/_/g, " ")}</Badge>)}
                          </div>
                        </div>

                        <div className="bg-muted/40 rounded-lg p-3">
                          <div className="text-xs font-medium mb-1">Practitioner Notes</div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{stateDetail.practitionerNotes}</p>
                        </div>

                        <div className="text-xs text-muted-foreground">Last reviewed: {stateDetail.lastReviewed}</div>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Alerts */}
        <TabsContent value="alerts" className="space-y-3">
          {!alerts?.length ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No active regulatory alerts.
              </CardContent>
            </Card>
          ) : (
            alerts.map((alert) => {
              const Icon = SEVERITY_ICONS[alert.severity];
              return (
                <Card key={alert.id} className={`border ${SEVERITY_COLORS[alert.severity]}`}>
                  <CardContent className="pt-4 flex gap-3">
                    <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${SEVERITY_COLORS[alert.severity].split(" ")[0]}`} />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{alert.title}</span>
                        {alert.state && <Badge variant="outline" className="text-xs">{alert.state}</Badge>}
                        <Badge variant="outline" className="text-xs">{alert.category.replace("_", " ")}</Badge>
                        <span className="text-xs text-muted-foreground ml-auto">Effective {alert.effectiveDate}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{alert.summary}</p>
                      {alert.source && <p className="text-xs text-muted-foreground">Source: {alert.source}</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Due Diligence Checklist */}
        <TabsContent value="checklist" className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="space-y-1.5">
              <Label>Select State</Label>
              <Select value={checklistState} onValueChange={setChecklistState}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Choose a state..." />
                </SelectTrigger>
                <SelectContent>
                  {states?.map(s => (
                    <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {checklist && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">{checklist.stateName} Due Diligence Checklist</h2>
                <Badge variant="secondary">{checklist.items.length} items</Badge>
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
                  <CardContent className="space-y-2">
                    {items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-sm">
                        {item.required ? (
                          <CheckCircle2 className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-medium flex items-center gap-1.5">
                            {item.item}
                            {item.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>
                        </div>
                      </div>
                    ))}
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
              <CardTitle className="text-base">Quick Deal Risk Assessment</CardTitle>
              <CardDescription>Enter deal details to get a regulatory risk assessment.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Select value={assessState} onValueChange={setAssessState}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select state..." />
                    </SelectTrigger>
                    <SelectContent>
                      {states?.map(s => (
                        <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Acreage</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 40"
                    value={assessOpts.acreage}
                    onChange={(e) => setAssessOpts(o => ({ ...o, acreage: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { key: "sellerFinanced", label: "Seller Financed" },
                  { key: "nearWater", label: "Near Water/Creek" },
                  { key: "coastal", label: "Coastal Property" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      checked={(assessOpts as any)[key]}
                      onCheckedChange={(v) => setAssessOpts(o => ({ ...o, [key]: v }))}
                    />
                    <Label className="cursor-pointer">{label}</Label>
                  </div>
                ))}
              </div>

              <Button onClick={handleAssess} disabled={!assessState || assessing}>
                {assessing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing...</> : "Assess Risk"}
              </Button>
            </CardContent>
          </Card>

          {assessment && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Risk Assessment Result
                  <RiskBadge risk={assessment.riskLevel} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assessment.flags.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Risk Flags</div>
                    <div className="space-y-1.5">
                      {assessment.flags.map((flag, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
                          <span>{flag}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {assessment.recommendations.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Recommendations</div>
                    <div className="space-y-1.5">
                      {assessment.recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                          <span>{rec}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {assessment.flags.length === 0 && assessment.recommendations.length === 0 && (
                  <p className="text-sm text-muted-foreground">No significant regulatory flags identified for this deal.</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/**
 * Founder-only: the AI service catalogue, its quick actions and portfolio alerts.
 *
 * Reads /api/ai/portfolio/alerts; the quick actions post to
 * /api/ai/due-diligence/request, /api/ai/pricing/acquisition,
 * /api/ai/portfolio/monitor and /api/ai/compliance/rules. Moved here
 * 2026-09-04 from client/src/pages/command-center.tsx (the CUSTOMER's /ai
 * door) — see ./index.ts for why. Behaviour is unchanged: command-center.tsx
 * renders this behind `mainTab === "ai-ops" && isFounder`, exactly as before.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Target,
  Calculator,
  Search,
  FileText,
  Loader2,
  Zap,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  Brain,
  Play,
  GitBranch,
  Shield,
  BarChart3,
  UserCheck,
  Mail,
  Eye,
  AlertTriangle
} from "lucide-react";
import { relative, usd } from "@/lib/format";
import { LowBalanceAlert } from "@/components/low-balance-alert";

interface AIService {
  id: string;
  name: string;
  description: string;
  phase: number;
  icon: typeof Brain;
  endpoint: string;
}

interface PortfolioAlert {
  id: number;
  propertyId: number;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  status: string;
  createdAt: string;
}

const aiServices: AIService[] = [
  { id: "due-diligence", name: "Due Diligence", description: "Automated property research and analysis", phase: 3, icon: Search, endpoint: "/api/ai/due-diligence/request" },
  { id: "seller-intent", name: "Seller Intent", description: "Predict seller motivation and timing", phase: 3, icon: Target, endpoint: "/api/ai/intent/predict" },
  { id: "price-optimizer", name: "Price Optimizer", description: "Automated pricing recommendations", phase: 3, icon: Calculator, endpoint: "/api/ai/pricing/acquisition" },
  { id: "deal-patterns", name: "Deal Patterns", description: "Clone successful deal strategies", phase: 3, icon: GitBranch, endpoint: "/api/ai/patterns/analyze" },
  { id: "sequences", name: "Sequences", description: "AI-optimized outreach sequences", phase: 4, icon: Mail, endpoint: "/api/ai/sequences/performance" },
  { id: "portfolio", name: "Portfolio", description: "Monitor portfolio health and alerts", phase: 5, icon: Eye, endpoint: "/api/ai/portfolio/monitor" },
  { id: "documents", name: "Documents", description: "Intelligent document processing", phase: 5, icon: FileText, endpoint: "/api/ai/documents/analyze" },
  { id: "cash-flow", name: "Cash Flow", description: "Forecast cash flow and projections", phase: 5, icon: DollarSign, endpoint: "/api/ai/cashflow/forecast" },
  { id: "compliance", name: "Compliance", description: "Regulatory compliance monitoring", phase: 5, icon: Shield, endpoint: "/api/ai/compliance/check" },
  { id: "buyer-matching", name: "Buyer Matching", description: "Match properties to qualified buyers", phase: 6, icon: UserCheck, endpoint: "/api/ai/buyers/match" },
  { id: "qualification", name: "Qualification", description: "Automated buyer qualification", phase: 6, icon: CheckCircle, endpoint: "/api/ai/buyers/qualify" },
  { id: "disposition", name: "Disposition", description: "Optimize property disposition strategy", phase: 6, icon: BarChart3, endpoint: "/api/ai/disposition/optimize" },
];

export function AiOperationsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dueDiligenceDialogOpen, setDueDiligenceDialogOpen] = useState(false);
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [propertyIdInput, setPropertyIdInput] = useState("");

  const { data: alertsData, isLoading: alertsLoading } = useQuery<PortfolioAlert[]>({
    queryKey: ["/api/ai/portfolio/alerts"],
    retry: false,
    staleTime: 30000,
  });

  const alerts = alertsData || [];

  const runDueDiligenceMutation = useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", "/api/ai/due-diligence/request", { propertyId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Due diligence started", description: "Analysis is now running in the background." });
      setDueDiligenceDialogOpen(false);
      setPropertyIdInput("");
      // A new dossier row now exists — same invalidation as useRequestAIDossier.
      queryClient.invalidateQueries({ queryKey: ["/api/ai/due-diligence"] });
    },
    onError: () => {
      toast({ title: "Couldn't start due diligence", description: "No analysis was queued. Try again or check the system status.", variant: "destructive" });
    },
  });

  // allow-no-invalidation: recommendation is surfaced in the success toast — no cached query reads it
  const getPricingMutation = useMutation({
    mutationFn: async (propertyId: number) => {
      const res = await apiRequest("POST", "/api/ai/pricing/acquisition", { propertyId });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Price recommendation ready",
        description: data.recommendedPrice ? `Recommended: ${usd(data.recommendedPrice, { noCents: Number.isInteger(data.recommendedPrice) })}` : "Analysis complete",
      });
      setPricingDialogOpen(false);
      setPropertyIdInput("");
    },
    onError: () => {
      toast({ title: "Couldn't run pricing", description: "No pricing data was generated. Try again or check the system status.", variant: "destructive" });
    },
  });

  const monitorPortfolioMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/portfolio/monitor", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Portfolio scan started", description: "Monitoring all properties for issues." });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/portfolio/alerts"] });
    },
    onError: () => {
      toast({ title: "Couldn't start portfolio scan", description: "No properties are being monitored yet. Try again or check the system status.", variant: "destructive" });
    },
  });

  // allow-no-invalidation: GET verification — reads compliance rules, mutates nothing
  const checkComplianceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/ai/compliance/rules");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Compliance check complete", description: "All rules have been verified." });
    },
    onError: () => {
      toast({ title: "Couldn't run compliance check", description: "No rules were verified. Try again or check the system status.", variant: "destructive" });
    },
  });

  const getPhaseLabel = (phase: number) => {
    switch (phase) {
      case 3: return "Acquisition";
      case 4: return "Outreach";
      case 5: return "Management";
      case 6: return "Disposition";
      default: return `Phase ${phase}`;
    }
  };

  const getPhaseColor = (phase: number) => {
    switch (phase) {
      case 3: return "bg-acr-brand-soft text-acr-brand";
      case 4: return "bg-acr-accent/20 text-acr-ink-2";
      case 5: return "bg-acr-warn-soft text-acr-warn";
      case 6: return "bg-acr-pos-soft text-acr-pos";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-acr-neg-soft text-acr-neg border border-acr-neg/30";
      case "high": return "bg-acr-neg-soft text-acr-neg border border-acr-neg/20";
      case "medium": return "bg-acr-warn-soft text-acr-warn border border-acr-warn/30";
      case "low": return "bg-acr-brand-soft text-acr-brand border border-acr-brand/20";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const groupedServices = {
    3: aiServices.filter(s => s.phase === 3),
    4: aiServices.filter(s => s.phase === 4),
    5: aiServices.filter(s => s.phase === 5),
    6: aiServices.filter(s => s.phase === 6),
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <LowBalanceAlert />
      
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold mb-1">AI Operations Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Manage and monitor your AI services across all phases
          </p>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 pb-6">
          <Card data-testid="card-quick-actions">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <Dialog open={dueDiligenceDialogOpen} onOpenChange={setDueDiligenceDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="h-auto py-3 flex flex-col items-center gap-2" data-testid="button-run-due-diligence">
                      <Search className="w-5 h-5" />
                      <span className="text-xs text-center leading-tight">Run Due Diligence</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Run Due Diligence</DialogTitle>
                      <DialogDescription>
                        Enter a property ID to start automated due diligence analysis
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Textarea
                        aria-label="Property ID for due-diligence analysis"
                        placeholder="Enter property ID…"
                        value={propertyIdInput}
                        onChange={(e) => setPropertyIdInput(e.target.value)}
                        data-testid="input-property-id-dd"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => runDueDiligenceMutation.mutate(parseInt(propertyIdInput) || 0)}
                        disabled={runDueDiligenceMutation.isPending || !propertyIdInput.trim()}
                        data-testid="button-confirm-due-diligence"
                      >
                        {runDueDiligenceMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                        Start Analysis
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={pricingDialogOpen} onOpenChange={setPricingDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="h-auto py-3 flex flex-col items-center gap-2" data-testid="button-get-price">
                      <Calculator className="w-5 h-5" />
                      <span className="text-xs text-center leading-tight">Get Price Recommendation</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Get Price Recommendation</DialogTitle>
                      <DialogDescription>
                        Enter a property ID to get pricing analysis
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Textarea
                        aria-label="Property ID for pricing analysis"
                        placeholder="Enter property ID…"
                        value={propertyIdInput}
                        onChange={(e) => setPropertyIdInput(e.target.value)}
                        data-testid="input-property-id-pricing"
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => getPricingMutation.mutate(parseInt(propertyIdInput) || 0)}
                        disabled={getPricingMutation.isPending || !propertyIdInput.trim()}
                        data-testid="button-confirm-pricing"
                      >
                        {getPricingMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                        Get Recommendation
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Button 
                  variant="outline" 
                  className="h-auto py-3 flex flex-col items-center gap-2"
                  onClick={() => monitorPortfolioMutation.mutate()}
                  disabled={monitorPortfolioMutation.isPending}
                  data-testid="button-monitor-portfolio"
                >
                  {monitorPortfolioMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Eye className="w-5 h-5" aria-hidden="true" />
                  )}
                  <span className="text-xs text-center leading-tight">Monitor Portfolio</span>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto py-3 flex flex-col items-center gap-2"
                  onClick={() => checkComplianceMutation.mutate()}
                  disabled={checkComplianceMutation.isPending}
                  data-testid="button-check-compliance"
                >
                  {checkComplianceMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Shield className="w-5 h-5" aria-hidden="true" />
                  )}
                  <span className="text-xs text-center leading-tight">Check Compliance</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {Object.entries(groupedServices).map(([phase, services]) => (
            <div key={phase} data-testid={`section-phase-${phase}`}>
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold">Phase {phase}: {getPhaseLabel(parseInt(phase))}</h3>
                <Badge className={`text-xs ${getPhaseColor(parseInt(phase))}`}>
                  {services.length} services
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {services.map((service) => {
                  const IconComponent = service.icon;
                  return (
                    <Card key={service.id} className="hover-elevate" data-testid={`card-service-${service.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-card ${getPhaseColor(service.phase)}`}>
                            <IconComponent className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{service.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {service.description}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full mt-3"
                          onClick={() => toast({ title: service.name, description: "Feature available - use Quick Actions or API directly" })}
                          data-testid={`button-service-${service.id}`}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Launch
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}

          <Card data-testid="card-recent-alerts">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Recent Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No active alerts</p>
                  <p className="text-xs">Your portfolio is running smoothly</p>
                </div>
              ) : (
                <div className="space-y-3" data-testid="list-alerts">
                  {alerts.slice(0, 5).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 p-3 rounded-card border bg-card"
                      data-testid={`alert-item-${alert.id}`}
                    >
                      <AlertCircle className={`w-4 h-4 mt-0.5 ${
                        alert.severity === "critical" || alert.severity === "high" ? "text-acr-neg" :
                        alert.severity === "medium" ? "text-acr-warn" : "text-acr-brand"
                      }`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">{alert.title}</span>
                          <Badge className={`text-xs ${getSeverityColor(alert.severity)}`}>
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.createdAt && relative(alert.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}

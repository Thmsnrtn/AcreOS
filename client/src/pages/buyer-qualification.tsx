import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Users, CheckCircle2, XCircle, AlertTriangle, Loader2, DollarSign, TrendingUp, BarChart3
} from "lucide-react";

interface BuyerQualification {
  id: number;
  leadId: number;
  status: string;
  overallScore?: number;
  closingProbability?: number;
  financialScore?: number;
  backgroundScore?: number;
  financingScore?: number;
  riskLevel?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  qualified: { label: "Qualified", color: "text-green-600", icon: CheckCircle2 },
  high_risk: { label: "High Risk", color: "text-red-600", icon: XCircle },
  pending: { label: "Pending", color: "text-yellow-600", icon: AlertTriangle },
  in_progress: { label: "In Progress", color: "text-blue-600", icon: Loader2 },
};

function QualificationCard({ q }: { q: BuyerQualification }) {
  const config = STATUS_CONFIG[q.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Lead #{q.leadId}</CardTitle>
          </div>
          <div className={`flex items-center gap-1 text-xs ${config.color}`}>
            <Icon className="w-3.5 h-3.5" />
            {config.label}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.overallScore !== undefined && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Overall Score</span>
              <span className="font-medium">{q.overallScore}/100</span>
            </div>
            <Progress value={q.overallScore} className="h-2" />
          </div>
        )}

        {q.closingProbability !== undefined && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground text-xs">Closing Probability</span>
            <Badge variant={q.closingProbability >= 70 ? "default" : "secondary"} className="text-xs">
              {q.closingProbability}%
            </Badge>
          </div>
        )}

        {q.riskLevel && (
          <Badge
            variant={q.riskLevel === "low" ? "secondary" : q.riskLevel === "high" ? "destructive" : "outline"}
            className="text-xs capitalize"
          >
            {q.riskLevel} risk
          </Badge>
        )}

        <div className="grid grid-cols-3 gap-2 pt-1">
          {[
            { label: "Financial", value: q.financialScore },
            { label: "Background", value: q.backgroundScore },
            { label: "Financing", value: q.financingScore },
          ].filter(s => s.value !== undefined).map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm font-medium">{value}</p>
            </div>
          ))}
        </div>

        {q.notes && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">{q.notes}</p>
        )}

        <p className="text-xs text-muted-foreground">{new Date(q.createdAt).toLocaleDateString()}</p>
      </CardContent>
    </Card>
  );
}

export default function BuyerQualificationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState("");
  const [activeTab, setActiveTab] = useState("qualified");

  const { data: qualifiedData, isLoading: qualLoading } = useQuery<{ qualifications: BuyerQualification[] }>({
    queryKey: ["/api/buyer-qualification/qualified"],
    queryFn: () => fetch("/api/buyer-qualification/qualified").then(r => r.json()),
  });

  const { data: highRiskData, isLoading: riskLoading } = useQuery<{ qualifications: BuyerQualification[] }>({
    queryKey: ["/api/buyer-qualification/high-risk"],
    queryFn: () => fetch("/api/buyer-qualification/high-risk").then(r => r.json()),
  });

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/buyer-qualification/start/${leadId}`),
    onSuccess: () => {
      toast({ title: "Qualification started for lead #" + leadId });
      qc.invalidateQueries({ queryKey: ["/api/buyer-qualification"] });
    },
    onError: () => toast({ title: "Failed to start qualification", variant: "destructive" }),
  });

  const assessMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/buyer-qualification/${leadId}/assess`),
    onSuccess: () => {
      toast({ title: "Full assessment complete" });
      qc.invalidateQueries({ queryKey: ["/api/buyer-qualification"] });
    },
    onError: () => toast({ title: "Assessment failed", variant: "destructive" }),
  });

  const qualified = qualifiedData?.qualifications ?? [];
  const highRisk = highRiskData?.qualifications ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-buyer-qualification-title">
          Buyer Qualification
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI-powered buyer assessment for financial, background, and financing readiness.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-600 mb-1">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-xs">Qualified</span>
            </div>
            <p className="text-2xl font-bold">{qualified.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1">
              <XCircle className="w-4 h-4" />
              <span className="text-xs">High Risk</span>
            </div>
            <p className="text-2xl font-bold">{highRisk.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs">Avg Closing %</span>
            </div>
            <p className="text-2xl font-bold">
              {qualified.length > 0
                ? `${Math.round(qualified.reduce((s, q) => s + (q.closingProbability ?? 0), 0) / qualified.length)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qualify a Lead</CardTitle>
          <CardDescription>Start or run a full assessment for any lead.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Lead ID"
              value={leadId}
              onChange={e => setLeadId(e.target.value)}
              className="w-32"
            />
            <Button
              variant="outline"
              disabled={!leadId || startMutation.isPending}
              onClick={() => leadId && startMutation.mutate()}
            >
              {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start"}
            </Button>
            <Button
              disabled={!leadId || assessMutation.isPending}
              onClick={() => leadId && assessMutation.mutate()}
            >
              {assessMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Assessing...</>
              ) : (
                "Full Assessment"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="qualified" className="text-xs">
            Qualified ({qualified.length})
          </TabsTrigger>
          <TabsTrigger value="high-risk" className="text-xs">
            High Risk ({highRisk.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qualified" className="pt-4">
          {qualLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : qualified.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No qualified buyers yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {qualified.map(q => <QualificationCard key={q.id} q={q} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="high-risk" className="pt-4">
          {riskLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : highRisk.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No high-risk buyers flagged.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {highRisk.map(q => <QualificationCard key={q.id} q={q} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

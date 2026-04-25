import { useState, useId } from "react";
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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import {
  Users, CheckCircle2, XCircle, AlertTriangle, Loader2, TrendingUp,
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
  high_risk: { label: "High risk", color: "text-red-600", icon: XCircle },
  pending: { label: "Pending", color: "text-yellow-600", icon: AlertTriangle },
  in_progress: { label: "In progress", color: "text-blue-600", icon: Loader2 },
};

function QualificationCard({ q }: { q: BuyerQualification }) {
  const config = STATUS_CONFIG[q.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <CardTitle className="text-sm">Lead #<span className="tabular-nums">{q.leadId}</span></CardTitle>
          </div>
          <span
            className={`flex items-center gap-1 text-xs ${config.color}`}
            aria-label={`Status: ${config.label}`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {config.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.overallScore !== undefined && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Overall score</span>
              <span className="font-medium tabular-nums">{q.overallScore}/100</span>
            </div>
            <Progress
              value={q.overallScore}
              className="h-2"
              aria-label={`Overall score ${q.overallScore} of 100`}
            />
          </div>
        )}

        {q.closingProbability !== undefined && (
          <div className="flex items-center justify-between text-sm gap-2">
            <span className="text-muted-foreground text-xs">Closing probability</span>
            <Badge variant={q.closingProbability >= 70 ? "default" : "secondary"} className="text-xs tabular-nums">
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

        <dl className="grid grid-cols-3 gap-2 pt-1">
          {[
            { label: "Financial", value: q.financialScore },
            { label: "Background", value: q.backgroundScore },
            { label: "Financing", value: q.financingScore },
          ].filter(s => s.value !== undefined).map(({ label, value }) => (
            <div key={label} className="text-center">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        {q.notes && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">{q.notes}</p>
        )}

        <p className="text-xs text-muted-foreground tabular-nums">{new Date(q.createdAt).toLocaleDateString()}</p>
      </CardContent>
    </Card>
  );
}

export default function BuyerQualificationPage() {
  useDocumentTitle("Buyer qualification");
  const { toast } = useToast();
  const qc = useQueryClient();
  const leadIdInputId = useId();
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
      toast({ title: `Qualification started for lead #${leadId}` });
      qc.invalidateQueries({ queryKey: ["/api/buyer-qualification"] });
    },
    onError: () =>
      toast({
        title: "Couldn't start qualification",
        description: "The lead's previous qualification (if any) is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const assessMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/buyer-qualification/${leadId}/assess`),
    onSuccess: () => {
      toast({ title: "Full assessment complete" });
      qc.invalidateQueries({ queryKey: ["/api/buyer-qualification"] });
    },
    onError: () =>
      toast({
        title: "Assessment didn't run",
        description: "The lead's previous scores are unchanged. Try again, or run \"Start\" first if no qualification record exists.",
        variant: "destructive",
      }),
  });

  const qualified = qualifiedData?.qualifications ?? [];
  const highRisk = highRiskData?.qualifications ?? [];
  const avgClosing = qualified.length > 0
    ? Math.round(qualified.reduce((s, q) => s + (q.closingProbability ?? 0), 0) / qualified.length)
    : null;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-buyer-qualification-title">
          Buyer qualification
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI-powered buyer assessment for financial, background, and financing readiness.
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-green-600 mb-1">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Qualified</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{qualified.length}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-red-600 mb-1">
              <XCircle className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">High risk</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{highRisk.length}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Avg closing %</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">
              {avgClosing != null ? `${avgClosing}%` : "—"}
            </dd>
          </CardContent>
        </Card>
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Qualify a lead</CardTitle>
          <CardDescription>Start or run a full assessment for any lead.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => { e.preventDefault(); if (leadId) assessMutation.mutate(); }}
            className="flex gap-2 flex-wrap items-end"
          >
            <div>
              <Label htmlFor={leadIdInputId} className="sr-only">Lead ID</Label>
              <Input
                id={leadIdInputId}
                type="number"
                placeholder="Lead ID"
                value={leadId}
                onChange={e => setLeadId(e.target.value)}
                className="w-32 tabular-nums"
                inputMode="numeric"
                min={1}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!leadId || startMutation.isPending}
              onClick={() => leadId && startMutation.mutate()}
              aria-label={leadId ? `Start qualification for lead ${leadId}` : "Start qualification"}
            >
              {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Start"}
            </Button>
            <Button
              type="submit"
              disabled={!leadId || assessMutation.isPending}
              aria-label={leadId ? `Run full assessment for lead ${leadId}` : "Run full assessment"}
            >
              {assessMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Assessing…</>
              ) : (
                "Full assessment"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="qualified" className="text-xs">
            Qualified (<span className="tabular-nums">{qualified.length}</span>)
          </TabsTrigger>
          <TabsTrigger value="high-risk" className="text-xs">
            High risk (<span className="tabular-nums">{highRisk.length}</span>)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qualified" className="pt-4">
          {qualLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…
            </div>
          ) : qualified.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No qualified buyers yet.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Qualified buyers">
              {qualified.map(q => (
                <li key={q.id}><QualificationCard q={q} /></li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="high-risk" className="pt-4">
          {riskLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…
            </div>
          ) : highRisk.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No high-risk buyers flagged.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="High-risk buyers">
              {highRisk.map(q => (
                <li key={q.id}><QualificationCard q={q} /></li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, CheckCircle2, XCircle, AlertCircle, Key } from "lucide-react";

interface AutomationItem {
  name: string;
  description: string;
  actionsLast7d: number;
  status: string;
  passiveScore: number;
  note?: string;
}

interface AutomationData {
  overallPassiveScore: number;
  totalAutomatedActionsLast7d: number;
  humanActionsRequiredLast7d: number;
  automations: AutomationItem[];
  passiveIncomeStatement: string;
  credentialHealth?: {
    score: number;
    hasAI: boolean;
    hasEmail: boolean;
    hasStripe: boolean;
    hasMaps: boolean;
    missingCreds: string[];
  };
  operationalHealth?: {
    score: number;
    pendingDecisions: number;
    jobFailures24h: number;
  };
}

function ScoreRing({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        {/* Track */}
        <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="6" stroke="hsl(var(--muted))" />
        {/* Progress */}
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="6"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black leading-none" style={{ color }}>{score}</span>
        <span className="text-[9px] text-muted-foreground leading-none mt-0.5">/100</span>
      </div>
    </div>
  );
}

export function PlatformPassiveScore() {
  const { data, isLoading } = useQuery<AutomationData>({
    queryKey: ["/api/founder/intelligence/automation"],
    staleTime: 3600 * 1000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-500" />
            Platform Passive Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-32 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const {
    overallPassiveScore,
    totalAutomatedActionsLast7d,
    automations,
    passiveIncomeStatement,
  } = data;

  const scoreLabel =
    overallPassiveScore >= 90 ? "Highly passive — minimal intervention needed" :
    overallPassiveScore >= 75 ? "Mostly automated — running well" :
    overallPassiveScore >= 60 ? "Partially passive — some manual work needed" :
    "Needs attention — automation gaps detected";

  const scoreBg =
    overallPassiveScore >= 80 ? "from-green-500/5 to-transparent border-green-500/20" :
    overallPassiveScore >= 60 ? "from-amber-500/5 to-transparent border-amber-500/20" :
    "from-red-500/5 to-transparent border-red-500/20";

  // Sort by actionsLast7d desc
  const sorted = [...automations].sort((a, b) => b.actionsLast7d - a.actionsLast7d);
  const maxActions = Math.max(...automations.map(a => a.actionsLast7d), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-500" />
            Platform Passive Score
          </CardTitle>
          <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/20">
            <Zap className="h-3 w-3 mr-1" />
            {totalAutomatedActionsLast7d.toLocaleString()} acts/week
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score hero */}
        <div className={`flex items-center gap-4 rounded-xl border bg-gradient-to-r ${scoreBg} px-4 py-3`}>
          <ScoreRing score={overallPassiveScore} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{scoreLabel}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {passiveIncomeStatement}
            </p>
          </div>
        </div>

        {/* Credential health pills */}
        {data.credentialHealth && data.credentialHealth.missingCreds.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p className="text-xs font-medium text-amber-600 flex items-center gap-1 mb-1.5">
              <Key className="h-3 w-3" />
              Unconfigured services reducing score:
            </p>
            <div className="flex flex-wrap gap-1">
              {data.credentialHealth.missingCreds.map((c: string) => (
                <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Score breakdown bars */}
        {data.credentialHealth && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Score breakdown</p>
            {[
              { label: "Credentials", score: data.credentialHealth.score, weight: "40%" },
              { label: "Automations", score: Math.round(data.automations.reduce((s, a) => s + a.passiveScore, 0) / (data.automations.length || 1)), weight: "40%" },
              { label: "Operations", score: data.operationalHealth?.score ?? 100, weight: "20%" },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-24 shrink-0">{row.label}</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${row.score >= 80 ? "bg-green-500" : row.score >= 60 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${row.score}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-8 text-right shrink-0">{row.score}</span>
              </div>
            ))}
          </div>
        )}

        {/* Automation activity bars */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Automation activity (last 7 days)</p>
          {sorted.map(auto => (
            <div key={auto.name} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-xs text-foreground truncate max-w-[160px]">{auto.name}</span>
                  {auto.note && auto.status === "degraded" && (
                    <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {auto.actionsLast7d > 0 ? (
                    <span className="text-xs text-muted-foreground">{auto.actionsLast7d.toLocaleString()}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">idle</span>
                  )}
                  {auto.status === "active" ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  ) : auto.status === "degraded" ? (
                    <XCircle className="h-3 w-3 text-red-400" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                  )}
                </div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${auto.status === "active" ? "bg-purple-500" : auto.status === "degraded" ? "bg-red-400" : "bg-amber-500"}`}
                  style={{ width: `${auto.actionsLast7d > 0 ? Math.max(3, (auto.actionsLast7d / maxActions) * 100) : (auto.status === "active" ? 8 : 0)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Operational health note */}
        {data.operationalHealth && (data.operationalHealth.pendingDecisions > 0 || data.operationalHealth.jobFailures24h > 0) && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 space-y-0.5">
            {data.operationalHealth.pendingDecisions > 0 && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {data.operationalHealth.pendingDecisions} decision{data.operationalHealth.pendingDecisions !== 1 ? "s" : ""} awaiting founder review
              </p>
            )}
            {data.operationalHealth.jobFailures24h > 0 && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                {data.operationalHealth.jobFailures24h} job failure{data.operationalHealth.jobFailures24h !== 1 ? "s" : ""} in last 24h
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

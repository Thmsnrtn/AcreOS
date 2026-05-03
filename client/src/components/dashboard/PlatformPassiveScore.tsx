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
    <div
      role="progressbar"
      aria-label={`Passive score: ${score} out of 100`}
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative inline-flex items-center justify-center"
    >
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90" aria-hidden="true">
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
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className="text-xl font-black leading-none tabular-nums" style={{ color }}>{score}</span>
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
            <Bot className="h-4 w-4 text-acr-brand" aria-hidden="true" />
            Platform passive score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status" aria-busy="true" aria-label="Loading platform passive score" className="h-32 bg-muted rounded animate-pulse" />
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
    overallPassiveScore >= 80 ? "from-acr-pos/5 to-transparent border-acr-pos/20" :
    overallPassiveScore >= 60 ? "from-acr-warn/5 to-transparent border-acr-warn/20" :
    "from-acr-neg/5 to-transparent border-acr-neg/20";

  // Sort by actionsLast7d desc
  const sorted = [...automations].sort((a, b) => b.actionsLast7d - a.actionsLast7d);
  const maxActions = Math.max(...automations.map(a => a.actionsLast7d), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-acr-brand" aria-hidden="true" />
            Platform passive score
          </CardTitle>
          <Badge variant="outline" className="text-xs bg-acr-brand/10 text-acr-brand border-acr-brand/20 tabular-nums" aria-label={`${totalAutomatedActionsLast7d.toLocaleString()} automated actions per week`}>
            <Zap className="h-3 w-3 mr-1" aria-hidden="true" />
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
          <div className="rounded-lg border border-acr-warn/20 bg-acr-warn/5 px-3 py-2">
            <p id="missing-creds-heading" className="text-xs font-medium text-acr-warn flex items-center gap-1 mb-1.5">
              <Key className="h-3 w-3" aria-hidden="true" />
              Unconfigured services reducing score:
            </p>
            <ul aria-labelledby="missing-creds-heading" className="flex flex-wrap gap-1 list-none p-0 m-0">
              {data.credentialHealth.missingCreds.map((c: string) => (
                <li key={c} className="text-xs px-2 py-0.5 rounded-full bg-acr-warn/10 text-acr-warn border border-acr-warn/20">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Score breakdown bars */}
        {data.credentialHealth && (
          <div className="space-y-1.5">
            <p id="score-breakdown-heading" className="text-xs font-medium text-muted-foreground">Score breakdown</p>
            <ul aria-labelledby="score-breakdown-heading" className="space-y-1.5 list-none p-0 m-0">
              {[
                { label: "Credentials", score: data.credentialHealth.score, weight: "40%" },
                { label: "Automations", score: Math.round(data.automations.reduce((s, a) => s + a.passiveScore, 0) / (data.automations.length || 1)), weight: "40%" },
                { label: "Operations", score: data.operationalHealth?.score ?? 100, weight: "20%" },
              ].map(row => (
                <li
                  key={row.label}
                  className="flex items-center gap-2"
                  aria-label={`${row.label}: ${row.score} out of 100`}
                >
                  <span className="text-xs text-muted-foreground w-24 shrink-0">{row.label}</span>
                  <div aria-hidden="true" className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${row.score >= 80 ? "bg-acr-pos" : row.score >= 60 ? "bg-acr-warn" : "bg-acr-neg"}`}
                      style={{ width: `${row.score}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right shrink-0 tabular-nums">{row.score}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Automation activity bars */}
        <div className="space-y-2">
          <p id="automation-activity-heading" className="text-xs font-medium text-muted-foreground">Automation activity (last 7 days)</p>
          <ul aria-labelledby="automation-activity-heading" className="space-y-2 list-none p-0 m-0">
            {sorted.map(auto => (
              <li
                key={auto.name}
                className="space-y-0.5"
                aria-label={`${auto.name}: ${auto.actionsLast7d > 0 ? `${auto.actionsLast7d.toLocaleString()} actions` : "idle"}, status ${auto.status}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-xs text-foreground truncate max-w-[160px]">{auto.name}</span>
                    {auto.note && auto.status === "degraded" && (
                      <AlertCircle className="h-3 w-3 text-acr-warn shrink-0" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {auto.actionsLast7d > 0 ? (
                      <span className="text-xs text-muted-foreground tabular-nums">{auto.actionsLast7d.toLocaleString()}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">idle</span>
                    )}
                    {auto.status === "active" ? (
                      <CheckCircle2 className="h-3 w-3 text-acr-pos" aria-hidden="true" />
                    ) : auto.status === "degraded" ? (
                      <XCircle className="h-3 w-3 text-acr-neg" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-acr-warn" aria-hidden="true" />
                    )}
                  </div>
                </div>
                <div aria-hidden="true" className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${auto.status === "active" ? "bg-acr-brand" : auto.status === "degraded" ? "bg-acr-neg" : "bg-acr-warn"}`}
                    style={{ width: `${auto.actionsLast7d > 0 ? Math.max(3, (auto.actionsLast7d / maxActions) * 100) : (auto.status === "active" ? 8 : 0)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Operational health note */}
        {data.operationalHealth && (data.operationalHealth.pendingDecisions > 0 || data.operationalHealth.jobFailures24h > 0) && (
          <div role="alert" className="rounded-lg border border-acr-neg/20 bg-acr-neg/5 px-3 py-2 space-y-0.5">
            {data.operationalHealth.pendingDecisions > 0 && (
              <p className="text-xs text-acr-neg flex items-center gap-1">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{data.operationalHealth.pendingDecisions}</span> decision{data.operationalHealth.pendingDecisions !== 1 ? "s" : ""} awaiting founder review
              </p>
            )}
            {data.operationalHealth.jobFailures24h > 0 && (
              <p className="text-xs text-acr-neg flex items-center gap-1">
                <XCircle className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{data.operationalHealth.jobFailures24h}</span> job failure{data.operationalHealth.jobFailures24h !== 1 ? "s" : ""} in last 24h
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

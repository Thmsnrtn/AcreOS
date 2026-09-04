import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface Anomaly {
  id: string;
  type: "positive" | "negative" | "neutral";
  message: string;
  metric: string;
  currentValue: number;
  previousValue: number;
  percentChange: number;
}

interface AnomalyAlertsProps {
  anomalies: Anomaly[];
  isLoading?: boolean;
}

function getAnomalyStyle(type: string) {
  switch (type) {
    case "positive":
      return {
        badge: "bg-acr-pos-soft text-acr-pos-soft-ink dark:bg-acr-pos-soft/30 dark:text-acr-pos-soft-ink border-acr-pos-soft dark:border-acr-pos-soft",
        icon: <TrendingUp className="w-3 h-3" aria-hidden="true" />,
      };
    case "negative":
      return {
        badge: "bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft/30 dark:text-acr-neg-soft-ink border-acr-neg-soft dark:border-acr-neg-soft",
        icon: <TrendingDown className="w-3 h-3" aria-hidden="true" />,
      };
    default:
      return {
        badge: "bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft/30 dark:text-acr-warn-soft-ink border-acr-warn-soft dark:border-acr-warn-soft",
        icon: <Minus className="w-3 h-3" aria-hidden="true" />,
      };
  }
}

export function AnomalyAlerts({ anomalies, isLoading }: AnomalyAlertsProps) {
  if (isLoading) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-acr-warn/50 to-acr-warn/30 dark:from-acr-warn/20 dark:to-acr-warn/10"
        data-testid="dashboard-anomaly-alerts"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
            Anomaly alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!anomalies || anomalies.length === 0) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-acr-warn/50 to-acr-warn/30 dark:from-acr-warn/20 dark:to-acr-warn/10"
        data-testid="dashboard-anomaly-alerts"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
            Anomaly alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No anomalies detected this week. Everything looks normal!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card 
      className="relative overflow-visible bg-gradient-to-br from-acr-warn/50 to-acr-warn/30 dark:from-acr-warn/20 dark:to-acr-warn/10"
      data-testid="dashboard-anomaly-alerts"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
          Anomaly alerts
          <Badge variant="outline" className="ml-2 text-xs tabular-nums" aria-label={`${anomalies.length} detected`}>
            {anomalies.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul aria-label="Detected anomalies" className="space-y-3 list-none p-0 m-0">
          {anomalies.map((anomaly) => {
            const style = getAnomalyStyle(anomaly.type);
            return (
              <li key={anomaly.id}>
                <a
                  href={anomaly.metric.toLowerCase().includes('lead') ? '/leads' : anomaly.metric.toLowerCase().includes('deal') ? '/deals' : '/analytics'}
                  className="flex items-center justify-between p-3 rounded-md bg-background/60 border border-border/50 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`anomaly-${anomaly.id}`}
                  aria-label={`${anomaly.message} — ${anomaly.percentChange > 0 ? "+" : ""}${anomaly.percentChange}% (${anomaly.currentValue} vs ${anomaly.previousValue} last week)`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{anomaly.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                      {anomaly.currentValue} vs {anomaly.previousValue} last week
                    </p>
                  </div>
                  <Badge variant="outline" className={`ml-3 flex-shrink-0 tabular-nums ${style.badge}`}>
                    {style.icon}
                    <span className="ml-1">
                      {anomaly.percentChange > 0 ? "+" : ""}{anomaly.percentChange}%
                    </span>
                  </Badge>
                </a>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

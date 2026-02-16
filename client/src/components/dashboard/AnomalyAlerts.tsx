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
        badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800",
        icon: <TrendingUp className="w-3 h-3" />,
      };
    case "negative":
      return {
        badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800",
        icon: <TrendingDown className="w-3 h-3" />,
      };
    default:
      return {
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
        icon: <Minus className="w-3 h-3" />,
      };
  }
}

export function AnomalyAlerts({ anomalies, isLoading }: AnomalyAlertsProps) {
  if (isLoading) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-950/20 dark:to-orange-950/10"
        data-testid="dashboard-anomaly-alerts"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Anomaly Alerts
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
        className="relative overflow-visible bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-950/20 dark:to-orange-950/10"
        data-testid="dashboard-anomaly-alerts"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Anomaly Alerts
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
      className="relative overflow-visible bg-gradient-to-br from-amber-50/50 to-orange-50/30 dark:from-amber-950/20 dark:to-orange-950/10"
      data-testid="dashboard-anomaly-alerts"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Anomaly Alerts
          <Badge variant="outline" className="ml-2 text-xs">
            {anomalies.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {anomalies.map((anomaly) => {
          const style = getAnomalyStyle(anomaly.type);
          return (
            <a 
              key={anomaly.id}
              href={anomaly.metric.toLowerCase().includes('lead') ? '/leads' : anomaly.metric.toLowerCase().includes('deal') ? '/deals' : '/analytics'}
              className="flex items-center justify-between p-3 rounded-md bg-background/60 border border-border/50 hover:bg-accent/40 transition-colors"
              data-testid={`anomaly-${anomaly.id}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{anomaly.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {anomaly.currentValue} vs {anomaly.previousValue} last week
                </p>
              </div>
              <Badge variant="outline" className={`ml-3 flex-shrink-0 ${style.badge}`}>
                {style.icon}
                <span className="ml-1">
                  {anomaly.percentChange > 0 ? "+" : ""}{anomaly.percentChange}%
                </span>
              </Badge>
            </a>
          );
        })}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";

interface Prediction {
  id: string;
  type: "deals" | "revenue" | "leads";
  title: string;
  message: string;
  currentValue: number;
  projectedValue: number;
  timeframe: string;
  trendData?: { name: string; value: number }[];
}

interface PredictiveInsightsProps {
  predictions: Prediction[];
  isLoading?: boolean;
}

function formatValue(value: number, type: string): string {
  if (type === "revenue") {
    return `$${value.toLocaleString()}`;
  }
  return value.toString();
}

export function PredictiveInsights({ predictions, isLoading }: PredictiveInsightsProps) {
  if (isLoading) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10"
        data-testid="dashboard-predictive-insights"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            Predictive Insights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!predictions || predictions.length === 0) {
    return (
      <Card 
        className="relative overflow-visible bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10"
        data-testid="dashboard-predictive-insights"
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="w-5 h-5 text-blue-500" />
            Predictive Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Not enough data to generate predictions yet. Keep adding leads and deals!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card 
      className="relative overflow-visible bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10"
      data-testid="dashboard-predictive-insights"
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TrendingUp className="w-5 h-5 text-blue-500" />
          Predictive Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {predictions.map((prediction) => (
          <div 
            key={prediction.id}
            className="p-3 rounded-md bg-background/60 border border-border/50"
            data-testid={`prediction-${prediction.id}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{prediction.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{prediction.message}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-lg font-semibold text-primary">
                  {formatValue(prediction.projectedValue, prediction.type)}
                </p>
                <p className="text-xs text-muted-foreground">{prediction.timeframe}</p>
              </div>
            </div>
            {prediction.trendData && prediction.trendData.length > 0 && (
              <div className="h-12 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={prediction.trendData}>
                    <defs>
                      <linearGradient id={`gradient-${prediction.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill={`url(#gradient-${prediction.id})`}
                    />
                    <XAxis dataKey="name" hide />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "none",
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                        background: "hsl(var(--card))",
                        fontSize: "12px",
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

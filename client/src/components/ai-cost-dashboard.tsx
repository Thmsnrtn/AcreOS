import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { Sparkles, TrendingDown, DollarSign, Zap, PiggyBank } from "lucide-react";

interface ProviderData {
  provider: string;
  calls: number;
  actualCost: number;
  potentialCost: number;
  savings: number;
}

interface CostSavingsData {
  totalCalls: number;
  totalActualCost: number;
  totalPotentialCost: number;
  totalSavings: number;
  savingsPercent: number;
  byProvider: ProviderData[];
  monthStart: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: "hsl(85, 45%, 45%)",
  openai: "hsl(200, 70%, 50%)",
  deepseek: "hsl(160, 50%, 45%)",
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "DeepSeek (OpenRouter)",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export function AICostDashboard() {
  const { data, isLoading, error } = useQuery<CostSavingsData>({
    queryKey: ["/api/ai/cost-savings"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            AI Cost Savings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Unable to load cost savings data.</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = [
    {
      name: "Cost Comparison",
      actual: data.totalActualCost,
      potential: data.totalPotentialCost,
    },
  ];

  const providerChartData = data.byProvider.map((p) => ({
    name: PROVIDER_LABELS[p.provider] || p.provider,
    calls: p.calls,
    actualCost: p.actualCost,
    potentialCost: p.potentialCost,
    savings: p.savings,
    provider: p.provider,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          AI Cost Savings
        </CardTitle>
        <CardDescription>
          Smart routing saves money by using efficient models for simple tasks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Zap className="w-4 h-4" />
              Total AI Calls
            </div>
            <div className="text-2xl font-bold" data-testid="text-ai-calls">
              {data.totalCalls.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">This month</div>
          </div>

          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="w-4 h-4" />
              Actual Cost
            </div>
            <div className="text-2xl font-bold" data-testid="text-actual-cost">
              ${data.totalActualCost.toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground">What you paid</div>
          </div>

          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingDown className="w-4 h-4" />
              GPT-4o Cost
            </div>
            <div className="text-2xl font-bold" data-testid="text-potential-cost">
              ${data.totalPotentialCost.toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground">Without smart routing</div>
          </div>

          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm mb-1">
              <PiggyBank className="w-4 h-4" />
              Total Savings
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-savings">
              ${data.totalSavings.toFixed(4)}
            </div>
            <Badge variant="secondary" className="mt-1 bg-green-500/20 text-green-600 dark:text-green-400">
              {data.savingsPercent.toFixed(1)}% saved
            </Badge>
          </div>
        </div>

        {data.totalCalls > 0 && (
          <>
            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-4">Cost by Provider</h4>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={providerChartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 11 }}
                      angle={-15}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis 
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => `$${value.toFixed(3)}`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: number, name: string) => {
                        return [`$${value.toFixed(4)}`, name === "actualCost" ? "Actual Cost" : "If GPT-4o"];
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Legend />
                    <Bar dataKey="actualCost" name="Actual Cost" fill="hsl(85, 45%, 45%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="potentialCost" name="If GPT-4o" fill="hsl(200, 70%, 50%)" radius={[4, 4, 0, 0]} opacity={0.5} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-3">Provider Breakdown</h4>
              <div className="space-y-3">
                {data.byProvider.map((provider) => (
                  <div
                    key={provider.provider}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                    data-testid={`provider-${provider.provider}`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: PROVIDER_COLORS[provider.provider] || "hsl(200, 50%, 50%)" }}
                      />
                      <div>
                        <div className="font-medium">
                          {PROVIDER_LABELS[provider.provider] || provider.provider}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {provider.calls.toLocaleString()} calls
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${provider.actualCost.toFixed(4)}</div>
                      {provider.savings > 0 && (
                        <div className="text-sm text-green-600 dark:text-green-400">
                          Saved ${provider.savings.toFixed(4)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {data.totalCalls === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No AI usage this month yet.</p>
            <p className="text-sm">Start using the AI assistant to see cost savings.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

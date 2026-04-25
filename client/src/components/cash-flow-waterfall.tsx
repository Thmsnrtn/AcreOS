import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { DollarSign } from "lucide-react";
import { usd } from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface WaterfallMonth {
  month: string;
  grossDue: number;
  collected: number;
  lateFees: number;
  servicingCosts: number;
  netCashFlow: number;
}

function fmt$(n: number): string {
  if (!isFinite(n) || n == null) return "$0";
  return usd(Math.round(n), { noCents: true });
}

export function CashFlowWaterfall() {
  const { data, isLoading } = useQuery<WaterfallMonth[]>({
    queryKey: ["/api/finance/cash-flow-waterfall"],
    queryFn: async () => {
      const res = await fetch("/api/finance/cash-flow-waterfall");
      if (!res.ok) throw new Error("Failed to load cash flow data");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Card role="status" aria-busy="true" aria-label="Loading cash flow waterfall">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" aria-hidden="true" />
            Cash flow waterfall
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
          <span className="sr-only">Loading…</span>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Cash Flow Waterfall
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Cash flow tracking starts when you create your first seller-financed note.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Cash Flow Waterfall
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 11 }} />
            <YAxis
              className="text-xs"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={((value: number, name: string) => [fmt$(value), name]) as any}
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
            <Bar dataKey="grossDue" name="Gross Due" fill="hsl(var(--chart-1))" radius={[2, 2, 0, 0]} />
            <Bar dataKey="collected" name="Collected" fill="hsl(var(--chart-2))" radius={[2, 2, 0, 0]} />
            <Bar dataKey="lateFees" name="Late Fees" fill="hsl(var(--chart-4))" radius={[2, 2, 0, 0]} />
            <Bar dataKey="netCashFlow" name="Net Cash Flow" fill="hsl(var(--chart-3))" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

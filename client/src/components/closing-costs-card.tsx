import { DollarSign, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";

interface ClosingCostsCardProps {
  state: string;
  county: string;
  salePrice: number;
  annualTax?: number;
}

interface CostEstimate {
  recordingFee: number;
  transferTax: number;
  titleInsuranceEstimate: number;
  proratedTaxes: number;
  totalEstimated: number;
  breakdown: { item: string; amount: number; source: string }[];
  disclaimer: string;
}

function fmt$(n: number): string {
  if (!isFinite(n) || n == null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export function ClosingCostsCard({ state, county, salePrice, annualTax }: ClosingCostsCardProps) {
  const enabled = !!state && !!county && salePrice > 0;

  const { data, isLoading } = useQuery<CostEstimate>({
    queryKey: ["/api/closing-costs/estimate", state, county, salePrice, annualTax],
    queryFn: async () => {
      const params = new URLSearchParams({
        state,
        county,
        salePrice: String(salePrice),
        ...(annualTax ? { annualTax: String(annualTax) } : {}),
      });
      const res = await fetch(`/api/closing-costs/estimate?${params}`);
      if (!res.ok) throw new Error("Failed to estimate closing costs");
      return res.json();
    },
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Estimated Closing Costs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : data ? (
          <div className="space-y-2">
            {data.breakdown.map((item, i) => (
              <div key={i} className="flex justify-between items-start text-sm">
                <div className="flex items-center gap-1">
                  <span>{item.item}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[200px] text-xs">
                      {item.source}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <span className="font-medium tabular-nums">{fmt$(item.amount)}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="font-medium text-sm">Total estimated</span>
              <Badge variant="outline" className="text-sm font-semibold">
                {fmt$(data.totalEstimated)}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight mt-2">
              {data.disclaimer}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

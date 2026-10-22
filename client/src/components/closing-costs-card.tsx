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
  /** What is on the land, when recorded. Graduated states estimate only with it. */
  propertyClass?: "vacant_land" | "single_family_residence" | "other_residential" | "nonresidential";
}

/** Mirrors server/services/closingCostEstimator.ts ClosingCostEstimate. */
interface CostEstimate {
  recordingFee: number;
  /** null = not estimated (refused); never read as $0. */
  transferTax: number | null;
  titleInsuranceEstimate: number;
  proratedTaxes: number;
  totalEstimated: number;
  /** What totalEstimated leaves out, in words. */
  totalExcludes: string[];
  /** amount null = not estimated; the reason is in `source`. */
  breakdown: { item: string; amount: number | null; source: string }[];
  disclaimer: string;
}

function fmt$(n: number): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * The value shown for one breakdown line. A null amount is a refusal, and it
 * says so with its reason — it is never formatted as "$0".
 */
function closingCostAmountLabel(item: { amount: number | null; source: string }): string {
  if (item.amount === null) return `Not estimated — ${item.source.replace(/^Not estimated:\s*/, "")}`;
  return fmt$(item.amount);
}

export function ClosingCostsCard({ state, county, salePrice, annualTax, propertyClass }: ClosingCostsCardProps) {
  const enabled = !!state && !!county && salePrice > 0;

  const { data, isLoading } = useQuery<CostEstimate>({
    queryKey: ["/api/closing-costs/estimate", state, county, salePrice, annualTax, propertyClass],
    queryFn: async () => {
      const params = new URLSearchParams({
        state,
        county,
        salePrice: String(salePrice),
        ...(annualTax ? { annualTax: String(annualTax) } : {}),
        ...(propertyClass ? { propertyClass } : {}),
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
          <DollarSign className="h-4 w-4" aria-hidden="true" />
          Estimated closing costs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading closing-cost estimate">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <span className="sr-only">Loading…</span>
          </div>
        ) : data ? (
          <div className="space-y-2">
            <ul aria-label="Closing-cost breakdown" className="space-y-2 list-none p-0 m-0">
              {data.breakdown.map((item, i) => (
                <li
                  key={i}
                  className="flex justify-between items-start text-sm"
                  aria-label={`${item.item}: ${closingCostAmountLabel(item)}, source: ${item.source}`}
                >
                  <div className="flex items-center gap-1" aria-hidden="true">
                    <span>{item.item}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground cursor-help" aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[200px] text-xs">
                        {item.source}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span
                    className={item.amount === null ? "text-xs text-muted-foreground text-right max-w-[60%]" : "font-medium tabular-nums"}
                    aria-hidden="true"
                    data-testid="closing-cost-amount"
                  >
                    {closingCostAmountLabel(item)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="font-medium text-sm">Total estimated</span>
              <Badge variant="outline" className="text-sm font-semibold tabular-nums" aria-label={`Total estimated: ${fmt$(data.totalEstimated)}`}>
                {fmt$(data.totalEstimated)}
              </Badge>
            </div>
            {data.totalExcludes.length > 0 && (
              <p className="text-xs text-muted-foreground m-0" data-testid="closing-cost-total-excludes">
                The total excludes: {data.totalExcludes.join("; ")}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground leading-tight mt-2 m-0">
              {data.disclaimer}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

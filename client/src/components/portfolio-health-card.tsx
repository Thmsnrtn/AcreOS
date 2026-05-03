import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { ArrowRight, AlertTriangle, TrendingUp } from "lucide-react";
import { usd } from "@/lib/format";

interface HealthDimension {
  label: string;
  score: number;
  weight: number;
}

interface PortfolioHealthData {
  overallScore: number;
  dimensions: HealthDimension[];
  topActions: string[];
}

function HealthGauge({ score }: { score: number }) {
  const size = 100;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = Math.PI * radius; // half-circle
  const offset = circumference - (Math.min(100, score) / 100) * circumference;

  const color =
    score >= 80 ? "stroke-acr-pos" :
    score >= 60 ? "stroke-acr-accent" :
    score >= 40 ? "stroke-acr-warn" :
    "stroke-acr-neg";

  const label =
    score >= 80 ? "Excellent" :
    score >= 60 ? "Good" :
    score >= 40 ? "Fair" :
    "Needs attention";

  return (
    <div className="relative" style={{ width: size, height: size / 2 + 20 }}>
      <svg width={size} height={size / 2 + 10} className="overflow-visible">
        {/* Background arc */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        {/* Progress arc */}
        <path
          d={`M ${strokeWidth / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - strokeWidth / 2} ${size / 2}`}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${color} transition-all duration-1000 ease-out`}
        />
      </svg>
      <div className="absolute bottom-0 inset-x-0 text-center">
        <span className="text-2xl font-bold">{score}</span>
        <span className="text-xs text-muted-foreground block">{label}</span>
      </div>
    </div>
  );
}

function DimensionBar({ dimension }: { dimension: HealthDimension }) {
  const color =
    dimension.score >= 80 ? "bg-acr-pos" :
    dimension.score >= 60 ? "bg-acr-accent" :
    dimension.score >= 40 ? "bg-acr-warn" :
    "bg-acr-neg";

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{dimension.label}</span>
        <span className="font-medium">{dimension.score}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-700`}
          style={{ width: `${dimension.score}%` }}
        />
      </div>
    </div>
  );
}

export function PortfolioHealthCard() {
  const { data, isLoading } = useQuery<PortfolioHealthData>({
    queryKey: ["/api/portfolio/health-score"],
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="floating-window" role="status" aria-busy="true" aria-label="Loading portfolio health">
        <CardContent className="p-6 flex items-center gap-6">
          <Skeleton className="w-[100px] h-[70px]" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
          </div>
        </CardContent>
        <span className="sr-only">Loading…</span>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="floating-window">
      <CardContent className="p-6 flex items-center gap-6">
        <HealthGauge score={data.overallScore} />
        <div className="space-y-2 flex-1 min-w-0">
          {/* 4 mini dimension bars */}
          {data.dimensions.map((d) => (
            <DimensionBar key={d.label} dimension={d} />
          ))}

          {/* Top 2 action items */}
          {data.topActions.slice(0, 2).map((action, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <AlertTriangle className="w-3 h-3 text-acr-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span className="truncate">{action}</span>
            </div>
          ))}

          <Link
            href="/portfolio"
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            View full health <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Year-end tax banner — shown Oct-Dec */
export function TaxOptimizationBanner({ estimatedSavings }: { estimatedSavings?: number }) {
  const month = new Date().getMonth();
  if (month < 9) return null; // Only Oct-Dec (months 9-11)

  return (
    <aside aria-label="Year-end tax optimization">
      <Card className="border-acr-warn-soft dark:border-acr-warn-soft bg-acr-warn-soft dark:bg-acr-warn-soft/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-acr-warn" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">Year-end tax optimization</p>
              <p className="text-xs text-muted-foreground">
                Estimated savings: {estimatedSavings != null ? usd(estimatedSavings, { noCents: true }) : "calculating…"}
              </p>
            </div>
          </div>
          <Link
            href="/portfolio/tax"
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            Review <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>
    </aside>
  );
}

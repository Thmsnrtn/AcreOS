import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";

interface FreedomData {
  monthlyPassiveIncome: number;
  freedomTarget: number;
  freedomPercentage: number;
  projectedFreedomDate: string | null;
  accelerationSuggestion: string | null;
  milestoneReached: number;
  previousMonthIncome: number | null;
}

function ProgressRing({ percentage }: { percentage: number }) {
  const size = 120;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, percentage) / 100) * circumference;

  const color =
    percentage >= 100 ? "stroke-acr-pos" :
    percentage >= 75 ? "stroke-acr-accent" :
    percentage >= 50 ? "stroke-acr-warn" :
    "stroke-primary";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${color} transition-all duration-1000 ease-out`}
          style={{ animation: "freedom-fill 1.5s ease-out forwards" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{percentage}%</span>
        <span className="text-[10px] text-muted-foreground">Financial Freedom</span>
      </div>
    </div>
  );
}

export function FreedomProgressCard() {
  const { data, isLoading } = useQuery<FreedomData>({
    queryKey: ["/api/freedom/snapshot"],
    staleTime: 60 * 1000, // 1 minute cache
  });

  if (isLoading) {
    return (
      <Card className="floating-window">
        <CardContent className="p-6 flex items-center gap-6">
          <Skeleton className="w-[120px] h-[120px] rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // No notes yet — CTA
  if (data.freedomTarget === 0 && data.monthlyPassiveIncome === 0) {
    return (
      <Card className="floating-window border-primary/20">
        <CardContent className="p-6 text-center space-y-3">
          <ProgressRing percentage={0} />
          <p className="text-sm font-medium">Create your first note to start tracking</p>
          <p className="text-xs text-muted-foreground">
            Your freedom meter shows how close you are to replacing your income with passive cash flow.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/finance">
              Create first note <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Target = 0 — prompt to set target
  if (data.freedomTarget === 0) {
    return (
      <Card className="floating-window">
        <CardContent className="p-6 text-center space-y-3">
          <ProgressRing percentage={0} />
          <p className="text-sm font-medium">Set your freedom target to start tracking</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/goals">Set target</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (n: number) => `$${n.toLocaleString()}`;

  // Current income > target
  if (data.freedomPercentage >= 100) {
    return (
      <Card className="floating-window border-acr-pos-soft dark:border-acr-pos-soft">
        <CardContent className="p-6 flex flex-col items-center gap-4">
          <ProgressRing percentage={100} />
          <p className="text-lg font-bold text-acr-pos dark:text-acr-pos">
            You've reached financial freedom!
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(data.monthlyPassiveIncome)} / {formatCurrency(data.freedomTarget)}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="floating-window">
      <CardContent className="p-6 flex items-center gap-6">
        <ProgressRing percentage={data.freedomPercentage} />
        <div className="space-y-1 flex-1">
          <p className="text-sm text-muted-foreground">
            {formatCurrency(data.monthlyPassiveIncome)} / {formatCurrency(data.freedomTarget)}
          </p>
          {data.projectedFreedomDate && (
            <p className="text-xs text-muted-foreground">
              On track for {new Date(data.projectedFreedomDate + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          )}
          {data.accelerationSuggestion && (
            <p className="text-xs text-primary">{data.accelerationSuggestion}</p>
          )}

          {/* Loss-aversion contextual messaging */}
          {data.previousMonthIncome != null && data.monthlyPassiveIncome > data.previousMonthIncome ? (
            <p className="text-xs text-acr-pos dark:text-acr-pos">
              Your passive income grew {formatCurrency(data.monthlyPassiveIncome - data.previousMonthIncome)} this month.
              {data.projectedFreedomDate && (
                <> On track for {new Date(data.projectedFreedomDate + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}.</>
              )}
            </p>
          ) : data.previousMonthIncome != null && data.monthlyPassiveIncome < data.previousMonthIncome ? (
            <p className="text-xs text-acr-warn dark:text-acr-warn">
              Your passive income dropped {formatCurrency(data.previousMonthIncome - data.monthlyPassiveIncome)} this month. Acquiring 1 note at your average terms would recover that and add $150.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Holding steady at {formatCurrency(data.monthlyPassiveIncome)}/month. Your next acquisition pushes you closer to freedom.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

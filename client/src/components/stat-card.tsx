import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  className?: string;
  color?: "default" | "terracotta" | "sage" | "sand" | "emerald" | "blue" | "purple";
  "data-testid"?: string;
  /** Optional sparkline data — array of numbers for a micro trend chart */
  sparklineData?: number[];
  /** Color override for the sparkline (defaults to the card's accent color) */
  sparklineColor?: string;
  /** Whether the trend is positive (green), negative (red), or neutral */
  trendDirection?: "up" | "down" | "neutral";
}

const COLOR_MAP = {
  default: { card: "", icon: "bg-primary/10 text-primary", spark: "hsl(var(--primary))" },
  terracotta: { card: "bg-primary/5 dark:bg-primary/10 border-primary/20", icon: "bg-primary/15 text-primary", spark: "hsl(var(--primary))" },
  sage: { card: "bg-accent/5 dark:bg-accent/10 border-accent/20", icon: "bg-accent/15 text-accent", spark: "hsl(var(--accent))" },
  sand: { card: "bg-secondary border-border", icon: "bg-muted text-muted-foreground", spark: "hsl(var(--muted-foreground))" },
  emerald: { card: "bg-accent/5 dark:bg-accent/10 border-accent/20", icon: "bg-accent/15 text-accent", spark: "#22c55e" },
  blue: { card: "bg-primary/5 dark:bg-primary/10 border-primary/20", icon: "bg-primary/15 text-primary", spark: "#3b82f6" },
  purple: { card: "bg-primary/5 dark:bg-primary/10 border-primary/20", icon: "bg-primary/15 text-primary", spark: "#8b5cf6" },
};

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  className,
  color = "default",
  "data-testid": testId,
  sparklineData,
  sparklineColor,
  trendDirection = "neutral",
}: StatCardProps) {
  const { card: cardStyle, icon: iconStyle, spark: defaultSparkColor } = COLOR_MAP[color];
  const sparkColor =
    sparklineColor ??
    (trendDirection === "up"
      ? "#22c55e"
      : trendDirection === "down"
        ? "#ef4444"
        : defaultSparkColor);

  const trendColor =
    trendDirection === "up"
      ? "text-emerald-600"
      : trendDirection === "down"
        ? "text-red-500"
        : "text-accent";

  const sparkData = sparklineData?.map((v, i) => ({ i, v }));

  return (
    <Card
      className={cn("floating-window border card-hover", cardStyle, className)}
      data-testid={testId}
      role="region"
      aria-label={`${title}: ${value}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
            {trend && (
              <p className={cn("text-xs font-medium mt-1.5", trendColor)}>
                {trend}
              </p>
            )}
          </div>
          <div className={cn("p-3 rounded-xl shrink-0", iconStyle)} aria-hidden="true">
            <Icon className="w-5 h-5" />
          </div>
        </div>

        {/* Micro sparkline */}
        {sparkData && sparkData.length >= 3 && (
          <div className="mt-3 -mx-1">
            <ResponsiveContainer width="100%" height={32}>
              <AreaChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id={`sg-${title}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={sparkColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="bg-background border rounded px-1.5 py-0.5 text-[10px] shadow">
                        {payload[0].value}
                      </div>
                    ) : null
                  }
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={1.5}
                  fill={`url(#sg-${title})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

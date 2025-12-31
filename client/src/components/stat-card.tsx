import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  className?: string;
  color?: "default" | "terracotta" | "sage" | "sand" | "emerald" | "blue" | "purple";
}

export function StatCard({ title, value, icon: Icon, trend, className, color = "default" }: StatCardProps) {
  const colorStyles = {
    default: "",
    terracotta: "bg-primary/5 dark:bg-primary/10 border-primary/20",
    sage: "bg-accent/5 dark:bg-accent/10 border-accent/20",
    sand: "bg-secondary border-border",
    emerald: "bg-accent/5 dark:bg-accent/10 border-accent/20",
    blue: "bg-primary/5 dark:bg-primary/10 border-primary/20",
    purple: "bg-primary/5 dark:bg-primary/10 border-primary/20",
  };

  const iconStyles = {
    default: "bg-primary/10 text-primary",
    terracotta: "bg-primary/15 text-primary",
    sage: "bg-accent/15 text-accent",
    sand: "bg-muted text-muted-foreground",
    emerald: "bg-accent/15 text-accent",
    blue: "bg-primary/15 text-primary",
    purple: "bg-primary/15 text-primary",
  };

  return (
    <Card className={cn("floating-window border card-hover", colorStyles[color], className)}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">{value}</h3>
            {trend && (
              <p className="text-xs font-medium text-accent mt-2">
                {trend}
              </p>
            )}
          </div>
          <div className={cn("p-3 rounded-xl shrink-0", iconStyles[color])}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

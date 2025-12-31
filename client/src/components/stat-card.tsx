import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  className?: string;
  color?: "default" | "emerald" | "blue" | "purple";
}

export function StatCard({ title, value, icon: Icon, trend, className, color = "default" }: StatCardProps) {
  const colorStyles = {
    default: "bg-white dark:bg-card text-foreground",
    emerald: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-800",
    blue: "bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-800",
    purple: "bg-purple-50 dark:bg-purple-950/30 text-purple-900 dark:text-purple-100 border-purple-200 dark:border-purple-800",
  };

  return (
    <Card className={cn("border shadow-sm card-hover overflow-hidden", colorStyles[color], className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
            <h3 className="text-3xl font-bold tracking-tight">{value}</h3>
            {trend && (
              <p className="text-xs font-medium text-emerald-600 flex items-center mt-2">
                {trend}
              </p>
            )}
          </div>
          <div className={cn("p-3 rounded-xl", 
            color === "default" ? "bg-primary/10 text-primary" : "bg-white/20 backdrop-blur-sm"
          )}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

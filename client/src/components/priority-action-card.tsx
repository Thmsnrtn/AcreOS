import { ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";

interface PriorityAction {
  action: string;
  headline: string;
  entityType?: string;
  entityId?: number;
  ctaLabel: string;
  ctaRoute: string;
}

export function PriorityActionCard() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<PriorityAction>({
    queryKey: ["/api/dashboard/priority"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const isDefault = data.action === "all_caught_up";

  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="visible">
      <Card
        className={
          isDefault
            ? "border-border bg-muted/30"
            : "border-primary/30 bg-primary/5 shadow-sm"
        }
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`flex items-center justify-center h-8 w-8 rounded-full shrink-0 ${
                  isDefault ? "bg-muted" : "bg-primary/10"
                }`}
              >
                <Sparkles
                  className={`h-4 w-4 ${isDefault ? "text-muted-foreground" : "text-primary"}`}
                />
              </div>
              <p
                className={`text-sm font-medium leading-tight ${
                  isDefault ? "text-muted-foreground" : ""
                }`}
              >
                {data.headline}
              </p>
            </div>
            {!isDefault && (
              <Button
                size="sm"
                onClick={() => navigate(data.ctaRoute)}
                className="shrink-0"
              >
                {data.ctaLabel}
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

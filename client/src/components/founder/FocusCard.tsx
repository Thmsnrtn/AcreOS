/**
 * Focus Card — Sovereign Company Protocol v7
 *
 * "Here's where you matter today."
 * Replaces the morning briefing with something sharper.
 * One card. Three priorities. What to skip.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Crosshair,
  RefreshCw,
} from "lucide-react";

export function FocusCard() {
  const queryClient = useQueryClient();

  const { data: focusData, isLoading } = useQuery({
    queryKey: ["/api/founder/v7/focus-card"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/focus-card").then(r => r.json()),
    refetchInterval: 300000, // 5 minutes
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v7/focus-card/generate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/focus-card"] }),
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading focus card" className="h-24 w-full rounded-xl" />;

  const focusCard = (focusData as any)?.focusCard;

  if (!focusCard) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Crosshair className="h-4 w-4" aria-hidden="true" />
              No focus card yet for today.
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              aria-busy={refreshMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
              {refreshMutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-acr-accent dark:border-acr-accent bg-gradient-to-br from-acr-accent/50 to-background dark:from-acr-accent/20">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Crosshair className="h-4 w-4 text-acr-accent mt-0.5 shrink-0" aria-hidden="true" />
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{focusCard}</div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-micro shrink-0"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            aria-busy={refreshMutation.isPending}
            aria-label={refreshMutation.isPending ? "Regenerating focus card" : "Regenerate focus card"}
          >
            <RefreshCw className={`h-2.5 w-2.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

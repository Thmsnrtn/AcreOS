/**
 * CostFooter — per-conversation total + most-used tier badge.
 *
 * Reads from /api/founder/solene-chat/cost-summary; useSoleneChat invalidates
 * that query on every `turn_done` so the number stays fresh.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";

interface CostSummary {
  byTier: Record<string, { totalCostUsd: number; turnCount: number }>;
  totalCostUsd: number;
  windowDays: number;
}

interface CostFooterProps {
  conversationId: number | null;
}

export function CostFooter({ conversationId }: CostFooterProps) {
  const { data } = useQuery<CostSummary>({
    queryKey: ["/api/founder/solene-chat/cost-summary", 30],
    queryFn: async () => {
      const res = await fetch(
        "/api/founder/solene-chat/cost-summary?windowDays=30",
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`cost-summary failed: ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    enabled: conversationId != null,
  });

  if (!data) {
    return (
      <div className="px-4 py-1.5 border-t border-border/60 text-[10px] text-muted-foreground/70 flex items-center gap-1">
        <Coins className="h-3 w-3" aria-hidden="true" />
        <span>Cost — loading…</span>
      </div>
    );
  }

  const topTier = Object.entries(data.byTier).sort(
    (a, b) => b[1].totalCostUsd - a[1].totalCostUsd,
  )[0];

  return (
    <div
      className="px-4 py-1.5 border-t border-border/60 text-[10px] text-muted-foreground/70 flex items-center justify-between"
      data-testid="cost-footer"
    >
      <div className="flex items-center gap-1.5">
        <Coins className="h-3 w-3" aria-hidden="true" />
        <span>
          ${data.totalCostUsd.toFixed(4)} over {data.windowDays}d
        </span>
      </div>
      {topTier ? (
        <span>
          mostly <code className="font-mono">{topTier[0]}</code>
        </span>
      ) : null}
    </div>
  );
}

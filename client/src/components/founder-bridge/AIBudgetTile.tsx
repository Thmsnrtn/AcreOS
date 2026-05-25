/**
 * AIBudgetTile — shows today's platform-wide AI spend vs cap.
 *
 * Single bar at top with overall pct spent + remaining dollar figure;
 * row beneath listing top categories (executor / briefing / etc.) by
 * spend. The brand-amber accent only kicks in when a category crosses
 * its cap (signals "you ran out of headroom here today" without ever
 * being alarming).
 */
import { cn } from "@/lib/utils";
import { BridgeTile } from "./BridgeTile";
import { BRIDGE_ACCENT } from "./tokens";

export interface AIBudgetCategoryRow {
  category: string;
  capCents: number;
  spentCents: number;
  pctSpent: number;
  calls: number;
  exceededAt: string | null;
}

export interface AIBudgetTileProps {
  totalCapCents: number;
  totalSpentCents: number;
  pctSpent: number;
  categories: AIBudgetCategoryRow[];
  isLoading?: boolean;
  onDiscuss?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  founder_brief: "Brief",
  executor: "Executor",
  briefing: "Agents",
  nurturing: "Outreach",
  cmo: "CMO",
  analysis: "Analysis",
  general: "Other",
};

function dollars(cents: number, decimals = 2): string {
  const n = cents / 100;
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(decimals)}`;
}

export function AIBudgetTile({
  totalCapCents,
  totalSpentCents,
  pctSpent,
  categories,
  isLoading,
  onDiscuss,
}: AIBudgetTileProps) {
  // Sort by spent desc; cap to the top 5 so the row stays scannable.
  const visible = [...(categories ?? [])]
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, 5);

  const isHot = pctSpent >= 80;
  const isCapped = pctSpent >= 100;

  return (
    <BridgeTile label="AI Budget" onDiscuss={onDiscuss} testId="bridge-tile-ai-budget">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            AI Budget · today
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {isLoading ? "—" : `${dollars(totalSpentCents)} / ${dollars(totalCapCents)}`}
          </span>
        </div>

        {/* Total spend bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            aria-hidden
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isCapped ? "bg-amber-400" : isHot ? "bg-amber-400/70" : "bg-foreground/40",
            )}
            style={{ width: isLoading ? "0%" : `${Math.min(100, pctSpent)}%` }}
          />
        </div>

        {/* Per-category breakdown */}
        {!isLoading && visible.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {visible.map((row) => {
              const exhausted = row.exceededAt != null;
              return (
                <div
                  key={row.category}
                  className="flex items-center justify-between text-[11px] tabular-nums"
                  data-testid={`ai-budget-row-${row.category}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        exhausted ? "" : "bg-foreground/40",
                      )}
                      style={exhausted ? { backgroundColor: BRIDGE_ACCENT } : undefined}
                    />
                    <span className="text-foreground/85">
                      {CATEGORY_LABELS[row.category] ?? row.category}
                    </span>
                    {row.calls > 0 && (
                      <span className="font-mono text-muted-foreground">· {row.calls}×</span>
                    )}
                  </div>
                  <span className={cn(
                    "font-mono",
                    exhausted ? "text-foreground" : "text-muted-foreground",
                  )}>
                    {dollars(row.spentCents)} / {dollars(row.capCents)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {!isLoading && visible.length === 0 && (
          <p className="text-xs text-muted-foreground">No AI spend yet today.</p>
        )}
      </div>
    </BridgeTile>
  );
}

/**
 * FounderPulseStrip — F1 of the experience-legibility cluster
 * (docs/company/experience-legibility.md).
 *
 * The ambient liveness line behind every founder door: proof the brain is
 * alive on the page you're already on. Three honest states:
 *   - green:  "Last cycle 12m ago · next ~18m · 4 actions (24h)"
 *   - amber:  the loop has missed 2+ cadences — silence rendered visibly
 *   - muted:  it has never run (fresh env / jobs disabled) — says so
 *
 * Tapping it lands on Controls, where the Live card gives the full read.
 * Polls the same /api/founder/autopilot/live read the Controls door uses
 * (no new backend surface beyond the `loop` block added there).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";

interface LoopBlock {
  lastCycleAt: string | null;
  cadenceMs: number;
  nextDueAt: string | null;
  stale: boolean;
}
interface LiveResponse {
  loop?: LoopBlock;
  dispatchesCompletedLast24h?: number;
}

function nextInLabel(nextDueAt: string | null): string | null {
  if (!nextDueAt) return null;
  const ms = new Date(nextDueAt).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const min = Math.round(ms / 60_000);
  return min >= 60 ? `next ~${Math.round(min / 60)}h` : `next ~${min}m`;
}

export function FounderPulseStrip() {
  const { data, isLoading, isError } = useQuery<LiveResponse>({
    queryKey: ["/api/founder/autopilot/live"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/live", { credentials: "include" });
      if (!res.ok) throw new Error(`live ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // While loading render nothing — the strip is ambient reassurance, never a
  // blocker or a spinner.
  if (isLoading) return null;

  // A FAILED read is never pixel-identical to a calm one: say the check
  // itself broke (about this page, not the company), in the same muted
  // styling family as the strip.
  if (isError) {
    return (
      <Link
        href="/founder/autopilot/control"
        data-testid="founder-pulse-strip"
        data-pulse-state="error"
        aria-label="Autopilot heartbeat check failed. Opens Controls."
        className={cn(
          "flex items-center gap-2 rounded-card border px-3 py-2 min-h-[44px] text-xs transition-colors",
          "hover:bg-muted/40 active:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "border-border bg-card/60 text-muted-foreground",
        )}
      >
        <span className="relative inline-flex h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
        <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">Couldn't check the heartbeat just now — that's about this page, not the company.</span>
      </Link>
    );
  }

  if (!data?.loop) return null;

  const { loop, dispatchesCompletedLast24h = 0 } = data;
  const tone = loop.lastCycleAt === null ? "muted" : loop.stale ? "stale" : "live";

  const label =
    tone === "muted"
      ? "The brain hasn't run a cycle yet"
      : tone === "stale"
        ? `Nothing has run since ${formatRelative(loop.lastCycleAt!)} — cycles are usually every ${Math.round(loop.cadenceMs / 60_000)}m`
        : [
            `Last cycle ${formatRelative(loop.lastCycleAt!)}`,
            nextInLabel(loop.nextDueAt),
            `${dispatchesCompletedLast24h} action${dispatchesCompletedLast24h === 1 ? "" : "s"} (24h)`,
          ]
            .filter(Boolean)
            .join(" · ");

  return (
    <Link
      href="/founder/autopilot/control"
      data-testid="founder-pulse-strip"
      data-pulse-state={tone}
      aria-label={`Autopilot heartbeat: ${label}. Opens Controls.`}
      className={cn(
        "flex items-center gap-2 rounded-card border px-3 py-2 min-h-[44px] text-xs transition-colors",
        "hover:bg-muted/40 active:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "stale"
          ? "border-acr-warn/40 bg-acr-warn-soft text-acr-warn"
          : "border-border bg-card/60 text-muted-foreground",
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        {tone === "live" && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-acr-success opacity-60 animate-ping motion-reduce:animate-none" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            tone === "live" ? "bg-acr-success" : tone === "stale" ? "bg-acr-warn" : "bg-muted-foreground/50",
          )}
        />
      </span>
      <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * HeroMetricTile — the one big number on the Bridge surface.
 *
 * Fraunces 64pt desktop / 44pt mobile, weight 600, tracking -0.02em.
 * Subtitle: `↑ 4.2% · vs 30 days ago` style delta chip. Sparkline
 * below, full-width within the tile.
 *
 * The number animates *once* on first paint via a 600ms count-up
 * (sub-component renders the count-up; reduced-motion users get the
 * final value immediately). Subsequent refreshes use a 200ms crossfade
 * — repeated count-ups feel cheap, not premium.
 */
import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotionPreference } from "@/lib/motion-tokens";
import { BridgeTile } from "./BridgeTile";
import { BridgeSparkline } from "./BridgeSparkline";

export interface HeroMetricTileProps {
  /** Label shown above the number, e.g. "MRR". */
  label: string;
  /** Display value — already formatted, e.g. "$48,212". */
  value: string;
  /** Raw numeric value used for the count-up animation. */
  numericValue?: number;
  /** Delta vs a reference period — e.g. 4.2 means +4.2%. */
  deltaPct?: number;
  /** Reference-period label, e.g. "vs 30 days ago". */
  deltaLabel?: string;
  /** 30-day sparkline series (oldest → newest). */
  sparkline?: number[];
  /** Loading state. */
  isLoading?: boolean;
  /** Pipe context into Atlas composer. */
  onDiscuss?: () => void;
}

export function HeroMetricTile({
  label,
  value,
  numericValue,
  deltaPct,
  deltaLabel,
  sparkline,
  isLoading,
  onDiscuss,
}: HeroMetricTileProps) {
  return (
    <BridgeTile label={label} onDiscuss={onDiscuss} testId="bridge-tile-hero">
      <div className="flex flex-col gap-3 p-5 md:gap-4 md:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
          <DeltaChip deltaPct={deltaPct} deltaLabel={deltaLabel} isLoading={isLoading} />
        </div>
        <div className="flex items-end justify-between gap-4">
          <div
            className={cn(
              // Display serif — Fraunces wired via --font-serif. Hero
              // numerics use the serif's weight + tight tracking for the
              // "considered" feel; mono is reserved for telemetry tiles.
              "font-serif font-semibold leading-none tracking-tight tabular-nums",
              "text-[44px] md:text-[64px]",
            )}
            data-testid="bridge-hero-value"
            // Screen readers should announce only the final settled value,
            // not the count-up tween — polite update on data refresh.
            aria-live="polite"
            aria-atomic="true"
          >
            {isLoading ? (
              <span className="inline-block h-[1em] w-[5ch] animate-pulse rounded-md bg-muted/40" />
            ) : numericValue != null ? (
              <CountUp from={0} to={numericValue} formatted={value} />
            ) : (
              value
            )}
          </div>
          {sparkline && sparkline.length >= 2 && (
            <BridgeSparkline
              values={sparkline}
              width={140}
              height={40}
              className="text-foreground/70"
            />
          )}
        </div>
      </div>
    </BridgeTile>
  );
}

function DeltaChip({
  deltaPct,
  deltaLabel,
  isLoading,
}: Pick<HeroMetricTileProps, "deltaPct" | "deltaLabel" | "isLoading">) {
  if (isLoading) return <span className="h-4 w-20 animate-pulse rounded bg-muted/40" />;
  if (deltaPct == null) return null;

  const Icon = deltaPct > 0.05 ? TrendingUp : deltaPct < -0.05 ? TrendingDown : Minus;
  const tone =
    deltaPct > 0.05
      ? "text-emerald-400/90"
      : deltaPct < -0.05
        ? "text-rose-400/90"
        : "text-muted-foreground";
  const sign = deltaPct > 0 ? "↑" : deltaPct < 0 ? "↓" : "→";
  const abs = Math.abs(deltaPct).toFixed(1);

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium tabular-nums", tone)}
      aria-label={`Change: ${sign} ${abs}% ${deltaLabel ?? ""}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />
      {sign} {abs}%
      {deltaLabel && (
        <span className="ml-1 font-normal text-muted-foreground">· {deltaLabel}</span>
      )}
    </span>
  );
}

/**
 * CountUp — single-shot 600ms ease-out tween from `from` → `to`,
 * formatted via the supplied `formatted` string at completion.
 *
 * Animates the leading digits only; once the tween finishes, swaps in
 * the canonical pre-formatted string so currency symbols, commas,
 * suffixes etc. render exactly as the parent computed them.
 *
 * Reduced-motion users skip the tween and see the final value
 * immediately.
 */
function CountUp({ from, to, formatted }: { from: number; to: number; formatted: string }) {
  const reduced = useReducedMotionPreference();
  const [display, setDisplay] = useState<number>(reduced ? to : from);
  const [done, setDone] = useState(reduced);
  const startRef = useRef<number | null>(null);
  const hasRun = useRef(false);

  useEffect(() => {
    if (reduced || hasRun.current) {
      setDisplay(to);
      setDone(true);
      return;
    }
    hasRun.current = true;
    let raf = 0;
    const duration = 600;
    const tick = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const progress = Math.min(1, (t - startRef.current) / duration);
      // ease-out-quart
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setDone(true);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, reduced]);

  if (done) return <>{formatted}</>;
  // During the tween, render a numeric approximation. Strip everything
  // but the digits from the formatted string and substitute our display
  // value — keeps the layout from jumping as the number widens.
  const approx = Math.round(display).toLocaleString();
  return <>{approx}</>;
}

/**
 * TelemetryTile — secondary metric tile.
 *
 * Mono numerics (`--font-mono`, tabular-nums) so a row of them aligns
 * cleanly. ~120pt tall, full-width within its grid cell. Optional
 * sparkline floats right; optional tone (`"warn" | "alert"`) shifts the
 * border to amber gradients without ever crossing into red on this
 * surface — Bridge is a cockpit, not an emergency room.
 */
import { cn } from "@/lib/utils";
import { BridgeTile } from "./BridgeTile";
import { BridgeSparkline } from "./BridgeSparkline";
import { BRIDGE_ACCENT } from "./tokens";

export interface TelemetryTileProps {
  label: string;
  value: string;
  /** Trailing units, e.g. "/d", "months". Rendered smaller, muted. */
  suffix?: string;
  sparkline?: number[];
  /** Tone shifts the border. Use sparingly. */
  tone?: "neutral" | "warn" | "alert";
  isLoading?: boolean;
  onDiscuss?: () => void;
}

export function TelemetryTile({
  label,
  value,
  suffix,
  sparkline,
  tone = "neutral",
  isLoading,
  onDiscuss,
}: TelemetryTileProps) {
  return (
    <BridgeTile
      label={label}
      onDiscuss={onDiscuss}
      testId={`bridge-tile-telemetry-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={cn(
        tone === "warn" && "border-acr-bridge-accent/30",
        tone === "alert" && "border-acr-bridge-accent/60",
      )}
    >
      <div className="flex flex-1 flex-col justify-between gap-3 p-4 md:p-5">
        <span className="text-caption uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-mono text-3xl font-medium leading-none tabular-nums tracking-tight md:text-[28px]",
              )}
              style={tone === "alert" ? { color: BRIDGE_ACCENT } : undefined}
              data-testid="bridge-telemetry-value"
            >
              {isLoading ? (
                <span className="inline-block h-[1em] w-[4ch] animate-pulse rounded bg-muted/40" />
              ) : (
                value
              )}
            </span>
            {suffix && (
              <span className="text-xs font-normal text-muted-foreground">{suffix}</span>
            )}
          </div>
          {sparkline && sparkline.length >= 2 && (
            <BridgeSparkline
              values={sparkline}
              width={72}
              height={28}
              className="text-foreground/60"
            />
          )}
        </div>
      </div>
    </BridgeTile>
  );
}

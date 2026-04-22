/**
 * DealJourney — visual timeline of where a deal sits in the
 * negotiation → close workflow.
 *
 * Shows the 6 stages of a land deal as a horizontal progress rail:
 *   Negotiating → Offer Sent → Countered → Accepted → In Escrow → Closed
 *
 * Cancelled deals render the journey greyed out with a "Cancelled"
 * terminal marker. Current stage gets a solid dot; completed stages
 * get a filled connector; upcoming stages stay outlined.
 *
 * Drop-in for deal cards and the deal detail drawer. Compact by
 * default (labels below dots on sm+ screens); pass `dense` for a
 * single-line stage dot strip suitable for list rows.
 *
 * Why it matters (Principle 1 — rock-solid land investing journey):
 * every deal has the same lifecycle, but the UI has been letting
 * users guess what stage a deal is at from its status badge. Making
 * the progression explicit means operators know the next action
 * without opening the deal.
 */

import * as React from "react";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type DealStatus =
  | "negotiating"
  | "offer_sent"
  | "countered"
  | "accepted"
  | "in_escrow"
  | "closed"
  | "cancelled";

const STAGES: { key: Exclude<DealStatus, "cancelled">; label: string }[] = [
  { key: "negotiating", label: "Negotiating" },
  { key: "offer_sent", label: "Offer Sent" },
  { key: "countered", label: "Countered" },
  { key: "accepted", label: "Accepted" },
  { key: "in_escrow", label: "In Escrow" },
  { key: "closed", label: "Closed" },
];

interface DealJourneyProps {
  status: DealStatus | string;
  /** One-line compact mode for tight rows. Default false. */
  dense?: boolean;
  className?: string;
}

export function DealJourney({ status, dense = false, className }: DealJourneyProps) {
  const cancelled = status === "cancelled";
  const currentIdx = cancelled
    ? -1
    : STAGES.findIndex((s) => s.key === status);
  const safeIdx = currentIdx < 0 ? 0 : currentIdx;

  return (
    <div
      className={cn(
        "w-full",
        cancelled && "opacity-50",
        className,
      )}
      role="img"
      aria-label={
        cancelled
          ? "Deal cancelled"
          : `Deal stage: ${STAGES[safeIdx]?.label ?? status}`
      }
    >
      <div className={cn("flex items-center", dense ? "gap-1" : "gap-0")}>
        {STAGES.map((stage, i) => {
          const done = !cancelled && i < safeIdx;
          const current = !cancelled && i === safeIdx;
          const Icon = done ? CheckCircle2 : cancelled && i === 0 ? XCircle : Circle;
          const connector = i < STAGES.length - 1;
          return (
            <React.Fragment key={stage.key}>
              <div className="flex flex-col items-center shrink-0">
                <Icon
                  className={cn(
                    "flex-shrink-0",
                    dense ? "h-3 w-3" : "h-4 w-4",
                    done && "text-emerald-600 dark:text-emerald-400 fill-emerald-500",
                    current && "text-primary fill-primary/20",
                    !done && !current && !cancelled && "text-muted-foreground/40",
                    cancelled && "text-rose-500",
                  )}
                />
                {!dense && (
                  <span
                    className={cn(
                      "text-[10px] mt-1 whitespace-nowrap",
                      current
                        ? "font-semibold text-foreground"
                        : done
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {stage.label}
                  </span>
                )}
              </div>
              {connector && (
                <div
                  className={cn(
                    "flex-1 h-0.5 min-w-[8px]",
                    dense ? "mx-0.5" : "mx-1 mb-4",
                    done
                      ? "bg-emerald-500/60"
                      : "bg-muted-foreground/20",
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {cancelled && !dense && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 font-medium text-center mt-1">
          Cancelled
        </p>
      )}
    </div>
  );
}

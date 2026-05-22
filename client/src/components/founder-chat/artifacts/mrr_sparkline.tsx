/**
 * mrr_sparkline artifact — MRR over time, Apple-Stocks-style.
 *
 * Hero: current MRR + delta in Fraunces. The actual sparkline is a thin
 * SVG path underneath — secondary. Per the design language: data is the
 * hero, chrome is quiet.
 */
import { motion } from "framer-motion";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DURATION_DEFAULT_MS } from "@/lib/motion";
import type { MrrPoint } from "@shared/founder-chat/artifacts";

interface MrrSparklineProps {
  series: MrrPoint[];
  label?: string;
}

function fmtUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round((cents ?? 0) / 100));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SVG_W = 320;
const SVG_H = 64;

export function MrrSparklineArtifact({ series, label }: MrrSparklineProps) {
  const data = (series ?? []).map((p) => ({
    date: p.date,
    cents: Number(p.cents ?? 0),
  }));

  const first = data[0]?.cents ?? 0;
  const last = data[data.length - 1]?.cents ?? 0;
  const delta = last - first;
  const deltaPct = first > 0 ? Math.round((delta / first) * 1000) / 10 : 0;
  const isUp = delta >= 0;

  const pathD = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data.map((d) => d.cents));
    const max = Math.max(...data.map((d) => d.cents));
    const range = max - min || 1;
    const stepX = SVG_W / (data.length - 1);
    return data
      .map((d, i) => {
        const x = i * stepX;
        const y = SVG_H - ((d.cents - min) / range) * SVG_H;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [data]);

  const strokeColor = isUp ? "hsl(var(--acr-pos))" : "hsl(var(--acr-neg))";
  const firstDate = data[0]?.date;
  const lastDate = data[data.length - 1]?.date;

  return (
    <Card
      data-testid="artifact-mrr-sparkline"
      className="border-border/60 shadow-none"
    >
      <CardContent className="p-5 sm:p-6">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          {label ?? "MRR"}
        </p>
        <div className="mt-1 flex items-baseline gap-3 flex-wrap">
          <p
            className={cn(
              "font-serif tabular-nums leading-none",
              "text-4xl sm:text-5xl font-medium",
            )}
          >
            {fmtUSD(last)}
          </p>
          {data.length > 1 && (
            <p
              className={cn(
                "font-serif tabular-nums text-base sm:text-lg",
                isUp ? "text-acr-pos" : "text-acr-neg",
              )}
            >
              {isUp ? "+" : ""}
              {fmtUSD(delta)}{" "}
              <span className="text-sm opacity-80">
                ({isUp ? "+" : ""}
                {deltaPct}%)
              </span>
            </p>
          )}
        </div>

        {pathD && (
          <div className="mt-4">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              preserveAspectRatio="none"
              className="w-full h-16"
              role="img"
              aria-label={`MRR sparkline from ${fmtUSD(first)} to ${fmtUSD(last)}`}
            >
              <motion.path
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  duration: DURATION_DEFAULT_MS / 1000,
                  ease: [0.4, 0, 0.2, 1],
                }}
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{firstDate ? fmtDate(firstDate) : ""}</span>
              <span>{lastDate ? fmtDate(lastDate) : ""}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MrrSparklineArtifact;
